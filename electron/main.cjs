// 极简待办 Electron 桌面客户端主进程
// 形态：透明无边框窗口贴边停靠，仅显示 36px 侧边条，
// 点击展开为面板（todo-sidebar:layout 通道驱动尺寸/位置），失焦自动收回
const {
    app,
    BrowserWindow,
    ipcMain,
    screen,
    Notification,
    Tray,
    Menu,
    nativeImage,
    powerMonitor,
    dialog,
    shell
} = require('electron');
const path = require('path');
const fs = require('fs');
const database = require('./database.cjs');

const SIDEBAR_COLLAPSED_WIDTH = 36;
const SIDEBAR_COLLAPSED_HEIGHT = 168;
const SIDEBAR_EXPANDED_WIDTH = 544;
const SIDEBAR_EXPANDED_MIN_HEIGHT = 560;
const SIDEBAR_EXPANDED_MAX_HEIGHT = 900;
const SIDEBAR_EXPANDED_TOP_PADDING = 8;
const REMINDER_WINDOW_WIDTH = 300;
const REMINDER_WINDOW_HEIGHT = 336;

let mainWindow = null;
let reminderWindow = null;
let tray = null;
let lastReminderPayload = null;

// 纯界面小工具无需 GPU，关掉硬件加速：
// 1) 不再创建 GPU 磁盘缓存，多实例瞬间抢缓存目录的「拒绝访问(0x5)」报错随之消失
// 2) 透明窗口在一些机器上的渲染怪病也更稳
app.disableHardwareAcceleration();
// 第二实例启动即退出，但仍会初始化磁盘缓存与运行中实例抢锁刷报错，直接禁用相关缓存
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');
// 贴边小窗 + 透明置顶窗会被 Chromium 的原生窗口遮挡检测误判为「被遮挡」，
// 触发 rAF/重绘节流：展开动画卡在半路、悬浮高亮残影不重绘，必须关掉
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// 单实例锁放最前：第二个实例拿到锁失败后立刻退出，避免与运行中的实例抢数据/缓存
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    console.log('极简待办已在运行，已聚焦已有窗口。');
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// Windows 通知必须设置 AppUserModelId，否则 Notification 静默失效
app.setAppUserModelId('com.handsometaoa.minimal-todo');

function findDisplay(displayId) {
    if (displayId != null) {
        const hit = screen.getAllDisplays().find((d) => String(d.id) === String(displayId));
        if (hit) return hit;
    }
    return screen.getPrimaryDisplay();
}

// 贴边布局算法：侧别（left/right）× 展开态（收起 36px / 展开面板）决定窗口 bounds
function computeBounds(payload = {}) {
    const display = findDisplay(payload.displayId);
    const workArea = display.workArea || display.bounds;
    const side = payload.side === 'left' ? 'left' : 'right';
    const expanded = Boolean(payload.expanded);

    const width = expanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH;
    const height = expanded
        ? Math.max(SIDEBAR_EXPANDED_MIN_HEIGHT, Math.min(workArea.height - 16, SIDEBAR_EXPANDED_MAX_HEIGHT))
        : SIDEBAR_COLLAPSED_HEIGHT;
    const x = side === 'left' ? workArea.x : workArea.x + workArea.width - width;
    const y = expanded
        ? workArea.y + Math.max(SIDEBAR_EXPANDED_TOP_PADDING, Math.round((workArea.height - height) / 2))
        : workArea.y + Math.round((workArea.height - height) / 2);

    return { x, y, width, height };
}

// Windows 对 ShowWindow 会播放约 200ms 的淡入+缩放打开动画，落在 36px 侧边条上像「抖一下」。
// 规避：先 park 到屏幕外位置显示，让动画在屏幕外空放，
// 动画结束后再移回贴边位置——移动已显示的窗口不触发系统动画，侧边条瞬间到位。
// park 位置由 pickSidebarParkBounds 选择，需紧贴目标显示器以保证 DPI 换算正确。
// 不能用 setOpacity(0→1)：transparent 窗口恢复不透明在 DWM 层不生效，窗口会一直隐身。
const SIDEBAR_OPEN_ANIMATION_MS = 320;
let sidebarParkTimer = null;
// 最近一次布局意图（displayId/side/expanded）。窗口 bounds 可能被系统挪动或因
// 工作区变化而过期，显示/重锚时必须按这份意图重新计算，而不是沿用 getBounds()
let lastSidebarLayout = null;
function cancelSidebarParkRestore() {
    if (sidebarParkTimer) {
        clearTimeout(sidebarParkTimer);
        sidebarParkTimer = null;
    }
}
// park 位置要求：a) 不与任何显示器相交（打开动画在屏外空放不被看到）；
// b) 紧贴目标显示器外侧——屏外窗口的 DPI 按「最近显示器」解析，park 在别的
// 缩放比的显示器旁会让还原 setBounds 按错误 scaleFactor 换算，落点整体偏移
// 几十到几百像素（侧边条「漂移几厘米」的多屏混合缩放场景）
function pickSidebarParkBounds(targetBounds, displayId) {
    const displays = screen.getAllDisplays();
    const intersectsAny = (rect) =>
        displays.some((d) => {
            const b = d.bounds;
            return (
                rect.x < b.x + b.width &&
                rect.x + rect.width > b.x &&
                rect.y < b.y + b.height &&
                rect.y + rect.height > b.y
            );
        });
    const display = findDisplay(displayId);
    const db = display.bounds;
    const candidates = [
        { ...targetBounds, x: db.x + db.width + 100 },
        { ...targetBounds, x: db.x - 100 - targetBounds.width },
        { ...targetBounds, x: db.x + 8, y: db.y + db.height + 100 },
        { ...targetBounds, x: db.x + 8, y: db.y - 100 - targetBounds.height }
    ];
    const hit = candidates.find((rect) => !intersectsAny(rect));
    if (hit) return hit;
    // 兜底：四侧都被邻居占据（少见的多屏环绕布局），退回 union 最右侧之外
    const virtualRight = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
    return { ...targetBounds, x: virtualRight + 100 };
}
function showSidebarWindow({ inactive = false } = {}) {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
    cancelSidebarParkRestore();
    // 还原目标按布局意图重新计算：隐藏/运行期间任务栏、缩放、睡眠唤醒都可能
    // 让 getBounds() 里的旧位置失效，沿用会把漂移带回屏幕
    const layout = lastSidebarLayout || {};
    const target = computeBounds(layout);
    mainWindow.setBounds(pickSidebarParkBounds(target, layout.displayId), false);
    if (inactive) mainWindow.showInactive();
    else mainWindow.show();
    sidebarParkTimer = setTimeout(() => {
        sidebarParkTimer = null;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBounds(computeBounds(layout), false);
    }, SIDEBAR_OPEN_ANIMATION_MS);
}

function applySidebarLayout(payload) {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const normalized = {
        displayId: payload && payload.displayId != null ? String(payload.displayId) : undefined,
        side: payload && payload.side === 'left' ? 'left' : 'right',
        expanded: Boolean(payload && payload.expanded)
    };
    try {
        lastSidebarLayout = normalized;
        mainWindow.setBounds(computeBounds(normalized), false);
        // 窗口已被移到真实位置，park 恢复定时器若再触发会用旧收起态 bounds 覆盖
        cancelSidebarParkRestore();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        showSidebarWindow();
        return true;
    } catch (error) {
        console.error('Failed to apply sidebar layout:', error);
        return false;
    }
}

// 显示器拓扑/工作区变化、睡眠唤醒后系统可能把贴边窗留在过期位置；按布局意图
// 重锚。只调整 bounds 不强制显示：用户主动托盘隐藏的状态保持隐藏
let reanchorTimer = null;
function reanchorSidebarBounds() {
    if (!mainWindow || mainWindow.isDestroyed() || !lastSidebarLayout) return;
    try {
        mainWindow.setBounds(computeBounds(lastSidebarLayout), false);
    } catch (error) {
        console.error('Failed to reanchor sidebar bounds:', error);
    }
}
function scheduleReanchor() {
    if (reanchorTimer) clearTimeout(reanchorTimer);
    // display-metrics-changed 在缩放/分辨率调整中会连发多次，防抖到稳定后执行
    reanchorTimer = setTimeout(() => {
        reanchorTimer = null;
        reanchorSidebarBounds();
    }, 300);
}
function registerSidebarReanchor() {
    screen.on('display-metrics-changed', scheduleReanchor);
    screen.on('display-added', scheduleReanchor);
    screen.on('display-removed', scheduleReanchor);
    powerMonitor.on('resume', scheduleReanchor);
    powerMonitor.on('unlock-screen', scheduleReanchor);
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: SIDEBAR_COLLAPSED_WIDTH,
        height: SIDEBAR_COLLAPSED_HEIGHT,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        movable: true,
        skipTaskbar: true,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        thickFrame: false,
        fullscreenable: false,
        roundedCorners: false,
        closable: true,
        title: '极简待办',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            // 失焦时悬浮态、动画仍需即时重绘，不节流后台渲染
            backgroundThrottling: false
        }
    });
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
        // 仅透传渲染层的警告/错误，避免刷屏
        if (level >= 2) console.log(`[renderer] ${message} (${sourceId}:${line})`);
    });
    mainWindow.loadFile(path.join(__dirname, '..', 'public', 'sidebar.html'), {
        query: { mode: 'sidebar' }
    });
    mainWindow.once('ready-to-show', () => {
        // 启动即恢复上次保存的停靠位置（显示器 + 左右侧）；无保存记录时贴右缘
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const dock = database.getDeviceSettings().dock || {};
        const ok = applySidebarLayout({
            displayId: dock.displayId,
            side: dock.side === 'left' ? 'left' : 'right',
            expanded: false
        });
        console.log(`[layout] ready-to-show applied=${ok} dock=`, dock, 'bounds=', mainWindow.getBounds());
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function ensureReminderWindow({ recreate = false } = {}) {
    if (reminderWindow && !reminderWindow.isDestroyed()) {
        if (!recreate) return reminderWindow;
        reminderWindow.destroy();
        reminderWindow = null;
    }
    reminderWindow = new BrowserWindow({
        width: REMINDER_WINDOW_WIDTH,
        height: REMINDER_WINDOW_HEIGHT,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        // thickFrame:false 必须保持：透明无边框窗若以默认 thickFrame 创建，部分机器/缩放比下
        // 整窗点击穿透（「看得见、点不动」）。thickFrame:false 下 resizable:false 与主窗口
        // 标志一致，不触发该缺陷，同时禁止拖拽调整提醒窗大小
        thickFrame: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: false,
        roundedCorners: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            // 提醒窗 focusable:false 永远处于「后台」，不关节流会延迟列表绘制
            backgroundThrottling: false
        }
    });
    reminderWindow.loadFile(path.join(__dirname, '..', 'public', 'reminder.html'), {
        query: { mode: 'reminder' }
    });
    reminderWindow.on('closed', () => {
        reminderWindow = null;
    });
    return reminderWindow;
}

function positionReminderWindow() {
    if (!reminderWindow || reminderWindow.isDestroyed()) return;
    const { workArea } = screen.getPrimaryDisplay();
    // 左上角停靠，距边缘 12px
    reminderWindow.setBounds({
        x: workArea.x + 12,
        y: workArea.y + 12,
        width: REMINDER_WINDOW_WIDTH,
        height: REMINDER_WINDOW_HEIGHT
    });
}

function hideReminderWindow() {
    try {
        if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.hide();
    } catch (error) {
        console.error('Failed to hide reminder window:', error);
    }
}

function showReminderWindow(payload, { forceSend = false } = {}) {
    // 隐藏态弹出时重建窗口：透明无边框窗的 HWND 若在跨屏/缩放变化后复用，
    // 输入区域可能与显示内容错位（看得见点不着）；全新创建可绕开该类问题。
    // 可见态收到新数据则原地复用，避免弹窗闪烁
    const recreate = !(reminderWindow && !reminderWindow.isDestroyed() && reminderWindow.isVisible());
    const win = ensureReminderWindow({ recreate });
    positionReminderWindow();
    lastReminderPayload = payload;
    // 页面尚在加载时发送会丢失，由页面的 todo-reminder:ready 握手补发
    if (!win.webContents.isLoading() || forceSend) {
        win.webContents.send('todo-reminder:data', payload);
    }
    if (!win.isVisible()) {
        // 通知类窗口不抢焦点
        if (typeof win.showInactive === 'function') win.showInactive();
        else win.show();
    }
}

function sendToMainWindow(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}

// —— 侧边栏贴边布局（渲染面板展开/收起时驱动）——
ipcMain.on('todo-sidebar:layout', (_event, payload) => {
    if (applySidebarLayout(payload || {})) {
        // 记住停靠位置（显示器 + 左右侧），下次启动直接恢复
        try {
            const current = database.getDeviceSettings().dock || {};
            database.setDeviceSetting('dock', {
                displayId: payload && payload.displayId != null ? String(payload.displayId) : current.displayId,
                side: payload && (payload.side === 'left' || payload.side === 'right') ? payload.side : current.side
            });
        } catch (error) {
            console.error('Failed to persist dock config:', error);
        }
    }
});

// —— 提醒链路 ——
ipcMain.on('todo-reminder:show', (_event, payload) => {
    const data =
        payload && typeof payload === 'object' && Array.isArray(payload.list) ? payload : { list: [], theme: null };
    if (data.list.length === 0) {
        hideReminderWindow();
        return;
    }
    showReminderWindow(data);
});

ipcMain.on('todo-reminder:ready', () => {
    // 页面脚本能发出 ready 就说明渲染层已就绪，直接补发；此时 isLoading 仍为 true
    // （脚本执行早于 load 完成），走 showReminderWindow 的默认判断会把补发吞掉，
    // 提醒窗因此永远空白
    if (lastReminderPayload) showReminderWindow(lastReminderPayload, { forceSend: true });
});

ipcMain.on('todo-reminder:empty', () => {
    lastReminderPayload = null;
    hideReminderWindow();
    sendToMainWindow('todo-reminder:empty');
});

ipcMain.on('todo-reminder:dismiss', (_event, id) => {
    sendToMainWindow('todo-reminder:dismiss', id);
    if (reminderWindow && !reminderWindow.isDestroyed()) {
        reminderWindow.webContents.send('todo-reminder:dismissed', id);
    }
});

// —— 屏幕枚举（设置页「目标屏幕」与贴边布局使用）——
function normalizeDisplay(display, primaryId, index) {
    return {
        id: String(display.id),
        label: `显示器 ${index}`,
        isPrimary: String(display.id) === String(primaryId),
        bounds: { ...display.bounds },
        workArea: { ...display.workArea }
    };
}

function getDisplaySnapshot() {
    const primary = screen.getPrimaryDisplay();
    const displays = screen.getAllDisplays().map((display, index) => normalizeDisplay(display, primary.id, index + 1));
    return {
        displays,
        primary: displays.find((display) => display.isPrimary) || displays[0]
    };
}

ipcMain.on('host:get-displays', (event) => {
    event.returnValue = getDisplaySnapshot().displays;
});

ipcMain.on('host:get-primary-display', (event) => {
    event.returnValue = getDisplaySnapshot().primary;
});

// —— 本地数据库（SQLite，userData/app-data/minimal-todo.db，schema 与 DAO 见 database.cjs）——
function registerDatabaseIpc() {
    ipcMain.handle('app-data:bootstrap', () => database.bootstrapSnapshot());
    ipcMain.handle('todos:create', (_e, todo) => {
        database.createTodo(database.currentUserId(), todo || {});
        return { ok: true };
    });
    ipcMain.handle('todos:update', (_e, todo) => {
        database.updateTodo(database.currentUserId(), todo || {});
        return { ok: true };
    });
    ipcMain.handle('todos:complete', (_e, { id, completedAt } = {}) => {
        database.completeTodo(database.currentUserId(), id, completedAt);
        return { ok: true };
    });
    ipcMain.handle('todos:restore', (_e, { id } = {}) => {
        database.restoreTodo(database.currentUserId(), id);
        return { ok: true };
    });
    ipcMain.handle('todos:delete', (_e, { id } = {}) => {
        database.deleteTodo(database.currentUserId(), id);
        return { ok: true };
    });
    ipcMain.handle('todos:reorder', (_e, orderedIds) => {
        database.reorderTodos(database.currentUserId(), orderedIds);
        return { ok: true };
    });
    ipcMain.handle('todos:bulk-replace', (_e, payload) => {
        database.replaceAllTodos(database.currentUserId(), payload || {});
        return { ok: true };
    });
    ipcMain.handle('completed:clear-expired', (_e, { beforeTs } = {}) => {
        const removed = database.clearExpiredCompleted(database.currentUserId(), beforeTs);
        return { ok: true, removed };
    });
    ipcMain.handle('settings:set', (_e, settings) => {
        database.saveSettings(database.currentUserId(), settings || {});
        return { ok: true };
    });
    ipcMain.handle('user:update-profile', (_e, patch) => {
        return database.updateUserProfile(database.currentUserId(), patch || {});
    });
    ipcMain.handle('device:get', () => {
        return database.getDeviceSettings();
    });
    ipcMain.handle('device:set', (_e, { key, value } = {}) => {
        database.setDeviceSetting(key, value);
        return { ok: true };
    });
}

// 数据库初始化失败直接弹窗退出：静默降级会导致待办数据「看起来在保存、实际丢失」
function initDatabase() {
    try {
        database.open(app.getPath('userData'));
        registerDatabaseIpc();
    } catch (error) {
        console.error('Failed to initialize database:', error);
        dialog.showErrorBox('极简待办', `本地数据库初始化失败，应用即将退出：\n${error.message}`);
        app.exit(1);
    }
}

// —— 开机自启（Electron 登录项 API：Windows 写注册表 Run 键，macOS 写登录项）——
// 开发态直接跑 electron.exe 时需显式带应用路径；打包后的 exe 自带应用无需参数。
// get 与 set 必须使用同一组 path/args，否则 Windows 下注册表比对不匹配会误报 openAtLogin=false
const AUTO_LAUNCH_ARGS = process.defaultApp ? [path.resolve(process.argv[1] || '.')] : [];

ipcMain.handle('app:get-auto-launch', () => {
    return app.getLoginItemSettings({ path: process.execPath, args: AUTO_LAUNCH_ARGS }).openAtLogin;
});

ipcMain.handle('app:set-auto-launch', (_event, enabled) => {
    app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        path: process.execPath,
        args: AUTO_LAUNCH_ARGS
    });
    // 返回写入后的实际状态，供渲染层校正开关
    return app.getLoginItemSettings({ path: process.execPath, args: AUTO_LAUNCH_ARGS }).openAtLogin;
});

// —— 宿主能力 ——
ipcMain.on('app:quit', () => {
    app.quit();
});

ipcMain.on('host:notify', (_event, { title, body } = {}) => {
    if (Notification.isSupported() && title) {
        new Notification({ title, body: body || '' }).show();
    }
});

// —— 应用信息 / 外部链接（渲染层「关于」弹窗使用）——
ipcMain.on('app:get-version', (event) => {
    event.returnValue = app.getVersion();
});

ipcMain.handle('host:open-external', (_event, rawUrl) => {
    try {
        const url = new URL(String(rawUrl || ''));
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
        shell.openExternal(url.toString());
        return true;
    } catch (error) {
        console.error('Failed to open external url:', error);
        return false;
    }
});

// 导出数据：弹原生保存对话框让用户自选位置，默认下载目录 + 带时间戳的文件名
ipcMain.handle('host:export-file', async (_event, { fileName, content } = {}) => {
    try {
        const safeName = path.basename(String(fileName || 'export.json').trim()).replace(/[/:*?"<>|]/g, '_');
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: '导出待办数据',
            defaultPath: path.join(app.getPath('downloads'), safeName),
            filters: [
                { name: 'JSON 数据文件', extensions: ['json'] },
                { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['createDirectory', 'showOverwriteConfirmation']
        });
        if (canceled || !filePath) return { ok: false, canceled: true };
        fs.writeFileSync(filePath, content, 'utf-8');
        const stats = fs.statSync(filePath);
        return { ok: true, path: filePath, bytes: stats.size };
    } catch (error) {
        console.error('Failed to export file:', error);
        return { ok: false, error: String((error && error.message) || error) };
    }
});

// —— 托盘图标（Windows 通知区右下角常驻入口）——
// 左键：显示/隐藏侧边条；右键：菜单（显示/隐藏、重启、退出）
// 注意：Windows 新应用的托盘图标默认收在通知区「^」展开里，可手动拖到常驻区
function restartApp() {
    app.relaunch();
    // app.exit 不触发 window-all-closed 的 database.close()，先手动关库再退出
    try {
        database.close();
    } catch (error) {
        console.error('Failed to close database before restart:', error);
    }
    app.exit(0);
}

function createTray() {
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'public', 'logo.png'));
    tray = new Tray(icon);
    tray.setToolTip('极简待办');
    const toggleMainWindow = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else showSidebarWindow({ inactive: true });
    };
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: '显示 / 隐藏侧边条', click: toggleMainWindow },
            { type: 'separator' },
            { label: '重新启动', click: restartApp },
            { label: '退出极简待办', click: () => app.quit() }
        ])
    );
    tray.on('click', toggleMainWindow);
}

app.whenReady().then(() => {
    // 未拿到单实例锁的实例即将退出，不初始化数据库与窗口
    if (!gotSingleInstanceLock) return;
    initDatabase();
    createMainWindow();
    createTray();
    registerSidebarReanchor();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
});

app.on('window-all-closed', () => {
    database.close();
    app.quit();
});
