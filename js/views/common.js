import { esc, hasPin, haversineKm, relDays, fmtDate, fmtDateTime, today, rm } from '../util.js';
import { isFav, lastVisit, ordersFor, dispatch, tierOf } from '../store.js';
import { stageTag, tag } from '../ui.js';
import { lastPosition } from '../geo.js';

export function star(shop) {
  const on = isFav(shop.id);
  return `<button class="star ${on ? 'on' : ''}" data-act="toggleFav" data-id="${esc(shop.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} favourites">${on ? '★' : '☆'}</button>`;
}

export function toggleFav(id) {
  dispatch('fav.set', { shop_id: id, on: !isFav(id) });
}

export function distanceKm(shop) {
  const p = lastPosition();
  if (!p || !hasPin(shop)) return null;
  return haversineKm(p.lat, p.lng, Number(shop.lat), Number(shop.lng));
}
export const fmtKm = km => km == null ? '' : (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);

export function shopRow(s) {
  const lv = lastVisit(s.id);
  const lo = ordersFor(s.id).find(o => o.status !== 'Cancelled');
  const km = distanceKm(s);
  let fu = '';
  if (s.follow_up) {
    const t = today();
    const cls = s.follow_up < t ? 'overdue' : s.follow_up === t ? 'due' : '';
    fu = `<div class="si ${cls}"><span class="si-ic">📅</span><span>Follow-up <b>${esc(fmtDate(s.follow_up))}</b> <span class="si-rel">(${esc(relDays(s.follow_up))})</span></span></div>`;
  }
  const visit = lv
    ? `<div class="si"><span class="si-ic">📝</span><span><b>${esc(fmtDateTime(lv.at))}</b> · ${esc(lv.by || '')}${lv.note ? `<span class="si-note">${esc(lv.note)}</span>` : ' <span class="muted">(no note)</span>'}</span></div>`
    : '';
  const order = lo
    ? `<div class="si"><span class="si-ic">🧾</span><span>Last order <b>${esc(fmtDate(lo.created_at))}</b> · ${rm(lo.total)} · ${esc(lo.hq_status)}</span></div>`
    : '';
  return `<div class="shop-row">
    ${star(s)}
    <a class="shop-main" href="#/shop/${encodeURIComponent(s.id)}">
      <div class="shop-name">${esc(s.name)}</div>
      <div class="shop-meta">
        ${stageTag(s.stage)}
        ${s.stockist ? tag('Stockist', 'gold') : ''}
        ${s.area ? tag(s.area, 'area') : ''}
        ${hasPin(s) ? tag(km != null ? '📍 ' + fmtKm(km) : '📍 Pinned', 'pin') : ''}
      </div>
      <div class="shop-sub">${esc(s.phone || 'No phone')}${s.contact ? ' · ' + esc(s.contact) : ''}${!lv ? ' · <span class="muted">not visited yet</span>' : ''}</div>
      ${fu || visit || order ? `<div class="shop-info">${fu}${visit}${order}</div>` : ''}
    </a>
  </div>`;
}

export const tierTag = shop => tierOf(shop) === 'Stockist' ? tag('Stockist price', 'gold') : tag('Non-stockist price', '');

export const hqTag = s => {
  const cls = { 'Not submitted': 'grey', 'Submitted': 'blue', 'Processing': 'amber', 'Fulfilled': 'green' }[s] || 'grey';
  return tag('HQ: ' + s, cls);
};
export const paidTag = paid => paid ? tag('Paid', 'green') : tag('Unpaid', 'red');

export const dateOnly = iso => fmtDate(iso);
