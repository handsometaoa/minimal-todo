// 独立提醒窗口:渲染到期待办列表,关闭操作回传启动器隐藏窗口
(function () {
    const listEl = document.getElementById('reminderList');

    function send(channel, data) {
        try {
            if (window.sidebarHost && typeof window.sidebarHost.sendReminderMessage === 'function') {
                window.sidebarHost.sendReminderMessage(channel, data == null ? null : data);
            }
        } catch (error) {
            console.error('Failed to send reminder message:', error);
        }
    }

    function hideWindow() {
        send('todo-reminder:empty');
    }

    function updateCount() {
        const countEl = document.getElementById('reminderCount');
        if (!countEl) return;
        const count = listEl.querySelectorAll('.reminder-item').length;
        countEl.textContent = count > 0 ? `${count} 项` : '';
        countEl.hidden = count === 0;
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text == null ? '' : text);
        return div.innerHTML;
    }

    function formatDue(ts) {
        const date = new Date(ts);
        const pad = (value) => String(value).padStart(2, '0');
        const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const dayOffset = Math.floor((ts - startOfToday.getTime()) / 86400000);
        if (dayOffset === 0) return `今天 ${hm}`;
        if (dayOffset === 1) return `明天 ${hm}`;
        if (dayOffset === -1) return `昨天 ${hm}`;
        return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`;
    }

    function render(list) {
        if (!Array.isArray(list) || list.length === 0) {
            listEl.innerHTML = '';
            updateCount();
            hideWindow();
            return;
        }
        listEl.innerHTML = list
            .map(
                (item) => `
            <li class="reminder-item">
                <div class="reminder-item__main">
                    <p class="reminder-item__text" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</p>
                    <time class="reminder-item__due">${escapeHtml(formatDue(item.dueAt))}</time>
                </div>
                <button class="reminder-item__dismiss" type="button" data-id="${escapeHtml(item.id)}" aria-label="关闭此提醒">×</button>
            </li>`
            )
            .join('');
        updateCount();
    }

    listEl.addEventListener('click', (event) => {
        const button = event.target.closest('[data-id]');
        if (!button) return;
        const node = button.closest('.reminder-item');
        if (node) node.remove();
        updateCount();
        send('todo-reminder:dismiss', button.dataset.id);
        if (!listEl.querySelector('.reminder-item')) hideWindow();
    });

    document.getElementById('closeAll').addEventListener('click', () => {
        listEl.innerHTML = '';
        hideWindow();
    });

    // 跟随插件主题：无主题信息时回退系统深浅色
    function applyTheme(theme) {
        const root = document.documentElement;
        let appearance = 'dark';
        if (theme && (theme.appearance === 'light' || theme.appearance === 'dark')) {
            appearance = theme.appearance;
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            appearance = 'light';
        }
        root.dataset.appearance = appearance;
        if (theme && typeof theme.primaryBright === 'string' && theme.primaryBright) {
            root.style.setProperty('--r-accent', theme.primaryBright);
        }
    }

    function handleData(payload) {
        if (Array.isArray(payload)) {
            applyTheme(null);
            render(payload);
            return;
        }
        applyTheme(payload?.theme);
        render(payload?.list);
    }

    function removeDismissed(id) {
        if (id == null) return;
        const node = listEl.querySelector(`[data-id="${id}"]`);
        if (node) {
            const item = node.closest('.reminder-item');
            if (item) item.remove();
        }
        if (!listEl.querySelector('.reminder-item')) hideWindow();
    }

    applyTheme(null);
    // contextIsolation 下 CustomEvent 收不到 detail，统一走 contextBridge 回调
    window.sidebarHost.onReminderEvent('data', handleData);
    window.sidebarHost.onReminderEvent('dismissed', removeDismissed);

    // 页面就绪后主动拉一次数据,避免窗口刚创建时数据未达导致白屏
    send('todo-reminder:ready');
})();
