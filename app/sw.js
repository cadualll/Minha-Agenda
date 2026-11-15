// Service worker: permite abrir a agenda no PC mesmo sem internet e mostrar notificações.
const VERSION = 'agenda-v2.3.0';
const SHELL = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/ui.js', 'js/store.js', 'js/supa.js', 'js/tasks.js', 'js/recurrence.js', 'js/parser.js', 'js/editor.js', 'js/settings.js', 'js/notify.js', 'js/push.js', 'js/search.js', 'js/insights.js', 'js/explore.js', 'js/config.js', 'icons/badge-96.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase passa direto
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
// Aviso enviado pelo servidor (Supabase), mesmo com a agenda fechada.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const opts = { body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: d, vibrate: [200, 100, 200] };
  if (d.tag) { opts.tag = d.tag; opts.renotify = true; }
  if (d.taskId) { opts.actions = [{ action: 'concluir', title: '✓ Concluir' }, { action: 'adiar', title: 'Adiar 10 min' }]; opts.requireInteraction = true; }
  e.waitUntil(self.registration.showNotification(d.title || 'Minha Agenda IA', opts));
});
self.addEventListener('notificationclick', e => {
  const d = e.notification.data || {};
  e.notification.close();
  if (e.action === 'adiar' && d.snooze && d.fn) {
    // Adia sem abrir o app: o servidor manda de novo em 10 minutos.
    e.waitUntil(fetch(d.fn, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'adiar', minutos: 10, d: d.snooze.d, sig: d.snooze.sig, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }) }).catch(() => {}));
    return;
  }
  const id = d.taskId;
  let q = '';
  if (id) q = `?task=${encodeURIComponent(id)}${e.action === 'concluir' ? `&acao=concluir${d.subId ? `&sub=${encodeURIComponent(d.subId)}` : ''}` : ''}`;
  const dest = new URL('./' + q, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if (c.url.startsWith(self.registration.scope)) { c.focus(); return c.navigate(dest); }
    return self.clients.openWindow(dest);
  }));
});
