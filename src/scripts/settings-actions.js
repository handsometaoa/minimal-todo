import {
    state,
    elements,
    host,
    normalizeHexColor,
    applyThemeSettings,
    persistThemeSettings,
    saveLocalSidebarSettings,
    applyWindowLayout,
    hasMembershipAccess,
    persist
} from './core.js';
import { getRepositories } from './storage/index.js';
import { showToast, syncView, applySideState } from './ui.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// —— 开机自启（通用设置） ——

function applyAutoLaunchUi(enabled) {
    const toggle = elements.autoLaunchToggle;
    if (!toggle) return;
    toggle.classList.toggle('is-on', Boolean(enabled));
    toggle.setAttribute('aria-checked', String(Boolean(enabled)));
    if (elements.autoLaunchDesc) {
        elements.autoLaunchDesc.textContent = enabled
            ? '已开启：登录系统后自动在屏幕边缘待命'
            : '已关闭：登录系统后需手动打开';
    }
}

// 读取系统登录项实际状态，校正开关（以系统为准，而非本地记忆）
export async function refreshAutoLaunchState() {
    const toggle = elements.autoLaunchToggle;
    if (!toggle || typeof host?.getAutoLaunch !== 'function') return;
    try {
        const enabled = Boolean(await host.getAutoLaunch());
        applyAutoLaunchUi(enabled);
    } catch (error) {
        console.error('[settings] 读取开机自启状态失败:', error);
    }
}

export function setAutoLaunch(enabled) {
    const toggle = elements.autoLaunchToggle;
    if (!toggle || typeof host?.setAutoLaunch !== 'function') return;
    // 先乐观更新 UI，再以主进程返回的实际状态校正
    applyAutoLaunchUi(enabled);
    persist(
        (async () => {
            const actual = Boolean(await host.setAutoLaunch(enabled));
            applyAutoLaunchUi(actual);
            // 偏好同时写入程序（设备设置）；系统登录项仍是功能的最终事实来源
            if (actual === enabled && typeof host.db?.setDeviceSetting === 'function') {
                await host.db.setDeviceSetting({ key: 'autoLaunch', value: actual });
            }
            showToast(
                actual === enabled ? (enabled ? '已开启开机自启' : '已关闭开机自启') : '设置未生效，请重试',
                actual === enabled ? 'success' : 'error'
            );
        })(),
        '开机自启设置失败，请重试'
    );
}

export function updateSidebarSettings(nextConfig) {
    if (!hasMembershipAccess()) {
        showToast('未开通 SVIP，无法使用窗口停靠权益', 'error');
        return;
    }
    state.data.sidebar = { ...state.data.sidebar, ...nextConfig };
    applySideState();
    applyWindowLayout(state.ui.isPanelOpen ? 'expanded' : 'collapsed');
    // 停靠配置落库：桌面端写主进程 device.dock（启动定位读取同一份），
    // 浏览器兜底环境无宿主通道，退回 localStorage
    if (host?.db?.setDeviceSetting) {
        persist(
            host.db.setDeviceSetting({
                key: 'dock',
                value: { displayId: state.data.sidebar.displayId, side: state.data.sidebar.side }
            }),
            '停靠设置保存失败，请重试'
        );
    } else {
        saveLocalSidebarSettings();
    }
}

export function updateThemeSettings(nextSettings, successMessage = '主题设置已保存') {
    if (!hasMembershipAccess()) {
        showToast('未开通 SVIP，无法使用界面设置权益', 'error');
        return;
    }
    persistThemeSettings({ ...state.data.settings, ...nextSettings });
    syncView();
    showToast(successMessage);
}

export function previewThemeSettings(nextSettings) {
    if (!hasMembershipAccess()) return;
    applyThemeSettings({ ...state.data.settings, ...nextSettings });
}

export function syncColorText(inputEl, textEl) {
    textEl.value = inputEl.value.toLowerCase();
}

export function applyColorText(textEl, inputEl, key, label) {
    const normalized = normalizeHexColor(textEl.value, state.data.settings[key]);
    textEl.value = normalized;
    inputEl.value = normalized;
    updateThemeSettings({ [key]: normalized }, `${label}已更新`);
}

export function openConfirmDialog() {
    if (!elements.confirmDialog) return;
    state.ui.isConfirmDialogOpen = true;
    elements.confirmDialog.hidden = false;
    elements.confirmDialogCancel?.focus();
}

export function closeConfirmDialog() {
    if (!elements.confirmDialog) return;
    state.ui.isConfirmDialogOpen = false;
    elements.confirmDialog.hidden = true;
}

// —— 关于弹窗（计数图标点击打开：作者信息 / GitHub / 赞助） ——

export function openAboutDialog() {
    if (!elements.aboutDialog) return;
    if (elements.aboutVersion) {
        elements.aboutVersion.textContent = typeof host?.getAppVersion === 'function' ? `v${host.getAppVersion()}` : '';
    }
    state.ui.isAboutDialogOpen = true;
    elements.aboutDialog.hidden = false;
    elements.aboutDialogClose?.focus();
}

export function closeAboutDialog() {
    if (!elements.aboutDialog) return;
    state.ui.isAboutDialogOpen = false;
    elements.aboutDialog.hidden = true;
}

export function clearExpiredCompleted() {
    if (!hasMembershipAccess()) {
        closeConfirmDialog();
        showToast('未开通 SVIP，无法使用数据管理权益', 'error');
        return;
    }
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const removedCount = state.data.completed.filter((todo) => !todo.completedAt || todo.completedAt < cutoff).length;

    closeConfirmDialog();
    if (removedCount <= 0) {
        showToast('没有可清理的过期历史', 'error');
        return;
    }

    // 内存与数据库按同一 cutoff 清理（数据库走 SQL 删除）
    persist(getRepositories().clearExpiredCompleted(cutoff), '清理历史失败，请重试');
    state.data.completed = state.data.completed.filter((todo) => todo.completedAt && todo.completedAt >= cutoff);
    syncView();
    showToast(`已清理 ${removedCount} 条过期历史`);
}
