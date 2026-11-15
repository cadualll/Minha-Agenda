// Minha Agenda IA — função "lembretes" (Supabase Edge Function).
// Roda a cada minuto (pg_cron) e envia as notificações para o celular e o PC via Web Push,
// mesmo com o app fechado. Não usa bibliotecas externas: a criptografia segue as normas
// RFC 8291 (conteúdo cifrado) e RFC 8292 (VAPID), com a Web Crypto do próprio Deno.
//
// Como instalar: Supabase → Edge Functions → Deploy a new function → Via Editor →
// nome "lembretes" → apague o exemplo, cole ESTE arquivo inteiro → Deploy →
// nos detalhes da função, DESLIGUE "Verify JWT" (a função tem a própria proteção).
// App Android: os avisos vão pelo Firebase Cloud Messaging; cadastre o segredo
// FIREBASE_SERVICE_ACCOUNT (Edge Functions → Secrets) com o JSON da conta de serviço.

// deno-lint-ignore-file no-explicit-any
const te = new TextEncoder();

// ---------------- utilidades base64url ----------------
export const b64u = {
  enc(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str: string): Uint8Array {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }
};
export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// ---------------- RFC 8291: cifra a mensagem para o navegador ----------------
export async function encryptPayload(plain: Uint8Array, p256dh: string, auth: string, opts: any = {}): Promise<Uint8Array> {
  const uaPublic = b64u.dec(p256dh), authSecret = b64u.dec(auth);
  const as = opts.asKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as any, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt: Uint8Array = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plain, new Uint8Array([2]))));
  const header = new Uint8Array(86);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, ct);
}

// ---------------- RFC 8292: identificação VAPID ----------------
export async function newVapidKeys(): Promise<{ publicKey: string; privateJwk: any }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64u.enc(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk: any = await crypto.subtle.exportKey('jwk', kp.privateKey);
  delete jwk.key_ops; delete jwk.ext;
  return { publicKey: pub, privateJwk: jwk };
}
export async function vapidHeader(endpoint: string, publicKey: string, privateJwk: any, subject = 'mailto:minha-agenda@example.com'): Promise<string> {
  const aud = new URL(endpoint).origin;
  const h = b64u.enc(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u.enc(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${h}.${c}`));
  return `vapid t=${h}.${c}.${b64u.enc(sig)}, k=${publicKey}`;
}
export async function sendWebPush(fetchFn: any, sub: any, message: any, vapid: any, ttl = 3600): Promise<number> {
  const body = await encryptPayload(te.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetchFn(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(ttl), Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      Authorization: await vapidHeader(sub.endpoint, vapid.publicKey, vapid.privateJwk)
    },
    body
  });
  return res.status;
}

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u.enc(await crypto.subtle.sign('HMAC', key, te.encode(text)));
}

// ---------------- Firebase Cloud Messaging (app Android) ----------------
function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
let googleToken: { token: string; exp: number } | null = null;
export async function googleAccessToken(fetchFn: any, sa: any, nowMs = Date.now()): Promise<string> {
  if (googleToken && googleToken.exp - 120_000 > nowMs) return googleToken.token;
  const iat = Math.floor(nowMs / 1000);
  const h = b64u.enc(te.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const c = b64u.enc(te.encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64u.enc(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, te.encode(`${h}.${c}`)));
  const r = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${h}.${c}.${sig}`
  });
  if (!r.ok) throw new Error(`Google OAuth ${r.status}: ${await r.text()}`);
  const j = await r.json();
  googleToken = { token: j.access_token, exp: nowMs + (j.expires_in || 3600) * 1000 };
  return googleToken.token;
}
export function resetGoogleToken() { googleToken = null; }
export async function sendFcm(fetchFn: any, sa: any, accessToken: string, token: string, msg: any): Promise<number> {
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries({ taskId: msg.taskId, subId: msg.subId, tag: msg.tag, title: msg.title, body: msg.body })) if (v != null) data[k] = String(v);
  const r = await fetchFn(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message: {
      token,
      notification: { title: msg.title, body: msg.body },
      data,
      android: { priority: 'HIGH', ttl: '3600s', notification: { channel_id: 'lembretes', tag: String(msg.tag || ''), sound: 'default', notification_priority: 'PRIORITY_HIGH', default_vibrate_timings: true } }
    } })
  });
  if (r.status === 404) return 410; // token não existe mais (app desinstalado)
  if (r.status === 400) { const t = await r.text(); return /registration token|UNREGISTERED|INVALID_ARGUMENT.*token/i.test(t) ? 410 : 400; }
  return r.status;
}

// ---------------- cálculo dos lembretes (mesma regra do app) ----------------
export function dueReminders(tasks: any[], settingsByUser: Map<string, any>, now: Date, windowMin = 20): any[] {
  const out: any[] = [];
  const from = now.getTime() - windowMin * 60_000, to = now.getTime();
  for (const row of tasks) {
    const t = row.data || {};
    if (t.done || !t.dueAt) continue;
    const st = settingsByUser.get(row.user_id) || {};
    const tz = st.timeZone || 'America/Sao_Paulo';
    const due = new Date(t.dueAt);
    if (!Number.isFinite(due.getTime())) continue;
    let base = due.getTime();
    if (t.allDay) {
      const [hh, mm] = String(st.allDayTime || '09:00').split(':').map(Number);
      base += ((hh || 0) * 60 + (mm || 0)) * 60_000; // dueAt de "dia inteiro" é a meia-noite local
    }
    for (const m of Array.isArray(t.reminders) ? t.reminders : []) {
      const when = base - Number(m) * 60_000;
      if (when > from && when <= to) out.push({ key: `${row.id}||${when}`, user_id: row.user_id, taskId: row.id, subId: null, title: t.title || 'Tarefa', body: bodyText(t, Number(m), due, tz) });
    }
    for (const s of Array.isArray(t.subtasks) ? t.subtasks : []) {
      if (s.done || !s.dueAt) continue;
      const when = new Date(s.dueAt).getTime();
      if (when > from && when <= to) out.push({ key: `${row.id}|${s.id}|${when}`, user_id: row.user_id, taskId: row.id, subId: s.id, title: s.title || 'Etapa', body: `Etapa de “${t.title}”` });
    }
  }
  return out;
}
function bodyText(t: any, m: number, due: Date, timeZone: string): string {
  let quando: string;
  try {
    quando = t.allDay ? due.toLocaleDateString('pt-BR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' })
      : due.toLocaleString('pt-BR', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { quando = due.toISOString(); }
  const lead = m === 0 ? (t.allDay ? 'Hoje' : 'Agora') : m < 60 ? `Em ${m} min` : m < 1440 ? `Em ${Math.round(m / 60)} h` : `Em ${Math.round(m / 1440)} dia(s)`;
  return `${lead} • ${quando}`;
}

// ---------------- acesso ao banco (PostgREST com a chave de serviço) ----------------
export function restDb(env: any, fetchFn: any) {
  const url = String(env.SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1';
  let key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key && env.SUPABASE_SECRET_KEYS) { try { const k = JSON.parse(env.SUPABASE_SECRET_KEYS); key = k.default || Object.values(k)[0]; } catch { /* */ } }
  const h = (extra: any = {}) => ({ apikey: key, ...(String(key).startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...extra });
  const q = (s: string) => encodeURIComponent(s);
  async function call(method: string, path: string, body?: any, prefer?: string) {
    const r = await fetchFn(url + path, { method, headers: h(prefer ? { Prefer: prefer } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(`Banco ${method} ${path.split('?')[0]}: ${r.status} ${await r.text()}`);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  const inList = (vals: string[]) => `(${vals.map(v => `"${String(v).replace(/"/g, '')}"`).join(',')})`;
  return {
    serviceKey: key,
    async getConfig(): Promise<Record<string, string>> {
      const rows = await call('GET', '/agenda_config?select=chave,valor');
      return Object.fromEntries((rows || []).map((r: any) => [r.chave, r.valor]));
    },
    async setConfigIfMissing(entries: Record<string, string>) {
      await call('POST', '/agenda_config?on_conflict=chave', Object.entries(entries).map(([chave, valor]) => ({ chave, valor })), 'resolution=ignore-duplicates,return=minimal');
    },
    getOpenTasks: () => call('GET', `/items?select=id,user_id,data&kind=eq.task&deleted=is.false&${q('data->>done')}=eq.false&${q('data->>dueAt')}=not.is.null`),
    getSettings: () => call('GET', '/items?select=user_id,data,updated_at&kind=eq.settings&deleted=is.false&order=updated_at.asc'),
    getSubs: (userId?: string) => call('GET', `/push_subscriptions?select=endpoint,user_id,p256dh,auth,kind${userId ? `&user_id=eq.${q(userId)}` : ''}`),
    deleteSubs: (endpoints: string[]) => endpoints.length ? call('DELETE', `/push_subscriptions?endpoint=in.${q(inList(endpoints))}`) : null,
    markSubsOk: (endpoints: string[], when: string) => endpoints.length ? call('PATCH', `/push_subscriptions?endpoint=in.${q(inList(endpoints))}`, { last_ok: when }, 'return=minimal') : null,
    // "Reserva" as chaves: só devolve as que ainda não tinham sido enviadas (evita duplicar).
    claim: async (keys: string[]): Promise<string[]> => {
      if (!keys.length) return [];
      const rows = await call('POST', '/push_sent?on_conflict=key', keys.map(key => ({ key })), 'resolution=ignore-duplicates,return=representation');
      return (rows || []).map((r: any) => r.key);
    },
    unclaim: (keys: string[]) => keys.length ? call('DELETE', `/push_sent?key=in.${q(inList(keys))}`) : null,
    cleanupSent: (beforeIso: string) => call('DELETE', `/push_sent?sent_at=lt.${q(beforeIso)}`),
    getQueue: (nowIso: string) => call('GET', `/push_queue?select=id,user_id,payload&sent_at=is.null&fire_at=lte.${q(nowIso)}`),
    markQueue: (ids: string[], when: string) => ids.length ? call('PATCH', `/push_queue?id=in.${q(inList(ids))}`, { sent_at: when }, 'return=minimal') : null,
    enqueue: (row: any) => call('POST', '/push_queue', row, 'return=minimal'),
    async userFromToken(token: string): Promise<string | null> {
      const r = await fetchFn(String(env.SUPABASE_URL).replace(/\/+$/, '') + '/auth/v1/user', { headers: { apikey: key, Authorization: `Bearer ${token}` } });
      if (!r.ok) return null; const u = await r.json(); return u?.id || null;
    }
  };
}

// ---------------- função principal ----------------
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (obj: any, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export function createHandler({ env, fetchFn = fetch, db = null as any, now = () => new Date() }: any) {
  const database = db || restDb(env, fetchFn);
  const fnUrl = String(env.SUPABASE_URL).replace(/\/+$/, '') + '/functions/v1/lembretes';
  let serviceAccount: any = null;
  try { if (env.FIREBASE_SERVICE_ACCOUNT) serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT); } catch { console.error('FIREBASE_SERVICE_ACCOUNT não é um JSON válido'); }

  async function vapidKeys(): Promise<{ publicKey: string; privateJwk: any; cfg: Record<string, string> }> {
    let cfg = await database.getConfig();
    if (!cfg.vapid_public || !cfg.vapid_private) {
      const k = await newVapidKeys();
      await database.setConfigIfMissing({ vapid_public: k.publicKey, vapid_private: JSON.stringify(k.privateJwk) });
      cfg = await database.getConfig(); // se duas chamadas criaram ao mesmo tempo, vale a que ficou gravada
    }
    return { publicKey: cfg.vapid_public, privateJwk: JSON.parse(cfg.vapid_private), cfg };
  }

  async function deliver(items: any[], vapid: any, secret: string) {
    // items: [{ user_id, msg }]
    const subs = await database.getSubs();
    const byUser = new Map<string, any[]>();
    for (const s of subs || []) { if (!byUser.has(s.user_id)) byUser.set(s.user_id, []); byUser.get(s.user_id)!.push(s); }
    const gone: string[] = [], ok = new Set<string>(), failedKeys: string[] = [];
    let sent = 0;
    for (const it of items) {
      const list = byUser.get(it.user_id) || [];
      let anyOk = false;
      const d = { u: it.user_id, t: it.msg.taskId, s: it.msg.subId || null, ti: it.msg.title, b: it.msg.body };
      const message = { ...it.msg, fn: fnUrl, snooze: { d, sig: await hmac(secret, JSON.stringify(d)) } };
      for (const s of list) {
        try {
          let status: number;
          if (s.kind === 'fcm') {
            if (!serviceAccount) { console.error('Aparelho Android cadastrado, mas falta o segredo FIREBASE_SERVICE_ACCOUNT.'); continue; }
            status = await sendFcm(fetchFn, serviceAccount, await googleAccessToken(fetchFn, serviceAccount, now().getTime()), s.endpoint.replace(/^fcm:/, ''), it.msg);
          } else status = await sendWebPush(fetchFn, s, message, vapid);
          if (status === 404 || status === 410) gone.push(s.endpoint);
          else if (status >= 200 && status < 300) { anyOk = true; ok.add(s.endpoint); sent++; }
          else console.error('push recusado', status, s.endpoint.slice(0, 60));
        } catch (e) { console.error('falha de envio', (e as Error).message); }
      }
      if (!anyOk && it.key && list.length) failedKeys.push(it.key);
    }
    await database.deleteSubs(gone);
    await database.markSubsOk([...ok], now().toISOString());
    return { sent, gone: gone.length, failedKeys };
  }

  async function runCron() {
    const t0 = now();
    const vapid = await vapidKeys();
    const [tasks, settingsRows] = await Promise.all([database.getOpenTasks(), database.getSettings()]);
    const settingsByUser = new Map<string, any>();
    for (const r of settingsRows || []) settingsByUser.set(r.user_id, r.data || {}); // ordenado: o último vence
    const due = dueReminders(tasks || [], settingsByUser, t0);
    const claimed = new Set(await database.claim(due.map(d => d.key)));
    const items = due.filter(d => claimed.has(d.key)).map(d => ({ key: d.key, user_id: d.user_id, msg: { title: d.title, body: d.body, tag: d.key, taskId: d.taskId, subId: d.subId } }));
    const queue = await database.getQueue(t0.toISOString());
    for (const q of queue || []) items.push({ key: null, user_id: q.user_id, msg: { ...q.payload, tag: `adiado-${q.id}` } });
    const r = items.length ? await deliver(items, vapid, vapid.cfg.cron_secret) : { sent: 0, gone: 0, failedKeys: [] };
    await database.unclaim(r.failedKeys); // tenta de novo no próximo minuto
    await database.markQueue((queue || []).map((q: any) => q.id), t0.toISOString());
    if (t0.getUTCMinutes() === 0) await database.cleanupSent(new Date(t0.getTime() - 7 * 86400_000).toISOString());
    return { lembretes: due.length, enviados: r.sent, removidas: r.gone };
  }

  return async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    try {
      if (req.method === 'GET') { const k = await vapidKeys(); return json({ publicKey: k.publicKey, fcm: !!serviceAccount, agendador: !!k.cfg.function_url }); }
      const body: any = await req.json().catch(() => ({}));
      const cfg = await database.getConfig();
      // 1) chamada do agendador (a cada minuto)
      const cronSecret = req.headers.get('x-cron-secret');
      if (cronSecret) {
        if (!cfg.cron_secret || cronSecret !== cfg.cron_secret) return json({ erro: 'não autorizado' }, 401);
        return json(await runCron());
      }
      // 2) "Adiar" tocado na notificação
      if (body.acao === 'adiar') {
        const d = body.d || {};
        if (!body.sig || body.sig !== await hmac(cfg.cron_secret, JSON.stringify(d))) return json({ erro: 'assinatura inválida' }, 401);
        const min = Math.max(5, Math.min(1440, Number(body.minutos) || 10));
        const at = new Date(now().getTime() + min * 60_000);
        const hora = at.toLocaleTimeString('pt-BR', { timeZone: body.tz || 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
        await database.enqueue({ user_id: d.u, fire_at: at.toISOString(), payload: { title: d.ti, body: `Adiado • ${hora}${d.b ? ' — ' + d.b : ''}`.slice(0, 300), taskId: d.t, subId: d.s } });
        return json({ ok: true, fireAt: at.toISOString() });
      }
      // 3) "Testar pelo servidor" no app (precisa estar logado)
      if (body.acao === 'teste') {
        const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
        const uid = token ? await database.userFromToken(token) : null;
        if (!uid) return json({ erro: 'faça login no app' }, 401);
        const vapid = await vapidKeys();
        const subs = await database.getSubs(uid);
        if (!subs?.length) return json({ enviados: 0, aparelhos: 0 });
        const r = await deliver([{ key: null, user_id: uid, msg: { title: 'Minha Agenda IA', body: 'Teste do servidor: os avisos estão chegando! 🎉', tag: 'teste', taskId: null, subId: null } }], vapid, vapid.cfg.cron_secret);
        return json({ enviados: r.sent, aparelhos: subs.length });
      }
      return json({ erro: 'requisição desconhecida' }, 400);
    } catch (e) {
      console.error(e);
      return json({ erro: (e as Error).message }, 500);
    }
  };
}

// Ponto de entrada no Supabase (Deno). Em testes (Node) esta parte é ignorada.
const D = (globalThis as any).Deno;
if (D?.serve) D.serve(createHandler({ env: D.env.toObject() }));
