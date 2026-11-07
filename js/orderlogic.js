// Cart rules, order numbers and the WhatsApp-ready summary text.
import { V, me, productById, products, priceFor, itemsFor, logsFor, shopById, setting } from './store.js';
import { rm, shortName, fmtDateTime, nowIso, cleanAddress, uid } from './util.js';

export const BOTTLES_PER_CARTON = 6;

/* A cart line is one of:
 *   { key, kind:'carton', product_id, qty }          full carton(s) of one product
 *   { key, kind:'pail',   product_id, qty }          pail(s)
 *   { key, kind:'mixed',  mix:[{product_id,count}], qty:1 }  one mixed carton (6 bottles total)
 */
export function linePrice(line, tier) {
  if (line.kind === 'mixed') return line.mix.reduce((s, m) => { const p = productById(m.product_id); return s + (p ? priceFor(p, tier) * m.count : 0); }, 0);
  const p = productById(line.product_id);
  if (!p) return 0;
  return line.kind === 'carton' ? priceFor(p, tier) * (Number(p.units_per_pack) || BOTTLES_PER_CARTON) : priceFor(p, tier);
}

export function mixDetail(mix) {
  return mix.filter(m => m.count > 0).map(m => { const p = productById(m.product_id); return `${p ? shortName(p.name) : m.product_id} ×${m.count}`; }).join('; ');
}

export function mixSize(mix) {
  const sizes = [...new Set(mix.filter(m => m.count > 0).map(m => (productById(m.product_id) || {}).size).filter(Boolean))];
  return sizes.join('/');
}

export function cartToItems(cart, tier) {
  return cart.filter(l => l.qty > 0).map(l => {
    if (l.kind === 'mixed') {
      return { id: uid('it-'), kind: 'mixed', product_id: '', description: `Mixed carton (6 × ${mixSize(l.mix)})`, size: mixSize(l.mix), qty: l.qty, bottles: BOTTLES_PER_CARTON, unit_price: round2(linePrice(l, tier)), mix_detail: mixDetail(l.mix) };
    }
    const p = productById(l.product_id);
    return { id: uid('it-'), kind: l.kind, product_id: p.id, description: p.name + (p.grade && !p.name.includes(p.grade) ? ' ' + p.grade : ''), size: p.size, qty: l.qty, bottles: l.kind === 'carton' ? (Number(p.units_per_pack) || BOTTLES_PER_CARTON) : 1, unit_price: round2(linePrice(l, tier)), mix_detail: '' };
  });
}

// Turn saved order lines back into a cart (for editing). Mixed cartons are matched by product name.
export function itemsToCart(items) {
  const byShort = {};
  products().forEach(p => { byShort[shortName(p.name).toLowerCase()] = p.id; });
  return items.map(it => {
    if (it.kind === 'mixed') {
      const mix = String(it.mix_detail || '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
        const m = s.match(/^(.*?)\s*×\s*(\d+)$/);
        return m ? { product_id: byShort[m[1].toLowerCase()] || '', count: Number(m[2]) } : null;
      }).filter(x => x && x.product_id);
      return { key: uid('l-'), kind: 'mixed', mix, qty: Number(it.qty) || 1 };
    }
    return { key: uid('l-'), kind: it.kind, product_id: it.product_id, qty: Number(it.qty) || 0 };
  });
}

export function cartCounts(cart) {
  let cartons = 0, pails = 0;
  cart.forEach(l => { if (l.kind === 'pail') pails += l.qty; else cartons += l.qty; });
  return { cartons, pails };
}
export const cartTotal = (cart, tier) => round2(cart.reduce((s, l) => s + linePrice(l, tier) * l.qty, 0));

// ZO-261108-B01 : date + first letter of the person + running number for that person/day.
export function nextOrderNo() {
  const d = nowIso();
  const ymd = d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10);
  const initial = ((me() && me().name) || 'X').replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || 'X';
  const prefix = `ZO-${ymd}-${initial}`;
  const used = V().orders.map(o => o.order_no).filter(n => String(n).startsWith(prefix)).map(n => Number(String(n).slice(prefix.length)) || 0);
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return prefix + String(next).padStart(2, '0');
}

export const unitLabel = it => it.kind === 'pail' ? (it.qty > 1 ? 'pails' : 'pail') : (it.qty > 1 ? 'ctns' : 'ctn');

// Plain text for WhatsApp. *bold* renders in WhatsApp; it is harmless elsewhere.
export function summaryText(order) {
  const items = itemsFor(order.id);
  const logs = logsFor(order.id);
  const shop = shopById(order.shop_id) || {};
  const placed = logs.find(l => l.event === 'Order placed');
  const lines = [];
  lines.push('*ZUSS OIL — ORDER SUMMARY*');
  lines.push(`Order No: *${order.order_no}*`);
  lines.push(`Placed: ${fmtDateTime((placed && placed.at) || order.created_at)}`);
  if (order.status === 'Cancelled') lines.push('*STATUS: CANCELLED*');
  lines.push('');
  lines.push(`*Shop:* ${order.shop_name || shop.name || ''}`);
  const contact = order.contact || shop.contact;
  if (contact) lines.push(`Contact: ${contact}`);
  lines.push(`Phone: ${order.phone || shop.phone || '-'}`);
  const addr = cleanAddress(order.address || shop.address);
  if (addr) lines.push(`Address: ${addr}${shop.area && !addr.includes(shop.area) ? ', ' + shop.area : ''}`);
  lines.push(`Price: ${order.price_tier}`);
  lines.push('');
  lines.push('*Items*');
  items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.description}${it.kind !== 'mixed' && it.size ? ' ' + it.size : ''}`);
    if (it.kind === 'mixed') lines.push(`   (${it.mix_detail})`);
    lines.push(`   ${it.qty} ${unitLabel(it)} × ${rm(it.unit_price)} = ${rm(it.line_total ?? it.qty * it.unit_price)}`);
  });
  lines.push('');
  const parts = [];
  if (order.cartons) parts.push(`${order.cartons} carton${order.cartons > 1 ? 's' : ''}`);
  if (order.pails) parts.push(`${order.pails} pail${order.pails > 1 ? 's' : ''}`);
  lines.push(`Quantity: ${parts.join(' + ') || '-'}`);
  lines.push(`*TOTAL: ${rm(order.total)}*`);
  if (order.notes) { lines.push(''); lines.push(`Notes: ${order.notes}`); }
  lines.push('');
  lines.push(`Salesman: ${order.created_by || ''}`);
  lines.push(`Price list: ${setting('price_list_version', 'V2026-NR1')}`);
  if (logs.length > 1) {
    lines.push('');
    lines.push('*Log*');
    logs.forEach(l => lines.push(`• ${fmtDateTime(l.at)} — ${l.event}${l.detail ? ' (' + l.detail + ')' : ''}${l.by ? ' · ' + l.by : ''}`));
  }
  return lines.join('\n');
}

export function hqNextStatus(current) {
  const flow = ['Not submitted', 'Submitted', 'Processing', 'Fulfilled'];
  const i = flow.indexOf(current);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
}

const round2 = n => Math.round(n * 100) / 100;
