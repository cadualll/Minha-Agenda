// Servidor que imita o Supabase (auth, tabela items com "última alteração vence", storage)
// para testar a sincronização sem internet. Uso: node tests/mock-supabase.mjs <pasta www> [portaApp] [portaApi]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';

const WWW = resolve(process.argv[2] || 'app');
const APP_PORT = Number(process.argv[3] || 8080), API_PORT = Number(process.argv[4] || 54321);
const ANON = 'anon-test-key';
const users = { 'eu@teste.com': { id: randomUUID(), password: 'senha123' } };
const tokens = new Map(); // token -> userId
const items = new Map(); // id -> row
const objects = new Map(); // path -> {type, data}
const subs = new Map(), config = {};
let clock = Date.now();
const tick = () => new Date(Math.max(Date.now(), ++clock)).toISOString();
export const stats = { pushes: 0, pulls: 0 };

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,PATCH,OPTIONS' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { ...cors, 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const body = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const userOf = req => tokens.get((req.headers.authorization || '').replace('Bearer ', ''));
function session(uid, email) { const a = 'at-' + randomBytes(8).toString('hex'), rf = 'rt-' + randomBytes(8).toString('hex'); tokens.set(a, uid); tokens.set(rf, uid); return { access_token: a, refresh_token: rf, expires_in: 3600, user: { id: uid, email } }; }

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/__debug') return send(res, 200, { items: [...items.values()], objects: [...objects.keys()], stats, subs: [...subs.values()], config });
  if (!p.startsWith('/storage/v1/object/sign/') && !p.startsWith('/functions/') && req.headers.apikey !== ANON) return send(res, 401, { message: 'Invalid API key' });
  if (p === '/auth/v1/token') {
    const b = JSON.parse((await body(req)).toString() || '{}');
    if (url.searchParams.get('grant_type') === 'password') {
      const u = users[b.email]; if (!u || u.password !== b.password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return send(res, 200, session(u.id, b.email));
    }
    const uid = tokens.get(b.refresh_token); if (!uid) return send(res, 400, { error_description: 'Invalid Refresh Token' });
    const email = Object.entries(users).find(([, v]) => v.id === uid)[0];
    return send(res, 200, session(uid, email));
  }
  if (p === '/auth/v1/logout') return send(res, 204, '', 'text/plain');
  if (p === '/functions/v1/lembretes' && req.method === 'GET') return send(res, 200, { publicKey: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', fcm: true, agendador: !!config.function_url });
  const uid = userOf(req);
  const needsAuth = p.startsWith('/rest/v1/') || (p.startsWith('/storage/v1/') && !(req.method === 'GET' && p.startsWith('/storage/v1/object/sign/')));
  if (needsAuth && !uid) return send(res, 401, { message: 'JWT expired' });
  if (p === '/rest/v1/items' && req.method === 'GET') {
    stats.pulls++;
    const gt = (url.searchParams.get('server_updated_at') || 'gt.1970').slice(3);
    const lim = Number(url.searchParams.get('limit') || 1000);
    const rows = [...items.values()].filter(r => r.user_id === uid && r.server_updated_at > gt).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at)).slice(0, lim);
    return send(res, 200, rows.map(({ user_id, ...r }) => r));
  }
  if (p === '/rest/v1/items' && req.method === 'POST') {
    stats.pushes++;
    const rows = JSON.parse((await body(req)).toString());
    for (const r of rows) {
      const old = items.get(r.id);
      if (old && old.user_id !== uid) return send(res, 403, { message: 'new row violates row-level security policy' });
      if (old && r.updated_at < old.updated_at) continue; // gatilho "última alteração vence"
      items.set(r.id, { ...r, user_id: uid, server_updated_at: tick() });
    }
    return send(res, 201, '', 'text/plain');
  }
  if (p === '/rest/v1/push_subscriptions' && req.method === 'POST') { const b = JSON.parse((await body(req)).toString()); subs.set(b.endpoint, { ...b, user_id: uid }); return send(res, 201, '', 'text/plain'); }
  if (p === '/rest/v1/rpc/configurar_lembretes') { const b = JSON.parse((await body(req)).toString()); config.function_url = b.p_url + '/functions/v1/lembretes'; return send(res, 200, 'ok'); }
  if (p.startsWith('/storage/v1/object/sign/anexos/') && req.method === 'POST') {
    const path = decodeURI(p.slice('/storage/v1/object/sign/anexos/'.length));
    if (!path.startsWith(uid + '/') || !objects.has(path)) return send(res, 400, { message: 'Object not found' });
    const tok = randomBytes(6).toString('hex'); objects.get(path).tok = tok;
    return send(res, 200, { signedURL: `/object/sign/anexos/${encodeURI(path)}?token=${tok}` });
  }
  if (p.startsWith('/storage/v1/object/sign/anexos/') && req.method === 'GET') {
    const path = decodeURI(p.slice('/storage/v1/object/sign/anexos/'.length)); const o = objects.get(path);
    if (!o || o.tok !== url.searchParams.get('token')) return send(res, 400, { message: 'invalid signature' });
    return send(res, 200, o.data, o.type);
  }
  if (p.startsWith('/storage/v1/object/anexos/') && req.method === 'POST') {
    const path = decodeURI(p.slice('/storage/v1/object/anexos/'.length));
    if (!path.startsWith(uid + '/')) return send(res, 403, { message: 'new row violates row-level security policy' });
    const data = await body(req);
    if (data.length > 26214400) return send(res, 413, { message: 'Payload too large' });
    objects.set(path, { type: req.headers['content-type'], data });
    return send(res, 200, { Key: 'anexos/' + path });
  }
  if (p === '/storage/v1/object/anexos' && req.method === 'DELETE') {
    const { prefixes } = JSON.parse((await body(req)).toString());
    for (const x of prefixes) if (x.startsWith(uid + '/')) objects.delete(x);
    return send(res, 200, []);
  }
  send(res, 404, { message: 'not found ' + p });
}).listen(API_PORT, () => console.log('mock supabase em', API_PORT));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
http.createServer(async (req, res) => {
  let p = new URL(req.url, 'http://x').pathname; if (p.endsWith('/')) p += 'index.html';
  try { const data = await readFile(join(WWW, p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); }
  catch { res.writeHead(404); res.end('404'); }
}).listen(APP_PORT, () => console.log('app em', APP_PORT));
