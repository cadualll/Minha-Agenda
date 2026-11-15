// Busca local instantânea: índice invertido (palavra → tarefas) + trie (árvore de prefixos)
// para achar "pag" → pagar, pagamento. Ignora acentos e maiúsculas, tolera um erro de
// digitação e é atualizado aos poucos (só o que mudou é reindexado).

const STOP = new Set('a o os as de da do das dos e em no na nos nas um uma uns umas para pra por com que se ao aos the of'.split(' '));
export function normalize(s) { return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
export function tokenize(s) { return normalize(s).split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t)); }

// ---------- trie: vocabulário para busca por prefixo ----------
class Trie {
  constructor() { this.root = { c: new Map(), word: false }; this.count = 0; }
  add(w) {
    let n = this.root;
    for (const ch of w) { if (!n.c.has(ch)) n.c.set(ch, { c: new Map(), word: false }); n = n.c.get(ch); }
    if (!n.word) { n.word = true; this.count++; }
  }
  remove(w) {
    const path = [this.root]; let n = this.root;
    for (const ch of w) { n = n.c.get(ch); if (!n) return; path.push(n); }
    if (!n.word) return;
    n.word = false; this.count--;
    for (let i = w.length; i > 0; i--) { const node = path[i]; if (node.word || node.c.size) break; path[i - 1].c.delete(w[i - 1]); }
  }
  /** Palavras que começam com `p` (até `limit`), em ordem de tamanho. */
  prefix(p, limit = 300) {
    let n = this.root;
    for (const ch of p) { n = n.c.get(ch); if (!n) return []; }
    const out = [], queue = [[n, p]];
    while (queue.length && out.length < limit) { // largura primeiro: palavras curtas (mais prováveis) antes
      const [node, w] = queue.shift();
      if (node.word) out.push(w);
      for (const [ch, child] of node.c) queue.push([child, w + ch]);
    }
    return out;
  }
  *all(n = this.root, w = '') { if (n.word) yield w; for (const [ch, c] of n.c) yield* this.all(c, w + ch); }
}

function editDistanceAtMost1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; } else { i++; j++; } // inclui troca de letras vizinhas
  }
  return edits + (la - i) + (lb - j) <= 1;
}

// ---------- consulta: palavras, "frase exata", -excluir e operadores ----------
const PRIO = { nenhuma: 0, baixa: 1, media: 2, alta: 3 };
export function parseQuery(q) {
  const out = { terms: [], phrases: [], exclude: [], tags: [], lists: [], priority: [], status: null, recurring: null, has: [] };
  let s = String(q || '');
  s = s.replace(/"([^"]+)"/g, (_, ph) => { const n = tokenize(ph).join(' '); if (n) out.phrases.push(n); return ' '; });
  for (const raw of s.split(/\s+/).filter(Boolean)) {
    const low = normalize(raw);
    let m;
    if ((m = low.match(/^#([a-z0-9_-]+)$/))) out.tags.push(m[1]);
    else if ((m = low.match(/^(?:lista:|~)(.+)$/))) out.lists.push(m[1]);
    else if ((m = low.match(/^(?:prioridade:|!)(alta|media|baixa|nenhuma)$/))) out.priority.push(PRIO[m[1]]);
    else if ((m = low.match(/^status:(feitas?|concluidas?|pendentes?|abertas?)$/))) out.status = /^(feit|conclu)/.test(m[1]) ? 'done' : 'pending';
    else if (/^(repete|recorrentes?|tipo:recorrentes?)$/.test(low)) out.recurring = true;
    else if ((m = low.match(/^tem:(anexos?|subtarefas?|lembretes?|notas?)$/))) out.has.push(m[1].replace(/s$/, ''));
    else if (low.startsWith('-') && low.length > 1) out.exclude.push(...tokenize(low.slice(1)));
    else out.terms.push(...tokenize(raw));
  }
  return out;
}
export const hasTextQuery = p => !!(p.terms.length || p.phrases.length || p.exclude.length);

// ---------- índice ----------
export class SearchIndex {
  constructor() {
    this.post = new Map();   // palavra → Map(id → peso)
    this.docs = new Map();   // id → { version, tokens: Map(palavra → peso), text }
    this.trie = new Trie();
  }
  get size() { return this.docs.size; }
  get vocabulary() { return this.trie.count; }

  /** fields: [{ text, w }] — peso por campo (título vale mais que descrição). */
  upsert(id, fields, version) {
    const cur = this.docs.get(id);
    if (cur && version !== undefined && cur.version === version) return false;
    if (cur) this.remove(id);
    const tokens = new Map(); const texts = [];
    for (const { text, w } of fields) {
      if (!text) continue;
      texts.push(normalize(text));
      for (const t of tokenize(text)) tokens.set(t, Math.max(tokens.get(t) || 0, w));
    }
    for (const [t, w] of tokens) {
      let p = this.post.get(t);
      if (!p) { p = new Map(); this.post.set(t, p); this.trie.add(t); }
      p.set(id, w);
    }
    this.docs.set(id, { version, tokens, text: texts.join(' \u0001 ').replace(/[^a-z0-9\u0001]+/g, ' ') });
    return true;
  }
  remove(id) {
    const d = this.docs.get(id); if (!d) return false;
    for (const t of d.tokens.keys()) {
      const p = this.post.get(t); if (!p) continue;
      p.delete(id);
      if (!p.size) { this.post.delete(t); this.trie.remove(t); }
    }
    this.docs.delete(id);
    return true;
  }

  /** Palavras do vocabulário que casam com o termo: exata, prefixo ou (se nada) um erro de digitação. */
  expand(term) {
    const out = new Map();
    for (const w of this.trie.prefix(term)) out.set(w, w === term ? 1 : 0.75);
    if (!out.size && term.length >= 4) {
      for (const w of this.trie.all()) if (editDistanceAtMost1(term, w) || (w.length > term.length && editDistanceAtMost1(term, w.slice(0, term.length)))) out.set(w, 0.5);
    }
    return out;
  }

  /**
   * Retorna { scores: Map(id → relevância), matched: Set(palavras encontradas), fuzzy: bool }
   * ou null quando a consulta não tem texto (só operadores): aí "todas as tarefas" seguem para os filtros.
   */
  search(parsed) {
    const p = typeof parsed === 'string' ? parseQuery(parsed) : parsed;
    if (!hasTextQuery(p)) return null;
    let scores = null; const matched = new Set(); let fuzzy = false;
    for (const term of p.terms) {
      const exp = this.expand(term);
      const acc = new Map();
      for (const [w, factor] of exp) {
        if (factor === 0.5) fuzzy = true;
        matched.add(w);
        for (const [id, weight] of this.post.get(w) || []) acc.set(id, Math.max(acc.get(id) || 0, weight * factor));
      }
      if (scores === null) scores = acc;
      else { const next = new Map(); for (const [id, s] of scores) if (acc.has(id)) next.set(id, s + acc.get(id)); scores = next; }
      if (!scores.size) break;
    }
    if (scores === null) scores = new Map([...this.docs.keys()].map(id => [id, 1]));
    for (const ph of p.phrases) {
      for (const id of [...scores.keys()]) if (!this.docs.get(id).text.includes(ph)) scores.delete(id); else scores.set(id, scores.get(id) + 2);
      ph.split(' ').forEach(w => matched.add(w));
    }
    for (const ex of p.exclude) {
      const bad = new Set(); for (const w of this.trie.prefix(ex)) for (const id of (this.post.get(w) || new Map()).keys()) bad.add(id);
      for (const id of bad) scores.delete(id);
    }
    return { scores, matched, fuzzy };
  }
}

// ---------- destaque das palavras encontradas ----------
const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function highlight(text, matched) {
  const s = String(text ?? '');
  if (!matched?.size) return escHtml(s);
  let out = '', last = 0;
  for (const m of s.matchAll(/[\p{L}\p{N}]+/gu)) {
    const n = normalize(m[0]);
    if (matched.has(n)) { out += escHtml(s.slice(last, m.index)) + `<mark>${escHtml(m[0])}</mark>`; last = m.index + m[0].length; }
  }
  return out + escHtml(s.slice(last));
}
/** Trecho da descrição em volta da primeira palavra encontrada. */
export function snippet(text, matched, radius = 60) {
  const s = String(text ?? ''); if (!s || !matched?.size) return '';
  for (const m of s.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (matched.has(normalize(m[0]))) {
      const a = Math.max(0, m.index - radius), b = Math.min(s.length, m.index + m[0].length + radius);
      return (a ? '…' : '') + highlight(s.slice(a, b), matched) + (b < s.length ? '…' : '');
    }
  }
  return '';
}

/** Campos indexados de uma tarefa. */
export function taskFields(t, listName = '') {
  return [
    { text: t.title, w: 3 }, { text: (t.tags || []).join(' '), w: 3 }, { text: listName, w: 2 },
    { text: (t.subtasks || []).map(s => s.title).join(' '), w: 1.5 }, { text: t.notes, w: 1 },
    { text: (t.attachments || []).map(a => a.name).join(' '), w: 1 }
  ];
}
