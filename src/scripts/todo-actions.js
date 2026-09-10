import { state, elements, createId, resetDueReminder, toDateInputValue, persist } from './core.js';
import { getRepositories } from './storage/index.js';
import { showToast, renderView, syncView, focusComposer, clearDueDraft } from './ui.js';

const repo = () => getRepositories();

function closeDueEditor() {
    state.ui.editingDueId = null;
    state.ui.editingDueDraft = null;
}

function readDueEditDraft() {
    const dateValue = elements.duePopoverDate?.value || '';
    const timeValue = elements.duePopoverTime?.value || '';
    let draft = state.ui.editingDueDraft;
    if (dateValue) {
        // 只选了日期没选时间时按 09:00 处理
        const parsed = Date.parse(`${dateValue}T${/^\d{2}:\d{2}/.test(timeValue) ? timeValue : '09:00'}`);
        if (Number.isFinite(parsed)) draft = parsed;
    } else if (timeValue && Number.isFinite(draft)) {
        // 只改了时间：沿用原日期
        const parsed = Date.parse(`${toDateInputValue(draft)}T${timeValue}`);
        if (Number.isFinite(parsed)) draft = parsed;
    }
    return draft;
}

export function startDueEdit(todoId) {
    const todo = state.data.todos.find((item) => item.id === todoId);
    if (!todo) return;
    if (state.ui.editingTodoId && state.ui.editingTodoId !== todoId) {
        commitEditTodo(state.ui.editingTodoId);
    }
    state.ui.editingTodoId = null;
    state.ui.editingTodoDraft = '';
    state.ui.editingDueId = todoId;
    state.ui.editingDueDraft = Number.isFinite(todo.dueAt) ? todo.dueAt : null;
    renderView();
}

export function saveDueEdit(todoId) {
    if (state.ui.editingDueId !== todoId) return;
    const todo = state.data.todos.find((item) => item.id === todoId);
    // 保存时以弹窗输入框实时值为准，避免 change 事件时序导致误清除
    const draft = readDueEditDraft();
    closeDueEditor();
    if (!todo) {
        renderView();
        return;
    }
    if (Number.isFinite(draft)) {
        todo.dueAt = draft;
        if (draft <= Date.now()) {
            // 已过期的到期时间不参与弹窗提醒
            todo.remindedAt = Date.now();
            syncView();
            persist(repo().todos.update(todo), '到期时间保存失败，请重试');
            showToast('到期时间已过期，不进行提醒', 'error');
            return;
        }
        // 改为未过期时间，重新参与提醒
        resetDueReminder(todoId);
        syncView();
        persist(repo().todos.update(todo), '到期时间保存失败，请重试');
        showToast('到期时间已更新');
        return;
    }
    // 未选择时间则保留原状，清除请使用清除按钮
    renderView();
    showToast('未选择到期时间，已保留原到期时间', 'error');
}

export function clearDueEdit(todoId) {
    if (state.ui.editingDueId !== todoId) return;
    const todo = state.data.todos.find((item) => item.id === todoId);
    closeDueEditor();
    if (!todo) {
        renderView();
        return;
    }
    delete todo.dueAt;
    resetDueReminder(todoId);
    syncView();
    persist(repo().todos.update(todo), '到期时间保存失败，请重试');
    showToast('已清除到期时间');
}

export function cancelDueEdit() {
    if (!state.ui.editingDueId) return;
    closeDueEditor();
    renderView();
}

// 读取时间面板当前显示的到期时间；未选日期时回退到之前选定的草稿
function readComposerDueValue() {
    const dateValue = elements.dueDateInput?.value || '';
    const timeValue = elements.dueTimeInput?.value || '';
    if (!dateValue) {
        return Number.isFinite(state.ui.dueDraft) ? state.ui.dueDraft : null;
    }
    const parsed = Date.parse(`${dateValue}T${/^\d{2}:\d{2}/.test(timeValue) ? timeValue : '09:00'}`);
    return Number.isFinite(parsed) ? parsed : null;
}

export function addTodo(text) {
    const value = text.trim();
    if (!value) {
        showToast('请输入待办内容', 'error');
        return;
    }
    // 时间面板打开时以面板显示的日期时间为准，未打开则沿用之前选定的草稿
    const dueAt = state.ui.dueDraftVisible
        ? readComposerDueValue()
        : Number.isFinite(state.ui.dueDraft)
          ? state.ui.dueDraft
          : null;
    const expired = Number.isFinite(dueAt) && dueAt <= Date.now();
    const todo = { id: createId(), text: value, createdAt: Date.now(), ...(Number.isFinite(dueAt) ? { dueAt } : {}) };
    // 已过期的到期时间不参与弹窗提醒
    if (expired) todo.remindedAt = Date.now();
    state.data.todos.unshift(todo);
    persist(repo().todos.create(todo), '待办保存失败，请重试');
    clearDueDraft();
    elements.addTodoInput.value = '';
    syncView();
    showToast(expired ? '待办已添加，到期时间已过期，不进行提醒' : '待办已添加');
    focusComposer();
}

// 时间面板中的「设置并添加待办」：以面板当前显示的日期时间为到期时间直接添加
export function addTodoWithDue() {
    const value = elements.addTodoInput.value.trim();
    if (!value) {
        showToast('请输入待办内容', 'error');
        return;
    }
    if (!elements.dueDateInput?.value) {
        showToast('请选择到期日期', 'error');
        return;
    }
    const dueAt = readComposerDueValue();
    if (!Number.isFinite(dueAt)) {
        showToast('到期时间无效，请重新选择', 'error');
        return;
    }
    const expired = dueAt <= Date.now();
    const todo = { id: createId(), text: value, createdAt: Date.now(), dueAt };
    // 已过期的到期时间不参与弹窗提醒
    if (expired) todo.remindedAt = Date.now();
    state.data.todos.unshift(todo);
    persist(repo().todos.create(todo), '待办保存失败，请重试');
    clearDueDraft();
    elements.addTodoInput.value = '';
    syncView();
    showToast(expired ? '待办已添加，到期时间已过期，不进行提醒' : '待办已添加');
    focusComposer();
}

export function completeTodo(todoId) {
    const index = state.data.todos.findIndex((todo) => todo.id === todoId);
    if (index < 0) return;
    const [todo] = state.data.todos.splice(index, 1);
    if (state.ui.editingTodoId === todoId) {
        state.ui.editingTodoId = null;
        state.ui.editingTodoDraft = '';
        state.ui.skipEditCommitOnce = false;
    }
    if (state.ui.editingDueId === todoId) closeDueEditor();
    const completedRecord = { id: todo.id, text: todo.text, createdAt: todo.createdAt, completedAt: Date.now() };
    state.data.completed.unshift(completedRecord);
    persist(repo().todos.complete(todoId, completedRecord.completedAt), '待办保存失败，请重试');
    syncView();
    showToast('任务已完成');
}

export function deleteTodo(todoId) {
    const index = state.data.todos.findIndex((todo) => todo.id === todoId);
    if (index < 0) return;
    state.data.todos.splice(index, 1);
    if (state.ui.editingTodoId === todoId) {
        state.ui.editingTodoId = null;
        state.ui.editingTodoDraft = '';
        state.ui.skipEditCommitOnce = false;
    }
    if (state.ui.editingDueId === todoId) closeDueEditor();
    persist(repo().todos.remove(todoId), '待办删除失败，请重试');
    syncView();
    showToast('待办已删除');
}

export function startEditTodo(todoId) {
    const todo = state.data.todos.find((item) => item.id === todoId);
    if (!todo) return;
    closeDueEditor();
    state.ui.editingTodoId = todoId;
    state.ui.editingTodoDraft = todo.text;
    state.ui.skipEditCommitOnce = false;
    renderView();
}

export function updateEditingDraft(value) {
    if (!state.ui.editingTodoId) return;
    state.ui.editingTodoDraft = value;
}

export function commitEditTodo(todoId) {
    if (!todoId || state.ui.editingTodoId !== todoId) return false;
    const index = state.data.todos.findIndex((todo) => todo.id === todoId);
    if (index < 0) return false;

    const value = state.ui.editingTodoDraft.trim();
    if (!value) {
        showToast('请输入待办内容', 'error');
        return false;
    }

    state.data.todos[index] = { ...state.data.todos[index], text: value };
    state.ui.editingTodoId = null;
    state.ui.editingTodoDraft = '';
    state.ui.skipEditCommitOnce = false;
    persist(repo().todos.update(state.data.todos[index]), '待办保存失败，请重试');
    syncView();
    showToast('待办已更新');
    return true;
}

export function cancelEditTodo(todoId) {
    if (!todoId || state.ui.editingTodoId !== todoId) return;
    state.ui.editingTodoId = null;
    state.ui.editingTodoDraft = '';
    state.ui.skipEditCommitOnce = true;
    renderView();
}

export function restoreCompleted(todoId) {
    const index = state.data.completed.findIndex((todo) => todo.id === todoId);
    if (index < 0) return;
    const [todo] = state.data.completed.splice(index, 1);
    state.data.todos.unshift({ id: todo.id, text: todo.text, createdAt: todo.createdAt });
    persist(repo().todos.restore(todoId), '待办恢复失败，请重试');
    syncView();
    showToast('已恢复为未完成');
}

export function deleteCompleted(todoId) {
    const index = state.data.completed.findIndex((todo) => todo.id === todoId);
    if (index < 0) return;
    state.data.completed.splice(index, 1);
    persist(repo().todos.remove(todoId), '记录删除失败，请重试');
    syncView();
    showToast('已删除完成记录');
}
