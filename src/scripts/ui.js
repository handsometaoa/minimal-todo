import {
    WINDOW_DOCK_SETTINGS_LOCKED,
    VIEWS,
    PRESET_THEMES,
    hasMembershipAccess,
    elements,
    state,
    sortState,
    escapeHtml,
    isThisWeek,
    formatTimestamp,
    getCompactTimestamp,
    formatDueTime,
    toDateInputValue,
    toTimeInputValue,
    computeDuePreset,
    filterTodosByDue,
    DEFAULT_DUE_PRESETS,
    splitPresetTime,
    getDuePresetSlots,
    getDisplays,
    getDisplayStatus,
    getSavedDisplay,
    getTargetDisplay,
    saveLocalUiSettings,
    applyWindowLayout,
    isDesktopMode,
    buildThemeColors,
    persist
} from './core.js';
import { getRepositories } from './storage/index.js';

let panelFocusWatchTimer = null;
let panelCloseTimer = null;

export function showToast(message, typeOrOptions = 'success') {
    if (!state.ui.isPanelOpen) return;
    const options = typeof typeOrOptions === 'string' ? { type: typeOrOptions } : typeOrOptions || {};
    const type = options.type || 'success';
    const duration = Number.isFinite(options.duration) ? options.duration : 1800;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = {
        success:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
    };
    toast.innerHTML = `${icons[type] || icons.success}<span>${escapeHtml(message)}</span>`;

    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        toast.classList.add('leaving');
        window.setTimeout(() => toast.remove(), 180);
    };

    if (options.actionLabel && typeof options.onAction === 'function') {
        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'toast__action';
        actionButton.textContent = options.actionLabel;
        actionButton.addEventListener('click', () => {
            dismiss();
            options.onAction();
        });
        toast.appendChild(actionButton);
    }

    elements.toastContainer.appendChild(toast);
    window.setTimeout(dismiss, duration);
}

export function clearToasts() {
    elements.toastContainer.innerHTML = '';
}

function escapeAttribute(text) {
    return escapeHtml(text).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function getFilteredCompleted() {
    return state.ui.completedFilter === 'week'
        ? state.data.completed.filter((todo) => isThisWeek(todo.completedAt))
        : state.data.completed;
}

export function renderActiveTodos() {
    if (state.ui.editingTodoId && !state.data.todos.some((todo) => todo.id === state.ui.editingTodoId)) {
        state.ui.editingTodoId = null;
        state.ui.editingTodoDraft = '';
        state.ui.skipEditCommitOnce = false;
    }

    // 侧边条徽章展示未完成数；标题栏的 headerCount 现在是「关于/赞助」入口，不承载计数
    const count = state.data.todos.length;
    const badge = count > 99 ? '99+' : String(count);
    elements.stripBadge.textContent = badge;

    elements.todoFilterChips.forEach((chip) => {
        chip.classList.toggle('is-active', chip.dataset.todoFilter === state.ui.todoFilter);
    });
    // 非全部筛选下禁用拖动排序
    elements.todoList.classList.toggle('is-filtered', state.ui.todoFilter !== 'all');
    const visibleTodos = filterTodosByDue(state.data.todos, state.ui.todoFilter);
    // 非全部筛选下按到期时间从早到晚排序（全部保持手动拖动顺序）
    if (state.ui.todoFilter !== 'all') {
        visibleTodos.sort(
            (a, b) => (Number.isFinite(a.dueAt) ? a.dueAt : Infinity) - (Number.isFinite(b.dueAt) ? b.dueAt : Infinity)
        );
    }
    elements.activeCount.textContent = String(visibleTodos.length);

    // 正在编辑到期时间的条目被筛掉时，收起弹窗避免悬空
    if (state.ui.editingDueId && !visibleTodos.some((todo) => todo.id === state.ui.editingDueId)) {
        state.ui.editingDueId = null;
        state.ui.editingDueDraft = null;
    }

    if (count === 0 || visibleTodos.length === 0) {
        elements.todoList.innerHTML = '';
        if (elements.activeEmptyTitle) {
            elements.activeEmptyTitle.textContent = count === 0 ? '还没有待办' : '该筛选下暂无待办';
        }
        if (elements.activeEmptyText) {
            elements.activeEmptyText.textContent =
                count === 0 ? '从上方输入框添加第一条任务。' : '换个筛选条件，或切回「全部」查看。';
        }
        elements.activeEmptyState.hidden = false;
        elements.activeEmptyState.style.display = 'flex';
        return;
    }

    elements.activeEmptyState.hidden = true;
    elements.activeEmptyState.style.display = 'none';
    elements.todoList.innerHTML = visibleTodos
        .map((todo, index) => {
            const isOverdue = Number.isFinite(todo.dueAt) && todo.dueAt <= Date.now();
            const isSoon = Number.isFinite(todo.dueAt) && !isOverdue && todo.dueAt <= Date.now() + 86400000;
            const dueBadge =
                todo.dueAt && state.ui.editingDueId !== todo.id
                    ? `<button class="todo-due${isOverdue ? ' is-overdue' : isSoon ? ' is-soon' : ''}" type="button" data-action="due-edit" data-todo-id="${todo.id}" title="点击修改到期时间">${escapeHtml(formatDueTime(todo.dueAt))}</button>`
                    : '';
            const addDueButton =
                state.ui.editingDueId === todo.id || todo.dueAt
                    ? ''
                    : `
            <button class="todo-due-add" type="button" data-action="due-edit" data-todo-id="${todo.id}" aria-label="设置到期提醒" title="设置到期提醒">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="9"></circle>
                    <polyline points="12 7 12 12 15 14"></polyline>
                </svg>
            </button>`;
            const metaRow = dueBadge ? `<div class="todo-meta-row">${dueBadge}</div>` : '';
            return `
        <article class="todo-item${state.ui.editingTodoId === todo.id ? ' is-editing' : ''}" data-todo-id="${todo.id}" data-todo-index="${index}">
            <button class="todo-handle" type="button" data-sort-handle="${todo.id}" aria-label="拖动排序" title="拖动排序">
                <span></span><span></span><span></span>
            </button>
            <button class="todo-checkbox" type="button" data-action="complete" data-todo-id="${todo.id}" aria-label="完成待办">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </button>
            <div class="todo-main" data-edit-trigger="${todo.id}">
                <div class="todo-line">
                    ${
                        state.ui.editingTodoId === todo.id
                            ? `<input class="todo-edit-input" type="text" value="${escapeAttribute(state.ui.editingTodoDraft)}" maxlength="200" data-edit-input="${todo.id}" aria-label="编辑待办内容">`
                            : `<p class="todo-text" title="${escapeAttribute(todo.text)}">${escapeHtml(todo.text)}</p>`
                    }
                    <time class="todo-created" title="创建时间">${getCompactTimestamp(todo.createdAt)}</time>
                    ${addDueButton}
                </div>
                ${metaRow}
            </div>
            <button class="todo-delete" type="button" data-action="delete" data-todo-id="${todo.id}" aria-label="删除待办" title="删除待办">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        </article>
    `;
        })
        .join('');

    if (state.ui.editingTodoId) {
        window.requestAnimationFrame(() => {
            const input = elements.todoList.querySelector(`[data-edit-input="${state.ui.editingTodoId}"]`);
            if (!input) return;
            input.focus();
            input.select();
        });
    }

    // 每次列表渲染后同步弹窗：编辑中则重新定位，否则收起
    window.requestAnimationFrame(() => {
        syncDuePopover();
        syncTodoListOverflow();
    });
}

// 列表可滚动时底边渐隐，提示下方还有内容，避免行被生硬裁成半截
export function syncTodoListOverflow() {
    const list = elements.todoList;
    if (!list) return;
    list.classList.toggle('has-overflow', list.scrollHeight - list.scrollTop - list.clientHeight > 24);
}

// 到期弹窗为面板级悬浮层：挂在条目下方、跟随列表滚动，底部放不下时整体上翻
export function syncDuePopover() {
    const popover = elements.duePopover;
    if (!popover) return;
    const todoId = state.ui.editingDueId;
    const item =
        todoId && state.ui.isPanelOpen && state.ui.currentView === 'active'
            ? elements.todoList.querySelector(`.todo-item[data-todo-id="${todoId}"]`)
            : null;
    if (!item) {
        popover.hidden = true;
        delete popover.dataset.todoId;
        return;
    }
    elements.todoList
        .querySelectorAll('.todo-item.is-due-editing')
        .forEach((el) => el.classList.remove('is-due-editing'));
    item.classList.add('is-due-editing');
    const anchorTodo = state.data.todos.find((todo) => todo.id === todoId);
    if (elements.duePopoverDelete) elements.duePopoverDelete.hidden = !anchorTodo || !Number.isFinite(anchorTodo.dueAt);
    if (popover.dataset.todoId !== todoId) {
        // 换了目标待办（或首次打开）时回填输入框；未设置过提醒则默认当前时间
        const draft = state.ui.editingDueDraft;
        if (elements.duePopoverDate)
            elements.duePopoverDate.value = draft != null ? toDateInputValue(draft) : toDateInputValue(Date.now());
        if (elements.duePopoverTime)
            elements.duePopoverTime.value = draft != null ? toTimeInputValue(draft) : toTimeInputValue(Date.now());
        popover.dataset.todoId = todoId;
        updateDuePresetChips();
    }
    popover.hidden = false;
    const shellRect = elements.appShell.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const popHeight = popover.offsetHeight || 220;
    const gap = 8;
    const margin = 12;
    let top = itemRect.bottom - shellRect.top + gap;
    let flipped = false;
    const maxTop = shellRect.height - popHeight - margin;
    if (top > maxTop) {
        const above = itemRect.top - shellRect.top - gap - popHeight;
        if (above >= margin) {
            top = above;
            flipped = true;
        } else {
            top = Math.max(margin, maxTop);
        }
    }
    popover.classList.toggle('is-flipped', flipped);
    popover.style.top = `${Math.round(top)}px`;
}

export function ensureSortIndicator() {
    if (!sortState.indicatorEl) {
        const indicator = document.createElement('div');
        indicator.className = 'todo-drop-indicator';
        sortState.indicatorEl = indicator;
    }
    return sortState.indicatorEl;
}

export function hideSortIndicator() {
    sortState.indicatorEl?.remove();
}

export function showSortIndicator(afterElement) {
    const indicator = ensureSortIndicator();
    if (!sortState.isDragging) {
        hideSortIndicator();
        return;
    }
    const parent = elements.todoList;
    if (afterElement == null) {
        // 位置未变化时不重插节点，避免动画重置导致闪烁
        if (indicator.parentElement !== parent || parent.lastElementChild !== indicator) {
            parent.appendChild(indicator);
        }
        return;
    }
    if (indicator.parentElement !== parent || indicator.nextElementSibling !== afterElement) {
        parent.insertBefore(indicator, afterElement);
    }
}

export function clearSortState() {
    hideSortIndicator();
    sortState.cleanupListeners?.();
    sortState.cleanupListeners = null;
    sortState.itemEl?.classList.remove('is-dragging');
    sortState.handleEl?.classList.remove('is-dragging');
    elements.todoList.classList.remove('is-sorting');
    document.body.classList.remove('is-sorting');
    sortState.draggingTodoId = null;
    sortState.startX = 0;
    sortState.startY = 0;
    sortState.isDragging = false;
    sortState.sourceIndex = -1;
    sortState.itemEl = null;
    sortState.handleEl = null;
}

export function shouldIgnoreBlurClose() {
    return Date.now() < state.ui.ignoreBlurUntil;
}

export function stopPanelFocusWatch() {
    if (panelFocusWatchTimer == null) return;
    window.clearInterval(panelFocusWatchTimer);
    panelFocusWatchTimer = null;
}

export function clearPanelCloseTimer() {
    if (panelCloseTimer == null) return;
    window.clearTimeout(panelCloseTimer);
    panelCloseTimer = null;
}

export function requestClosePanel({ respectIgnoreBlur = false } = {}) {
    // 桌面客户端面板常驻，不允许收起
    if (isDesktopMode()) return;
    if (respectIgnoreBlur && shouldIgnoreBlurClose()) return;
    if (!state.ui.isPanelOpen) return;
    if (state.ui.isConfirmDialogOpen) return;
    if (state.ui.editingTodoId && !state.ui.editingTodoDraft.trim()) {
        showToast('请输入待办内容', 'error');
        window.requestAnimationFrame(() => {
            const input = elements.todoList.querySelector(`[data-edit-input="${state.ui.editingTodoId}"]`);
            input?.focus();
        });
        return;
    }
    finishSort();
    if (!state.ui.isPanelOpen) return;
    closePanel();
}

export function startPanelFocusWatch() {
    stopPanelFocusWatch();
    panelFocusWatchTimer = window.setInterval(() => {
        if (!state.ui.isPanelOpen || shouldIgnoreBlurClose()) return;
        if (document.visibilityState === 'hidden' || !document.hasFocus()) {
            requestClosePanel({ respectIgnoreBlur: true });
        }
    }, 250);
}

export function getDragAfterElement(container, clientY, draggingEl) {
    const items = Array.from(container.querySelectorAll('.todo-item')).filter((item) => item !== draggingEl);
    let closest = null;
    let closestOffset = Number.NEGATIVE_INFINITY;

    items.forEach((item) => {
        const rect = item.getBoundingClientRect();
        const offset = clientY - rect.top - rect.height / 2;
        if (offset < 0 && offset > closestOffset) {
            closestOffset = offset;
            closest = item;
        }
    });

    return closest;
}

export function reorderTodos(sourceIndex, targetIndex) {
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
    if (sourceIndex >= state.data.todos.length || targetIndex >= state.data.todos.length) return;
    const nextTodos = [...state.data.todos];
    const [movedTodo] = nextTodos.splice(sourceIndex, 1);
    nextTodos.splice(targetIndex, 0, movedTodo);
    state.data.todos = nextTodos;
}

export function commitSort() {
    if (!sortState.isDragging) {
        clearSortState();
        return;
    }
    // 目标位置由"DOM 中下一条待办"的 id 决定：全量与筛选视图下都正确
    const draggedId = sortState.draggingTodoId;
    const itemEl = sortState.itemEl;
    const nextEl =
        itemEl.nextElementSibling === sortState.indicatorEl
            ? sortState.indicatorEl.nextElementSibling
            : itemEl.nextElementSibling;
    clearSortState();

    const fromIndex = state.data.todos.findIndex((todo) => todo.id === draggedId);
    if (fromIndex < 0) {
        syncView();
        return;
    }
    const [moved] = state.data.todos.splice(fromIndex, 1);
    let toIndex = state.data.todos.length;
    if (nextEl) {
        const nextId = nextEl.dataset.todoId;
        const found = state.data.todos.findIndex((todo) => todo.id === nextId);
        if (found >= 0) toIndex = found;
    }
    state.data.todos.splice(toIndex, 0, moved);
    persist(getRepositories().todos.reorder(state.data.todos.map((todo) => todo.id)), '排序保存失败，请重试');
    syncView();
}

export function finishSort() {
    if (!sortState.draggingTodoId) return;
    commitSort();
}

export function attachSortMouseListeners() {
    const onMove = (event) => handleSortPointerMove(event);
    const onUp = () => finishSort();
    const onBlur = () => finishSort();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
    sortState.cleanupListeners = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onBlur);
    };
}

export function handleSortPointerMove(event) {
    if (!sortState.draggingTodoId || !sortState.itemEl) return;
    if (!sortState.isDragging) {
        const deltaX = Math.abs(event.clientX - sortState.startX);
        const deltaY = Math.abs(event.clientY - sortState.startY);
        if (Math.max(deltaX, deltaY) < 6) return;
        sortState.isDragging = true;
        sortState.itemEl.classList.add('is-dragging');
        sortState.handleEl?.classList.add('is-dragging');
        elements.todoList.classList.add('is-sorting');
        document.body.classList.add('is-sorting');
    }

    const afterElement = getDragAfterElement(elements.todoList, event.clientY, sortState.itemEl);
    showSortIndicator(afterElement);
    // 计算当前位置的下一个参考节点(跳过指示器)，插入点未变化时不移动节点，避免重排闪烁
    const currentNext =
        sortState.itemEl.nextElementSibling === sortState.indicatorEl
            ? sortState.indicatorEl.nextElementSibling
            : sortState.itemEl.nextElementSibling;
    if (afterElement === currentNext) return;
    if (!afterElement) {
        elements.todoList.appendChild(sortState.itemEl);
    } else {
        elements.todoList.insertBefore(sortState.itemEl, afterElement);
    }
}

export function renderCompletedTodos() {
    const filtered = getFilteredCompleted();
    elements.completedFilterButtons.forEach((button) => {
        button.classList.toggle('is-active', button.dataset.completedFilter === state.ui.completedFilter);
    });

    if (filtered.length === 0) {
        elements.completedList.innerHTML = '';
        elements.completedList.appendChild(elements.completedEmptyState);
        elements.completedList.style.display = 'flex';
        elements.completedEmptyState.hidden = false;
        elements.completedEmptyState.style.display = 'flex';
        elements.completedEmptyTitle.textContent =
            state.ui.completedFilter === 'week' ? '本周还没有已完成事项' : '暂时没有已完成任务';
        elements.completedEmptyText.textContent =
            state.ui.completedFilter === 'week'
                ? '完成新的待办后，会出现在本周列表中。'
                : '完成一条待办后会出现在这里。';
        return;
    }

    elements.completedEmptyState.hidden = true;
    elements.completedEmptyState.style.display = 'none';
    elements.completedList.style.display = '';
    elements.completedList.innerHTML = filtered
        .map(
            (todo) => `
        <article class="completed-item">
            <span class="completed-item__mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"></polyline></svg>
            </span>
            <div class="completed-item__main">
                <div class="completed-item__line">
                    <p class="completed-item__text" title="${escapeHtml(todo.text)}">${escapeHtml(todo.text)}</p>
                    <p class="completed-item__meta">${formatTimestamp(todo.completedAt)}</p>
                </div>
            </div>
            <div class="completed-item__actions">
                <button class="completed-action" type="button" data-completed-action="restore" data-todo-id="${todo.id}">恢复</button>
                <button class="completed-action completed-action--danger" type="button" data-completed-action="delete" data-todo-id="${todo.id}">删除</button>
            </div>
        </article>
    `
        )
        .join('');
}

export function renderProfile() {
    const user = state.data.user;
    const membership = state.data.membership;
    const nickname = user.nickname || '未获取到昵称';
    const fallbackText = nickname.trim().slice(0, 1).toUpperCase() || '?';
    const hasAvatar = Boolean(user.avatar);
    elements.profileCard?.classList.toggle('is-empty', !user.available);

    if (elements.profileAvatarImage) {
        elements.profileAvatarImage.onerror = () => {
            elements.profileAvatarImage.hidden = true;
            if (elements.profileAvatarFallback) elements.profileAvatarFallback.hidden = false;
        };
        if (hasAvatar) {
            elements.profileAvatarImage.src = user.avatar;
            elements.profileAvatarImage.alt = `${nickname} 的头像`;
            elements.profileAvatarImage.hidden = false;
        } else {
            elements.profileAvatarImage.removeAttribute('src');
            elements.profileAvatarImage.hidden = true;
        }
    }

    elements.profileAvatarFallback.textContent = fallbackText;
    elements.profileAvatarFallback.hidden = hasAvatar;
    elements.profileNickname.textContent = nickname;
    if (elements.profileVipBadge) {
        elements.profileVipBadge.hidden = !membership.active;
    }
    elements.profileStatus.textContent = '本地账号';
    elements.profileHint.textContent = '数据保存在本机，可在设置中导出备份。';
    if (elements.membershipStatusText) {
        elements.membershipStatusText.textContent = membership.active ? 'SVIP 限时体验中' : '未开通 SVIP';
    }
    if (elements.membershipStatusHint) {
        elements.membershipStatusHint.textContent = membership.active
            ? '当前版本已开放限时体验，无需购买套餐。'
            : 'SVIP 暂未开放。';
    }
    if (elements.membershipPlanList) {
        elements.membershipPlanList.hidden = true;
        elements.membershipPlanList.innerHTML = '';
    }
}

export function renderThemeSettings() {
    if (
        !elements.appearanceModeGroup ||
        !elements.themeModeSelect ||
        !elements.presetThemeSelect ||
        !elements.customPrimaryInput ||
        !elements.customPrimaryText ||
        !elements.customSecondaryInput ||
        !elements.customSecondaryText ||
        !elements.presetThemeField ||
        !elements.customThemeFields ||
        !elements.themeSettingsHint ||
        !elements.themePreview
    ) {
        return;
    }
    const settings = state.data.settings;
    const hasMembership = hasMembershipAccess();
    const colors = buildThemeColors(settings);
    elements.appearanceModeButtons.forEach((button) => {
        const isActive = button.dataset.appearanceMode === settings.appearanceMode;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
        button.disabled = !hasMembership || isActive;
    });
    elements.themeModeSelect.value = settings.themeMode;
    elements.themeModeSelect.disabled = !hasMembership;
    elements.presetThemeSelect.innerHTML = PRESET_THEMES.map(
        (theme) => `<option value="${theme.id}">${escapeHtml(theme.label)}</option>`
    ).join('');
    elements.presetThemeSelect.value = settings.presetThemeId;
    elements.customPrimaryInput.value = settings.customPrimary;
    elements.customPrimaryText.value = settings.customPrimary;
    elements.customSecondaryInput.value = settings.customSecondary;
    elements.customSecondaryText.value = settings.customSecondary;

    const presetMode = settings.themeMode === 'preset';
    elements.presetThemeField.hidden = !presetMode;
    elements.customThemeFields.hidden = presetMode;
    elements.presetThemeSelect.disabled = !presetMode || !hasMembership;
    elements.customPrimaryInput.disabled = presetMode || !hasMembership;
    elements.customPrimaryText.disabled = presetMode || !hasMembership;
    elements.customSecondaryInput.disabled = presetMode || !hasMembership;
    elements.customSecondaryText.disabled = presetMode || !hasMembership;
    /*
    elements.themeSettingsHint.textContent = presetMode
        ? hasMembership ? '切换预设主题后立即生效' : '未开通 SVIP，当前无法使用界面设置权益。'
        : hasMembership ? '修改主色和辅助色后立即生效' : '未开通 SVIP，当前无法使用界面设置权益。';
    */
    elements.themeSettingsHint.textContent = !hasMembership
        ? '未开通 SVIP，当前无法使用界面设置权益。'
        : presetMode
          ? '明暗模式与预设主题修改后立即生效'
          : '明暗模式与自定义颜色修改后立即生效';
    elements.themePreview.style.setProperty('--preview-primary', colors.primary);
    elements.themePreview.style.setProperty('--preview-secondary', colors.secondary);
    elements.themePreview.style.setProperty('--preview-accent', colors.accent);
}

export function renderViews() {
    const titles = { active: '极简待办', completed: '已完成', settings: '设置', profile: '个人中心' };
    elements.panelTitle.textContent = titles[state.ui.currentView] || titles.active;
    elements.views.forEach((view) => {
        const visible = view.dataset.viewPanel === state.ui.currentView;
        view.hidden = !visible;
        view.classList.toggle('is-visible', visible);
    });
}

export function applySideState() {
    elements.appShell.dataset.side = state.data.sidebar.side;
}

export function renderSettings() {
    if (!elements.displaySelect || !elements.sideSelect || !elements.settingsHint) {
        return;
    }
    const hasMembership = hasMembershipAccess();
    const displays = getDisplays();
    const savedDisplay = getSavedDisplay();
    const currentDisplay = getTargetDisplay();
    const displayStatus = getDisplayStatus();
    const hasSavedDisplay = Boolean(savedDisplay);
    elements.displaySelect
        ?.closest('.settings-card')
        ?.classList.toggle('settings-card--locked', WINDOW_DOCK_SETTINGS_LOCKED || !hasMembership);

    elements.displaySelect.innerHTML = displays
        .map((display) => {
            const suffix = display.isPrimary ? ' (主屏幕)' : '';
            return `<option value="${escapeHtml(display.id)}">${escapeHtml(display.label || `显示器 ${display.id}`)}${suffix}</option>`;
        })
        .join('');

    if (hasSavedDisplay) elements.displaySelect.value = savedDisplay.id;
    // 未保存过（或保存的显示器已不存在）时回显实际生效的目标屏幕，避免下拉显示为空
    else elements.displaySelect.value = currentDisplay.id;

    elements.sideSelect.value = state.data.sidebar.side;
    const disableDisplaySelect = WINDOW_DOCK_SETTINGS_LOCKED || displayStatus !== 'ok' || !hasMembership;
    elements.displaySelect.disabled = disableDisplaySelect;
    elements.sideSelect.disabled = WINDOW_DOCK_SETTINGS_LOCKED || !hasMembership;
    if (elements.importDataButton) elements.importDataButton.disabled = !hasMembership;
    if (elements.exportDataButton) elements.exportDataButton.disabled = !hasMembership;
    if (elements.cleanupHistoryButton) elements.cleanupHistoryButton.disabled = !hasMembership;

    // 设置页快捷提醒时间：渲染 4 个「所见即所得」芯片并收起编辑器
    closeDueSlotEditor();

    if (!hasMembership) {
        elements.settingsHint.textContent = '未开通 SVIP，当前无法使用窗口停靠权益。';
    } else if (WINDOW_DOCK_SETTINGS_LOCKED) {
        elements.settingsHint.textContent = '';
    } else if (disableDisplaySelect) {
        elements.settingsHint.textContent = '当前环境未获取到多屏信息，目标屏幕选择已禁用。';
    } else if (!hasSavedDisplay) {
        elements.settingsHint.textContent = `已保存的目标屏幕当前不可用。窗口已临时显示在 ${currentDisplay.label || '主屏幕'}，但不会改写已保存设置。`;
    } else {
        elements.settingsHint.textContent =
            displays.length > 1 ? '已检测到多屏幕，可选择目标屏幕。' : '当前仅检测到一个屏幕。';
    }

    renderThemeSettings();
}

export function setFeatureMenuOpen(isOpen) {
    state.ui.isFeatureMenuOpen = isOpen;
    elements.featureMenu.hidden = !isOpen;
    elements.featureButton.setAttribute('aria-expanded', String(isOpen));
}

export function renderView() {
    applySideState();
    renderActiveTodos();
    renderCompletedTodos();
    renderProfile();
    renderViews();
    renderSettings();
    renderDueDraft();
}

export function syncView() {
    renderView();
}

export function focusComposer() {
    if (!state.ui.isPanelOpen || state.ui.currentView !== 'active') return;
    window.requestAnimationFrame(() => elements.addTodoInput.focus());
}

export function renderDueDraft() {
    if (!elements.dueRow || !elements.dueToggleBtn || !elements.dueDateInput || !elements.dueTimeInput) return;
    const visible = state.ui.dueDraftVisible;
    elements.dueRow.hidden = !visible;
    elements.dueToggleBtn.classList.toggle('is-active', visible || state.ui.dueDraft != null);
    if (visible) {
        updateDuePresetChips();
        // 与到期弹窗一致：未手动设置过时默认展示当前日期时间(仅展示，不改草稿)
        const ts = state.ui.dueDraft != null ? state.ui.dueDraft : Date.now();
        if (document.activeElement !== elements.dueDateInput) elements.dueDateInput.value = toDateInputValue(ts);
        if (document.activeElement !== elements.dueTimeInput) elements.dueTimeInput.value = toTimeInputValue(ts);
    }
}

export function setDueDraftVisible(visible) {
    state.ui.dueDraftVisible = Boolean(visible);
    renderDueDraft();
    if (state.ui.dueDraftVisible) elements.dueDateInput?.focus();
}

// 按快捷芯片槽位序号应用到期草稿（槽位 = 设置里自选的「今天/明天/后天/下周一 + 时间」）
export function applyDuePreset(slotIndex) {
    const slot = getDuePresetSlots(state.data.settings)[slotIndex];
    if (!slot) return;
    state.ui.dueDraft = computeDuePreset(slot);
    renderDueDraft();
}

export function clearDueDraft() {
    state.ui.dueDraft = null;
    state.ui.dueDraftVisible = false;
    renderDueDraft();
}

export function applyDueEditPreset(slotIndex) {
    if (!state.ui.editingDueId) return;
    const slot = getDuePresetSlots(state.data.settings)[slotIndex];
    if (!slot) return;
    const preset = computeDuePreset(slot);
    state.ui.editingDueDraft = preset;
    // 只更新弹窗输入框，不重渲染列表
    if (elements.duePopoverDate) elements.duePopoverDate.value = toDateInputValue(preset);
    if (elements.duePopoverTime) elements.duePopoverTime.value = toTimeInputValue(preset);
}

// 快捷芯片文字跟随设置的槽位（天数可自选）；「今天」已过配置时刻置灰禁用，
// 需要顺延请改用自定义日期时间或「明天」芯片
const DUE_PRESET_LABELS = { today: '今天', tomorrow: '明天', dayafter: '后天', nextweek: '下周一' };

export function updateDuePresetChips() {
    const slots = getDuePresetSlots(state.data.settings);
    document.querySelectorAll('[data-due-slot]').forEach((chip) => {
        const slot = slots[Number(chip.dataset.dueSlot)];
        if (!slot) return;
        const label = DUE_PRESET_LABELS[slot.kind] || '自定义';
        chip.textContent = `${label} ${slot.time}`;
        const todayPassed = slot.kind === 'today' && isTodayPresetPassed(slot.time);
        chip.disabled = todayPassed;
        chip.title = todayPassed ? `今天 ${slot.time} 已过，不可选择` : `设置${label} ${slot.time} 到期`;
    });
}

function isTodayPresetPassed(time) {
    const { h, m } = splitPresetTime(time, DEFAULT_DUE_PRESETS.today);
    const cutoff = new Date();
    cutoff.setHours(h, m, 0, 0);
    return Date.now() >= cutoff.getTime();
}

// —— 设置页「快捷提醒时间」：所见即所得芯片 + 内联编辑器 ——
let dueSlotEditingIndex = -1;

export function getDueSlotEditing() {
    return dueSlotEditingIndex;
}

export function setDueSlotEditing(index) {
    dueSlotEditingIndex = Number(index);
    renderDueSlotSettings();
}

export function closeDueSlotEditor() {
    dueSlotEditingIndex = -1;
    renderDueSlotSettings();
}

export function renderDueSlotSettings() {
    const slots = getDuePresetSlots(state.data.settings);
    elements.dueSlotChips.forEach((chip, index) => {
        const slot = slots[index];
        if (!slot) return;
        chip.textContent = `${DUE_PRESET_LABELS[slot.kind] || '自定义'} ${slot.time}`;
        chip.classList.toggle('is-editing', index === dueSlotEditingIndex);
    });
    if (!elements.dueSlotEditor) return;
    if (dueSlotEditingIndex >= 0) {
        const slot = slots[dueSlotEditingIndex];
        if (slot) {
            elements.dueSlotEditor.hidden = false;
            if (elements.dueSlotEditorKind) elements.dueSlotEditorKind.value = slot.kind;
            if (elements.dueSlotEditorTime) elements.dueSlotEditorTime.value = slot.time;
        }
    } else {
        elements.dueSlotEditor.hidden = true;
    }
}

export function showPanel() {
    // 桌面客户端面板常驻，不存在展开动作
    if (isDesktopMode()) return;
    clearPanelCloseTimer();
    state.ui.isPanelOpen = true;
    // 广播面板展开（首次启动引导等监听方据此显示）
    window.dispatchEvent(new CustomEvent('todo:panel-opened'));
    state.ui.ignoreBlurUntil = Date.now() + 600;
    state.ui.currentView = 'active';
    elements.edgeStrip.hidden = true;
    elements.appShell.style.visibility = 'hidden';
    elements.appShell.classList.remove('is-collapsed', 'is-closing');
    elements.appShell.classList.add('is-opening');
    elements.panelStage.hidden = false;
    setFeatureMenuOpen(false);
    // 面板收起期间可能有待办过期：打开时强制重算徽章颜色
    renderActiveTodos();
    updateDuePresetChips();
    renderViews();
    saveLocalUiSettings();
    startPanelFocusWatch();
    void elements.appShell.offsetWidth;

    window.requestAnimationFrame(() => {
        // 先让「隐藏侧边条」的状态完整上屏一帧，再请求改窗口尺寸：
        // 否则主进程移动贴边窗口时 DWM 会拿上一帧（还画着侧边条）跟随窗口平移，
        // 视觉上侧边条内容向左漂移一帧后才消失
        window.requestAnimationFrame(() => {
            applyWindowLayout('expanded');
            window.requestAnimationFrame(() => {
                elements.appShell.style.visibility = 'visible';
                elements.appShell.classList.remove('is-opening');
                elements.appShell.classList.add('is-expanded');
                focusComposer();
            });
        });
    });
}

export function openPanelWithLatestData() {
    if (state.ui.isPanelOpen) return;
    showPanel();
}

// 桌面客户端：面板常驻展开启动，无贴边条、无失焦收起、无窗口尺寸联动
export function enterDesktopPanel() {
    state.ui.isPanelOpen = true;
    // 广播面板展开（首次启动引导等监听方据此显示）
    window.dispatchEvent(new CustomEvent('todo:panel-opened'));
    state.ui.currentView = 'active';
    elements.edgeStrip.hidden = true;
    elements.panelStage.hidden = false;
    elements.appShell.style.visibility = 'visible';
    elements.appShell.classList.remove('is-collapsed', 'is-closing', 'is-opening');
    elements.appShell.classList.add('is-expanded');
    setFeatureMenuOpen(false);
    renderView();
    focusComposer();
}

export function closePanel() {
    if (isDesktopMode()) return;
    if (!state.ui.isPanelOpen) return;
    clearToasts();
    clearSortState();
    stopPanelFocusWatch();
    clearPanelCloseTimer();
    state.ui.ignoreBlurUntil = 0;
    state.ui.isPanelOpen = false;
    // 广播面板收起（首次启动引导据此一并关闭并视为已读）
    window.dispatchEvent(new CustomEvent('todo:panel-closed'));
    state.ui.currentView = 'active';
    // 面板收起时直接丢弃未确认的到期编辑
    state.ui.editingDueId = null;
    state.ui.editingDueDraft = null;
    if (elements.duePopover) {
        elements.duePopover.hidden = true;
        delete elements.duePopover.dataset.todoId;
    }
    elements.appShell.style.visibility = 'visible';
    elements.appShell.classList.remove('is-expanded', 'is-opening');
    elements.appShell.classList.add('is-closing');
    setFeatureMenuOpen(false);
    renderViews();
    saveLocalUiSettings();

    panelCloseTimer = window.setTimeout(() => {
        elements.panelStage.hidden = true;
        applyWindowLayout('collapsed');
        elements.appShell.classList.remove('is-closing');
        elements.edgeStrip.hidden = false;
        panelCloseTimer = null;
    }, 140);
}

export function switchView(viewName) {
    state.ui.currentView = VIEWS.includes(viewName) ? viewName : 'active';
    setFeatureMenuOpen(false);
    renderViews();
    saveLocalUiSettings();
}
