// Editor de tarefa: datas, lembretes múltiplos, recorrência completa, subtarefas e anexos.
import { $, $$, esc, icon, openModal, closeModal, confirmBox, toast, toInputDate, toInputTime, fmtSize, hm } from './ui.js';
import { describe, occurrences, preset, WEEKDAYS, normalizeRecurrence, holidayName, dateKey, firstOnOrAfter } from './recurrence.js';
import { PRIORITIES, REMINDER_OPTIONS, ALLDAY_REMINDER_OPTIONS, uuid, cleanTask, snapToRule, skipOccurrence } from './tasks.js';

const WD_LETTER = { MO: 'S', TU: 'T', WE: 'Q', TH: 'Q', FR: 'S', SA: 'S', SU: 'D' };
const WD_FULL = { MO: 'Segunda', TU: 'Terça', WE: 'Quarta', TH: 'Quinta', FR: 'Sexta', SA: 'Sábado', SU: 'Domingo' };
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MONTHS_FULL = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ORDINALS = [[1, '1º'], [2, '2º'], [3, '3º'], [4, '4º'], [5, '5º'], [-1, 'Último'], [-2, 'Penúltimo']];
const KINDS = [['SU', 'domingo'], ['MO', 'segunda-feira'], ['TU', 'terça-feira'], ['WE', 'quarta-feira'], ['TH', 'quinta-feira'], ['FR', 'sexta-feira'], ['SA', 'sábado'], ['day', 'dia do mês'], ['businessday', 'dia útil (sem feriados)'], ['weekday', 'dia de semana (seg. a sex.)'], ['weekend', 'dia de fim de semana']];

export function openEditor(ctx, task = null, draft = {}) {
  const { store } = ctx;
  const isNew = !task;
  const settings = store.settings();
  const base = task ? structuredClone(task) : cleanTask({ id: uuid(), list: draft.list ?? ctx.currentList() ?? null, ...draft, title: draft.title || '' });
  if (isNew && base.dueAt && !draft.reminders) base.reminders = base.allDay ? [...(settings.defaultAllDayReminders || [0])] : [...(settings.defaultReminders || [0])];
  const st = { t: base, uploads: [], removed: [], dirty: false, userDate: base.dueAt };

  const m = openModal(`
    <form class="editor" autocomplete="off">
      <div class="ed-head">
        <button type="button" class="check big prio-${st.t.priority}" data-a="toggle-done" title="Concluir">${st.t.done ? icon('check') : ''}</button>
        <textarea name="title" class="ed-title" rows="1" maxlength="200" placeholder="O que você precisa fazer?">${esc(st.t.title)}</textarea>
        <button type="button" class="icon-btn" data-a="close" aria-label="Fechar">${icon('x')}</button>
      </div>
      <div class="ed-body">
        <section class="ed-grid">
          <label class="field"><span>${icon('calendar')} Data</span>
            <div class="row gap"><input type="date" name="date" class="input"><input type="time" name="time" class="input" title="Deixe vazio para o dia inteiro"></div>
            <div class="chips" data-quick-dates>
              <button type="button" class="chip" data-d="0">Hoje</button><button type="button" class="chip" data-d="1">Amanhã</button>
              <button type="button" class="chip" data-d="mon">Próx. segunda</button><button type="button" class="chip" data-d="none">Sem data</button>
            </div>
          </label>
          <div class="field"><span>${icon('bell')} Lembretes</span><div class="chips" id="ed-reminders"></div></div>
          <div class="field wide"><span>${icon('repeat')} Repetir</span><button type="button" class="rec-btn" data-a="rec">—</button><div id="ed-rec" class="rec-panel" hidden></div></div>
          <div class="field"><span>${icon('flag')} Prioridade</span><div class="seg" id="ed-prio">${PRIORITIES.map(p => `<button type="button" data-p="${p.v}" style="--pc:${p.color}" title="${p.label}">${icon('flag')}<em>${p.label}</em></button>`).join('')}</div></div>
          <label class="field"><span>${icon('list')} Lista</span><select name="list" class="input"><option value="">Caixa de entrada</option>${store.lists().map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select></label>
          <label class="field"><span>${icon('tag')} Etiquetas</span><input name="tags" class="input" placeholder="ex.: impostos, cliente-x" value="${esc(st.t.tags.join(', '))}"></label>
          <label class="field"><span>${icon('clock')} Duração</span><select name="duration" class="input">${[0, 15, 30, 45, 60, 90, 120, 180, 240, 480].map(v => `<option value="${v}">${v === 0 ? 'Sem duração' : v < 60 ? v + ' min' : (v / 60) + ' h'}</option>`).join('')}</select></label>
        </section>
        <label class="field wide"><span>${icon('edit')} Descrição</span><textarea name="notes" class="input notes" rows="3" placeholder="Detalhes, links, observações...">${esc(st.t.notes)}</textarea></label>
        <section class="field wide"><span>${icon('sub')} Subtarefas <b id="ed-sub-count"></b></span><div class="progress"><i id="ed-sub-bar"></i></div><div id="ed-subs"></div>
          <div class="sub-add"><input class="input" id="ed-sub-new" placeholder="Adicionar subtarefa e Enter" maxlength="200"><button type="button" class="btn ghost" data-a="add-sub">${icon('plus')}</button></div></section>
        <section class="field wide"><span>${icon('clip')} Anexos</span><div id="ed-atts"></div>
          <div class="row gap wrap"><button type="button" class="btn ghost" data-a="attach">${icon('upload')} Anexar arquivo</button><small class="muted" id="ed-att-hint"></small></div>
          <input type="file" id="ed-file" multiple hidden></section>
        <section id="ed-history"></section>
      </div>
      <div class="ed-foot">
        ${isNew ? '' : `<button type="button" class="btn ghost danger-text" data-a="delete">${icon('trash')} Excluir</button>`}
        ${!isNew && st.t.recurrence ? `<button type="button" class="btn ghost" data-a="skip" title="Avança para a próxima ocorrência sem marcar como feita">${icon('skip')} Pular esta</button>` : ''}
        <span class="grow"></span>
        <button type="button" class="btn ghost" data-a="close">Cancelar</button>
        <button class="btn primary">${isNew ? 'Criar tarefa' : 'Salvar'}</button>
      </div>
    </form>`, { cls: 'editor-modal', onClose: () => cleanupUploads() });
  const f = m.querySelector('form');
  const due = () => st.t.dueAt ? new Date(st.t.dueAt) : null;

  // ---------- preencher ----------
  f.list.value = st.t.list || '';
  f.duration.value = String([0, 15, 30, 45, 60, 90, 120, 180, 240, 480].includes(st.t.durationMin) ? st.t.durationMin : 0);
  const autoGrow = el => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
  f.title.addEventListener('input', () => autoGrow(f.title)); setTimeout(() => { autoGrow(f.title); if (isNew) f.title.focus(); }, 50);
  f.notes.addEventListener('input', () => autoGrow(f.notes)); setTimeout(() => autoGrow(f.notes), 50);
  f.title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); f.requestSubmit(); } });

  function syncDateInputs() { const d = due(); f.date.value = toInputDate(d); f.time.value = d && !st.t.allDay ? toInputTime(d) : ''; f.time.disabled = !d; }
  function readDate() {
    if (!f.date.value) { st.t.dueAt = null; st.t.allDay = true; st.t.recurrence = null; return; }
    const [y, mo, d] = f.date.value.split('-').map(Number);
    let h = 0, mi = 0; const hadDate = !!st.t.dueAt, wasAllDay = st.t.allDay;
    if (f.time.value) { [h, mi] = f.time.value.split(':').map(Number); st.t.allDay = false; } else st.t.allDay = true;
    st.t.dueAt = new Date(y, mo - 1, d, h, mi).toISOString();
    if (!hadDate && !st.t.reminders.length) st.t.reminders = st.t.allDay ? [...(settings.defaultAllDayReminders || [0])] : [...(settings.defaultReminders || [0])];
    if (hadDate && wasAllDay !== st.t.allDay) st.t.reminders = st.t.allDay ? [0] : [...(settings.defaultReminders || [0])];
    if (st.t.recurrence) st.t.recurrenceAnchor = st.t.dueAt;
    st.userDate = st.t.dueAt;
  }
  f.date.addEventListener('change', () => { readDate(); syncDateInputs(); renderReminders(); renderRecBtn(); });
  f.time.addEventListener('change', () => { readDate(); renderReminders(); renderRecBtn(); });
  m.querySelector('[data-quick-dates]').addEventListener('click', e => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const keepTime = due() && !st.t.allDay ? due() : null;
    if (b.dataset.d === 'none') { f.date.value = ''; f.time.value = ''; }
    else {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      if (b.dataset.d === 'mon') d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); else d.setDate(d.getDate() + Number(b.dataset.d));
      f.date.value = dateKey(d); if (keepTime) f.time.value = toInputTime(keepTime);
    }
    readDate(); syncDateInputs(); renderReminders(); renderRecBtn();
  });

  // ---------- lembretes ----------
  function renderReminders() {
    const box = $('#ed-reminders', m);
    if (!st.t.dueAt) { box.innerHTML = '<small class="muted">Defina uma data para receber lembretes.</small>'; return; }
    const opts = st.t.allDay ? ALLDAY_REMINDER_OPTIONS : REMINDER_OPTIONS;
    const label = v => (opts.find(o => o.v === v)?.label) || (v % 1440 === 0 ? `${v / 1440} dia(s) antes` : v % 60 === 0 ? `${v / 60} h antes` : `${v} min antes`);
    const at = st.t.allDay ? ` (${settings.allDayTime || '09:00'})` : '';
    box.innerHTML = st.t.reminders.map(v => `<span class="chip on">${icon('bell')} ${esc(label(v))}${v === 0 ? at : ''}<button type="button" data-rm="${v}" aria-label="Remover">×</button></span>`).join('') +
      `<select class="chip-select" data-add-rem><option value="">+ lembrete</option>${opts.filter(o => !st.t.reminders.includes(o.v)).map(o => `<option value="${o.v}">${o.label}</option>`).join('')}<option value="custom">Personalizado…</option></select>`;
  }
  $('#ed-reminders', m).addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; st.t.reminders = st.t.reminders.filter(v => v !== Number(b.dataset.rm)); renderReminders(); });
  $('#ed-reminders', m).addEventListener('change', e => {
    if (!e.target.matches('[data-add-rem]')) return;
    let v = e.target.value; if (!v) return;
    if (v === 'custom') {
      const txt = prompt('Quantos minutos antes? (ex.: 45, ou 1d para 1 dia, 3h para 3 horas)'); if (!txt) { renderReminders(); return; }
      const mm = txt.trim().toLowerCase().match(/^(\d+)\s*(d|h|m|min)?$/); if (!mm) { toast('Formato inválido.'); renderReminders(); return; }
      v = Number(mm[1]) * (mm[2] === 'd' ? 1440 : mm[2] === 'h' ? 60 : 1);
    }
    st.t.reminders = [...new Set([...st.t.reminders, Number(v)])].sort((a, b) => a - b); renderReminders();
  });

  // ---------- prioridade ----------
  function renderPrio() { $$('#ed-prio button', m).forEach(b => b.classList.toggle('on', Number(b.dataset.p) === st.t.priority)); const c = $('.ed-head .check', m); c.className = `check big prio-${st.t.priority}${st.t.done ? ' checked' : ''}`; }
  $('#ed-prio', m).addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; st.t.priority = Number(b.dataset.p); renderPrio(); });

  // ---------- recorrência ----------
  function renderRecBtn() {
    const b = $('[data-a=rec]', m);
    b.innerHTML = `${esc(st.t.recurrence ? describe(st.t.recurrence, st.t.recurrenceAnchor || st.t.dueAt) : 'Não se repete')} ${icon('down')}`;
    b.classList.toggle('on', !!st.t.recurrence);
    if (!$('#ed-rec', m).hidden) renderRecPanel();
  }
  function recDraft() { return st.t.recurrence ? structuredClone(st.t.recurrence) : null; }
  function renderRecPanel() {
    const panel = $('#ed-rec', m);
    const d = due() || new Date();
    const r = recDraft();
    const presetsList = [['none', 'Não se repete'], ['daily', 'Todos os dias'], ['weekdays', 'Dias úteis (seg. a sex.)'], ['weekly', `Toda semana (${WD_FULL[WEEKDAYS[d.getDay()]].toLowerCase()})`], ['biweekly', 'A cada 2 semanas'],
      ['monthly', `Todo mês no dia ${d.getDate()}`], ['monthlyNth', `Todo mês ${describe(preset('monthlyNth', d), d).replace('Todo mês, ', '')}`], ['monthlyLast', 'Todo mês no último dia'], ['monthlyLastBusiness', 'Todo mês no último dia útil'],
      ['yearly', `Todo ano em ${d.getDate()} de ${MONTHS_FULL[d.getMonth()]}`]];
    const rr = r || { freq: 'weekly', interval: 1, byDay: [WEEKDAYS[d.getDay()]], monthMode: 'same', end: { type: 'never' }, base: 'due', adjust: 'none' };
    const freqUnit = { hourly: 'hora(s)', daily: 'dia(s)', weekly: 'semana(s)', monthly: 'mês(es)', yearly: 'ano(s)' };
    const monthOpts = rr.freq === 'monthly' || rr.freq === 'yearly';
    const nth = rr.nth || { pos: Math.min(4, Math.ceil(d.getDate() / 7)), kind: WEEKDAYS[d.getDay()] };
    panel.innerHTML = `
      <div class="rec-presets">${presetsList.map(([k, l]) => `<button type="button" class="chip" data-preset="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="rec-custom ${r ? '' : 'disabled'}">
        <div class="row gap wrap"><span>A cada</span><input type="number" min="1" max="999" class="input tiny" data-r="interval" value="${rr.interval || 1}">
          <select class="input" data-r="freq">${Object.entries(freqUnit).map(([k, v]) => `<option value="${k}" ${rr.freq === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        ${rr.freq === 'weekly' || rr.freq === 'hourly' ? `<div class="wd-picker">${['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map(c => `<button type="button" class="${(rr.byDay || []).includes(c) ? 'on' : ''}" data-wd="${c}" title="${WD_FULL[c]}">${WD_LETTER[c]}</button>`).join('')}</div>${rr.freq === 'hourly' ? '<small class="muted">Opcional: só nestes dias da semana.</small>' : ''}` : ''}
        ${rr.freq === 'yearly' ? `<div class="mo-picker">${MONTHS.map((n, i) => `<button type="button" class="${(rr.byMonth?.length ? rr.byMonth : [d.getMonth() + 1]).includes(i + 1) ? 'on' : ''}" data-mo="${i + 1}">${n}</button>`).join('')}</div>` : ''}
        ${monthOpts ? `
          <label class="radio"><input type="radio" name="mm" value="same" ${rr.monthMode === 'same' ? 'checked' : ''}> No mesmo dia (${d.getDate()})</label>
          <label class="radio"><input type="radio" name="mm" value="days" ${rr.monthMode === 'days' ? 'checked' : ''}> Nos dias escolhidos:</label>
          <div class="md-picker ${rr.monthMode === 'days' ? '' : 'dim'}">${Array.from({ length: 31 }, (_, i) => `<button type="button" class="${(rr.byMonthDay || []).includes(i + 1) ? 'on' : ''}" data-md="${i + 1}">${i + 1}</button>`).join('')}<button type="button" class="wide ${(rr.byMonthDay || []).includes(-1) ? 'on' : ''}" data-md="-1">Último</button></div>
          <label class="radio"><input type="radio" name="mm" value="nth" ${rr.monthMode === 'nth' ? 'checked' : ''}> No(a)
            <select class="input" data-r="nthpos">${ORDINALS.map(([v, l]) => `<option value="${v}" ${nth.pos === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <select class="input" data-r="nthkind">${KINDS.map(([v, l]) => `<option value="${v}" ${nth.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        <div class="row gap wrap"><span>Se cair em fim de semana ou feriado:</span>
          <select class="input" data-r="adjust"><option value="none">manter a data</option><option value="prev" ${rr.adjust === 'prev' ? 'selected' : ''}>antecipar (dia útil anterior)</option><option value="next" ${rr.adjust === 'next' ? 'selected' : ''}>adiar (próximo dia útil)</option></select></div>
        <div class="row gap wrap"><span>Contar a partir da:</span>
          <select class="input" data-r="base"><option value="due">data prevista</option><option value="completion" ${rr.base === 'completion' ? 'selected' : ''}>data em que concluí</option></select></div>
        <div class="row gap wrap"><span>Termina:</span>
          <select class="input" data-r="endtype"><option value="never">nunca</option><option value="until" ${rr.end?.type === 'until' ? 'selected' : ''}>em uma data</option><option value="count" ${rr.end?.type === 'count' ? 'selected' : ''}>após N vezes</option></select>
          ${rr.end?.type === 'until' ? `<input type="date" class="input" data-r="until" value="${rr.end.until || ''}">` : ''}
          ${rr.end?.type === 'count' ? `<input type="number" min="1" class="input tiny" data-r="count" value="${rr.end.count || 10}"> vezes` : ''}</div>
      </div>
      <div class="rec-preview" id="rec-preview"></div>`;
    renderPreview();
  }
  function renderPreview() {
    const box = $('#rec-preview', m); if (!box) return;
    if (!st.t.recurrence) { box.innerHTML = ''; return; }
    if (st.t.recurrence.base === 'completion') { box.innerHTML = `<b>${esc(describe(st.t.recurrence, st.t.dueAt))}</b><small>A próxima data é calculada quando você concluir.</small>`; return; }
    const occ = occurrences(st.t.recurrence, st.t.recurrenceAnchor || st.t.dueAt, { from: new Date(st.t.dueAt), limit: 6 });
    box.innerHTML = `<b>${esc(describe(st.t.recurrence, st.t.recurrenceAnchor || st.t.dueAt))}</b><small>Próximas: ${occ.map(o => {
      const h = holidayName(new Date(o.key + 'T12:00'));
      const moved = o.key !== dateKey(o.at);
      return `<span class="occ">${o.at.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: o.at.getFullYear() !== new Date().getFullYear() ? '2-digit' : undefined })}${st.t.allDay ? '' : ' ' + hm(o.at)}${moved ? ` <i title="${esc(h || 'fim de semana')}">↺</i>` : ''}</span>`;
    }).join('') || '—'}</small>`;
  }
  function setRecurrence(r) {
    if (!st.t.dueAt) { const d = new Date(); d.setHours(0, 0, 0, 0); st.t.dueAt = d.toISOString(); st.t.allDay = true; st.userDate = st.t.dueAt; if (!st.t.reminders.length) st.t.reminders = [0]; }
    if (!st.userDate) st.userDate = st.t.dueAt;
    st.t.recurrence = normalizeRecurrence(r);
    if (st.t.recurrence) {
      // Sempre encaixa a partir da data escolhida pelo usuário (não da última data encaixada).
      const u = new Date(st.userDate), cur = new Date(st.t.dueAt);
      if (!st.t.allDay) u.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
      st.t.dueAt = u.toISOString();
      st.t.recurrenceAnchor = st.t.dueAt;
      const snapped = snapToRule(st.t);
      st.t.dueAt = snapped.dueAt; st.t.recurrenceAnchor = snapped.recurrenceAnchor;
    } else st.t.recurrenceAnchor = null;
    syncDateInputs(); renderReminders(); renderRecBtn();
  }
  m.addEventListener('click', e => {
    const p = e.target.closest('[data-preset]');
    if (p) { setRecurrence(p.dataset.preset === 'none' ? null : preset(p.dataset.preset, due() || new Date())); return; }
    const wd = e.target.closest('[data-wd]');
    if (wd && st.t.recurrence) { const set = new Set(st.t.recurrence.byDay); set.has(wd.dataset.wd) ? set.delete(wd.dataset.wd) : set.add(wd.dataset.wd); if (!set.size && st.t.recurrence.freq === 'weekly') return toast('Escolha ao menos um dia.'); setRecurrence({ ...st.t.recurrence, byDay: [...set] }); return; }
    const mo = e.target.closest('[data-mo]');
    if (mo && st.t.recurrence) { const cur = st.t.recurrence.byMonth.length ? st.t.recurrence.byMonth : [new Date(st.t.dueAt).getMonth() + 1]; const set = new Set(cur); const v = Number(mo.dataset.mo); set.has(v) ? set.delete(v) : set.add(v); if (!set.size) return; setRecurrence({ ...st.t.recurrence, byMonth: [...set] }); return; }
    const md = e.target.closest('[data-md]');
    if (md && st.t.recurrence) { const set = new Set(st.t.recurrence.byMonthDay); const v = Number(md.dataset.md); set.has(v) ? set.delete(v) : set.add(v); setRecurrence({ ...st.t.recurrence, monthMode: set.size ? 'days' : 'same', byMonthDay: [...set] }); return; }
  });
  m.addEventListener('change', e => {
    const el = e.target; if (!st.t.recurrence) { if (el.closest('.rec-custom')) setRecurrence({ freq: 'weekly' }); return; }
    const r = structuredClone(st.t.recurrence);
    if (el.name === 'mm') { r.monthMode = el.value; if (el.value === 'nth' && !r.nth) r.nth = { pos: Number($('[data-r=nthpos]', m).value), kind: $('[data-r=nthkind]', m).value }; if (el.value === 'days' && !r.byMonthDay.length) r.byMonthDay = [new Date(st.t.dueAt).getDate()]; }
    const k = el.dataset.r; if (!k && el.name !== 'mm') return;
    if (k === 'interval') r.interval = Number(el.value) || 1;
    if (k === 'freq') { r.freq = el.value; if (el.value === 'weekly' && !r.byDay.length) r.byDay = [WEEKDAYS[new Date(st.t.dueAt).getDay()]]; if (el.value === 'daily' || el.value === 'monthly' || el.value === 'yearly') r.byDay = []; if (el.value === 'hourly' && st.t.allDay) { const d = new Date(st.t.dueAt); d.setHours(new Date().getHours() + 1, 0, 0, 0); st.t.dueAt = d.toISOString(); st.t.allDay = false; } }
    if (k === 'nthpos' || k === 'nthkind') { r.monthMode = 'nth'; r.nth = { pos: Number($('[data-r=nthpos]', m).value), kind: $('[data-r=nthkind]', m).value }; }
    if (k === 'adjust') r.adjust = el.value;
    if (k === 'base') r.base = el.value;
    if (k === 'endtype') r.end = el.value === 'until' ? { type: 'until', until: dateKey(new Date(Date.now() + 90 * 86400_000)) } : el.value === 'count' ? { type: 'count', count: 10 } : { type: 'never' };
    if (k === 'until') r.end = { type: 'until', until: el.value };
    if (k === 'count') r.end = { type: 'count', count: Number(el.value) || 1 };
    setRecurrence(r);
  });
  $('[data-a=rec]', m).addEventListener('click', () => { const p = $('#ed-rec', m); p.hidden = !p.hidden; if (!p.hidden) renderRecPanel(); });

  // ---------- subtarefas ----------
  function renderSubs() {
    const s = st.t.subtasks;
    const done = s.filter(x => x.done).length;
    $('#ed-sub-count', m).textContent = s.length ? `${done}/${s.length}` : '';
    $('#ed-sub-bar', m).style.width = s.length ? `${(done / s.length) * 100}%` : '0';
    $('#ed-sub-bar', m).parentElement.hidden = !s.length;
    $('#ed-subs', m).innerHTML = s.map((x, i) => `
      <div class="sub ${x.done ? 'done' : ''}" data-i="${i}" draggable="true">
        <button type="button" class="check sm ${x.done ? 'checked' : ''}" data-sa="toggle">${x.done ? icon('check') : ''}</button>
        <input class="sub-title" value="${esc(x.title)}" data-sa="title" maxlength="200">
        <input type="datetime-local" class="input sub-date ${x.dueAt ? '' : 'empty'}" data-sa="date" value="${x.dueAt ? `${toInputDate(new Date(x.dueAt))}T${toInputTime(new Date(x.dueAt))}` : ''}" title="Data e lembrete da subtarefa">
        <button type="button" class="icon-btn sm" data-sa="up" title="Mover para cima">↑</button>
        <button type="button" class="icon-btn sm" data-sa="del" title="Remover">${icon('x')}</button>
      </div>`).join('');
  }
  function addSub() { const inp = $('#ed-sub-new', m); const v = inp.value.trim(); if (!v) return; st.t.subtasks.push({ id: uuid(), title: v, done: false, dueAt: null }); inp.value = ''; renderSubs(); inp.focus(); }
  $('#ed-sub-new', m).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
  $('#ed-sub-new', m).addEventListener('paste', e => {
    const txt = e.clipboardData?.getData('text') || ''; const lines = txt.split(/\r?\n/).map(s => s.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
    if (lines.length > 1) { e.preventDefault(); lines.forEach(l => st.t.subtasks.push({ id: uuid(), title: l, done: false, dueAt: null })); renderSubs(); }
  });
  $('#ed-subs', m).addEventListener('click', e => {
    const b = e.target.closest('[data-sa]'); if (!b) return; const i = Number(b.closest('.sub').dataset.i);
    if (b.dataset.sa === 'toggle') st.t.subtasks[i].done = !st.t.subtasks[i].done;
    else if (b.dataset.sa === 'del') st.t.subtasks.splice(i, 1);
    else if (b.dataset.sa === 'up' && i > 0) [st.t.subtasks[i - 1], st.t.subtasks[i]] = [st.t.subtasks[i], st.t.subtasks[i - 1]];
    else return;
    renderSubs();
  });
  $('#ed-subs', m).addEventListener('change', e => {
    const el = e.target; const row = el.closest('.sub'); if (!row) return; const i = Number(row.dataset.i);
    if (el.dataset.sa === 'title') st.t.subtasks[i].title = el.value.trim() || st.t.subtasks[i].title;
    if (el.dataset.sa === 'date') { st.t.subtasks[i].dueAt = el.value ? new Date(el.value).toISOString() : null; el.classList.toggle('empty', !el.value); }
  });
  let dragFrom = null;
  $('#ed-subs', m).addEventListener('dragstart', e => { dragFrom = Number(e.target.closest('.sub')?.dataset.i); });
  $('#ed-subs', m).addEventListener('dragover', e => e.preventDefault());
  $('#ed-subs', m).addEventListener('drop', e => { e.preventDefault(); const to = Number(e.target.closest('.sub')?.dataset.i); if (Number.isInteger(dragFrom) && Number.isInteger(to) && dragFrom !== to) { const [x] = st.t.subtasks.splice(dragFrom, 1); st.t.subtasks.splice(to, 0, x); renderSubs(); } });
  $('[data-a=add-sub]', m).addEventListener('click', addSub);

  // ---------- anexos ----------
  const supa = () => store.supa;
  function renderAtts() {
    const can = store.online;
    $('#ed-att-hint', m).textContent = can ? 'Até 25 MB por arquivo. Ficam guardados na sua nuvem do Supabase.' : 'Conecte a sincronização (Configurações) para anexar arquivos.';
    $('[data-a=attach]', m).disabled = !can;
    $('#ed-atts', m).innerHTML = st.t.attachments.map((a, i) => `
      <div class="att" data-i="${i}">
        <span class="att-ico">${a.uploading ? `<i class="spin"></i>` : a.type?.startsWith('image/') ? `<img data-thumb="${esc(a.path)}" alt="">` : icon('file')}</span>
        <div class="att-info"><b>${esc(a.name)}</b><small>${a.uploading ? `Enviando… ${Math.round((a.progress || 0) * 100)}%` : fmtSize(a.size || 0)}</small></div>
        ${a.uploading ? '' : `<button type="button" class="icon-btn sm" data-att="open" title="Abrir">${icon('open')}</button><button type="button" class="icon-btn sm" data-att="download" title="Baixar">${icon('download')}</button><button type="button" class="icon-btn sm" data-att="del" title="Remover">${icon('trash')}</button>`}
      </div>`).join('');
    if (can) $$('img[data-thumb]', m).forEach(async img => { try { img.src = await supa().signedUrl(img.dataset.thumb, { expiresIn: 600 }); } catch { img.remove(); } });
  }
  $('[data-a=attach]', m).addEventListener('click', () => $('#ed-file', m).click());
  $('#ed-file', m).addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    for (const file of files) {
      if (file.size > 25 * 1048576) { toast(`“${file.name}” passa de 25 MB.`); continue; }
      const id = uuid();
      const att = { id, name: file.name, size: file.size, type: file.type || 'application/octet-stream', path: supa().objectPath(st.t.id, id, file.name), createdAt: new Date().toISOString(), uploading: true, progress: 0 };
      st.t.attachments.push(att); renderAtts();
      try {
        await supa().upload(att.path, file, p => { att.progress = p; const row = $(`.att[data-i="${st.t.attachments.indexOf(att)}"] small`, m); if (row) row.textContent = `Enviando… ${Math.round(p * 100)}%`; });
        delete att.uploading; delete att.progress; st.uploads.push(att.path);
      } catch (err) {
        st.t.attachments = st.t.attachments.filter(x => x !== att); toast(`Falha ao enviar “${file.name}”: ${err.message}`);
      }
      renderAtts();
    }
  });
  $('#ed-atts', m).addEventListener('click', async e => {
    const b = e.target.closest('[data-att]'); if (!b) return; const i = Number(b.closest('.att').dataset.i); const a = st.t.attachments[i];
    if (b.dataset.att === 'del') {
      if (!(await confirmBox(`Remover o anexo “${a.name}”?`, { ok: 'Remover', danger: true }))) return;
      st.t.attachments.splice(i, 1); st.removed.push(a.path); renderAtts(); return;
    }
    try {
      const url = await supa().signedUrl(a.path, { download: b.dataset.att === 'download' ? a.name : null });
      const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove();
    } catch (err) { toast(err.message); }
  });
  function cleanupUploads() {
    // Se fechou sem salvar, apaga os arquivos enviados nesta edição.
    if (!st.saved && st.uploads.length) st.uploads.forEach(p => store.queueObjectDelete(p)), store.scheduleSync();
  }

  // ---------- histórico ----------
  function renderHistory() {
    const h = (st.t.history || []).slice(-8).reverse();
    $('#ed-history', m).innerHTML = h.length ? `<details class="history"><summary>Histórico de conclusões (${st.t.history.length})</summary>${h.map(x => `<div><span>${new Date(x.at).toLocaleDateString('pt-BR')}</span> concluída em ${new Date(x.doneAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</div>`).join('')}</details>` : '';
  }

  // ---------- ações ----------
  m.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'close') closeModal();
    if (a.dataset.a === 'toggle-done' && !isNew) { closeModal(); ctx.toggleTask(st.t.id); }
    if (a.dataset.a === 'delete') { if (await confirmBox(`Excluir “${st.t.title}”${st.t.attachments.length ? ' e seus anexos' : ''}?`, { ok: 'Excluir', danger: true })) { st.saved = true; closeModal(); ctx.deleteTask(st.t.id); } }
    if (a.dataset.a === 'skip') { const next = skipOccurrence(collect()); st.saved = true; store.saveTask(next); closeModal(); toast(`Ocorrência pulada. Próxima: ${new Date(next.dueAt).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}`); }
  });
  function collect() {
    st.t.title = f.title.value.trim();
    st.t.notes = f.notes.value;
    st.t.list = f.list.value || null;
    st.t.tags = f.tags.value.split(/[,;]/).map(s => s.trim().replace(/^#/, '')).filter(Boolean);
    st.t.durationMin = Number(f.duration.value) || 0;
    st.t.attachments = st.t.attachments.filter(a => !a.uploading);
    return st.t;
  }
  f.addEventListener('submit', e => {
    e.preventDefault();
    const t = collect();
    if (!t.title) { toast('Dê um nome à tarefa.'); f.title.focus(); return; }
    if ($$('.att .spin', m).length) { toast('Aguarde o envio dos anexos terminar.'); return; }
    if (t.recurrence && t.recurrence.base !== 'completion') {
      const first = firstOnOrAfter(t.recurrence, t.recurrenceAnchor || t.dueAt);
      if (!first) { toast('Essa regra de repetição não gera nenhuma data. Revise.'); return; }
    }
    st.saved = true;
    st.removed.forEach(p => store.queueObjectDelete(p));
    store.saveTask(t);
    closeModal();
    toast(isNew ? 'Tarefa criada.' : 'Alterações salvas.');
  });

  syncDateInputs(); renderReminders(); renderPrio(); renderRecBtn(); renderSubs(); renderAtts(); renderHistory();
  return m;
}
