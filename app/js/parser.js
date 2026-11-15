// Interpretador de frases em português (sem custo, sem internet).
// Ex.: "Pagar DAS todo dia 20 antecipando 9h !alta #impostos"
import { WEEKDAYS, firstOnOrAfter, normalizeRecurrence, dateKey, pad } from './recurrence.js';

const WD_RE = '(domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado)(?:s)?(?:[- ]feiras?)?';
const WD_MAP = { domingo: 'SU', segunda: 'MO', terca: 'TU', 'terça': 'TU', quarta: 'WE', quinta: 'TH', sexta: 'FR', sabado: 'SA', 'sábado': 'SA' };
const MONTHS = { janeiro: 1, fevereiro: 2, marco: 3, 'março': 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const MONTH_RE = '(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)';
const ORD = { primeiro: 1, primeira: 1, '1º': 1, '1ª': 1, '1o': 1, '1a': 1, segundo: 2, segunda: 2, '2º': 2, '2ª': 2, '2o': 2, terceiro: 3, terceira: 3, '3º': 3, '3ª': 3, '3o': 3,
  quarto: 4, quarta: 4, '4º': 4, '4ª': 4, '4o': 4, quinto: 5, quinta: 5, '5º': 5, '5ª': 5, '5o': 5, sexto: 6, '6º': 6, 'último': -1, ultimo: -1, 'última': -1, ultima: -1, 'penúltimo': -2, penultimo: -2, 'penúltima': -2, penultima: -2 };
const ORD_RE = '(primeir[oa]|segund[oa]|terceir[oa]|quart[oa]|quint[oa]|sexto|[1-6](?:º|ª|o|a)|[úu]ltim[oa]|pen[úu]ltim[oa])';
const wdCode = w => WD_MAP[w.replace(/s$/, '').replace(/[- ]feiras?$/, '')] || WD_MAP[w];

export function parseTask(text, now = new Date(), opts = {}) {
  const original = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!original) throw new Error('Descreva a tarefa antes de continuar.');
  // Trabalhamos numa cópia minúscula do mesmo tamanho; trechos reconhecidos viram espaços.
  let low = original.toLocaleLowerCase('pt-BR');
  let keep = original;
  const warnings = [];
  const take = (re, fn) => {
    const m = re.exec(low);
    if (!m) return null;
    m.orig = keep.slice(m.index, m.index + m[0].length);
    const start = m.index + (m[0].length - m[0].trimStart().length);
    const len = m[0].trim().length;
    low = low.slice(0, start) + ' '.repeat(len) + low.slice(start + len);
    keep = keep.slice(0, start) + ' '.repeat(len) + keep.slice(start + len);
    return fn ? fn(m) : m;
  };
  const B = '(?<![\\p{L}\\d])', E = '(?![\\p{L}\\d])'; // limites de palavra que entendem acentos

  // ---------- prefixos de pedido ----------
  take(new RegExp(`^${B}(me lembr[ae] de|lembre-me de|lembrar de|não esquecer de|nao esquecer de|preciso|tenho que)${E}`, 'iu'));

  // ---------- prioridade, lista, tags ----------
  let priority = 0;
  if (take(new RegExp(`${B}(prioridade alta|urgente|muito importante)${E}|(^|\\s)(!alta|!!!)(?=\\s|$)`, 'iu'))) priority = 3;
  else if (take(new RegExp(`${B}(prioridade m[eé]dia|importante)${E}|(^|\\s)(!m[eé]dia|!!)(?=\\s|$)`, 'iu'))) priority = 2;
  else if (take(new RegExp(`${B}(prioridade baixa|sem urg[eê]ncia)${E}|(^|\\s)(!baixa|!)(?=\\s|$)`, 'iu'))) priority = 1;
  const tags = [];
  let tm; while ((tm = take(/(^|\s)#([\p{L}\d_-]{1,30})/u))) tags.push(tm.orig.trim().slice(1));
  let list = null;
  const lm = take(/(^|\s)~([\p{L}\d_-]{1,40})/u); if (lm) list = lm.orig.trim().slice(1);

  // ---------- recorrência ----------
  let rec = null;
  let explicitDate = null; // Date sem hora definida
  const setRec = r => { if (!rec) rec = r; };
  const nthKindRe = `(${WD_RE}|dia [úu]til|dia [úu]teis|dia de semana|dia)`;
  const kindOf = s => /[úu]til/.test(s) ? 'businessday' : /dia de semana/.test(s) ? 'weekday' : /^dia/.test(s) ? 'day' : wdCode(s.match(new RegExp(WD_RE, 'iu'))[1]);

  // "todo/toda (o/a) primeiro domingo (do mês)", "todo 5º dia útil", "toda última sexta do mês"
  take(new RegExp(`${B}(?:tod[oa]s?\\s+(?:[oa]s?\\s+)?|n[oa]\\s+|[oa]\\s+)?${ORD_RE}\\s+${nthKindRe}(?:\\s+(?:do|de cada|de todo)\\s+m[eê]s)?${E}`, 'iu'), m => {
    const pos = ORD[m[1].toLowerCase()];
    const kind = kindOf(m[2].toLowerCase());
    const hasEvery = /^(tod|n[oa]\s|[oa]\s)/i.test(m[0].trim()) || /m[eê]s/i.test(m[0]);
    if (hasEvery || kind === 'businessday') setRec({ freq: 'monthly', interval: 1, monthMode: 'nth', nth: { pos: Math.max(-3, Math.min(5, pos)), kind } });
  });
  // "todo último dia do mês" / "fim do mês"
  take(new RegExp(`${B}(?:todo\\s+)?(?:o\\s+)?[úu]ltimo dia (?:do|de cada) m[eê]s${E}`, 'iu'), () => setRec({ freq: 'monthly', interval: 1, monthMode: 'days', byMonthDay: [-1] }));
  // "todo ano em 15/03", "todo dia 15/03", "anualmente dia 15/03"
  take(new RegExp(`${B}(?:todo ano|todos os anos|anualmente)(?:\\s+(?:em|no dia|dia))?\\s+(\\d{1,2})\\/(\\d{1,2})${E}|${B}todo dia (\\d{1,2})\\/(\\d{1,2})${E}`, 'iu'), m => {
    const d = Number(m[1] || m[3]), mo = Number(m[2] || m[4]);
    setRec({ freq: 'yearly', interval: 1, byMonth: [mo], monthMode: 'days', byMonthDay: [d] });
  });
  // "todo dia 20", "todo dia 10 e 25", "todos os dias 5 e 20 (de cada mês)"
  take(new RegExp(`${B}tod[oa]s? (?:os )?dias? (\\d{1,2}(?:\\s*(?:,|e)\\s*\\d{1,2})*)(?:\\s+(?:de cada|do|de todo) m[eê]s)?${E}`, 'iu'), m => {
    const days = m[1].split(/\s*(?:,|e)\s*/).map(Number).filter(n => n >= 1 && n <= 31);
    if (days.length) setRec({ freq: 'monthly', interval: 1, monthMode: 'days', byMonthDay: days });
  });
  // dias úteis
  take(new RegExp(`${B}(todo dia [úu]til|todos os dias [úu]teis|dias [úu]teis|de segunda a sexta)${E}`, 'iu'), () => setRec({ freq: 'weekly', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }));
  // "a cada 2 semanas", "a cada 3 dias", "a cada 8 horas"
  take(new RegExp(`${B}a cada (\\d{1,3})\\s+(horas?|dias?|semanas?|m[eê]s(?:es)?|anos?)${E}`, 'iu'), m => {
    const n = Number(m[1]), u = m[2].toLowerCase();
    const freq = u.startsWith('hora') ? 'hourly' : u.startsWith('dia') ? 'daily' : u.startsWith('semana') ? 'weekly' : u.startsWith('ano') ? 'yearly' : 'monthly';
    setRec({ freq, interval: n });
  });
  // "toda segunda e quarta", "todas as terças"
  take(new RegExp(`${B}tod[oa]s?\\s+(?:[oa]s\\s+)?(${WD_RE}(?:\\s*(?:,|e)\\s*${WD_RE})*)${E}`, 'iu'), m => {
    const days = [...m[1].toLowerCase().matchAll(new RegExp(WD_RE, 'giu'))].map(x => wdCode(x[1])).filter(Boolean);
    setRec({ freq: 'weekly', interval: 1, byDay: [...new Set(days)] });
  });
  take(new RegExp(`${B}(todos os dias|todo dia|diariamente|toda manh[ãa]|toda noite)${E}`, 'iu'), () => setRec({ freq: 'daily', interval: 1 }));
  take(new RegExp(`${B}(quinzenal(?:mente)?)${E}`, 'iu'), () => setRec({ freq: 'weekly', interval: 2 }));
  take(new RegExp(`${B}(semanal(?:mente)?|toda semana)${E}`, 'iu'), () => setRec({ freq: 'weekly', interval: 1 }));
  take(new RegExp(`${B}(mensal(?:mente)?|todo m[eê]s|todos os meses)${E}`, 'iu'), () => setRec({ freq: 'monthly', interval: 1 }));
  take(new RegExp(`${B}(trimestral(?:mente)?)${E}`, 'iu'), () => setRec({ freq: 'monthly', interval: 3 }));
  take(new RegExp(`${B}(anual(?:mente)?|todo ano|todos os anos)${E}`, 'iu'), () => setRec({ freq: 'yearly', interval: 1 }));
  if (rec) {
    take(new RegExp(`${B}(?:(?:se n[ãa]o for dia [úu]til,?\\s*)?(antecipa(?:ndo|r)?|adia(?:ndo|r)?|posterga(?:ndo|r)?|prorroga(?:ndo|r)?))${E}`, 'iu'), m => { rec.adjust = /antecip/i.test(m[1]) ? 'prev' : 'next'; });
    take(new RegExp(`${B}(?:ap[óo]s|depois d[ae]) (?:a )?conclus[ãa]o${E}`, 'iu'), () => { rec.base = 'completion'; });
    take(new RegExp(`${B}(\\d{1,4}) vezes${E}`, 'iu'), m => { rec.end = { type: 'count', count: Number(m[1]) }; });
    take(new RegExp(`${B}at[ée] (?:o dia )?(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?${E}`, 'iu'), m => {
      let y = m[3] ? Number(m[3]) : now.getFullYear(); if (y < 100) y += 2000;
      const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
      if (!m[3] && d < now) d.setFullYear(y + 1);
      rec.end = { type: 'until', until: dateKey(d) };
    });
  }

  // ---------- horário ----------
  let hour = null, minute = 0, relative = null;
  take(new RegExp(`${B}(?:daqui a|em)\\s+(\\d{1,3}|uma?|meia)\\s+(minutos?|horas?|dias?|semanas?|m[eê]s(?:es)?)${E}`, 'iu'), m => {
    const n = m[1] === 'meia' ? 0.5 : /^uma?$/.test(m[1]) ? 1 : Number(m[1]);
    const u = m[2].toLowerCase();
    const d = new Date(now);
    if (u.startsWith('min')) d.setMinutes(d.getMinutes() + n);
    else if (u.startsWith('hora')) d.setMinutes(d.getMinutes() + n * 60);
    else if (u.startsWith('dia')) d.setDate(d.getDate() + n);
    else if (u.startsWith('semana')) d.setDate(d.getDate() + 7 * n);
    else d.setMonth(d.getMonth() + n);
    relative = { date: d, hasTime: u.startsWith('min') || u.startsWith('hora') };
  });
  take(new RegExp(`${B}(?:ao |à |a )?(meio[- ]dia|meia[- ]noite)${E}`, 'iu'), m => { hour = /meio/.test(m[1]) ? 12 : 0; });
  if (hour === null) take(new RegExp(`${B}(?:[àa]s\\s+|a partir das\\s+|pelas?\\s+)?(\\d{1,2})(?::|h)(\\d{2})${E}`, 'iu'), m => { hour = +m[1]; minute = +m[2]; });
  if (hour === null) take(new RegExp(`${B}(?:[àa]s\\s+|pelas?\\s+)?(\\d{1,2})\\s*(?:h|hs|horas?)${E}`, 'iu'), m => { hour = +m[1]; });
  if (hour === null) take(new RegExp(`${B}(?:às|pelas)\\s+(\\d{1,2})${E}`, 'iu'), m => { hour = +m[1]; });
  if (hour !== null) {
    take(new RegExp(`${B}(da manh[ãa]|da tarde|da noite|da madrugada)${E}`, 'iu'), m => { if (/tarde|noite/.test(m[1]) && hour < 12) hour += 12; });
    if (hour > 23 || minute > 59) { warnings.push(`Horário ${hour}:${pad(minute)} não existe; ignorei.`); hour = null; minute = 0; }
  }

  // ---------- data ----------
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const mk = (y, mo, d) => { const x = new Date(y, mo, d); return x.getFullYear() === y && x.getMonth() === mo && x.getDate() === d ? x : null; };
  take(new RegExp(`${B}depois de amanh[ãa]${E}`, 'iu'), () => { explicitDate = new Date(today); explicitDate.setDate(today.getDate() + 2); });
  if (!explicitDate) take(new RegExp(`${B}amanh[ãa]${E}`, 'iu'), () => { explicitDate = new Date(today); explicitDate.setDate(today.getDate() + 1); });
  if (!explicitDate) take(new RegExp(`${B}hoje${E}`, 'iu'), () => { explicitDate = new Date(today); });
  if (!explicitDate) take(new RegExp(`${B}anteontem${E}`, 'iu'), () => { explicitDate = new Date(today); explicitDate.setDate(today.getDate() - 2); });
  if (!explicitDate) take(new RegExp(`${B}ontem${E}`, 'iu'), () => { explicitDate = new Date(today); explicitDate.setDate(today.getDate() - 1); });
  if (!explicitDate) take(new RegExp(`${B}(?:(?:no )?dia\\s+|em\\s+)?(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?${E}`, 'iu'), m => {
    let y = m[3] ? Number(m[3]) : now.getFullYear(); if (y < 100) y += 2000;
    let d = mk(y, Number(m[2]) - 1, Number(m[1]));
    if (!d) { warnings.push(`A data ${m[1]}/${m[2]}${m[3] ? '/' + m[3] : ''} não existe.`); return; }
    if (!m[3] && d < today) d = mk(y + 1, Number(m[2]) - 1, Number(m[1])) || d;
    explicitDate = d;
  });
  if (!explicitDate) take(new RegExp(`${B}(?:(?:no )?dia\\s+)?(\\d{1,2}) de ${MONTH_RE}(?: de (\\d{4}))?${E}`, 'iu'), m => {
    const mo = MONTHS[m[2].toLowerCase()] - 1; let y = m[3] ? Number(m[3]) : now.getFullYear();
    let d = mk(y, mo, Number(m[1]));
    if (!d) { warnings.push(`A data ${m[1]} de ${m[2]} não existe.`); return; }
    if (!m[3] && d < today) d = mk(y + 1, mo, Number(m[1])) || d;
    explicitDate = d;
  });
  if (!explicitDate && !rec) take(new RegExp(`${B}(?:no )?dia (\\d{1,2})${E}`, 'iu'), m => {
    const n = Number(m[1]); if (n < 1 || n > 31) return;
    for (let k = 0; k < 14 && !explicitDate; k++) {
      const probe = new Date(now.getFullYear(), now.getMonth() + k, 1);
      const real = mk(probe.getFullYear(), probe.getMonth(), n);
      if (real && real >= today) explicitDate = real;
    }
  });
  if (!explicitDate && !rec) take(new RegExp(`${B}(?:n[oa] )?(?:pr[óo]xim[oa] )?${WD_RE}(?: que vem)?${E}`, 'iu'), m => {
    const code = wdCode(m[1].toLowerCase()); const target = WEEKDAYS.indexOf(code);
    const d = new Date(today); let add = (target - d.getDay() + 7) % 7;
    const laterToday = add === 0 && hour !== null && (hour > now.getHours() || (hour === now.getHours() && minute > now.getMinutes()));
    if (add === 0 && !laterToday) add = 7;
    d.setDate(d.getDate() + add); explicitDate = d;
  });
  if (!explicitDate && !rec) take(new RegExp(`${B}(?:no )?fim do m[eê]s${E}`, 'iu'), () => { explicitDate = new Date(today.getFullYear(), today.getMonth() + 1, 0); });
  if (!explicitDate && !rec) take(new RegExp(`${B}semana que vem${E}`, 'iu'), () => { explicitDate = new Date(today); explicitDate.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7)); });

  // ---------- montar data final ----------
  let dueAt = null, allDay = true;
  if (relative) { dueAt = relative.date; allDay = !relative.hasTime && hour === null; if (hour !== null) dueAt.setHours(hour, minute, 0, 0); }
  else if (explicitDate) {
    dueAt = new Date(explicitDate);
    if (hour !== null) { dueAt.setHours(hour, minute, 0, 0); allDay = false; }
    if (!allDay && dueAt < now && dateKey(dueAt) === dateKey(now) && !/hoje|ontem/.test(original.toLowerCase())) dueAt.setDate(dueAt.getDate() + 1);
  } else if (hour !== null || rec) {
    dueAt = new Date(today);
    if (hour !== null) { dueAt.setHours(hour, minute, 0, 0); allDay = false; }
    if (!rec && dueAt < now) dueAt.setDate(dueAt.getDate() + 1); // "às 8h" já passou → amanhã
  }
  let recurrence = null;
  if (rec) {
    recurrence = normalizeRecurrence(rec);
    if (recurrence.freq === 'weekly' && !rec.byDay) recurrence.byDay = [WEEKDAYS[dueAt.getDay()]];
    const from = dueAt < now && recurrence.freq !== 'hourly' ? (allDay ? today : now) : dueAt;
    const anchorAt = new Date(from); if (!allDay) anchorAt.setHours(dueAt.getHours(), dueAt.getMinutes(), 0, 0);
    if (allDay) anchorAt.setHours(0, 0, 0, 0);
    let first = firstOnOrAfter(recurrence, anchorAt);
    if (first && !allDay && first.at < now) first = firstOnOrAfter(recurrence, new Date(anchorAt.getTime() + 86400_000));
    if (first) dueAt = first.at;
  }

  // ---------- título ----------
  let title = keep.replace(/\s{2,}/g, ' ')
    .replace(/(^|\s)(?:às|as|no|na|em|de|do|da|e|,|para)(?=\s*$)/giu, '')
    .replace(/^\s*(?:,|-|–|:|de|para)\s+/iu, '')
    .replace(/[\s,;:–-]+$/u, '').trim();
  if (!title) title = original;
  title = title.charAt(0).toLocaleUpperCase('pt-BR') + title.slice(1);
  if (!list && opts.autoList !== false) {
    const l = original.toLowerCase();
    if (/\b(boleto|fatura|pagar|pagamento|imposto|das|darf|gps|fgts|conta de|banco|cart[ãa]o)/.test(l)) list = 'Financeiro';
    else if (/\b(reuni[ãa]o|cliente|relat[óo]rio|trabalho|escrit[óo]rio|balan[çc]o|declara[çc][ãa]o)/.test(l)) list = 'Trabalho';
  }
  return {
    title: title.slice(0, 200),
    dueAt: dueAt ? dueAt.toISOString() : null,
    allDay: dueAt ? allDay : true,
    recurrence,
    priority,
    list,
    tags,
    warnings
  };
}
