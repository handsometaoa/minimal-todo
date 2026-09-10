import {
    state,
    elements,
    host,
    getExportPayload,
    normalizeData,
    normalizeThemeSettings,
    persistThemeSettings,
    hasMembershipAccess,
    persist
} from './core.js';
import { getRepositories } from './storage/index.js';
import { showToast, syncView, updateDuePresetChips } from './ui.js';

const FILE_DIALOG_GUARD_MS = 10000;

export function primeFileDialogGuard(durationMs = FILE_DIALOG_GUARD_MS) {
    state.ui.ignoreBlurUntil = Math.max(state.ui.ignoreBlurUntil, Date.now() + durationMs);
}

function formatExportFileName(timestamp = Date.now()) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return `minimal-todo-export-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.json`;
}

async function saveWithFilePicker(fileName, content) {
    if (typeof window.showSaveFilePicker !== 'function') return false;

    primeFileDialogGuard();
    const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
            {
                description: 'JSON Files',
                accept: { 'application/json': ['.json'] }
            }
        ]
    });
    const writable = await handle.createWritable();
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    await writable.write(blob);
    await writable.close();
    const savedFile = typeof handle.getFile === 'function' ? await handle.getFile() : null;
    if (savedFile && savedFile.size <= 0) throw new Error('Saved file is empty');
    return true;
}

function triggerBrowserDownload(fileName, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseImportedPayload(rawText) {
    const parsed = JSON.parse(rawText);
    // 兼容两种形态：v2 完整包 {data, settings}；v1/裸包 {todos, completed}
    const source = parsed?.data && typeof parsed.data === 'object' ? parsed : { data: parsed };
    const settings =
        source.settings && typeof source.settings === 'object' ? normalizeThemeSettings(source.settings) : null;
    return { data: normalizeData(source.data), settings };
}

function mergeImportedData(importedData) {
    const importedCompletedMap = new Map();
    importedData.completed.forEach((todo) => {
        if (!todo?.id) return;
        importedCompletedMap.set(todo.id, todo);
    });

    const importedTodoMap = new Map();
    importedData.todos.forEach((todo) => {
        if (!todo?.id || importedCompletedMap.has(todo.id)) return;
        importedTodoMap.set(todo.id, todo);
    });

    const importedIds = new Set([...importedTodoMap.keys(), ...importedCompletedMap.keys()]);
    state.data.todos = state.data.todos
        .filter((todo) => todo?.id && !importedIds.has(todo.id))
        .concat(Array.from(importedTodoMap.values()));
    state.data.completed = state.data.completed
        .filter((todo) => todo?.id && !importedIds.has(todo.id))
        .concat(Array.from(importedCompletedMap.values()));
}

async function readImportFile(file) {
    if (!file) return null;
    return file.text();
}

function getCurrentDataSnapshot() {
    return normalizeData({
        todos: state.data.todos,
        completed: state.data.completed
    });
}

function hasAnyTodoData(data) {
    return (
        (Array.isArray(data?.todos) && data.todos.length > 0) ||
        (Array.isArray(data?.completed) && data.completed.length > 0)
    );
}

export async function exportTodoData() {
    if (!hasMembershipAccess()) {
        showToast('未开通 SVIP，无法使用数据导出权益', 'error');
        return;
    }
    // 保存对话框会让窗口失焦：先武装防收起护栏，否则面板收起会让对话框坐标系错乱
    primeFileDialogGuard();
    // 内存状态始终为数据的事实来源（启动时已从数据库加载）
    const exportData = getCurrentDataSnapshot();
    if (!hasAnyTodoData(exportData)) {
        showToast('没有可导出的待办数据', 'error');
        return;
    }

    const payload = getExportPayload(exportData);
    const fileName = formatExportFileName(payload.exportedAt);
    const content = JSON.stringify(payload, null, 2);
    const exportSummary = `${payload.meta.pendingCount} 条待办，${payload.meta.completedCount} 条已完成`;

    if (!content || content.length <= 2) {
        showToast('导出失败，生成的导出内容为空', 'error');
        return;
    }

    if (typeof host?.exportDataFile === 'function') {
        // 桌面端：原生保存对话框自选位置；取消时静默返回
        const result = await host.exportDataFile(fileName, content);
        if (result?.canceled) return;
        if (result?.ok && result?.bytes > 0) {
            showToast(`数据已导出到 ${result.path}，包含 ${exportSummary}`);
            return;
        }
        if (result?.error) console.error('Failed to export todo data file:', result.error);
    }

    try {
        if (await saveWithFilePicker(fileName, content)) {
            showToast(`数据已导出：${exportSummary}`);
            return;
        }
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.error('Failed to export with save file picker:', error);
        } else {
            showToast('已取消导出', 'error');
            return;
        }
    }

    try {
        triggerBrowserDownload(fileName, content);
        showToast(`数据导出已开始：${exportSummary}`);
    } catch (error) {
        console.error('Failed to trigger browser download:', error);
        showToast('导出失败，请重试', 'error');
    }
}

export async function importTodoData(file) {
    if (!hasMembershipAccess()) {
        showToast('未开通 SVIP，无法使用数据导入权益', 'error');
        return;
    }
    try {
        primeFileDialogGuard();
        const rawText = await readImportFile(file);
        if (!rawText) {
            showToast('导入失败，未读取到文件内容', 'error');
            return;
        }
        const { data: importedData, settings: importedSettings } = parseImportedPayload(rawText);
        mergeImportedData(importedData);
        // 合并结果全量落库（事务替换）
        persist(
            getRepositories().todos.bulkReplace({
                todos: state.data.todos,
                completed: state.data.completed
            }),
            '导入数据保存失败，请重试'
        );
        // v2 导出包含设置（主题/快捷提醒时间）：一并还原
        let settingsNote = '';
        if (importedSettings) {
            persistThemeSettings(importedSettings);
            updateDuePresetChips();
            settingsNote = '，设置已还原';
        }
        syncView();
        showToast(
            `已导入 ${importedData.todos.length} 条待办和 ${importedData.completed.length} 条已完成${settingsNote}`
        );
    } catch (error) {
        console.error('Failed to import todo data:', error);
        showToast('导入失败，请检查 JSON 文件格式', 'error');
    } finally {
        if (elements.importDataInput) elements.importDataInput.value = '';
    }
}
