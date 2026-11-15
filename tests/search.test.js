process.env.TZ = 'America/Sao_Paulo';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
const S = await import('../app/js/search.js');
const I = await import('../app/js/insights.js');

const T = (id, title, extra = {}) => ({ id, title, notes: '', tags: [], subtasks: [], attachments: [], priority: 0, done: false, reminders: [], ...extra });
function build(tasks) { const ix = new S.SearchIndex(); for (const t of tasks) ix.upsert(t.id, S.taskFields(t), t.v || 1); return ix; }
const ids = r => [...r.scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

const base = [
  T('1', 'Pagar DAS do Simples Nacional', { tags: ['impostos'], notes: 'Guia no portal do Simples' }),
  T('2', 'Pagamento do aluguel', { notes: 'Transferir para a imobiliária' }),
  T('3', 'Reunião com cliente Ácme', { subtasks: [{ title: 'Levar balanço patrimonial' }] }),
  T('4', 'Declaração de IRPF da Ana', { tags: ['irpf'], attachments: [{ name: 'informe-rendimentos.pdf' }] }),
  T('5', 'Comprar café', { notes: 'pagar com cartão' })
];

test('prefixo, acentos e relevância (título vale mais que descrição)', () => {
  const ix = build(base);
  assert.deepEqual(ids(ix.search('pag')), ['1', '2', '5']);     // pagar/pagamento no título antes de "pagar" na descrição
  assert.deepEqual(ids(ix.search('reuniao acme')), ['3']);       // sem acento acha com acento
  assert.deepEqual(ids(ix.search('BALANÇO')), ['3']);            // subtarefa
  assert.deepEqual(ids(ix.search('rendimentos')), ['4']);       // nome do anexo
  assert.deepEqual(ids(ix.search('imobiliaria')), ['2']);
});

test('erro de digitação, frase exata e exclusão', () => {
  const ix = build(base);
  const r = ix.search('declaracao irfp'); // letras trocadas
  assert.deepEqual(ids(r), ['4']); assert.equal(r.fuzzy, true);
  assert.deepEqual(ids(ix.search('"simples nacional"')), ['1']);
  assert.deepEqual(ids(ix.search('pag -aluguel')), ['1', '5']);
});

test('operadores viram filtros', () => {
  const p = S.parseQuery('#impostos lista:Financeiro !alta status:feitas repete tem:anexo boleto');
  assert.deepEqual(p.tags, ['impostos']); assert.deepEqual(p.lists, ['financeiro']); assert.deepEqual(p.priority, [3]);
  assert.equal(p.status, 'done'); assert.equal(p.recurring, true); assert.deepEqual(p.has, ['anexo']); assert.deepEqual(p.terms, ['boleto']);
  assert.equal(build(base).search('#impostos'), null); // só operadores: não filtra por texto
});

test('atualização incremental e remoção', () => {
  const ix = build(base);
  assert.equal(ix.upsert('2', S.taskFields(T('2', 'Pagamento do aluguel')), 1), false); // mesma versão: ignora
  ix.upsert('2', S.taskFields(T('2', 'Renovar contrato do aluguel')), 2);
  assert.deepEqual(ids(ix.search('pagamento')), []);
  assert.deepEqual(ids(ix.search('renov')), ['2']);
  ix.remove('2');
  assert.deepEqual(ids(ix.search('aluguel')), []);
  assert.equal(ix.trie.prefix('aluguel').length, 0, 'palavra sem uso sai da trie');
});

test('destaque e trecho', () => {
  const ix = build(base);
  const r = ix.search('pag');
  assert.equal(S.highlight('Pagar DAS do Simples', r.matched), '<mark>Pagar</mark> DAS do Simples');
  assert.match(S.snippet('Lembrar de pagar com cartão de crédito', r.matched), /<mark>pagar<\/mark>/);
  assert.equal(S.highlight('<b>x</b>', new Set(['x'])), '&lt;b&gt;<mark>x</mark>&lt;/b&gt;');
});

test('desempenho: 20 mil tarefas', () => {
  const words = 'pagar boleto reuniao cliente balanco fiscal folha imposto declaracao contrato aluguel compra relatorio auditoria ferias banco cartao viagem medico escola'.split(' ');
  const rnd = (i, k) => words[(i * 7 + k * 13) % words.length];
  const ix = new S.SearchIndex();
  const t0 = performance.now();
  for (let i = 0; i < 20000; i++) ix.upsert('t' + i, S.taskFields(T('t' + i, `${rnd(i, 1)} ${rnd(i, 2)} item${i}`, { notes: `${rnd(i, 3)} ${rnd(i, 4)} detalhe${i % 500}` })), 1);
  const build = performance.now() - t0;
  const t1 = performance.now();
  let total = 0; for (const q of ['pag', 'reuniao cli', 'item1999', 'detalhe42', 'audit -ferias', 'relatoro']) total += ix.search(q).scores.size;
  const q6 = (performance.now() - t1) / 6;
  console.log(`  índice: ${ix.size} tarefas, ${ix.vocabulary} palavras em ${build.toFixed(0)} ms; busca média ${q6.toFixed(2)} ms`);
  assert.ok(total > 0); assert.ok(q6 < 50, 'busca deve ser instantânea');
});

test('filtros combinados e faixas de tempo', () => {
  const now = new Date('2026-11-18T10:00:00'); // quarta
  const tasks = [
    T('a', 'Atrasada', { dueAt: '2026-11-16T12:00:00Z' }),
    T('b', 'Esta semana', { dueAt: '2026-11-22T12:00:00Z', priority: 3 }),               // domingo
    T('c', 'Semana que vem', { dueAt: '2026-11-24T12:00:00Z' }),
    T('d', 'Dezembro recorrente', { dueAt: '2026-12-10T12:00:00Z', recurrence: { freq: 'monthly' }, list: 'L1' }),
    T('e', 'Sem data', { list: 'L1' }),
    T('f', 'Feita', { dueAt: '2026-11-17T12:00:00Z', done: true, completedAt: '2026-11-17T13:00:00Z' })
  ];
  const run = c => tasks.filter(t => I.matchTask(t, { ...I.emptyCriteria(), ...c }, now)).map(t => t.id);
  assert.deepEqual(run({ time: ['overdue'] }), ['a']);
  assert.deepEqual(run({ time: ['week'] }), ['b']);
  assert.deepEqual(run({ time: ['nextMonth'] }), ['d']);
  assert.deepEqual(run({ time: ['overdue', 'week'] }), ['a', 'b']);       // mesma categoria: OU
  assert.deepEqual(run({ recurring: true }), ['d']);
  assert.deepEqual(run({ lists: ['L1'], time: ['nodate'] }), ['e']);         // categorias diferentes: E
  assert.deepEqual(run({ status: 'done' }), ['f']);
  assert.deepEqual(run({ status: 'all', priority: [3] }), ['b']);
});

test('indicadores: taxa de conclusão conta cada ocorrência das recorrentes', () => {
  const now = new Date('2026-11-18T10:00:00'); // quarta; semana = 16 a 22/11
  const tasks = [
    // recorrente diária: 16 e 17 concluídas (17 com atraso), ocorrência atual 18 às 09h ainda aberta
    T('r', 'Remédio', { dueAt: '2026-11-18T12:00:00Z', recurrence: { freq: 'daily' }, history: [
      { at: '2026-11-16T12:00:00Z', doneAt: '2026-11-16T12:05:00Z' }, { at: '2026-11-17T12:00:00Z', doneAt: '2026-11-18T09:00:00Z' }] }),
    T('s', 'Simples feita', { dueAt: '2026-11-16T15:00:00Z', done: true, completedAt: '2026-11-16T14:00:00Z' }),
    T('o', 'Atrasada alta', { dueAt: '2026-11-17T15:00:00Z', priority: 3 }),
    T('n', 'Futura', { dueAt: '2026-11-20T15:00:00Z' }),
    T('x', 'Antiga feita', { dueAt: '2026-11-01T15:00:00Z', done: true, completedAt: '2026-11-02T10:00:00Z' })
  ];
  const k = I.computeKpis(tasks, { now, period: 'week' });
  assert.equal(k.overdue, 2);                   // remédio de hoje 09h + atrasada
  assert.deepEqual(k.completion, { rate: 3 / 5, done: 3, total: 5, onTime: 2, onTimeRate: 2 / 3 });
  assert.equal(k.doneInPeriod, 3);
  assert.equal(k.streak, 1);                     // conclusões em 16 e 18 (nada em 17): sequência só de hoje
  assert.equal(k.critical[0].task.id, 'o'); assert.match(k.critical[0].reason, /^Atrasada há 1 dia/);
  assert.equal(k.load.reduce((s, d) => s + d.count, 0) >= 5, true); // repetições diárias entram na carga
});
