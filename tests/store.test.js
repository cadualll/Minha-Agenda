process.env.TZ = 'America/Sao_Paulo';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
const { Store } = await import('../app/js/store.js');
const { completeTask } = await import('../app/js/tasks.js');
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

test('importa backup da versão 1 (servidor antigo)', () => {
  const s = new Store({ storage: mem() }); s.ensureDefaults();
  const n = s.importJSON({ tasks: [
    { id: 'abc', title: 'Conferir pagamentos', priority: 'high', recurrence: 'weekly', dueAt: '2026-11-16T12:00:00.000Z', reminderMinutes: 15, list: 'Financeiro', subtasks: [{ id: 's1', title: 'Banco', done: true }] },
    { title: 'Sem data', priority: 'normal', recurrence: 'none', list: 'Clientes' }
  ] });
  assert.equal(n, 2);
  const t = s.tasks().find(x => x.title === 'Conferir pagamentos');
  assert.equal(t.priority, 3); assert.deepEqual(t.recurrence.byDay, ['MO']); assert.deepEqual(t.reminders, [15]);
  assert.equal(s.lists().find(l => l.id === t.list).name, 'Financeiro');
  assert.ok(s.lists().some(l => l.name === 'Clientes'));
  assert.equal(s.lists().filter(l => l.name === 'Financeiro').length, 1);
});

test('conclusão de recorrente avança e guarda histórico', () => {
  const s = new Store({ storage: mem() });
  const t = s.saveTask({ title: 'DAS', dueAt: new Date('2026-11-19T12:00:00Z').toISOString(), allDay: false, recurrence: { freq: 'monthly', monthMode: 'days', byMonthDay: [20], adjust: 'prev' }, recurrenceAnchor: '2026-11-19T12:00:00.000Z', reminders: [0] });
  const r = completeTask(s.task(t.id), new Date('2026-11-19T15:00:00Z'));
  s.saveTask(r.task);
  const after = s.task(t.id);
  assert.equal(after.done, false); assert.equal(after.history.length, 1);
  assert.equal(new Date(after.dueAt).toISOString(), '2026-12-18T12:00:00.000Z'); // 20/12 é domingo → antecipa para sexta 18
});

test('exclusão vira "lápide" e some da lista', () => {
  const s = new Store({ storage: mem() });
  const t = s.saveTask({ title: 'Apagar' }); s.remove(t.id);
  assert.equal(s.tasks().length, 0); assert.equal(s.items[t.id].deleted, true); assert.equal(s.items[t.id].dirty, true);
});
