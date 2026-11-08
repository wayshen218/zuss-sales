// Small shared helpers: formatting, dates, ids, geo, links.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const rm = n => 'RM' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rm0 = n => 'RM' + Number(n || 0).toLocaleString('en-MY', { maximumFractionDigits: 0 });

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const pad = n => String(n).padStart(2, '0');

// Local time with offset, e.g. 2026-11-08T10:32:15+08:00 (what the Sheet stores).
export function nowIso(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
export const today = () => nowIso().slice(0, 10);
export const thisMonth = () => nowIso().slice(0, 7);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Format stored ISO text without re-interpreting time zones: "08 Nov 2026, 10:32 AM"
export function fmtDateTime(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return String(iso);
  const d = `${m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
  if (!m[4]) return d;
  let h = +m[4]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${d}, ${h}:${m[5]} ${ap}`;
}
export function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : String(iso);
}
export function fmtMonth(ym) {
  const m = String(ym).match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : ym;
}
export function shiftMonth(ym, delta) {
  let [y, m] = ym.split('-').map(Number);
  m += delta; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; }
  return `${y}-${pad(m)}`;
}
export function relDays(isoDate) {
  if (!isoDate) return '';
  const a = new Date(isoDate.slice(0, 10) + 'T00:00:00'), b = new Date(today() + 'T00:00:00');
  const d = Math.round((a - b) / 864e5);
  if (d === 0) return 'today';
  if (d === -1) return 'yesterday';
  if (d === 1) return 'tomorrow';
  return d < 0 ? `${-d} days ago` : `in ${d} days`;
}

export const digits = s => String(s || '').replace(/\D/g, '');
// Normalise Malaysian numbers for comparing: 6012..., +6012..., 012... → 012...
export function normPhone(s) {
  let d = digits(s);
  if (d.startsWith('60')) d = '0' + d.slice(2);
  return d;
}
export function waNumber(s) {
  let d = digits(s);
  if (!d) return '';
  if (d.startsWith('0')) d = '6' + d;
  return d;
}
export const telLink = s => 'tel:' + digits(s);
export const waLink = (s, text) => `https://wa.me/${waNumber(s)}${text ? '?text=' + encodeURIComponent(text) : ''}`;

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toR = x => x * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
// The shop's pin as clean numbers, or null. Accepts numbers or text (incl. comma decimals like "6,1254"),
// and fixes latitude/longitude saved the wrong way round (latitude can never be above 90).
export function pinOf(s) {
  if (!s || s.lat === '' || s.lng === '' || s.lat == null || s.lng == null) return null;
  const num = v => Number(String(v).trim().replace(/\s/g, '').replace(/^(-?\d+),(\d+)$/, '$1.$2'));
  let lat = num(s.lat), lng = num(s.lng);
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
export const hasPin = s => !!pinOf(s);

export function cleanAddress(a) { return String(a || '').replace(/\s*\(area only\)\s*/i, '').trim(); }
export function navQuery(shop) {
  return [shop.name, cleanAddress(shop.address), shop.area, shop.state || 'Kelantan', 'Malaysia'].filter(Boolean).join(', ');
}
// Clean "lat,lng" text: plain numbers, max 6 decimals (Waze rejects odd formats).
export function latLngText(shop) {
  const p = pinOf(shop);
  return `${+p.lat.toFixed(6)},${+p.lng.toFixed(6)}`;
}
// Same format Waze produces when you share a place from the Waze app.
export function wazeLink(shop) {
  return hasPin(shop)
    ? `https://ul.waze.com/ul?ll=${encodeURIComponent(latLngText(shop))}&navigate=yes&zoom=17`
    : `https://ul.waze.com/ul?q=${encodeURIComponent(navQuery(shop))}&navigate=yes`;
}
export function gmapsLink(shop) {
  return hasPin(shop)
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(latLngText(shop))}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navQuery(shop))}&travelmode=driving`;
}

// App links that open the Waze / Google Maps apps directly (used on iPhone, where web links
// opened from a home-screen app land in a mini browser instead of the app).
export function navAppLink(shop, app) {
  const pin = hasPin(shop);
  const dest = pin ? latLngText(shop) : encodeURIComponent(navQuery(shop));
  if (app === 'waze') return pin ? `waze://?ll=${dest}&navigate=yes` : `waze://?q=${dest}&navigate=yes`;
  return `comgooglemaps://?daddr=${dest}&directionsmode=driving`;
}
// Web fallback that just shows the place (no route), which works in any browser.
export function navWebFallback(shop, app) {
  if (app === 'waze') return wazeLink(shop);
  const q = hasPin(shop) ? latLngText(shop) : navQuery(shop);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Parse a pasted Google Maps link or "lat, lng" text locally. Short links need the server.
export function parseLatLng(s) {
  s = String(s || '');
  try { s = decodeURIComponent(s); } catch (e) { /* keep raw */ }
  const pats = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:center|markers)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{2,3}\.\d+)\s*$/];
  for (const p of pats) {
    const m = s.match(p);
    if (m) { const lat = +m[1], lng = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; }
  }
  return null;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-1000px';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove(); return ok;
}

export const shortName = name => String(name || '').replace(/^ZUSS\s+/i, '');
export const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
