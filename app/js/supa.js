// Cliente mínimo do Supabase usando apenas fetch (sem bibliotecas externas).
// Cobre: login por e-mail/senha, renovação de sessão, tabela "items" e bucket "anexos".

const SESSION_KEY = 'agenda.session';

export class Supa {
  constructor(url, anonKey, storage) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.key = anonKey;
    this.storage = storage;
    this.session = null;
    try { this.session = JSON.parse(storage?.getItem(SESSION_KEY) || 'null'); } catch { this.session = null; }
    this.refreshing = null;
  }
  get configured() { return !!(this.url && this.key); }
  get user() { return this.session?.user || null; }
  get loggedIn() { return !!this.session?.refresh_token; }

  saveSession(s) {
    this.session = s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600), user: s.user ? { id: s.user.id, email: s.user.email } : this.session?.user } : null;
    try { s ? this.storage.setItem(SESSION_KEY, JSON.stringify(this.session)) : this.storage.removeItem(SESSION_KEY); } catch { /* armazenamento indisponível */ }
  }

  async raw(path, { method = 'GET', headers = {}, body, auth = true, timeout = 30000 } = {}) {
    if (!this.configured) throw new SupaError('Sincronização não configurada.', 0);
    const h = { apikey: this.key, ...headers };
    if (auth) h.Authorization = `Bearer ${await this.accessToken()}`;
    let res;
    try {
      res = await fetch(this.url + path, { method, headers: h, body, signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined });
    } catch (e) {
      throw new SupaError('Sem conexão com o servidor de sincronização.', 0, true);
    }
    if (res.status === 401 && auth && this.session?.refresh_token) {
      await this.refresh(true);
      h.Authorization = `Bearer ${this.session.access_token}`;
      res = await fetch(this.url + path, { method, headers: h, body });
    }
    if (!res.ok) {
      let msg = `Erro ${res.status}`;
      try { const j = await res.json(); msg = j.msg || j.message || j.error_description || j.error || msg; } catch { /* corpo vazio */ }
      throw new SupaError(traduz(msg), res.status);
    }
    return res;
  }
  async json(path, opts) { const r = await this.raw(path, opts); const t = await r.text(); return t ? JSON.parse(t) : null; }

  // ---------- autenticação ----------
  async signIn(email, password) {
    const r = await this.json('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    this.saveSession(r);
    return this.user;
  }
  async refresh(force = false) {
    if (!this.session?.refresh_token) throw new SupaError('Faça login novamente.', 401);
    if (!force && this.session.expires_at - 60 > Date.now() / 1000) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const r = await this.json('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: this.session.refresh_token }) });
        this.saveSession(r);
      } catch (e) {
        if (e.status === 400 || e.status === 401) this.saveSession(null);
        throw e;
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
  async accessToken() {
    if (!this.session) throw new SupaError('Faça login para sincronizar.', 401);
    await this.refresh();
    return this.session.access_token;
  }
  async signOut() {
    try { if (this.session) await this.raw('/auth/v1/logout', { method: 'POST' }); } catch { /* ignora */ }
    this.saveSession(null);
  }

  // ---------- dados ----------
  async pull(sinceIso) {
    const out = [];
    let cursor = sinceIso || '1970-01-01T00:00:00Z';
    for (let page = 0; page < 50; page++) {
      const q = `/rest/v1/items?select=id,kind,data,deleted,updated_at,server_updated_at&server_updated_at=gt.${encodeURIComponent(cursor)}&order=server_updated_at.asc&limit=500`;
      const rows = await this.json(q);
      out.push(...rows);
      if (rows.length < 500) break;
      cursor = rows[rows.length - 1].server_updated_at;
    }
    return out;
  }
  async push(rows) {
    if (!rows.length) return;
    for (let i = 0; i < rows.length; i += 200) {
      await this.raw('/rest/v1/items?on_conflict=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 200).map(r => ({ id: r.id, kind: r.kind, data: r.data, deleted: !!r.deleted, updated_at: r.updated_at })))
      });
    }
  }

  // ---------- anexos ----------
  objectPath(taskId, attId, name) {
    const safe = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80) || 'arquivo';
    return `${this.user.id}/${taskId}/${attId}-${safe}`;
  }
  async upload(path, file, onProgress) {
    // XMLHttpRequest permite mostrar o progresso do envio.
    const token = await this.accessToken();
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', `${this.url}/storage/v1/object/anexos/${encodeURI(path)}`);
      x.setRequestHeader('apikey', this.key);
      x.setRequestHeader('Authorization', `Bearer ${token}`);
      x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      x.setRequestHeader('x-upsert', 'true');
      x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) return resolve(true);
        let msg = `Erro ${x.status}`; try { const j = JSON.parse(x.responseText); msg = j.message || j.error || msg; } catch { /* */ }
        reject(new SupaError(traduz(msg), x.status));
      };
      x.onerror = () => reject(new SupaError('Falha de rede ao enviar o anexo.', 0, true));
      x.send(file);
    });
  }
  async signedUrl(path, { download = null, expiresIn = 3600 } = {}) {
    const r = await this.json(`/storage/v1/object/sign/anexos/${encodeURI(path)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn }) });
    const rel = r.signedURL || r.signedUrl;
    let url = `${this.url}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
    if (download) url += `${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(download)}`;
    return url;
  }
  async removeObjects(paths) {
    if (!paths.length) return;
    await this.raw('/storage/v1/object/anexos', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) });
  }
}

export class SupaError extends Error {
  constructor(msg, status, offline = false) { super(msg); this.status = status; this.offline = offline; }
}

function traduz(msg) {
  const m = String(msg);
  if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(m)) return 'E-mail ainda não confirmado. No Supabase, marque o usuário como confirmado.';
  if (/payload too large|maximum allowed size|exceeded the maximum/i.test(m)) return 'Arquivo grande demais (máximo 25 MB).';
  if (/jwt expired/i.test(m)) return 'Sessão expirada. Entre novamente.';
  if (/row-level security/i.test(m)) return 'Permissão negada pelo servidor (confira se o script SQL foi executado).';
  if (/relation .*items.* does not exist|could not find the table/i.test(m)) return 'A tabela não existe no Supabase. Rode o arquivo supabase/schema.sql no SQL Editor.';
  if (/bucket not found/i.test(m)) return 'O espaço de anexos não existe. Rode o arquivo supabase/schema.sql no SQL Editor.';
  return m;
}
