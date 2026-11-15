// Notificações.
// • App Android: os avisos chegam pelo servidor (Supabase → Firebase), que sempre conhece a
//   versão mais recente das tarefas (inclusive as criadas/alteradas no PC). Alarmes locais do
//   próprio celular cobrem só o que ainda não subiu para a nuvem (ex.: criado sem internet)
//   e os "adiar". Se o servidor não estiver configurado, todos os avisos viram alarmes locais.
// • Navegador (PC): Web Push pelo servidor (push.js) + aviso local enquanto a aba estiver aberta.
import { reminderInstants, notifId } from './tasks.js';
import { pushFlag } from './push.js';

const cap = () => globalThis.Capacitor;
export const isNative = () => !!cap()?.isNativePlatform?.();
const LN = () => cap()?.Plugins?.LocalNotifications;
const FIRED_KEY = 'agenda.firedNotifs';
let webTimer = null, webPlan = [], handlers = { open: () => {}, alert: () => {}, complete: () => {}, snooze: () => {} };
const PN = () => cap()?.Plugins?.PushNotifications;
const SERVER_KEY = 'agenda.serverPush';
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* */ } } };
/** true quando o servidor está pronto para avisar este celular (Firebase + agendador). */
export const serverPushActive = () => isNative() && ls.get(SERVER_KEY) === '1';

export async function initNotifications(h) {
  handlers = { ...handlers, ...h };
  if (isNative() && LN()) {
    const ln = LN();
    try {
      await ln.createChannel({ id: 'lembretes', name: 'Lembretes de tarefas', description: 'Avisos das suas tarefas', importance: 5, visibility: 1, vibration: true, lights: true });
    } catch (e) { console.warn('canal', e); }
    try {
      await ln.registerActionTypes({ types: [{ id: 'TAREFA', actions: [{ id: 'concluir', title: '✓ Concluir' }, { id: 'adiar', title: 'Adiar 10 min' }, { id: 'adiar60', title: 'Adiar 1 h' }] }] });
    } catch (e) { console.warn('ações', e); }
    ln.addListener('localNotificationActionPerformed', ev => {
      const extra = ev?.notification?.extra || {};
      if (!extra.taskId) return;
      if (ev.actionId === 'concluir') handlers.complete(extra.taskId, extra.subId);
      else if (ev.actionId === 'adiar') snooze(ev.notification, 10);
      else if (ev.actionId === 'adiar60') snooze(ev.notification, 60);
      else handlers.alert(extra.taskId, extra.subId || null);
    });
  } else {
    clearInterval(webTimer);
    webTimer = setInterval(webTick, 20_000);
    setTimeout(webTick, 3000);
  }
}

export async function permissionStatus() {
  if (isNative() && LN()) {
    const p = await LN().checkPermissions().catch(() => ({ display: 'prompt' }));
    let exact = 'granted';
    try { exact = (await LN().checkExactNotificationSetting()).exact_alarm; } catch { /* Android antigo */ }
    return { display: p.display, exact, native: true };
  }
  if (!('Notification' in globalThis)) return { display: 'unsupported', exact: 'n/a', native: false };
  return { display: Notification.permission === 'default' ? 'prompt' : Notification.permission, exact: 'n/a', native: false };
}

export async function requestPermission() {
  if (isNative() && LN()) {
    const r = await LN().requestPermissions();
    try {
      const ex = await LN().checkExactNotificationSetting();
      if (ex.exact_alarm !== 'granted') await LN().changeExactNotificationSetting();
    } catch { /* ok */ }
    return r.display;
  }
  if (!('Notification' in globalThis)) return 'unsupported';
  return Notification.requestPermission();
}

/** Reprograma todos os lembretes a partir da lista atual de tarefas. */
export async function reschedule(tasks, settings = {}, { localOnly = null } = {}) {
  if (isNative() && serverPushActive() && localOnly) tasks = tasks.filter(localOnly);
  // No navegador, incluímos os últimos 10 min para não perder um aviso entre duas reprogramações.
  const now = isNative() ? new Date() : new Date(Date.now() - 10 * 60_000);
  const plan = reminderInstants(tasks, { now, allDayTime: settings.allDayTime || '09:00', max: isNative() ? 400 : 200 });
  if (isNative() && LN()) {
    const ln = LN();
    try {
      const perm = await ln.checkPermissions();
      if (perm.display !== 'granted') return { scheduled: 0, reason: 'sem permissão' };
      const pending = await ln.getPending();
      const keepSnoozes = (pending.notifications || []).filter(n => n.extra?.snooze);
      const toCancel = (pending.notifications || []).filter(n => !n.extra?.snooze).map(n => ({ id: n.id }));
      if (toCancel.length) await ln.cancel({ notifications: toCancel });
      if (!plan.length) return { scheduled: 0, snoozes: keepSnoozes.length };
      await ln.schedule({
        notifications: plan.map(p => ({
          id: notifId(`${p.taskId}|${p.subId || ''}|${p.when.getTime()}|${p.minutes}`),
          title: p.title, body: p.body, channelId: 'lembretes', actionTypeId: 'TAREFA',
          smallIcon: 'ic_stat_agenda', iconColor: '#6555ec',
          schedule: { at: p.when, allowWhileIdle: true },
          extra: { taskId: p.taskId, subId: p.subId || null }
        }))
      });
      return { scheduled: plan.length };
    } catch (e) {
      console.error('Falha ao agendar', e);
      return { scheduled: 0, error: e.message };
    }
  }
  webPlan = plan;
  return { scheduled: plan.length, web: true };
}

async function snooze(n, minutes) {
  const at = new Date(Date.now() + minutes * 60_000);
  await LN().schedule({ notifications: [{
    id: notifId(`snooze|${n.id}|${at.getTime()}`), title: n.title, body: `Adiado • ${at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
    channelId: 'lembretes', actionTypeId: 'TAREFA', smallIcon: 'ic_stat_agenda', iconColor: '#6555ec',
    schedule: { at, allowWhileIdle: true }, extra: { ...(n.extra || {}), snooze: true }
  }] });
  handlers.snoozed?.(minutes);
}

export async function testNotification() {
  if (isNative() && LN()) {
    const at = new Date(Date.now() + 5000);
    await LN().schedule({ notifications: [{ id: 999001, title: 'Minha Agenda IA', body: 'Teste: as notificações estão funcionando! 🎉', channelId: 'lembretes', smallIcon: 'ic_stat_agenda', iconColor: '#6555ec', schedule: { at, allowWhileIdle: true } }] });
    return 'Notificação de teste em 5 segundos. Pode bloquear a tela.';
  }
  if (!('Notification' in globalThis) || Notification.permission !== 'granted') throw new Error('Permita as notificações no navegador primeiro.');
  await show('Minha Agenda IA', 'Teste: as notificações estão funcionando! 🎉', {});
  return 'Notificação de teste enviada.';
}

async function show(title, body, data) {
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: data.tag, data };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) return reg.showNotification(title, opts);
  } catch { /* usa a API simples */ }
  const n = new Notification(title, opts);
  n.onclick = () => { globalThis.focus?.(); if (data.taskId) handlers.open(data.taskId); n.close(); };
}

function webTick() {
  if (!('Notification' in globalThis) || Notification.permission !== 'granted' || !webPlan.length) return;
  if (pushFlag()) return; // o servidor já avisa este aparelho
  let fired; try { fired = JSON.parse(localStorage.getItem(FIRED_KEY) || '{}'); } catch { fired = {}; }
  const now = Date.now();
  for (const p of webPlan) {
    const t = p.when.getTime();
    if (t > now) break;
    const key = `${p.taskId}|${p.subId || ''}|${t}`;
    if (fired[key] || now - t > 10 * 60_000) continue; // não dispara avisos muito antigos
    fired[key] = now;
    show(p.title, p.body, { taskId: p.taskId, tag: key });
  }
  for (const [k, v] of Object.entries(fired)) if (now - v > 3 * 86400_000) delete fired[k];
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(fired)); } catch { /* */ }
}

// ---------------- app Android: avisos pelo servidor (Firebase) ----------------
let nativePushStarted = false;
const fnUrl = store => `${store.config.url.replace(/\/+$/, '')}/functions/v1/lembretes`;
async function showNow(title, body, d = {}) {
  if (!LN()) return;
  await LN().schedule({ notifications: [{ id: notifId(`agora|${d.tag || d.taskId}|${Date.now()}`), title: title || 'Minha Agenda IA', body: body || '', channelId: 'lembretes',
    actionTypeId: d.taskId ? 'TAREFA' : undefined, smallIcon: 'ic_stat_agenda', iconColor: '#6555ec', schedule: { at: new Date(Date.now() + 300), allowWhileIdle: true },
    extra: { taskId: d.taskId || null, subId: d.subId || null } }] });
}
async function verifyServer(store) {
  try {
    const r = await fetch(fnUrl(store));
    const j = await r.json();
    ls.set(SERVER_KEY, r.ok && j.fcm && j.agendador ? '1' : null);
  } catch { /* sem internet: mantém o último estado conhecido */ }
  return serverPushActive();
}
async function saveFcmToken(store, token) {
  await store.supa.raw('/rest/v1/push_subscriptions?on_conflict=endpoint', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ endpoint: `fcm:${token}`, kind: 'fcm', device: 'Android' })
  });
  await store.supa.json('/rest/v1/rpc/configurar_lembretes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_url: store.config.url.replace(/\/+$/, '') }) });
}
/** Registra o celular no Firebase e no Supabase. Chamar ao abrir o app e depois do login. */
export async function initNativePush(store, onChange = () => {}) {
  if (!isNative() || !PN()) return false;
  if (!store.online) { ls.set(SERVER_KEY, null); return false; }
  const pn = PN();
  if (!nativePushStarted) {
    nativePushStarted = true;
    pn.addListener('registration', async ({ value }) => {
      try { await saveFcmToken(store, value); await verifyServer(store); }
      catch (e) { console.warn('Avisos: falha ao registrar no servidor', e); ls.set(SERVER_KEY, null); }
      onChange();
    });
    pn.addListener('registrationError', e => { console.warn('Firebase indisponível', e); ls.set(SERVER_KEY, null); onChange(); });
    // Com o app aberto o Android não mostra o aviso do Firebase: mostramos nós, com os botões.
    pn.addListener('pushNotificationReceived', n => { const d = n.data || {}; showNow(n.title || d.title, n.body || d.body, d); });
    pn.addListener('pushNotificationActionPerformed', a => { const d = a.notification?.data || {}; if (d.taskId) handlers.alert(d.taskId, d.subId || null); });
  }
  try {
    let perm = await pn.checkPermissions();
    if (perm.receive !== 'granted') perm = await pn.requestPermissions();
    if (perm.receive !== 'granted') { ls.set(SERVER_KEY, null); onChange(); return false; }
    await pn.register(); // o token chega no evento "registration"
    return true;
  } catch (e) { console.warn('Firebase', e); ls.set(SERVER_KEY, null); onChange(); return false; }
}
/** Agenda um "lembrar de novo" local (usado pela tela de aviso). */
export async function snoozeLocal(task, minutes, subId = null) {
  if (!isNative() || !LN()) return false;
  const at = new Date(Date.now() + minutes * 60_000);
  await LN().schedule({ notifications: [{ id: notifId(`snooze|${task.id}|${at.getTime()}`), title: task.title, body: `Adiado • ${at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
    channelId: 'lembretes', actionTypeId: 'TAREFA', smallIcon: 'ic_stat_agenda', iconColor: '#6555ec', schedule: { at, allowWhileIdle: true }, extra: { taskId: task.id, subId, snooze: true } }] });
  return true;
}
