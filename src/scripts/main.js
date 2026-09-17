import {
    state,
    sortState,
    elements,
    host,
    bootstrapAppData,
    applyStoredData,
    normalizeUserProfile,
    normalizeMembershipStatus,
    applyThemeSettings,
    persistThemeSettings,
    saveLocalUiSettings,
    applyWindowLayout,
    setSaveErrorHandler,
    persist,
    startDueReminderLoop,
    toDateInputValue,
    normalizePresetTimeText,
    getDuePresetSlots,
    buildThemeColors,
    resolveAppearanceMode,
    isDesktopMode
} from './core.js';
import { getRepositories } from './storage/index.js';
import { getUserProvider } from './user/index.js';
import { maybeRunOnboarding, replayOnboarding } from './onboarding.js';
import { exportTodoData, importTodoData, primeFileDialogGuard } from './data-transfer.js';
import {
    addTodo,
    addTodoWithDue,
    completeTodo,
    deleteTodo,
    startEditTodo,
    updateEditingDraft,
    commitEditTodo,
    cancelEditTodo,
    restoreCompleted,
    deleteCompleted,
    startDueEdit,
    saveDueEdit,
    clearDueEdit,
    cancelDueEdit
} from './todo-actions.js';
import {
    updateSidebarSettings,
    updateThemeSettings,
    previewThemeSettings,
    syncColorText,
    applyColorText,
    openConfirmDialog,
    closeConfirmDialog,
    openAboutDialog,
    closeAboutDialog,
    clearExpiredCompleted,
    refreshAutoLaunchState,
    setAutoLaunch
} from './settings-actions.js';
import {
    showToast,
    renderActiveTodos,
    renderCompletedTodos,
    syncView,
    setFeatureMenuOpen,
    switchView,
    openPanelWithLatestData,
    requestClosePanel,
    attachSortMouseListeners,
    closePanel,
    enterDesktopPanel,
    renderDueDraft,
    setDueDraftVisible,
    applyDuePreset,
    clearDueDraft,
    applyDueEditPreset,
    syncDuePopover,
    syncTodoListOverflow,
    updateDuePresetChips,
    renderDueSlotSettings
} from './ui.js';

export function bindEvents() {
    elements.edgeStrip.addEventListener('click', () => {
        if (state.ui.isPanelOpen) return;
        void openPanelWithLatestData();
    });
    elements.panelOverlay.addEventListener('click', () => requestClosePanel());
    // 输入框没有内容时，到期时间按钮不可用
    const updateDueToggleState = () => {
        if (!elements.dueToggleBtn) return;
        const hasText = Boolean(elements.addTodoInput.value.trim());
        elements.dueToggleBtn.disabled = !hasText;
        elements.dueToggleBtn.title = hasText ? '到期提醒' : '请先输入待办内容';
        if (elements.dueAddBtn) {
            elements.dueAddBtn.disabled = !hasText;
            elements.dueAddBtn.title = hasText ? '按面板时间添加待办' : '请先输入待办内容';
        }
    };
    elements.addTodoInput.addEventListener('input', updateDueToggleState);

    elements.addTodoBtn.addEventListener('click', () => {
        addTodo(elements.addTodoInput.value);
        updateDueToggleState();
    });
    elements.addTodoInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            addTodo(elements.addTodoInput.value);
            updateDueToggleState();
        }
    });
    elements.dueAddBtn?.addEventListener('click', () => {
        addTodoWithDue();
        updateDueToggleState();
    });

    elements.dueToggleBtn?.addEventListener('click', () => setDueDraftVisible(!state.ui.dueDraftVisible));
    elements.dueClearBtn?.addEventListener('click', () => clearDueDraft());
    elements.dueRow?.querySelectorAll('[data-due-slot]').forEach((chip) => {
        chip.addEventListener('click', () => applyDuePreset(Number(chip.dataset.dueSlot)));
    });
    const syncComposerDueDraft = () => {
        const dateValue = elements.dueDateInput?.value || '';
        const timeValue = elements.dueTimeInput?.value || '';
        if (dateValue) {
            const parsed = Date.parse(`${dateValue}T${/^\d{2}:\d{2}/.test(timeValue) ? timeValue : '09:00'}`);
            state.ui.dueDraft = Number.isFinite(parsed) ? parsed : null;
        } else if (!timeValue) {
            state.ui.dueDraft = null;
        } else if (Number.isFinite(state.ui.dueDraft)) {
            const parsed = Date.parse(`${toDateInputValue(state.ui.dueDraft)}T${timeValue}`);
            if (Number.isFinite(parsed)) state.ui.dueDraft = parsed;
        }
        renderDueDraft();
    };
    elements.dueDateInput?.addEventListener('change', syncComposerDueDraft);
    elements.dueTimeInput?.addEventListener('change', syncComposerDueDraft);
    // 滚轮步进：与到期弹窗一致
    const bindComposerWheel = (input) => {
        if (!input) return;
        input.addEventListener(
            'wheel',
            (event) => {
                event.preventDefault();
                if (event.deltaY < 0) input.stepUp();
                else input.stepDown();
                input.dispatchEvent(new Event('change'));
            },
            { passive: false }
        );
    };
    bindComposerWheel(elements.dueDateInput);
    bindComposerWheel(elements.dueTimeInput);

    // 未完成待办筛选：全部/过期/今天/明天/本周
    elements.todoFilterChips.forEach((chip) => {
        chip.addEventListener('click', () => {
            if (state.ui.todoFilter === chip.dataset.todoFilter) return;
            state.ui.todoFilter = chip.dataset.todoFilter;
            renderActiveTodos();
            saveLocalUiSettings();
        });
    });

    elements.featureButton.addEventListener('click', (event) => {
        event.stopPropagation();
        setFeatureMenuOpen(!state.ui.isFeatureMenuOpen);
    });
    elements.featureMenuItems.forEach((item) => {
        item.addEventListener('click', () => switchView(item.dataset.viewTarget));
    });

    elements.exitAppButton?.addEventListener('click', () => {
        host?.exitApp?.();
    });

    elements.todoList.addEventListener('click', (event) => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        const { action, todoId } = button.dataset;
        if (action === 'complete') completeTodo(todoId);
        if (action === 'delete') deleteTodo(todoId);
        if (action === 'due-edit') startDueEdit(todoId);
    });

    elements.todoList.addEventListener('dblclick', (event) => {
        const trigger = event.target.closest('[data-edit-trigger]');
        if (!trigger) return;
        const todoId = trigger.dataset.editTrigger;
        if (!todoId || state.ui.editingTodoId === todoId) return;
        startEditTodo(todoId);
    });

    // 到期弹窗（面板级悬浮层）
    elements.duePopover?.querySelectorAll('[data-due-slot]').forEach((chip) => {
        chip.addEventListener('click', () => applyDueEditPreset(Number(chip.dataset.dueSlot)));
    });
    const syncDueEditDraft = () => {
        if (!state.ui.editingDueId) return;
        const dateValue = elements.duePopoverDate?.value || '';
        const timeValue = elements.duePopoverTime?.value || '';
        if (dateValue) {
            const parsed = Date.parse(`${dateValue}T${/^\d{2}:\d{2}/.test(timeValue) ? timeValue : '09:00'}`);
            state.ui.editingDueDraft = Number.isFinite(parsed) ? parsed : null;
        } else if (!timeValue) {
            state.ui.editingDueDraft = null;
        }
    };
    elements.duePopoverDate?.addEventListener('change', syncDueEditDraft);
    elements.duePopoverTime?.addEventListener('change', syncDueEditDraft);
    // 滚轮步进选择：时间 ±1 分钟，日期 ±1 天
    const bindDueWheel = (input) => {
        if (!input) return;
        input.addEventListener(
            'wheel',
            (event) => {
                event.preventDefault();
                if (event.deltaY < 0) input.stepUp();
                else input.stepDown();
                input.dispatchEvent(new Event('change'));
            },
            { passive: false }
        );
    };
    bindDueWheel(elements.duePopoverDate);
    bindDueWheel(elements.duePopoverTime);
    elements.duePopoverCancel?.addEventListener('click', () => cancelDueEdit());
    elements.duePopoverConfirm?.addEventListener('click', () => {
        if (state.ui.editingDueId) saveDueEdit(state.ui.editingDueId);
    });
    // 弹层内按 Enter 等同确认（焦点在日期/时间输入框时生效；按钮上回车走原生点击，避免重复保存）
    elements.duePopover?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.target.closest('button')) return;
        if (!state.ui.editingDueId) return;
        event.preventDefault();
        saveDueEdit(state.ui.editingDueId);
    });
    elements.duePopoverDelete?.addEventListener('click', () => {
        if (state.ui.editingDueId) clearDueEdit(state.ui.editingDueId);
    });
    // 列表滚动时弹窗跟随锚点条目
    elements.todoList.addEventListener(
        'scroll',
        () => {
            syncDuePopover();
            syncTodoListOverflow();
        },
        { passive: true }
    );

    elements.todoList.addEventListener('input', (event) => {
        const input = event.target.closest('[data-edit-input]');
        if (!input) return;
        updateEditingDraft(input.value);
    });

    elements.todoList.addEventListener('focusout', (event) => {
        const input = event.target.closest('[data-edit-input]');
        if (!input) return;
        if (state.ui.skipEditCommitOnce) {
            state.ui.skipEditCommitOnce = false;
            return;
        }
        const committed = commitEditTodo(input.dataset.editInput);
        if (!committed) window.requestAnimationFrame(() => input.focus());
    });

    elements.todoList.addEventListener('keydown', (event) => {
        const input = event.target.closest('[data-edit-input]');
        if (!input) return;
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            commitEditTodo(input.dataset.editInput);
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancelEditTodo(input.dataset.editInput);
        }
    });

    elements.todoList.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return;
        if (state.ui.editingTodoId) return;
        // 仅「全部」筛选下允许拖动排序
        if (state.ui.todoFilter !== 'all') return;
        const handle = event.target.closest('[data-sort-handle]');
        if (!handle) return;
        const item = handle.closest('.todo-item');
        if (!item) return;
        sortState.draggingTodoId = handle.dataset.sortHandle;
        sortState.startX = event.clientX;
        sortState.startY = event.clientY;
        sortState.sourceIndex = state.data.todos.findIndex((todo) => todo.id === sortState.draggingTodoId);
        sortState.itemEl = item;
        sortState.handleEl = handle;
        sortState.isDragging = false;
        attachSortMouseListeners();
        event.preventDefault();
    });

    elements.completedList.addEventListener('click', (event) => {
        const button = event.target.closest('[data-completed-action]');
        if (!button) return;
        const { completedAction, todoId } = button.dataset;
        if (completedAction === 'restore') restoreCompleted(todoId);
        if (completedAction === 'delete') deleteCompleted(todoId);
    });

    elements.completedFilterButtons.forEach((button) => {
        button.addEventListener('click', () => {
            state.ui.completedFilter = button.dataset.completedFilter;
            renderCompletedTodos();
            saveLocalUiSettings();
        });
    });

    elements.backButtons.forEach((button) => {
        button.addEventListener('click', () => switchView(button.dataset.backTo));
    });

    elements.displaySelect.addEventListener('change', (event) => {
        updateSidebarSettings({ displayId: event.target.value });
        showToast('目标屏幕已保存');
    });
    elements.sideSelect.addEventListener('change', (event) => {
        updateSidebarSettings({ side: event.target.value });
        showToast(event.target.value === 'left' ? '左侧停靠已保存' : '右侧停靠已保存');
    });

    /*
    elements.appearanceModeSelect.addEventListener('change', (event) => {
        const labelMap = {
            light: '已切换到白天模式',
            dark: '已切换到夜间模式',
            system: '已切换为跟随系统'
        };
        updateThemeSettings({ appearanceMode: event.target.value }, labelMap[event.target.value] || '界面模式已更新');
    });
    */
    elements.appearanceModeGroup.addEventListener('click', (event) => {
        const button = event.target.closest('[data-appearance-mode]');
        if (!button || button.disabled) return;
        const labelMap = {
            light: '已切换到浅色模式',
            dark: '已切换到深色模式',
            system: '已切换为跟随系统'
        };
        updateThemeSettings(
            { appearanceMode: button.dataset.appearanceMode },
            labelMap[button.dataset.appearanceMode] || '界面模式已更新'
        );
    });
    elements.themeModeSelect.addEventListener('change', (event) => {
        updateThemeSettings(
            { themeMode: event.target.value },
            event.target.value === 'preset' ? '已切换到预设主题' : '已切换到自定义颜色'
        );
    });
    elements.presetThemeSelect.addEventListener('change', (event) => {
        updateThemeSettings({ presetThemeId: event.target.value }, '预设主题已保存');
    });
    elements.customPrimaryInput.addEventListener('input', () => {
        syncColorText(elements.customPrimaryInput, elements.customPrimaryText);
        previewThemeSettings({ customPrimary: elements.customPrimaryInput.value.toLowerCase() });
    });
    elements.customPrimaryInput.addEventListener('change', () => {
        updateThemeSettings({ customPrimary: elements.customPrimaryInput.value.toLowerCase() }, '主色已更新');
    });
    elements.customSecondaryInput.addEventListener('input', () => {
        syncColorText(elements.customSecondaryInput, elements.customSecondaryText);
        previewThemeSettings({ customSecondary: elements.customSecondaryInput.value.toLowerCase() });
    });
    elements.customSecondaryInput.addEventListener('change', () => {
        updateThemeSettings({ customSecondary: elements.customSecondaryInput.value.toLowerCase() }, '辅助色已更新');
    });
    elements.customPrimaryText.addEventListener('change', () => {
        applyColorText(elements.customPrimaryText, elements.customPrimaryInput, 'customPrimary', '主色');
    });
    elements.customSecondaryText.addEventListener('change', () => {
        applyColorText(elements.customSecondaryText, elements.customSecondaryInput, 'customSecondary', '辅助色');
    });

    elements.cleanupHistoryButton?.addEventListener('click', () => openConfirmDialog());

    // 开机自启开关：点击即切换，实际状态由主进程返回后校正
    elements.autoLaunchToggle?.addEventListener('click', () => {
        setAutoLaunch(!elements.autoLaunchToggle.classList.contains('is-on'));
    });

    // 重新观看首次引导：清除标记并重载页面
    elements.replayOnboardingButton?.addEventListener('click', () => {
        replayOnboarding();
    });

    // 快捷提醒时间设置：4 行「天数下拉 + 时间输入」，改动立即持久化
    const persistDueSlotEdits = () => {
        const slots = getDuePresetSlots(state.data.settings).map((slot) => ({ ...slot }));
        let changed = false;
        elements.dueSlotDaySelects.forEach((select, index) => {
            if (!slots[index] || slots[index].kind === select.value) return;
            slots[index].kind = select.value;
            changed = true;
        });
        elements.dueSlotTimeInputs.forEach((input, index) => {
            if (!slots[index]) return;
            const time = normalizePresetTimeText(input.value, slots[index].time);
            if (slots[index].time === time) return;
            slots[index].time = time;
            changed = true;
        });
        if (!changed) return;
        persistThemeSettings({ ...state.data.settings, dueSlots: slots });
        updateDuePresetChips();
        renderDueSlotSettings();
        showToast('快捷提醒时间已保存');
    };
    elements.dueSlotDaySelects.forEach((select) => select?.addEventListener('change', persistDueSlotEdits));
    elements.dueSlotTimeInputs.forEach((input) => input?.addEventListener('change', persistDueSlotEdits));
    elements.exportDataButton?.addEventListener('click', () => {
        void exportTodoData();
    });
    elements.importDataButton?.addEventListener('click', () => {
        primeFileDialogGuard();
        elements.importDataInput?.click();
    });
    elements.importDataInput?.addEventListener('change', (event) => {
        void importTodoData(event.target.files?.[0] || null);
    });
    elements.confirmDialogCancel?.addEventListener('click', () => closeConfirmDialog());
    elements.confirmDialogConfirm?.addEventListener('click', () => clearExpiredCompleted());

    // —— 关于弹窗（作者信息 / GitHub / 赞助）——
    elements.headerCount?.addEventListener('click', () => openAboutDialog());
    elements.aboutDialogClose?.addEventListener('click', () => closeAboutDialog());
    elements.aboutDialogBackdrop?.addEventListener('click', () => closeAboutDialog());
    elements.aboutGithubLink?.addEventListener('click', (event) => {
        // 桌面端走系统浏览器打开；浏览器兜底环境保留默认 <a> 行为
        if (typeof host?.openExternal === 'function') {
            event.preventDefault();
            host.openExternal(elements.aboutGithubLink.href);
        }
    });

    document.addEventListener('click', (event) => {
        if (!state.ui.isFeatureMenuOpen) return;
        if (event.target.closest('#featureMenu') || event.target.closest('#featureButton')) return;
        setFeatureMenuOpen(false);
    });

    // 点击到期弹窗外部：直接关闭，不保存(仅确认按钮生效)
    document.addEventListener('click', (event) => {
        if (!state.ui.editingDueId) return;
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('.due-popover')) return;
        if (event.target.closest('[data-action="due-edit"]')) return;
        cancelDueEdit();
    });

    document.addEventListener('keydown', (event) => {
        if (state.ui.editingTodoId && event.target.closest('[data-edit-input]')) return;
        if (event.key !== 'Escape') return;
        if (state.ui.isAboutDialogOpen) {
            closeAboutDialog();
            return;
        }
        if (state.ui.isConfirmDialogOpen) {
            closeConfirmDialog();
            return;
        }
        if (state.ui.isFeatureMenuOpen) {
            setFeatureMenuOpen(false);
            return;
        }
        if (state.ui.editingDueId) {
            cancelDueEdit();
            return;
        }
        if (state.ui.currentView !== 'active' && state.ui.isPanelOpen) {
            switchView('active');
            return;
        }
        if (state.ui.isPanelOpen) {
            requestClosePanel();
        }
    });

    // 桌面客户端面板常驻：失焦/隐藏不收起面板（操作级持久化下无需冲刷保存）
    window.addEventListener('blur', () => {
        if (isDesktopMode()) return;
        requestClosePanel({ respectIgnoreBlur: true });
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') return;
        if (!isDesktopMode()) requestClosePanel({ respectIgnoreBlur: true });
    });
    window.addEventListener('resize', () => {
        applyWindowLayout(state.ui.isPanelOpen ? 'expanded' : 'collapsed');
        syncDuePopover();
        syncTodoListOverflow();
    });
    updateDueToggleState();
}

export async function init() {
    setSaveErrorHandler((message) => showToast(message, 'error'));
    // 用户与会员走用户接口（当前为本地默认实现），与待办数据加载并行
    const userProvider = getUserProvider();
    const [snapshot, profile, membershipStatus] = await Promise.all([
        bootstrapAppData(),
        userProvider.getProfile(),
        userProvider.getMembershipStatus()
    ]);
    applyStoredData(snapshot.data, { dock: snapshot.dock });
    applyThemeSettings(snapshot.settings);
    if (window.matchMedia) {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const syncSystemAppearance = () => {
            if (state.data.settings.appearanceMode !== 'system') return;
            applyThemeSettings(state.data.settings);
        };
        if (typeof media.addEventListener === 'function') media.addEventListener('change', syncSystemAppearance);
        else if (typeof media.addListener === 'function') media.addListener(syncSystemAppearance);
    }
    state.data.user = normalizeUserProfile(profile);
    state.data.membership = normalizeMembershipStatus(membershipStatus);
    void refreshAutoLaunchState();
    syncView();
    bindEvents();
    elements.edgeStrip.hidden = false;
    // 提醒窗内关闭单条/全部时,同步清理侧边栏的累计列表
    const onReminderDismiss = (id) => {
        state.ui.pendingReminders = state.ui.pendingReminders.filter((item) => item.id !== id);
    };
    const onReminderEmpty = () => {
        state.ui.pendingReminders = [];
    };
    host?.onReminderEvent?.('dismiss', onReminderDismiss);
    host?.onReminderEvent?.('empty', onReminderEmpty);
    startDueReminderLoop((dueTodos) => {
        const known = new Set(state.ui.pendingReminders.map((item) => item.id));
        dueTodos.forEach((todo) => {
            if (!known.has(todo.id)) {
                state.ui.pendingReminders.push({ id: todo.id, text: todo.text, dueAt: todo.dueAt });
            }
        });
        // 剔除已完成/已删除的待办
        const activeIds = new Set(state.data.todos.map((todo) => todo.id));
        state.ui.pendingReminders = state.ui.pendingReminders.filter((item) => activeIds.has(item.id));
        const colors = buildThemeColors(state.data.settings);
        const delivered =
            host?.showDueReminders?.(state.ui.pendingReminders, {
                appearance: resolveAppearanceMode(state.data.settings),
                primary: colors.primary,
                primaryBright: colors.primaryBright
            }) === true;
        // 交付成功才标记 remindedAt，失败时下个周期自动重试
        if (delivered) {
            const stamp = Date.now();
            dueTodos.forEach((todo) => {
                todo.remindedAt = stamp;
                persist(getRepositories().todos.update(todo), '提醒状态保存失败，请重试');
            });
        }
    });
    if (isDesktopMode()) {
        document.body.dataset.mode = 'desktop';
        enterDesktopPanel();
        maybeRunOnboarding();
        return;
    }
    elements.edgeStrip.hidden = false;
    closePanel();
    maybeRunOnboarding();
}
