import { esc, normPhone, digits, hasPin } from '../util.js';
import { activeShops, STAGES, lastVisit, isFav } from '../store.js';
import { empty, toast, render } from '../ui.js';
import { shopRow, toggleFav, distanceKm } from './common.js';
import { openShopForm } from './shopform.js';
import { quickPosition, geoErrorText } from '../geo.js';

const st = { q: '', stage: '', area: '', filter: '', sort: 'name' };

function matches(s, q) {
  if (!q) return true;
  const t = q.toLowerCase();
  const qd = digits(q);
  return (s.name || '').toLowerCase().includes(t) || (s.contact || '').toLowerCase().includes(t) ||
    (s.area || '').toLowerCase().includes(t) || (s.address || '').toLowerCase().includes(t) ||
    (qd.length >= 3 && normPhone(s.phone).includes(normPhone(qd)));
}

function list() {
  let rows = activeShops().filter(s => matches(s, st.q) && (!st.stage || s.stage === st.stage) && (!st.area || s.area === st.area));
  if (st.filter === 'fav') rows = rows.filter(s => isFav(s.id));
  if (st.filter === 'stockist') rows = rows.filter(s => s.stockist);
  if (st.filter === 'pinned') rows = rows.filter(s => hasPin(s));
  if (st.filter === 'unpinned') rows = rows.filter(s => !hasPin(s));
  if (st.filter === 'nophone') rows = rows.filter(s => !digits(s.phone));
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    nearest: (a, b) => (distanceKm(a) ?? 1e9) - (distanceKm(b) ?? 1e9) || a.name.localeCompare(b.name),
    followup: (a, b) => (a.follow_up || '9999').localeCompare(b.follow_up || '9999') || a.name.localeCompare(b.name),
    visited: (a, b) => String((lastVisit(b.id) || {}).at || '').localeCompare(String((lastVisit(a.id) || {}).at || '')) || a.name.localeCompare(b.name),
    updated: (a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
  };
  return rows.sort(by[st.sort] || by.name);
}

export default {
  tab: 'shops',
  title: 'Shops',
  render() {
    const all = activeShops();
    const areas = [...new Set(all.map(s => s.area).filter(Boolean))].sort();
    const rows = list();
    const counts = STAGES.map(x => [x, all.filter(s => s.stage === x).length]);
    return `
    <div class="toolbar sticky">
      <input id="shopSearch" type="search" placeholder="Search name, phone, area, contact…" value="${esc(st.q)}" data-input="search" autocomplete="off" enterkeyhint="search">
      <div class="filters">
        <select id="fStage" data-change="setStage" aria-label="Stage"><option value="">All stages</option>${STAGES.map(x => `<option ${st.stage === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <select id="fArea" data-change="setArea" aria-label="Area"><option value="">All areas</option>${areas.map(a => `<option ${st.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        <select id="fFilter" data-change="setFilter" aria-label="Show">
          <option value="">Show all</option>
          <option value="fav" ${st.filter === 'fav' ? 'selected' : ''}>★ Favourites</option>
          <option value="stockist" ${st.filter === 'stockist' ? 'selected' : ''}>Stockists</option>
          <option value="pinned" ${st.filter === 'pinned' ? 'selected' : ''}>Pinned location</option>
          <option value="unpinned" ${st.filter === 'unpinned' ? 'selected' : ''}>Not pinned yet</option>
          <option value="nophone" ${st.filter === 'nophone' ? 'selected' : ''}>No phone number</option>
        </select>
        <select id="fSort" data-change="setSort" aria-label="Sort">
          <option value="name" ${st.sort === 'name' ? 'selected' : ''}>Sort: A–Z</option>
          <option value="nearest" ${st.sort === 'nearest' ? 'selected' : ''}>Sort: Nearest to me</option>
          <option value="followup" ${st.sort === 'followup' ? 'selected' : ''}>Sort: Follow-up date</option>
          <option value="visited" ${st.sort === 'visited' ? 'selected' : ''}>Sort: Recently visited</option>
          <option value="updated" ${st.sort === 'updated' ? 'selected' : ''}>Sort: Recently updated</option>
        </select>
      </div>
    </div>
    <div class="stage-strip">${counts.map(([k, n]) => `<button class="chip ${st.stage === k ? 'on' : ''}" data-act="chipStage" data-v="${k}">${k} <b>${n}</b></button>`).join('')}</div>
    <p class="muted small">Showing ${rows.length} of ${all.length} shops${st.sort === 'nearest' ? ' · distance is straight-line to pinned shops' : ''}</p>
    <div class="card list">${rows.length ? rows.map(shopRow).join('') : empty(st.q ? 'No shop matches "' + st.q + '".' : 'No shops match these filters.', `<div class="mt"><button class="btn" data-act="addShop">+ Add a new shop</button></div>`)}</div>
    <button class="fab" data-act="addShop" aria-label="Add shop">＋</button>`;
  },
  actions: {
    search: el => { st.q = el.value; render(); },
    setStage: el => { st.stage = el.value; render(); },
    chipStage: el => { st.stage = st.stage === el.dataset.v ? '' : el.dataset.v; render(); },
    setArea: el => { st.area = el.value; render(); },
    setFilter: el => { st.filter = el.value; render(); },
    setSort: async el => {
      st.sort = el.value;
      if (st.sort === 'nearest') {
        toast('Getting your location…');
        try { await quickPosition(); } catch (e) { toast(geoErrorText(e), 'error'); }
      }
      render();
    },
    toggleFav: el => toggleFav(el.dataset.id),
    addShop: () => openShopForm(null)
  }
};
