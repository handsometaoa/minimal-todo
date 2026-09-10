// 存储仓库层：渲染进程统一的数据访问接口（契约详见 docs/storage-api.md）
//
// 后端选择（按宿主能力探测）：
//   Electron 桌面端 → host.db（ipcRenderer.invoke → 主进程 SQLite，见 electron/database.cjs）
//   纯浏览器兜底    → localStorage 快照（开发/预览场景）
//
// 契约（全异步）：
//   bootstrap()             → { userId, user, membership, todos, completed, settings } | null
//   todos.create(todo)          新增进行中待办（列表最前）
//   todos.update(todo)          整对象更新进行中待办（内存对象为完整事实来源）
//   todos.complete(id, at)      标记完成
//   todos.restore(id)           恢复为未完成（清到期/提醒/完成标记，回到最前）
//   todos.remove(id)            删除（硬删）
//   todos.reorder(orderedIds)   按展示顺序全量重排
//   todos.bulkReplace(payload)  全量替换（导入 / 旧数据迁移）
//   clearExpiredCompleted(beforeTs) → { removed }
//   saveSettings(settings)

const LOCAL_SNAPSHOT_KEY = 'minimal-todo/local-backend';
// 浏览器兜底环境的默认用户/会员，与主进程建库种子数据保持一致
const LOCAL_DEFAULT_USER = { id: 'local', nickname: '本地用户', avatar: '', type: 'local' };
const LOCAL_DEFAULT_MEMBERSHIP = { active: true, isPermanent: false, expiresAt: '', planId: 'trial_month' };

function readLocalSnapshot() {
    try {
        const raw = window.localStorage.getItem(LOCAL_SNAPSHOT_KEY);
        if (!raw) return null;
        const snapshot = JSON.parse(raw);
        if (!snapshot || typeof snapshot !== 'object') return null;
        return {
            todos: Array.isArray(snapshot.todos) ? snapshot.todos : [],
            completed: Array.isArray(snapshot.completed) ? snapshot.completed : [],
            settings: snapshot.settings || null,
            user: snapshot.user || LOCAL_DEFAULT_USER,
            membership: snapshot.membership || LOCAL_DEFAULT_MEMBERSHIP
        };
    } catch (error) {
        console.error('[storage] 读取本地快照失败:', error);
        return null;
    }
}

function writeLocalSnapshot(snapshot) {
    try {
        window.localStorage.setItem(LOCAL_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch (error) {
        console.error('[storage] 写入本地快照失败:', error);
    }
}

function createLocalBackend() {
    let snapshot = readLocalSnapshot() || {
        todos: [],
        completed: [],
        settings: null,
        user: LOCAL_DEFAULT_USER,
        membership: LOCAL_DEFAULT_MEMBERSHIP
    };
    const save = () => writeLocalSnapshot(snapshot);

    return {
        kind: 'local',
        async bootstrap() {
            return { userId: 'local', ...snapshot };
        },
        todos: {
            async create(todo) {
                snapshot.todos.unshift({ ...todo });
                save();
            },
            async update(todo) {
                const index = snapshot.todos.findIndex((item) => item.id === todo.id);
                if (index >= 0) snapshot.todos[index] = { ...todo };
                save();
            },
            async complete(id, completedAt) {
                const index = snapshot.todos.findIndex((item) => item.id === id);
                if (index < 0) return;
                const [todo] = snapshot.todos.splice(index, 1);
                snapshot.completed.unshift({ ...todo, completedAt: completedAt ?? Date.now() });
                save();
            },
            async restore(id) {
                const index = snapshot.completed.findIndex((item) => item.id === id);
                if (index < 0) return;
                const [todo] = snapshot.completed.splice(index, 1);
                // 与桌面端一致：恢复时清除到期/提醒/完成标记
                const { dueAt, remindedAt, completedAt, ...rest } = todo;
                snapshot.todos.unshift(rest);
                save();
            },
            async remove(id) {
                snapshot.todos = snapshot.todos.filter((item) => item.id !== id);
                snapshot.completed = snapshot.completed.filter((item) => item.id !== id);
                save();
            },
            async reorder(orderedIds) {
                const byId = new Map(snapshot.todos.map((todo) => [todo.id, todo]));
                snapshot.todos = (orderedIds || []).map((id) => byId.get(id)).filter(Boolean);
                save();
            },
            async bulkReplace(payload) {
                snapshot.todos = (payload?.todos || []).filter((todo) => todo?.id);
                snapshot.completed = (payload?.completed || []).filter((todo) => todo?.id);
                save();
            }
        },
        async clearExpiredCompleted(beforeTs) {
            const cutoff = Number.isFinite(beforeTs) ? beforeTs : Date.now();
            const kept = snapshot.completed.filter((todo) => todo.completedAt && todo.completedAt >= cutoff);
            const removed = snapshot.completed.length - kept.length;
            snapshot.completed = kept;
            save();
            return { removed };
        },
        async saveSettings(settings) {
            snapshot.settings = settings || null;
            save();
        }
    };
}

function createSqliteBackend(host) {
    if (typeof host?.db?.bootstrap !== 'function') return null;
    const db = host.db;
    return {
        kind: 'sqlite',
        async bootstrap() {
            return db.bootstrap();
        },
        todos: {
            create: (todo) => db.createTodo(todo),
            update: (todo) => db.updateTodo(todo),
            complete: (id, completedAt) => db.completeTodo({ id, completedAt }),
            restore: (id) => db.restoreTodo({ id }),
            remove: (id) => db.deleteTodo({ id }),
            reorder: (orderedIds) => db.reorderTodos(orderedIds),
            bulkReplace: (payload) => db.bulkReplaceTodos(payload)
        },
        clearExpiredCompleted: (beforeTs) => db.clearExpiredCompleted({ beforeTs }),
        saveSettings: (settings) => db.saveSettings(settings)
    };
}

export function createRepositories(host = typeof window !== 'undefined' ? window.sidebarHost || null : null) {
    const backend = createSqliteBackend(host) || createLocalBackend();
    return backend;
}
