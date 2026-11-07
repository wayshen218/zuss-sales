import { esc, rm0, shortName } from '../util.js';
import { products, priceFor, setting } from '../store.js';
import { render, tag } from '../ui.js';

let tier = 'Non-stockist';
let q = '';

export default {
  tab: 'prices',
  title: 'Prices',
  render() {
    const t = q.toLowerCase();
    const list = products().filter(p => !t || `${p.name} ${p.grade} ${p.type} ${p.size}`.toLowerCase().includes(t));
    const groups = [['Passenger', '4L Passenger — carton of 6'], ['Racing', '5L Racing — carton of 6'], ['Diesel', 'Diesel — per pail']];
    return `
    <div class="toolbar sticky">
      <input id="priceSearch" type="search" placeholder="Search product or grade (e.g. 10W40)…" value="${esc(q)}" data-input="search">
      <div class="seg full"><button class="${tier === 'Non-stockist' ? 'on' : ''}" data-act="tier" data-v="Non-stockist">Non-stockist</button><button class="${tier === 'Stockist' ? 'on' : ''}" data-act="tier" data-v="Stockist">Stockist</button></div>
    </div>
    <p class="small muted">Price list ${esc(setting('price_list_version', 'V2026-NR1'))}. Margin assumes the workshop sells at list price.</p>
    ${groups.map(([g, label]) => {
      const ps = list.filter(p => p.category === g);
      if (!ps.length) return '';
      return `<h4 class="day-head">${esc(label)}</h4><div class="price-grid">${ps.map(p => {
        const per = p.pack === 'pail' ? 1 : (Number(p.units_per_pack) || 6);
        const u = priceFor(p, tier);
        return `<div class="price-card">
          <img src="${esc(p.image)}" alt="" loading="lazy">
          <div class="grow">
            <div class="prod-name">${esc(shortName(p.name))} ${tag(p.size)}</div>
            <div class="prod-type">${esc(p.type)}</div>
            <div class="prod-spec">${esc(p.spec)}</div>
            <table class="mini">
              <tr><td>${per > 1 ? 'Per bottle' : 'Per pail'}</td><td><b>${rm0(u)}</b></td><td class="muted">List ${rm0(p.list_price)}</td></tr>
              ${per > 1 ? `<tr><td>Per carton</td><td><b>${rm0(u * per)}</b></td><td class="muted">List ${rm0(p.list_price * per)}</td></tr>` : ''}
              <tr><td>Shop margin</td><td class="green"><b>${rm0((p.list_price - u) * per)}</b></td><td class="muted">per ${per > 1 ? 'carton' : 'pail'}</td></tr>
            </table>
          </div>
        </div>`;
      }).join('')}</div>`;
    }).join('')}`;
  },
  actions: {
    tier: el => { tier = el.dataset.v; render(); },
    search: el => { q = el.value; render(); }
  }
};
