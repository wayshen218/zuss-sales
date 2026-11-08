// App state: the last copy downloaded from the Sheet ("base") plus changes not yet
// synced ("outbox"). What the screens show = base with the outbox replayed on top.
// Everything is kept on the device so the app works offline.
import { call, NetworkError } from './api.js';
import { uid, nowIso, today } from './util.js';

const K_BASE = 'zuss.base', K_OUT = 'zuss.outbox', K_SESSION = 'zuss.session', K_REJ = 'zuss.rejected';
const listeners = new Set();

export const HQ_STATUSES = ['Not submitted', 'Submitted', 'Processing', 'Fulfilled'];
export const STAGES = ['New', 'Warm', 'Quoted', 'Follow-up', 'Won', 'Lost'];
export const AREAS = ['Kota Bharu', 'Salor', 'Pasir Mas', 'Tumpat', 'Bachok', 'Pasir Puteh', 'Machang', 'Tanah Merah', 'Kuala Krai', 'Jeli', 'Besut'];

const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('storage full?', e); } };

const emptyBase = () => ({ users: [], settings: {}, products: [], shops: [], orders: [], items: [], logs: [], visits: [], favourites: [], checklist: [], photos: [] });

export const store = {
  session: read(K_SESSION, null),          // { token, me }
  base: read(K_BASE, null),                // last server snapshot
  outbox: read(K_OUT, []),                 // [{op_id, type, data, user_id}]
  rejected: read(K_REJ, []),               // changes the server refused (shown in More)
  view: null,
  status: { syncing: false, online: navigator.onLine, lastSync: read('zuss.lastSync', null), error: '' }
};

export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
export const notify = () => { rebuild(); emit(); };
// Work to do at the start of every sync (e.g. uploading photos taken offline).
const syncHooks = [];
export const registerSyncHook = fn => { syncHooks.push(fn); };

/* ───────── Totals (same rules as the server) ───────── */
export function orderTotals(items) {
  let cartons = 0, pails = 0, total = 0;
  items.forEach(it => { const q = Number(it.qty) || 0; if (it.kind === 'pail') pails += q; else cartons += q; total += q * (Number(it.unit_price) || 0); });
  return { cartons, pails, total: Math.round(total * 100) / 100 };
}

/* ───────── Replay one change onto a copy of the data ───────── */
function applyOp(v, op, me) {
  const d = op.data || {};
  const byName = me ? me.name : '';
  switch (op.type) {
    case 'shop.patch': {
      let s = v.shops.find(x => x.id === d.id);
      if (!s) {
        s = { id: d.id, stage: 'New', stockist: false, deleted: false, source: 'Added in app', created_at: d.at, created_by: byName, contact: '', phone: '', address: '', area: '', state: 'Kelantan', notes: '', follow_up: '', potential_value: '', lat: '', lng: '' };
        v.shops.push(s);
      }
      Object.assign(s, d.fields || {}, { updated_at: d.at, updated_by: byName });
      break;
    }
    case 'visit.add':
      if (!v.visits.some(x => x.id === d.id)) v.visits.push({ ...d, by: byName, _pending: true });
      break;
    case 'order.create': {
      const o = d.order;
      if (v.orders.some(x => x.id === o.id)) break;
      const items = d.items.map((it, i) => ({ ...it, order_id: o.id, order_no: o.order_no, line_no: i + 1, line_total: Math.round(it.qty * it.unit_price * 100) / 100 }));
      v.orders.push({ ...o, status: 'Confirmed', hq_status: 'Not submitted', paid: false, commission_eligible: o.commission_eligible !== false, created_by: byName, updated_at: o.created_at, ...orderTotals(items), _pending: true });
      v.items.push(...items);
      if (d.log) v.logs.push({ ...d.log, order_id: o.id, order_no: o.order_no, by: byName, _pending: true });
      break;
    }
    case 'order.update': {
      const o = v.orders.find(x => x.id === d.order_id);
      if (!o) break;
      const items = d.items.map((it, i) => ({ ...it, order_id: o.id, order_no: o.order_no, line_no: i + 1, line_total: Math.round(it.qty * it.unit_price * 100) / 100 }));
      v.items = v.items.filter(x => x.order_id !== o.id).concat(items);
      Object.assign(o, orderTotals(items), { _pending: true });
      if ('notes' in d) o.notes = d.notes;
      if ('commission_eligible' in d) o.commission_eligible = d.commission_eligible !== false;
      if (d.log) v.logs.push({ ...d.log, order_id: o.id, order_no: o.order_no, by: byName, _pending: true });
      break;
    }
    case 'order.event': {
      const o = v.orders.find(x => x.id === d.order_id);
      if (!o) break;
      Object.assign(o, d.set || {});
      if (d.log && !v.logs.some(l => l.id === d.log.id)) v.logs.push({ ...d.log, order_id: o.id, order_no: o.order_no, by: byName, _pending: true });
      break;
    }
    case 'fav.set':
      v.favourites = v.favourites.filter(x => x !== d.shop_id);
      if (d.on) v.favourites.push(d.shop_id);
      break;
    case 'checklist.save': {
      const id = d.date + '|' + (me && me.user_id);
      v.checklist = v.checklist.filter(c => c.id !== id);
      v.checklist.push({ id, date: d.date, user_id: me && me.user_id, done: JSON.stringify(d.done || []), decision_makers: d.decision_makers, notes: d.notes, updated_at: d.at });
      break;
    }
    case 'order.delete': {
      v.orders = v.orders.filter(x => x.id !== d.order_id);
      v.items = v.items.filter(x => x.order_id !== d.order_id);
      v.logs = v.logs.filter(x => x.order_id !== d.order_id);
      break;
    }
    case 'photo.delete':
      v.photos = (v.photos || []).filter(x => x.id !== d.id);
      break;
    case 'settings.save':
      Object.keys(d.values || {}).forEach(k => { v.settings[k] = String(d.values[k]); });
      break;
    default: break;
  }
}

function rebuild() {
  const v = JSON.parse(JSON.stringify(store.base || emptyBase()));
  v.photos = v.photos || [];
  const me = store.session && store.session.me;
  store.outbox.forEach(op => { try { applyOp(v, op, me); } catch (e) { console.error('replay failed', op, e); } });
  store.view = v;
}
rebuild();

/* ───────── Public actions ───────── */
export function dispatch(type, data) {
  const op = { op_id: uid('op-'), type, data, user_id: store.session && store.session.me.user_id, queued_at: nowIso() };
  store.outbox.push(op);
  write(K_OUT, store.outbox);
  rebuild();
  emit();
  scheduleSync(400);
  return op;
}

export async function login(name, pin) {
  const r = await call('login', { name, pin });
  if (!r.ok) throw new Error(r.message || 'Login failed');
  const prevUser = store.session && store.session.me && store.session.me.user_id;
  store.session = { token: r.token, me: r.user };
  write(K_SESSION, store.session);
  // Keep unsynced changes only if the same person logs back in.
  if (prevUser && prevUser !== r.user.user_id) { store.outbox = []; write(K_OUT, []); }
  store.outbox = store.outbox.filter(op => !op.user_id || op.user_id === r.user.user_id);
  if (r.data) {
    // The server sends all data with the login reply, so the app can open straight away.
    store.base = r.data; write(K_BASE, store.base);
    store.status.lastSync = nowIso(); write('zuss.lastSync', store.status.lastSync);
    rebuild();
    if (store.outbox.length) scheduleSync(50);
  } else {
    await sync();
  }
  return r.user;
}

export async function logout() {
  const token = store.session && store.session.token;
  if (store.outbox.length) await sync().catch(() => {});
  try { if (token) await call('logout', { token }, 8000); } catch (e) { /* offline: token expires on its own */ }
  store.session = null; localStorage.removeItem(K_SESSION);
  store.base = null; localStorage.removeItem(K_BASE);
  store.outbox = []; localStorage.removeItem(K_OUT);
  rebuild(); emit();
}

let syncTimer = null, syncPromise = null, backoff = 0;
export function scheduleSync(ms = 400) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { sync().catch(() => {}); }, ms);
}

export function sync() {
  if (syncPromise) return syncPromise;
  if (!store.session) return Promise.resolve();
  if (!navigator.onLine) { store.status.online = false; emit(); return Promise.resolve(); } // retried on the 'online' event
  syncPromise = (async () => {
    store.status.syncing = true; store.status.error = ''; emit();
    try {
      for (const hook of syncHooks) { try { await hook(); } catch (e) { console.warn('sync hook failed', e); } }
      // 1. Send queued changes in order, a batch at a time.
      while (store.outbox.length) {
        const batch = store.outbox.slice(0, 25);
        const r = await call('sync', { token: store.session.token, ops: batch.map(({ op_id, type, data }) => ({ op_id, type, data })) }, 45000);
        if (!r.ok) {
          if (r.error === 'AUTH') { handleAuthLost(); return; }
          throw new NetworkError(r.message || 'Sync failed');
        }
        const done = new Set();
        r.results.forEach(res => {
          done.add(res.op_id);
          if (!res.ok) {
            const op = batch.find(o => o.op_id === res.op_id);
            store.rejected.unshift({ at: nowIso(), type: op && op.type, message: res.message, data: op && op.data });
          }
        });
        store.rejected = store.rejected.slice(0, 30); write(K_REJ, store.rejected);
        if (r.results.some(x => !x.ok)) lastRejectNotice = r.results.filter(x => !x.ok).map(x => x.message).join('; ');
        store.outbox = store.outbox.filter(o => !done.has(o.op_id));
        write(K_OUT, store.outbox);
      }
      // 2. Download the latest copy of everything.
      const b = await call('bootstrap', { token: store.session.token }, 45000);
      if (!b.ok) {
        if (b.error === 'AUTH') { handleAuthLost(); return; }
        throw new NetworkError(b.message || 'Download failed');
      }
      const { ok, version, server_time, me, ...data } = b;
      store.base = data;
      store.session.me = me; write(K_SESSION, store.session);
      write(K_BASE, store.base);
      store.status.lastSync = nowIso(); write('zuss.lastSync', store.status.lastSync);
      backoff = 0;
    } catch (e) {
      store.status.error = e.message || String(e);
      backoff = Math.min(backoff ? backoff * 2 : 5000, 120000);
      if (store.outbox.length) scheduleSync(backoff);
    } finally {
      store.status.syncing = false;
      rebuild(); emit();
      syncPromise = null;
    }
  })();
  return syncPromise;
}

let lastRejectNotice = '';
export function takeRejectNotice() { const m = lastRejectNotice; lastRejectNotice = ''; return m; }
export function clearRejected() { store.rejected = []; write(K_REJ, []); emit(); }

let authLostHandler = () => {};
export const onAuthLost = fn => { authLostHandler = fn; };
function handleAuthLost() {
  store.session = null; localStorage.removeItem(K_SESSION);
  authLostHandler();
}

window.addEventListener('online', () => { store.status.online = true; emit(); scheduleSync(300); });
window.addEventListener('offline', () => { store.status.online = false; emit(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(300); });
setInterval(() => { if (document.visibilityState === 'visible' && store.session) sync().catch(() => {}); }, 90000);

/* ───────── Read helpers ───────── */
export const V = () => store.view;
export const me = () => store.session && store.session.me;
export const isAdmin = () => me() && me().role === 'admin';
export const canHQ = () => me() && me().can_hq === true;
export const settings = () => store.view.settings || {};
export const setting = (k, d = '') => { const v = settings()[k]; return v === undefined || v === '' ? d : v; };
export const settingBool = (k, d = false) => { const v = settings()[k]; return v === undefined || v === '' ? d : String(v).toUpperCase() === 'TRUE'; };
export const shopById = id => store.view.shops.find(s => s.id === id);
export const activeShops = () => store.view.shops.filter(s => !s.deleted);
export const productById = id => store.view.products.find(p => p.id === id);
export const products = () => store.view.products.filter(p => p.active !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0));
export const orderById = id => store.view.orders.find(o => o.id === id);
export const itemsFor = orderId => store.view.items.filter(i => i.order_id === orderId).sort((a, b) => a.line_no - b.line_no);
export const logsFor = orderId => store.view.logs.filter(l => l.order_id === orderId).sort((a, b) => String(a.at).localeCompare(String(b.at)));
export const ordersFor = shopId => store.view.orders.filter(o => o.shop_id === shopId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
export const visitsFor = shopId => store.view.visits.filter(v => v.shop_id === shopId).sort((a, b) => String(b.at).localeCompare(String(a.at)));
export const lastVisit = shopId => visitsFor(shopId)[0];
export const isFav = id => store.view.favourites.includes(id);
export const tierOf = shop => (shop && shop.stockist === true) ? 'Stockist' : 'Non-stockist';
export const priceFor = (p, tier) => Number(tier === 'Stockist' ? p.stockist_price : p.nonstockist_price) || 0;
export const pendingCount = () => store.outbox.length;
export const isPendingOrder = id => store.outbox.some(op => (op.data && (op.data.order_id === id || (op.data.order && op.data.order.id === id))));
export function checklistFor(date) {
  const c = store.view.checklist.find(x => x.date === date);
  if (!c) return { done: [], decision_makers: 0, notes: '' };
  let done = []; try { done = JSON.parse(c.done || '[]'); } catch (e) { done = []; }
  return { done, decision_makers: Number(c.decision_makers) || 0, notes: c.notes || '' };
}
export const myVisitsOn = date => store.view.visits.filter(v => String(v.at).slice(0, 10) === date && v.by === (me() && me().name));
export { today };
