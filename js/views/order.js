// Product catalogue + cart for a shop (new order or editing an existing one).
import { esc, rm, rm0, shortName, nowIso, uid, cleanAddress } from '../util.js';
import { shopById, products, productById, priceFor, tierOf, dispatch, orderById, itemsFor, settingBool, setting, isPendingOrder } from '../store.js';
import { empty, toast, go, openSheet, updateSheet, closeSheet, confirmBox, render, tag } from '../ui.js';
import { linePrice, cartToItems, itemsToCart, cartCounts, cartTotal, nextOrderNo, mixDetail, BOTTLES_PER_CARTON } from '../orderlogic.js';

let ctx = null;   // { mode:'new'|'edit', shopId, orderId, key }
let cart = [];
let cat = '';
let notes = '';
let eligible = true;

const draftKey = () => 'zuss.cart.' + ctx.key;
const saveDraft = () => { try { localStorage.setItem(draftKey(), JSON.stringify({ cart, notes, eligible })); } catch (e) { /* ignore */ } };
const clearDraft = () => localStorage.removeItem(draftKey());
function loadCtx(mode, id) {
  const key = mode + ':' + id;
  if (ctx && ctx.key === key) return;
  if (mode === 'new') ctx = { mode, shopId: id, key };
  else { const o = orderById(id); ctx = { mode, orderId: id, shopId: o && o.shop_id, key }; }
  cat = '';
  let d = null; try { d = JSON.parse(localStorage.getItem('zuss.cart.' + key)); } catch (e) { d = null; }
  if (d) { cart = d.cart || []; notes = d.notes || ''; eligible = d.eligible !== false; }
  else if (mode === 'edit') {
    const o = orderById(id);
    cart = o ? itemsToCart(itemsFor(id)) : [];
    notes = (o && o.notes) || ''; eligible = !o || o.commission_eligible !== false;
  } else { cart = []; notes = ''; eligible = true; }
}

const tier = () => {
  if (ctx.mode === 'edit') { const o = orderById(ctx.orderId); return o ? o.price_tier : 'Non-stockist'; }
  return tierOf(shopById(ctx.shopId));
};
const qtyOf = (pid, kind) => { const l = cart.find(x => x.kind === kind && x.product_id === pid); return l ? l.qty : 0; };
function setQty(pid, kind, q) {
  q = Math.max(0, Math.min(999, q | 0));
  let l = cart.find(x => x.kind === kind && x.product_id === pid);
  if (!l && q) cart.push({ key: uid('l-'), kind, product_id: pid, qty: q });
  else if (l) { if (q) l.qty = q; else cart = cart.filter(x => x !== l); }
  saveDraft();
}

const CATS = [['', 'All'], ['Passenger', '4L Passenger'], ['Racing', '5L Racing'], ['Diesel', 'Diesel pails']];

function productCard(p, t) {
  const kind = p.pack === 'pail' ? 'pail' : 'carton';
  const per = Number(p.units_per_pack) || BOTTLES_PER_CARTON;
  const unit = priceFor(p, t);
  const packPrice = kind === 'carton' ? unit * per : unit;
  const margin = (Number(p.list_price) - unit) * (kind === 'carton' ? per : 1);
  const q = qtyOf(p.id, kind);
  return `<div class="prod ${q ? 'in-cart' : ''}">
    <div class="prod-img"><img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span class="size-badge">${esc(p.size)}</span></div>
    <div class="prod-body">
      <div class="prod-name">${esc(shortName(p.name))}</div>
      <div class="prod-type">${esc(p.type)}${p.grade && !p.name.includes(p.grade) ? ' · ' + esc(p.grade) : ''}</div>
      <div class="prod-spec">${esc(p.spec)}</div>
      <div class="prod-price"><b>${rm0(packPrice)}</b> <span>/ ${kind === 'carton' ? 'carton' : 'pail'}</span></div>
      <div class="prod-sub">${kind === 'carton' ? `${rm0(unit)}/bottle × ${per} · ` : ''}List ${rm0(p.list_price)}${kind === 'carton' ? '/btl' : ''}</div>
      <div class="prod-margin">Shop margin ≈ ${rm0(margin)}/${kind === 'carton' ? 'ctn' : 'pail'}</div>
    </div>
    <div class="stepper" role="group" aria-label="${esc(p.name)} quantity">
      <button data-act="dec" data-id="${esc(p.id)}" data-kind="${kind}" ${q ? '' : 'disabled'} aria-label="Less">−</button>
      <input id="q_${esc(p.id)}" value="${q || ''}" placeholder="0" inputmode="numeric" data-change="typed" data-id="${esc(p.id)}" data-kind="${kind}" aria-label="Quantity">
      <button data-act="inc" data-id="${esc(p.id)}" data-kind="${kind}" aria-label="More">＋ ${kind === 'carton' ? 'ctn' : 'pail'}</button>
    </div>
  </div>`;
}

/* ───────── Mixed carton builder ───────── */
function openMixer(editKey) {
  const t = tier();
  const allow45 = settingBool('mix_4l_5l_together', false);
  const existing = editKey ? cart.find(l => l.key === editKey) : null;
  const counts = {};
  (existing ? existing.mix : []).forEach(m => { counts[m.product_id] = m.count; });
  const cartonProds = products().filter(p => p.pack !== 'pail');
  const total = () => Object.values(counts).reduce((a, b) => a + b, 0);
  const lockedSize = () => { if (allow45) return null; const pid = Object.keys(counts).find(k => counts[k] > 0); return pid ? productById(pid).size : null; };
  const price = () => cartonProds.reduce((s, p) => s + (counts[p.id] || 0) * priceFor(p, t), 0);
  const html = () => {
    const n = total(), lock = lockedSize();
    return `<p class="small muted">Pick any ${BOTTLES_PER_CARTON} bottles. ${allow45 ? '' : '4L and 5L cannot be mixed in one carton.'} Price = sum of the bottle prices (${esc(t)}).</p>
    <div class="mix-count ${n === BOTTLES_PER_CARTON ? 'ok' : ''}"><b>${n} / ${BOTTLES_PER_CARTON}</b> bottles · ${rm(price())}</div>
    <div class="mix-list">${cartonProds.map(p => {
      const c = counts[p.id] || 0;
      const blocked = (lock && p.size !== lock && !c);
      return `<div class="mix-row ${blocked ? 'blocked' : ''}">
        <img src="${esc(p.image)}" alt="" loading="lazy">
        <div class="grow"><b>${esc(shortName(p.name))}</b> <span class="muted small">${esc(p.size)} · ${rm0(priceFor(p, t))}/btl</span></div>
        <div class="stepper sm"><button data-act="mDec" data-id="${p.id}" ${c ? '' : 'disabled'}>−</button><span>${c}</span><button data-act="mInc" data-id="${p.id}" ${(n >= BOTTLES_PER_CARTON || blocked) ? 'disabled' : ''}>＋</button></div>
      </div>`;
    }).join('')}</div>
    <div class="sheet-actions">
      ${existing ? '<button class="btn danger ghost" data-act="mRemove">Remove</button>' : ''}
      <button class="btn cta grow" data-act="mSave" ${n === BOTTLES_PER_CARTON ? '' : 'disabled'}>${n === BOTTLES_PER_CARTON ? (existing ? 'Update mixed carton' : 'Add mixed carton') : `Add ${BOTTLES_PER_CARTON - n} more bottle${BOTTLES_PER_CARTON - n > 1 ? 's' : ''}`}</button>
    </div>`;
  };
  openSheet({
    title: existing ? 'Edit mixed carton' : 'Mixed carton',
    html: html(),
    actions: {
      mInc: el => { counts[el.dataset.id] = (counts[el.dataset.id] || 0) + 1; updateSheet(html()); },
      mDec: el => { counts[el.dataset.id] = Math.max(0, (counts[el.dataset.id] || 0) - 1); updateSheet(html()); },
      mRemove: () => { cart = cart.filter(l => l.key !== editKey); saveDraft(); closeSheet(); render(); },
      mSave: () => {
        const mix = Object.keys(counts).filter(k => counts[k] > 0).map(k => ({ product_id: k, count: counts[k] }));
        if (existing) existing.mix = mix; else cart.push({ key: uid('l-'), kind: 'mixed', mix, qty: 1 });
        saveDraft(); closeSheet(); render(); toast('Mixed carton added');
      }
    }
  });
}

/* ───────── Review & confirm ───────── */
function reviewHtml() {
  const t = tier();
  const c = cartCounts(cart);
  if (!cart.length) return empty('Cart is empty.');
  return `<div class="review">
    ${cart.map(l => {
      const p = productById(l.product_id);
      const name = l.kind === 'mixed' ? 'Mixed carton' : shortName(p ? p.name : l.product_id) + (p ? ' ' + p.size : '');
      const unitTxt = l.kind === 'pail' ? 'pail' : 'ctn';
      return `<div class="rv-line">
        <div class="grow"><b>${esc(name)}</b>${l.kind === 'mixed' ? `<div class="small muted">${esc(mixDetail(l.mix))}</div>` : ''}
          <div class="small muted">${rm(linePrice(l, t))} / ${unitTxt}</div></div>
        ${l.kind === 'mixed'
          ? `<button class="btn ghost small" data-act="editMix" data-key="${l.key}">Edit</button>`
          : `<div class="stepper sm"><button data-act="rvDec" data-key="${l.key}">−</button><span>${l.qty}</span><button data-act="rvInc" data-key="${l.key}">＋</button></div>`}
        <b class="money">${rm(linePrice(l, t) * l.qty)}</b>
      </div>`;
    }).join('')}
    <div class="rv-total"><span>${c.cartons} carton${c.cartons === 1 ? '' : 's'}${c.pails ? ` + ${c.pails} pail${c.pails === 1 ? '' : 's'}` : ''} · ${esc(t)} price</span><b>${rm(cartTotal(cart, t))}</b></div>
    <label>Notes for this order (optional)<textarea id="rvNotes" rows="2" placeholder="Delivery time, special request…">${esc(notes)}</textarea></label>
    <label class="switch-row"><span>Counts toward commission estimate</span><input id="rvElig" type="checkbox" role="switch" ${eligible ? 'checked' : ''}></label>
    <div class="sheet-actions">
      <button class="btn ghost" data-act="closeSheet">Keep adding</button>
      <button class="btn cta grow" data-act="confirm">${ctx.mode === 'edit' ? 'Save changes' : '✓ Confirm order'}</button>
    </div>
  </div>`;
}

function openReview() {
  const keepFields = () => {
    const n = document.getElementById('rvNotes'); if (n) notes = n.value;
    const e = document.getElementById('rvElig'); if (e) eligible = e.checked;
    saveDraft();
  };
  const bump = (key, d) => { keepFields(); const l = cart.find(x => x.key === key); if (!l) return; l.qty += d; if (l.qty <= 0) cart = cart.filter(x => x !== l); saveDraft(); updateSheet(reviewHtml()); render(); };
  openSheet({
    title: ctx.mode === 'edit' ? 'Review changes' : 'Review order',
    html: reviewHtml(),
    onClose: () => { render(); },
    actions: {
      rvInc: el => bump(el.dataset.key, 1),
      rvDec: el => bump(el.dataset.key, -1),
      editMix: el => { keepFields(); closeSheet(); openMixer(el.dataset.key); },
      confirm: async el => { keepFields(); await confirmOrder(el); }
    }
  });
}

async function confirmOrder(btn) {
  const t = tier();
  if (!cart.length) { toast('Cart is empty', 'error'); return; }
  const items = cartToItems(cart, t);
  const at = nowIso();
  btn.disabled = true;
  if (ctx.mode === 'edit') {
    const o = orderById(ctx.orderId);
    if (!o) { toast('Order not found', 'error'); return; }
    if (o.hq_status !== 'Not submitted' || o.status === 'Cancelled') { toast('This order can no longer be edited', 'error'); btn.disabled = false; return; }
    const newTotal = cartTotal(cart, t);
    dispatch('order.update', { order_id: o.id, items, notes, commission_eligible: eligible, log: { id: uid('lg-'), at, event: 'Order edited', detail: `Total ${rm(o.total)} → ${rm(newTotal)}` } });
    clearDraft(); const id = o.id; ctx = null;
    toast('Order updated');
    go('#/order/' + encodeURIComponent(id));
    return;
  }
  const s = shopById(ctx.shopId);
  const order = {
    id: uid('ord-'), order_no: nextOrderNo(), shop_id: s.id, shop_name: s.name, contact: s.contact || '', phone: s.phone || '',
    address: [cleanAddress(s.address), s.area].filter(Boolean).join(', '), price_tier: t, commission_eligible: eligible, notes, created_at: at
  };
  dispatch('order.create', { order, items, log: { id: uid('lg-'), at, event: 'Order placed', detail: `${items.length} line${items.length > 1 ? 's' : ''}, ${rm(cartTotal(cart, t))}` } });
  if (s.stage !== 'Won') {
    // First order: move the shop to Won (keeps its stockist setting as is).
    dispatch('shop.patch', { id: s.id, at, fields: { stage: 'Won' } });
  }
  clearDraft(); ctx = null; cart = [];
  go('#/order/' + encodeURIComponent(order.id) + '?new=1');
}

export const orderNewView = {
  tab: 'orders',
  back: true,
  title: () => 'New order',
  render(p) {
    loadCtx('new', p.shopId);
    const s = shopById(p.shopId);
    if (!s) return empty('Shop not found.');
    return body(s);
  },
  actions: null
};

export const orderEditView = {
  tab: 'orders',
  back: true,
  title: () => 'Edit order',
  render(p) {
    loadCtx('edit', p.id);
    const o = orderById(p.id);
    if (!o) return empty('Order not found.');
    if (o.hq_status !== 'Not submitted' || o.status === 'Cancelled') return empty('This order can no longer be edited (already submitted to HQ or cancelled).', `<div class="mt"><a class="btn" href="#/order/${encodeURIComponent(o.id)}">Back to order</a></div>`);
    return `<div class="banner">Editing <b>${esc(o.order_no)}</b> — prices stay at ${esc(o.price_tier)}.</div>` + body(shopById(o.shop_id) || { name: o.shop_name, id: o.shop_id });
  },
  actions: null
};

function body(s) {
  const t = tier();
  const list = products().filter(p => !cat || p.category === cat);
  const c = cartCounts(cart);
  const mixes = cart.filter(l => l.kind === 'mixed');
  const mixedOn = settingBool('mixed_carton_enabled', true);
  return `
  <div class="card order-head">
    <div class="grow"><div class="muted small">Order for</div><h2>${esc(s.name)}</h2></div>
    ${t === 'Stockist' ? tag('Stockist price', 'gold') : tag('Non-stockist price', '')}
  </div>
  <div class="chips sticky-chips">${CATS.map(([k, label]) => `<button class="chip ${cat === k ? 'on' : ''}" data-act="cat" data-v="${k}">${label}</button>`).join('')}</div>
  ${mixedOn && cat !== 'Diesel' ? `<div class="card mix-card">
      <div class="grow"><b>Mixed carton</b><div class="small muted">Any ${BOTTLES_PER_CARTON} bottles of different products in one carton</div>
      ${mixes.length ? `<div class="mix-chips">${mixes.map((m, i) => `<button class="chip on" data-act="editMix" data-key="${m.key}">#${i + 1}: ${esc(mixDetail(m.mix))}</button>`).join('')}</div>` : ''}</div>
      <button class="btn" data-act="newMix">＋ Mixed</button></div>` : ''}
  <div class="prod-grid">${list.map(p => productCard(p, t)).join('')}</div>
  <p class="small muted center">Prices: ${esc(setting('price_list_version', 'V2026-NR1'))} · 4L/5L sold per carton of 6 · 8L/18L per pail</p>
  <div class="cartbar ${cart.length ? 'show' : ''}">
    <div class="grow"><b>${rm(cartTotal(cart, t))}</b><div class="small">${c.cartons} ctn${c.pails ? ` · ${c.pails} pail${c.pails > 1 ? 's' : ''}` : ''}</div></div>
    <button class="btn ghost light small" data-act="clearCart">Clear</button>
    <button class="btn cta" data-act="review">Review ▸</button>
  </div>`;
}

const actions = {
  cat: el => { cat = el.dataset.v; render(); },
  inc: el => { setQty(el.dataset.id, el.dataset.kind, qtyOf(el.dataset.id, el.dataset.kind) + 1); render(); },
  dec: el => { setQty(el.dataset.id, el.dataset.kind, qtyOf(el.dataset.id, el.dataset.kind) - 1); render(); },
  typed: el => { setQty(el.dataset.id, el.dataset.kind, Number(el.value) || 0); render(); },
  newMix: () => openMixer(null),
  editMix: el => openMixer(el.dataset.key),
  review: () => openReview(),
  clearCart: async () => { if (await confirmBox('Remove everything from the cart?', { ok: 'Clear', danger: true })) { cart = []; saveDraft(); render(); } }
};
orderNewView.actions = actions;
orderEditView.actions = actions;
