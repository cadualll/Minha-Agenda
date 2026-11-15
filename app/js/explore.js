// Telas de Busca avançada e Painel de indicadores.
import { esc, icon, relDay, cap } from './ui.js';
import { SearchIndex, parseQuery, hasTextQuery, taskFields, normalize } from './search.js';
import { emptyCriteria, matchTask, timeRanges, TIME_LABELS, activeFilterCount, computeKpis } from './insights.js';
import { PRIORITIES, sortTasks } from './tasks.js';
import { dateKey } from './recurrence.js';

// ---------- índice (montado aos poucos para não travar a tela) ----------
export const index = new SearchIndex();
export const searchState = { query: '', criteria: emptyCriteria(), sort: 'relevance', limit: 150, indexing: false, ready: false, lastMs: 0, filtersOpen: false, period: 'week', savedId: null };

function listNameOf(store, id) { return id ? (store.lists().find(l => l.id === id)?.name || '') : 'Caixa de entrada'; }
export function syncIndex(store, { onProgress } = {}) {
  const tasks = store.tasks();
  const present = new Set(tasks.map(t => t.id));
  for (const id of [...index.docs.keys()]) if (!present.has(id)) index.remove(id);
  const todo = tasks.filter(t => { const r = store.items[t.id]; const v = `${r?.updated_at}|${listNameOf(store, t.list)}`; return index.docs.get(t.id)?.version !== v; });
  if (todo.length < 400 || searchState.ready) { // poucas mudanças: na hora
    for (const t of todo) index.upsert(t.id, taskFields(t, listNameOf(store, t.list)), `${store.items[t.id]?.updated_at}|${listNameOf(store, t.list)}`);
    searchState.ready = true; return Promise.resolve();
  }
  // primeira montagem com muitas tarefas: em blocos, mostrando "Indexando…"
  searchState.indexing = true; onProgress?.();
  return new Promise(resolve => {
    let i = 0;
    const step = () => {
      const end = Math.min(todo.length, i + 400);
      for (; i < end; i++) { const t = todo[i]; index.upsert(t.id, taskFields(t, listNameOf(store, t.list)), `${store.items[t.id]?.updated_at}|${listNameOf(store, t.list)}`); }
      if (i < todo.length) setTimeout(step, 0); else { searchState.indexing = false; searchState.ready = true; onProgress?.(); resolve(); }
    };
    step();
  });
}

// ---------- execução da busca ----------
export function runSearch(store) {
  const t0 = performance.now();
  const parsed = parseQuery(searchState.query);
  const c = structuredClone(searchState.criteria);
  // operadores digitados somam-se aos filtros escolhidos nos botões
  if (parsed.status) c.status = parsed.status;
  if (parsed.recurring) c.recurring = true;
  c.priority = [...new Set([...c.priority, ...parsed.priority])];
  c.tags = [...new Set([...c.tags, ...parsed.tags])];
  c.has = [...new Set([...c.has, ...parsed.has])];
  if (parsed.lists.length) {
    const lists = store.lists();
    for (const name of parsed.lists) {
      if (/^(entrada|caixa)/.test(name)) { c.lists.push('__inbox'); continue; }
      const l = lists.find(x => normalize(x.name).startsWith(name)); if (l) c.lists.push(l.id);
    }
  }
  const text = index.search(parsed);
  const now = new Date(), R = timeRanges(now);
  let rows = store.tasks().filter(t => (!text || text.scores.has(t.id)) && matchTask(t, c, now, R));
  const s = searchState.sort === 'relevance' && !text ? 'due' : searchState.sort;
  if (s === 'relevance') rows.sort((a, b) => (text.scores.get(b.id) - text.scores.get(a.id)) || (b.priority - a.priority));
  else if (s === 'priority') rows.sort((a, b) => (b.priority - a.priority) || ((a.dueAt || '9') < (b.dueAt || '9') ? -1 : 1));
  else if (s === 'recent') rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  else rows = c.status === 'done' ? rows.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || '')) : sortTasks(rows);
  searchState.lastMs = performance.now() - t0;
  return { rows, matched: text?.matched || null, fuzzy: !!text?.fuzzy, hasText: hasTextQuery(parsed), effective: c };
}

// ---------- tela de busca ----------
function chip(label, on, data, extra = '') { return `<button class="fchip ${on ? 'on' : ''}" ${data} ${extra}>${label}</button>`; }
export function renderSearchView(h) {
  const { store, taskRow } = h;
  const c = searchState.criteria;
  if (searchState.indexing) return `<div class="loading-card"><i class="spin"></i><div><b>Preparando a busca…</b><small>Indexando ${store.tasks().length} tarefas. Leva só um instante.</small></div></div>`;
  const r = runSearch(store);
  const lists = [{ id: '__inbox', name: 'Caixa de entrada', color: '#9aa0b4' }, ...store.lists()];
  const tags = [...new Set(store.tasks().flatMap(t => t.tags))].sort((a, b) => a.localeCompare(b));
  const n = activeFilterCount(c);
  const saved = store.settings().savedFilters || [];
  const filters = `
    <div class="filters ${searchState.filtersOpen ? 'open' : ''}">
      <div class="fgroup"><span>Situação</span><div class="seg small">${[['pending', 'Pendentes'], ['done', 'Concluídas'], ['all', 'Todas']].map(([v, l]) => `<button class="${c.status === v ? 'on' : ''}" data-f="status" data-v="${v}">${l}</button>`).join('')}</div></div>
      <div class="fgroup"><span>Prazo</span>${Object.entries(TIME_LABELS).map(([k, l]) => chip(k === 'nextMonth' ? `${l} (${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('pt-BR', { month: 'long' })})` : l, c.time.includes(k), `data-f="time" data-v="${k}"`)).join('')}</div>
      <div class="fgroup"><span>Tipo</span>${chip(`${icon('repeat')} Recorrentes`, c.recurring === true, 'data-f="recurring" data-v="1"')}${chip('Sem repetição', c.recurring === false, 'data-f="recurring" data-v="0"')}</div>
      <div class="fgroup"><span>Prioridade</span>${[3, 2, 1, 0].map(p => chip(`<i class="pdot" style="--c:${PRIORITIES[p].color}"></i>${PRIORITIES[p].label}`, c.priority.includes(p), `data-f="priority" data-v="${p}"`)).join('')}</div>
      <div class="fgroup"><span>Listas</span>${lists.map(l => chip(`<i class="dot" style="--c:${esc(l.color)}"></i>${esc(l.name)}`, c.lists.includes(l.id), `data-f="lists" data-v="${esc(l.id)}"`)).join('')}</div>
      ${tags.length ? `<div class="fgroup"><span>Etiquetas</span>${tags.map(g => chip(`#${esc(g)}`, c.tags.includes(g), `data-f="tags" data-v="${esc(g)}"`)).join('')}</div>` : ''}
      <div class="fgroup"><span>Com</span>${[['anexo', 'Anexos'], ['subtarefa', 'Subtarefas'], ['lembrete', 'Lembrete'], ['nota', 'Descrição']].map(([v, l]) => chip(l, c.has.includes(v), `data-f="has" data-v="${v}"`)).join('')}</div>
    </div>`;
  const head = `
    <div class="search-bar">
      <button class="btn ghost sm filter-toggle" data-s="toggle-filters">${icon('flag')} Filtros${n ? ` <em class="badge">${n}</em>` : ''}</button>
      <select class="input sort" data-s="sort">${[['relevance', 'Relevância'], ['due', 'Data'], ['priority', 'Prioridade'], ['recent', 'Criadas recentemente']].map(([v, l]) => `<option value="${v}" ${searchState.sort === v ? 'selected' : ''}>Ordenar: ${l}</option>`).join('')}</select>
      ${n || searchState.query ? `<button class="btn ghost sm" data-s="clear">Limpar</button><button class="btn ghost sm" data-s="save">${icon('plus')} Salvar filtro</button>` : ''}
    </div>
    ${saved.length ? `<div class="saved-row">${saved.map(f => `<button class="fchip saved ${searchState.savedId === f.id ? 'on' : ''}" data-saved="${esc(f.id)}">${icon('sparkle')} ${esc(f.name)}</button>`).join('')}</div>` : ''}`;
  const help = !searchState.query && !n ? `<p class="hint">Dica: combine palavras com operadores — <code>#impostos</code>, <code>lista:trabalho</code>, <code>!alta</code>, <code>"frase exata"</code>, <code>-palavra</code> para excluir, <code>repete</code>, <code>tem:anexo</code>.</p>` : '';
  const shown = r.rows.slice(0, searchState.limit);
  const meta = `<div class="result-meta"><b>${r.rows.length}</b> ${r.rows.length === 1 ? 'tarefa' : 'tarefas'} <span class="muted">• ${searchState.lastMs < 1 ? '< 1' : searchState.lastMs.toFixed(0)} ms</span>${r.fuzzy ? ' <span class="pill warn">inclui resultados aproximados (erro de digitação)</span>' : ''}</div>`;
  const list = shown.length ? shown.map(t => taskRow(t, { matched: r.matched })).join('') + (r.rows.length > shown.length ? `<button class="btn ghost block" data-s="more">Mostrar mais ${Math.min(150, r.rows.length - shown.length)}</button>` : '')
    : `<div class="empty">${icon('search')}<h3>Nada encontrado</h3><p>Tente menos palavras ou tire algum filtro.</p></div>`;
  return head + filters + help + meta + `<div class="results">${list}</div>`;
}

export function handleSearchClick(el, h) {
  const c = searchState.criteria;
  if (el.dataset.f) {
    const f = el.dataset.f, v = el.dataset.v;
    if (f === 'status') c.status = v;
    else if (f === 'recurring') { const b = v === '1'; c.recurring = c.recurring === b ? null : b; }
    else { const val = f === 'priority' ? Number(v) : v; const arr = c[f]; const i = arr.indexOf(val); i >= 0 ? arr.splice(i, 1) : arr.push(val); }
    searchState.savedId = null; searchState.limit = 150; return true;
  }
  if (el.dataset.saved) {
    const f = (h.store.settings().savedFilters || []).find(x => x.id === el.dataset.saved); if (!f) return false;
    if (searchState.savedId === f.id) { searchState.savedId = null; searchState.criteria = emptyCriteria(); searchState.query = ''; }
    else { searchState.savedId = f.id; searchState.criteria = { ...emptyCriteria(), ...structuredClone(f.criteria) }; searchState.query = f.query || ''; }
    h.setSearchInput(searchState.query); return true;
  }
  const s = el.dataset.s;
  if (s === 'toggle-filters') { searchState.filtersOpen = !searchState.filtersOpen; return true; }
  if (s === 'clear') { searchState.criteria = emptyCriteria(); searchState.query = ''; searchState.savedId = null; h.setSearchInput(''); return true; }
  if (s === 'more') { searchState.limit += 150; return true; }
  if (s === 'save') { h.saveFilter(); return false; }
  return false;
}

// ---------- painel de indicadores ----------
const pct = v => v === null ? '—' : `${Math.round(v * 100)}%`;
function bars(series, { label, unit, today = null }) {
  const max = Math.max(1, ...series.map(s => s.count));
  return `<div class="bars" role="img" aria-label="${esc(label)}">${series.map(s => {
    const k = dateKey(s.date), wd = s.date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    const tip = `${cap(s.date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }))}: ${s.count} ${unit}`;
    return `<div class="bar-col ${k === today ? 'today' : ''}" data-tip="${esc(tip)}"><div class="bar-track"><i style="height:${(s.count / max) * 100}%"></i></div><small>${s.count || ''}</small><span>${series.length > 7 ? s.date.getDate() : wd}</span></div>`;
  }).join('')}</div>`;
}
export function renderDashboard(h) {
  const { store, listById } = h;
  const k = computeKpis(store.tasks(), { period: searchState.period });
  const loading = h.loading();
  const todayK = dateKey(new Date());
  const tile = (cls, ic, title, value, sub, crit) => `<button class="kpi ${cls}" ${crit ? `data-kpi="${crit}"` : ''}><span class="kpi-ico">${icon(ic)}</span><span class="kpi-title">${title}</span><b class="kpi-value">${value}</b><small>${sub}</small></button>`;
  const maxList = Math.max(1, ...k.byList.map(x => x.count));
  return `
    <div class="dash-head"><div class="seg small">${[['week', 'Esta semana'], ['month', 'Este mês'], ['30d', '30 dias']].map(([v, l]) => `<button class="${searchState.period === v ? 'on' : ''}" data-period="${v}">${l}</button>`).join('')}</div>
      ${loading ? '<span class="pill"><i class="spin sm"></i> Atualizando…</span>' : `<span class="muted small">Atualizado agora</span>`}</div>
    <div class="kpis ${loading ? 'is-loading' : ''}">
      ${tile(k.overdue ? 'crit' : 'good', k.overdue ? 'flag' : 'check', 'Atrasadas', k.overdue, k.overdue ? `${k.overdueHigh ? `${k.overdueHigh} de alta prioridade` : 'Toque para ver'}` : 'Nada atrasado', 'overdue')}
      ${tile('', 'sun', 'Para hoje', k.today, `${k.pending} pendentes no total`, 'today')}
      ${tile('accent', 'done', `Taxa de conclusão`, pct(k.completion.rate), k.completion.total ? `${k.completion.done} de ${k.completion.total} com prazo ${k.period.label}` : `Sem prazos ${k.period.label}`, '')}
      ${tile('', 'clock', 'No prazo', pct(k.completion.onTimeRate), k.completion.done ? `${k.completion.onTime} de ${k.completion.done} concluídas no dia` : 'Sem conclusões ainda', '')}
      ${tile('', 'check', 'Concluídas', k.doneInPeriod, k.period.label, 'done')}
      ${tile('', 'sparkle', 'Sequência', `${k.streak} dia${k.streak === 1 ? '' : 's'}`, k.streak ? 'seguidos concluindo algo' : 'Conclua algo hoje para começar', '')}
    </div>
    <div class="dash-grid">
      <section class="panel critical"><h4>${icon('flag')} Próximas demandas críticas</h4>
        ${k.critical.length ? k.critical.map(x => { const l = listById(x.task.list); return `<button class="crit-row ${x.overdue ? 'over' : ''}" data-open="${esc(x.task.id)}"><i class="pdot" style="--c:${PRIORITIES[x.task.priority].color}"></i><span class="crit-main"><b>${esc(x.task.title)}</b><small>${esc(x.reason)}${l ? ` • ${esc(l.name)}` : ''}</small></span><span class="crit-when">${esc(relDay(x.at))}</span></button>`; }).join('')
          : `<p class="muted">Nada crítico nos próximos 7 dias. 🎉</p>`}
      </section>
      <section class="panel"><h4>${icon('done')} Concluídas por dia <small>últimos 14 dias</small></h4>${bars(k.doneSeries, { label: 'Tarefas concluídas por dia nos últimos 14 dias', unit: 'concluída(s)', today: todayK })}</section>
      <section class="panel"><h4>${icon('week')} Carga dos próximos 7 dias <small>inclui repetições</small></h4>${bars(k.load, { label: 'Tarefas previstas por dia nos próximos 7 dias', unit: 'tarefa(s) prevista(s)', today: todayK })}</section>
      <section class="panel"><h4>${icon('list')} Pendentes por lista</h4>
        ${k.byList.length ? `<div class="hbars">${k.byList.map(x => { const l = x.list === '__inbox' ? { name: 'Caixa de entrada', color: '#9aa0b4' } : listById(x.list) || { name: 'Lista removida', color: '#9aa0b4' }; return `<button class="hbar" data-kpi-list="${esc(x.list)}" data-tip="${esc(l.name)}: ${x.count} pendente(s)"><span class="hbar-name"><i class="dot" style="--c:${esc(l.color)}"></i>${esc(l.name)}</span><span class="hbar-track"><i style="width:${(x.count / maxList) * 100}%"></i></span><b>${x.count}</b></button>`; }).join('')}</div>` : '<p class="muted">Nenhuma tarefa pendente.</p>'}
      </section>
    </div>`;
}
/** Clique num indicador → abre a busca já filtrada. */
export function kpiToCriteria(kind, listId) {
  const c = emptyCriteria();
  if (kind === 'overdue') c.time = ['overdue'];
  else if (kind === 'today') c.time = ['today'];
  else if (kind === 'done') c.status = 'done';
  if (listId) c.lists = [listId];
  return c;
}
