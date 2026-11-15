// Filtros combináveis e indicadores do painel (funções puras, sem interface).
import { dateKey } from './recurrence.js';
import { isOverdue, taskOccurrencesInRange } from './tasks.js';

const DAY = 86400_000;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Faixas de tempo usadas nos filtros (sempre no fuso do aparelho). */
export function timeRanges(now = new Date()) {
  const today = startOfDay(now);
  const weekEnd = endOfDay(addDays(today, (7 - today.getDay()) % 7)); // até domingo (semana seg–dom)
  const nmStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nmEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
  return { today: [today, endOfDay(now)], week: [today, weekEnd], nextMonth: [nmStart, nmEnd], next30: [today, endOfDay(addDays(today, 30))] };
}
export const TIME_LABELS = { overdue: 'Atrasadas', today: 'Hoje', week: 'Esta semana', nextMonth: 'Próximo mês', next30: 'Próximos 30 dias', nodate: 'Sem data' };

export const emptyCriteria = () => ({ status: 'pending', recurring: null, time: [], priority: [], lists: [], tags: [], has: [] });
export function activeFilterCount(c) {
  return (c.status !== 'pending' ? 1 : 0) + (c.recurring !== null ? 1 : 0) + c.time.length + c.priority.length + c.lists.length + c.tags.length + c.has.length;
}

/** Combina os filtros: categorias diferentes = E; opções da mesma categoria = OU. */
export function matchTask(t, c, now = new Date(), R = timeRanges(now)) {
  if (c.status === 'pending' && t.done) return false;
  if (c.status === 'done' && !t.done) return false;
  if (c.recurring === true && !t.recurrence) return false;
  if (c.recurring === false && t.recurrence) return false;
  if (c.priority.length && !c.priority.includes(t.priority)) return false;
  if (c.lists.length && !c.lists.includes(t.list || '__inbox')) return false;
  if (c.tags.length && !c.tags.every(g => (t.tags || []).some(x => x.toLowerCase() === g.toLowerCase()))) return false;
  for (const h of c.has) {
    if (h === 'anexo' && !t.attachments?.length) return false;
    if (h === 'subtarefa' && !t.subtasks?.length) return false;
    if (h === 'lembrete' && !(t.reminders?.length && t.dueAt)) return false;
    if (h === 'nota' && !t.notes?.trim()) return false;
  }
  if (c.time.length) {
    const due = t.dueAt ? new Date(t.dueAt) : null;
    const ok = c.time.some(k => {
      if (k === 'nodate') return !due;
      if (!due) return false;
      if (k === 'overdue') return isOverdue(t, now);
      const [a, b] = R[k];
      if (k === 'week' || k === 'today') return due >= a && due <= b && !isOverdue(t, now);
      return due >= a && due <= b;
    });
    if (!ok) return false;
  }
  return true;
}

// ---------- indicadores ----------
export function periodRange(period, now = new Date()) {
  const today = startOfDay(now);
  if (period === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999), label: 'este mês' };
  if (period === '30d') return { from: addDays(today, -29), to: endOfDay(now), label: 'últimos 30 dias' };
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  return { from: monday, to: endOfDay(addDays(monday, 6)), label: 'esta semana' };
}

/** Todas as conclusões registradas: tarefas simples + cada ocorrência de recorrentes (histórico). */
export function completions(tasks) {
  const out = [];
  for (const t of tasks) {
    for (const h of t.history || []) if (h.doneAt) out.push({ task: t, at: h.at ? new Date(h.at) : null, doneAt: new Date(h.doneAt) });
    if (t.done && !t.recurrence && t.completedAt) out.push({ task: t, at: t.dueAt ? new Date(t.dueAt) : null, doneAt: new Date(t.completedAt) });
  }
  return out;
}

export function computeKpis(tasks, { now = new Date(), period = 'week' } = {}) {
  const P = periodRange(period, now);
  const limit = new Date(Math.min(now.getTime(), P.to.getTime()));
  const pending = tasks.filter(t => !t.done);
  const overdueList = pending.filter(t => isOverdue(t, now));
  const todayK = dateKey(now);
  const done = completions(tasks);

  // Taxa de conclusão: ocorrências com prazo no período (até agora) que foram concluídas.
  let due = 0, ok = 0, onTime = 0;
  for (const c of done) {
    if (!c.at || c.at < P.from || c.at > limit) continue;
    due++; ok++;
    const deadline = c.task.allDay ? endOfDay(c.at) : new Date(Math.max(c.at.getTime(), endOfDay(c.at).getTime()));
    if (c.doneAt <= deadline) onTime++;
  }
  for (const t of pending) {
    if (!t.dueAt) continue;
    const d = new Date(t.dueAt);
    const passed = t.allDay ? dateKey(d) <= todayK : d <= now;
    if (d >= P.from && d <= limit && passed) due++;
  }
  const doneInPeriod = done.filter(c => c.doneAt >= P.from && c.doneAt <= P.to).length;

  // Concluídas por dia (14 dias) e sequência de dias com conclusões
  const perDay = new Map();
  for (const c of done) { const k = dateKey(c.doneAt); perDay.set(k, (perDay.get(k) || 0) + 1); }
  const doneSeries = Array.from({ length: 14 }, (_, i) => { const d = addDays(startOfDay(now), i - 13); return { date: d, count: perDay.get(dateKey(d)) || 0 }; });
  let streak = 0;
  for (let i = perDay.has(todayK) ? 0 : 1; i < 3650; i++) { if (perDay.has(dateKey(addDays(now, -i)))) streak++; else break; }

  // Carga dos próximos 7 dias (inclui as próximas repetições)
  const start = startOfDay(now), end = endOfDay(addDays(start, 6));
  const loadMap = new Map();
  for (const t of pending) for (const o of taskOccurrencesInRange(t, start, end)) { const k = dateKey(o.at); loadMap.set(k, (loadMap.get(k) || 0) + 1); }
  const load = Array.from({ length: 7 }, (_, i) => { const d = addDays(start, i); return { date: d, count: loadMap.get(dateKey(d)) || 0 }; });

  // Pendentes por lista
  const byListMap = new Map();
  for (const t of pending) { const k = t.list || '__inbox'; byListMap.set(k, (byListMap.get(k) || 0) + 1); }
  const byList = [...byListMap].map(([list, count]) => ({ list, count })).sort((a, b) => b.count - a.count);

  // Próximas demandas críticas: atrasadas, alta prioridade e o que vence em até 48 h
  const horizon = now.getTime() + 7 * DAY;
  const critical = pending.filter(t => t.dueAt && new Date(t.dueAt).getTime() <= horizon).map(t => {
    const d = new Date(t.dueAt), over = isOverdue(t, now), hours = (d - now) / 3600_000;
    let score = over ? 1000 + (now - d) / DAY : 0;
    if (!over && hours <= 48) score += 300 - hours;
    score += t.priority * 120;
    let reason;
    if (over) { const days = Math.floor((startOfDay(now) - startOfDay(d)) / DAY); reason = days >= 1 ? `Atrasada há ${days} dia${days > 1 ? 's' : ''}` : 'Atrasada'; }
    else if (!t.allDay && hours < 24) reason = hours < 1 ? `Vence em ${Math.max(1, Math.round(hours * 60))} min` : `Vence em ${Math.round(hours)} h`;
    else reason = dateKey(d) === todayK ? 'Vence hoje' : `Vence em ${Math.round((startOfDay(d) - startOfDay(now)) / DAY)} dia(s)`;
    return { task: t, at: d, overdue: over, reason, score };
  }).filter(x => x.overdue || x.task.priority >= 2 || (x.at - now) <= 48 * 3600_000).sort((a, b) => b.score - a.score).slice(0, 6);

  return {
    period: P,
    overdue: overdueList.length,
    overdueHigh: overdueList.filter(t => t.priority === 3).length,
    today: pending.filter(t => t.dueAt && dateKey(new Date(t.dueAt)) === todayK && !isOverdue(t, now)).length,
    pending: pending.length,
    completion: { rate: due ? ok / due : null, done: ok, total: due, onTime, onTimeRate: ok ? onTime / ok : null },
    doneInPeriod, doneSeries, streak, load, byList, critical
  };
}
