import { esc, rm, telLink, waLink, wazeLink, gmapsLink, hasPin, fmtDateTime, relDays, fmtDate, nowIso, uid, digits, cleanAddress, parseLatLng } from '../util.js';
import { shopById, ordersFor, visitsFor, dispatch, me, store, tierOf } from '../store.js';
import { stageTag, tag, empty, toast, go, openSheet, updateSheet, closeSheet, confirmBox, promptBox, back } from '../ui.js';
import { star, toggleFav, hqTag, paidTag, fmtKm, distanceKm } from './common.js';
import { openShopForm } from './shopform.js';
import { bestPosition, geoErrorText } from '../geo.js';
import { call } from '../api.js';

let shopId = null;

function locationCard(s) {
  if (hasPin(s)) {
    const km = distanceKm(s);
    return `<div class="card">
      <div class="card-head"><h3>📍 Location pinned</h3>${km != null ? tag(fmtKm(km) + ' away', 'pin') : ''}</div>
      <p class="small muted">Pinned ${esc(fmtDateTime(s.pinned_at))}${s.pinned_by ? ' by ' + esc(s.pinned_by) : ''}${s.pin_accuracy_m ? ` · accuracy ±${esc(s.pin_accuracy_m)} m` : ''}</p>
      <div class="btn-row">
        <a class="btn nav waze" href="${esc(wazeLink(s))}" target="_blank" rel="noopener">Waze</a>
        <a class="btn nav gmaps" href="${esc(gmapsLink(s))}" target="_blank" rel="noopener">Google Maps</a>
      </div>
      <div class="btn-row mt-s">
        <button class="btn ghost small" data-act="pinHere">Update pin (I'm at the shop)</button>
        <button class="btn ghost small" data-act="pasteLink">Paste Maps link</button>
        <button class="btn ghost small danger" data-act="removePin">Remove pin</button>
      </div>
    </div>`;
  }
  return `<div class="card pin-empty">
    <div class="card-head"><h3>📍 No location pin yet</h3></div>
    <p class="small muted">When you're at the shop, tap <b>Pin this location</b>. Next time, Waze / Google Maps goes straight to it.</p>
    <div class="btn-row">
      <button class="btn primary" data-act="pinHere">📍 Pin this location</button>
      <button class="btn ghost" data-act="pasteLink">Paste Maps link</button>
    </div>
    <p class="small muted mt-s">Until pinned, navigation searches by name and address (may be inaccurate):
      <a href="${esc(wazeLink(s))}" target="_blank" rel="noopener">Waze</a> ·
      <a href="${esc(gmapsLink(s))}" target="_blank" rel="noopener">Google Maps</a></p>
  </div>`;
}

function savePin(s, pos, how) {
  dispatch('shop.patch', { id: s.id, at: nowIso(), fields: { lat: pos.lat, lng: pos.lng, pin_accuracy_m: pos.accuracy ?? '', pinned_at: nowIso(), pinned_by: me().name + (how ? ` (${how})` : '') } });
  toast('Location pinned');
}

function pinFlow(s) {
  let best = null;
  const view = (msg, final) => `
    <div class="pin-status">
      <div class="gps-dot ${final ? '' : 'pulse'}"></div>
      <p><b>${esc(msg)}</b></p>
      ${best ? `<p class="big">±${best.accuracy} m</p><p class="small muted">${best.accuracy <= 20 ? 'Good accuracy' : best.accuracy <= 50 ? 'OK accuracy — fine for navigation' : 'Weak signal — move outside / near the entrance and try again'}</p>` : '<p class="small muted">Stand at the shop entrance. Allow location if the phone asks.</p>'}
    </div>
    ${final ? `<div class="sheet-actions">
      <button class="btn ghost" data-act="retry">Try again</button>
      ${best ? `<button class="btn primary grow" data-act="save">${hasPin(s) ? 'Replace pin' : 'Save pin'}</button>` : ''}
    </div>` : ''}`;
  const run = async () => {
    best = null;
    updateSheet(view('Getting GPS location…', false));
    try {
      await bestPosition({ maxMs: 12000, goodM: 12, onProgress: p => { best = p; updateSheet(view('Improving accuracy…', false)); } });
      updateSheet(view(best.accuracy <= 50 ? 'Location found' : 'Location found (weak)', true));
    } catch (e) {
      updateSheet(`<p class="error-box">${esc(geoErrorText(e))}</p><div class="sheet-actions"><button class="btn primary grow" data-act="retry">Try again</button></div>`);
    }
  };
  openSheet({
    title: 'Pin location — ' + s.name,
    html: view('Starting…', false),
    actions: { retry: run, save: () => { savePin(s, best); closeSheet(); } }
  });
  run();
}

async function pasteLinkFlow(s) {
  const txt = await promptBox('Paste a Google Maps link for this shop, or coordinates like "6.1254, 102.2386".', { title: 'Set pin from link', placeholder: 'https://maps.app.goo.gl/…', ok: 'Use link' });
  if (!txt) return;
  let ll = parseLatLng(txt.trim());
  if (!ll && /^https?:\/\//i.test(txt.trim())) {
    if (!navigator.onLine) { toast('Short links need internet to read. Try again when online.', 'error'); return; }
    toast('Reading link…');
    try {
      const r = await call('resolveMap', { token: store.session.token, url: txt.trim() }, 20000);
      if (r.ok) ll = { lat: r.lat, lng: r.lng }; else { toast(r.message || 'Could not read that link', 'error'); return; }
    } catch (e) { toast('Could not reach server: ' + e.message, 'error'); return; }
  }
  if (!ll) { toast('No location found in that text', 'error'); return; }
  if (!(await confirmBox(`Set pin to ${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}?\n\nTip: after saving, tap Google Maps to double-check it lands on the shop.`, { title: hasPin(s) ? 'Replace pin' : 'Save pin', ok: 'Save pin' }))) return;
  savePin(s, { lat: ll.lat, lng: ll.lng, accuracy: '' }, 'from link');
}

function checkInFlow(s) {
  openSheet({
    title: 'Check in — ' + s.name,
    html: `<div class="form">
      <label>What happened? (optional)<textarea id="ciNote" rows="3" placeholder="Met owner, interested in Z2. Call back next week…"></textarea></label>
      <label>Set next follow-up (optional)<input id="ciFollow" type="date" value="${esc(s.follow_up || '')}"></label>
      <p class="small muted">Saves the date and time of this visit${!hasPin(s) ? ' and offers to pin the shop\'s location' : ''}.</p>
      <div class="sheet-actions"><button class="btn primary grow" data-act="saveVisit">✓ Save check-in</button></div>
    </div>`,
    actions: {
      saveVisit: async el => {
        el.disabled = true; el.textContent = 'Saving…';
        const note = document.getElementById('ciNote').value.trim();
        const follow = document.getElementById('ciFollow').value;
        let pos = null;
        try { pos = await bestPosition({ maxMs: 6000, goodM: 25 }); } catch (e) { pos = null; }
        dispatch('visit.add', { id: uid('v-'), shop_id: s.id, shop_name: s.name, at: nowIso(), note, lat: pos ? pos.lat : '', lng: pos ? pos.lng : '' });
        if (follow !== (s.follow_up || '')) dispatch('shop.patch', { id: s.id, at: nowIso(), fields: { follow_up: follow } });
        closeSheet();
        toast('Check-in saved');
        if (!hasPin(s) && pos && pos.accuracy <= 50) {
          if (await confirmBox(`Your GPS is accurate to ±${pos.accuracy} m. Pin this as ${s.name}'s location?`, { title: 'Pin location?', ok: 'Pin it', cancel: 'Not now' })) savePin(s, pos, 'at check-in');
        }
      }
    }
  });
  setTimeout(() => { const n = document.getElementById('ciNote'); if (n) n.focus(); }, 80);
}

export default {
  tab: 'shops',
  back: true,
  title: p => (shopById(p.id) || {}).name || 'Shop',
  render(p) {
    shopId = p.id;
    const s = shopById(p.id);
    if (!s) return empty('Shop not found. It may still be syncing.', `<div class="mt"><a class="btn" href="#/shops">Back to shops</a></div>`);
    const orders = ordersFor(s.id);
    const visits = visitsFor(s.id);
    const hasPhone = digits(s.phone).length >= 7;
    const live = orders.filter(o => o.status !== 'Cancelled');
    return `
    ${s.deleted ? `<div class="banner warn">This shop was removed. <button class="btn small" data-act="restore">Restore</button></div>` : ''}
    <div class="two-col">
      <div>
        <div class="card shop-hero">
          <div class="hero-top">${star(s)}<div class="grow"><h2>${esc(s.name)}</h2>
            <div class="shop-meta">${stageTag(s.stage)} ${s.stockist ? tag('Stockist', 'gold') : tag('Non-stockist', '')} ${s.area ? tag(s.area, 'area') : ''}</div></div>
            <button class="btn ghost small" data-act="edit">Edit</button></div>
          <div class="quick">
            <a class="q ${hasPhone ? '' : 'disabled'}" ${hasPhone ? `href="${esc(telLink(s.phone))}"` : ''}><span>📞</span>Call</a>
            <a class="q ${hasPhone ? '' : 'disabled'}" ${hasPhone ? `href="${esc(waLink(s.phone))}" target="_blank" rel="noopener"` : ''}><span>💬</span>WhatsApp</a>
            <a class="q" href="${esc(wazeLink(s))}" target="_blank" rel="noopener"><span>🚗</span>Waze</a>
            <a class="q" href="${esc(gmapsLink(s))}" target="_blank" rel="noopener"><span>🗺️</span>Maps</a>
          </div>
          <div class="btn-row">
            <a class="btn cta grow" href="#/order/new/${encodeURIComponent(s.id)}">🛒 New order</a>
            <button class="btn primary grow" data-act="checkIn">✓ Check in</button>
          </div>
        </div>
        ${locationCard(s)}
        <div class="card">
          <div class="card-head"><h3>Details</h3></div>
          <dl class="details">
            <dt>Contact</dt><dd>${esc(s.contact || '—')}</dd>
            <dt>Phone</dt><dd>${esc(s.phone || '—')}</dd>
            <dt>Address</dt><dd>${esc(cleanAddress(s.address) || '—')}${s.area ? `<br><span class="muted">${esc(s.area)}, ${esc(s.state || '')}</span>` : ''}</dd>
            <dt>Follow-up</dt><dd>${s.follow_up ? esc(fmtDate(s.follow_up)) + ` <span class="muted">(${esc(relDays(s.follow_up))})</span>` : '—'}</dd>
            <dt>Potential</dt><dd>${s.potential_value ? rm(s.potential_value) : '—'}</dd>
            <dt>Price tier</dt><dd>${esc(tierOf(s))}</dd>
            <dt>Notes</dt><dd class="pre">${esc(s.notes || '—')}</dd>
            <dt>Source</dt><dd class="muted small">${esc(s.source || '')}${s.created_by ? ' · added by ' + esc(s.created_by) : ''}${s.updated_at ? ' · updated ' + esc(fmtDateTime(s.updated_at)) : ''}</dd>
          </dl>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-head"><h3>Orders <span class="count">${orders.length}</span></h3>${live.length ? `<span class="muted small">Total ${rm(live.reduce((a, o) => a + Number(o.total || 0), 0))}</span>` : ''}</div>
          ${orders.length ? orders.map(o => `<a class="row-link" href="#/order/${encodeURIComponent(o.id)}">
              <div class="grow"><b>${esc(o.order_no)}</b> <span class="muted small">${esc(fmtDateTime(o.created_at))}</span>
              <div class="shop-meta">${o.status === 'Cancelled' ? tag('Cancelled', 'red') : hqTag(o.hq_status) + paidTag(o.paid)}</div></div>
              <b class="money">${rm(o.total)}</b></a>`).join('') : empty('No orders yet.')}
        </div>
        <div class="card">
          <div class="card-head"><h3>Visits <span class="count">${visits.length}</span></h3></div>
          ${visits.length ? `<ul class="timeline">${visits.slice(0, 15).map(v => `<li><b>${esc(fmtDateTime(v.at))}</b> · ${esc(v.by || '')}${v.note ? `<div class="pre">${esc(v.note)}</div>` : ''}</li>`).join('')}</ul>` : empty('No visits logged yet. Tap "Check in" when you visit.')}
        </div>
      </div>
    </div>`;
  },
  actions: {
    toggleFav: el => toggleFav(el.dataset.id),
    edit: () => openShopForm(shopId),
    checkIn: () => checkInFlow(shopById(shopId)),
    pinHere: () => pinFlow(shopById(shopId)),
    pasteLink: () => pasteLinkFlow(shopById(shopId)),
    removePin: async () => {
      if (!(await confirmBox('Remove the saved location pin for this shop?', { ok: 'Remove', danger: true }))) return;
      dispatch('shop.patch', { id: shopId, at: nowIso(), fields: { lat: '', lng: '', pin_accuracy_m: '', pinned_at: '', pinned_by: '' } });
    },
    restore: () => { dispatch('shop.patch', { id: shopId, at: nowIso(), fields: { deleted: false } }); toast('Shop restored'); }
  }
};
