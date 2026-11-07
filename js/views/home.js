import { esc, rm, rm0, fmtMonth, thisMonth, shiftMonth, today, relDays, sum, fmtDateTime, fmtDate } from '../util.js';
import { V, me, activeShops, setting, isFav, myVisitsOn, logsFor, store } from '../store.js';
import { empty, tag, render, go } from '../ui.js';
import { star, toggleFav, hqTag, paidTag } from './common.js';
import { openShopForm } from './shopform.js';

let month = thisMonth();

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function pct(a, b) { return b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0; }

export default {
  tab: 'home',
  title: 'Sales',
  render() {
    const v = V();
    const live = v.orders.filter(o => o.status !== 'Cancelled');
    const monthOrders = live.filter(o => String(o.created_at).slice(0, 7) === month);
    const monthSales = sum(monthOrders, o => o.total);
    const start = setting('start_date', '');
    const sinceStart = sum(live.filter(o => !start || String(o.created_at).slice(0, 10) >= start), o => o.total);
    const initialT = Number(setting('initial_target', 25000));
    const monthlyT = Number(setting('monthly_target', 300000));
    const rate = Number(setting('commission_rate', 10)) / 100;
    const elig = monthOrders.filter(o => o.commission_eligible !== false);
    const commPaid = sum(elig.filter(o => o.paid), o => o.total) * rate;
    const commPending = sum(elig.filter(o => !o.paid), o => o.total) * rate;
    const t = today();
    const visitsToday = new Set(myVisitsOn(t).map(x => x.shop_id)).size;
    const followUps = activeShops().filter(s => s.follow_up && s.follow_up <= t && !['Won', 'Lost'].includes(s.stage)).sort((a, b) => a.follow_up.localeCompare(b.follow_up));
    const waitingHQ = live.filter(o => o.hq_status !== 'Fulfilled').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const unpaid = live.filter(o => !o.paid);
    const notSent = live.filter(o => { const ev = logsFor(o.id).map(l => l.event); return !(ev.includes('Sent to owner') && ev.includes('Sent to ZUSS')); });
    const favs = v.favourites.map(id => v.shops.find(s => s.id === id)).filter(s => s && !s.deleted);
    const name = (me() && me().name) || '';
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';

    return `
    <div class="hello"><h2>${greet}, ${esc(name)}</h2><span class="muted small">${esc(fmtDate(today()))}</span></div>

    <div class="quick-actions">
      <a class="qa cta" href="#/shops"><span>🛒</span>Start order</a>
      <button class="qa" data-act="addShop"><span>＋</span>New shop</button>
      <a class="qa" href="#/daily"><span>✓</span>Daily · ${visitsToday} visit${visitsToday === 1 ? '' : 's'}</a>
      <a class="qa" href="#/prices"><span>▤</span>Prices</a>
    </div>

    <div class="month-row">
      <h3>Progress</h3>
      <div class="month-pick">
        <button class="btn ghost small" data-act="prevMonth" aria-label="Previous month">‹</button>
        <b>${esc(fmtMonth(month))}</b>
        <button class="btn ghost small" data-act="nextMonth" aria-label="Next month" ${month >= thisMonth() ? 'disabled' : ''}>›</button>
      </div>
    </div>
    <div class="metrics">
      <div class="metric-card"><div class="m-label">Sales this month</div><div class="m-val">${rm0(monthSales)}</div><div class="m-sub">of ${rm0(monthlyT)} target</div><div class="bar"><span style="width:${pct(monthSales, monthlyT)}%"></span></div></div>
      <div class="metric-card"><div class="m-label">Initial target</div><div class="m-val">${rm0(sinceStart)}</div><div class="m-sub">of ${rm0(initialT)}${start ? ' since ' + esc(start) : ' (all orders)'}</div><div class="bar"><span style="width:${pct(sinceStart, initialT)}%"></span></div></div>
      <div class="metric-card"><div class="m-label">Commission (paid orders)</div><div class="m-val green">${rm(commPaid)}</div><div class="m-sub">Pending (unpaid): ${rm(commPending)}</div></div>
      <div class="metric-card"><div class="m-label">Orders this month</div><div class="m-val">${monthOrders.length}</div><div class="m-sub">${plural(sum(monthOrders, o => o.cartons), 'carton')} · ${plural(sum(monthOrders, o => o.pails), 'pail')}</div></div>
    </div>
    <p class="tiny muted">Commission = ${esc(setting('commission_rate', '10'))}% of order totals marked "counts toward commission". Estimate only — confirm the basis with HQ.</p>

    <div class="two-col">
      <div>
        <div class="card">
          <div class="card-head"><h3>Follow-ups due <span class="count">${followUps.length}</span></h3></div>
          ${followUps.length ? followUps.slice(0, 8).map(s => `<a class="row-link" href="#/shop/${encodeURIComponent(s.id)}"><div class="grow"><b>${esc(s.name)}</b><div class="small muted">${esc(s.area || '')} · ${esc(s.stage)}</div></div>${tag(relDays(s.follow_up), s.follow_up < t ? 'red' : 'amber')}</a>`).join('') + (followUps.length > 8 ? `<a class="small" href="#/shops">+${followUps.length - 8} more — sort shops by follow-up date</a>` : '') : empty('Nothing due. Set a follow-up date on a shop to see it here.')}
        </div>
        <div class="card">
          <div class="card-head"><h3>★ Favourites <span class="count">${favs.length}</span></h3></div>
          ${favs.length ? favs.map(s => `<div class="fav-row">${star(s)}<a class="grow" href="#/shop/${encodeURIComponent(s.id)}"><b>${esc(s.name)}</b><div class="small muted">${esc(s.area || '')} · ${esc(s.phone || 'No phone')}</div></a></div>`).join('') : empty('Tap ☆ next to a shop to keep it here.')}
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-head"><h3>Waiting on HQ <span class="count">${waitingHQ.length}</span></h3></div>
          ${waitingHQ.length ? waitingHQ.slice(0, 8).map(o => `<a class="row-link" href="#/order/${encodeURIComponent(o.id)}"><div class="grow"><b>${esc(o.order_no)}</b> · ${esc(o.shop_name)}<div class="small muted">${esc(relDays(o.created_at))}</div></div>${hqTag(o.hq_status)}</a>`).join('') : empty('All orders fulfilled.')}
        </div>
        <div class="card">
          <div class="card-head"><h3>Needs attention</h3></div>
          <a class="row-link" href="#/orders?tab=unsent" data-act="ordersTab" data-v="unsent"><div class="grow">Summary not sent to owner + ZUSS</div><b>${notSent.length}</b></a>
          <a class="row-link" href="#/orders?tab=unpaid" data-act="ordersTab" data-v="unpaid"><div class="grow">Payment not received</div><b>${unpaid.length} · ${rm0(sum(unpaid, o => o.total))}</b></a>
        </div>
      </div>
    </div>`;
  },
  actions: {
    prevMonth: () => { month = shiftMonth(month, -1); render(); },
    nextMonth: () => { if (month < thisMonth()) { month = shiftMonth(month, 1); render(); } },
    toggleFav: el => toggleFav(el.dataset.id),
    addShop: () => openShopForm(null),
    ordersTab: el => { sessionStorage.setItem('zuss.ordersTab', el.dataset.v); go('#/orders'); }
  }
};
