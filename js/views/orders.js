import { esc, rm, fmtDateTime, fmtDate, fmtMonth, thisMonth, shiftMonth, sum } from '../util.js';
import { V, logsFor, isPendingOrder } from '../store.js';
import { empty, tag, render } from '../ui.js';
import { hqTag, paidTag } from './common.js';

const st = { tab: 'all', month: '', group: 'date', q: '', open: {} };

const TABS = [
  ['all', 'All'],
  ['hq', 'Waiting on HQ'],
  ['unpaid', 'Unpaid'],
  ['unsent', 'Not sent'],
  ['cancelled', 'Cancelled']
];

function filtered() {
  const q = st.q.toLowerCase();
  return V().orders.filter(o => {
    if (st.month && String(o.created_at).slice(0, 7) !== st.month) return false;
    if (q && !(`${o.order_no} ${o.shop_name}`.toLowerCase().includes(q))) return false;
    const live = o.status !== 'Cancelled';
    switch (st.tab) {
      case 'hq': return live && o.hq_status !== 'Fulfilled';
      case 'unpaid': return live && !o.paid;
      case 'unsent': { const ev = logsFor(o.id).map(l => l.event); return live && !(ev.includes('Sent to owner') && ev.includes('Sent to ZUSS')); }
      case 'cancelled': return !live;
      default: return true;
    }
  }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function orderRow(o, showShop = true) {
  const ev = logsFor(o.id).map(l => l.event);
  const sent = ev.includes('Sent to owner') && ev.includes('Sent to ZUSS');
  return `<a class="row-link" href="#/order/${encodeURIComponent(o.id)}">
    <div class="grow">
      <div><b>${esc(o.order_no)}</b> ${showShop ? '· ' + esc(o.shop_name) : ''}</div>
      <div class="small muted">${esc(fmtDateTime(o.created_at))} · ${esc(o.created_by || '')} · ${o.cartons || 0} ctn${o.pails ? ` + ${o.pails} pail` : ''}</div>
      <div class="shop-meta">${o.status === 'Cancelled' ? tag('Cancelled', 'red') : hqTag(o.hq_status) + paidTag(o.paid) + (sent ? '' : tag('Not sent', 'amber'))}${isPendingOrder(o.id) ? tag('Waiting to sync', 'amber') : ''}</div>
    </div>
    <b class="money">${rm(o.total)}</b>
  </a>`;
}

export default {
  tab: 'orders',
  title: 'Orders',
  render() {
    const jump = sessionStorage.getItem('zuss.ordersTab');
    if (jump) { st.tab = jump; st.month = ''; sessionStorage.removeItem('zuss.ordersTab'); }
    const rows = filtered();
    const live = rows.filter(o => o.status !== 'Cancelled');
    let listHtml;
    if (!rows.length) listHtml = empty(V().orders.length ? 'No orders match.' : 'No orders yet. Open a shop and tap "New order".', V().orders.length ? '' : `<div class="mt"><a class="btn" href="#/shops">Go to shops</a></div>`);
    else if (st.group === 'shop') {
      const groups = {};
      rows.forEach(o => { (groups[o.shop_id] = groups[o.shop_id] || { name: o.shop_name, id: o.shop_id, orders: [] }).orders.push(o); });
      listHtml = Object.values(groups).sort((a, b) => sum(b.orders, o => o.status !== 'Cancelled' ? o.total : 0) - sum(a.orders, o => o.status !== 'Cancelled' ? o.total : 0)).map(g => {
        const tot = sum(g.orders, o => o.status !== 'Cancelled' ? o.total : 0);
        const open = st.open[g.id];
        return `<div class="card group">
          <button class="group-head" data-act="toggleGroup" data-id="${esc(g.id)}" aria-expanded="${!!open}">
            <div class="grow"><b>${esc(g.name)}</b><div class="small muted">${g.orders.length} order${g.orders.length > 1 ? 's' : ''} · last ${esc(fmtDate(g.orders[0].created_at))}</div></div>
            <b class="money">${rm(tot)}</b><span class="chev">${open ? '▾' : '▸'}</span>
          </button>
          ${open ? `<div class="group-body">${g.orders.map(o => orderRow(o, false)).join('')}<a class="small" href="#/shop/${encodeURIComponent(g.id)}">Open shop ›</a></div>` : ''}
        </div>`;
      }).join('');
    } else {
      const byDay = {};
      rows.forEach(o => { const d = String(o.created_at).slice(0, 10); (byDay[d] = byDay[d] || []).push(o); });
      listHtml = Object.keys(byDay).sort().reverse().map(d => `<h4 class="day-head">${esc(fmtDate(d))}</h4><div class="card list">${byDay[d].map(o => orderRow(o)).join('')}</div>`).join('');
    }
    return `
    <div class="toolbar sticky">
      <input id="orderSearch" type="search" placeholder="Search order no. or shop…" value="${esc(st.q)}" data-input="search" autocomplete="off">
      <div class="filters">
        <div class="month-pick">
          <button class="btn ghost small" data-act="prevMonth" aria-label="Previous month">‹</button>
          <button class="btn ghost small" data-act="allTime">${st.month ? esc(fmtMonth(st.month)) : 'All time'}</button>
          <button class="btn ghost small" data-act="nextMonth" aria-label="Next month">›</button>
        </div>
        <div class="seg"><button class="${st.group === 'date' ? 'on' : ''}" data-act="group" data-v="date">By date</button><button class="${st.group === 'shop' ? 'on' : ''}" data-act="group" data-v="shop">By shop</button></div>
      </div>
    </div>
    <div class="chips">${TABS.map(([k, l]) => `<button class="chip ${st.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="summary-strip">
      <div><b>${live.length}</b><span>orders</span></div>
      <div><b>${rm(sum(live, o => o.total))}</b><span>total</span></div>
      <div><b>${sum(live, o => o.cartons)}</b><span>cartons</span></div>
      <div><b>${sum(live, o => o.pails)}</b><span>pails</span></div>
    </div>
    ${listHtml}`;
  },
  actions: {
    search: el => { st.q = el.value; render(); },
    tab: el => { st.tab = el.dataset.v; render(); },
    group: el => { st.group = el.dataset.v; render(); },
    toggleGroup: el => { st.open[el.dataset.id] = !st.open[el.dataset.id]; render({ keepScroll: true }); },
    prevMonth: () => { st.month = shiftMonth(st.month || thisMonth(), st.month ? -1 : 0); render(); },
    nextMonth: () => { st.month = st.month ? shiftMonth(st.month, 1) : thisMonth(); render(); },
    allTime: () => { st.month = st.month ? '' : thisMonth(); render(); }
  }
};
