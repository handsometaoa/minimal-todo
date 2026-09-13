// 数据访问层：所有持久化经由 storage 仓库接口（主进程 SQLite / 浏览器兜底），见 docs/storage-api.md
import { getRepositories } from './storage/index.js';

export const SIDEBAR_LOCAL_SETTINGS_KEY = 'todo/sidebar-local-settings';
export const UI_LOCAL_SETTINGS_KEY = 'todo/ui-local-settings';
export const WINDOW_DOCK_SETTINGS_LOCKED = false;

export const WINDOW_LAYOUT = {
    collapsed: { width: 36, height: 168 },
    expanded: { width: 544, minHeight: 560, maxHeight: 900, topPadding: 8 }
};

export const SIDES = ['left', 'right'];
export const VIEWS = ['active', 'completed', 'settings', 'profile'];
export const COMPLETED_FILTERS = ['all', 'week'];
export const TODO_FILTERS = ['all', 'overdue', 'today', 'tomorrow', 'week'];
export const DEFAULT_DUE_PRESETS = { today: '18:00', tomorrow: '09:00', dayafter: '09:00', nextweek: '09:00' };
// 快捷芯片的 4 个槽位：每项可自选对应哪一天（今天/明天/后天/下周一）+ 提醒时间
export const DUE_PRESET_KINDS = ['today', 'tomorrow', 'dayafter', 'nextweek'];
export const DEFAULT_DUE_PRESET_SLOTS = DUE_PRESET_KINDS.map((kind) => ({ kind, time: DEFAULT_DUE_PRESETS[kind] }));

export function normalizePresetTimeText(value, fallback) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return fallback;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return fallback;
    return `${String(h).padStart(2, '0')}:${match[2]}`;
}

export function splitPresetTime(text, fallback = '09:00') {
    const normalized = normalizePresetTimeText(text, fallback);
    const [h, m] = normalized.split(':').map(Number);
    return { h, m };
}

// 未完成待办的到期筛选：过期=已过期；今天/明天/本周按日期区间划分，区间内已过期也算
export function filterTodosByDue(todos, todoFilter) {
    if (!todoFilter || todoFilter === 'all') return todos;
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const todayStart = startOfToday.getTime();
    const nowTs = now.getTime();
    const tomorrowStart = todayStart + 86400000;
    const dayAfterTomorrow = tomorrowStart + 86400000;
    const weekStart = getWeekStart(now).getTime();
    const nextWeekStart = weekStart + 7 * 86400000;
    if (todoFilter === 'overdue') {
        return todos.filter((todo) => Number.isFinite(todo?.dueAt) && todo.dueAt <= nowTs);
    }
    if (todoFilter === 'today') {
        return todos.filter(
            (todo) => Number.isFinite(todo?.dueAt) && todo.dueAt >= todayStart && todo.dueAt < tomorrowStart
        );
    }
    if (todoFilter === 'tomorrow') {
        return todos.filter(
            (todo) => Number.isFinite(todo?.dueAt) && todo.dueAt >= tomorrowStart && todo.dueAt < dayAfterTomorrow
        );
    }
    if (todoFilter === 'week') {
        return todos.filter(
            (todo) => Number.isFinite(todo?.dueAt) && todo.dueAt >= weekStart && todo.dueAt < nextWeekStart
        );
    }
    return todos;
}
export const THEME_MODES = ['preset', 'custom'];
export const APPEARANCE_MODES = ['system', 'light', 'dark'];
export const host = window.sidebarHost || null;

// Electron 桌面客户端模式（sidebar.html?mode=desktop）
export function isDesktopMode() {
    try {
        return new URLSearchParams(window.location.search).get('mode') === 'desktop';
    } catch (error) {
        return false;
    }
}
// 会员套餐目录：当前购买流程未开放（SVIP 限时体验），保留供后续真实支付接入使用
export const MEMBERSHIP_PLANS = [
    { id: 'permanent', label: '永久使用', priceLabel: '12.9', description: '一次开通，长期可用' },
    { id: 'half_year', label: '6 个月', priceLabel: '3', description: '适合阶段性使用' },
    { id: 'trial_month', label: '1 个月', priceLabel: '1', description: '低门槛体验全部权益' }
];

export const PRESET_THEMES = [
    {
        id: 'graphite',
        label: '系统灰',
        colors: { primary: '#7c8aa5', primaryBright: '#a8b3c7', secondary: '#5f6b7c', accent: '#cfd5df' }
    },
    {
        id: 'violet',
        label: '暮色紫',
        colors: { primary: '#2f6df6', primaryBright: '#6ea8ff', secondary: '#22c7d6', accent: '#67e8b5' }
    },
    {
        id: 'ember',
        label: '暖阳橙',
        colors: { primary: '#ea580c', primaryBright: '#fb923c', secondary: '#f43f5e', accent: '#f59e0b' }
    },
    {
        id: 'mint',
        label: '薄荷青',
        colors: { primary: '#0f766e', primaryBright: '#14b8a6', secondary: '#22c55e', accent: '#84cc16' }
    },
    {
        id: 'ocean',
        label: '深海蓝',
        colors: { primary: '#2563eb', primaryBright: '#60a5fa', secondary: '#06b6d4', accent: '#38bdf8' }
    }
];

export function createId() {
    return `todo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function normalizeHexColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

export function hexToRgb(hex) {
    const safe = normalizeHexColor(hex, '#000000').slice(1);
    return {
        r: Number.parseInt(safe.slice(0, 2), 16),
        g: Number.parseInt(safe.slice(2, 4), 16),
        b: Number.parseInt(safe.slice(4, 6), 16)
    };
}

export function rgbToHex({ r, g, b }) {
    const toHex = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function mixHex(hexA, hexB, ratio) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    const t = clamp(ratio, 0, 1);
    return rgbToHex({
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t
    });
}

export function lightenHex(hex, amount) {
    return mixHex(hex, '#ffffff', amount);
}

export function alphaColor(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function getDefaultSidebarConfig() {
    const primaryDisplay = typeof host?.getPrimaryDisplay === 'function' ? host.getPrimaryDisplay() : null;
    return {
        displayId: primaryDisplay ? String(primaryDisplay.id) : 'primary',
        side: 'right',
        isExpanded: false
    };
}

export function createDefaultData() {
    return { todos: [], completed: [] };
}

export function createDefaultThemeSettings() {
    return {
        duePresets: { ...DEFAULT_DUE_PRESETS },
        appearanceMode: 'system',
        themeMode: 'preset',
        presetThemeId: PRESET_THEMES[0].id,
        customPrimary: PRESET_THEMES[0].colors.primary,
        customSecondary: PRESET_THEMES[0].colors.secondary
    };
}

export function getPresetTheme(themeId) {
    return PRESET_THEMES.find((theme) => theme.id === themeId) || PRESET_THEMES[0];
}

export function normalizeThemeSettings(settings) {
    const defaults = createDefaultThemeSettings();
    const appearanceSettings = settings?.appearance || {};
    const themeSettings = settings?.theme || {};
    return {
        appearanceMode: APPEARANCE_MODES.includes(appearanceSettings.mode)
            ? appearanceSettings.mode
            : APPEARANCE_MODES.includes(settings?.appearanceMode)
              ? settings.appearanceMode
              : defaults.appearanceMode,
        themeMode: THEME_MODES.includes(themeSettings.mode)
            ? themeSettings.mode
            : THEME_MODES.includes(settings?.themeMode)
              ? settings.themeMode
              : defaults.themeMode,
        presetThemeId: getPresetTheme(themeSettings.presetThemeId || settings?.presetThemeId).id,
        customPrimary: normalizeHexColor(
            themeSettings.customPrimary || settings?.customPrimary,
            defaults.customPrimary
        ),
        customSecondary: normalizeHexColor(
            themeSettings.customSecondary || settings?.customSecondary,
            defaults.customSecondary
        ),
        duePresets: deriveDuePresets(normalizeDueSlots(settings, defaults)),
        dueSlots: normalizeDueSlots(settings, defaults)
    };
}

// 快捷芯片槽位：4 项，每项 = { kind: 今天/明天/后天/下周一, time: HH:mm }
// 旧数据只有按 kind 的 duePresets 映射，按默认顺序迁移成槽位
function normalizeDueSlots(settings, defaults) {
    const rawSlots = Array.isArray(settings?.dueSlots) ? settings.dueSlots : [];
    return DUE_PRESET_KINDS.map((defaultKind, index) => {
        const raw = rawSlots[index] || {};
        const kind = DUE_PRESET_KINDS.includes(raw.kind) ? raw.kind : defaultKind;
        const fallback =
            normalizePresetTimeText(settings?.duePresets?.[kind], defaults.duePresets[kind]) ||
            DEFAULT_DUE_PRESETS[kind];
        return { kind, time: normalizePresetTimeText(raw.time, fallback) };
    });
}

// 由槽位推导按 kind 的时间映射（同一 kind 出现多次时取第一个），保持旧字段与槽位一致
function deriveDuePresets(slots) {
    const presets = {};
    slots.forEach(({ kind, time }) => {
        if (!(kind in presets)) presets[kind] = time;
    });
    return { ...DEFAULT_DUE_PRESETS, ...presets };
}

// 由槽位推导按 kind 的时间映射（同一 kind 出现多次时取第一个），供旧调用与兼容存储使用
export function getDuePresetSlots(settings) {
    const slots = settings?.dueSlots;
    return Array.isArray(slots) && slots.length === DUE_PRESET_KINDS.length
        ? slots
        : normalizeDueSlots(settings, createDefaultThemeSettings());
}

export function serializeThemeSettings(settings) {
    const normalized = normalizeThemeSettings(settings);
    return {
        appearance: {
            mode: normalized.appearanceMode
        },
        theme: {
            mode: normalized.themeMode,
            presetThemeId: normalized.presetThemeId,
            customPrimary: normalized.customPrimary,
            customSecondary: normalized.customSecondary
        },
        duePresets: normalized.duePresets,
        dueSlots: normalized.dueSlots
    };
}

export function getSystemAppearance() {
    try {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
        return 'dark';
    }
}

export function resolveAppearanceMode(settings) {
    const normalized = normalizeThemeSettings(settings);
    return normalized.appearanceMode === 'system' ? getSystemAppearance() : normalized.appearanceMode;
}

export function buildThemeColors(settings) {
    const normalized = normalizeThemeSettings(settings);
    if (normalized.themeMode === 'preset') return getPresetTheme(normalized.presetThemeId).colors;
    return {
        primary: normalized.customPrimary,
        primaryBright: lightenHex(normalized.customPrimary, 0.22),
        secondary: normalized.customSecondary,
        accent: lightenHex(normalized.customSecondary, 0.12)
    };
}

export function normalizeUserProfile(user) {
    const nickname =
        typeof user?.nickname === 'string' && user.nickname.trim()
            ? user.nickname.trim()
            : typeof user?.name === 'string' && user.name.trim()
              ? user.name.trim()
              : '本地用户';
    const avatar =
        typeof user?.avatar === 'string' && user.avatar.trim()
            ? user.avatar.trim()
            : typeof user?.avatarUrl === 'string' && user.avatarUrl.trim()
              ? user.avatarUrl.trim()
              : '';
    return { nickname, avatar, available: Boolean(user), raw: user || null };
}

export function normalizeMembershipStatus(rawStatus) {
    const isFutureExpiry = (value) => {
        if (typeof value !== 'string' || !value.trim()) return false;
        const normalized = value.trim().replace(' ', 'T');
        const timestamp = Date.parse(normalized);
        return Number.isFinite(timestamp) && timestamp > Date.now();
    };

    if (rawStatus && typeof rawStatus === 'object' && 'active' in rawStatus) {
        const expiresAt = typeof rawStatus.expiresAt === 'string' ? rawStatus.expiresAt : '';
        const isPermanent = Boolean(rawStatus.isPermanent);
        return {
            active: isPermanent ? true : Boolean(rawStatus.active) && (!expiresAt || isFutureExpiry(expiresAt)),
            isPermanent,
            expiresAt,
            planId: typeof rawStatus.planId === 'string' ? rawStatus.planId : ''
        };
    }
    // 字符串形式：直接作为到期时间判定（数据导入等场景）
    const hasExpiry = typeof rawStatus === 'string' && rawStatus.trim();
    return {
        active: rawStatus === true || isFutureExpiry(hasExpiry ? rawStatus : ''),
        isPermanent: rawStatus === true,
        expiresAt: hasExpiry ? rawStatus.trim() : '',
        planId: ''
    };
}

export function hasMembershipAccess() {
    return Boolean(state.data.membership?.active);
}

export function normalizeSidebarConfig(sidebar) {
    const defaults = getDefaultSidebarConfig();
    return {
        displayId: sidebar?.displayId != null ? String(sidebar.displayId) : defaults.displayId,
        side: SIDES.includes(sidebar?.side) ? sidebar.side : defaults.side,
        isExpanded: Boolean(sidebar?.isExpanded)
    };
}

function sanitizeTodo(todo) {
    if (!todo || typeof todo !== 'object' || !todo.id) return null;
    const clean = { ...todo };
    if (!Number.isFinite(clean.dueAt)) delete clean.dueAt;
    return clean;
}

export function normalizeData(data) {
    if (!data || typeof data !== 'object') return createDefaultData();
    return {
        todos: (Array.isArray(data.todos) ? data.todos : []).map(sanitizeTodo).filter(Boolean),
        completed: (Array.isArray(data.completed) ? data.completed : []).map(sanitizeTodo).filter(Boolean)
    };
}

export function normalizeLocalUiState(uiState) {
    return {
        currentView: VIEWS.includes(uiState?.currentView) ? uiState.currentView : 'active',
        completedFilter: COMPLETED_FILTERS.includes(uiState?.completedFilter) ? uiState.completedFilter : 'all',
        todoFilter: TODO_FILTERS.includes(uiState?.todoFilter) ? uiState.todoFilter : 'all'
    };
}

export const state = {
    data: {
        todos: [],
        completed: [],
        sidebar: getDefaultSidebarConfig(),
        user: normalizeUserProfile(null),
        // 初始值与默认会员策略一致（SVIP 限时体验），init 时由用户接口加载真实状态覆盖
        membership: normalizeMembershipStatus({
            active: true,
            isPermanent: false,
            expiresAt: '',
            planId: 'trial_month'
        }),
        settings: createDefaultThemeSettings()
    },
    ui: {
        isPanelOpen: false,
        currentView: 'active',
        isFeatureMenuOpen: false,
        completedFilter: 'all',
        todoFilter: 'all',
        isConfirmDialogOpen: false,
        isAboutDialogOpen: false,
        ignoreBlurUntil: 0,
        editingTodoId: null,
        editingTodoDraft: '',
        skipEditCommitOnce: false,
        dueDraft: null,
        dueDraftVisible: false,
        editingDueId: null,
        editingDueDraft: null,
        pendingReminders: []
    }
};

export const sortState = {
    draggingTodoId: null,
    startX: 0,
    startY: 0,
    isDragging: false,
    sourceIndex: -1,
    itemEl: null,
    handleEl: null,
    indicatorEl: null,
    cleanupListeners: null
};

export const elements = {
    root: document.documentElement,
    appShell: document.getElementById('appShell'),
    edgeStrip: document.getElementById('edgeStrip'),
    stripBadge: document.getElementById('stripBadge'),
    panelStage: document.getElementById('panelStage'),
    panelOverlay: document.getElementById('panelOverlay'),
    panelTitle: document.getElementById('panelTitle'),
    headerCount: document.getElementById('headerCount'),
    featureButton: document.getElementById('featureButton'),
    featureMenu: document.getElementById('featureMenu'),
    exitAppButton: document.getElementById('exitAppButton'),
    addTodoInput: document.getElementById('addTodoInput'),
    addTodoBtn: document.getElementById('addTodoBtn'),
    dueToggleBtn: document.getElementById('dueToggleBtn'),
    dueRow: document.getElementById('dueRow'),
    dueDateInput: document.getElementById('dueDateInput'),
    dueTimeInput: document.getElementById('dueTimeInput'),
    dueClearBtn: document.getElementById('dueClearBtn'),
    dueAddBtn: document.getElementById('dueAddBtn'),
    dueSlotDaySelects: Array.from(document.querySelectorAll('[data-due-slot-day]')),
    dueSlotTimeInputs: Array.from(document.querySelectorAll('[data-due-slot-time]')),
    activeCount: document.getElementById('activeCount'),
    todoFilterChips: Array.from(document.querySelectorAll('[data-todo-filter]')),
    todoList: document.getElementById('todoList'),
    activeEmptyTitle: document.getElementById('activeEmptyTitle'),
    activeEmptyText: document.getElementById('activeEmptyText'),
    duePopover: document.getElementById('duePopover'),
    duePopoverDate: document.getElementById('duePopoverDate'),
    duePopoverTime: document.getElementById('duePopoverTime'),
    duePopoverDelete: document.getElementById('duePopoverDelete'),
    duePopoverCancel: document.getElementById('duePopoverCancel'),
    duePopoverConfirm: document.getElementById('duePopoverConfirm'),
    activeEmptyState: document.getElementById('activeEmptyState'),
    completedList: document.getElementById('completedList'),
    completedEmptyState: document.getElementById('completedEmptyState'),
    completedEmptyTitle: document.getElementById('completedEmptyTitle'),
    completedEmptyText: document.getElementById('completedEmptyText'),
    toastContainer: document.getElementById('toastContainer'),
    views: Array.from(document.querySelectorAll('[data-view-panel]')),
    featureMenuItems: Array.from(document.querySelectorAll('[data-view-target]')),
    backButtons: Array.from(document.querySelectorAll('[data-back-to]')),
    displaySelect: document.getElementById('displaySelect'),
    sideSelect: document.getElementById('sideSelect'),
    settingsHint: document.getElementById('settingsHint'),
    appearanceModeGroup: document.getElementById('appearanceModeGroup'),
    appearanceModeSelect: document.getElementById('appearanceModeGroup'),
    appearanceModeButtons: Array.from(document.querySelectorAll('[data-appearance-mode]')),
    themeModeSelect: document.getElementById('themeModeSelect'),
    presetThemeField: document.getElementById('presetThemeField'),
    presetThemeSelect: document.getElementById('presetThemeSelect'),
    customThemeFields: document.getElementById('customThemeFields'),
    customPrimaryInput: document.getElementById('customPrimaryInput'),
    customPrimaryText: document.getElementById('customPrimaryText'),
    customSecondaryInput: document.getElementById('customSecondaryInput'),
    customSecondaryText: document.getElementById('customSecondaryText'),
    themeSettingsHint: document.getElementById('themeSettingsHint'),
    themePreview: document.getElementById('themePreview'),
    importDataButton: document.getElementById('importDataButton'),
    importDataInput: document.getElementById('importDataInput'),
    exportDataButton: document.getElementById('exportDataButton'),
    cleanupHistoryButton: document.getElementById('cleanupHistoryButton'),
    confirmDialog: document.getElementById('confirmDialog'),
    confirmDialogBackdrop: document.getElementById('confirmDialogBackdrop'),
    confirmDialogCancel: document.getElementById('confirmDialogCancel'),
    aboutDialog: document.getElementById('aboutDialog'),
    aboutDialogBackdrop: document.getElementById('aboutDialogBackdrop'),
    aboutDialogClose: document.getElementById('aboutDialogClose'),
    aboutVersion: document.getElementById('aboutVersion'),
    aboutGithubLink: document.getElementById('aboutGithubLink'),
    confirmDialogConfirm: document.getElementById('confirmDialogConfirm'),
    profileCard: document.getElementById('profileCard'),
    profileAvatarImage: document.getElementById('profileAvatarImage'),
    profileAvatarFallback: document.getElementById('profileAvatarFallback'),
    profileNickname: document.getElementById('profileNickname'),
    profileVipBadge: document.getElementById('profileVipBadge'),
    profileStatus: document.getElementById('profileStatus'),
    profileHint: document.getElementById('profileHint'),
    membershipStatusText: document.getElementById('membershipStatusText'),
    membershipStatusHint: document.getElementById('membershipStatusHint'),
    membershipPlanList: document.getElementById('membershipPlanList'),
    autoLaunchToggle: document.getElementById('autoLaunchToggle'),
    autoLaunchDesc: document.getElementById('autoLaunchDesc'),
    replayOnboardingButton: document.getElementById('replayOnboardingButton'),
    completedFilterButtons: Array.from(document.querySelectorAll('[data-completed-filter]'))
};

export function getPersistedPayload() {
    return { todos: state.data.todos, completed: state.data.completed };
}

export function getExportPayload(sourceData = null) {
    const normalized = normalizeData(sourceData || getPersistedPayload());
    return {
        app: 'minimal-todo',
        appVersion: typeof host?.getAppVersion === 'function' ? host.getAppVersion() : '',
        exportedAt: Date.now(),
        schemaVersion: 2,
        meta: {
            pendingCount: normalized.todos.length,
            completedCount: normalized.completed.length,
            includesSettings: true
        },
        data: normalized,
        // 主题与快捷提醒时间随包导出：换机导入即可完整还原（设备停靠配置除外）
        settings: serializeThemeSettings(state.data.settings)
    };
}

export function readLocalUiSettings() {
    try {
        const raw = window.localStorage.getItem(UI_LOCAL_SETTINGS_KEY);
        return normalizeLocalUiState(raw ? JSON.parse(raw) : null);
    } catch (error) {
        console.error('加载本地界面设置失败:', error);
        return normalizeLocalUiState(null);
    }
}

export function saveLocalUiSettings() {
    try {
        window.localStorage.setItem(
            UI_LOCAL_SETTINGS_KEY,
            JSON.stringify({
                currentView: state.ui.currentView,
                completedFilter: state.ui.completedFilter,
                todoFilter: state.ui.todoFilter
            })
        );
    } catch (error) {
        console.error('保存本地界面设置失败:', error);
    }
}

export function readLocalSidebarSettings() {
    try {
        const raw = window.localStorage.getItem(SIDEBAR_LOCAL_SETTINGS_KEY);
        return normalizeSidebarConfig(raw ? JSON.parse(raw) : null);
    } catch (error) {
        console.error('加载本地侧边栏设置失败:', error);
        return getDefaultSidebarConfig();
    }
}

export function saveLocalSidebarSettings() {
    try {
        window.localStorage.setItem(
            SIDEBAR_LOCAL_SETTINGS_KEY,
            JSON.stringify({
                displayId: state.data.sidebar.displayId,
                side: state.data.sidebar.side
            })
        );
    } catch (error) {
        console.error('保存本地侧边栏设置失败:', error);
    }
}

let saveErrorHandler = null;

export function setSaveErrorHandler(handler) {
    saveErrorHandler = typeof handler === 'function' ? handler : null;
}

function reportSaveError(message) {
    if (saveErrorHandler) saveErrorHandler(message);
    else console.error(message);
}

// 操作级持久化统一入口：fire-and-forget，失败经错误通道提示（内存状态始终为 UI 事实来源）
export function persist(promise, errorMessage = '数据保存失败，请重试') {
    Promise.resolve(promise).catch((error) => {
        console.error('[persist] 写入失败:', error);
        reportSaveError(errorMessage);
    });
}

// 启动加载：一次拉取全量快照（待办/设置/用户/会员/停靠配置）
export async function bootstrapAppData() {
    const repo = getRepositories();
    let snapshot = null;
    try {
        snapshot = await repo.bootstrap();
    } catch (error) {
        console.error('加载数据失败:', error);
    }
    snapshot = snapshot || {};
    return {
        data: normalizeData({ todos: snapshot.todos, completed: snapshot.completed }),
        settings: normalizeThemeSettings(snapshot.settings),
        user: snapshot.user || null,
        membership: snapshot.membership || null,
        // 桌面端停靠配置（device.dock）：与主进程启动窗口定位同源，见 applyStoredData
        dock: snapshot.dock ?? null
    };
}

export function applyStoredData(storedData, { dock } = {}) {
    state.data.todos = storedData.todos;
    state.data.completed = storedData.completed;
    // 停靠配置以桌面端主进程库为准（启动定位读取的就是同一份 device.dock），
    // 避免渲染层旧 localStorage 值与实际窗口位置分叉；localStorage 仅浏览器兜底环境使用
    state.data.sidebar = host ? normalizeSidebarConfig(dock ?? null) : readLocalSidebarSettings();
    const localUiState = readLocalUiSettings();
    state.ui.isPanelOpen = false;
    state.ui.currentView = localUiState.currentView;
    state.ui.isFeatureMenuOpen = false;
    state.ui.completedFilter = localUiState.completedFilter;
    state.ui.todoFilter = localUiState.todoFilter;
    state.ui.editingTodoId = null;
    state.ui.editingTodoDraft = '';
    state.ui.skipEditCommitOnce = false;
    state.ui.dueDraft = null;
    state.ui.dueDraftVisible = false;
    state.ui.editingDueId = null;
    state.ui.editingDueDraft = null;
    state.ui.pendingReminders = [];
}

export function applyThemeSettings(settings) {
    state.data.settings = normalizeThemeSettings(settings);
    const colors = buildThemeColors(state.data.settings);
    const appearance = resolveAppearanceMode(state.data.settings);
    elements.root.dataset.appearanceMode = state.data.settings.appearanceMode;
    elements.root.dataset.appearance = appearance;
    elements.root.style.setProperty('--primary', colors.primary);
    elements.root.style.setProperty('--primary-bright', colors.primaryBright);
    elements.root.style.setProperty('--secondary', colors.secondary);
    elements.root.style.setProperty('--accent', colors.accent);
    elements.root.style.setProperty('--primary-soft', alphaColor(colors.primary, 0.18));
    elements.root.style.setProperty('--primary-strong', alphaColor(colors.primary, 0.45));
    elements.root.style.setProperty('--secondary-soft', alphaColor(colors.secondary, 0.18));
    elements.root.style.setProperty('--secondary-strong', alphaColor(colors.secondary, 0.45));
    elements.root.style.setProperty('--accent-soft', alphaColor(colors.accent, 0.18));
    elements.root.style.setProperty('--accent-strong', alphaColor(colors.accent, 0.36));
}

export function persistThemeSettings(nextSettings) {
    const normalized = normalizeThemeSettings(nextSettings);
    applyThemeSettings(normalized);
    persist(getRepositories().saveSettings(serializeThemeSettings(normalized)), '主题设置保存失败，请重试');
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function getWeekStart(date) {
    const copy = new Date(date);
    const day = copy.getDay() || 7;
    copy.setHours(0, 0, 0, 0);
    copy.setDate(copy.getDate() - day + 1);
    return copy;
}

export function isThisWeek(timestamp) {
    const now = new Date();
    const start = getWeekStart(now).getTime();
    const end = start + 7 * 24 * 60 * 60 * 1000;
    return timestamp >= start && timestamp < end;
}

export function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function getCompactTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function formatDueTime(dueAt) {
    const date = new Date(dueAt);
    const pad = (value) => String(value).padStart(2, '0');
    const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const dayOffset = Math.floor((dueAt - startOfToday.getTime()) / 86400000);
    if (dayOffset === 0) return `今天 ${hm}`;
    if (dayOffset === 1) return `明天 ${hm}`;
    if (dayOffset === -1) return `昨天 ${hm}`;
    if (dayOffset > 1 && dayOffset < 7) return `周${'日一二三四五六'[date.getDay()]} ${hm}`;
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`;
}

export function toDateTimeLocalValue(dueAt) {
    const date = new Date(dueAt);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toDateInputValue(dueAt) {
    return toDateTimeLocalValue(dueAt).slice(0, 10);
}

export function toTimeInputValue(dueAt) {
    return toDateTimeLocalValue(dueAt).slice(11, 16);
}

export function computeDuePreset(slot) {
    const kind = DUE_PRESET_KINDS.includes(slot?.kind) ? slot.kind : 'today';
    const { h, m } = splitPresetTime(slot?.time, DEFAULT_DUE_PRESETS[kind] || '09:00');
    const date = new Date();
    if (kind === 'today') {
        date.setHours(h, m, 0, 0);
        if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
        return date.getTime();
    }
    if (kind === 'dayafter') {
        date.setDate(date.getDate() + 2);
        date.setHours(h, m, 0, 0);
        return date.getTime();
    }
    if (kind === 'nextweek') {
        // 下周一：本周已过周一则取下周一，否则取本周一
        const day = date.getDay() || 7;
        date.setDate(date.getDate() + (day === 1 ? 7 : 8 - day));
        date.setHours(h, m, 0, 0);
        return date.getTime();
    }
    date.setDate(date.getDate() + 1);
    date.setHours(h, m, 0, 0);
    return date.getTime();
}

const REMINDER_CHECK_INTERVAL_MS = 30000;
let reminderTimer = null;

function checkDueReminders(onDue) {
    const now = Date.now();
    // remindedAt 持久化在待办上：一条待办只弹一次，改到期时间后重新武装
    // 是否标记由 onDue 的交付结果决定(见 main.js)，交付失败下个周期自动重试
    const dueNow = state.data.todos.filter(
        (todo) => todo?.id && Number.isFinite(todo.dueAt) && todo.dueAt <= now && !todo.remindedAt
    );
    if (dueNow.length > 0) onDue(dueNow);
}

export function startDueReminderLoop(onDue) {
    if (reminderTimer != null || typeof onDue !== 'function') return;
    const check = () => checkDueReminders(onDue);
    check();
    reminderTimer = window.setInterval(check, REMINDER_CHECK_INTERVAL_MS);
}

export function resetDueReminder(todoId) {
    const todo = state.data.todos.find((item) => item?.id === todoId);
    if (todo) delete todo.remindedAt;
}

export function getFallbackMetrics() {
    const screenRef = window.screen || {};
    const area = {
        x: typeof screenRef.availLeft === 'number' ? screenRef.availLeft : 0,
        y: typeof screenRef.availTop === 'number' ? screenRef.availTop : 0,
        width: screenRef.availWidth || window.innerWidth || 1280,
        height: screenRef.availHeight || window.innerHeight || 720
    };
    return { id: 'fallback', label: '当前屏幕', bounds: area, workArea: area, isPrimary: true };
}

export function getDisplayStatus() {
    return typeof host?.getDisplayStatus === 'function' ? host.getDisplayStatus() : 'unavailable';
}

export function getDisplays() {
    if (typeof host?.getDisplays === 'function') {
        const displays = host.getDisplays();
        if (Array.isArray(displays) && displays.length > 0)
            return displays.map((display) => ({ ...display, id: String(display.id) }));
    }
    return [getFallbackMetrics()];
}

export function getSavedDisplay() {
    const displays = getDisplays();
    return displays.find((display) => display.id === state.data.sidebar.displayId) || null;
}

export function getTargetDisplay() {
    const displays = getDisplays();
    const selected = getSavedDisplay();
    if (selected) return selected;
    return displays.find((display) => display.isPrimary) || displays[0];
}

export function resizeWindow(width, height) {
    if (typeof host?.applyLayout === 'function' && host.isSidebarMode?.()) return;
    try {
        if (typeof window.resizeTo === 'function') window.resizeTo(width, height);
    } catch (error) {
        console.warn('调整窗口尺寸失败:', error);
    }
}

export function moveWindow(x, y) {
    if (typeof host?.applyLayout === 'function' && host.isSidebarMode?.()) return;
    try {
        if (typeof window.moveTo === 'function') window.moveTo(x, y);
    } catch (error) {
        console.warn('移动窗口位置失败:', error);
    }
}

export function applyWindowLayout(mode) {
    // 桌面客户端窗口由用户自由调整，不跟随面板状态改尺寸
    if (isDesktopMode()) return;
    if (typeof host?.applyLayout === 'function' && host.isSidebarMode?.()) {
        host.applyLayout({
            displayId: state.data.sidebar.displayId,
            side: state.data.sidebar.side,
            expanded: mode === 'expanded'
        });
        return;
    }

    const display = getTargetDisplay();
    const workArea = display.workArea || display.bounds;
    if (mode === 'collapsed') {
        const { width, height } = WINDOW_LAYOUT.collapsed;
        const x = state.data.sidebar.side === 'left' ? workArea.x : workArea.x + workArea.width - width;
        const y = workArea.y + Math.round((workArea.height - height) / 2);
        resizeWindow(width, height);
        moveWindow(x, y);
        return;
    }

    const width = WINDOW_LAYOUT.expanded.width;
    const height = Math.max(
        WINDOW_LAYOUT.expanded.minHeight,
        Math.min(workArea.height - WINDOW_LAYOUT.expanded.topPadding * 2, WINDOW_LAYOUT.expanded.maxHeight)
    );
    const x = state.data.sidebar.side === 'left' ? workArea.x : workArea.x + workArea.width - width;
    const y = workArea.y + Math.max(WINDOW_LAYOUT.expanded.topPadding, Math.round((workArea.height - height) / 2));
    resizeWindow(width, height);
    moveWindow(x, y);
}
