// 自绘下拉组件：原生 <select> 的弹出列表在 Windows 上是系统菜单风格，CSS 无法定制。
// 这里隐藏原生控件、以触发按钮 + 浮层复刻交互；真实 select 仍是数据源——
// 选中后回写 value 并派发 change（冒泡），既有事件监听与 ui.js 的程序化设值不受影响。
// 程序化改 value 不会自动刷新触发按钮文案，ui.js 的 render 函数末尾需调用 refreshCustomSelects()。
let popupEl = null;
let activeSelect = null;
let activeIndex = -1;

const OPTION_ACTIVE_CLASS = 'is-active';

function selectedOptionIndex(select) {
    return Array.from(select.options).findIndex((option) => option.value === select.value);
}

function refreshTrigger(select) {
    const trigger = select.customSelectTrigger;
    if (!trigger) return;
    const option = select.selectedOptions[0];
    trigger.textContent = option ? option.textContent : '';
    trigger.disabled = select.disabled;
    trigger.setAttribute('aria-expanded', String(activeSelect === select));
}

export function refreshCustomSelects() {
    document.querySelectorAll('select.settings-select').forEach(refreshTrigger);
}

function renderOptions() {
    const select = activeSelect;
    popupEl.innerHTML = '';
    Array.from(select.options).forEach((option, index) => {
        const item = document.createElement('div');
        item.className = 'custom-select__option';
        item.setAttribute('role', 'option');
        item.dataset.index = String(index);
        if (option.value === select.value) {
            item.classList.add('is-selected');
            item.setAttribute('aria-selected', 'true');
        }
        if (option.disabled) item.classList.add('is-disabled');
        if (index === activeIndex) item.classList.add(OPTION_ACTIVE_CLASS);
        item.textContent = option.textContent;
        popupEl.appendChild(item);
    });
}

function setActiveIndex(index) {
    const select = activeSelect;
    if (!select) return;
    const options = Array.from(select.options);
    if (!options.length) return;
    activeIndex = (index + options.length) % options.length;
    popupEl.querySelectorAll('.custom-select__option').forEach((item, i) => {
        item.classList.toggle(OPTION_ACTIVE_CLASS, i === activeIndex);
    });
    popupEl.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
}

function positionPopup() {
    const trigger = activeSelect?.customSelectTrigger;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    popupEl.style.minWidth = `${rect.width}px`;
    popupEl.style.visibility = 'hidden';
    popupEl.hidden = false;
    const width = popupEl.offsetWidth;
    const height = popupEl.offsetHeight;
    // 优先向下展开；下方放不下且上方更宽裕时向上翻
    const below = window.innerHeight - rect.bottom - 8;
    const top = below < height && rect.top - 8 > below ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    popupEl.style.left = `${Math.max(8, left)}px`;
    popupEl.style.top = `${top}px`;
    popupEl.style.visibility = '';
}

function closeSelect() {
    if (!activeSelect) return;
    popupEl.hidden = true;
    popupEl.innerHTML = '';
    activeSelect.customSelectTrigger?.setAttribute('aria-expanded', 'false');
    activeSelect = null;
    activeIndex = -1;
}

function pickOption(index) {
    const select = activeSelect;
    if (!select) return;
    const option = select.options[index];
    if (!option || option.disabled) return;
    const changed = select.value !== option.value;
    select.value = option.value;
    refreshTrigger(select);
    closeSelect();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
}

function openSelect(select) {
    if (select.disabled) return;
    closeSelect();
    activeSelect = select;
    activeIndex = Math.max(0, selectedOptionIndex(select));
    renderOptions();
    positionPopup();
    select.customSelectTrigger?.setAttribute('aria-expanded', 'true');
}

function handleTriggerKeydown(event, select) {
    const isOpen = activeSelect === select;
    if (!isOpen) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            openSelect(select);
        }
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex(activeIndex - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pickOption(activeIndex);
    } else if (event.key === 'Escape' || event.key === 'Tab') {
        closeSelect();
    }
}

function decorate(select) {
    if (select.customSelectTrigger) return;
    select.classList.add('custom-select__native');
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'settings-select custom-select__trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    select.customSelectTrigger = trigger;
    select.after(trigger);
    refreshTrigger(select);

    trigger.addEventListener('click', () => {
        if (activeSelect === select) closeSelect();
        else openSelect(select);
    });
    trigger.addEventListener('keydown', (event) => handleTriggerKeydown(event, select));
}

export function initCustomSelects() {
    if (popupEl) return;
    popupEl = document.createElement('div');
    popupEl.className = 'custom-select__popup';
    popupEl.setAttribute('role', 'listbox');
    popupEl.hidden = true;
    document.body.appendChild(popupEl);

    document.querySelectorAll('select.settings-select').forEach(decorate);
    // 鼠标悬停即高亮，与原生菜单行为一致（共享浮层，全局只绑一次）
    popupEl.addEventListener('mousemove', (event) => {
        const item = event.target.closest('.custom-select__option');
        if (item) setActiveIndex(Number(item.dataset.index));
    });
    popupEl.addEventListener('click', (event) => {
        const item = event.target.closest('.custom-select__option');
        if (item && activeSelect) pickOption(Number(item.dataset.index));
    });
    document.addEventListener(
        'pointerdown',
        (event) => {
            if (!activeSelect) return;
            const trigger = activeSelect.customSelectTrigger;
            if (popupEl.contains(event.target) || trigger?.contains(event.target)) return;
            closeSelect();
        },
        true
    );
    // 面板展开/收起、显示器切换都会改窗口几何，浮层直接收起最稳
    window.addEventListener('resize', closeSelect);
    window.addEventListener('blur', closeSelect);
}
