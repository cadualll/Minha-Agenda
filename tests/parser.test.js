process.env.TZ = 'America/Sao_Paulo';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
const { parseTask } = await import('../app/js/parser.js');
const { describe } = await import('../app/js/recurrence.js');

const NOW = new Date('2026-11-15T14:00:00'); // domingo, 14h (horário de Brasília)
const local = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const P = s => parseTask(s, NOW);

test('casos que falhavam na versão anterior', () => {
  let r = P('Reunião sexta às 14h');
  assert.equal(r.title, 'Reunião'); assert.equal(local(r.dueAt), '2026-11-20 14:00'); assert.equal(r.recurrence, null);
  r = P('Revisar as 3 contas amanhã');
  assert.equal(r.title, 'Revisar as 3 contas'); assert.equal(local(r.dueAt), '2026-11-16 00:00'); assert.equal(r.allDay, true);
  r = P('Pagar DAS todo dia 20');
  assert.equal(r.title, 'Pagar DAS'); assert.equal(r.recurrence.freq, 'monthly'); assert.deepEqual(r.recurrence.byMonthDay, [20]);
  assert.equal(local(r.dueAt), '2026-11-20 00:00'); assert.equal(r.list, 'Financeiro');
  r = P('Comprar 2 pães a 5 reais');
  assert.equal(r.title, 'Comprar 2 pães a 5 reais'); assert.equal(r.dueAt, null);
  r = P('Dentista próxima terça 8h30');
  assert.equal(r.title, 'Dentista'); assert.equal(local(r.dueAt), '2026-11-17 08:30');
  r = P('Estudar daqui a 2 horas');
  assert.equal(r.title, 'Estudar'); assert.equal(local(r.dueAt), '2026-11-15 16:00'); assert.equal(r.allDay, false);
  r = P('Pagar fatura dia 31/11');
  assert.equal(r.dueAt, null); assert.match(r.warnings[0], /não existe/);
});

test('casos originais continuam funcionando', () => {
  let r = P('Amanhã às 9h revisar despesas');
  assert.equal(r.title, 'Revisar despesas'); assert.equal(local(r.dueAt), '2026-11-16 09:00');
  r = P('Pagar boleto dia 20/11 às 15h prioridade alta');
  assert.equal(r.title, 'Pagar boleto'); assert.equal(local(r.dueAt), '2026-11-20 15:00'); assert.equal(r.priority, 3);
  r = P('Todos os dias às 19h caminhar');
  assert.equal(r.title, 'Caminhar'); assert.equal(r.recurrence.freq, 'daily'); assert.equal(local(r.dueAt), '2026-11-15 19:00');
  r = P('Toda segunda às 9h conferir pagamentos');
  assert.equal(r.recurrence.freq, 'weekly'); assert.deepEqual(r.recurrence.byDay, ['MO']); assert.equal(local(r.dueAt), '2026-11-16 09:00');
});

test('recorrências avançadas', () => {
  let r = P('Reunião de condomínio todo primeiro domingo do mês às 10h');
  assert.equal(r.title, 'Reunião de condomínio');
  assert.deepEqual(r.recurrence.nth, { pos: 1, kind: 'SU' }); assert.equal(local(r.dueAt), '2026-12-06 10:00');
  r = P('Fechar folha no 5º dia útil');
  assert.deepEqual(r.recurrence.nth, { pos: 5, kind: 'businessday' }); assert.equal(r.title, 'Fechar folha');
  r = P('Backup toda última sexta do mês 18h');
  assert.deepEqual(r.recurrence.nth, { pos: -1, kind: 'FR' }); assert.equal(local(r.dueAt), '2026-11-27 18:00');
  r = P('Academia toda segunda, quarta e sexta às 7h');
  assert.deepEqual(r.recurrence.byDay, ['MO', 'WE', 'FR']); assert.equal(r.title, 'Academia');
  r = P('Remédio a cada 8 horas');
  assert.equal(r.recurrence.freq, 'hourly'); assert.equal(r.recurrence.interval, 8);
  r = P('Regar plantas a cada 3 dias após a conclusão');
  assert.equal(r.recurrence.base, 'completion'); assert.equal(r.title, 'Regar plantas');
  r = P('Pagar DAS todo dia 20 antecipando 9h');
  assert.equal(r.recurrence.adjust, 'prev'); assert.equal(local(r.dueAt), '2026-11-19 09:00'); // 20/11 é feriado
  r = P('Aniversário da Ana todo ano em 03/02');
  assert.equal(r.recurrence.freq, 'yearly'); assert.equal(local(r.dueAt), '2027-02-03 00:00');
  r = P('Revisar orçamento quinzenalmente');
  assert.equal(r.recurrence.interval, 2); assert.equal(r.recurrence.freq, 'weekly');
  r = P('Pilates toda terça 10 vezes');
  assert.equal(r.recurrence.end.count, 10);
  r = P('Relatório todo dia 10 e 25 até 31/12');
  assert.deepEqual(r.recurrence.byMonthDay, [10, 25]); assert.equal(r.recurrence.end.until, '2026-12-31');
  r = P('Fechamento todo último dia do mês');
  assert.equal(local(r.dueAt), '2026-11-30 00:00');
  assert.equal(describe(r.recurrence, r.dueAt), 'Todo mês, no último dia');
});

test('datas, prioridade, tags e lista', () => {
  let r = P('Ligar para o João às 10h hoje');
  assert.equal(r.title, 'Ligar para o João'); assert.equal(local(r.dueAt), '2026-11-15 10:00');
  r = P('Entregar declaração 30 de abril #irpf !alta ~Clientes');
  assert.equal(r.title, 'Entregar declaração'); assert.equal(local(r.dueAt), '2027-04-30 00:00');
  assert.deepEqual(r.tags, ['irpf']); assert.equal(r.priority, 3); assert.equal(r.list, 'Clientes');
  r = P('Almoço com Pedro ao meio-dia de amanhã');
  assert.equal(local(r.dueAt), '2026-11-16 12:00');
  r = P('Jantar sábado às 8 da noite');
  assert.equal(local(r.dueAt), '2026-11-21 20:00'); assert.equal(r.title, 'Jantar');
  r = P('Me lembre de tomar água às 8h');
  assert.equal(r.title, 'Tomar água'); assert.equal(local(r.dueAt), '2026-11-16 08:00');
  r = P('Pagar aluguel dia 5');
  assert.equal(local(r.dueAt), '2026-12-05 00:00');
  r = P('Revisar balanço ontem 9h');
  assert.equal(r.title, 'Revisar balanço'); assert.equal(local(r.dueAt), '2026-11-14 09:00');
  r = P('Organizar arquivos de clientes');
  assert.equal(r.dueAt, null); assert.equal(r.recurrence, null);
});
