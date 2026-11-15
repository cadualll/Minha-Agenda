// Armazenamento local (funciona offline) + sincronização com o Supabase.
import { Supa } from './supa.js';
import { cleanTask, DEFAULT_LISTS, uuid } from './tasks.js';

const K = { items: 'agenda.items', cursor: 'agenda.cursor', config: 'agenda.config', pendingDeletes: 'agenda.pendingDeletes', seeded: 'agenda.seeded' };
const nowIso = () => new Date().toISOString();
// localStorage pode estar indisponível (modo restrito); nesse caso usa memória.
export function safeStorage() {
  try { const s = globalThis.localStorage; s.setItem('__t', '1'); s.removeItem('__t'); return s; }
  catch { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
}

export class Store {
  constructor({ storage = safeStorage(), defaults = {} } = {}) {
    this.ls = storage;
    this.items = this.read(K.items, {});
    this.listeners = new Set();
    this.status = { state: 'local', lastSync: null, error: null };
    const cfg = this.read(K.config, {});
    this.config = { url: cfg.url || defaults.url || '', key: cfg.key || defaults.key || '' };
    this.supa = new Supa(this.config.url, this.config.key, storage);
    this.syncing = null;
    this.timer = null;
    if (this.supa.loggedIn) this.status.state = 'idle';
  }
  read(k, fb) { try { const v = this.ls.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
  write(k, v) { try { this.ls.setItem(k, JSON.stringify(v)); } catch (e) { console.error('Falha ao salvar localmente', e); this.emit('storage-error'); } }
  persist() { this.write(K.items, this.items); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason) { for (const fn of this.listeners) { try { fn(reason); } catch (e) { console.error(e); } } }

  // ---------- configuração e conta ----------
  get online() { return this.supa.configured && this.supa.loggedIn; }
  setConfig(url, key) {
    this.config = { url: String(url || '').trim(), key: String(key || '').trim() };
    this.write(K.config, this.config);
    this.supa = new Supa(this.config.url, this.config.key, this.ls);
  }
  async login(email, password) {
    await this.supa.signIn(email, password);
    // 1) Primeiro baixa o que já existe na nuvem.
    const rows = await this.supa.pull(null);
    const remoteIds = new Set(rows.map(r => r.id));
    const remoteListByName = new Map(rows.filter(r => r.kind === 'list' && !r.deleted).map(r => [String(r.data?.name || '').toLowerCase(), r.id]));
    // 2) Listas criadas só neste aparelho com o mesmo nome de uma lista da nuvem são unificadas
    //    (evita "Pessoal" duplicada quando o app é instalado num segundo aparelho).
    for (const [id, r] of Object.entries(this.items)) {
      if (r.kind !== 'list' || remoteIds.has(id)) continue;
      const twin = remoteListByName.get(String(r.data?.name || '').toLowerCase());
      if (!twin) continue;
      for (const t of Object.values(this.items)) if (t.kind === 'task' && t.data.list === id) { t.data.list = twin; t.updated_at = new Date().toISOString(); }
      delete this.items[id];
    }
    // 3) Junta: a versão mais recente de cada item vence; o que é só local sobe para a nuvem.
    for (const r of Object.values(this.items)) r.dirty = true;
    for (const r of rows) {
      const l = this.items[r.id];
      if (l && l.updated_at > r.updated_at) continue;
      this.items[r.id] = { id: r.id, kind: r.kind, data: r.data || {}, deleted: !!r.deleted, updated_at: r.updated_at, dirty: false };
    }
    this.write(K.cursor, null);
    this.persist();
    this.emit('change');
    await this.sync({ initial: true });
  }
  async logout({ wipe = false } = {}) {
    await this.sync().catch(() => {});
    await this.supa.signOut();
    if (wipe) { this.items = {}; this.persist(); this.ls.removeItem(K.seeded); }
    this.write(K.cursor, null);
    this.status = { state: 'local', lastSync: null, error: null };
    this.emit('logout');
  }

  // ---------- leitura ----------
  all(kind) { return Object.values(this.items).filter(r => r.kind === kind && !r.deleted).map(r => ({ ...r.data, id: r.id })); }
  tasks() { return this.all('task'); }
  lists() { return this.all('list').sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)); }
  task(id) { const r = this.items[id]; return r && !r.deleted && r.kind === 'task' ? { ...r.data, id } : null; }
  settings() {
    const rows = Object.values(this.items).filter(r => r.kind === 'settings' && !r.deleted).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return rows[0] ? { ...rows[0].data, id: rows[0].id } : { id: null };
  }

  // ---------- escrita ----------
  put(kind, data, { silent = false } = {}) {
    const id = data.id || uuid();
    const { id: _drop, ...rest } = data;
    const prev = this.items[id];
    // updated_at sempre cresce, mesmo que o relógio do aparelho volte no tempo.
    let ts = nowIso();
    if (prev && prev.updated_at >= ts) ts = new Date(new Date(prev.updated_at).getTime() + 1).toISOString();
    this.items[id] = { id, kind, data: rest, deleted: false, updated_at: ts, dirty: true };
    this.persist();
    if (!silent) { this.emit('change'); this.scheduleSync(); }
    return { ...rest, id };
  }
  remove(id) {
    const r = this.items[id]; if (!r) return;
    if (r.kind === 'task') for (const a of r.data.attachments || []) this.queueObjectDelete(a.path);
    let ts = nowIso(); if (r.updated_at >= ts) ts = new Date(new Date(r.updated_at).getTime() + 1).toISOString();
    this.items[id] = { ...r, deleted: true, updated_at: ts, dirty: true, data: r.kind === 'task' ? { title: r.data.title } : r.data };
    this.persist(); this.emit('change'); this.scheduleSync();
  }
  saveTask(t) { const old = t.id ? this.task(t.id) : null; return this.put('task', cleanTask(t, old || {})); }
  saveList(l) { return this.put('list', { name: String(l.name || 'Lista').trim().slice(0, 40), color: l.color || '#8b7cf6', order: l.order ?? Date.now(), id: l.id }); }
  saveSettings(patch) { const cur = this.settings(); return this.put('settings', { ...cur, ...patch, id: cur.id || undefined }); }
  queueObjectDelete(path) { if (!path) return; const q = this.read(K.pendingDeletes, []); q.push(path); this.write(K.pendingDeletes, q); }

  ensureDefaults() {
    // Só cria as listas padrão se nunca existiu nenhuma lista (nem apagada).
    if (Object.values(this.items).some(r => r.kind === 'list')) return;
    DEFAULT_LISTS.forEach((l, i) => this.put('list', { ...l, order: i }, { silent: true }));
    this.write(K.seeded, true);
    this.emit('change'); this.scheduleSync();
  }

  // ---------- sincronização ----------
  scheduleSync(delay = 1200) {
    if (!this.online) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync().catch(() => {}), delay);
  }
  async sync({ initial = false } = {}) {
    if (!this.online) return { skipped: true };
    if (this.syncing) { this.again = true; return this.syncing; }
    this.status = { ...this.status, state: 'syncing', error: null }; this.emit('status');
    this.syncing = (async () => {
      try {
        // 1) envia alterações locais
        const dirty = Object.values(this.items).filter(r => r.dirty);
        const snapshot = new Map(dirty.map(r => [r.id, r.updated_at]));
        await this.supa.push(dirty);
        for (const [id, ts] of snapshot) if (this.items[id]?.updated_at === ts) this.items[id].dirty = false;
        this.persist();
        // 2) apaga anexos pendentes
        const q = this.read(K.pendingDeletes, []);
        if (q.length) { try { await this.supa.removeObjects(q); this.write(K.pendingDeletes, []); } catch (e) { if (e.offline) throw e; this.write(K.pendingDeletes, []); } }
        // 3) recebe alterações remotas (com pequena sobreposição de segurança)
        const cursor = this.read(K.cursor, null);
        const since = cursor ? new Date(new Date(cursor).getTime() - 5000).toISOString() : null;
        const rows = await this.supa.pull(since);
        let changed = false, maxCursor = cursor;
        for (const r of rows) {
          if (!maxCursor || r.server_updated_at > maxCursor) maxCursor = r.server_updated_at;
          const l = this.items[r.id];
          if (l && l.dirty && l.updated_at > r.updated_at) continue; // a versão local é mais nova e ainda vai subir
          if (l && !l.dirty && l.updated_at === r.updated_at && l.deleted === r.deleted) continue;
          this.items[r.id] = { id: r.id, kind: r.kind, data: r.data || {}, deleted: !!r.deleted, updated_at: r.updated_at, dirty: false };
          changed = true;
        }
        this.purgeTombstones();
        this.persist();
        this.write(K.cursor, maxCursor);
        if (initial) this.ensureDefaults();
        this.status = { state: 'synced', lastSync: nowIso(), error: null };
        if (changed) this.emit('remote');
        return { pushed: dirty.length, pulled: rows.length };
      } catch (e) {
        this.status = { ...this.status, state: e.offline ? 'offline' : 'error', error: e.message };
        if (e.status === 401 && !this.supa.loggedIn) this.status.state = 'loggedout';
        throw e;
      } finally {
        this.syncing = null; this.emit('status');
        if (this.again) { this.again = false; this.scheduleSync(300); }
      }
    })();
    return this.syncing;
  }
  purgeTombstones() {
    const limit = new Date(Date.now() - 60 * 86400_000).toISOString();
    for (const [id, r] of Object.entries(this.items)) if (r.deleted && !r.dirty && r.updated_at < limit) delete this.items[id];
  }

  // ---------- backup ----------
  exportJSON() {
    return { app: 'Minha Agenda IA', version: 2, exportedAt: nowIso(), lists: this.lists(), tasks: this.tasks(), settings: this.settings() };
  }
  importJSON(obj) {
    const lists = Array.isArray(obj?.lists) ? obj.lists : [];
    const tasks = Array.isArray(obj?.tasks) ? obj.tasks : null;
    if (!tasks || tasks.length > 20000) throw new Error('Arquivo de backup inválido.');
    const byName = new Map(this.lists().map(l => [l.name.toLowerCase(), l.id]));
    const listMap = new Map();
    for (const l of lists) {
      const existing = byName.get(String(l.name || '').toLowerCase());
      listMap.set(l.id, existing || this.saveList({ ...l, id: this.items[l.id] ? undefined : l.id }).id);
    }
    let n = 0;
    for (const raw of tasks) {
      // Formato da versão 1 (servidor antigo): converte prioridade/lista/recorrência.
      const t = { ...raw };
      if (typeof t.priority === 'string') t.priority = { low: 1, normal: 0, high: 3 }[t.priority] ?? 0;
      if (typeof t.recurrence === 'string') t.recurrence = { none: null, daily: { freq: 'daily' }, weekdays: { freq: 'weekly', byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }, weekly: { freq: 'weekly' }, monthly: { freq: 'monthly' } }[t.recurrence] || null;
      if (t.recurrence?.freq === 'weekly' && !t.recurrence.byDay && t.dueAt) t.recurrence.byDay = [['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(t.dueAt).getDay()]];
      if (typeof t.reminderMinutes === 'number' && !t.reminders) t.reminders = [t.reminderMinutes];
      if (t.list && listMap.has(t.list)) t.list = listMap.get(t.list);
      else if (t.list && !this.items[t.list]) {
        const name = String(t.list); const id = byName.get(name.toLowerCase()) || this.saveList({ name }).id;
        byName.set(name.toLowerCase(), id); t.list = id;
      }
      if (t.dueAt && t.allDay === undefined) t.allDay = false;
      if (this.items[t.id] && this.items[t.id].kind === 'task') { /* mesma tarefa: atualiza em vez de duplicar */ }
      else if (t.id && !/^[0-9a-f-]{36}$/i.test(t.id)) delete t.id;
      this.put('task', cleanTask(t), { silent: true }); n++;
    }
    this.emit('change'); this.scheduleSync();
    return n;
  }
}
