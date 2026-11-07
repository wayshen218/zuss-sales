import { esc, fmtDateTime, nowIso } from '../util.js';
import { store, me, isAdmin, setting, settingBool, dispatch, sync, logout, V, pendingCount, clearRejected } from '../store.js';
import { render, toast, confirmBox, go, empty, tag } from '../ui.js';
import { getApiUrl, call } from '../api.js';
import { APP_VERSION } from '../config.js';

const TYPE_LABEL = { 'shop.patch': 'Shop change', 'visit.add': 'Check-in', 'order.create': 'New order', 'order.update': 'Order edit', 'order.event': 'Order update', 'fav.set': 'Favourite', 'checklist.save': 'Checklist', 'settings.save': 'Settings', 'pin.change': 'PIN change', 'order.delete': 'Order delete' };

export default {
  tab: 'more',
  title: 'More',
  render() {
    const u = me();
    const s = store.status;
    const removed = V().shops.filter(x => x.deleted);
    const admin = isAdmin();
    return `
    <div class="card">
      <div class="card-head"><h3>Sync</h3>${!s.online ? tag('Offline', 'grey') : pendingCount() ? tag(pendingCount() + ' waiting', 'amber') : tag('All synced', 'green')}</div>
      <p class="small">Last synced with the Google Sheet: <b>${s.lastSync ? esc(fmtDateTime(s.lastSync)) : 'never'}</b></p>
      ${s.error ? `<p class="error-box small">Last attempt: ${esc(s.error)}. Changes are safe on this phone and will retry automatically.</p>` : ''}
      <button class="btn primary" data-act="syncNow" ${s.syncing ? 'disabled' : ''}>${s.syncing ? 'Syncing…' : 'Sync now'}</button>
      ${store.rejected.length ? `<div class="mt"><h4>Changes the server refused</h4><ul class="timeline">${store.rejected.map(r => `<li><b>${esc(TYPE_LABEL[r.type] || r.type)}</b> · ${esc(fmtDateTime(r.at))}<div class="small error-text">${esc(r.message)}</div></li>`).join('')}</ul><button class="btn ghost small" data-act="clearRej">Clear this list</button></div>` : ''}
    </div>

    <div class="card form">
      <div class="card-head"><h3>Targets & settings</h3>${admin ? '' : tag('Admin only', 'grey')}</div>
      <div class="grid2">
        <label>Initial target (RM)<input id="sInitial" type="number" min="0" value="${esc(setting('initial_target', '25000'))}" ${admin ? '' : 'disabled'}></label>
        <label>Monthly target (RM)<input id="sMonthly" type="number" min="0" value="${esc(setting('monthly_target', '300000'))}" ${admin ? '' : 'disabled'}></label>
        <label>Commission rate (%)<input id="sRate" type="number" min="0" max="100" step="0.1" value="${esc(setting('commission_rate', '10'))}" ${admin ? '' : 'disabled'}></label>
        <label>Start date (for initial target)<input id="sStart" type="date" value="${esc(setting('start_date', ''))}" ${admin ? '' : 'disabled'}></label>
      </div>
      <label class="switch-row"><span>Allow mixed cartons</span><input id="sMix" type="checkbox" role="switch" ${settingBool('mixed_carton_enabled', true) ? 'checked' : ''} ${admin ? '' : 'disabled'}></label>
      <label class="switch-row"><span>Allow 4L and 5L in the same mixed carton</span><input id="sMix45" type="checkbox" role="switch" ${settingBool('mix_4l_5l_together', false) ? 'checked' : ''} ${admin ? '' : 'disabled'}></label>
      ${admin ? '<button class="btn primary" data-act="saveSettings">Save settings</button>' : ''}
      <p class="tiny muted">Product prices are edited in the Google Sheet → Products tab (non-stockist / stockist / list price columns).</p>
    </div>

    <div class="card">
      <div class="card-head"><h3>Removed shops <span class="count">${removed.length}</span></h3></div>
      ${removed.length ? removed.map(x => `<div class="row-link"><div class="grow"><b>${esc(x.name)}</b><div class="small muted">${esc(x.area || '')} · removed by ${esc(x.updated_by || '')}</div></div><button class="btn small" data-act="restore" data-id="${esc(x.id)}">Restore</button></div>`).join('') : empty('None.')}
    </div>

    <div class="card form">
      <div class="card-head"><h3>My account</h3></div>
      <p class="small">Logged in as <b>${esc(u.name)}</b> (${u.role === 'admin' ? 'admin' : 'salesman'}${u.can_hq ? ', updates HQ status' : ''}).</p>
      <div class="grid2">
        <label>Current PIN<input id="pOld" type="password" inputmode="numeric" autocomplete="current-password"></label>
        <label>New PIN (4–8 digits)<input id="pNew" type="password" inputmode="numeric" autocomplete="new-password"></label>
      </div>
      <div class="btn-row"><button class="btn" data-act="changePin">Change PIN</button><button class="btn danger ghost" data-act="logout">Log out</button></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>About</h3></div>
      <p class="small muted">ZUSS Sales app v${esc(APP_VERSION)}. Data is stored in your Google Sheet; this phone keeps a copy so the app works offline.</p>
      <p class="tiny muted break">Server: ${esc(getApiUrl())}</p>
      <button class="btn ghost small" data-act="reload">Reload app</button>
    </div>`;
  },
  actions: {
    syncNow: async () => { await sync(); toast(store.status.error ? 'Sync failed: ' + store.status.error : 'Synced', store.status.error ? 'error' : ''); },
    clearRej: () => clearRejected(),
    saveSettings: () => {
      const g = id => document.getElementById(id);
      const rate = Number(g('sRate').value);
      if (!(rate >= 0 && rate <= 100)) { toast('Commission rate must be 0–100', 'error'); return; }
      dispatch('settings.save', { values: {
        initial_target: Number(g('sInitial').value) || 0, monthly_target: Number(g('sMonthly').value) || 0, commission_rate: rate,
        start_date: g('sStart').value, mixed_carton_enabled: g('sMix').checked ? 'TRUE' : 'FALSE', mix_4l_5l_together: g('sMix45').checked ? 'TRUE' : 'FALSE'
      } });
      toast('Settings saved');
    },
    restore: el => { dispatch('shop.patch', { id: el.dataset.id, at: nowIso(), fields: { deleted: false } }); toast('Shop restored'); },
    changePin: async () => {
      const o = document.getElementById('pOld').value, n = document.getElementById('pNew').value;
      if (!/^\d{4,8}$/.test(n)) { toast('New PIN must be 4–8 digits', 'error'); return; }
      if (!navigator.onLine) { toast('Changing PIN needs internet', 'error'); return; }
      // Sent straight to the server (never queued on the phone) so the PIN is not stored anywhere.
      try {
        const r = await call('sync', { token: store.session.token, ops: [{ op_id: 'pin-' + Date.now(), type: 'pin.change', data: { old_pin: o, new_pin: n } }] });
        const res = r.ok && r.results && r.results[0];
        if (res && res.ok) toast('PIN changed. Use the new PIN next time you log in.');
        else toast((res && res.message) || r.message || 'Could not change PIN', 'error');
      } catch (e) { toast('Could not reach server: ' + e.message, 'error'); }
      document.getElementById('pOld').value = ''; document.getElementById('pNew').value = '';
    },
    logout: async () => {
      const n = pendingCount();
      if (!(await confirmBox(n ? `${n} change(s) are not synced yet. Logging out now will try to sync first; anything that cannot sync will be lost.\n\nLog out?` : 'Log out of this device?', { ok: 'Log out', danger: !!n }))) return;
      await logout();
      go('#/home');
      location.reload();
    },
    reload: () => location.reload()
  }
};
