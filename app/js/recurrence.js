// Motor de recorrência da Minha Agenda IA.
// Cobre o modelo do iCalendar (RFC 5545: FREQ, INTERVAL, BYDAY, BYMONTHDAY, BYMONTH,
// BYSETPOS, COUNT, UNTIL, EXDATE) e acrescenta o que faz falta no Brasil:
// N-ésimo dia útil com feriados nacionais, ajuste para o dia útil anterior/seguinte
// e repetição contada a partir da data de conclusão (como no TickTick).
//
// Formato do objeto de recorrência (guardado em task.recurrence):
// {
//   freq: 'hourly'|'daily'|'weekly'|'monthly'|'yearly',
//   interval: 1,
//   byDay: ['MO','WE'],              // semanal: dias; diário: filtro opcional
//   monthMode: 'same'|'days'|'nth',  // mensal/anual
//   byMonthDay: [1, 15, -1],         // monthMode 'days' (-1 = último dia)
//   nth: { pos: 1, kind: 'SU' },     // monthMode 'nth'; pos 1..5 ou -1 (último), -2 (penúltimo)
//                                    // kind: 'SU'..'SA' | 'day' | 'weekday' | 'businessday' | 'weekend'
//   byMonth: [3],                    // anual (padrão: mês da data inicial)
//   end: { type: 'never'|'until'|'count', until: 'YYYY-MM-DD', count: 10 },
//   base: 'due'|'completion',
//   adjust: 'none'|'prev'|'next',    // se cair em fim de semana/feriado
//   exdates: ['YYYY-MM-DD']          // ocorrências puladas
// }

export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WD_NAME = { SU: 'domingo', MO: 'segunda', TU: 'terça', WE: 'quarta', TH: 'quinta', FR: 'sexta', SA: 'sábado' };
const WD_SHORT = { SU: 'dom.', MO: 'seg.', TU: 'ter.', WE: 'qua.', TH: 'qui.', FR: 'sex.', SA: 'sáb.' };
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// ---------- datas auxiliares (sempre no fuso local do aparelho) ----------
export const pad = n => String(n).padStart(2, '0');
export function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function fromKey(k, h = 0, m = 0) { const [y, mo, d] = k.split('-').map(Number); return new Date(y, mo - 1, d, h, m, 0, 0); }
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function atTime(y, m, day, ref) { return new Date(y, m, day, ref.getHours(), ref.getMinutes(), 0, 0); }

// ---------- feriados ----------
let holidayOpts = { carnaval: true, corpusChristi: true, extra: [] };
const holidayCache = new Map();
export function setHolidayOptions(opts = {}) {
  holidayOpts = { ...holidayOpts, ...opts, extra: Array.isArray(opts.extra) ? opts.extra : holidayOpts.extra };
  holidayCache.clear();
}
export function getHolidayOptions() { return { ...holidayOpts }; }

function easter(y) { // algoritmo de Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
export function holidaysOf(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const map = new Map();
  const fixed = [['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência'], ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'], ['12-25', 'Natal']];
  for (const [md, name] of fixed) map.set(`${y}-${md}`, name);
  if (y >= 2024) map.set(`${y}-11-20`, 'Dia Nacional de Zumbi e da Consciência Negra');
  const e = easter(y);
  map.set(dateKey(addDays(e, -2)), 'Sexta-feira Santa');
  if (holidayOpts.carnaval) { map.set(dateKey(addDays(e, -48)), 'Carnaval'); map.set(dateKey(addDays(e, -47)), 'Carnaval'); }
  if (holidayOpts.corpusChristi) map.set(dateKey(addDays(e, 60)), 'Corpus Christi');
  for (const raw of holidayOpts.extra || []) {
    const s = String(raw.date || raw).trim(), name = raw.name || 'Feriado local';
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)) && Number(m[1]) === y) map.set(s, name);
    else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/))) map.set(`${y}-${pad(m[2])}-${pad(m[1])}`, name);
  }
  holidayCache.set(y, map);
  return map;
}
export function holidayName(d) { return holidaysOf(d.getFullYear()).get(dateKey(d)) || null; }
export function isBusinessDay(d) { const w = d.getDay(); return w !== 0 && w !== 6 && !holidayName(d); }
export function shiftToBusinessDay(d, dir) {
  let x = new Date(d); let guard = 0;
  while (!isBusinessDay(x) && guard++ < 30) x = addDays(x, dir === 'prev' ? -1 : 1);
  return x;
}

// ---------- normalização ----------
export function normalizeRecurrence(r) {
  if (!r || typeof r !== 'object' || !r.freq || r.freq === 'none') return null;
  const freq = ['hourly', 'daily', 'weekly', 'monthly', 'yearly'].includes(r.freq) ? r.freq : null;
  if (!freq) return null;
  const out = {
    freq,
    interval: Math.max(1, Math.min(999, parseInt(r.interval, 10) || 1)),
    byDay: Array.isArray(r.byDay) ? [...new Set(r.byDay.filter(d => WEEKDAYS.includes(d)))] : [],
    monthMode: ['same', 'days', 'nth'].includes(r.monthMode) ? r.monthMode : 'same',
    byMonthDay: Array.isArray(r.byMonthDay) ? [...new Set(r.byMonthDay.map(Number).filter(n => Number.isInteger(n) && n !== 0 && n >= -31 && n <= 31))] : [],
    nth: r.nth && typeof r.nth === 'object' ? { pos: Number(r.nth.pos) || 1, kind: String(r.nth.kind || 'day') } : null,
    byMonth: Array.isArray(r.byMonth) ? [...new Set(r.byMonth.map(Number).filter(n => n >= 1 && n <= 12))].sort((a, b) => a - b) : [],
    end: { type: 'never' },
    base: r.base === 'completion' ? 'completion' : 'due',
    adjust: ['prev', 'next'].includes(r.adjust) ? r.adjust : 'none',
    exdates: Array.isArray(r.exdates) ? r.exdates.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)).slice(-500) : []
  };
  if (out.monthMode === 'days' && !out.byMonthDay.length) out.monthMode = 'same';
  if (out.monthMode === 'nth' && !out.nth) out.monthMode = 'same';
  if (out.nth && ![1, 2, 3, 4, 5, -1, -2, -3].includes(out.nth.pos)) out.nth.pos = 1;
  if (out.nth && ![...WEEKDAYS, 'day', 'weekday', 'businessday', 'weekend'].includes(out.nth.kind)) out.nth.kind = 'day';
  const e = r.end || {};
  if (e.type === 'until' && /^\d{4}-\d{2}-\d{2}$/.test(e.until || '')) out.end = { type: 'until', until: e.until };
  else if (e.type === 'count' && parseInt(e.count, 10) > 0) out.end = { type: 'count', count: Math.min(5000, parseInt(e.count, 10)) };
  return out;
}

// ---------- geração ----------
function pickPos(list, pos) {
  if (!list.length) return [];
  const i = pos > 0 ? pos - 1 : list.length + pos;
  return i >= 0 && i < list.length ? [list[i]] : [];
}
function monthCandidates(y, m, rec, ref) {
  const last = daysInMonth(y, m);
  const all = Array.from({ length: last }, (_, i) => new Date(y, m, i + 1));
  if (rec.monthMode === 'nth') {
    const { pos, kind } = rec.nth;
    let pool;
    if (WEEKDAYS.includes(kind)) pool = all.filter(d => WEEKDAYS[d.getDay()] === kind);
    else if (kind === 'weekday') pool = all.filter(d => d.getDay() !== 0 && d.getDay() !== 6);
    else if (kind === 'businessday') pool = all.filter(isBusinessDay);
    else if (kind === 'weekend') pool = all.filter(d => d.getDay() === 0 || d.getDay() === 6);
    else pool = all;
    return pickPos(pool, pos).map(d => d.getDate());
  }
  if (rec.monthMode === 'days') {
    const days = rec.byMonthDay.map(n => n > 0 ? n : last + 1 + n).filter(n => n >= 1 && n <= last);
    return [...new Set(days)].sort((a, b) => a - b);
  }
  return ref.getDate() <= last ? [ref.getDate()] : []; // mesmo dia do mês da data inicial
}

// Gera ocorrências "brutas" (antes de ajuste/exceções) em ordem, a partir de start.
function* rawOccurrences(rec, start) {
  const MAX_PERIODS = 20000;
  const ref = new Date(start);
  if (rec.freq === 'hourly') {
    for (let k = 0; k < MAX_PERIODS * 5; k++) {
      const t = new Date(ref.getTime() + k * rec.interval * 3600_000);
      if (rec.byDay.length && !rec.byDay.includes(WEEKDAYS[t.getDay()])) continue;
      yield t;
    }
    return;
  }
  if (rec.freq === 'daily') {
    for (let k = 0; k < MAX_PERIODS * 3; k++) {
      const d = atTime(ref.getFullYear(), ref.getMonth(), ref.getDate() + k * rec.interval, ref);
      if (rec.byDay.length && !rec.byDay.includes(WEEKDAYS[d.getDay()])) continue;
      if (rec.byMonth.length && !rec.byMonth.includes(d.getMonth() + 1)) continue;
      yield d;
    }
    return;
  }
  if (rec.freq === 'weekly') {
    const days = (rec.byDay.length ? rec.byDay : [WEEKDAYS[ref.getDay()]])
      .map(c => (WEEKDAYS.indexOf(c) + 6) % 7).sort((a, b) => a - b); // segunda=0
    const monday = addDays(new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()), -((ref.getDay() + 6) % 7));
    for (let k = 0; k < MAX_PERIODS; k++) {
      for (const off of days) {
        const base = addDays(monday, k * 7 * rec.interval + off);
        const d = atTime(base.getFullYear(), base.getMonth(), base.getDate(), ref);
        if (d >= startOfDay(ref)) yield d;
      }
    }
    return;
  }
  if (rec.freq === 'monthly') {
    for (let k = 0; k < MAX_PERIODS; k++) {
      const first = new Date(ref.getFullYear(), ref.getMonth() + k * rec.interval, 1);
      for (const day of monthCandidates(first.getFullYear(), first.getMonth(), rec, ref)) yield atTime(first.getFullYear(), first.getMonth(), day, ref);
    }
    return;
  }
  if (rec.freq === 'yearly') {
    const months = rec.byMonth.length ? rec.byMonth : [ref.getMonth() + 1];
    for (let k = 0; k < MAX_PERIODS / 4; k++) {
      const y = ref.getFullYear() + k * rec.interval;
      for (const mo of months) for (const day of monthCandidates(y, mo - 1, rec, ref)) yield atTime(y, mo - 1, day, ref);
    }
  }
}
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

/**
 * Lista ocorrências da regra iniciada em `anchor`.
 * Retorna [{ at: Date, key: 'YYYY-MM-DD' (data original, antes do ajuste) }]
 * opts: { from?: Date (inclusive), after?: Date (exclusivo), to?: Date, limit?: number }
 */
export function occurrences(recurrence, anchor, opts = {}) {
  const rec = normalizeRecurrence(recurrence);
  const start = new Date(anchor);
  if (!rec || !Number.isFinite(start.getTime())) return [];
  const limit = Math.min(opts.limit ?? 100, 2000);
  const untilEnd = rec.end.type === 'until' ? fromKey(rec.end.until, 23, 59) : null;
  const out = [];
  let count = 0, guard = 0;
  // Cuidado para não perder ocorrências antecipadas pelo ajuste: buscamos um pouco antes.
  const lowBound = opts.after ? new Date(opts.after) : opts.from ? new Date(opts.from) : null;
  for (const raw of rawOccurrences(rec, start)) {
    if (++guard > 200000) break;
    if (raw < start) continue;
    if (untilEnd && raw > untilEnd) break;
    count++;
    if (rec.end.type === 'count' && count > rec.end.count) break;
    const key = dateKey(raw);
    let at = raw;
    if (rec.adjust !== 'none' && rec.freq !== 'hourly' && !isBusinessDay(raw)) {
      const moved = shiftToBusinessDay(raw, rec.adjust);
      at = atTime(moved.getFullYear(), moved.getMonth(), moved.getDate(), raw);
    }
    if (rec.exdates.includes(key) || (key !== dateKey(at) && rec.exdates.includes(dateKey(at)))) continue;
    if (opts.to && raw > new Date(opts.to) && at > new Date(opts.to)) break;
    if (opts.to && at > new Date(opts.to)) continue;
    if (lowBound) {
      if (opts.after && at <= lowBound) continue;
      if (!opts.after && at < lowBound) continue;
    }
    if (out.length && out[out.length - 1].at.getTime() === at.getTime()) continue; // ajuste juntou duas datas
    out.push({ at, key });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Próxima ocorrência estritamente depois de `after`. */
export function nextOccurrence(recurrence, anchor, after) {
  return occurrences(recurrence, anchor, { after, limit: 1 })[0] || null;
}
/** Primeira ocorrência na data/hora informada ou depois dela (para "encaixar" a data inicial na regra). */
export function firstOnOrAfter(recurrence, anchor) {
  return occurrences(recurrence, anchor, { from: anchor, limit: 1 })[0] || null;
}

/** Próxima data quando a repetição conta a partir da conclusão. */
export function nextFromCompletion(recurrence, anchor, completedAt) {
  const rec = normalizeRecurrence(recurrence);
  if (!rec) return null;
  const ref = new Date(anchor), c = new Date(completedAt);
  let next;
  if (rec.freq === 'hourly') next = new Date(c.getTime() + rec.interval * 3600_000);
  else if (rec.freq === 'daily') next = atTime(c.getFullYear(), c.getMonth(), c.getDate() + rec.interval, ref);
  else if (rec.freq === 'weekly') next = atTime(c.getFullYear(), c.getMonth(), c.getDate() + 7 * rec.interval, ref);
  else {
    const months = rec.freq === 'monthly' ? rec.interval : 12 * rec.interval;
    const first = new Date(c.getFullYear(), c.getMonth() + months, 1);
    next = atTime(first.getFullYear(), first.getMonth(), Math.min(c.getDate(), daysInMonth(first.getFullYear(), first.getMonth())), ref);
  }
  if (rec.adjust !== 'none' && rec.freq !== 'hourly' && !isBusinessDay(next)) {
    const m = shiftToBusinessDay(next, rec.adjust); next = atTime(m.getFullYear(), m.getMonth(), m.getDate(), ref);
  }
  if (rec.end.type === 'until' && next > fromKey(rec.end.until, 23, 59)) return null;
  return { at: next, key: dateKey(next) };
}

// ---------- descrição em português ----------
function ordinal(pos) { return pos === -1 ? 'último' : pos === -2 ? 'penúltimo' : pos === -3 ? 'antepenúltimo' : `${pos}º`; }
function listPt(items) { return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`; }
function nthLabel(nth) {
  const o = ordinal(nth.pos);
  if (WEEKDAYS.includes(nth.kind)) {
    const fem = ['MO', 'TU', 'WE', 'TH', 'FR'].includes(nth.kind);
    const ord = fem ? o.replace('º', 'ª').replace(/^último$/, 'última').replace(/^penúltimo$/, 'penúltima').replace(/^antepenúltimo$/, 'antepenúltima') : o;
    return `${fem ? 'na' : 'no'} ${ord} ${WD_NAME[nth.kind]}${fem ? '-feira' : ''}`;
  }
  const kinds = { day: 'dia', weekday: 'dia de semana (seg. a sex.)', businessday: 'dia útil', weekend: 'dia de fim de semana' };
  return `no ${o} ${kinds[nth.kind] || 'dia'}`;
}
function monthDaysLabel(days) {
  const parts = [...days].sort((a, b) => (a < 0 ? 100 + a : a) - (b < 0 ? 100 + b : b)).map(d => d === -1 ? 'último dia' : d < 0 ? `${-d}º dia antes do fim` : String(d));
  const plain = parts.every(p => /^\d+$/.test(p));
  return plain ? `no${parts.length > 1 ? 's' : ''} dia${parts.length > 1 ? 's' : ''} ${listPt(parts)}` : `no ${listPt(parts.map(p => /^\d+$/.test(p) ? `dia ${p}` : p))}`;
}
export function describe(recurrence, anchor) {
  const rec = normalizeRecurrence(recurrence);
  if (!rec) return 'Não se repete';
  const ref = anchor ? new Date(anchor) : new Date();
  const n = rec.interval;
  let s;
  if (rec.base === 'completion') {
    const unit = { hourly: ['hora', 'horas'], daily: ['dia', 'dias'], weekly: ['semana', 'semanas'], monthly: ['mês', 'meses'], yearly: ['ano', 'anos'] }[rec.freq];
    s = `${n} ${n === 1 ? unit[0] : unit[1]} após a conclusão`;
  } else if (rec.freq === 'hourly') s = n === 1 ? 'De hora em hora' : `A cada ${n} horas`;
  else if (rec.freq === 'daily') {
    const wk = ['MO', 'TU', 'WE', 'TH', 'FR'];
    if (rec.byDay.length === 5 && wk.every(d => rec.byDay.includes(d)) && n === 1) s = 'De segunda a sexta';
    else s = n === 1 ? 'Todos os dias' : `A cada ${n} dias`;
    if (rec.byDay.length && !(rec.byDay.length === 5 && n === 1 && wk.every(d => rec.byDay.includes(d)))) s += ` (só ${listPt(WEEKDAYS.filter(d => rec.byDay.includes(d)).map(d => WD_SHORT[d]))})`;
  } else if (rec.freq === 'weekly') {
    const days = (rec.byDay.length ? rec.byDay : [WEEKDAYS[ref.getDay()]]);
    const ordered = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].filter(d => days.includes(d));
    const names = ordered.length > 2 ? ordered.map(d => WD_SHORT[d]) : ordered.map(d => WD_NAME[d]);
    s = `${n === 1 ? 'Toda semana' : `A cada ${n} semanas`}: ${listPt(names)}`;
  } else {
    const where = rec.monthMode === 'nth' ? nthLabel(rec.nth) : rec.monthMode === 'days' ? monthDaysLabel(rec.byMonthDay) : `no dia ${ref.getDate()}`;
    if (rec.freq === 'monthly') s = `${n === 1 ? 'Todo mês' : `A cada ${n} meses`}, ${where}`;
    else {
      const months = (rec.byMonth.length ? rec.byMonth : [ref.getMonth() + 1]).map(m => MONTHS[m - 1]);
      if (rec.monthMode === 'same' && months.length === 1) s = `${n === 1 ? 'Todo ano' : `A cada ${n} anos`}, em ${ref.getDate()} de ${months[0]}`;
      else s = `${n === 1 ? 'Todo ano' : `A cada ${n} anos`}, ${where} de ${listPt(months)}`;
    }
  }
  if (rec.adjust === 'prev') s += '; se não for dia útil, antecipa';
  if (rec.adjust === 'next') s += '; se não for dia útil, adia';
  if (rec.end.type === 'until') { const [y, m, d] = rec.end.until.split('-'); s += `; até ${d}/${m}/${y}`; }
  if (rec.end.type === 'count') s += `; ${rec.end.count} vez${rec.end.count > 1 ? 'es' : ''}`;
  if (rec.exdates.length) s += ` (${rec.exdates.length} pulada${rec.exdates.length > 1 ? 's' : ''})`;
  return s;
}

/** Exporta no padrão iCalendar (RFC 5545), útil para backup/integrações. */
export function toRRULE(recurrence, anchor) {
  const rec = normalizeRecurrence(recurrence);
  if (!rec) return '';
  const ref = new Date(anchor);
  const p = [`FREQ=${rec.freq.toUpperCase()}`];
  if (rec.interval > 1) p.push(`INTERVAL=${rec.interval}`);
  if (rec.freq === 'weekly' || rec.freq === 'daily' || rec.freq === 'hourly') { if (rec.byDay.length) p.push(`BYDAY=${rec.byDay.join(',')}`); }
  if (rec.freq === 'yearly') p.push(`BYMONTH=${(rec.byMonth.length ? rec.byMonth : [ref.getMonth() + 1]).join(',')}`);
  if (['monthly', 'yearly'].includes(rec.freq)) {
    if (rec.monthMode === 'days') p.push(`BYMONTHDAY=${rec.byMonthDay.join(',')}`);
    else if (rec.monthMode === 'nth') {
      const { pos, kind } = rec.nth;
      if (WEEKDAYS.includes(kind)) p.push(`BYDAY=${pos}${kind}`);
      else if (kind === 'day') p.push(`BYMONTHDAY=${pos}`);
      else if (kind === 'weekday' || kind === 'businessday') p.push('BYDAY=MO,TU,WE,TH,FR', `BYSETPOS=${pos}`);
      else if (kind === 'weekend') p.push('BYDAY=SA,SU', `BYSETPOS=${pos}`);
    } else p.push(`BYMONTHDAY=${ref.getDate()}`);
  }
  if (rec.end.type === 'count') p.push(`COUNT=${rec.end.count}`);
  if (rec.end.type === 'until') p.push(`UNTIL=${rec.end.until.replace(/-/g, '')}T235959`);
  return 'RRULE:' + p.join(';');
}

/** Atalhos usados no editor e no interpretador. */
export function preset(name, anchor) {
  const ref = new Date(anchor || Date.now());
  const wd = WEEKDAYS[ref.getDay()];
  const nthPos = Math.ceil(ref.getDate() / 7) >= 5 || ref.getDate() + 7 > daysInMonth(ref.getFullYear(), ref.getMonth()) ? -1 : Math.ceil(ref.getDate() / 7);
  switch (name) {
    case 'daily': return { freq: 'daily', interval: 1 };
    case 'weekdays': return { freq: 'weekly', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] };
    case 'weekly': return { freq: 'weekly', interval: 1, byDay: [wd] };
    case 'biweekly': return { freq: 'weekly', interval: 2, byDay: [wd] };
    case 'monthly': return { freq: 'monthly', interval: 1, monthMode: 'same' };
    case 'monthlyNth': return { freq: 'monthly', interval: 1, monthMode: 'nth', nth: { pos: nthPos, kind: wd } };
    case 'monthlyLast': return { freq: 'monthly', interval: 1, monthMode: 'days', byMonthDay: [-1] };
    case 'monthlyLastBusiness': return { freq: 'monthly', interval: 1, monthMode: 'nth', nth: { pos: -1, kind: 'businessday' } };
    case 'yearly': return { freq: 'yearly', interval: 1, monthMode: 'same' };
    default: return null;
  }
}
