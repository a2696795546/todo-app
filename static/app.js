// ===== 状态 =====
let currentView = 'today';
let mainView = 'list';  // list / kanban / calendar / stats
let currentTaskId = null;
let tasks = [];
let selectedIdx = 0;
let calYear, calMonth;

// 番茄钟
let pomo = { running: false, total: 25*60, remaining: 25*60, targetId: null, timer: null };

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ===== API =====
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ===== 加载任务 =====
async function loadTasks() {
  const params = new URLSearchParams({ view: currentView });
  const q = $('#search').value.trim();
  if (q) params.set('search', q);
  const p = $('#filter-priority').value;
  if (p !== '') params.set('priority', p);
  const l = $('#filter-list').value;
  if (l) params.set('list_id', l);
  const data = await api('/api/tasks?' + params);
  tasks = data.tasks;
  renderList();
  renderKanban();
  renderCalendar();
  loadBadges();
}

async function loadBadges() {
  try {
    const s = await api('/api/stats');
    Object.entries(s.by_view || {}).forEach(([k, v]) => {
      const el = document.querySelector(`[data-badge="${k}"]`);
      if (el) el.textContent = v || '';
    });
  } catch {}
  await renderLists();
}

// ===== 清单管理 =====
let LISTS = {};  // {id: {name, icon, count}}

async function renderLists() {
  const data = await api('/api/lists');
  LISTS = {};
  data.lists.forEach(l => LISTS[l.id] = l);

  const box = $('#lists-container');
  box.innerHTML = '';
  data.lists.forEach(l => {
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (currentView === l.id ? ' active' : '');
    btn.dataset.view = l.id;
    btn.innerHTML = `
      <span class="dot" style="background:#888"></span>
      ${l.icon || '📁'} ${escapeHtml(l.name)}
      <span class="list-actions">
        <button class="rename-btn" title="重命名">✎</button>
        ${l.id.startsWith('custom_') ? '<button class="del-btn" title="删除">🗑</button>' : ''}
      </span>
      <span class="badge">${l.count || ''}</span>
    `;
    btn.onclick = (e) => {
      if (e.target.closest('.list-actions')) return;
      switchView(l.id);
    };
    btn.querySelector('.rename-btn').onclick = async (e) => {
      e.stopPropagation();
      const name = prompt('清单名称', l.name);
      if (name && name.trim()) {
        await api(`/api/lists/${l.id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
        renderLists(); loadTasks();
      }
    };
    const delBtn = btn.querySelector('.del-btn');
    if (delBtn) delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`删除清单「${l.name}」？里面的任务会移到收件箱`)) return;
      const r = await api(`/api/lists/${l.id}`, { method: 'DELETE' });
      toast(`已删除，移走 ${r.moved} 个任务`);
      if (currentView === l.id) switchView('inbox'); else loadTasks();
    };
    box.appendChild(btn);
  });

  // 同步所有清单下拉
  refreshListSelects(data.lists);
}

function refreshListSelects(lists) {
  lists = lists || Object.values(LISTS);
  ['#n-list', '#d-list', '#filter-list'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = (sel === '#filter-list' ? '<option value="">全部清单</option>' : '') +
      lists.map(l => `<option value="${l.id}">${l.icon || ''} ${escapeHtml(l.name)}</option>`).join('');
    el.value = cur;
  });
}

function listName(id) {
  if (LISTS[id]) return (LISTS[id].icon || '') + ' ' + LISTS[id].name;
  return id;
}

// ===== 渲染列表 =====
const PRIO = { 0: '', 1: '🔵', 2: '🟡', 3: '🔴' };
const SMART_TITLE = { today: '📅 今天', next7: '🗓 最近 7 天', all: '🗂 全部', done: '✅ 已完成' };

function renderList() {
  const list = $('#task-list');
  list.innerHTML = '';
  $('#empty-state').hidden = tasks.length > 0;
  $('#view-title').textContent = SMART_TITLE[currentView] || listName(currentView);

  const active = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);

  function buildItem(t, i) {
    const item = document.createElement('div');
    item.className = 'task-item' +
      (t.done ? ' done' : '') +
      (t.status === '逾期' ? ' overdue' : '') +
      (t.status === '今日' ? ' due-today' : '');
    item.draggable = true;
    item.dataset.id = t.id;
    if (i === selectedIdx) item.style.outline = '2px solid var(--accent)';

    const dueStr = t.due ? (t.due.slice(5) + (t.due_time ? ' ' + t.due_time : '')) : '';
    const subStr = t.sub_total ? ` <span class="task-sub-count">(${t.sub_done}/${t.sub_total})</span>` : '';
    const pinStr = t.pinned ? '<span class="task-pin">📌</span>' : '';
    const icons = (t.description ? '📝 ' : '') + (t.repeat !== 'none' ? '🔁 ' : '');

    item.innerHTML = `
      <div class="task-check">✓</div>
      <div class="task-prio">${PRIO[t.priority] || ''}</div>
      <div class="task-title">${pinStr}${escapeHtml(t.title)}${subStr}</div>
      <div class="task-tags">${t.tags.map(tg => `<span class="task-tag">#${escapeHtml(tg)}</span>`).join('')}</div>
      <div class="task-due ${t.status === '逾期' ? 'overdue' : ''}">${icons}${dueStr}</div>
    `;
    if (t.abandoned) item.style.opacity = '0.5';
    if (t.abandoned) item.querySelector('.task-title').style.textDecoration = 'line-through';
    item.onclick = () => { selectedIdx = i; openDetail(t.id); };
    item.querySelector('.task-check').onclick = (e) => { e.stopPropagation(); toggleDone(t); };

    item.ondragstart = (e) => { e.dataTransfer.setData('text/plain', t.id); item.classList.add('dragging'); };
    item.ondragend = () => item.classList.remove('dragging');
    item.ondragover = (e) => e.preventDefault();
    item.ondrop = (e) => {
      e.preventDefault();
      const srcId = parseInt(e.dataTransfer.getData('text/plain'));
      if (srcId !== t.id) reorderTasks(srcId, t.id);
    };
    return item;
  }

  // 未完成组
  active.forEach((t, i) => list.appendChild(buildItem(t, i)));

  // 已完成组（可折叠）
  if (done.length > 0) {
    const group = document.createElement('div');
    group.className = 'task-group';
    const header = document.createElement('div');
    header.className = 'task-group-header collapsible';
    header.innerHTML = `已完成 <span>${done.length} ▾</span>`;
    const items = document.createElement('div');
    items.className = 'task-group-items';
    done.forEach((t, i) => items.appendChild(buildItem(t, active.length + i)));
    header.onclick = () => {
      items.classList.toggle('hidden');
      header.querySelector('span').textContent = items.classList.contains('hidden')
        ? `${done.length} ▸` : `${done.length} ▾`;
    };
    group.appendChild(header);
    group.appendChild(items);
    list.appendChild(group);
  }
}

async function reorderTasks(srcId, targetId) {
  // 简单做法：把 src 的 order 设为 target 的 order
  const src = tasks.find(t => t.id === srcId);
  const tgt = tasks.find(t => t.id === targetId);
  if (!src || !tgt) return;
  await api(`/api/tasks/${srcId}`, { method: 'PUT', body: JSON.stringify({ order: tgt.order }) });
  loadTasks();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ===== 完成 / 删除 =====
async function toggleDone(t) {
  const res = await api(`/api/tasks/${t.id}`, {
    method: 'PUT', body: JSON.stringify({ done: !t.done }),
  });
  if (!t.done && res.next_task) {
    toast(`完成了！下一次：${res.next_task.due || '无截止'}`);
    switchView(res.next_task.list_id);
  } else {
    loadTasks();
  }
}

async function deleteTask(id) {
  await api(`/api/tasks/${id}`, { method: 'DELETE' });
  closeDetail();
  loadTasks();
  toast('已删除');
}

// ===== 详情侧栏 =====
function openDetail(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  currentTaskId = id;
  selectedIdx = tasks.findIndex(x => x.id === id);
  $('#detail-panel').hidden = false;
  $('#d-title').value = t.title;
  $('#d-priority').value = t.priority;
  $('#d-list').value = t.list_id;
  $('#d-due').value = t.due || '';
  $('#d-due_time').value = t.due_time || '';
  $('#d-est').value = t.est || '';
  $('#d-repeat').value = t.repeat;
  $('#d-tags').value = t.tags.join(' ');
  $('#d-desc').value = t.description || '';
  $('#d-pin').style.opacity = t.pinned ? '1' : '0.4';
  $('#d-pin').classList.toggle('active', t.pinned);
  $('#d-abandon').style.opacity = t.abandoned ? '1' : '0.4';
  renderSubtasks(t.subtasks);
  renderList();
}

function closeDetail() {
  $('#detail-panel').hidden = true;
  currentTaskId = null;
}

function renderSubtasks(subs) {
  const box = $('#d-subtasks');
  box.innerHTML = '';
  (subs || []).forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'sub-item' + (s.done ? ' done' : '');
    row.innerHTML = `<input type="checkbox" ${s.done ? 'checked' : ''}> <span>${escapeHtml(s.title)}</span>`;
    row.querySelector('input').onchange = () => {
      const t = tasks.find(x => x.id === currentTaskId);
      if (t) { t.subtasks[i].done = !t.subtasks[i].done; saveDetail(); }
    };
    box.appendChild(row);
  });
}

async function saveDetail() {
  if (!currentTaskId) return;
  const t = tasks.find(x => x.id === currentTaskId);
  await api(`/api/tasks/${currentTaskId}`, {
    method: 'PUT', body: JSON.stringify({
      title: $('#d-title').value,
      priority: parseInt($('#d-priority').value),
      list_id: $('#d-list').value,
      due: $('#d-due').value || null,
      due_time: $('#d-due_time').value || null,
      est: $('#d-est').value || null,
      repeat: $('#d-repeat').value,
      tags: $('#d-tags').value.trim().split(/\s+/).filter(Boolean),
      description: $('#d-desc').value,
      subtasks: t ? t.subtasks : [],
    }),
  });
  toast('已保存');
  loadTasks();
}

// ===== 新建 =====
function openNew() {
  $('#new-modal').hidden = false;
  $('#n-title').focus();
}
async function submitNew(closeAfter = true) {
  const title = $('#n-title').value.trim();
  if (!title) { toast('请输入任务标题'); $('#n-title').focus(); return; }
  const tags = [];
  const cleanTitle = title.replace(/#(\w+)/g, (m, t) => { tags.push(t); return ''; }).trim();
  const newList = $('#n-list').value;
  const newDue = $('#n-due').value || null;
  await api('/api/tasks', {
    method: 'POST', body: JSON.stringify({
      title: cleanTitle || title, tags, list_id: newList,
      priority: parseInt($('#n-priority').value),
      due: newDue, due_time: $('#n-due_time').value || null,
      est: $('#n-est').value || null,
    }),
  });
  if (closeAfter) {
    $('#new-modal').hidden = true;
    $('#n-title').value = '';
    switchView(newList);
    toast('已添加');
  } else {
    $('#n-title').value = '';
    $('#n-title').focus();
    toast('已添加，继续输入');
    loadTasks();
  }
}

// ===== 视图切换 =====
function switchView(v) {
  currentView = v;
  selectedIdx = 0;
  $$('.nav-item[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === v));
  $('#view-title').textContent = SMART_TITLE[v] || listName(v);
  loadTasks();
}

function switchMainView(v) {
  mainView = v;
  ['list', 'kanban', 'calendar', 'stats', 'quadrant', 'habit', 'settings'].forEach(x =>
    $(`#${x}-view`).hidden = (x !== v));
  if (v === 'stats') loadStats();
  if (v === 'calendar') renderCalendar();
  if (v === 'quadrant') renderQuadrant();
  if (v === 'habit') loadHabits();
}

// ===== 四象限 =====
function renderQuadrant() {
  const boxes = { ui: [], i: [], u: [], n: [] };
  const todayStr = new Date().toISOString().slice(0, 10);
  tasks.forEach(t => {
    if (t.abandoned) return;
    if (t.done) {
      // 已完成的也按位置放，灰色显示
      const important = t.priority >= 2;
      const urgent = t.due && t.due <= todayStr;
      if (important && urgent) boxes.ui.push(t);
      else if (important) boxes.i.push(t);
      else if (urgent) boxes.u.push(t);
      else boxes.n.push(t);
      return;
    }
    const important = t.priority >= 2;
    const urgent = t.due && t.due <= todayStr;
    if (important && urgent) boxes.ui.push(t);
    else if (important) boxes.i.push(t);
    else if (urgent) boxes.u.push(t);
    else boxes.n.push(t);
  });
  $$('.quad-list').forEach(box => {
    box.innerHTML = '';
    const arr = boxes[box.dataset.quad];
    if (!arr.length) {
      box.innerHTML = '<div class="quad-empty">没有任务</div>';
      return;
    }
    arr.forEach(t => {
      const item = document.createElement('div');
      item.className = 'task-item' + (t.done ? ' done' : '');
      if (t.done) item.style.opacity = '0.5';
      const dueStr = t.done && t.due ? `<div style="font-size:11px;color:var(--text3)">${t.due.slice(5)}</div>` : '';
      item.innerHTML = `<div class="task-title">${escapeHtml(t.title)}</div>${dueStr}`;
      item.onclick = () => openDetail(t.id);
      box.appendChild(item);
    });
  });
}

// ===== 习惯打卡 =====
let HABITS = [];
let habitTab = 'today';

async function loadHabits() {
  const data = await api('/api/habits');
  HABITS = data.habits;
  renderHabitPanes();
}

function renderHabitPanes() {
  ['today', 'week', 'month', 'records'].forEach(t => {
    $(`#habit-${t}`).hidden = (t !== habitTab);
  });
  document.querySelectorAll('.habit-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.habitTab === habitTab));

  if (habitTab === 'today') renderHabitToday();
  else if (habitTab === 'week') renderHabitWeek();
  else if (habitTab === 'month') renderHabitMonth();
  else if (habitTab === 'records') renderHabitRecords();
}

function renderHabitToday() {
  const box = $('#habit-today');
  box.innerHTML = '';
  HABITS.forEach(h => {
    const row = document.createElement('div');
    row.className = 'habit-item';
    row.innerHTML = `
      <div class="habit-check ${h.done_today ? 'done' : ''}">${h.done_today ? '✓' : ''}</div>
      <div class="habit-name">${escapeHtml(h.name)}</div>
      <div class="habit-streak">🔥 ${h.streak} 天</div>
    `;
    row.querySelector('.habit-check').onclick = async () => {
      await api(`/api/habits/${h.id}/toggle`, { method: 'POST' });
      loadHabits();
    };
    box.appendChild(row);
  });
  if (!HABITS.length) box.innerHTML = '<p class="hint">还没有习惯，点右上角"＋ 新习惯"创建</p>';
}

function renderHabitWeek() {
  const box = $('#habit-week');
  const days = [];
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  const todayStr = now.toISOString().slice(0, 10);
  const wdNames = ['一','二','三','四','五','六','日'];

  let html = '<table class="habit-week-table"><tr><th></th>';
  days.forEach((d, i) => {
    const isToday = d === todayStr;
    html += `<th style="${isToday ? 'color:var(--accent)' : ''}">${wdNames[i]}<br>${d.slice(8)}</th>`;
  });
  html += '</tr>';
  HABITS.forEach(h => {
    const records = new Set(h.records || []);
    html += `<tr><td class="habit-row-name">${escapeHtml(h.name)}</td>`;
    days.forEach(d => {
      const done = records.has(d);
      html += `<td><div class="habit-cell ${done ? 'done' : ''} ${d === todayStr ? 'today' : ''}"></div></td>`;
    });
    html += '</tr>';
  });
  html += '</table>';
  box.innerHTML = HABITS.length ? html : '<p class="hint">还没有习惯</p>';
}

function renderHabitMonth() {
  const box = $('#habit-month');
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  box.innerHTML = `<h3 style="font-size:13px;margin-bottom:8px">${y} 年 ${m+1} 月</h3>`;
  const todayStr = now.toISOString().slice(0, 10);

  HABITS.forEach(h => {
    const records = new Set(h.records || []);
    const group = document.createElement('div');
    group.className = 'habit-month-group';
    let grid = '<div class="habit-month-grid">';
    // 月初是周几（周一开头）
    const firstDay = new Date(y, m, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) grid += '<div class="hm-cell empty"></div>';
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const done = records.has(ds);
      grid += `<div class="hm-cell ${done ? 'done' : ''}" title="${ds}${done ? ' ✓' : ''}"></div>`;
    }
    grid += '</div>';
    group.innerHTML = `<h4>${escapeHtml(h.name)} · ${records.size} 次</h4>${grid}`;
    box.appendChild(group);
  });
  if (!HABITS.length) box.innerHTML = '<p class="hint">还没有习惯</p>';
}

function renderHabitRecords() {
  const box = $('#habit-records');
  // 收集所有有记录的日期
  const dates = new Set();
  HABITS.forEach(h => (h.records || []).forEach(r => dates.add(r)));
  const sortedDates = [...dates].sort().reverse().slice(0, 30);  // 最近30天
  box.innerHTML = '';
  if (!sortedDates.length) { box.innerHTML = '<p class="hint">暂无记录</p>'; return; }

  sortedDates.forEach(ds => {
    const day = new Date(ds);
    const label = `${day.getMonth()+1}月${day.getDate()}日`;
    const doneCount = HABITS.filter(h => (h.records || []).includes(ds)).length;
    const total = HABITS.length;
    const pct = total ? Math.round(doneCount/total*100) : 0;

    let html = `<div class="habit-record-day"><h4>${label} · ${doneCount}/${total}</h4>`;
    HABITS.forEach(h => {
      const done = (h.records || []).includes(ds);
      html += `<div class="habit-record-row">
        <span>${escapeHtml(h.name)}</span>
        <div class="bar"><div class="bar-fill" style="width:${done ? '100%' : '0%'}"></div></div>
        <span class="status">${done ? '完成' : '未打卡'}</span>
      </div>`;
    });
    html += '</div>';
    box.innerHTML += html;
  });
}

// ===== 看板 =====
function renderKanban() {
  if (mainView !== 'kanban') return;
  const cols = { today: [], upcoming: [], done: [] };
  tasks.forEach(t => {
    if (t.done) cols.done.push(t);
    else if (t.status === '逾期' || t.status === '今日') cols.today.push(t);
    else cols.upcoming.push(t);
  });
  $$('.kanban-col').forEach(col => {
    const box = col.querySelector('.kanban-cards');
    box.innerHTML = '';
    cols[col.dataset.status].forEach(t => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.innerHTML = `${PRIO[t.priority] || ''} ${escapeHtml(t.title)}`;
      card.onclick = () => openDetail(t.id);
      box.appendChild(card);
    });
  });
}

// ===== 月历 =====
function renderCalendar() {
  if (mainView !== 'calendar') return;
  const now = new Date();
  if (!calYear) { calYear = now.getFullYear(); calMonth = now.getMonth() + 1; }
  $('#cal-title').textContent = `${calYear} 年 ${calMonth} 月`;

  const first = new Date(calYear, calMonth - 1, 1);
  const startWeekday = (first.getDay() + 6) % 7; // 周一开头
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth - 1, 0).getDate();

  const grid = $('#cal-grid');
  grid.innerHTML = '';
  ['一','二','三','四','五','六','日'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-weekday'; el.textContent = d;
    grid.appendChild(el);
  });

  // 当月任务按日期分组
  const byDate = {};
  tasks.forEach(t => { if (t.due) (byDate[t.due] = byDate[t.due] || []).push(t); });

  const todayStr = now.toISOString().slice(0, 10);
  for (let i = 0; i < 42; i++) {
    const dayNum = i - startWeekday + 1;
    const el = document.createElement('div');
    el.className = 'cal-cell';
    let y = calYear, m = calMonth, d = dayNum;
    if (dayNum < 1) { m--; d = daysInPrev + dayNum; if (m < 1) { m = 12; y--; } el.classList.add('other-month'); }
    else if (dayNum > daysInMonth) { m++; d = dayNum - daysInMonth; if (m > 12) { m = 1; y++; } el.classList.add('other-month'); }

    const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (dateStr === todayStr) el.classList.add('today');

    let html = `<div class="cal-day">${d}</div>`;
    const dayTasks = (byDate[dateStr] || []).slice(0, 2);
    dayTasks.forEach(t => html += `<div class="cal-task">• ${escapeHtml(t.title)}</div>`);
    const more = (byDate[dateStr] || []).length - dayTasks.length;
    if (more > 0) html += `<div class="cal-task more">+${more} 更多</div>`;
    el.innerHTML = html;
    el.onclick = () => showCalDay(dateStr, d);
    grid.appendChild(el);
  }
  // 默认显示今天
  showCalDay(todayStr, now.getDate());
}

let calSelectedDate = null;
function showCalDay(dateStr, dayNum) {
  calSelectedDate = dateStr;
  const d = new Date(dateStr);
  $('#cal-day-title').textContent = `${d.getMonth()+1}月${dayNum || d.getDate()}日`;
  const box = $('#cal-day-tasks');
  box.innerHTML = '';
  const dayTasks = tasks.filter(t => t.due === dateStr);
  if (!dayTasks.length) {
    box.innerHTML = '<p class="hint">当天没有任务</p>';
    return;
  }
  dayTasks.forEach(t => {
    const item = document.createElement('div');
    item.className = 'task-item' + (t.done ? ' done' : '');
    if (t.done) item.style.opacity = '0.5';
    item.innerHTML = `<div class="task-title">${escapeHtml(t.title)}</div>`;
    item.onclick = () => openDetail(t.id);
    box.appendChild(item);
  });
}

// ===== 统计 =====
async function loadStats() {
  const s = await api('/api/stats');
  $('#stat-total').textContent = s.total;
  $('#stat-done').textContent = s.done;
  $('#stat-undone').textContent = s.undone;
  $('#stat-rate').textContent = s.completion_rate + '%';

  const maxList = Math.max(1, ...Object.values(s.by_list));
  $('#chart-list').innerHTML = Object.entries(s.by_list).map(([k, v]) => `
    <div class="bar-row"><div class="bar-label">${listName(k)}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${v / maxList * 100}%"></div></div>
    <div class="bar-value">${v}</div></div>`).join('');

  const maxP = Math.max(1, ...Object.values(s.by_priority));
  $('#chart-priority').innerHTML = Object.entries(s.by_priority).map(([k, v]) => `
    <div class="bar-row"><div class="bar-label">${k}</div>
    <div class="bar-track"><div class="bar-fill" style="width:${v / maxP * 100}%"></div></div>
    <div class="bar-value">${v}</div></div>`).join('');
}

// ===== 番茄钟 =====
function pomoDisplay() {
  const m = Math.floor(pomo.remaining / 60), s = pomo.remaining % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function pomoRender() {
  $('#pomo-timer').textContent = pomoDisplay();
  $('#pomo-timer').classList.toggle('running', pomo.running);
  if (pomo.running) {
    const t = tasks.find(x => x.id === pomo.targetId);
    $('#pomo-hint').textContent = `正在专注：${t ? t.title : ''}`;
    $('#pomo-start').disabled = true;
  } else {
    $('#pomo-hint').textContent = '选中一项任务后开始';
    $('#pomo-start').disabled = false;
  }
}
function pomoStart() {
  const t = tasks[selectedIdx];
  if (!t || t.done) { toast('请先选中一项未完成任务'); return; }
  pomo.targetId = t.id;
  pomo.total = (t.remain && t.remain > 0) ? t.remain * 60 : 25 * 60;
  pomo.remaining = pomo.total;
  pomo.running = true;
  clearInterval(pomo.timer);
  pomo.timer = setInterval(() => {
    pomo.remaining--;
    if (pomo.remaining <= 0) {
      clearInterval(pomo.timer);
      pomo.running = false;
      // 扣减 remain
      const spent = Math.round(pomo.total / 60);
      api(`/api/tasks/${pomo.targetId}`, { method: 'PUT', body: JSON.stringify({}) })
        .then(() => api(`/api/tasks/${pomo.targetId}`))
        .then(t => {
          const newRemain = Math.max(0, (t.remain || 0) - spent);
          return api(`/api/tasks/${pomo.targetId}`, { method: 'PUT', body: JSON.stringify({ est: newRemain }) });
        })
        .then(() => { toast(`番茄钟结束！扣减 ${spent} 分钟`); loadTasks(); pomoRender(); });
    }
    pomoRender();
  }, 1000);
  pomoRender();
}
function pomoPause() { pomo.running = false; clearInterval(pomo.timer); pomoRender(); }
function pomoReset() { pomoPause(); pomo.remaining = 25*60; pomo.targetId = null; pomoRender(); }

// ===== 深色模式 =====
function initDark() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  $('#dark-toggle').textContent = saved === 'dark' ? '☀️' : '🌙';
  $('#dark-toggle').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark';
    if (cur) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme','light'); }
    else { document.documentElement.setAttribute('data-theme','dark'); localStorage.setItem('theme','dark'); }
    $('#dark-toggle').textContent = cur ? '🌙' : '☀️';
  };
}

// ===== Toast =====
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.hidden = true, 2000);
}

// ===== 快捷键 =====
function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveDetail(); }
      return;
    }
    if (e.key === 'n' || e.key === 'N') openNew();
    else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    else if (e.key === 'j' || e.key === 'J') { selectedIdx = Math.min(tasks.length-1, selectedIdx+1); renderList(); }
    else if (e.key === 'k' || e.key === 'K') { selectedIdx = Math.max(0, selectedIdx-1); renderList(); }
    else if (e.key === ' ') { e.preventDefault(); if (tasks[selectedIdx]) toggleDone(tasks[selectedIdx]); }
    else if (e.key === 'e' || e.key === 'E') { if (tasks[selectedIdx]) openDetail(tasks[selectedIdx].id); }
    else if (e.key === 'Escape') { closeDetail(); $('#new-modal').hidden = true; }
  });
}

// ===== 截止通知（修正版）=====
function initNotify() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
  setInterval(async () => {
    if (Notification.permission !== 'granted') return;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const data = await api('/api/tasks?view=all');
    data.tasks.forEach(t => {
      if (t.done || t.due !== todayStr || !t.due_time) return;
      const [h, m] = t.due_time.split(':').map(Number);
      const dueMinutes = h * 60 + m;
      if (Math.abs(dueMinutes - nowMinutes) < 1) {
        new Notification('⏰ 任务到期', { body: t.title });
      }
    });
  }, 30000);
}

// ===== 事件绑定 =====
function init() {
  initDark(); initShortcuts(); initNotify(); pomoRender();

  $$('.nav-item[data-view]').forEach(b => b.onclick = () => switchView(b.dataset.view));
  $('#view-list-btn').onclick = () => switchMainView('list');
  $('#view-kanban-btn').onclick = () => switchMainView('kanban');
  $('#view-calendar-btn').onclick = () => switchMainView('calendar');
  $('#view-stats-btn').onclick = () => switchMainView('stats');
  $('#view-quad-btn').onclick = () => switchMainView('quadrant');
  $('#view-habit-btn').onclick = () => switchMainView('habit');
  $('#view-settings-btn').onclick = () => switchMainView('settings');

  $('#habit-add-btn').onclick = async () => {
    const name = prompt('新习惯名称（如：喝水、运动、读书）');
    if (!name || !name.trim()) return;
    await api('/api/habits', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    loadHabits();
  };
  document.querySelectorAll('.habit-tab').forEach(b => {
    b.onclick = () => { habitTab = b.dataset.habitTab; renderHabitPanes(); };
  });

  $('#set-clear-done').onclick = async () => {
    if (!confirm('确定清除所有已完成任务？此操作不可恢复')) return;
    await api('/api/tasks/clear-done', { method: 'POST' });
    loadTasks(); toast('已清除');
  };

  // WebDAV 同步
  (async () => {
    try {
      const c = await api('/api/sync/config');
      $('#sync-url').value = c.url || '';
      $('#sync-user').value = c.user || '';
    } catch {}
  })();
  $('#sync-save').onclick = async () => {
    await api('/api/sync/config', { method: 'POST', body: JSON.stringify({
      url: $('#sync-url').value, user: $('#sync-user').value, password: $('#sync-pass').value
    })});
    toast('配置已保存');
  };
  $('#sync-push').onclick = async () => {
    toast('正在上传...');
    const r = await api('/api/sync/push', { method: 'POST' });
    toast(r.ok ? '✅ 已上传到坚果云' : '❌ 上传失败，检查配置');
  };
  $('#sync-pull').onclick = async () => {
    if (!confirm('从坚果云下载会覆盖本地数据，继续？')) return;
    toast('正在下载...');
    const r = await api('/api/sync/pull', { method: 'POST' });
    toast(r.ok ? `✅ 已下载 ${r.imported} 个文件` : '❌ 下载失败');
    loadTasks();
  };

  $('#add-list-btn').onclick = async () => {
    const name = prompt('新清单名称');
    if (!name || !name.trim()) return;
    const icon = prompt('图标（emoji，留空默认 📁）') || '📁';
    const r = await api('/api/lists', { method: 'POST', body: JSON.stringify({ name: name.trim(), icon }) });
    toast(`已创建清单「${r.name}」`);
    await renderLists();
    switchView(r.id);
  };

  $('#new-btn').onclick = openNew;
  $('#n-ok').onclick = () => submitNew(true);
  $('#n-save-new').onclick = () => submitNew(false);
  $('#n-cancel').onclick = () => $('#new-modal').hidden = true;
  $('#new-modal').onclick = (e) => { if (e.target.id === 'new-modal') $('#new-modal').hidden = true; };

  $('#export-btn').onclick = () => window.location.href = '/api/export.csv';

  $('#d-close').onclick = closeDetail;
  $('#d-save').onclick = saveDetail;
  $('#d-delete').onclick = () => { if (currentTaskId) deleteTask(currentTaskId); };
  $('#d-pin').onclick = async () => {
    if (!currentTaskId) return;
    const t = tasks.find(x => x.id === currentTaskId);
    await api(`/api/tasks/${currentTaskId}`, { method: 'PUT', body: JSON.stringify({ pinned: !t.pinned }) });
    loadTasks(); openDetail(currentTaskId);
  };
  $('#d-abandon').onclick = async () => {
    if (!currentTaskId) return;
    const t = tasks.find(x => x.id === currentTaskId);
    await api(`/api/tasks/${currentTaskId}`, { method: 'PUT', body: JSON.stringify({ abandoned: !t.abandoned }) });
    toast(t.abandoned ? '已恢复' : '已放弃');
    closeDetail(); loadTasks();
  };
  $('#d-duplicate').onclick = async () => {
    if (!currentTaskId) return;
    await api(`/api/tasks/${currentTaskId}/duplicate`, { method: 'POST' });
    toast('已创建副本');
    closeDetail(); loadTasks();
  };
  $('#d-sub-add').onclick = () => {
    const v = $('#d-sub-new').value.trim();
    if (!v || !currentTaskId) return;
    const t = tasks.find(x => x.id === currentTaskId);
    t.subtasks.push({ title: v, done: false });
    $('#d-sub-new').value = '';
    renderSubtasks(t.subtasks); saveDetail();
  };

  $('#pomo-start').onclick = pomoStart;
  $('#pomo-pause').onclick = pomoPause;
  $('#pomo-reset').onclick = pomoReset;

  $('#cal-prev').onclick = () => { calMonth--; if (calMonth < 1) { calMonth = 12; calYear--; } renderCalendar(); };
  $('#cal-next').onclick = () => { calMonth++; if (calMonth > 12) { calMonth = 1; calYear++; } renderCalendar(); };

  let searchTimer;
  $('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadTasks, 200); });
  $('#filter-priority').onchange = loadTasks;
  $('#filter-list').onchange = loadTasks;

  // ===== 移动端交互 =====
  const sidebar = $('.sidebar');
  const mask = $('#sidebar-mask');
  $('#menu-btn').onclick = () => {
    sidebar.classList.add('open');
    mask.classList.add('show');
  };
  mask.onclick = () => {
    sidebar.classList.remove('open');
    mask.classList.remove('show');
  };
  $('#fab-add').onclick = () => { $('#new-btn').click(); };
  document.querySelectorAll('.bn-item').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const v = btn.dataset.view;
      if (v === 'list') switchMainView('list');
      else if (v === 'calendar') switchMainView('calendar');
      else if (v === 'quadrant') switchMainView('quadrant');
      else if (v === 'habit') switchMainView('habit');
      else if (v === 'settings') switchMainView('settings');
      $('#mobile-title').textContent = btn.querySelector('.bn-label').textContent;
    };
  });

  loadTasks();
}

init();
