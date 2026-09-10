// 首次启动引导：现代化分步欢迎层（仅首次展示，标记存 localStorage 设备态）
// 触发时机：init 完成后。贴边模式下会先自动展开面板，再淡入引导。
import { state } from './core.js';
import { openPanelWithLatestData, switchView } from './ui.js';

const ONBOARDING_KEY = 'todo/onboarding-completed-at';

const STEPS = [
    {
        eyebrow: '欢迎',
        title: '你好，极简待办',
        text: '轻量、无打扰的桌面待办：贴边常驻、随叫随到，所有数据都保存在你自己的电脑上。',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="8 12.5 11 15.5 16 9.5"></polyline></svg>'
    },
    {
        eyebrow: '常驻形态',
        title: '贴边待命，随叫随到',
        text: '应用驻留在屏幕边缘：点击贴边条即可展开面板；点击面板以外区域或按 Esc，自动收回贴边。',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"></rect><line x1="17.5" y1="4" x2="17.5" y2="20"></line><polyline points="9 9 7.5 10.5 9 12"></polyline><line x1="7.5" y1="10.5" x2="12" y2="10.5"></line></svg>'
    },
    {
        eyebrow: '到期提醒',
        title: '到点提醒，不靠记性',
        text: '为待办设置到期时间，时间一到自动弹出置顶提醒窗，可逐条关闭或一键全部关闭。',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9"></path><path d="M10 19.5a2.2 2.2 0 0 0 4 0"></path></svg>'
    },
    {
        eyebrow: '个性化',
        title: '主题随心，体验全开',
        text: '设置中可切换深浅色与主题色、调整快捷提醒时间；当前 SVIP 限时体验已开放全部权益。',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" opacity="0.9"></path></svg>'
    }
];

function hasCompleted() {
    try {
        return Boolean(window.localStorage.getItem(ONBOARDING_KEY));
    } catch {
        return true; // 环境异常时不打扰用户
    }
}

function markCompleted() {
    try {
        window.localStorage.setItem(ONBOARDING_KEY, String(Date.now()));
    } catch {
        /* ignore */
    }
}

function $(id) {
    return document.getElementById(id);
}

const dom = {
    overlay: null,
    card: null,
    icon: null,
    eyebrow: null,
    title: null,
    text: null,
    dots: null,
    skip: null,
    next: null
};

function ensureDom() {
    if (dom.overlay) return true;
    dom.overlay = $('onboardingOverlay');
    if (!dom.overlay) return false;
    dom.card = $('onboardingCard') || dom.overlay.querySelector('.onboarding__card');
    dom.icon = $('onboardingIcon');
    dom.eyebrow = $('onboardingEyebrow');
    dom.title = $('onboardingTitle');
    dom.text = $('onboardingText');
    dom.dots = $('onboardingDots');
    dom.skip = $('onboardingSkip');
    dom.next = $('onboardingNext');
    return Boolean(dom.icon && dom.eyebrow && dom.title && dom.text && dom.dots && dom.skip && dom.next);
}

let current = 0;
let isOpen = false;
let armed = false;
let listenersBound = false;
let showTimer = null;
let escapeHandler = null;

function renderStep(index) {
    const step = STEPS[index];
    const isLast = index === STEPS.length - 1;
    dom.eyebrow.textContent = step.eyebrow;
    dom.title.textContent = step.title;
    dom.text.textContent = step.text;
    dom.icon.innerHTML = step.icon;
    dom.next.textContent = isLast ? '开始使用' : '下一步';
    // 最后一步隐藏「跳过引导」：仅视觉隐藏并保留占位，
    // 保证「开始使用」按钮与其他步骤的「下一步」位置一致（hidden 属性会 display:none 破坏布局）
    dom.skip.style.visibility = isLast ? 'hidden' : '';

    Array.from(dom.dots.children).forEach((dot, i) => {
        dot.classList.toggle('is-active', i === index);
        dot.classList.toggle('is-done', i < index);
    });

    // 重触发入场动画：图标轻微弹入、文本淡入
    for (const el of [dom.icon, dom.eyebrow, dom.title, dom.text]) {
        el.classList.remove('is-entering');
    }
    void dom.card.offsetWidth;
    for (const el of [dom.icon, dom.eyebrow, dom.title, dom.text]) {
        el.classList.add('is-entering');
    }
}

function renderDots() {
    dom.dots.innerHTML = STEPS.map(() => '<span class="onboarding__dot"></span>').join('');
}

function finish() {
    if (!isOpen) return;
    isOpen = false;
    armed = false; // 引导只出现一次：任何形式的关闭（完成/跳过/Esc/关面板）都视为已读
    markCompleted();
    dom.overlay.classList.remove('is-open');
    if (escapeHandler) {
        document.removeEventListener('keydown', escapeHandler, true);
        escapeHandler = null;
    }
    window.setTimeout(() => {
        if (!isOpen) dom.overlay.hidden = true;
    }, 280);
}

function next() {
    if (current >= STEPS.length - 1) {
        finish();
        return;
    }
    current += 1;
    renderStep(current);
}

function show() {
    if (showTimer == null) return; // 只允许由 scheduleShow 的定时器触发
    showTimer = null;
    if (!armed || isOpen || hasCompleted() || !state.ui.isPanelOpen) return;
    current = 0;
    isOpen = true;
    // 引导从主列表讲起：重播时可能停在设置/已完成等子视图，先切回
    switchView('active');
    dom.overlay.hidden = false;
    renderDots();
    renderStep(0);
    // 下一帧再加 is-open，保证 backdrop/card 过渡生效
    window.requestAnimationFrame(() => {
        dom.overlay.classList.add('is-open');
        dom.next.focus();
    });

    escapeHandler = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        finish();
    };
    document.addEventListener('keydown', escapeHandler, true);
}

// 引导仅在首次出现：由 ui.js 在面板展开/收起后派发事件驱动（解耦，避免循环 import）
function scheduleShow() {
    if (!armed || isOpen || showTimer != null) return;
    showTimer = window.setTimeout(show, 260);
}

// 面板收起时若引导还开着，视为已读并一并关闭，避免「每次点开都引导」
function onPanelClosed() {
    if (isOpen) finish();
}

// 武装引导：绑定一次性监听并在面板展开后调度显示（maybeRunOnboarding 与重播共用）
function armOnboarding() {
    if (!ensureDom()) return;
    armed = true;

    if (!listenersBound) {
        dom.skip.addEventListener('click', finish);
        dom.next.addEventListener('click', next);
        dom.overlay.querySelector('.onboarding__backdrop')?.addEventListener('click', finish);
        window.addEventListener('todo:panel-opened', scheduleShow);
        window.addEventListener('todo:panel-closed', onPanelClosed);
        listenersBound = true;
    }

    if (state.ui.isPanelOpen) {
        scheduleShow();
        return;
    }
    // 贴边模式：先自动展开面板，展开事件会触发引导显示
    openPanelWithLatestData();
}

export function maybeRunOnboarding() {
    if (hasCompleted()) return;
    armOnboarding();
}

// 重新观看引导：清除完成标记后原地重置引导层（整页 reload 会先闪一下主界面）
export function replayOnboarding() {
    try {
        window.localStorage.removeItem(ONBOARDING_KEY);
    } catch {
        /* ignore */
    }
    isOpen = false;
    if (dom.overlay) {
        dom.overlay.classList.remove('is-open');
        dom.overlay.hidden = true;
    }
    if (escapeHandler) {
        document.removeEventListener('keydown', escapeHandler, true);
        escapeHandler = null;
    }
    armOnboarding();
}
