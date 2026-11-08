// One order: summary table, date-time log, copy/share, HQ status, payment.
import { esc, rm, fmtDateTime, copyText, nowIso, uid, cleanAddress, telLink, waLink, digits } from '../util.js';
import { orderById, itemsFor, logsFor, dispatch, canHQ, isPendingOrder, shopById, HQ_STATUSES, me, isAdmin } from '../store.js';
import { empty, toast, confirmBox, promptBox, tag, query, go } from '../ui.js';
import { summaryText, unitLabel, hqNextStatus } from '../orderlogic.js';
import { hqTag, paidTag } from './common.js';
import { hasDocs } from '../photos.js';
import { shareShopDocs } from './docs.js';

let orderId = null;

const logEvent = (event, detail = '', set) => dispatch('order.event', { order_id: orderId, set, log: { id: uid('lg-'), at: nowIso(), event, detail } });

export default {
  tab: 'orders',
  back: true,
  title: p => (orderById(p.id) || {}).order_no || 'Order',
  render(p) {
    orderId = p.id;
    const o = orderById(p.id);
    if (!o) return empty('Order not found.');
    const items = itemsFor(o.id);
    const logs = logsFor(o.id);
    const shop = shopById(o.shop_id) || {};
    const isNew = query().new === '1';
    const cancelled = o.status === 'Cancelled';
    const sentOwner = logs.filter(l => l.event === 'Sent to owner').pop();
    const sentZuss = logs.filter(l => l.event === 'Sent to ZUSS').pop();
    const next = hqNextStatus(o.hq_status);
    const editable = !cancelled && o.hq_status === 'Not submitted';
    const pending = isPendingOrder(o.id);
    const phone = o.phone || shop.phone;
    return `
    ${isNew ? `<div class="banner ok">✓ Order saved${pending ? ' on this phone — it will sync to the Sheet automatically' : ''}. Copy the summary and send it to the shop owner and ZUSS.</div>` : ''}
    ${cancelled ? `<div class="banner warn"><span>This order was cancelled. It is not counted in sales or commission.</span>${isAdmin() ? '<button class="btn danger small" data-act="deleteOrder">Delete permanently</button>' : ''}</div>` : ''}
    <div class="two-col">
      <div>
        <div class="card">
          <div class="card-head"><div><div class="muted small">Order No</div><h2 class="order-no">${esc(o.order_no)}</h2></div>
            <div class="right"><b class="money big">${rm(o.total)}</b><div class="small muted">${esc(o.price_tier)} price</div></div></div>
          <div class="shop-meta">${cancelled ? tag('Cancelled', 'red') : hqTag(o.hq_status) + paidTag(o.paid)} ${pending ? tag('Waiting to sync', 'amber') : tag('Synced', 'green')}</div>
          <dl class="details mt-s">
            <dt>Shop</dt><dd><a href="#/shop/${encodeURIComponent(o.shop_id)}"><b>${esc(o.shop_name)}</b></a></dd>
            ${o.contact ? `<dt>Contact</dt><dd>${esc(o.contact)}</dd>` : ''}
            <dt>Phone</dt><dd>${phone ? `<a href="${esc(telLink(phone))}">${esc(phone)}</a>` : '—'}</dd>
            <dt>Address</dt><dd>${esc(cleanAddress(o.address) || '—')}</dd>
            <dt>Placed</dt><dd>${esc(fmtDateTime(o.created_at))} · ${esc(o.created_by || '')}</dd>
            ${o.notes ? `<dt>Notes</dt><dd class="pre">${esc(o.notes)}</dd>` : ''}
          </dl>
        </div>
        <div class="card">
          <div class="card-head"><h3>Order summary</h3></div>
          <div class="table-wrap"><table class="items">
            <thead><tr><th>#</th><th>Item</th><th class="num col-wide">Qty</th><th class="num col-wide">Unit price</th><th class="num">Total</th></tr></thead>
            <tbody>${items.map((it, i) => `<tr>
              <td>${i + 1}</td>
              <td><b>${esc(it.description)}</b>${it.kind !== 'mixed' && it.size ? ' <span class="muted">' + esc(it.size) + '</span>' : ''}${it.kind === 'mixed' ? `<div class="small muted">${esc(it.mix_detail)}</div>` : ''}<div class="small col-narrow">${esc(it.qty)} ${unitLabel(it)} × ${rm(it.unit_price)}</div></td>
              <td class="num col-wide">${esc(it.qty)} ${unitLabel(it)}</td>
              <td class="num col-wide">${rm(it.unit_price)}</td>
              <td class="num"><b>${rm(it.line_total ?? it.qty * it.unit_price)}</b></td></tr>`).join('')}</tbody>
            <tfoot><tr><td></td><td class="tf-qty">${o.cartons ? `${o.cartons} carton${o.cartons > 1 ? 's' : ''}` : ''}${o.cartons && o.pails ? ' + ' : ''}${o.pails ? `${o.pails} pail${o.pails > 1 ? 's' : ''}` : ''}</td><td class="col-wide"></td><td class="num col-wide">TOTAL</td><td class="num"><b>${rm(o.total)}</b></td></tr></tfoot>
          </table></div>
        </div>
      </div>
      <div>
        <div class="card send-card">
          <div class="card-head"><h3>Send summary</h3></div>
          <p class="small muted">Copy once, paste into the shop owner's chat and the ZUSS chat. Then tick each one so the log shows when it was sent.</p>
          <div class="btn-row">
            <button class="btn cta grow" data-act="copy">📋 Copy summary</button>
            ${navigator.share ? `<button class="btn grow" data-act="share">Share…</button>` : ''}
          </div>
          ${digits(phone).length >= 7 ? `<a class="btn ghost full mt-s" href="${esc(waLink(phone, summaryText(o)))}" target="_blank" rel="noopener">💬 Open owner's WhatsApp with summary</a>` : ''}
          ${hasDocs(o.shop_id) ? `<button class="btn ghost full mt-s" data-act="shareDocs">📇 Share name card + SSM</button>` : `<p class="tiny muted mt-s">No name card / SSM photo for this shop yet — add them on the <a href="#/shop/${encodeURIComponent(o.shop_id)}">shop page</a>.</p>`}
          <div class="sent-grid mt-s">
            <button class="sent ${sentOwner ? 'done' : ''}" data-act="markSent" data-who="owner" ${cancelled ? 'disabled' : ''}>${sentOwner ? '✓' : '○'} Sent to owner${sentOwner ? `<small>${esc(fmtDateTime(sentOwner.at))}</small>` : ''}</button>
            <button class="sent ${sentZuss ? 'done' : ''}" data-act="markSent" data-who="zuss" ${cancelled ? 'disabled' : ''}>${sentZuss ? '✓' : '○'} Sent to ZUSS${sentZuss ? `<small>${esc(fmtDateTime(sentZuss.at))}</small>` : ''}</button>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>ZUSS HQ status</h3>${hqTag(o.hq_status)}</div>
          <ol class="hq-steps">${HQ_STATUSES.map(s => `<li class="${HQ_STATUSES.indexOf(s) <= HQ_STATUSES.indexOf(o.hq_status) ? 'done' : ''}">${esc(s)}</li>`).join('')}</ol>
          ${cancelled ? '' : canHQ()
            ? (next ? `<button class="btn primary full" data-act="hqNext" data-v="${esc(next)}">Mark as ${esc(next)}</button>
                ${o.hq_status !== 'Not submitted' ? `<button class="btn ghost small mt-s" data-act="hqSet">Correct status…</button>` : ''}` : '<p class="small muted">Fulfilled by HQ.</p>')
            : `<p class="small muted">Only the salesman handling HQ can update this.</p>`}
        </div>
        <div class="card">
          <div class="card-head"><h3>Payment</h3>${paidTag(o.paid)}</div>
          ${cancelled ? '' : o.paid
            ? `<button class="btn ghost small" data-act="unpaid">Undo — mark as not received</button>`
            : `<button class="btn primary full" data-act="paid">Mark payment received</button>`}
        </div>
        <div class="card">
          <div class="card-head"><h3>Date & time log</h3></div>
          <ul class="timeline">${logs.map(l => `<li><b>${esc(fmtDateTime(l.at))}</b> — ${esc(l.event)}${l.detail ? ` <span class="muted">(${esc(l.detail)})</span>` : ''}<div class="small muted">${esc(l.by || '')}${l._pending ? ' · waiting to sync' : ''}</div></li>`).join('') || '<li class="muted">No log yet</li>'}</ul>
        </div>
        ${cancelled ? '' : `<div class="card">
          <div class="btn-row">
            ${editable ? `<a class="btn ghost grow" href="#/order/edit/${encodeURIComponent(o.id)}">Edit items</a>` : ''}
            <button class="btn danger ghost grow" data-act="cancel">Cancel order</button>
          </div>
          ${editable ? '' : '<p class="small muted mt-s">Items can no longer be edited after the order is submitted to HQ.</p>'}
        </div>`}
      </div>
    </div>`;
  },
  actions: {
    shareDocs: () => { const o = orderById(orderId); shareShopDocs(o.shop_id, `Order No: ${o.order_no}`); },
    copy: async () => {
      const ok = await copyText(summaryText(orderById(orderId)));
      toast(ok ? 'Summary copied — paste it in WhatsApp' : 'Could not copy. Use Share instead.', ok ? '' : 'error');
    },
    share: async () => {
      try { await navigator.share({ text: summaryText(orderById(orderId)) }); } catch (e) { /* user closed share sheet */ }
    },
    markSent: async el => {
      const who = el.dataset.who === 'owner' ? 'Sent to owner' : 'Sent to ZUSS';
      const already = logsFor(orderId).some(l => l.event === who);
      if (already && !(await confirmBox(`Already marked "${who}". Record it again (e.g. re-sent after a change)?`, { ok: 'Record again' }))) return;
      logEvent(who);
      toast(who + ' — time recorded');
    },
    hqNext: async el => {
      const v = el.dataset.v;
      if (!(await confirmBox(`Change HQ status to "${v}"?${v === 'Submitted' ? '\n\nAfter this, the order items can no longer be edited.' : ''}`, { ok: v }))) return;
      logEvent('HQ: ' + v, '', { hq_status: v });
    },
    hqSet: async () => {
      const o = orderById(orderId);
      const v = await promptBox(`Type the correct status: ${HQ_STATUSES.join(' / ')}`, { title: 'Correct HQ status', value: o.hq_status });
      if (v === null) return;
      const match = HQ_STATUSES.find(s => s.toLowerCase() === v.trim().toLowerCase());
      if (!match) { toast('Not a valid status', 'error'); return; }
      if (match !== o.hq_status) logEvent('HQ: ' + match, 'corrected from ' + o.hq_status, { hq_status: match });
    },
    paid: async () => {
      const ref = await promptBox('Payment reference (optional) — e.g. cash, transfer ref, cheque no.', { title: 'Payment received', ok: 'Mark received' });
      if (ref === null) return;
      logEvent('Payment received', ref.trim(), { paid: true });
      toast('Payment recorded');
    },
    unpaid: async () => {
      if (!(await confirmBox('Mark this order as payment NOT received?', { ok: 'Mark not received', danger: true }))) return;
      logEvent('Payment marked not received', '', { paid: false });
    },
    deleteOrder: async () => {
      const o = orderById(orderId);
      if (!(await confirmBox(`Permanently delete ${o.order_no}?\n\nIts items and log are removed from the Google Sheet. This cannot be undone. Use this only for test orders or mistakes.`, { title: 'Delete order', ok: 'Delete permanently', danger: true }))) return;
      dispatch('order.delete', { order_id: o.id });
      toast('Order deleted');
      go('#/orders');
    },
    cancel: async () => {
      const reason = await promptBox('Why is this order cancelled?', { title: 'Cancel order', ok: 'Cancel order', placeholder: 'e.g. shop changed mind' });
      if (reason === null) return;
      logEvent('Order cancelled', reason.trim(), { status: 'Cancelled' });
      toast('Order cancelled');
    }
  }
};
