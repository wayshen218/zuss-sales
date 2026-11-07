// Screen plumbing: router, re-rendering, bottom sheets, dialogs, toasts.
import { esc } from './util.js';

const routes = [];
let current = null; // { view, params }
const root = () => document.getElementById('view');

export function route(pattern, view) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ re, keys, view });
}

export const go = hash => {
  if (sheetIsOpen()) closeSheet();
  if (location.hash === hash) render(); else location.hash = hash;
};
// Back button in the header: go back inside the app, or to a sensible screen if opened directly.
let depth = 0;
window.addEventListener('hashchange', () => { depth++; });
export const back = fallback => { if (depth > 0) { depth -= 2; history.back(); } else go(fallback || '#/home'); };

function match() {
  const h = (location.hash || '#/home').slice(1).split('?')[0];
  for (const r of routes) {
    const m = h.match(r.re);
    if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); return { view: r.view, params }; }
  }
  return { view: routes[0].view, params: {} };
}

export function query() {
  const q = (location.hash.split('?')[1] || '');
  return Object.fromEntries(new URLSearchParams(q));
}

export function render(opts = {}) {
  const next = match();
  const sameView = current && current.view === next.view && JSON.stringify(current.params) === JSON.stringify(next.params);
  const el = root();
  // Remember focus and scroll so background syncs don't disturb typing.
  const active = document.activeElement;
  const focusId = sameView && active && active.id && el.contains(active) ? active.id : null;
  const selStart = focusId && 'selectionStart' in active ? active.selectionStart : null;
  const scrollY = sameView ? window.scrollY : 0;
  if (!sameView && current && current.view.leave) current.view.leave();
  current = next;
  el.innerHTML = next.view.render(next.params);
  document.getElementById('hdrTitle').textContent = typeof next.view.title === 'function' ? next.view.title(next.params) : (next.view.title || '');
  document.getElementById('hdrBack').hidden = !next.view.back;
  document.getElementById('brandMark').hidden = !!next.view.back;
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === next.view.tab));
  if (next.view.mount) next.view.mount(el, next.params);
  if (focusId) {
    const f = document.getElementById(focusId);
    if (f) { f.focus({ preventScroll: true }); try { if (selStart !== null) f.setSelectionRange(selStart, selStart); } catch (e) { /* not text */ } }
  }
  if (!opts.keepScroll) window.scrollTo(0, scrollY);
}

export const currentView = () => current;

// Delegated clicks: <button data-act="name" data-id="..."> calls view.actions.name(el, ev)
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const inSheet = el.closest('#sheet');
  const handlers = inSheet ? sheetActions : (current && current.view.actions);
  const fn = handlers && handlers[el.dataset.act];
  if (fn) { ev.preventDefault(); fn(el, ev); }
});
document.addEventListener('input', ev => {
  const el = ev.target.closest('[data-input]');
  if (!el) return;
  const inSheet = el.closest('#sheet');
  const handlers = inSheet ? sheetActions : (current && current.view.actions);
  const fn = handlers && handlers[el.dataset.input];
  if (fn) fn(el, ev);
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-change]');
  if (!el) return;
  const inSheet = el.closest('#sheet');
  const handlers = inSheet ? sheetActions : (current && current.view.actions);
  const fn = handlers && handlers[el.dataset.change];
  if (fn) fn(el, ev);
});

/* ───────── Bottom sheet ───────── */
let sheetActions = {};
let sheetOnClose = null;
export function openSheet({ title, html, actions = {}, onClose, wide = false }) {
  sheetActions = { ...actions, closeSheet: () => closeSheet() };
  sheetOnClose = onClose || null;
  const s = document.getElementById('sheet');
  s.innerHTML = `<div class="sheet-backdrop" data-act="closeSheet"></div>
    <div class="sheet-panel ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="closeSheet" aria-label="Close">✕</button></div>
      <div class="sheet-body" id="sheetBody">${html}</div>
    </div>`;
  s.hidden = false;
  document.body.classList.add('sheet-open');
}
export function updateSheet(html) { const b = document.getElementById('sheetBody'); if (b) b.innerHTML = html; }
export function closeSheet() {
  const s = document.getElementById('sheet');
  if (s.hidden) return;
  s.hidden = true; s.innerHTML = '';
  document.body.classList.remove('sheet-open');
  const cb = sheetOnClose; sheetOnClose = null; sheetActions = {};
  if (cb) cb();
  if (current) render();
}
export const sheetIsOpen = () => !document.getElementById('sheet').hidden;
// Phone back button / swipe back: close an open sheet when the screen changes.
window.addEventListener('hashchange', () => { if (sheetIsOpen()) closeSheet(); });

/* ───────── Dialogs ───────── */
export function confirmBox(message, { ok = 'OK', cancel = 'Cancel', danger = false, title = '' } = {}) {
  return new Promise(resolve => {
    const d = document.getElementById('dialog');
    d.innerHTML = `<div class="dlg-backdrop"></div><div class="dlg" role="alertdialog" aria-modal="true">
      ${title ? `<h3>${esc(title)}</h3>` : ''}<p>${esc(message).replace(/\n/g, '<br>')}</p>
      <div class="dlg-actions"><button class="btn ghost" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`;
    d.hidden = false;
    d.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { d.hidden = true; d.innerHTML = ''; resolve(b.dataset.r === '1'); });
  });
}
export function promptBox(message, { value = '', placeholder = '', ok = 'Save', title = '', multiline = false, inputmode = '' } = {}) {
  return new Promise(resolve => {
    const d = document.getElementById('dialog');
    const field = multiline
      ? `<textarea id="dlgInput" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input id="dlgInput" value="${esc(value)}" placeholder="${esc(placeholder)}" ${inputmode ? `inputmode="${inputmode}"` : ''}>`;
    d.innerHTML = `<div class="dlg-backdrop"></div><div class="dlg" role="dialog" aria-modal="true">
      ${title ? `<h3>${esc(title)}</h3>` : ''}<p>${esc(message)}</p>${field}
      <div class="dlg-actions"><button class="btn ghost" data-r="0">Cancel</button><button class="btn primary" data-r="1">${esc(ok)}</button></div></div>`;
    d.hidden = false;
    const inp = d.querySelector('#dlgInput'); setTimeout(() => inp.focus(), 50);
    d.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { const v = inp.value; d.hidden = true; d.innerHTML = ''; resolve(b.dataset.r === '1' ? v : null); });
  });
}

let toastTimer;
export function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, kind === 'error' ? 6000 : 2600);
}

export const tag = (text, cls = '') => `<span class="tag ${cls}">${esc(text)}</span>`;
export const stageTag = s => tag(s || 'New', 'stage-' + String(s || 'New').toLowerCase().replace(/[^a-z]/g, ''));
export const empty = (msg, extra = '') => `<div class="empty">${esc(msg)}${extra}</div>`;
