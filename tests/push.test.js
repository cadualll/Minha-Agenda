process.env.TZ = 'America/Sao_Paulo';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
const F = await import('../supabase/funcao-lembretes/index.ts');
const { b64u, concat, encryptPayload, newVapidKeys, vapidHeader, dueReminders, createHandler } = F;
const te = new TextEncoder(), td = new TextDecoder();

// Vetores do Apêndice A da RFC 8291
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
};
async function importEcdhPair(pubB64, privB64) {
  const pub = b64u.dec(pubB64);
  const jwk = { kty: 'EC', crv: 'P-256', d: privB64, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)) };
  return {
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
  };
}
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
// Decifra como o navegador faria (lado do receptor), para conferir o que a função envia.
async function decrypt(body, uaPubB64, uaPrivB64, authB64) {
  const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const ua = await importEcdhPair(uaPubB64, uaPrivB64);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(b64u.dec(authB64), ecdh, concat(te.encode('WebPush: info\0'), b64u.dec(uaPubB64), asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  return td.decode(plain.slice(0, plain.lastIndexOf(2)));
}

test('cifragem idêntica ao exemplo oficial da RFC 8291 (Apêndice A)', async () => {
  const asKeys = await importEcdhPair(RFC.asPublic, RFC.asPrivate);
  const out = await encryptPayload(b64u.dec(RFC.plaintext), RFC.uaPublic, RFC.auth, { asKeys, salt: b64u.dec(RFC.salt) });
  assert.equal(b64u.enc(out), RFC.body);
  assert.equal(await decrypt(out, RFC.uaPublic, RFC.uaPrivate, RFC.auth), 'When I grow up, I want to be a watermelon');
});

test('cabeçalho VAPID (RFC 8292) com assinatura ES256 válida', async () => {
  const k = await newVapidKeys();
  const h = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', k.publicKey, k.privateJwk);
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m);
  const claims = JSON.parse(td.decode(b64u.dec(m[2])));
  assert.equal(claims.aud, 'https://fcm.googleapis.com'); assert.ok(claims.exp > Date.now() / 1000);
  const pub = await crypto.subtle.importKey('raw', b64u.dec(m[4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64u.dec(m[3]), te.encode(`${m[1]}.${m[2]}`)));
});

test('quais lembretes vencem neste minuto (horário, dia inteiro, subtarefas, concluídas)', () => {
  const now = new Date('2026-11-16T12:00:30Z'); // 09:00:30 em Brasília
  const tasks = [
    { id: 'a', user_id: 'u', data: { title: 'Reunião', dueAt: '2026-11-16T12:15:00Z', reminders: [15, 60] } },        // 15 min antes = 12:00Z ✔
    { id: 'b', user_id: 'u', data: { title: 'DAS', dueAt: '2026-11-16T03:00:00Z', allDay: true, reminders: [0] } },    // meia-noite local + 09:00 ✔
    { id: 'c', user_id: 'u', data: { title: 'Feita', dueAt: '2026-11-16T12:00:00Z', reminders: [0], done: true } },
    { id: 'd', user_id: 'u', data: { title: 'Velha', dueAt: '2026-11-16T10:00:00Z', reminders: [0] } },                // 2 h atrás: fora da janela
    { id: 'e', user_id: 'u', data: { title: 'Mãe', dueAt: '2026-11-20T12:00:00Z', reminders: [], subtasks: [{ id: 's1', title: 'Comprar flores', dueAt: '2026-11-16T11:59:00Z' }] } }
  ];
  const r = dueReminders(tasks, new Map([['u', { allDayTime: '09:00', timeZone: 'America/Sao_Paulo' }]]), now);
  assert.deepEqual(r.map(x => x.title).sort(), ['Comprar flores', 'DAS', 'Reunião']);
  assert.match(r.find(x => x.title === 'Reunião').body, /^Em 15 min • seg\., 16\/11/);
  assert.match(r.find(x => x.title === 'DAS').body, /^Hoje • segunda-feira/);
});

test('função completa: agendador envia, não duplica, adiar e teste funcionam', async () => {
  // aparelho "falso" com chaves reais de navegador
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = b64u.enc(await crypto.subtle.exportKey('raw', ua.publicKey));
  const uaPriv = (await crypto.subtle.exportKey('jwk', ua.privateKey)).d;
  const authSecret = b64u.enc(crypto.getRandomValues(new Uint8Array(16)));
  // banco em memória
  const mem = { config: { cron_secret: 'segredo-teste' }, sent: new Set(), queue: [], subs: [{ endpoint: 'https://push.exemplo.com/abc', user_id: 'u1', p256dh: uaPub, auth: authSecret }, { endpoint: 'https://push.exemplo.com/velho', user_id: 'u1', p256dh: uaPub, auth: authSecret }] };
  const db = {
    getConfig: async () => ({ ...mem.config }), setConfigIfMissing: async e => { for (const [k, v] of Object.entries(e)) mem.config[k] ??= v; },
    getOpenTasks: async () => [{ id: 't1', user_id: 'u1', data: { title: 'Pagar DAS', dueAt: '2026-11-19T12:00:00Z', reminders: [0], done: false } }],
    getSettings: async () => [{ user_id: 'u1', data: { timeZone: 'America/Sao_Paulo' } }],
    getSubs: async uid => mem.subs.filter(s => !uid || s.user_id === uid),
    deleteSubs: async eps => { mem.subs = mem.subs.filter(s => !eps.includes(s.endpoint)); }, markSubsOk: async () => {},
    claim: async keys => keys.filter(k => !mem.sent.has(k) && mem.sent.add(k)), unclaim: async keys => keys.forEach(k => mem.sent.delete(k)), cleanupSent: async () => {},
    getQueue: async nowIso => mem.queue.filter(q => !q.sent_at && q.fire_at <= nowIso), markQueue: async (ids, w) => mem.queue.forEach(q => { if (ids.includes(q.id)) q.sent_at = w; }),
    enqueue: async row => mem.queue.push({ id: 'q' + mem.queue.length, ...row }), userFromToken: async tok => tok === 'jwt-ok' ? 'u1' : null
  };
  const delivered = [];
  const fetchFn = async (url, init) => {
    if (url.endsWith('/velho')) return { status: 410 };
    assert.equal(init.headers['Content-Encoding'], 'aes128gcm'); assert.match(init.headers.Authorization, /^vapid t=/);
    delivered.push(JSON.parse(await decrypt(init.body, uaPub, uaPriv, authSecret)));
    return { status: 201 };
  };
  let clock = new Date('2026-11-19T12:00:20Z');
  const handler = createHandler({ env: { SUPABASE_URL: 'https://proj.supabase.co' }, fetchFn, db, now: () => clock });
  const cron = () => handler(new Request('https://x/lembretes', { method: 'POST', headers: { 'x-cron-secret': 'segredo-teste' }, body: '{}' })).then(r => r.json());

  // chave pública para o app
  const pk = await (await handler(new Request('https://x/lembretes'))).json();
  assert.equal(b64u.dec(pk.publicKey).length, 65);
  // segredo errado é recusado
  assert.equal((await handler(new Request('https://x/lembretes', { method: 'POST', headers: { 'x-cron-secret': 'errado' }, body: '{}' }))).status, 401);

  let r = await cron();
  assert.equal(r.enviados, 1); assert.equal(r.removidas, 1);
  assert.equal(delivered[0].title, 'Pagar DAS'); assert.equal(delivered[0].taskId, 't1'); assert.match(delivered[0].body, /^Agora/);
  assert.equal(delivered[0].fn, 'https://proj.supabase.co/functions/v1/lembretes');
  assert.equal(mem.subs.length, 1, 'inscrição expirada (410) removida');
  r = await cron(); // mesmo minuto de novo: não duplica
  assert.equal(r.enviados, 0); assert.equal(delivered.length, 1);

  // "Adiar 10 min" pela notificação (sem login, com assinatura)
  const sn = delivered[0].snooze;
  let resp = await handler(new Request('https://x/lembretes', { method: 'POST', body: JSON.stringify({ acao: 'adiar', minutos: 10, d: sn.d, sig: sn.sig }) }));
  assert.equal(resp.status, 200);
  resp = await handler(new Request('https://x/lembretes', { method: 'POST', body: JSON.stringify({ acao: 'adiar', minutos: 10, d: { ...sn.d, u: 'outro' }, sig: sn.sig }) }));
  assert.equal(resp.status, 401, 'assinatura adulterada é recusada');
  clock = new Date('2026-11-19T12:10:40Z');
  r = await cron();
  assert.equal(r.enviados, 1); assert.match(delivered[1].body, /^Adiado • 09:10/);
  r = await cron(); assert.equal(r.enviados, 0, 'adiamento enviado só uma vez');

  // teste pelo servidor
  resp = await handler(new Request('https://x/lembretes', { method: 'POST', headers: { authorization: 'Bearer jwt-ok' }, body: JSON.stringify({ acao: 'teste' }) }));
  assert.deepEqual(await resp.json(), { enviados: 1, aparelhos: 1 });
  resp = await handler(new Request('https://x/lembretes', { method: 'POST', headers: { authorization: 'Bearer ruim' }, body: JSON.stringify({ acao: 'teste' }) }));
  assert.equal(resp.status, 401);
});

test('consultas ao banco usam a sintaxe do PostgREST', async () => {
  const calls = [];
  const fetchFn = async (url, init) => { calls.push([init.method, decodeURIComponent(url), init.headers]); return { ok: true, text: async () => '[]' }; };
  const db = F.restDb({ SUPABASE_URL: 'https://p.supabase.co/', SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_x' }) }, fetchFn);
  await db.getOpenTasks(); await db.claim(['t1||123']); await db.deleteSubs(['https://a/b']); await db.getQueue('2026-11-19T12:00:00.000Z');
  assert.equal(calls[0][1], 'https://p.supabase.co/rest/v1/items?select=id,user_id,data&kind=eq.task&deleted=is.false&data->>done=eq.false&data->>dueAt=not.is.null');
  assert.equal(calls[0][2].apikey, 'sb_secret_x'); assert.equal(calls[0][2].Authorization, undefined);
  assert.equal(calls[1][1], 'https://p.supabase.co/rest/v1/push_sent?on_conflict=key'); assert.match(calls[1][2].Prefer, /ignore-duplicates,return=representation/);
  assert.equal(calls[2][1], 'https://p.supabase.co/rest/v1/push_subscriptions?endpoint=in.("https://a/b")');
  assert.equal(calls[3][1], 'https://p.supabase.co/rest/v1/push_queue?select=id,user_id,payload&sent_at=is.null&fire_at=lte.2026-11-19T12:00:00.000Z');
});

test('app Android: envio pelo Firebase (FCM v1) com conta de serviço', async () => {
  F.resetGoogleToken();
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = b64u.enc(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).replace(/-/g, '+').replace(/_/g, '/');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const sa = { project_id: 'minha-agenda-123', client_email: 'firebase-adminsdk@minha-agenda-123.iam.gserviceaccount.com', private_key: pem };
  const mem = { sent: new Set(), subs: [{ endpoint: 'fcm:TOKEN-BOM', user_id: 'u1', kind: 'fcm' }, { endpoint: 'fcm:TOKEN-VELHO', user_id: 'u1', kind: 'fcm' }] };
  const db = {
    getConfig: async () => ({ cron_secret: 's', vapid_public: (await newVapidKeys()).publicKey, vapid_private: JSON.stringify((await newVapidKeys()).privateJwk) }),
    setConfigIfMissing: async () => {}, getSettings: async () => [], getQueue: async () => [], markQueue: async () => {}, cleanupSent: async () => {}, unclaim: async () => {},
    getOpenTasks: async () => [{ id: 't9', user_id: 'u1', data: { title: 'Reunião com cliente', dueAt: '2026-11-19T17:00:00Z', reminders: [0], done: false } }],
    getSubs: async () => mem.subs, deleteSubs: async eps => { mem.subs = mem.subs.filter(s => !eps.includes(s.endpoint)); }, markSubsOk: async () => {},
    claim: async keys => keys.filter(k => !mem.sent.has(k) && mem.sent.add(k))
  };
  const fcmCalls = []; let oauthCalls = 0;
  const fetchFn = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      oauthCalls++;
      const jwt = new URLSearchParams(init.body).get('assertion').split('.');
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey, b64u.dec(jwt[2]), te.encode(`${jwt[0]}.${jwt[1]}`));
      const claims = JSON.parse(td.decode(b64u.dec(jwt[1])));
      assert.ok(ok, 'assinatura RS256 válida'); assert.equal(claims.iss, sa.client_email); assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
      return { ok: true, json: async () => ({ access_token: 'ya29.token', expires_in: 3599 }) };
    }
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/minha-agenda-123/messages:send');
    assert.equal(init.headers.Authorization, 'Bearer ya29.token');
    const m = JSON.parse(init.body).message; fcmCalls.push(m);
    if (m.token === 'TOKEN-VELHO') return { status: 404, text: async () => '{"error":{"status":"NOT_FOUND"}}' };
    return { status: 200, text: async () => '{}' };
  };
  const handler = createHandler({ env: { SUPABASE_URL: 'https://proj.supabase.co', FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) }, fetchFn, db, now: () => new Date('2026-11-19T17:00:10Z') });
  const r = await (await handler(new Request('https://x/lembretes', { method: 'POST', headers: { 'x-cron-secret': 's' }, body: '{}' }))).json();
  assert.equal(r.enviados, 1); assert.equal(r.removidas, 1);
  assert.equal(oauthCalls, 1);
  const m = fcmCalls.find(x => x.token === 'TOKEN-BOM');
  assert.equal(m.notification.title, 'Reunião com cliente'); assert.match(m.notification.body, /^Agora • qui\., 19\/11/);
  assert.equal(m.android.priority, 'HIGH'); assert.equal(m.android.notification.channel_id, 'lembretes');
  assert.equal(m.data.taskId, 't9'); assert.equal(typeof m.data.tag, 'string');
  assert.deepEqual(mem.subs.map(s => s.endpoint), ['fcm:TOKEN-BOM']);
});
