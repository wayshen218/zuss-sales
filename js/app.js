import { store, subscribe, login, sync, onAuthLost, pendingCount, takeRejectNotice } from './store.js';
import { route, render, go, back, toast, sheetIsOpen, currentView } from './ui.js';
import { esc, fmtDateTime } from './util.js';
import { getApiUrl, setApiUrl } from './api.js';
import home from './views/home.js';
import shops from './views/shops.js';
import shop from './views/shop.js';
import { orderNewView, orderEditView } from './views/order.js';
import summary from './views/summary.js';
import orders from './views/orders.js';
import prices from './views/prices.js';
import daily from './views/daily.js';
import more from './views/more.js';

route('/home', home);
route('/shops', shops);
route('/shop/:id', shop);
route('/order/new/:shopId', orderNewView);
route('/order/edit/:id', orderEditView);
route('/order/:id', summary);
route('/orders', orders);
route('/prices', prices);
route('/daily', daily);
route('/more', more);

const app = document.getElementById('app');
const loginEl = document.getElementById('login');

function syncPill() {
  const el = document.getElementById('syncPill');
  const s = store.status;
  const n = pendingCount();
  let cls = 'ok', txt = 'Synced';
  if (!s.online) { cls = 'off'; txt = n ? `Offline · ${n} saved` : 'Offline'; }
  else if (s.syncing) { cls = 'busy'; txt = 'Syncing…'; }
  else if (n) { cls = 'wait'; txt = `${n} to sync`; }
  else if (s.error) { cls = 'err'; txt = 'Sync issue'; }
  el.className = 'sync-pill ' + cls;
  el.textContent = txt;
  el.title = s.lastSync ? 'Last synced ' + fmtDateTime(s.lastSync) : 'Not synced yet';
}

function showLogin(msg) {
  app.hidden = true;
  loginEl.hidden = false;
  const url = getApiUrl();
  loginEl.innerHTML = `
  <div class="login-card">
    <div class="brand"><div class="logo">Z</div><div><h1>ZUSS Sales</h1><p>Workshop sales · Kelantan</p></div></div>
    ${msg ? `<p class="error-box">${esc(msg)}</p>` : ''}
    <form id="loginForm" method="post" action="#" autocomplete="on">
      <label>Name<input id="lName" name="username" autocomplete="username" autocapitalize="words" required value="${esc(localStorage.getItem('zuss.lastName') || '')}"></label>
      <label>PIN<input id="lPin" name="password" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" required></label>
      <button class="btn cta full" type="submit" id="lBtn">Log in</button>
    </form>
    <p class="tiny muted">Tip: when your phone offers to save the password, tap <b>Save</b>. Next time it fills in with Face ID / fingerprint.</p>
    <details class="server" ${url ? '' : 'open'}>
      <summary>Server link ${url ? '✓' : '(required)'}</summary>
      <label>Apps Script web app URL<input id="lUrl" value="${esc(url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    </details>
  </div>`;
  document.getElementById('loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = document.getElementById('lBtn');
    const u = document.getElementById('lUrl').value.trim();
    if (u) setApiUrl(u);
    if (!getApiUrl()) { toast('Paste the server link first', 'error'); return; }
    btn.disabled = true; btn.textContent = 'Logging in…';
    try {
      const name = document.getElementById('lName').value.trim();
      await login(name, document.getElementById('lPin').value.trim());
      localStorage.setItem('zuss.lastName', name);
      // Replacing the form after a successful submit lets iOS/Android offer "Save password".
      history.replaceState(null, '', '#/home');
      document.getElementById('toast').className = 'toast';
      startApp();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Log in';
      toast(err.message || 'Login failed', 'error');
    }
  };
}

let started = false;
function startApp() {
  loginEl.hidden = true; loginEl.innerHTML = '';
  app.hidden = false;
  if (!started) {
    started = true;
    subscribe(() => {
      syncPill();
      const notice = takeRejectNotice();
      if (notice) toast('Not saved: ' + notice, 'error');
      if (!store.session) return;
      // Don't redraw the screen under an open sheet (it has its own state).
      if (!sheetIsOpen()) render();
    });
    window.addEventListener('hashchange', () => render());
    document.getElementById('hdrBack').onclick = () => {
      const v = currentView();
      back(v && v.view && v.view.tab ? '#/' + v.view.tab : '#/home');
    };
    document.querySelectorAll('nav.tabs button').forEach(b => { b.onclick = () => go('#/' + b.dataset.tab); });
    document.getElementById('syncPill').onclick = () => go('#/more');
  }
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/home');
  syncPill();
  render();
}

// Setup link: index.html?api=<Apps Script URL> saves the server link on this device, then hides it from the address bar.
(() => {
  const api = new URLSearchParams(location.search).get('api');
  if (api && /^https:\/\/script\.google(usercontent)?\.com\//.test(api)) {
    setApiUrl(api);
    history.replaceState(null, '', location.pathname + (location.hash || '#/home'));
  }
})();

onAuthLost(() => { started && (app.hidden = true); showLogin('Your session ended. Please log in again — unsynced changes are kept.'); });

if (store.session && store.base) {
  startApp();
  sync().catch(() => {});
} else if (store.session) {
  // Logged in but no data yet (first load interrupted): fetch, then start.
  sync().then(() => store.base ? startApp() : showLogin(store.status.error ? 'Could not load data: ' + store.status.error : '')).catch(() => showLogin());
} else {
  showLogin();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          const b = document.getElementById('updateBar');
          b.hidden = false;
          b.onclick = () => location.reload();
        }
      });
    });
  }).catch(() => {});
}
