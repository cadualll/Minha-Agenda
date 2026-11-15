// Avisos pelo servidor (Web Push): o Supabase manda a notificação para este aparelho
// mesmo com a agenda fechada. Funciona no Chrome/Edge do Android e do PC (e no iPhone
// com o app adicionado à tela de início).
const FLAG = 'agenda.pushOn';
const fnUrl = store => `${store.config.url.replace(/\/+$/, '')}/functions/v1/lembretes`;
const flag = { get: () => { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } }, set: v => { try { v ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch { /* */ } } };
export const pushFlag = () => flag.get();

export function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in globalThis && 'Notification' in globalThis && globalThis.isSecureContext;
}
function b64ToU8(s) { const p = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(p + '='.repeat((4 - p.length % 4) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); }
function sameKey(sub, pub) {
  try { const a = new Uint8Array(sub.options.applicationServerKey), b = b64ToU8(pub); return a.length === b.length && a.every((x, i) => x === b[i]); } catch { return true; }
}
async function registration() {
  const reg = await navigator.serviceWorker.getRegistration() || await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  return reg;
}
async function saveSubscription(store, sub) {
  const j = sub.toJSON();
  const ua = navigator.userAgent;
  const device = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Navegador';
  await store.supa.raw('/rest/v1/push_subscriptions?on_conflict=endpoint', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device })
  });
}

export async function pushStatus() {
  if (!pushSupported()) return { supported: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, permission: Notification.permission, subscribed: !!sub && flag.get() };
}

/** Pede permissão, inscreve o aparelho e liga o agendador no Supabase. */
export async function enablePush(store) {
  if (!store.online) throw new Error('Entre na sua conta (sincronização) antes de ativar os avisos.');
  if (!pushSupported()) throw new Error('Este navegador não suporta avisos com o app fechado. No Android use o Chrome; no iPhone, adicione à Tela de Início primeiro.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão de notificação negada. Libere nas configurações do navegador/aparelho.');
  let res;
  try { res = await fetch(fnUrl(store)); } catch { throw new Error('Não consegui falar com a função "lembretes" do Supabase. Confira a internet.'); }
  if (!res.ok) throw new Error(res.status === 404 ? 'A função "lembretes" ainda não foi criada no Supabase (passo A6 do guia).' : res.status === 401 ? 'Desligue o "Verify JWT" da função "lembretes" no Supabase (passo A6 do guia).' : `A função "lembretes" respondeu com erro ${res.status}.`);
  const { publicKey } = await res.json();
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) { await sub.unsubscribe(); sub = null; }
  if (!sub) {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('O serviço de notificações do navegador não respondeu. Confira a internet e tente de novo.')), 25000));
    try { sub = await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) }), timeout]); }
    catch (e) {
      if (/permission|denied|NotAllowed/i.test(String(e?.message || e))) throw new Error('O navegador recusou o registro dos avisos. Confira se as notificações estão permitidas para este site (ícone ao lado do endereço) e se não é uma aba anônima.');
      throw e;
    }
  }
  await saveSubscription(store, sub);
  await store.supa.json('/rest/v1/rpc/configurar_lembretes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_url: store.config.url.replace(/\/+$/, '') }) });
  flag.set(true);
  return true;
}

/** Ao abrir o app: reenvia a inscrição (o navegador pode trocá-la de tempos em tempos). */
export async function refreshPush(store) {
  if (!store.online || !pushSupported() || Notification.permission !== 'granted' || !flag.get()) return;
  try {
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await saveSubscription(store, sub); else await enablePush(store);
  } catch (e) { console.warn('Avisos: não foi possível atualizar a inscrição', e); }
}

export async function disablePush(store) {
  flag.set(false);
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  try { await store.supa.raw(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }); } catch { /* sem internet: o servidor limpa depois */ }
  await sub.unsubscribe();
}

/** Pede ao servidor um aviso de teste para todos os seus aparelhos. */
export async function testServerPush(store) {
  const token = await store.supa.accessToken();
  const r = await fetch(fnUrl(store), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: store.config.key }, body: JSON.stringify({ acao: 'teste' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status} na função "lembretes".`);
  return j; // { enviados, aparelhos }
}
