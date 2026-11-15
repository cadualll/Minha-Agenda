// Regras de negócio das tarefas (sem interface), testáveis isoladamente.
import { normalizeRecurrence, nextOccurrence, nextFromCompletion, occurrences, firstOnOrAfter, dateKey } from './recurrence.js';

export const PRIORITIES = [
  { v: 0, label: 'Nenhuma', color: '#9aa0b4' },
  { v: 1, label: 'Baixa', color: '#4f8fe8' },
  { v: 2, label: 'Média', color: '#f0a33a' },
  { v: 3, label: 'Alta', color: '#e5484d' }
];
export const DEFAULT_LISTS = [
  { name: 'Pessoal', color: '#8b7cf6' }, { name: 'Trabalho', color: '#4f8fe8' },
  { name: 'Financeiro', color: '#f0a33a' }, { name: 'Estudos', color: '#2fb383' }, { name: 'Saúde', color: '#e86f8a' }
];
export const REMINDER_OPTIONS = [
  { v: 0, label: 'Na hora' }, { v: 5, label: '5 min antes' }, { v: 10, label: '10 min antes' }, { v: 15, label: '15 min antes' },
  { v: 30, label: '30 min antes' }, { v: 60, label: '1 hora antes' }, { v: 120, label: '2 horas antes' },
  { v: 1440, label: '1 dia antes' }, { v: 2880, label: '2 dias antes' }, { v: 10080, label: '1 semana antes' }
];
export const ALLDAY_REMINDER_OPTIONS = [
  { v: 0, label: 'No dia' }, { v: 1440, label: '1 dia antes' }, { v: 2880, label: '2 dias antes' },
  { v: 4320, label: '3 dias antes' }, { v: 10080, label: '1 semana antes' }
];

export const uuid = () => (globalThis.crypto?.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

export function cleanTask(t, old = {}) {
  const x = { ...old, ...t };
  const dueAt = x.dueAt ? new Date(x.dueAt) : null;
  const valid = dueAt && Number.isFinite(dueAt.getTime());
  const recurrence = valid ? normalizeRecurrence(x.recurrence) : null;
  return {
    id: x.id || uuid(),
    title: String(x.title || '').trim().slice(0, 200) || 'Sem título',
    notes: String(x.notes || '').slice(0, 20000),
    list: x.list || null,
    tags: Array.isArray(x.tags) ? [...new Set(x.tags.map(s => String(s).trim().replace(/^#/, '')).filter(Boolean))].slice(0, 20) : [],
    priority: [0, 1, 2, 3].includes(Number(x.priority)) ? Number(x.priority) : 0,
    dueAt: valid ? dueAt.toISOString() : null,
    allDay: valid ? !!x.allDay : true,
    durationMin: Math.max(0, Math.min(1440 * 7, parseInt(x.durationMin, 10) || 0)),
    reminders: valid && Array.isArray(x.reminders) ? [...new Set(x.reminders.map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 60 * 24 * 60))].sort((a, b) => a - b).slice(0, 8) : [],
    recurrence,
    recurrenceAnchor: recurrence ? (x.recurrenceAnchor && Number.isFinite(new Date(x.recurrenceAnchor).getTime()) ? new Date(x.recurrenceAnchor).toISOString() : dueAt.toISOString()) : null,
    subtasks: Array.isArray(x.subtasks) ? x.subtasks.slice(0, 200).map(s => ({
      id: s.id || uuid(), title: String(s.title || '').trim().slice(0, 200), done: !!s.done,
      dueAt: s.dueAt && Number.isFinite(new Date(s.dueAt).getTime()) ? new Date(s.dueAt).toISOString() : null
    })).filter(s => s.title) : [],
    attachments: Array.isArray(x.attachments) ? x.attachments.slice(0, 50) : [],
    done: !!x.done,
    completedAt: x.done ? (x.completedAt || new Date().toISOString()) : null,
    history: Array.isArray(x.history) ? x.history.slice(-100) : [],
    createdAt: x.createdAt || new Date().toISOString(),
    order: Number.isFinite(x.order) ? x.order : Date.now()
  };
}

/** Ao ligar a recorrência ou mudar a data, encaixa a data na regra (ex.: "1º domingo"). */
export function snapToRule(task) {
  if (!task.recurrence || !task.dueAt) return task;
  const first = firstOnOrAfter(task.recurrence, task.dueAt);
  if (!first) return task;
  return { ...task, dueAt: first.at.toISOString(), recurrenceAnchor: first.at.toISOString() };
}

/**
 * Conclui a tarefa. Para recorrentes, registra no histórico e avança para a próxima ocorrência
 * (como no TickTick). Retorna { task, finished, next } — finished=true quando a série terminou.
 */
export function completeTask(task, now = new Date()) {
  if (!task.recurrence || !task.dueAt) {
    return { task: { ...task, done: true, completedAt: now.toISOString() }, finished: true, next: null };
  }
  const anchor = task.recurrenceAnchor || task.dueAt;
  const history = [...(task.history || []), { at: task.dueAt, doneAt: now.toISOString() }].slice(-100);
  let next = task.recurrence.base === 'completion'
    ? nextFromCompletion(task.recurrence, anchor, now)
    : nextOccurrence(task.recurrence, anchor, task.dueAt);
  if (!next) {
    return { task: { ...task, history, done: true, completedAt: now.toISOString() }, finished: true, next: null };
  }
  const nextTask = {
    ...task, history, dueAt: next.at.toISOString(), done: false, completedAt: null,
    subtasks: (task.subtasks || []).map(s => ({ ...s, done: false }))
  };
  return { task: nextTask, finished: false, next: next.at };
}

/** Pula a ocorrência atual sem registrar conclusão. */
export function skipOccurrence(task) {
  if (!task.recurrence || !task.dueAt) return task;
  const anchor = task.recurrenceAnchor || task.dueAt;
  const next = task.recurrence.base === 'completion' ? nextFromCompletion(task.recurrence, anchor, task.dueAt) : nextOccurrence(task.recurrence, anchor, task.dueAt);
  if (!next) return { ...task, done: true, completedAt: new Date().toISOString() };
  return { ...task, dueAt: next.at.toISOString(), subtasks: task.subtasks.map(s => ({ ...s, done: false })) };
}

export function reopenTask(task) { return { ...task, done: false, completedAt: null }; }

/** Ocorrências de uma tarefa dentro de um intervalo (para calendário). A primeira é a "real". */
export function taskOccurrencesInRange(task, from, to) {
  if (!task.dueAt) return [];
  const due = new Date(task.dueAt);
  if (task.done) return due >= from && due <= to ? [{ at: due, virtual: false }] : [];
  const out = [];
  if (due >= from && due <= to) out.push({ at: due, virtual: false });
  if (task.recurrence && task.recurrence.base !== 'completion') {
    const more = occurrences(task.recurrence, task.recurrenceAnchor || task.dueAt, { after: due, to, limit: 400 });
    for (const o of more) if (o.at >= from) out.push({ at: o.at, virtual: true });
  }
  return out;
}

/** Momentos de notificação para os próximos dias. */
export function reminderInstants(tasks, { now = new Date(), horizonDays = 45, allDayTime = '09:00', max = 300 } = {}) {
  const [hh, mm] = String(allDayTime || '09:00').split(':').map(Number);
  const limit = now.getTime() + horizonDays * 86400_000;
  const out = [];
  for (const t of tasks) {
    if (t.done || !t.dueAt) continue;
    const due = new Date(t.dueAt);
    const base = t.allDay ? new Date(due.getFullYear(), due.getMonth(), due.getDate(), hh || 0, mm || 0) : due;
    for (const m of t.reminders || []) {
      const when = new Date(base.getTime() - m * 60_000);
      if (when.getTime() > now.getTime() && when.getTime() < limit) out.push({ taskId: t.id, when, minutes: m, title: t.title, body: reminderBody(t, m, due) });
    }
    for (const s of t.subtasks || []) {
      if (s.done || !s.dueAt) continue;
      const when = new Date(s.dueAt);
      if (when > now && when.getTime() < limit) out.push({ taskId: t.id, subId: s.id, when, minutes: 0, title: s.title, body: `Etapa de “${t.title}”` });
    }
  }
  return out.sort((a, b) => a.when - b.when).slice(0, max);
}
function reminderBody(t, m, due) {
  const quando = t.allDay ? due.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
    : due.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const lead = m === 0 ? (t.allDay ? 'Hoje' : 'Agora') : m < 60 ? `Em ${m} min` : m < 1440 ? `Em ${m / 60} h` : `Em ${Math.round(m / 1440)} dia(s)`;
  return `${lead} • ${quando}`;
}

/** Inteiro de 32 bits estável (Android exige id numérico). */
export function notifId(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 1) % 2000000000 + 1;
}

// ---------- filtros das visões ----------
export function isOverdue(t, now = new Date()) {
  if (t.done || !t.dueAt) return false;
  const d = new Date(t.dueAt);
  return t.allDay ? dateKey(d) < dateKey(now) : d < now;
}
export function isToday(t, now = new Date()) { return !!t.dueAt && dateKey(new Date(t.dueAt)) === dateKey(now); }
export function inNextDays(t, days, now = new Date()) {
  if (!t.dueAt) return false;
  const k = dateKey(new Date(t.dueAt)); const end = new Date(now); end.setDate(end.getDate() + days);
  return k >= dateKey(now) && k <= dateKey(end);
}
export function sortTasks(list) {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.dueAt && b.dueAt) {
      const ka = dateKey(new Date(a.dueAt)), kb = dateKey(new Date(b.dueAt));
      if (ka !== kb) return ka < kb ? -1 : 1;
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      const diff = new Date(a.dueAt) - new Date(b.dueAt); if (diff) return diff;
    } else if (a.dueAt || b.dueAt) return a.dueAt ? -1 : 1;
    return (b.priority - a.priority) || (a.order - b.order);
  });
}
