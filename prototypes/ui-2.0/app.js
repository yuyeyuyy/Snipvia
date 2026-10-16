/* global document, window, navigator */
// Isolated design prototype. All content is synthetic; no production IPC or model calls.
const paths = {
  notes: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M12 8h4M12 12h4"/>',
  schedule: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M7 17h3"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  outline: '<path d="M4 6h2M10 6h10M4 12h2M10 12h10M4 18h2M10 18h7"/>',
  capture: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M12 8v8M8 12h8"/>',
  settings: '<path d="M9.83 5.13 10.64 2.9h2.72l.81 2.23 1.15.48 2.15-1.01 1.93 1.93-1.01 2.15.48 1.15 2.23.81v2.72l-2.23.81-.48 1.15 1.01 2.15-1.93 1.93-2.15-1.01-1.15.48-.81 2.23h-2.72l-.81-2.23-1.15-.48-2.15 1.01-1.93-1.93 1.01-2.15-.48-1.15-2.23-.81v-2.72l2.23-.81.48-1.15-1.01-2.15 1.93-1.93 2.15 1.01z"/><circle cx="12" cy="12" r="3"/>',
  user: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="12" cy="9" r="3"/><path d="M7 18a5 5 0 0 1 10 0"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  switch: '<path d="m8 8 4-4 4 4m-8 8 4 4 4-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r=".6"/><circle cx="12" cy="12" r=".6"/><circle cx="19" cy="12" r=".6"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6"/>',
  arrow: '<path d="M12 19V5m-5 5 5-5 5 5"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-1 7M20 3v7h-7"/>',
  link: '<path d="m10 8 2-2a5 5 0 0 1 7 7l-2 2M14 16l-2 2a5 5 0 0 1-7-7l2-2M8 16l8-8"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/>'
};
const icon = (name) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const button = (action, label, name, className = '', attributes = '') => `<button type="button" class="${className}" data-action="${action}" aria-label="${escape(label)}" title="${escape(label)}" ${attributes}>${name ? icon(name) : ''}${className.includes('icon-button') ? '' : escape(label)}</button>`;
const root = document.getElementById('prototype-root');
const dialog = document.getElementById('design-dialog');
const media = window.matchMedia('(prefers-color-scheme: dark)');
const compactNav = window.matchMedia('(max-width: 1050px)');
const compactOutline = window.matchMedia('(max-width: 1200px)');
const pageNames = { notes: 'AI 笔记', schedule: '截图日程', history: '历史对话', capture: '截图 AI 浮窗', settings: '设置' };
const state = {
  layout: 'a', page: 'notes', theme: 'light', demo: 'ready', collapsed: false, files: true, outline: true,
  narrowNavExpanded: false, outlinePopover: false,
  folder: true, note: '二分查找', noteMode: 'read', selectedDay: 9, month: 9, year: 2026, scheduleRecognizing: false,
  history: 0, search: '', settingsTab: 'appearance', floatExpanded: false, floatClosed: false, answered: false,
  processing: false, prompt: '', job: 0, editorValue: '# 二分查找\n\n每一次比较，都把搜索范围缩小一半。\n\n## 边界与循环不变量\n\n维护一个闭区间 [left, right]。\n\n```python\ndef binary_search(nums, target):\n    left, right = 0, len(nums) - 1\n    while left <= right:\n        mid = (left + right) // 2\n        if nums[mid] == target:\n            return mid\n        if nums[mid] < target:\n            left = mid + 1\n        else:\n            right = mid - 1\n    return -1\n```\n', signedIn: true
};
let toastTimer;
const historyItems = [
  { title: '为什么二分查找会死循环？', time: '10:24', tag: '已整理到笔记', day: '今天', note: '二分查找' },
  { title: '用栈解决括号匹配', time: '09:48', tag: '已整理到笔记', day: '今天', note: '栈与括号匹配' },
  { title: '下周的数据结构复习安排', time: '昨天 16:30', tag: '已存入日程', day: '昨天', note: '' },
  { title: '解释递归调用栈的变化', time: '昨天 14:12', tag: '', day: '昨天', note: '' },
  { title: '链表反转的三个指针', time: '10 月 7 日', tag: '已整理到笔记', day: '更早', note: '链表反转' },
  { title: '这张图中的时间复杂度是什么？', time: '10 月 6 日', tag: '', day: '更早', note: '' }
];
function toast(message) {
  const element = document.getElementById('toast');
  element.textContent = message; element.hidden = false;
  window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { element.hidden = true; }, 2500);
}
function theme() {
  document.documentElement.dataset.theme = state.theme === 'system' ? (media.matches ? 'dark' : 'light') : state.theme;
}
function navIsCollapsed() { return state.collapsed || (compactNav.matches && !state.narrowNavExpanded); }
// Observe rendered widths for prototype validation without changing layout or timing.
function observeMotion(element) {
  if (!element) return;
  const samples = [element.getBoundingClientRect().width];
  const start = window.performance.now();
  const measure = () => {
    samples.push(element.getBoundingClientRect().width);
    if (window.performance.now() - start < 260) window.requestAnimationFrame(measure);
    else element.dataset.motionSamples = JSON.stringify(samples);
  };
  window.requestAnimationFrame(measure);
}
function syncLayout() {
  root.querySelector('.desktop-window')?.classList.toggle('nav-collapsed', navIsCollapsed());
  const toggle = root.querySelector('[data-action="collapse"]');
  if (toggle) {
    const label = navIsCollapsed() ? '展开主导航' : '收起主导航';
    toggle.setAttribute('aria-label', label); toggle.title = label;
    toggle.setAttribute('aria-expanded', String(!navIsCollapsed()));
  }
  const layout = root.querySelector('.notes-layout');
  if (!layout) return;
  const outlineVisible = compactOutline.matches ? state.outlinePopover : state.outline;
  layout.classList.toggle('outline-overlay-open', compactOutline.matches && outlineVisible);
  layout.classList.toggle('outline-hidden', !outlineVisible);
  document.getElementById('note-outline').inert = !outlineVisible;
  root.querySelector('[data-action="outline"]').setAttribute('aria-expanded', String(outlineVisible));
}
function floatSize(expanded) {
  state.floatExpanded = expanded;
  root.querySelector('.capture-float')?.classList.toggle('is-expanded', expanded);
  root.querySelectorAll('[data-action="float-size"]').forEach(element => element.setAttribute('aria-pressed', String((element.dataset.size === 'expanded') === expanded)));
  const toggle = root.querySelector('[data-action="float-expand"]');
  if (toggle) { const label = expanded ? '收起工作台' : '展开工作台'; toggle.setAttribute('aria-label', label); toggle.title = label; }
}
function navigate(page) { state.page = page; state.search = ''; render(); }
function openDialog(title, content, footer = '') {
  if (dialog.open) dialog.close();
  dialog.setAttribute('aria-label', title);
  dialog.innerHTML = `<header><strong>${escape(title)}</strong>${button('dismiss', '关闭弹窗', 'close', 'icon-button')}</header><div class="dialog-body">${content}</div>${footer ? `<footer>${footer}</footer>` : ''}`;
  dialog.showModal();
}
function commandMenu() {
  openDialog('搜索与快捷操作', `<label class="command-search">${icon('search')}<input aria-label="搜索命令" placeholder="搜索笔记、对话，或输入操作…" autofocus></label><div id="command-results">${commandResults('')}</div><p class="caption">↑ ↓ 选择 · Return 打开 · Esc 关闭</p>`);
}
function commandResults(query) {
  return [['notes', '打开 AI 笔记'], ['schedule', '查看截图日程'], ['history', '查看历史对话'], ['capture', '开始 AI 截图（演示）'], ['settings', '打开设置']]
    .filter(([, title]) => title.includes(query)).map(([page, title]) => `<button class="command-row" data-action="command" data-page="${page}">${icon(page)}<span>${title}</span><kbd>↵</kbd></button>`).join('') || '<p class="caption">没有匹配的操作。</p>';
}
function chrome() {
  return `<header class="window-chrome"><div class="traffic-lights" aria-label="macOS 窗口按钮示意"><i></i><i></i><i></i></div><img class="app-icon" src="assets/app-icon.png" alt=""><strong class="brand">截然</strong>
    ${state.layout === 'a' ? button('collapse', state.collapsed ? '展开主导航' : '收起主导航', 'sidebar', 'icon-button', `aria-expanded="${!state.collapsed}" aria-controls="global-nav"`) : `<nav class="top-tabs" aria-label="主导航">${navButtons()}</nav>`}
    <div class="chrome-spacer"></div>${button('command-menu', '搜索与快捷操作 ⌘K', 'search', 'icon-button')}${button('account', state.signedIn ? '账号' : '登录', state.signedIn ? 'user' : null, state.signedIn ? 'icon-button' : 'small-button')}${button('settings', '设置 ⌘,', 'settings', `icon-button ${state.page === 'settings' ? 'active' : ''}`)}</header>`;
}
function navButtons() {
  return ['notes', 'schedule', 'history'].map(page => `<button type="button" data-action="navigate" data-page="${page}" class="nav-item ${state.page === page ? 'active' : ''}" aria-label="${pageNames[page]}" title="${pageNames[page]}" ${state.page === page ? 'aria-current="page"' : ''}>${icon(page)}<span>${pageNames[page]}</span></button>`).join('');
}
function nav() {
  return `<aside class="global-nav" id="global-nav" aria-label="主导航"><nav>${navButtons()}</nav><div class="nav-bottom"><span class="caption">截图快捷键</span><kbd>⌘ ⇧ Space</kbd></div></aside>`;
}
function workspaceBar() {
  const actions = state.page === 'notes'
    ? `${button('files', '切换文件列表', 'sidebar', 'icon-button', `aria-expanded="${state.files}" aria-controls="note-files"`)}${button('outline', '切换大纲', 'outline', 'icon-button', `aria-expanded="${state.outline}" aria-controls="note-outline"`)}${button('note-more', '笔记本操作', 'more', 'icon-button')}`
    : state.page === 'schedule' ? `${button('records', '识别记录', 'history', 'small-button')}${button('capture-schedule', state.scheduleRecognizing ? '识别中…' : '从截图创建', 'plus', 'small-button', state.scheduleRecognizing ? 'disabled' : '')}`
    : state.page === 'history' ? button('history-more', '历史操作', 'more', 'icon-button') : '';
  const title = state.page === 'notes' ? `<span class="section-name">AI 笔记</span><span class="separator">/</span><button class="book-switch" data-action="notebooks">算法学习${icon('switch')}</button>` : `<strong>${pageNames[state.page]}</strong>`;
  return `<div class="workspace-bar"><div class="workspace-context">${title}</div><div class="workspace-actions">${actions}</div></div>`;
}
function placeholder() {
  if (state.demo === 'ready' || state.demo === 'permission' || state.demo === 'no-access') return '';
  const values = {
    empty: ['这里还没有内容', state.page === 'notes' ? '选择本地文件夹，让下一次理解成为笔记。' : '下一次截图会成为你的第一条记录。', state.page === 'notes' ? 'notebooks' : 'new-capture', state.page === 'notes' ? '打开笔记本' : '开始截图'],
    loading: ['正在载入…', '保留导航与操作位置，不让页面跳动。', '', ''],
    error: ['内容暂时无法读取', '你的编辑仍然保留。检查后可以重试。', 'retry', '重新加载']
  };
  const [title, description, action, label] = values[state.demo];
  return `<div class="empty-state">${state.demo === 'loading' ? '<span class="spinner"></span>' : icon(state.demo === 'error' ? 'refresh' : state.page)}<h2>${title}</h2><p>${description}</p>${action ? button(action, label, null, 'primary') : ''}</div>`;
}
function codeBlock(bug = false) {
  return `<div class="code-block"><button data-action="copy-code" class="code-label" aria-label="复制 Python 代码" title="点击语言名称复制代码">Python ${icon('copy')}</button><pre><code><span class="tok-keyword">def</span> <span class="tok-function">binary_search</span>(nums, target):
    left, right = <span class="tok-number">0</span>, <span class="tok-function">len</span>(nums) - <span class="tok-number">1</span>
    <span class="tok-keyword">while</span> left &lt;= right:
        mid = (left + right) // <span class="tok-number">2</span>
        <span class="tok-keyword">if</span> nums[mid] == target:
            <span class="tok-keyword">return</span> mid
        <span class="tok-keyword">if</span> nums[mid] &lt; target:
            left = mid${bug ? '' : ' + <span class="tok-number">1</span>'} <span class="tok-comment"># ${bug ? '区间没有缩小' : '排除已比较的 mid'}</span>
        <span class="tok-keyword">else</span>:
            right = mid - <span class="tok-number">1</span>
    <span class="tok-keyword">return</span> -<span class="tok-number">1</span></code></pre></div>`;
}
function noteDocument() {
  return `<div class="document-reading"><div class="document-meta">算法题目 <span>·</span> 8 分钟阅读</div><h1>${escape(state.note)}</h1><p class="lead">每一次比较，都把搜索范围缩小一半。</p><h2 id="invariant">边界与循环不变量</h2><p>维护一个闭区间 <code>[left, right]</code>。如果目标存在，它始终位于当前区间中。已经检查过的中点，需要从下一轮搜索中排除。</p><aside class="note-callout">${icon('link')}<span>来自截图对话的整理 · <button data-action="open-source">查看原对话</button></span></aside><h2 id="implementation">一个正确的实现</h2>${codeBlock()}<h2 id="complexity">复杂度与边界情况</h2><div class="table-scroll" tabindex="0"><table><thead><tr><th>维度</th><th>结论</th><th>原因</th></tr></thead><tbody><tr><td>时间</td><td>O(log n)</td><td>每一轮减半</td></tr><tr><td>空间</td><td>O(1)</td><td>只使用三个指针</td></tr><tr><td>空数组</td><td>返回 −1</td><td>循环不会执行</td></tr></tbody></table></div><h2 id="practice">下一步练习</h2><p>尝试寻找第一个大于等于目标的位置，再对比边界如何变化。</p></div>`;
}
function notes() {
  return `<section class="notes-layout ${state.files ? '' : 'files-hidden'} ${state.outline ? '' : 'outline-hidden'}"><aside class="note-files" id="note-files" aria-label="文件列表" ${!state.files ? 'inert' : ''}><div class="pane-header"><strong>文件</strong>${button('new-note', '新建笔记', 'plus', 'icon-button')}</div><div class="file-tree"><button class="tree-folder" data-action="folder" aria-expanded="${state.folder}"><span class="tree-chevron ${state.folder ? 'expanded' : ''}">${icon('chevron')}</span>${icon('folder')}<span>算法题目</span></button><div class="folder-children" ${state.folder ? '' : 'hidden'}>${['二分查找', '栈与括号匹配', '链表反转'].map(name => `<button class="tree-file ${state.note === name ? 'active' : ''}" data-action="note" data-name="${name}">${icon('file')}<span>${name}</span></button>`).join('')}</div><button class="tree-folder" data-action="folder-other">${icon('chevron')}${icon('folder')}<span>课程记录</span></button><button class="tree-file root-file" data-action="note" data-name="学习计划">${icon('file')}学习计划</button></div><div class="pane-footer">Markdown · 本地文件</div></aside>
    <section class="note-center"><div class="document-toolbar"><span class="breadcrumb">算法题目 / ${escape(state.note)}.md</span><select aria-label="笔记模式" id="note-mode"><option value="read" ${state.noteMode === 'read' ? 'selected' : ''}>阅读</option><option value="live" ${state.noteMode === 'live' ? 'selected' : ''}>实时预览</option><option value="source" ${state.noteMode === 'source' ? 'selected' : ''}>源码</option></select></div><div class="document-scroll">${state.noteMode === 'read' ? noteDocument() : `<div class="prototype-editor-note">${state.noteMode === 'live' ? '编辑交互示意；正式实时预览将复用 CodeMirror。' : 'Markdown 源码示意，仅保存在原型内存中。'}</div><textarea aria-label="笔记编辑器" class="prototype-editor" spellcheck="false">${escape(state.editorValue)}</textarea>`}</div><div class="document-status"><span id="save-status">${icon('check')} 已保存 · 演示</span><span>UTF-8 · Markdown</span></div></section>
    <aside class="note-outline" id="note-outline" aria-label="笔记大纲" ${!state.outline ? 'inert' : ''}><div class="pane-header"><strong>大纲</strong></div><nav>${[['invariant', '边界与循环不变量'], ['implementation', '一个正确的实现'], ['complexity', '复杂度与边界情况'], ['practice', '下一步练习']].map(([id, title], index) => `<button data-action="heading" data-id="${id}" class="outline-row ${index === 0 ? 'active' : ''}">${title}</button>`).join('')}</nav><div class="backlinks"><strong>反向链接 <span>1</span></strong><button data-action="note" data-name="学习计划">${icon('link')}学习计划</button></div></aside></section>`;
}
function calendar() {
  const first = new Date(Date.UTC(state.year, state.month, 1)).getUTCDay();
  const offset = (first + 6) % 7;
  const days = new Date(Date.UTC(state.year, state.month + 1, 0)).getUTCDate();
  const previous = new Date(Date.UTC(state.year, state.month, 0)).getUTCDate();
  return `<div class="calendar-toolbar"><strong>${state.year} 年 ${state.month + 1} 月</strong><div>${button('prev-month', '上个月', 'back', 'icon-button')}${button('today', '今天', null, 'small-button')}${button('next-month', '下个月', 'chevron', 'icon-button')}</div></div><div class="calendar-weekdays">${['一', '二', '三', '四', '五', '六', '日'].map(day => `<span>${day}</span>`).join('')}</div><div class="month-grid">${Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1;
    const outside = day < 1 || day > days;
    const value = day < 1 ? previous + day : day > days ? day - days : day;
    return `<button data-action="day" data-day="${value}" ${outside ? 'disabled' : ''} aria-label="${state.month + 1} 月 ${value} 日" aria-pressed="${!outside && state.selectedDay === value}" class="calendar-day ${outside ? 'outside' : ''} ${!outside && state.selectedDay === value ? 'selected' : ''} ${value === 9 && state.month === 9 && !outside ? 'today' : ''}"><span>${value}</span>${!outside && scheduleEvents.some(event => event.date === `${state.year}-${String(state.month + 1).padStart(2, '0')}-${String(value).padStart(2, '0')}`) ? '<i></i>' : ''}</button>`;
  }).join('')}</div>`;
}
const scheduleEvents = [
  { id: 'weekly-notes', date: '2026-10-09', title: '整理本周算法笔记', allDay: true, source: '本地日程' },
  { id: 'binary-search', date: '2026-10-09', title: '二分查找与边界练习', start: '10:00', end: '11:00', source: '学习计划 · 本地日程' },
  { id: 'discussion', date: '2026-10-09', title: '数据结构复习讨论', start: '14:00', end: '15:00', source: '来自截图 · 已自动保存' },
  { id: 'assignment', date: '2026-10-12', title: '算法作业提交', allDay: true, source: '来自截图 · 截止事项' },
  { id: 'review', date: '2026-10-15', title: '数据结构复习', start: '14:00', end: '15:00', source: '本地日程' }
];
function scheduleDate() {
  return `${state.year}-${String(state.month + 1).padStart(2, '0')}-${String(state.selectedDay).padStart(2, '0')}`;
}
function scheduleRow(event) {
  return `<button class="agenda-row" data-action="view-event" data-id="${escape(event.id)}"><time>${event.allDay ? '全天' : `${escape(event.start)}<br><small>${escape(event.end)}</small>`}</time><div><strong>${escape(event.title)}</strong><span>${escape(event.source)}</span></div><span class="event-line"></span></button>`;
}
function schedule() {
  const events = scheduleEvents.filter(event => event.date === scheduleDate());
  const allDay = events.filter(event => event.allDay);
  const timed = events.filter(event => !event.allDay).sort((a, b) => a.start.localeCompare(b.start));
  return `<section class="schedule-layout"><aside class="calendar-pane">${calendar()}<p class="caption calendar-caption">截图识别完成后，直接存入本地日程。</p></aside>
    <div class="agenda-pane"><div class="agenda-heading"><div><p class="eyebrow">${state.year} 年 ${state.month + 1} 月</p><h1>${state.selectedDay} 日 <span>日期详情</span></h1></div><span class="caption">${events.length} 项日程</span></div>
    ${allDay.length ? `<div class="agenda-day-label">全天</div>${allDay.map(scheduleRow).join('')}` : ''}
    ${timed.length ? `<div class="agenda-day-label">时间安排</div>${timed.map(scheduleRow).join('')}` : ''}
    ${events.length ? '' : '<div class="day-empty">这一天没有安排。<small>在左侧查看其他日期，或从截图创建日程。</small></div>'}
    <div class="agenda-footer">${icon('shield')}本地保存与 Mac 日历添加是两个独立操作。</div></div></section>`;
}
function captureSchedule() {
  if (state.scheduleRecognizing) return;
  const date = scheduleDate();
  const id = `screenshot-demo-${date}`;
  if (scheduleEvents.some(event => event.id === id)) { toast('这条截图日程已保存 · 演示'); return; }
  state.scheduleRecognizing = true; render(); toast('正在识别截图中的日程 · 合成演示');
  window.setTimeout(() => {
    scheduleEvents.push({ id, date, title: '数据结构答疑', start: '16:00', end: '17:00', source: '来自截图 · 已自动保存' });
    state.scheduleRecognizing = false; render(); toast('已自动存入本地日程 · 合成演示');
  }, 650);
}
function historyRows(query = state.search) {
  const matches = historyItems.map((item, index) => ({ ...item, index })).filter(item => item.title.includes(query));
  let group = '';
  return matches.map(item => {
    const label = item.day !== group ? `<div class="list-group-label">${item.day}</div>` : ''; group = item.day;
    return `${label}<button class="history-row ${state.history === item.index ? 'active' : ''}" data-action="conversation" data-index="${item.index}" aria-label="${item.title}" ${state.history === item.index ? 'aria-current="true"' : ''}><div><strong>${item.title}</strong><time>${item.time}</time></div><span>${item.tag || '截图问答'} · ${item.index === 0 ? '3' : '2'} 轮</span></button>`;
  }).join('') || '<p class="caption search-empty">没有找到匹配的对话。</p>';
}
function answer() {
  return `<div class="ai-answer"><div class="answer-author"><img src="assets/app-icon.png" alt="">截然 <span>回答完成</span></div><h2>区间没有严格缩小</h2><p>问题在于 <code>left = mid</code>。当 <code>left + 1 = right</code> 时，向下取整会让 <code>mid</code> 仍等于 <code>left</code>，下一轮重复比较。</p><p>把这一行改为 <code>left = mid + 1</code>，排除已经检查过的中点。</p><div class="inline-code"><span class="tok-variable">left</span> = mid + <span class="tok-number">1</span> <span class="tok-comment"># 保证区间向前推进</span></div><p>我已把循环不变量、正确实现和边界测试整理到你的笔记中。</p><div class="note-change"><div>${icon('file')}<strong>已编辑 1 篇笔记</strong><span class="success-text">+24 −1</span></div><button data-action="open-edited">算法题目 / 二分查找.md ${icon('chevron')}</button></div><div class="answer-actions">${button('copy-answer', '复制回答', 'copy', 'text-button')}${button('view-diff', '查看变更', null, 'text-button')}</div></div>`;
}
function permission() {
  return `<section class="inline-permission" aria-label="操作确认"><strong>需要你的确认</strong><p>Agent 希望在已选择的笔记本中运行脚本。请先检查命令与工作目录。</p><pre>python3 check_binary_search.py</pre><small>工作目录：算法学习 / 算法题目</small><div>${button('deny', '拒绝', null, 'small-button')}${button('allow', '运行一次', null, 'primary')}</div><p class="caption">Return 不会批准。关闭窗口等同拒绝。</p></section>`;
}
function history() {
  const selected = historyItems[state.history] || historyItems[0];
  if (!selected) return '<div class="empty-state"><h2>还没有历史对话</h2></div>';
  return `<section class="history-layout"><aside class="conversation-list"><label class="list-search">${icon('search')}<input type="search" aria-label="搜索历史对话" value="${escape(state.search)}" placeholder="搜索对话…"></label><div id="history-rows">${historyRows()}</div><div class="pane-footer">只搜索本机历史</div></aside><section class="conversation-detail"><header class="detail-header"><div><strong>${selected.title}</strong><small>今天 · 截图问答 · 本地记录</small></div>${button('delete-conversation', '删除当前对话', 'more', 'icon-button')}</header><div class="messages-scroll"><button class="capture-strip" data-action="view-capture">${icon('capture')}<span>来源截图 · Python 代码</span><span>查看</span></button><div class="user-question">${selected.title}</div>${state.demo === 'permission' ? permission() : answer()}</div>${composer(false)}</section></section>`;
}
function composer(floating) {
  return `<form class="composer" data-composer="${floating ? 'floating' : 'history'}"><textarea aria-label="${floating ? '截图问题' : '继续提问'}" placeholder="${floating && !state.answered ? '输入问题，或按 Return 自动分析…' : '继续提问…'}" rows="2" ${state.demo === 'no-access' ? 'disabled' : ''}>${escape(state.prompt)}</textarea><div class="composer-footer"><button type="button" data-action="notebooks" class="text-button">${icon('notes')}算法学习 ${icon('switch')}</button><span class="model-label">图片模型 · 演示</span><button type="submit" class="send-button" aria-label="${state.processing ? '停止分析' : '发送问题'}" ${state.demo === 'no-access' ? 'disabled' : ''}>${state.processing ? icon('close') : icon('arrow')}</button></div><span class="composer-hint">Return 发送 · Shift Return 换行</span></form>`;
}
function float() {
  if (state.floatClosed) return `<div class="floating-stage"><div class="float-closed"><h2>截图已关闭</h2><p>主窗口没有被自动打开。</p>${button('reopen-float', '重新演示截图', 'capture', 'small-button')}</div></div>`;
  return `<div class="floating-stage"><div class="float-demo-caption"><span>截图之后，留在当前任务里。</span><div class="segmented"><button data-action="float-size" data-size="quick" aria-pressed="${!state.floatExpanded}">快捷态</button><button data-action="float-size" data-size="expanded" aria-pressed="${state.floatExpanded}">展开工作台</button></div></div><section class="capture-float ${state.floatExpanded ? 'is-expanded' : ''}" aria-label="截图 AI 浮窗"><header class="float-header"><img src="assets/app-icon.png" alt=""><strong>截图 AI</strong><span class="badge">解释代码</span><div class="chrome-spacer"></div>${button('float-expand', state.floatExpanded ? '收起工作台' : '展开工作台', 'expand', 'icon-button')}${button('close-float', '关闭截图', 'close', 'icon-button')}</header><div class="float-body"><div class="screenshot-pane"><div class="screenshot-label">所选截图 <span>640 × 420</span></div><div class="synthetic-capture"><div class="capture-file-name">binary_search.py</div>${codeBlock(true)}</div><div class="screenshot-toolbar">${button('copy-capture', '复制并关闭', 'copy', 'text-button')}${button('return-app', '返回软件', 'back', 'text-button')}</div></div><div class="float-chat"><div class="float-messages">${state.demo === 'no-access' ? '<div class="access-notice"><strong>截图已保存在本机</strong><p>AI 对话需要有效会员资格。请联系管理员开通；复制和关闭仍然可用。</p><button data-action="contact-admin" class="small-button">联系管理员</button></div>' : state.demo === 'permission' ? permission() : state.processing ? `<div class="activity-line" role="status"><span class="spinner"></span><span id="activity-label">正在理解截图…</span></div>` : state.answered ? answer() : '<div class="quick-intro"><h2>看懂这一小块。</h2><p>按 Return 自动分析，或直接说出你的问题。</p><div><kbd>↵</kbd><span>解释错误 · 解释代码 · 回答问题 · 创建日程</span></div></div>'}</div>${composer(true)}</div></div><footer class="float-footer"><span>仅所选截图 · 本次使用图片模型</span><span>Esc ${state.processing ? '停止' : '关闭'}</span></footer></section><p class="floating-footnote">独立浮窗示意 · 展开不打开主窗口 · 所有结果均为合成演示</p></div>`;
}
function preference(label, description, control) {
  return `<div class="preference-row"><div><strong>${label}</strong><span>${description}</span></div>${control}</div>`;
}
function settings() {
  const tabs = [['appearance', '外观'], ['models', '模型与服务'], ['shortcuts', '快捷键'], ['branches', '截图预测'], ['privacy', '隐私与权限']];
  let content = '';
  if (state.settingsTab === 'appearance') content = `<h1>外观</h1><p class="settings-description">清晰、安静，适合长时间使用。</p><h2>主题</h2><div class="theme-cards">${[['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']].map(([value, label]) => `<button data-action="theme-card" data-theme="${value}" aria-pressed="${state.theme === value}"><span class="theme-mini ${value}"><i></i><b></b><em></em></span><span>${label}</span>${state.theme === value ? icon('check') : ''}</button>`).join('')}</div><h2>显示</h2><div class="preference-group">${preference('主导航', '保留入口，按需收起文字。', `<select aria-label="主导航显示" id="nav-preference"><option value="expanded" ${state.collapsed ? '' : 'selected'}>图标与名称</option><option value="collapsed" ${state.collapsed ? 'selected' : ''}>仅图标</option></select>`)}${preference('文档宽度', '控制正文行长；代码与表格可以更宽。', '<select aria-label="文档宽度"><option>舒适 · 720 px</option><option>宽 · 880 px</option></select>')}${preference('减少动态效果', '遵循系统偏好，不用动画表达必要信息。', '<span class="caption">跟随 macOS</span>')}</div><h2>常规</h2><div class="preference-group">${preference('开机自启', '登录系统后在菜单栏待命。', '<button class="toggle" role="switch" aria-checked="false" aria-label="开机自启" data-action="toggle"><i></i></button>')}</div>`;
  if (state.settingsTab === 'models') content = `<h1>模型与服务</h1><p class="settings-description">截图对话模型在本机配置，分支预测由服务端提供。</p><h2>截图对话</h2><div class="preference-group">${preference('当前模型', '选择已配置的图片理解模型。', '<select aria-label="当前模型"><option>已配置图片模型 · 演示</option></select>')}${preference('厂商配置', '管理接口来源、模型与凭据。', button('model-config', '配置…', null, 'small-button'))}${preference('模型目录', '目录可用不代表真实调用已验证。', '<span class="badge">尚未验证调用</span>')}</div><h2>服务端预测</h2><div class="preference-group">${preference('云端转发', '本机仅展示连接状态；配置与限额由管理员管理。', '<span class="badge success">已连接 · 演示</span>')}</div><p class="caption settings-note">API Key 继续由主进程读取和保存。原型不接收真实凭据。</p>`;
  if (state.settingsTab === 'shortcuts') content = `<h1>快捷键</h1><p class="settings-description">一个动作，一个明确的入口。</p><div class="preference-group">${[['普通截图', '标注、复制与保存。', '⌘ ⇧ A'], ['AI 截图', '框选后在浮窗中提问。', '⌘ ⇧ Space'], ['续拍并继续对话', '保留当前对话，跳过分支预测。', '⌘ ⇧ Return'], ['搜索与快捷操作', '应用内搜索与导航。', '⌘ K']].map(([label, description, key]) => preference(label, description, button('shortcut', key, null, 'shortcut-button'))).join('')}</div>`;
  if (state.settingsTab === 'branches') content = `<h1>截图预测</h1><p class="settings-description">适用内容、执行指令和关联笔记本都可以调整。</p><div class="preference-group">${['解释错误', '解释代码', '回答问题', '创建日程'].map(label => preference(label, label === '创建日程' ? '识别截图中的时间信息，直接存入本地日程。' : `适合${label === '解释代码' ? '程序片段与算法实现' : label === '解释错误' ? '异常堆栈与报错信息' : '题目与需要解答的内容'}。`, `<div class="row-controls">${button('branch-config', '编辑…', null, 'small-button')}<button class="toggle" role="switch" aria-checked="true" aria-label="${label}" data-action="toggle"><i></i></button></div>`)).join('')}</div>${button('branch-config', '新增自定义分支', 'plus', 'text-button')}`;
  if (state.settingsTab === 'privacy') content = `<h1>隐私与权限</h1><p class="settings-description">知道发送了什么，也知道保存在哪里。</p><div class="preference-group">${preference('录屏与系统录音', '只上传用户选择的裁剪区域。', '<span class="badge success">已授权 · 演示</span>')}${preference('本地记录', '截图、对话和 Markdown 保存在本机。', button('local-location', '查看位置', null, 'small-button'))}${preference('AI 操作权限', '命令与危险操作在执行前单独确认。', button('permissions-info', '查看规则', null, 'small-button'))}${preference('预测转发', '服务端累计准入与结果计数，不持久保存截图请求。', '<span class="caption">由管理员配置</span>')}</div><p class="caption settings-note">发送到模型厂商的内容仍受该厂商的处理规则约束；本机存储不等于从未上传。</p>`;
  return `<section class="settings-layout"><aside class="settings-nav" aria-label="设置分类">${tabs.map(([id, label]) => `<button class="settings-tab ${state.settingsTab === id ? 'active' : ''}" data-action="settings-tab" data-tab="${id}" ${state.settingsTab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</aside><div class="settings-scroll"><div class="settings-content">${content}<div class="settings-save-status">${icon('check')}更改立即应用 · 仅原型内存</div></div></div></section>`;
}
function render() {
  const scrollPositions = new Map([...root.querySelectorAll('.document-scroll, .messages-scroll, .float-messages')].map(element => [element.className, element.scrollTop]));
  theme();
  for (const [id, value] of [['page', state.page], ['layout', state.layout], ['theme', state.theme], ['state', state.demo]]) document.getElementById(`${id}-picker`).value = value;
  if (state.page === 'capture') root.innerHTML = `<div class="floating-preview">${['empty', 'loading', 'error'].includes(state.demo) ? placeholder() : float()}</div>`;
  else root.innerHTML = `<div class="desktop-window layout-${state.layout} ${state.collapsed ? 'nav-collapsed' : ''}">${chrome()}${state.layout === 'a' ? nav() : ''}<section class="workspace">${workspaceBar()}<div class="page-content">${placeholder() || ({ notes, schedule, history, settings })[state.page]()}</div></section></div>`;
  syncLayout();
  root.querySelectorAll('.document-scroll, .messages-scroll, .float-messages').forEach(element => { element.scrollTop = scrollPositions.get(element.className) || 0; });
}
function viewEvent(id) {
  const event = scheduleEvents.find(item => item.id === id);
  if (!event) return;
  openDialog('日程详情', `<h2>${escape(event.title)}</h2><p>${escape(event.date)} · ${event.allDay ? '全天' : `${escape(event.start)}–${escape(event.end)}`} · Asia/Shanghai</p><p class="caption">${escape(event.source)} · 已存入截然本地日程</p><p class="caption">此原型使用合成数据，不写入真实文件或系统日历。</p>`, button('dismiss', '完成', null, 'primary'));
}
function modelConfig() {
  openDialog('配置厂商', `<p class="caption">分组表单示意。请勿在原型中填写真实 API Key。</p><div class="preference-group">${preference('厂商', '复用现有配置与凭据隔离。', '<select aria-label="模型厂商"><option>OpenAI</option><option>Qwen</option><option>Claude</option><option>Gemini</option><option>Grok</option><option>DeepSeek</option><option>Kimi</option><option>GLM</option><option>Doubao</option><option>自定义</option></select>')}${preference('模型', '仅展示已确认图片能力的目录项。', `<div class="row-controls">${button('refresh-models', '刷新模型列表', 'refresh', 'icon-button')}<select aria-label="模型"><option>已配置图片模型 · 演示</option><option>手动填写 ID…</option></select></div>`)}${preference('API Key', '凭据不会在此原型中收集。', '<input type="password" disabled aria-label="API Key" placeholder="正式应用中安全填写">')}</div>`, `${button('dismiss', '取消', null, 'small-button')}${button('mock-save', '保存并使用', null, 'primary')}`);
}
async function copyText(text, message) {
  try { await navigator.clipboard.writeText(text); toast(message); return true; }
  catch { toast('浏览器不允许复制，可手动选择演示文字。'); return false; }
}
function simulateAnswer() {
  if (state.processing) { state.job++; state.processing = false; toast('分析已停止'); render(); return; }
  if (state.demo === 'no-access') return;
  if (state.demo === 'permission') { toast('请先明确允许或拒绝此操作'); return; }
  const job = ++state.job;
  state.processing = true; state.floatExpanded = true; render();
  window.setTimeout(() => {
    if (job !== state.job) return;
    const label = document.getElementById('activity-label'); if (label) label.textContent = '正在编辑 算法题目 / 二分查找.md';
  }, 700);
  window.setTimeout(() => {
    if (job !== state.job) return;
    state.processing = false; state.answered = true; render();
    const messages = root.querySelector('.float-messages'); if (messages) messages.scrollTop = messages.scrollHeight;
  }, 1800);
}
document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  const action = target.dataset.action;
  if (action === 'navigate') return navigate(target.dataset.page);
  if (action === 'collapse') {
    observeMotion(root.querySelector('.global-nav'));
    const expand = navIsCollapsed(); state.collapsed = !expand; state.narrowNavExpanded = expand; syncLayout();
  }
  else if (action === 'files' || action === 'outline') {
    observeMotion(document.getElementById(action === 'files' ? 'note-files' : 'note-outline'));
    if (action === 'outline' && compactOutline.matches) state.outlinePopover = !state.outlinePopover;
    else state[action] = !state[action];
    root.querySelector('.notes-layout').classList.toggle(`${action}-hidden`, !state[action]);
    const pane = document.getElementById(action === 'files' ? 'note-files' : 'note-outline'); pane.inert = !state[action];
    target.setAttribute('aria-expanded', String(state[action]));
    syncLayout();
  }
  else if (action === 'folder') {
    state.folder = !state.folder; target.setAttribute('aria-expanded', String(state.folder));
    target.querySelector('.tree-chevron').classList.toggle('expanded', state.folder);
    root.querySelector('.folder-children').hidden = !state.folder;
  }
  else if (action === 'note') { state.note = target.dataset.name; render(); }
  else if (action === 'heading') { document.getElementById(target.dataset.id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }
  else if (action === 'command-menu') commandMenu();
  else if (action === 'command') { dialog.close(); navigate(target.dataset.page); }
  else if (action === 'dismiss') dialog.close();
  else if (action === 'settings') navigate('settings');
  else if (action === 'settings-tab') { state.settingsTab = target.dataset.tab; render(); }
  else if (action === 'theme-card') { state.theme = target.dataset.theme; render(); }
  else if (action === 'toggle') { target.setAttribute('aria-checked', String(target.getAttribute('aria-checked') !== 'true')); toast('已应用到原型内存'); }
  else if (action === 'day') { state.selectedDay = Number(target.dataset.day); render(); }
  else if (action === 'today') { state.month = 9; state.year = 2026; state.selectedDay = 9; render(); }
  else if (action === 'prev-month' || action === 'next-month') { const date = new Date(Date.UTC(state.year, state.month + (action === 'prev-month' ? -1 : 1), 1)); state.year = date.getUTCFullYear(); state.month = date.getUTCMonth(); state.selectedDay = 1; render(); }
  else if (action === 'capture-schedule') captureSchedule();
  else if (action === 'view-event') viewEvent(target.dataset.id);
  else if (action === 'conversation') { state.history = Number(target.dataset.index); render(); }
  else if (action === 'open-edited') { state.note = '二分查找'; navigate('notes'); }
  else if (action === 'open-source') { state.history = 0; navigate('history'); }
  else if (action === 'float-expand') floatSize(!state.floatExpanded);
  else if (action === 'float-size') floatSize(target.dataset.size === 'expanded');
  else if (action === 'close-float') { state.job++; state.processing = false; state.floatClosed = true; render(); }
  else if (action === 'reopen-float' || action === 'new-capture') { state.floatClosed = false; state.answered = false; state.prompt = ''; state.demo = 'ready'; state.floatExpanded = false; navigate('capture'); }
  else if (action === 'return-app') { state.floatClosed = true; navigate('history'); toast('由“返回软件”主动打开工作区 · 演示'); }
  else if (action === 'copy-capture') { if (await copyText('Snipvia 合成截图演示（原型只复制文字）', '已复制演示文字并关闭')) { state.floatClosed = true; render(); } }
  else if (action === 'copy-code') await copyText(state.editorValue.split('```python\n')[1]?.split('```')[0] || 'left = mid + 1', '代码已复制');
  else if (action === 'copy-answer') await copyText('将 left = mid 改为 left = mid + 1，排除已检查的中点。', '回答已复制');
  else if (action === 'allow' || action === 'deny') { state.demo = 'ready'; state.answered = action === 'allow'; render(); toast(action === 'allow' ? '已允许本次演示操作' : '操作已拒绝'); }
  else if (action === 'retry') { state.demo = 'ready'; render(); }
  else if (action === 'model-config') modelConfig();
  else if (action === 'refresh-models') toast('目录已刷新 · 合成模型，未验证真实调用');
  else if (action === 'mock-save') { dialog.close(); toast('配置已应用 · 演示'); }
  else if (action === 'notebooks' || action === 'note-more') openDialog('算法学习 · 笔记本', `<button class="command-row" data-action="dismiss">${icon('notes')}<span>算法学习</span>${icon('check')}</button><p class="caption">文件夹：本机 / 算法学习</p>${button('unlink', '移除笔记本链接…', 'link', 'text-button')}`, button('dismiss', '完成', null, 'small-button'));
  else if (action === 'unlink') openDialog('移除笔记本链接', '<p>将「算法学习」从列表中移除？</p><p class="caption">本地文件和附件仍会保留，以后可重新打开同一个文件夹。</p>', `${button('dismiss', '取消', null, 'small-button')}${button('unlink-confirm', '移除链接', null, 'danger-button')}`);
  else if (action === 'unlink-confirm') { dialog.close(); state.demo = 'empty'; render(); toast('已移除链接 · 合成演示，未修改文件'); }
  else if (action === 'account') openDialog('账号', `<p>${state.signedIn ? 'learner@example.test' : '登录示意 · 不发送验证码'}</p><p class="caption">${state.signedIn ? '有效体验资格 · 演示数据' : '普通截图无需会员；AI 对话需要有效资格。'}</p>`, button('account-toggle', state.signedIn ? '退出登录（演示）' : '登录（演示）', null, 'small-button'));
  else if (action === 'account-toggle') { state.signedIn = !state.signedIn; dialog.close(); render(); }
  else if (action === 'delete-conversation') openDialog('删除这条对话？', '<p>截图和消息会从本机历史中移除。原型仅移除合成列表项。</p>', `${button('dismiss', '取消', null, 'small-button')}${button('delete-confirm', '删除对话', null, 'danger-button')}`);
  else if (action === 'delete-confirm') { historyItems.splice(state.history, 1); state.history = 0; dialog.close(); render(); }
  else if (action === 'view-diff') openDialog('笔记修改', '<pre class="mock-diff"><span>− left = mid</span>\n<strong>+ left = mid + 1</strong>\n\n+ 循环不变量与边界测试</pre>', button('dismiss', '完成', null, 'small-button'));
  else if (action === 'new-note') openDialog('新建笔记', '<label class="dialog-field">名称<input aria-label="新笔记名称" placeholder="未命名" autofocus></label><p class="caption">创建与保存仅为演示，不写入文件。</p>', `${button('dismiss', '取消', null, 'small-button')}${button('mock-save', '创建', null, 'primary')}`);
  else if (action === 'branch-config') openDialog('编辑预测分支', '<label class="dialog-field">分支名称<input value="解释代码" aria-label="分支名称"></label><label class="dialog-field">适用内容<textarea aria-label="适用内容">程序片段和算法实现，不包含终端报错。</textarea></label><label class="dialog-field">执行指令<textarea aria-label="执行指令">说明核心逻辑、边界条件和复杂度，值得记录时整理到所选笔记本。</textarea></label>', `${button('dismiss', '取消', null, 'small-button')}${button('mock-save', '保存修改', null, 'primary')}`);
  else {
    const descriptions = { records: '识别中、已保存和失败记录集中在这里；识别成功后自动存入本地日程，选择记录可查看来源截图。', 'history-more': '清空历史放在此菜单内，正式应用需二次确认。', 'view-capture': '来源截图预览；本原型仅使用合成 Python 代码。', shortcut: '点击录制新组合键；冲突时保留原快捷键。正式实现复用现有录制器。', 'contact-admin': '请通过你的管理员获取资格。正式客户端将使用配置过的联系方式，原型不会发送消息。', 'local-location': '正式应用通过受控 IPC 在 Finder 中显示笔记本或历史目录。', 'permissions-info': '复用现有权限规则与所属窗口校验。拒绝或过期后不执行，Return 不会批准命令。', 'folder-other': '此原型文件夹为空；正式文件树将复用已有拖拽、排序与检索。' };
    openDialog(target.getAttribute('aria-label') || '设计说明', `<p>${descriptions[action] || '此操作的业务实现保持现状；原型只验证位置与层级。'}</p>`, button('dismiss', '知道了', null, 'small-button'));
  }
});
document.addEventListener('change', (event) => {
  const id = event.target.id;
  if (id.endsWith('-picker')) {
    const key = { 'page-picker': 'page', 'layout-picker': 'layout', 'theme-picker': 'theme', 'state-picker': 'demo' }[id];
    if (!key) return;
    state[key] = event.target.value;
    if (key === 'demo') { state.job++; state.processing = false; }
    render();
  } else if (id === 'note-mode') { state.noteMode = event.target.value; render(); }
  else if (id === 'nav-preference') { state.collapsed = event.target.value === 'collapsed'; render(); }
  else toast('已应用到原型内存 · 演示');
});
document.addEventListener('input', (event) => {
  if (event.target.matches('[aria-label="搜索历史对话"]')) { state.search = event.target.value; document.getElementById('history-rows').innerHTML = historyRows(); }
  if (event.target.matches('[aria-label="搜索命令"]')) document.getElementById('command-results').innerHTML = commandResults(event.target.value);
  if (event.target.matches('.composer textarea')) state.prompt = event.target.value;
  if (event.target.matches('.prototype-editor')) { state.editorValue = event.target.value; document.getElementById('save-status').textContent = '已保存 · 仅原型内存'; }
});
document.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!event.target.matches('[data-composer]')) return;
  if (event.target.dataset.composer === 'floating') simulateAnswer();
  else { state.prompt = ''; toast('继续对话交互示意 · 未调用模型'); render(); }
});
document.addEventListener('keydown', (event) => {
  if (event.isComposing) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); commandMenu(); return; }
  if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); if (dialog.open) dialog.close(); navigate('settings'); return; }
  if (dialog.open && event.target.matches('[aria-label="搜索命令"]')) {
    if (event.key === 'ArrowDown') { event.preventDefault(); dialog.querySelector('.command-row')?.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); dialog.querySelector('.command-row')?.click(); } return;
  }
  if (dialog.open && event.target.matches('.command-row') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault(); const list = [...dialog.querySelectorAll('.command-row')]; const next = (list.indexOf(event.target) + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length; list[next].focus(); return;
  }
  if (event.key === 'Escape' && !dialog.open && state.page === 'capture') {
    state.job++;
    if (state.processing) { state.processing = false; toast('分析已停止'); }
    else state.floatClosed = true;
    render(); return;
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.repeat && event.target.matches('.composer textarea')) { event.preventDefault(); event.target.closest('form').requestSubmit(); }
});
media.addEventListener('change', () => { if (state.theme === 'system') theme(); });
compactNav.addEventListener('change', syncLayout);
compactOutline.addEventListener('change', syncLayout);
render();
