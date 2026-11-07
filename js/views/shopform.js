// Add / edit shop form (bottom sheet).
import { esc, normPhone, nowIso, uid } from '../util.js';
import { dispatch, shopById, activeShops, STAGES, AREAS } from '../store.js';
import { openSheet, closeSheet, confirmBox, toast, go } from '../ui.js';

const FIELDS = ['name', 'contact', 'phone', 'address', 'area', 'state', 'stage', 'stockist', 'follow_up', 'potential_value', 'notes'];

export function openShopForm(id, { afterSave } = {}) {
  const s = id ? shopById(id) : null;
  const v = s || { stage: 'New', stockist: false, state: 'Kelantan', area: '' };
  const areaKnown = !v.area || AREAS.includes(v.area);
  const html = `
  <form id="shopForm" class="form" autocomplete="off" onsubmit="return false">
    <label>Shop name *<input id="f_name" value="${esc(v.name)}" required placeholder="e.g. Ah Seng Auto Service"></label>
    <div class="grid2">
      <label>Contact person<input id="f_contact" value="${esc(v.contact)}" placeholder="Owner / buyer"></label>
      <label>Phone / WhatsApp<input id="f_phone" value="${esc(v.phone)}" inputmode="tel" placeholder="012-345 6789"></label>
    </div>
    <label>Address<input id="f_address" value="${esc(v.address)}" placeholder="Lot / street / kampung"></label>
    <div class="grid2">
      <label>Area
        <select id="f_area" data-change="areaChanged">
          <option value="">Choose…</option>
          ${AREAS.map(a => `<option ${v.area === a ? 'selected' : ''}>${a}</option>`).join('')}
          <option value="__other" ${!areaKnown ? 'selected' : ''}>Other…</option>
        </select>
      </label>
      <label id="f_areaOtherWrap" ${areaKnown ? 'hidden' : ''}>Other area<input id="f_areaOther" value="${areaKnown ? '' : esc(v.area)}"></label>
      <label>State
        <select id="f_state">${['Kelantan', 'Terengganu'].map(x => `<option ${v.state === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
      </label>
    </div>
    <div class="grid2">
      <label>Stage<select id="f_stage">${STAGES.map(x => `<option ${v.stage === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Next follow-up<input id="f_follow_up" type="date" value="${esc(v.follow_up)}"></label>
    </div>
    <div class="grid2">
      <label>Potential order (RM)<input id="f_potential_value" type="number" min="0" step="1" inputmode="decimal" value="${esc(v.potential_value)}"></label>
      <label class="switch-row"><span>Stockist (gets stockist prices)</span><input id="f_stockist" type="checkbox" role="switch" ${v.stockist ? 'checked' : ''}></label>
    </div>
    <label>Notes<textarea id="f_notes" rows="3" placeholder="What was discussed, next action…">${esc(v.notes)}</textarea></label>
    <div class="sheet-actions">
      ${s ? `<button type="button" class="btn danger ghost" data-act="removeShop">Remove shop</button>` : ''}
      <button type="button" class="btn primary grow" data-act="saveShop">${s ? 'Save changes' : 'Add shop'}</button>
    </div>
  </form>`;

  openSheet({
    title: s ? 'Edit shop' : 'Add shop',
    html,
    actions: {
      areaChanged: el => {
        document.getElementById('f_areaOtherWrap').hidden = el.value !== '__other';
        if (el.value === 'Besut') document.getElementById('f_state').value = 'Terengganu';
        else if (el.value && el.value !== '__other') document.getElementById('f_state').value = 'Kelantan';
      },
      saveShop: async () => {
        const val = k => document.getElementById('f_' + k);
        const rec = {
          name: val('name').value.trim(),
          contact: val('contact').value.trim(),
          phone: val('phone').value.trim(),
          address: val('address').value.trim(),
          area: val('area').value === '__other' ? val('areaOther').value.trim() : val('area').value,
          state: val('state').value,
          stage: val('stage').value,
          stockist: val('stockist').checked,
          follow_up: val('follow_up').value,
          potential_value: val('potential_value').value === '' ? '' : Number(val('potential_value').value),
          notes: val('notes').value.trim()
        };
        if (!rec.name) { toast('Shop name is required', 'error'); val('name').focus(); return; }
        const p = normPhone(rec.phone);
        if (p.length >= 7) {
          const dup = activeShops().find(x => x.id !== (s && s.id) && normPhone(x.phone) === p);
          if (dup && !(await confirmBox(`${dup.name}${dup.area ? ' (' + dup.area + ')' : ''} already has this phone number.\n\nSave anyway?`, { title: 'Possible duplicate', ok: 'Save anyway' }))) return;
        }
        if (rec.stage === 'Won' && !rec.stockist && (!s || s.stage !== 'Won')) {
          rec.stockist = await confirmBox('Has this shop become a stockist?\n\nYES = future orders use stockist prices.', { title: 'Deal won', ok: 'Yes, stockist', cancel: 'No' });
        }
        const fields = {};
        FIELDS.forEach(k => { if (!s || String(s[k] ?? '') !== String(rec[k] ?? '')) fields[k] = rec[k]; });
        const newId = s ? s.id : uid('shop-');
        if (!s || Object.keys(fields).length) dispatch('shop.patch', { id: newId, at: nowIso(), fields: s ? fields : rec });
        closeSheet();
        toast(s ? 'Shop updated' : 'Shop added');
        if (afterSave) afterSave(newId); else if (!s) go('#/shop/' + encodeURIComponent(newId));
      },
      removeShop: async () => {
        if (!(await confirmBox(`Remove "${s.name}" from the list?\n\nIts orders and visits are kept. You can restore it from More → Removed shops.`, { title: 'Remove shop', ok: 'Remove', danger: true }))) return;
        dispatch('shop.patch', { id: s.id, at: nowIso(), fields: { deleted: true } });
        closeSheet();
        toast('Shop removed');
        go('#/shops');
      }
    }
  });
}
