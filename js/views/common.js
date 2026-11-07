import { esc, hasPin, haversineKm, relDays, fmtDate, today } from '../util.js';
import { isFav, lastVisit, dispatch, tierOf } from '../store.js';
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
  const km = distanceKm(s);
  const due = s.follow_up && s.follow_up <= today() && !['Won', 'Lost'].includes(s.stage);
  return `<div class="shop-row">
    ${star(s)}
    <a class="shop-main" href="#/shop/${encodeURIComponent(s.id)}">
      <div class="shop-name">${esc(s.name)}</div>
      <div class="shop-meta">
        ${stageTag(s.stage)}
        ${s.stockist ? tag('Stockist', 'gold') : ''}
        ${s.area ? tag(s.area, 'area') : ''}
        ${hasPin(s) ? tag(km != null ? '📍 ' + fmtKm(km) : '📍 Pinned', 'pin') : ''}
        ${due ? tag('Follow-up ' + relDays(s.follow_up), 'warn') : ''}
      </div>
      <div class="shop-sub">${esc(s.phone || 'No phone')}${s.contact ? ' · ' + esc(s.contact) : ''}${lv ? ' · Visited ' + esc(relDays(lv.at)) : ''}</div>
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
