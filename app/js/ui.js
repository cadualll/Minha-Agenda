// Utilidades de interface compartilhadas.
import { dateKey } from './recurrence.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const P = {
  plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="M5 12.5l4.2 4.2L19 7"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  week: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 14h2M11 14h2M14.5 14h2"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  inbox: '<path d="M3 13.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4.5M3 13.5 5.6 5.4A2 2 0 0 1 7.5 4h9a2 2 0 0 1 1.9 1.4l2.6 8.1M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/>',
  all: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  done: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16.5 9"/>',
  repeat: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 11V9a3 3 0 0 1 3-3h14M7 21.5 3.5 18 7 14.5"/><path d="M20.5 13v2a3 3 0 0 1-3 3h-14"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8.5 3 8.5H3S6 15 6 8"/><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0"/>',
  clip: '<path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/>',
  flag: '<path d="M5 21V4m0 0h11.5l-2 4 2 4H5"/>', tag: '<path d="M3 12.6V4.5A1.5 1.5 0 0 1 4.5 3h8.1l8.4 8.4a1.5 1.5 0 0 1 0 2.1l-7 7a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.5"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>', sub: '<path d="M4 4v9a3 3 0 0 0 3 3h13M16 12l4 4-4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.5A2 2 0 0 0 8.5 21h7a2 2 0 0 0 2-1.5l1-12.5M9 7V4.5h6V7"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.6 1.4A4 4 0 0 1 17.5 18.5z"/>',
  cloudOff: '<path d="M3 3l18 18M8.5 8.6A4.5 4.5 0 0 0 7 18.5h10.5M20.6 16.4A4 4 0 0 0 18 11a6 6 0 0 0-8.3-5.5"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>',
  skip: '<path d="M5 5v14l9-7zM18 5v14"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 19h16"/>', upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>', file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/>',
  sparkle: '<path d="m12 3 1.8 5.6L19.5 10l-5.7 1.6L12 17l-1.8-5.4L4.5 10l5.7-1.4z"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.4L3.5 9M4 13a8 8 0 0 0 14.6 4.4l1.9-2.4M3.5 4v5h5M20.5 20v-5h-5"/>', dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'
};
export function icon(name, cls = '') { return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.list}</svg>`; }

// ---------- datas ----------
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const hm = d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export function relDay(d, now = new Date()) {
  const k = dateKey(d), t = new Date(now);
  if (k === dateKey(t)) return 'Hoje';
  t.setDate(t.getDate() + 1); if (k === dateKey(t)) return 'Amanhã';
  t.setDate(t.getDate() - 2); if (k === dateKey(t)) return 'Ontem';
  const diff = (new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400_000;
  if (diff > 0 && diff < 7) return WD[d.getDay()].replace(/^./, c => c.toUpperCase()) + '.';
  return `${d.getDate()} ${MO[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
export function fmtDue(t, at = t.dueAt ? new Date(t.dueAt) : null) {
  if (!at) return '';
  return t.allDay ? relDay(at) : `${relDay(at)}, ${hm(at)}`;
}
export const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export function longDay(d) { return cap(d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })); }
export const toInputDate = d => d ? dateKey(d) : '';
export const toInputTime = d => d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
export function fmtSize(b) { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`; }

// ---------- toast ----------
let toastTimer;
export function toast(msg, { action, ms = 4200 } = {}) {
  const root = $('#toast-root');
  root.innerHTML = `<div class="toast"><span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action.label)}</button>` : ''}</div>`;
  const el = root.firstElementChild;
  requestAnimationFrame(() => el.classList.add('show'));
  if (action) el.querySelector('button').onclick = () => { action.fn(); el.remove(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------- modais (com suporte ao botão "voltar" do Android) ----------
const stack = [];
// O botão "voltar" do Android fecha o modal aberto. Usamos UMA entrada extra no histórico
// enquanto houver modal aberto, e só a removemos quando não sobra nenhum.
let guard = false, ignorePops = 0;
function armGuard() { if (guard) return; try { history.pushState({ agendaModal: 1 }, ''); guard = true; } catch { /* navegador restrito */ } }
export function openModal(html, { cls = '', onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  $('#modal-root').appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  stack.push({ wrap, onClose });
  armGuard();
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) closeModal(); });
  return wrap.querySelector('.modal');
}
export function closeModal({ fromPop = false } = {}) {
  const entry = stack.pop(); if (!entry) return false;
  entry.wrap.classList.remove('show');
  setTimeout(() => entry.wrap.remove(), 180);
  try { entry.onClose?.(); } catch (e) { console.error(e); }
  if (fromPop) { guard = false; if (stack.length) armGuard(); }
  else setTimeout(() => { if (!stack.length && guard) { guard = false; ignorePops++; history.back(); } }, 0);
  return true;
}
export const modalOpen = () => stack.length > 0;
addEventListener('popstate', () => { if (ignorePops > 0) { ignorePops--; return; } if (stack.length) closeModal({ fromPop: true }); else guard = false; });

export function confirmBox(msg, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const m = openModal(`<div class="confirm"><p>${esc(msg)}</p><div class="row end"><button class="btn ghost" data-a="no">Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(ok)}</button></div></div>`, { cls: 'small', onClose: () => { if (!answered) resolve(false); } });
    m.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; answered = true; resolve(a.dataset.a === 'yes'); closeModal(); });
  });
}
export function promptBox(title, { value = '', placeholder = '', ok = 'Salvar', extra = '' } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const m = openModal(`<form class="confirm"><h3>${esc(title)}</h3><input class="input" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="40" required>${extra}<div class="row end"><button type="button" class="btn ghost" data-a="no">Cancelar</button><button class="btn primary">${esc(ok)}</button></div></form>`, { cls: 'small', onClose: () => { if (!answered) resolve(null); } });
    const f = m.querySelector('form'); setTimeout(() => f.v.focus(), 60);
    f.onsubmit = e => { e.preventDefault(); answered = true; resolve({ value: f.v.value.trim(), form: f }); closeModal(); };
    m.querySelector('[data-a=no]').onclick = () => closeModal();
  });
}
