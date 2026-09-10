// 桌面客户端渲染进程桥：暴露 window.sidebarHost
// 页面代码通过 host = window.sidebarHost 做能力探测，缺失的能力自动走浏览器兜底：
//   - applyLayout → 主进程按贴边算法调整窗口（36px 侧边条 ↔ 展开面板）
const { contextBridge, ipcRenderer } = require('electron');

function isSidebarMode() {
    try {
        return new URLSearchParams(window.location.search).get('mode') === 'sidebar';
    } catch (error) {
        return false;
    }
}

function isDesktopMode() {
    try {
        return new URLSearchParams(window.location.search).get('mode') === 'desktop';
    } catch (error) {
        return false;
    }
}

function isReminderMode() {
    try {
        return new URLSearchParams(window.location.search).get('mode') === 'reminder';
    } catch (error) {
        return false;
    }
}

// 提醒窗页面允许回传的通道
const REMINDER_SEND_CHANNELS = ['todo-reminder:ready', 'todo-reminder:empty', 'todo-reminder:dismiss'];

// 本地数据库通道（主进程 SQLite，见 electron/database.cjs），全部 invoke 异步契约
const DB_HANDLERS = {
    bootstrap: 'app-data:bootstrap',
    createTodo: 'todos:create',
    updateTodo: 'todos:update',
    completeTodo: 'todos:complete',
    restoreTodo: 'todos:restore',
    deleteTodo: 'todos:delete',
    reorderTodos: 'todos:reorder',
    bulkReplaceTodos: 'todos:bulk-replace',
    clearExpiredCompleted: 'completed:clear-expired',
    saveSettings: 'settings:set',
    updateUserProfile: 'user:update-profile',
    getDeviceSettings: 'device:get',
    setDeviceSetting: 'device:set'
};

const dbBridge = Object.fromEntries(
    Object.entries(DB_HANDLERS).map(([name, channel]) => [name, (...args) => ipcRenderer.invoke(channel, ...args)])
);

// 页面级提醒事件的回调注册表。contextIsolation 下 preload 的 window.dispatchEvent
// 只作用于隔离世界，主世界页面收不到事件也读不到 detail（实测到期提醒因此永远空列表），
// 必须经 contextBridge 回调跨世界投递。
const reminderListeners = { data: [], dismissed: [], dismiss: [], empty: [] };
function dispatchReminderEvent(name, detail) {
    reminderListeners[name].forEach((callback) => {
        try {
            callback(detail);
        } catch (error) {
            console.error('reminder listener failed:', error);
        }
    });
}

const sidebarHost = {
    isSidebarMode,
    isDesktopMode,

    // 页面订阅主进程提醒推送；name ∈ data|dismissed|dismiss|empty
    onReminderEvent(name, callback) {
        if (typeof callback !== 'function' || !(name in reminderListeners)) return false;
        reminderListeners[name].push(callback);
        return true;
    },

    // 到期提醒：主窗口 → 主进程
    showDueReminders(list, theme) {
        if (!isSidebarMode()) return false;
        ipcRenderer.send('todo-reminder:show', {
            list: Array.isArray(list) ? list : [],
            theme: theme || null
        });
        return true;
    },

    // reminder.js 页面的通道回传（ready/empty/dismiss）
    sendReminderMessage(channel, data) {
        if (!REMINDER_SEND_CHANNELS.includes(channel)) return false;
        ipcRenderer.send(channel, data == null ? null : data);
        return true;
    },

    notify(title, body) {
        ipcRenderer.send('host:notify', { title, body });
        return true;
    },

    // 应用版本号（关于弹窗展示，同步契约）
    getAppVersion() {
        return ipcRenderer.sendSync('app:get-version');
    },

    // 用系统浏览器打开外部链接（仅限 http/https，主进程校验）
    openExternal(url) {
        return ipcRenderer.invoke('host:open-external', url);
    },

    // 开机自启：读写主进程登录项，返回实际生效状态（浏览器兜底环境不存在，调用方需探测）
    getAutoLaunch() {
        return ipcRenderer.invoke('app:get-auto-launch');
    },

    setAutoLaunch(enabled) {
        return ipcRenderer.invoke('app:set-auto-launch', Boolean(enabled));
    },

    // 本地数据库（todos/settings/user/membership 的读写全走这里）
    db: dbBridge,

    // 导出 JSON 到用户自选位置（原生保存对话框，默认下载目录）
    async exportDataFile(fileName, content) {
        return ipcRenderer.invoke('host:export-file', { fileName, content });
    },

    // 屏幕枚举：设置页「目标屏幕」与贴边布局使用（同步契约）
    getDisplays() {
        return ipcRenderer.sendSync('host:get-displays');
    },

    getPrimaryDisplay() {
        return ipcRenderer.sendSync('host:get-primary-display');
    },

    getDisplayStatus() {
        return 'ok';
    },

    // 面板展开/收起：主进程按贴边算法调整窗口尺寸位置
    applyLayout(payload) {
        ipcRenderer.send('todo-sidebar:layout', payload || {});
        return true;
    },

    closeSidebar() {
        window.close();
    },

    exitApp() {
        ipcRenderer.send('app:quit');
    }
};

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('sidebarHost', sidebarHost);
} else {
    window.sidebarHost = sidebarHost;
}

// 页面级事件桥（提醒窗与主窗口订阅主进程推送）
if (isReminderMode()) {
    ipcRenderer.on('todo-reminder:data', (_event, payload) => {
        dispatchReminderEvent('data', payload ?? null);
    });
    ipcRenderer.on('todo-reminder:dismissed', (_event, id) => {
        dispatchReminderEvent('dismissed', id ?? null);
    });
}

if (isDesktopMode() || isSidebarMode()) {
    ipcRenderer.on('todo-reminder:dismiss', (_event, id) => {
        dispatchReminderEvent('dismiss', id ?? null);
    });
    ipcRenderer.on('todo-reminder:empty', () => {
        dispatchReminderEvent('empty', null);
    });
}
