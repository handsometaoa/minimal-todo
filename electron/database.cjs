// 本地数据库模块：better-sqlite3 封装（schema 初始化、版本迁移、DAO）
// 物理位置：userData/app-data/minimal-todo.db（WAL 模式），单实例锁保证单写者。
// 数据模型：用户(users) → 会员(memberships) / 待办(todos) / 设置(settings)，
// 待办以单表 status 字段区分进行中/已完成，为多用户与未来云同步预留 user_id/deleted/sort_order。
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = 2;
const DEFAULT_USER_ID = 'local';
const DEFAULT_USER_NICKNAME = '本地用户';
// 默认会员策略：SVIP 限时体验全开（与历史体验一致），后续接真实用户/支付时替换
const DEFAULT_MEMBERSHIP = { active: 1, isPermanent: 0, expiresAt: '', planId: 'trial_month' };

let db = null;

// —— 行 ↔ 内存对象映射（内存对象为 camelCase，缺失的可选字段对应 NULL） ——

function todoToRow(userId, todo, status) {
    const now = Date.now();
    return {
        id: String(todo.id),
        user_id: userId,
        text: String(todo.text ?? ''),
        status,
        due_at: Number.isFinite(todo.dueAt) ? todo.dueAt : null,
        reminded_at: Number.isFinite(todo.remindedAt) ? todo.remindedAt : null,
        completed_at: Number.isFinite(todo.completedAt) ? todo.completedAt : null,
        deleted: 0,
        created_at: Number.isFinite(todo.createdAt) ? todo.createdAt : now,
        updated_at: now
    };
}

function rowToTodo(row) {
    const todo = {
        id: row.id,
        text: row.text,
        createdAt: row.created_at
    };
    if (row.due_at != null) todo.dueAt = row.due_at;
    if (row.reminded_at != null) todo.remindedAt = row.reminded_at;
    if (row.completed_at != null) todo.completedAt = row.completed_at;
    return todo;
}

// —— schema 与迁移 ——

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    nickname   TEXT    NOT NULL,
    avatar     TEXT    NOT NULL DEFAULT '',
    type       TEXT    NOT NULL DEFAULT 'local',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
    user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    active       INTEGER NOT NULL DEFAULT 0,
    is_permanent INTEGER NOT NULL DEFAULT 0,
    expires_at   TEXT    NOT NULL DEFAULT '',
    plan_id      TEXT    NOT NULL DEFAULT '',
    updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS todos (
    id           TEXT PRIMARY KEY,
    user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text         TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
    due_at       INTEGER,
    reminded_at  INTEGER,
    completed_at INTEGER,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    deleted      INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_user_status ON todos(user_id, status, deleted);

CREATE TABLE IF NOT EXISTS settings (
    user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    appearance_mode  TEXT    NOT NULL DEFAULT 'system',
    theme_mode       TEXT    NOT NULL DEFAULT 'preset',
    preset_theme_id  TEXT    NOT NULL DEFAULT 'graphite',
    custom_primary   TEXT    NOT NULL DEFAULT '#7c8aa5',
    custom_secondary TEXT    NOT NULL DEFAULT '#5f6b7c',
    due_presets      TEXT    NOT NULL DEFAULT '{}',
    due_slots        TEXT    NOT NULL DEFAULT '[]',
    updated_at       INTEGER NOT NULL
);
`;

function getMeta(key) {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
}

function setMeta(key, value) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
        key,
        String(value)
    );
}

function migrate(dbPath) {
    db.exec(SCHEMA_SQL);
    const current = Number(getMeta('schemaVersion') || 0);
    if (current > SCHEMA_VERSION) {
        throw new Error(`数据库版本过新（库 v${current} > 应用 v${SCHEMA_VERSION}），请升级应用: ${dbPath}`);
    }
    // v0（空库）→ v1：建种子数据 + 导入旧版 JSON 文件存储
    if (current < 1) {
        seedDefaultUser();
        importLegacyStorageFiles(dbPath);
    }
    // v1 → v2：settings 增加 due_slots 列（快捷芯片槽位：每项自选天数+时间）
    if (current < 2) {
        const cols = db
            .prepare('PRAGMA table_info(settings)')
            .all()
            .map((c) => c.name);
        if (!cols.includes('due_slots')) {
            db.exec("ALTER TABLE settings ADD COLUMN due_slots TEXT NOT NULL DEFAULT '[]'");
        }
    }
    setMeta('schemaVersion', SCHEMA_VERSION);
}

function seedDefaultUser() {
    const now = Date.now();
    db.prepare(
        'INSERT OR IGNORE INTO users (id, nickname, avatar, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(DEFAULT_USER_ID, DEFAULT_USER_NICKNAME, '', 'local', now, now);
    db.prepare(
        'INSERT OR IGNORE INTO memberships (user_id, active, is_permanent, expires_at, plan_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
        DEFAULT_USER_ID,
        DEFAULT_MEMBERSHIP.active,
        DEFAULT_MEMBERSHIP.isPermanent,
        DEFAULT_MEMBERSHIP.expiresAt,
        DEFAULT_MEMBERSHIP.planId,
        now
    );
    if (getMeta('currentUserId') == null) setMeta('currentUserId', DEFAULT_USER_ID);
}

// v1 迁移：旧版「文档式 JSON 文件」（userData/storage/todo__data.json 等）导入新表，
// 成功后把旧目录改名备份，不再参与读写。
function importLegacyStorageFiles(dbPath) {
    const legacyDir = path.join(path.dirname(dbPath), '..', 'storage');
    const dataDoc = readJsonFile(path.join(legacyDir, 'todo__data.json'));
    if (!dataDoc) return;
    const payload = dataDoc.data ?? dataDoc;
    if (payload && typeof payload === 'object') {
        replaceAllTodos(DEFAULT_USER_ID, {
            todos: Array.isArray(payload.todos) ? payload.todos : [],
            completed: Array.isArray(payload.completed) ? payload.completed : []
        });
        const settingDoc = readJsonFile(path.join(legacyDir, 'todo__setting.json'));
        const settingPayload = settingDoc ? (settingDoc.data ?? settingDoc) : null;
        if (settingPayload && typeof settingPayload === 'object') {
            saveSettings(DEFAULT_USER_ID, settingPayload);
        }
        setMeta('migratedLegacyFileStorageAt', Date.now());
        backupLegacyStorageDir(legacyDir);
    }
}

function readJsonFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('[db] 读取旧数据文件失败:', filePath, error);
        return null;
    }
}

function backupLegacyStorageDir(legacyDir) {
    try {
        if (!fs.existsSync(legacyDir)) return;
        const backupDir = `${legacyDir}-legacy-backup`;
        if (fs.existsSync(backupDir)) {
            for (const entry of fs.readdirSync(legacyDir)) {
                fs.copyFileSync(path.join(legacyDir, entry), path.join(backupDir, entry));
            }
        } else {
            fs.renameSync(legacyDir, backupDir);
        }
    } catch (error) {
        console.error('[db] 备份旧存储目录失败（不影响新库使用）:', error);
    }
}

// —— 待办 DAO ——

function nextSortOrder(userId) {
    const row = db
        .prepare("SELECT COALESCE(MIN(sort_order), 0) - 1 AS next FROM todos WHERE user_id = ? AND status = 'active'")
        .get(userId);
    return row.next;
}

function createTodo(userId, todo) {
    const row = todoToRow(userId, todo, 'active');
    db.prepare(
        `INSERT INTO todos (id, user_id, text, status, due_at, reminded_at, completed_at, sort_order, deleted, created_at, updated_at)
         VALUES (@id, @user_id, @text, 'active', @due_at, @reminded_at, NULL, ${Number(nextSortOrder(userId))}, 0, @created_at, @updated_at)`
    ).run(row);
}

// 编辑文本/到期时间/提醒标记等字段（不改变排序与状态）
function updateTodo(userId, todo) {
    db.prepare(
        `UPDATE todos
         SET text = ?, due_at = ?, reminded_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'active'`
    ).run(
        String(todo.text ?? ''),
        Number.isFinite(todo.dueAt) ? todo.dueAt : null,
        Number.isFinite(todo.remindedAt) ? todo.remindedAt : null,
        Date.now(),
        String(todo.id),
        userId
    );
}

function completeTodo(userId, id, completedAt) {
    db.prepare(
        `UPDATE todos
         SET status = 'completed', completed_at = ?, reminded_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ?`
    ).run(Number.isFinite(completedAt) ? completedAt : Date.now(), Date.now(), String(id), userId);
}

function restoreTodo(userId, id) {
    // 恢复为未完成：清除到期/提醒/完成标记，回到进行中列表最前（与原内存 unshift 行为一致）
    db.prepare(
        `UPDATE todos
         SET status = 'active', due_at = NULL, reminded_at = NULL, completed_at = NULL,
             sort_order = ${Number(nextSortOrder(userId))}, updated_at = ?
         WHERE id = ? AND user_id = ?`
    ).run(Date.now(), String(id), userId);
}

function deleteTodo(userId, id) {
    db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(String(id), userId);
}

// 拖拽排序：按展示顺序全量重排 sort_order（0..n-1）
function reorderTodos(userId, orderedIds) {
    const update = db.prepare('UPDATE todos SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?');
    const now = Date.now();
    const run = db.transaction((ids) => {
        ids.forEach((id, index) => update.run(index, now, String(id), userId));
    });
    run(Array.isArray(orderedIds) ? orderedIds : []);
}

// 全量替换（导入 / 旧数据迁移）：事务内清空后重建
function replaceAllTodos(userId, { todos, completed }) {
    const insert = db.prepare(
        `INSERT INTO todos (id, user_id, text, status, due_at, reminded_at, completed_at, sort_order, deleted, created_at, updated_at)
         VALUES (@id, @user_id, @text, @status, @due_at, @reminded_at, @completed_at, @sort_order, 0, @created_at, @updated_at)`
    );
    const run = db.transaction((data) => {
        db.prepare('DELETE FROM todos WHERE user_id = ?').run(userId);
        data.todos.forEach((todo, index) => {
            if (!todo?.id) return;
            insert.run({ ...todoToRow(userId, todo, 'active'), sort_order: index });
        });
        data.completed.forEach((todo) => {
            if (!todo?.id) return;
            insert.run({ ...todoToRow(userId, todo, 'completed'), sort_order: 0 });
        });
    });
    run({ todos: todos || [], completed: completed || [] });
}

function listTodos(userId, status) {
    const order = status === 'completed' ? 'completed_at DESC, created_at DESC' : 'sort_order ASC, created_at DESC';
    return db
        .prepare(`SELECT * FROM todos WHERE user_id = ? AND status = ? AND deleted = 0 ORDER BY ${order}`)
        .all(userId, status)
        .map(rowToTodo);
}

function clearExpiredCompleted(userId, beforeTs) {
    return db
        .prepare(
            "DELETE FROM todos WHERE user_id = ? AND status = 'completed' AND (completed_at IS NULL OR completed_at < ?)"
        )
        .run(userId, Number.isFinite(beforeTs) ? beforeTs : Date.now() - 30 * 86400000).changes;
}

// —— 设置 DAO ——

function getSettings(userId) {
    const row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);
    if (!row) return null;
    let duePresets;
    try {
        duePresets = JSON.parse(row.due_presets);
    } catch {
        duePresets = {};
    }
    let dueSlots = [];
    try {
        const parsed = JSON.parse(row.due_slots);
        if (Array.isArray(parsed)) dueSlots = parsed;
    } catch {
        dueSlots = [];
    }
    return {
        appearance: { mode: row.appearance_mode },
        theme: {
            mode: row.theme_mode,
            presetThemeId: row.preset_theme_id,
            customPrimary: row.custom_primary,
            customSecondary: row.custom_secondary
        },
        duePresets: duePresets || {},
        dueSlots
    };
}

function saveSettings(userId, settings) {
    const normalized = settings || {};
    const appearance = normalized.appearance || {};
    const theme = normalized.theme || {};
    db.prepare(
        `INSERT INTO settings (user_id, appearance_mode, theme_mode, preset_theme_id, custom_primary, custom_secondary, due_presets, due_slots, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
            appearance_mode = excluded.appearance_mode,
            theme_mode = excluded.theme_mode,
            preset_theme_id = excluded.preset_theme_id,
            custom_primary = excluded.custom_primary,
            custom_secondary = excluded.custom_secondary,
            due_presets = excluded.due_presets,
            due_slots = excluded.due_slots,
            updated_at = excluded.updated_at`
    ).run(
        userId,
        String(appearance.mode || 'system'),
        String(theme.mode || 'preset'),
        String(theme.presetThemeId || 'graphite'),
        String(theme.customPrimary || '#7c8aa5'),
        String(theme.customSecondary || '#5f6b7c'),
        JSON.stringify(normalized.duePresets || {}),
        JSON.stringify(Array.isArray(normalized.dueSlots) ? normalized.dueSlots : []),
        Date.now()
    );
}

// —— 用户 / 会员 DAO ——

function getUserProfile(userId) {
    const row = db.prepare('SELECT id, nickname, avatar, type FROM users WHERE id = ?').get(userId);
    if (!row) return null;
    return { id: row.id, nickname: row.nickname, avatar: row.avatar, type: row.type };
}

function updateUserProfile(userId, patch) {
    const current = getUserProfile(userId);
    if (!current) return null;
    db.prepare('UPDATE users SET nickname = ?, avatar = ?, updated_at = ? WHERE id = ?').run(
        String(patch?.nickname ?? current.nickname),
        String(patch?.avatar ?? current.avatar),
        Date.now(),
        userId
    );
    return getUserProfile(userId);
}

function getMembership(userId) {
    const row = db
        .prepare('SELECT active, is_permanent, expires_at, plan_id FROM memberships WHERE user_id = ?')
        .get(userId);
    if (!row) return { active: false, isPermanent: false, expiresAt: '', planId: '' };
    return {
        active: Boolean(row.active),
        isPermanent: Boolean(row.is_permanent),
        expiresAt: row.expires_at,
        planId: row.plan_id
    };
}

// —— 设备级设置（meta KV：窗口停靠、开机自启偏好等随程序持久化的配置） ——

function getDeviceSettings() {
    const rows = db.prepare("SELECT key, value FROM meta WHERE key LIKE 'device.%'").all();
    const settings = {};
    for (const row of rows) {
        try {
            settings[row.key.slice('device.'.length)] = JSON.parse(row.value);
        } catch {
            settings[row.key.slice('device.'.length)] = row.value;
        }
    }
    return settings;
}

function setDeviceSetting(key, value) {
    if (!/^[\w.-]{1,40}$/.test(String(key))) throw new Error('invalid device setting key');
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
        `device.${key}`,
        JSON.stringify(value ?? null)
    );
}

// —— 对外接口 ——

function currentUserId() {
    return getMeta('currentUserId') || DEFAULT_USER_ID;
}

function bootstrapSnapshot() {
    const userId = currentUserId();
    return {
        schemaVersion: SCHEMA_VERSION,
        userId,
        user: getUserProfile(userId),
        membership: getMembership(userId),
        todos: listTodos(userId, 'active'),
        completed: listTodos(userId, 'completed'),
        settings: getSettings(userId),
        // 停靠配置随快照下发：渲染层与主进程启动定位（ready-to-show）消费同一份 device.dock，
        // 避免渲染层旧 localStorage 值在面板展开时把窗口拽回另一侧
        dock: getDeviceSettings().dock || null
    };
}

function open(userDataDir) {
    if (db) return module.exports;
    const dbDir = path.join(userDataDir, 'app-data');
    fs.mkdirSync(dbDir, { recursive: true });
    const dbPath = path.join(dbDir, 'minimal-todo.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(dbPath);
    return module.exports;
}

function close() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = {
    open,
    close,
    bootstrapSnapshot,
    currentUserId,
    createTodo,
    updateTodo,
    completeTodo,
    restoreTodo,
    deleteTodo,
    reorderTodos,
    replaceAllTodos,
    listTodos,
    clearExpiredCompleted,
    getSettings,
    saveSettings,
    getUserProfile,
    updateUserProfile,
    getMembership,
    getDeviceSettings,
    setDeviceSetting
};
