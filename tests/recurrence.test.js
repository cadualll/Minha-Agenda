process.env.TZ = 'America/Sao_Paulo';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
const R = await import('../app/js/recurrence.js');

const at = (s) => new Date(s); // 'YYYY-MM-DDTHH:mm' local
const keys = (list) => list.map(o => `${R.dateKey(o.at)} ${R.pad(o.at.getHours())}:${R.pad(o.at.getMinutes())}`);

test('1º domingo de cada mês', () => {
  const r = { freq: 'monthly', monthMode: 'nth', nth: { pos: 1, kind: 'SU' } };
  assert.deepEqual(keys(R.occurrences(r, at('2026-11-15T10:00'), { limit: 4 })),
    ['2026-12-06 10:00', '2027-01-03 10:00', '2027-02-07 10:00', '2027-03-07 10:00']);
  assert.equal(R.describe(r, at('2026-11-15T10:00')), 'Todo mês, no 1º domingo');
});

test('última sexta-feira do mês', () => {
  const r = { freq: 'monthly', monthMode: 'nth', nth: { pos: -1, kind: 'FR' } };
  assert.deepEqual(keys(R.occurrences(r, at('2026-11-01T09:00'), { limit: 3 })), ['2026-11-27 09:00', '2026-12-25 09:00', '2027-01-29 09:00']);
  assert.equal(R.describe(r), 'Todo mês, na última sexta-feira');
});

test('5º dia útil considerando feriados (salário)', () => {
  const r = { freq: 'monthly', monthMode: 'nth', nth: { pos: 5, kind: 'businessday' } };
  // nov/2026: 2 (Finados) é feriado; dias úteis: 3,4,5,6,9 → 5º = 9
  // dez/2026: 1,2,3,4,7 → 7 ; jan/2027: 1 feriado; 4,5,6,7,8 → 8
  assert.deepEqual(keys(R.occurrences(r, at('2026-11-01T08:00'), { limit: 3 })), ['2026-11-09 08:00', '2026-12-07 08:00', '2027-01-08 08:00']);
});

test('último dia útil do mês', () => {
  const r = R.preset('monthlyLastBusiness');
  // jan/2027 termina num domingo (31) → sexta 29
  assert.deepEqual(keys(R.occurrences(r, at('2027-01-01T18:00'), { limit: 2 })), ['2027-01-29 18:00', '2027-02-26 18:00']);
});

test('todo dia 20, antecipando se não for dia útil (DAS)', () => {
  const r = { freq: 'monthly', monthMode: 'days', byMonthDay: [20], adjust: 'prev' };
  // 20/12/2026 é domingo → 18/12 (sexta); 20/02/2027 é sábado → 19/02; 20/11/2026 é feriado (sexta) → 19/11
  assert.deepEqual(keys(R.occurrences(r, at('2026-11-01T09:00'), { limit: 4 })), ['2026-11-19 09:00', '2026-12-18 09:00', '2027-01-20 09:00', '2027-02-19 09:00']);
  assert.match(R.describe(r), /antecipa/);
});

test('dias 10 e último dia do mês, a cada 2 meses', () => {
  const r = { freq: 'monthly', interval: 2, monthMode: 'days', byMonthDay: [10, -1] };
  assert.deepEqual(keys(R.occurrences(r, at('2027-01-05T07:00'), { limit: 4 })).map(s => s.slice(0, 10)), ['2027-01-10', '2027-01-31', '2027-03-10', '2027-03-31']);
});

test('dia 31 pula meses sem dia 31 (padrão iCalendar)', () => {
  const r = { freq: 'monthly', monthMode: 'same' };
  assert.deepEqual(keys(R.occurrences(r, at('2027-01-31T09:00'), { limit: 3 })).map(s => s.slice(0, 10)), ['2027-01-31', '2027-03-31', '2027-05-31']);
});

test('semanal em vários dias, a cada 2 semanas', () => {
  const r = { freq: 'weekly', interval: 2, byDay: ['MO', 'TH'] };
  // 16/11/2026 é segunda
  assert.deepEqual(keys(R.occurrences(r, at('2026-11-16T19:00'), { limit: 5 })).map(s => s.slice(0, 10)), ['2026-11-16', '2026-11-19', '2026-11-30', '2026-12-03', '2026-12-14']);
  assert.equal(R.describe(r), 'A cada 2 semanas: segunda e quinta');
});

test('dias úteis de segunda a sexta', () => {
  const r = R.preset('weekdays');
  assert.deepEqual(keys(R.occurrences(r, at('2026-11-13T08:00'), { limit: 3 })).map(s => s.slice(0, 10)), ['2026-11-13', '2026-11-16', '2026-11-17']);
});

test('anual: 2º domingo de maio (Dia das Mães)', () => {
  const r = { freq: 'yearly', byMonth: [5], monthMode: 'nth', nth: { pos: 2, kind: 'SU' } };
  assert.deepEqual(keys(R.occurrences(r, at('2026-11-15T09:00'), { limit: 2 })).map(s => s.slice(0, 10)), ['2027-05-09', '2028-05-14']);
  assert.equal(R.describe(r), 'Todo ano, no 2º domingo de maio');
});

test('anual em 29/02 só em anos bissextos', () => {
  const r = { freq: 'yearly' };
  assert.deepEqual(keys(R.occurrences(r, at('2028-02-29T09:00'), { limit: 2 })).map(s => s.slice(0, 10)), ['2028-02-29', '2032-02-29']);
});

test('trimestral no último dia útil (fim de trimestre)', () => {
  const r = { freq: 'yearly', byMonth: [3, 6, 9, 12], monthMode: 'nth', nth: { pos: -1, kind: 'businessday' } };
  assert.deepEqual(keys(R.occurrences(r, at('2026-11-15T09:00'), { limit: 3 })).map(s => s.slice(0, 10)), ['2026-12-31', '2027-03-31', '2027-06-30']);
});

test('término por quantidade e por data', () => {
  const c = { freq: 'daily', end: { type: 'count', count: 3 } };
  assert.equal(R.occurrences(c, at('2026-11-15T09:00'), { limit: 10 }).length, 3);
  const u = { freq: 'daily', end: { type: 'until', until: '2026-11-18' } };
  assert.equal(R.occurrences(u, at('2026-11-15T09:00'), { limit: 10 }).length, 4);
  // a contagem vale a partir da âncora, mesmo pedindo "depois de"
  assert.equal(R.nextOccurrence(c, at('2026-11-15T09:00'), at('2026-11-17T09:00')), null);
});

test('exceções (ocorrência pulada)', () => {
  const r = { freq: 'daily', exdates: ['2026-11-16'] };
  assert.deepEqual(keys(R.occurrences(r, at('2026-11-15T09:00'), { limit: 3 })).map(s => s.slice(0, 10)), ['2026-11-15', '2026-11-17', '2026-11-18']);
});

test('a cada 8 horas', () => {
  const r = { freq: 'hourly', interval: 8 };
  assert.deepEqual(keys(R.occurrences(r, at('2026-11-15T06:00'), { limit: 4 })), ['2026-11-15 06:00', '2026-11-15 14:00', '2026-11-15 22:00', '2026-11-16 06:00']);
});

test('repetir a partir da conclusão', () => {
  const r = { freq: 'daily', interval: 3, base: 'completion' };
  const n = R.nextFromCompletion(r, at('2026-11-01T07:30'), at('2026-11-15T21:00'));
  assert.equal(keys([n])[0], '2026-11-18 07:30');
  assert.equal(R.describe(r), '3 dias após a conclusão');
});

test('próxima ocorrência e feriados móveis', () => {
  assert.equal(R.holidayName(new Date(2027, 2, 26)), 'Sexta-feira Santa'); // Páscoa 2027 = 28/03
  assert.equal(R.holidayName(new Date(2027, 1, 8)), 'Carnaval');
  R.setHolidayOptions({ carnaval: false, extra: ['25/01'] });
  assert.equal(R.holidayName(new Date(2027, 1, 8)), null);
  assert.equal(R.holidayName(new Date(2027, 0, 25)), 'Feriado local');
  R.setHolidayOptions({ carnaval: true, extra: [] });
  const r = { freq: 'monthly', monthMode: 'nth', nth: { pos: 1, kind: 'SU' } };
  assert.equal(R.dateKey(R.nextOccurrence(r, at('2026-11-15T10:00'), at('2026-12-06T10:00')).at), '2027-01-03');
});

test('exportação RRULE', () => {
  assert.equal(R.toRRULE({ freq: 'monthly', monthMode: 'nth', nth: { pos: 1, kind: 'SU' } }, at('2026-11-15T10:00')), 'RRULE:FREQ=MONTHLY;BYDAY=1SU');
  assert.equal(R.toRRULE({ freq: 'weekly', interval: 2, byDay: ['MO'], end: { type: 'count', count: 5 } }, at('2026-11-16T10:00')), 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=5');
});

test('regras impossíveis não travam', () => {
  const r = { freq: 'yearly', byMonth: [2], monthMode: 'days', byMonthDay: [30] };
  assert.deepEqual(R.occurrences(r, at('2026-01-01T09:00'), { limit: 2 }), []);
});
