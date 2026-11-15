// Minha Agenda IA — interface principal (PC e celular).
import { $, $$, esc, icon, toast, fmtDue, relDay, hm, longDay, cap, openModal, closeModal, modalOpen, confirmBox, promptBox } from './ui.js';
import { Store } from './store.js';
import { parseTask } from './parser.js';
import { describe, dateKey, setHolidayOptions, holidayName } from './recurrence.js';
import { completeTask, reopenTask, isOverdue, isToday, inNextDays, sortTasks, taskOccurrencesInRange, PRIORITIES } from './tasks.js';
import { openEditor } from './editor.js';
import { openSettings } from './settings.js';
import { highlight, snippet } from './search.js';
import { searchState, syncIndex, renderSearchView, handleSearchClick, renderDashboard, kpiToCriteria } from './explore.js';
import { emptyCriteria } from './insights.js';
import { initNotifications, reschedule as rescheduleNotifs, isNative, initNativePush, snoozeLocal } from './notify.js';
import { refreshPush } from './push.js';

const store = new Store({ defaults: globalThis.AGENDA_CONFIG || {} });
const ui = { view: 'today', list: null, tag: null, search: '', firstSync: false, calMonth: firstOfMonth(new Date()), calDay: dateKey(new Date()), calMode: 'month', drawer: false };
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

const VIEWS = [
  { id: 'today', label: 'Hoje', icon: 'sun' }, { id: 'next7', label: 'Próximos 7 dias', icon: 'week' },
  { id: 'inbox', label: 'Caixa de entrada', icon: 'inbox' }, { id: 'all', label: 'Todas', icon: 'all' },
  { id: 'calendar', label: 'Calendário', icon: 'calendar' }, { id: 'done', label: 'Concluídas', icon: 'done' },
  { id: 'dashboard', label: 'Painel', icon: 'chart' }, { id: 'search', label: 'Busca avançada', icon: 'search' }
];
const SPECIAL = new Set(['calendar', 'dashboard', 'search']);
const listById = id => store.lists().find(l => l.id === id);

// ---------- contexto compartilhado com editor/configurações ----------
const ctx = {
  store,
  currentList: () => ui.list,
  toggleTask, deleteTask,
  render: () => render(),
  reschedule: () => reschedule(),
  exportBackup,
  afterLogin: () => { applySettings(); render(); reschedule(); if (isNative()) initNativePush(store, () => { reschedule(); render(); }); }
};

// ---------- ações de tarefa ----------
function toggleTask(id, { subId = null } = {}) {
  const t = store.task(id); if (!t) return;
  if (subId) { t.subtasks = t.subtasks.map(s => s.id === subId ? { ...s, done: true } : s); store.saveTask(t); return; }
  const before = structuredClone(t);
  if (t.done) { store.saveTask(reopenTask(t)); toast('Tarefa reaberta.'); return; }
  const r = completeTask(t);
  store.saveTask(r.task);
  const undo = { label: 'Desfazer', fn: () => store.saveTask(before) };
  if (r.next) toast(`Feito! Próxima: ${fmtDue(r.task, r.next)}`, { action: undo });
  else toast('Tarefa concluída. 🎉', { action: undo });
}
function deleteTask(id) {
  const t = store.task(id); if (!t) return;
  store.remove(id);
  toast('Tarefa excluída.', { action: t.attachments?.length ? null : { label: 'Desfazer', fn: () => store.saveTask(t) } });
}
function exportBackup() {
  const blob = new Blob([JSON.stringify(store.exportJSON(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `agenda-backup-${dateKey(new Date())}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup baixado.');
}

// ---------- seleção de tarefas por visão ----------
function visibleTasks() {
  let ts = store.tasks();
  if (ui.list) ts = ts.filter(t => t.list === ui.list && !t.done);
  else if (ui.tag) ts = ts.filter(t => t.tags.includes(ui.tag) && !t.done);
  else if (ui.view === 'today') ts = ts.filter(t => !t.done && t.dueAt && (isToday(t) || isOverdue(t)));
  else if (ui.view === 'next7') ts = ts.filter(t => !t.done && t.dueAt && (inNextDays(t, 6) || isOverdue(t)));
  else if (ui.view === 'inbox') ts = ts.filter(t => !t.done && !t.list);
  else if (ui.view === 'all') ts = ts.filter(t => !t.done);
  else if (ui.view === 'done') ts = ts.filter(t => t.done).sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  return ui.view === 'done' && !ui.list && !ui.tag ? ts : sortTasks(ts);
}
function groupTasks(ts) {
  const now = new Date(), groups = new Map();
  const add = (k, label, t) => { if (!groups.has(k)) groups.set(k, { label, items: [] }); groups.get(k).items.push(t); };
  for (const t of ts) {
    if (t.done) { add('done', 'Concluídas', t); continue; }
    if (!t.dueAt) { add('zz-none', 'Sem data', t); continue; }
    if (isOverdue(t, now)) { add('0-over', 'Atrasadas', t); continue; }
    const d = new Date(t.dueAt), k = dateKey(d);
    if (ui.view === 'next7' && !ui.list && !ui.tag) add(k, `${relDay(d)} • ${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })}`, t);
    else if (isToday(t, now)) add('1-today', 'Hoje', t);
    else if (inNextDays(t, 1, now)) add('2-tomorrow', 'Amanhã', t);
    else if (inNextDays(t, 7, now)) add('3-week', 'Próximos 7 dias', t);
    else add('4-later', 'Mais tarde', t);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, g]) => g);
}

// ---------- renderização ----------
function taskRow(t, { occurrence = null, matched = null } = {}) {
  const at = occurrence?.at || (t.dueAt ? new Date(t.dueAt) : null);
  const virtual = occurrence?.virtual;
  const l = t.list ? listById(t.list) : null;
  const subDone = t.subtasks.filter(s => s.done).length;
  const over = !virtual && isOverdue(t);
  const meta = [
    at ? `<span class="meta ${over ? 'over' : isToday({ dueAt: at.toISOString() }) ? 'today' : ''}">${icon('calendar')}${esc(fmtDue(t, at))}${t.durationMin && !t.allDay ? '–' + hm(new Date(at.getTime() + t.durationMin * 60000)) : ''}</span>` : '',
    t.recurrence ? `<span class="meta" title="${esc(describe(t.recurrence, t.recurrenceAnchor))}">${icon('repeat')}</span>` : '',
    t.reminders?.length && at && !t.done ? `<span class="meta">${icon('bell')}</span>` : '',
    t.subtasks.length ? `<span class="meta">${icon('sub')}${subDone}/${t.subtasks.length}</span>` : '',
    t.attachments?.length ? `<span class="meta">${icon('clip')}${t.attachments.length}</span>` : '',
    t.notes?.trim() ? `<span class="meta">${icon('edit')}</span>` : '',
    ...t.tags.map(g => `<span class="tag">#${esc(g)}</span>`),
    l && ui.list !== l.id ? `<span class="meta list-name"><i class="dot" style="--c:${esc(l.color)}"></i>${esc(l.name)}</span>` : ''
  ].join('');
  return `<div class="task ${t.done ? 'done' : ''} ${virtual ? 'virtual' : ''}" data-id="${esc(t.id)}">
    <button class="check prio-${t.priority} ${t.done ? 'checked' : ''}" data-act="toggle" ${virtual ? 'disabled title="Ocorrência futura"' : ''} aria-label="${t.done ? 'Reabrir' : 'Concluir'}">${t.done ? icon('check') : ''}</button>
    <div class="task-body" data-act="open"><div class="task-title">${matched ? highlight(t.title, matched) : esc(t.title)}</div>${matched && t.notes ? (s => s ? `<div class="task-snippet">${s}</div>` : '')(snippet(t.notes, matched)) : ''}${meta ? `<div class="task-meta">${meta}</div>` : ''}
    ${t.subtasks.length && !t.done && !virtual ? `<div class="mini-progress"><i style="width:${(subDone / t.subtasks.length) * 100}%"></i></div>` : ''}</div>
  </div>`;
}

function renderSidebar() {
  const ts = store.tasks().filter(t => !t.done);
  const counts = { today: ts.filter(t => t.dueAt && (isToday(t) || isOverdue(t))).length, next7: ts.filter(t => t.dueAt && (inNextDays(t, 6) || isOverdue(t))).length, inbox: ts.filter(t => !t.list).length, all: ts.length };
  const tags = [...new Set(store.tasks().flatMap(t => t.tags))].sort();
  const st = store.status;
  const syncTxt = !store.online ? 'Modo local' : st.state === 'syncing' ? 'Sincronizando…' : st.state === 'synced' ? 'Sincronizado' : st.state === 'offline' ? 'Offline' : st.state === 'error' ? 'Erro na sincronização' : 'Conectado';
  $('#sidebar').innerHTML = `
    <div class="brand"><span class="logo">${icon('check')}</span><div><b>Minha Agenda</b><small>${esc(store.supa.user?.email || 'neste aparelho')}</small></div></div>
    <button class="btn primary block" data-act="new">${icon('plus')} Nova tarefa</button>
    <nav>${VIEWS.map(v => `<button class="nav ${ui.view === v.id && !ui.list && !ui.tag ? 'on' : ''}" data-view="${v.id}">${icon(v.icon)}<span>${v.label}</span>${counts[v.id] ? `<em>${counts[v.id]}</em>` : ''}</button>`).join('')}</nav>
    <div class="nav-title"><span>Listas</span><button class="icon-btn sm" data-act="new-list" title="Nova lista">${icon('plus')}</button></div>
    <nav>${store.lists().map(l => `<div class="nav-row"><button class="nav ${ui.list === l.id ? 'on' : ''}" data-list="${esc(l.id)}"><i class="dot" style="--c:${esc(l.color)}"></i><span>${esc(l.name)}</span>${ts.filter(t => t.list === l.id).length ? `<em>${ts.filter(t => t.list === l.id).length}</em>` : ''}</button><button class="icon-btn sm ghost-hover" data-edit-list="${esc(l.id)}" title="Editar lista">${icon('dots')}</button></div>`).join('')}</nav>
    ${(store.settings().savedFilters || []).length ? `<div class="nav-title"><span>Filtros salvos</span></div><nav>${store.settings().savedFilters.map(f => `<div class="nav-row"><button class="nav ${ui.view === 'search' && searchState.savedId === f.id ? 'on' : ''}" data-open-saved="${esc(f.id)}">${icon('sparkle')}<span>${esc(f.name)}</span></button><button class="icon-btn sm ghost-hover" data-del-saved="${esc(f.id)}" title="Apagar filtro">${icon('x')}</button></div>`).join('')}</nav>` : ''}
    ${tags.length ? `<div class="nav-title"><span>Etiquetas</span></div><nav class="tags">${tags.map(g => `<button class="tag-btn ${ui.tag === g ? 'on' : ''}" data-tag="${esc(g)}">#${esc(g)}</button>`).join('')}</nav>` : ''}
    <div class="side-foot">
      <button class="sync-badge ${store.online ? st.state : 'local'}" data-act="settings">${icon(store.online && st.state !== 'offline' ? 'cloud' : 'cloudOff')} ${syncTxt}</button>
      <button class="icon-btn" data-act="settings" title="Configurações">${icon('settings')}</button>
    </div>`;
}

function viewTitle() {
  if (ui.list) return listById(ui.list)?.name || 'Lista';
  if (ui.tag) return `#${ui.tag}`;
  return VIEWS.find(v => v.id === ui.view)?.label || 'Hoje';
}

function renderMain() {
  $('#view-title').textContent = viewTitle();
  $('#view-sub').textContent = ui.view === 'today' && !ui.list && !ui.tag ? longDay(new Date()) : ui.view === 'dashboard' && !ui.list && !ui.tag ? 'Seus números em tempo real' : '';
  const box = $('#view');
  $('#quick').hidden = !ui.list && !ui.tag && ['done', 'dashboard', 'search'].includes(ui.view);
  document.body.classList.toggle('searching', ui.view === 'search' && !ui.list && !ui.tag);
  if (ui.view === 'calendar' && !ui.list && !ui.tag) { box.innerHTML = renderCalendar(); return; }
  if (ui.view === 'search' && !ui.list && !ui.tag) { box.innerHTML = renderSearchView(helpers); return; }
  if (ui.view === 'dashboard' && !ui.list && !ui.tag) { box.innerHTML = renderDashboard(helpers); return; }
  const ts = visibleTasks();
  let html = '';
  if (globalThis.AGENDA_CONFIG?.preview) html += `<div class="banner">${icon('sparkle')}<div><b>Prévia para experimentar</b><span>Aqui as tarefas ficam só neste navegador e não há sincronização nem anexos. A versão instalada (APK + PC) tem tudo.</span></div></div>`;
  else if (!store.online && !store.ls.getItem('agenda.hideSyncTip')) html += `<div class="banner">${icon('cloud')}<div><b>Sincronize com o computador</b><span>Conecte sua conta grátis do Supabase em Configurações para ver as mesmas tarefas no celular e no PC e poder anexar arquivos.</span></div><button class="btn ghost sm" data-act="settings">Conectar</button><button class="icon-btn sm" data-act="hide-tip">${icon('x')}</button></div>`;
  if (ui.view === 'next7' && !ui.list && !ui.tag) html += renderNext7(ts);
  else if (!ts.length) html += emptyState();
  else for (const g of (ui.view === 'done' && !ui.list && !ui.tag ? [{ label: '', items: ts }] : groupTasks(ts))) {
    html += `<section class="group">${g.label ? `<h4>${esc(g.label)} <small>${g.items.length}</small></h4>` : ''}${g.items.map(t => taskRow(t)).join('')}</section>`;
  }
  box.innerHTML = html;
}
function renderNext7(ts) {
  // Mostra também as próximas ocorrências das tarefas que se repetem.
  const now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate()), end = new Date(start); end.setDate(end.getDate() + 7);
  const overdue = ts.filter(t => isOverdue(t));
  const byDay = new Map();
  for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); byDay.set(dateKey(d), []); }
  for (const t of store.tasks().filter(t => !t.done && t.dueAt)) {
    for (const o of taskOccurrencesInRange(t, start, end)) { if (o.virtual || !isOverdue(t)) byDay.get(dateKey(o.at))?.push({ t, o }); }
  }
  let html = overdue.length ? `<section class="group"><h4>Atrasadas <small>${overdue.length}</small></h4>${overdue.map(t => taskRow(t)).join('')}</section>` : '';
  for (const [k, items] of byDay) {
    const d = new Date(k + 'T12:00'); const h = holidayName(d);
    items.sort((a, b) => (a.t.allDay === b.t.allDay ? a.o.at - b.o.at : a.t.allDay ? -1 : 1));
    html += `<section class="group"><h4>${esc(relDay(d))} <span class="muted">• ${esc(d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }))}</span>${h ? ` <span class="holiday">${esc(h)}</span>` : ''} <small>${items.length || ''}</small></h4>
      ${items.length ? items.map(({ t, o }) => taskRow(t, { occurrence: o })).join('') : `<div class="empty-day" data-act="new-on" data-day="${k}">${icon('plus')} Adicionar</div>`}</section>`;
  }
  return html;
}
function emptyState() {
  const msg = ui.view === 'today' ? ['Dia livre!', 'Nenhuma tarefa para hoje. Aproveite ou planeje a semana.'] : ui.view === 'done' ? ['Nada concluído ainda', 'As tarefas concluídas aparecem aqui.'] : ['Tudo em ordem', 'Adicione uma tarefa no campo acima.'];
  return `<div class="empty">${icon(ui.view === 'today' ? 'sun' : 'done')}<h3>${msg[0]}</h3><p>${msg[1]}</p></div>`;
}

function renderCalendar() {
  const y = ui.calMonth.getFullYear(), mo = ui.calMonth.getMonth();
  const tasks = store.tasks();
  let cells = [], from, to;
  if (ui.calMode === 'week') {
    const sel = new Date(ui.calDay + 'T12:00'); from = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate() - ((sel.getDay() + 6) % 7)); to = new Date(from); to.setDate(to.getDate() + 7);
    for (let i = 0; i < 7; i++) { const d = new Date(from); d.setDate(d.getDate() + i); cells.push({ d, muted: false }); }
  } else {
    const first = new Date(y, mo, 1), offset = (first.getDay() + 6) % 7;
    from = new Date(y, mo, 1 - offset); const total = Math.ceil((offset + new Date(y, mo + 1, 0).getDate()) / 7) * 7; to = new Date(from); to.setDate(to.getDate() + total);
    for (let i = 0; i < total; i++) { const d = new Date(from); d.setDate(d.getDate() + i); cells.push({ d, muted: d.getMonth() !== mo }); }
  }
  const byDay = new Map();
  for (const t of tasks) for (const o of taskOccurrencesInRange(t, from, new Date(to.getTime() - 1))) { const k = dateKey(o.at); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push({ t, o }); }
  for (const arr of byDay.values()) arr.sort((a, b) => (a.t.done - b.t.done) || (a.t.allDay === b.t.allDay ? a.o.at - b.o.at : a.t.allDay ? -1 : 1));
  const todayK = dateKey(new Date());
  const title = ui.calMode === 'week' ? `${from.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} – ${new Date(to.getTime() - 86400000).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}` : cap(ui.calMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  const head = `<div class="cal-head"><div class="row gap"><button class="icon-btn" data-cal="prev">${icon('left')}</button><h3>${esc(title)}</h3><button class="icon-btn" data-cal="next">${icon('right')}</button><button class="btn ghost sm" data-cal="today">Hoje</button></div>
    <div class="seg small"><button class="${ui.calMode === 'month' ? 'on' : ''}" data-cal="month">Mês</button><button class="${ui.calMode === 'week' ? 'on' : ''}" data-cal="week">Semana</button></div></div>`;
  const grid = `<div class="cal ${ui.calMode}">${['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(w => `<div class="cal-wd">${w}</div>`).join('')}${cells.map(({ d, muted }) => {
    const k = dateKey(d), items = byDay.get(k) || [], h = holidayName(d);
    const max = ui.calMode === 'week' ? 50 : 3;
    return `<div class="cal-day ${muted ? 'muted' : ''} ${k === todayK ? 'today' : ''} ${k === ui.calDay ? 'sel' : ''} ${h ? 'hol' : ''}" data-day="${k}">
      <div class="cal-num"><span>${d.getDate()}</span>${h ? `<small title="${esc(h)}">${esc(h.length > 14 ? h.slice(0, 13) + '…' : h)}</small>` : ''}</div>
      ${items.slice(0, max).map(({ t, o }) => `<div class="cal-item prio-${t.priority} ${t.done ? 'done' : ''} ${o.virtual ? 'virtual' : ''}" data-open="${esc(t.id)}" style="--c:${esc(listById(t.list)?.color || '#8b7cf6')}">${t.allDay ? '' : `<b>${hm(o.at)}</b> `}${esc(t.title)}</div>`).join('')}
      ${items.length > max ? `<div class="cal-more">+${items.length - max}</div>` : ''}
      <div class="cal-dots">${items.slice(0, 4).map(({ t }) => `<i style="--c:${esc(listById(t.list)?.color || '#8b7cf6')}"></i>`).join('')}</div>
    </div>`;
  }).join('')}</div>`;
  const sel = byDay.get(ui.calDay) || [];
  const selD = new Date(ui.calDay + 'T12:00');
  const agenda = `<section class="group day-agenda"><h4>${esc(longDay(selD))}${holidayName(selD) ? ` <span class="holiday">${esc(holidayName(selD))}</span>` : ''} <small>${sel.length || ''}</small></h4>
    ${sel.map(({ t, o }) => taskRow(t, { occurrence: o })).join('') || `<div class="empty-day" data-act="new-on" data-day="${ui.calDay}">${icon('plus')} Adicionar tarefa neste dia</div>`}</section>`;
  return head + grid + agenda;
}

function renderBottomNav() {
  const items = [VIEWS[0], VIEWS[1], VIEWS[4], VIEWS[6]];
  $('#bottom-nav').innerHTML = items.map(v => `<button class="${ui.view === v.id && !ui.list && !ui.tag ? 'on' : ''}" data-view="${v.id}">${icon(v.icon)}<span>${v.id === 'next7' ? '7 dias' : v.label}</span></button>`).join('') + `<button data-act="drawer">${icon('menu')}<span>Mais</span></button>`;
}
function render() {
  renderSidebar(); renderMain(); renderBottomNav();
  document.body.classList.toggle('drawer-open', ui.drawer);
}

// ---------- entrada rápida com pré-visualização ----------
function quickPreview() {
  const v = $('#quick-input').value.trim(), box = $('#quick-preview');
  if (!v) { box.innerHTML = '<span class="muted">Escreva naturalmente: “Pagar DAS todo dia 20 antecipando 9h #impostos”, “Reunião sexta 14h”, “Condomínio todo 1º domingo do mês”. Enter cria; Shift+Enter abre os detalhes.</span>'; return null; }
  let p; try { p = parseTask(v); } catch { return null; }
  const listName = p.list ? (store.lists().find(l => l.name.toLowerCase() === p.list.toLowerCase())?.name || `${p.list} (nova)`) : null;
  box.innerHTML = [
    `<span class="pv title">${esc(p.title)}</span>`,
    p.dueAt ? `<span class="pv">${icon('calendar')}${esc(fmtDue(p, new Date(p.dueAt)))}</span>` : '',
    p.recurrence ? `<span class="pv">${icon('repeat')}${esc(describe(p.recurrence, p.dueAt))}</span>` : '',
    p.priority ? `<span class="pv prio-${p.priority}">${icon('flag')}${PRIORITIES[p.priority].label}</span>` : '',
    listName ? `<span class="pv">${icon('list')}${esc(listName)}</span>` : '',
    ...p.tags.map(g => `<span class="pv">#${esc(g)}</span>`),
    ...p.warnings.map(w => `<span class="pv warn">⚠ ${esc(w)}</span>`)
  ].join('');
  return p;
}
function quickAdd(openDetails = false) {
  const inp = $('#quick-input'); const v = inp.value.trim();
  if (!v) { openEditor(ctx, null, defaultDraft()); return; }
  const p = parseTask(v);
  let listId = ui.list || null;
  if (p.list) { const found = store.lists().find(l => l.name.toLowerCase() === p.list.toLowerCase()); listId = found ? found.id : store.saveList({ name: p.list }).id; }
  const s = store.settings();
  const draft = { ...defaultDraft(), title: p.title, dueAt: p.dueAt, allDay: p.allDay, recurrence: p.recurrence, recurrenceAnchor: p.dueAt, priority: p.priority, list: listId, tags: [...new Set([...(ui.tag ? [ui.tag] : []), ...p.tags])] };
  if (!draft.dueAt && ui.view === 'today' && !ui.list && !ui.tag) { const d = new Date(); d.setHours(0, 0, 0, 0); draft.dueAt = d.toISOString(); draft.allDay = true; }
  if (draft.dueAt) draft.reminders = draft.allDay ? [...(s.defaultAllDayReminders || [0])] : [...(s.defaultReminders || [0])];
  inp.value = ''; quickPreview();
  if (openDetails) { openEditor(ctx, null, draft); return; }
  const t = store.saveTask(draft);
  toast(`Criada: ${t.title}${t.dueAt ? ' • ' + fmtDue(t) : ''}`, { action: { label: 'Editar', fn: () => openEditor(ctx, store.task(t.id)) } });
}
function defaultDraft(dayKey) {
  const d = {};
  if (dayKey || ui.view === 'calendar') { const k = dayKey || ui.calDay; const x = new Date(k + 'T00:00'); d.dueAt = x.toISOString(); d.allDay = true; }
  else if (ui.view === 'today' && !ui.list && !ui.tag) { const x = new Date(); x.setHours(0, 0, 0, 0); d.dueAt = x.toISOString(); d.allDay = true; }
  if (ui.tag) d.tags = [ui.tag];
  return d;
}

// ---------- tela de aviso (ao tocar numa notificação no celular) ----------
async function openAlertSheet(id, subId = null) {
  if (store.online) await store.sync().catch(() => {}); // garante a versão mais recente
  const t = store.task(id); if (!t) return toast('Essa tarefa não existe mais.');
  const sub = subId ? t.subtasks.find(s => s.id === subId) : null;
  const m = openModal(`<div class="confirm alert-sheet">
      <div class="row gap"><span class="logo">${icon('bell')}</span><div><h3>${esc(sub ? sub.title : t.title)}</h3><small class="muted">${esc(sub ? `Etapa de “${t.title}”` : fmtDue(t) || 'Sem data')}${t.done ? ' • já concluída' : ''}</small></div></div>
      ${!t.done ? `<button class="btn primary block" data-s="done">${icon('check')} Concluir${t.recurrence && !sub ? ' (vai para a próxima data)' : ''}</button>` : ''}
      <div class="row gap"><button class="btn ghost grow" data-s="10">Adiar 10 min</button><button class="btn ghost grow" data-s="60">Adiar 1 h</button></div>
      <button class="btn ghost block" data-s="open">${icon('edit')} Abrir tarefa</button>
    </div>`, { cls: 'small' });
  m.addEventListener('click', async e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    const a = b.dataset.s; closeModal();
    if (a === 'done') toggleTask(id, { subId });
    else if (a === 'open') openEditor(ctx, store.task(id));
    else { await snoozeLocal(t, Number(a), subId); toast(`Vou lembrar de novo em ${a === '60' ? '1 hora' : '10 minutos'}.`); }
  });
}

// ---------- busca avançada e painel ----------
const helpers = {
  store, taskRow, listById,
  setSearchInput: v => { $('#search').value = v; },
  saveFilter: () => saveFilter(),
  loading: () => store.online && !ui.firstSync && store.status.state === 'syncing'
};
async function saveFilter() {
  const r = await promptBox('Salvar filtro', { placeholder: 'Ex.: Impostos do mês', ok: 'Salvar' });
  if (!r?.value) return;
  const list = [...(store.settings().savedFilters || [])];
  const f = { id: crypto.randomUUID?.() || String(Date.now()), name: r.value, query: searchState.query, criteria: structuredClone(searchState.criteria) };
  list.push(f); store.saveSettings({ savedFilters: list.slice(-30) });
  searchState.savedId = f.id; toast('Filtro salvo. Ele aparece no menu e nos outros aparelhos.');
}
function openSaved(id) {
  const f = (store.settings().savedFilters || []).find(x => x.id === id); if (!f) return;
  searchState.savedId = f.id; searchState.criteria = { ...emptyCriteria(), ...structuredClone(f.criteria) }; searchState.query = f.query || '';
  setView('search'); $('#search').value = searchState.query;
}
async function deleteSaved(id) {
  const f = (store.settings().savedFilters || []).find(x => x.id === id); if (!f) return;
  if (!(await confirmBox(`Apagar o filtro salvo “${f.name}”?`, { ok: 'Apagar', danger: true }))) return;
  store.saveSettings({ savedFilters: (store.settings().savedFilters || []).filter(x => x.id !== id) });
  if (searchState.savedId === id) searchState.savedId = null;
}
// dica flutuante dos gráficos
const tipEl = document.createElement('div'); tipEl.className = 'tip-float'; document.body.appendChild(tipEl);
document.addEventListener('pointerover', e => {
  const t = e.target.closest('[data-tip]'); if (!t) { tipEl.classList.remove('show'); return; }
  tipEl.textContent = t.dataset.tip; const r = t.getBoundingClientRect();
  tipEl.style.left = `${Math.min(window.innerWidth - 10, Math.max(10, r.left + r.width / 2))}px`; tipEl.style.top = `${r.top - 8}px`; tipEl.classList.add('show');
});
document.addEventListener('scroll', () => tipEl.classList.remove('show'), true);
document.addEventListener('change', e => {
  if (e.target.matches('[data-s="sort"]')) { searchState.sort = e.target.value; renderMain(); }
});

// ---------- listas ----------
const COLORS = ['#8b7cf6', '#4f8fe8', '#2fb383', '#f0a33a', '#e86f8a', '#e5484d', '#14b8c4', '#7c8798'];
const colorPicker = sel => `<div class="colors">${COLORS.map(c => `<label><input type="radio" name="color" value="${c}" ${c === sel ? 'checked' : ''}><i style="--c:${c}"></i></label>`).join('')}</div>`;
async function newList() {
  const r = await promptBox('Nova lista', { placeholder: 'Nome da lista', ok: 'Criar', extra: colorPicker(COLORS[store.lists().length % COLORS.length]) });
  if (!r?.value) return;
  const l = store.saveList({ name: r.value, color: r.form.color.value, order: Date.now() });
  setView(null, { list: l.id });
}
async function editList(id) {
  const l = listById(id); if (!l) return;
  const m = openModal(`<form class="confirm"><h3>Editar lista</h3><input class="input" name="v" value="${esc(l.name)}" maxlength="40" required>${colorPicker(l.color)}
    <div class="row"><button type="button" class="btn ghost danger-text" data-a="del">${icon('trash')} Excluir</button><span class="grow"></span><button type="button" class="btn ghost" data-a="no">Cancelar</button><button class="btn primary">Salvar</button></div></form>`, { cls: 'small' });
  const f = m.querySelector('form');
  f.onsubmit = e => { e.preventDefault(); store.saveList({ ...l, name: f.v.value.trim() || l.name, color: f.color.value }); closeModal(); };
  m.querySelector('[data-a=no]').onclick = () => closeModal();
  m.querySelector('[data-a=del]').onclick = async () => {
    closeModal();
    const n = store.tasks().filter(t => t.list === id).length;
    if (!(await confirmBox(`Excluir a lista “${l.name}”? ${n ? `As ${n} tarefa(s) dela vão para a Caixa de entrada.` : ''}`, { ok: 'Excluir', danger: true }))) return;
    for (const t of store.tasks().filter(t => t.list === id)) store.put('task', { ...t, list: null }, { silent: true });
    store.remove(id); if (ui.list === id) setView('inbox'); else render();
  };
}

// ---------- navegação ----------
function setView(view, { list = null, tag = null } = {}) {
  ui.view = view || ui.view; ui.list = list; ui.tag = tag; ui.drawer = false;
  if (ui.view !== 'search') { $('#search').value = ''; }
  if (view === 'calendar') { ui.calDay = dateKey(new Date()); ui.calMonth = firstOfMonth(new Date()); }
  render(); $('#view').scrollTop = 0; scrollTo(0, 0);
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-view],[data-list],[data-tag],[data-edit-list],[data-act],[data-cal],[data-open],[data-day],[data-f],[data-s],[data-saved],[data-kpi],[data-kpi-list],[data-period],[data-open-saved],[data-del-saved]');
  if (!el) { if (ui.drawer && !e.target.closest('#sidebar')) { ui.drawer = false; render(); } return; }
  if (el.closest('.modal')) return; // modais cuidam dos próprios cliques
  if (el.dataset.view) return setView(el.dataset.view);
  if (el.dataset.openSaved) return openSaved(el.dataset.openSaved);
  if (el.dataset.delSaved) return deleteSaved(el.dataset.delSaved);
  if (el.dataset.f || el.dataset.s || el.dataset.saved) { if (handleSearchClick(el, helpers)) { renderMain(); renderSidebar(); } return; }
  if (el.dataset.period) { searchState.period = el.dataset.period; return renderMain(); }
  if (el.dataset.kpi !== undefined || el.dataset.kpiList) {
    if (!el.dataset.kpi && !el.dataset.kpiList) return;
    searchState.criteria = kpiToCriteria(el.dataset.kpi, el.dataset.kpiList); searchState.query = ''; searchState.savedId = null;
    return setView('search');
  }
  if (el.dataset.editList) return editList(el.dataset.editList);
  if (el.dataset.list) return setView(ui.view === 'calendar' ? 'all' : ui.view, { list: el.dataset.list });
  if (el.dataset.tag) return setView(ui.view === 'calendar' ? 'all' : ui.view, { tag: el.dataset.tag });
  if (el.dataset.open) { const t = store.task(el.dataset.open); if (t) openEditor(ctx, t); return; }
  if (el.dataset.cal) {
    const c = el.dataset.cal, sel = new Date(ui.calDay + 'T12:00');
    if (c === 'month' || c === 'week') ui.calMode = c;
    else if (c === 'today') { ui.calDay = dateKey(new Date()); ui.calMonth = firstOfMonth(new Date()); }
    else if (ui.calMode === 'week') { sel.setDate(sel.getDate() + (c === 'next' ? 7 : -7)); ui.calDay = dateKey(sel); ui.calMonth = firstOfMonth(sel); }
    else { ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() + (c === 'next' ? 1 : -1), 1); }
    return render();
  }
  const act = el.dataset.act;
  if (!act && el.dataset.day) { ui.calDay = el.dataset.day; return render(); }
  const row = el.closest('.task'); const id = row?.dataset.id;
  if (act === 'toggle' && id) { row.classList.add('completing'); setTimeout(() => toggleTask(id), 180); return; }
  if (act === 'open' && id) { const t = store.task(id); if (t) openEditor(ctx, t); return; }
  if (act === 'new') return openEditor(ctx, null, defaultDraft());
  if (act === 'new-on') return openEditor(ctx, null, defaultDraft(el.dataset.day));
  if (act === 'new-list') return newList();
  if (act === 'settings') { ui.drawer = false; render(); return openSettings(ctx); }
  if (act === 'drawer') { ui.drawer = !ui.drawer; return render(); }
  if (act === 'hide-tip') { store.ls.setItem('agenda.hideSyncTip', '1'); return render(); }
  if (act === 'quick') return quickAdd();
  if (act === 'quick-details') return quickAdd(true);
});
$('#quick-input').addEventListener('input', quickPreview);
$('#quick-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); quickAdd(e.shiftKey); } });
let searchTimer;
$('#search').addEventListener('input', e => {
  const box = $('.search'); box.classList.add('busy');
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchState.query = e.target.value; searchState.savedId = null; searchState.limit = 150;
    if (ui.view !== 'search' || ui.list || ui.tag) { ui.view = 'search'; ui.list = null; ui.tag = null; renderSidebar(); renderBottomNav(); }
    renderMain(); box.classList.remove('busy');
  }, 120);
});
$('#search').addEventListener('focus', () => { if (window.innerWidth > 860 && ui.view !== 'search') setView('search'); });
document.addEventListener('keydown', e => {
  if (modalOpen()) { if (e.key === 'Escape') closeModal(); return; }
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'n') { e.preventDefault(); $('#quick-input').focus(); }
  if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
});

// ---------- sincronização, notificações e ciclo de vida ----------
function applySettings() {
  const s = store.settings();
  setHolidayOptions({ carnaval: s.holidays?.carnaval !== false, corpusChristi: s.holidays?.corpusChristi !== false, extra: s.holidays?.extra || [] });
}
let reschedTimer;
function reschedule() {
  clearTimeout(reschedTimer);
  // No celular com avisos pelo servidor, alarmes locais só para o que ainda não subiu para a nuvem.
  reschedTimer = setTimeout(() => rescheduleNotifs(store.tasks(), store.settings(), { localOnly: t => !!store.items[t.id]?.dirty }).catch(console.error), 400);
}
store.on(reason => {
  if (reason === 'status') {
    renderSidebar();
    if (store.status.state === 'synced' || store.status.state === 'offline' || store.status.state === 'error') { const first = !ui.firstSync; ui.firstSync = true; if (first && ui.view === 'dashboard') renderMain(); }
    if (store.status.state === 'synced') reschedule();
    return;
  }
  if (reason === 'storage-error') { toast('Memória do aparelho cheia: não foi possível salvar localmente.'); return; }
  applySettings();
  syncIndex(store, { onProgress: () => { if (ui.view === 'search') renderMain(); } });
  if (!modalOpen() || reason !== 'remote') render(); else renderSidebar();
  reschedule();
});
const syncSoon = () => { if (store.online) store.sync().catch(() => {}); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { syncSoon(); render(); } });
addEventListener('online', syncSoon);
setInterval(() => { if (document.visibilityState === 'visible') syncSoon(); }, 60_000);
setInterval(() => { if (!modalOpen() && document.visibilityState === 'visible') render(); }, 5 * 60_000); // atualiza "atrasadas"/"hoje"

async function start() {
  applySettings();
  if (!store.online) store.ensureDefaults();
  if (globalThis.AGENDA_CONFIG?.preview && !store.tasks().length) {
    // Exemplos para a prévia.
    const fin = store.lists().find(l => l.name === 'Financeiro')?.id, trab = store.lists().find(l => l.name === 'Trabalho')?.id;
    for (const [txt, list, subs] of [['Pagar DAS todo dia 20 antecipando 9h #impostos !alta', fin], ['Fechar folha no 5º dia útil 10h', trab, ['Conferir ponto', 'Calcular encargos', 'Enviar holerites']],
      ['Reunião de condomínio todo primeiro domingo do mês 10h'], ['Revisar orçamento quinzenalmente'], ['Ligar para cliente amanhã 15h', trab]]) {
      const p = parseTask(txt); const s = store.settings();
      store.saveTask({ title: p.title, dueAt: p.dueAt, allDay: p.allDay, recurrence: p.recurrence, recurrenceAnchor: p.dueAt, priority: p.priority, tags: p.tags, list: list || null,
        reminders: p.dueAt ? (p.allDay ? [0] : [...(s.defaultReminders || [0])]) : [], subtasks: (subs || []).map(t => ({ title: t })) });
    }
  }
  await initNotifications({
    open: id => { const t = store.task(id); if (t) openEditor(ctx, t); },
    alert: (id, subId) => openAlertSheet(id, subId),
    complete: (id, subId) => { toggleTask(id, { subId }); },
    snoozed: min => toast(`Lembrete adiado ${min} min.`)
  });
  syncIndex(store, { onProgress: () => { if (ui.view === 'search') renderMain(); } });
  render(); quickPreview();
  if (store.online) { try { await store.sync({ initial: true }); } catch (e) { if (!e.offline) toast(e.message); } }
  reschedule();
  if (!isNative() && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (store.online) {
    // O servidor precisa do fuso deste aparelho para escrever a hora certa nos avisos.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && store.settings().timeZone !== tz) store.saveSettings({ timeZone: tz });
    refreshPush(store);
    if (isNative()) initNativePush(store, () => { reschedule(); renderSidebar(); });
  }
  // Veio de uma notificação ("Concluir" ou toque).
  const qs = new URLSearchParams(location.search), p = qs.get('task');
  if (p || qs.get('acao')) history.replaceState(null, '', location.pathname);
  if (p && store.task(p)) {
    const t = store.task(p);
    if (qs.get('acao') === 'concluir') { if (qs.get('sub')) toggleTask(p, { subId: qs.get('sub') }); else if (!t.done) toggleTask(p); }
    else openEditor(ctx, t);
  }
}
start();
