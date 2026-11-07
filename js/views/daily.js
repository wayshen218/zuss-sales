import { esc, today, fmtDate, fmtDateTime, nowIso, debounce } from '../util.js';
import { checklistFor, dispatch, myVisitsOn } from '../store.js';
import { render, toast, empty } from '../ui.js';

const TASKS = [
  'Plan route and choose 8–10 target workshops',
  'Visit workshops 1–3; speak to decision-makers',
  'Visit workshops 4–6; introduce product and potential margin',
  'Visit workshops 7–10; record interest and objections',
  'Send quotations or price list to interested leads',
  'Follow up warm leads and overdue prospects',
  'Ask for a paid starter order where appropriate',
  'Confirm payment before HQ processes order',
  'Update shop and order records',
  'Review results and plan tomorrow\'s route'
];

let date = today();
let draft = null;

const save = () => dispatch('checklist.save', { date, done: draft.done, decision_makers: draft.decision_makers, notes: draft.notes, at: nowIso() });
const saveSoon = debounce(save, 1200);

export default {
  tab: 'daily',
  title: 'Daily',
  render() {
    if (!draft || draft.date !== date) draft = { date, ...checklistFor(date) };
    const visits = myVisitsOn(date);
    const shops = new Set(visits.map(v => v.shop_id)).size;
    const done = draft.done.length;
    return `
    <div class="card">
      <div class="card-head"><h3>${esc(fmtDate(date))}</h3><input type="date" id="dDate" value="${esc(date)}" data-change="setDate" aria-label="Date"></div>
      <div class="metrics small-metrics">
        <div class="metric-card"><div class="m-label">Shops visited</div><div class="m-val">${shops} <small>/ 8–10</small></div><div class="m-sub">From check-ins</div></div>
        <div class="metric-card"><div class="m-label">Checklist</div><div class="m-val">${done} <small>/ ${TASKS.length}</small></div><div class="bar"><span style="width:${Math.round(done / TASKS.length * 100)}%"></span></div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Checklist</h3></div>
      ${TASKS.map((t, i) => `<label class="check"><input type="checkbox" data-change="tick" data-i="${i}" ${draft.done.includes(i) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}
    </div>
    <div class="card form">
      <label>Decision-makers spoken to<input id="dDM" type="number" min="0" inputmode="numeric" value="${draft.decision_makers || 0}" data-input="dm"></label>
      <label>Notes — wins, objections, tomorrow's plan<textarea id="dNotes" rows="4" data-input="notes">${esc(draft.notes)}</textarea></label>
      <p class="tiny muted">Saves automatically.</p>
    </div>
    <div class="card">
      <div class="card-head"><h3>Check-ins <span class="count">${visits.length}</span></h3></div>
      ${visits.length ? `<ul class="timeline">${visits.sort((a, b) => String(a.at).localeCompare(String(b.at))).map(v => `<li><b>${esc(fmtDateTime(v.at).split(', ')[1] || '')}</b> — <a href="#/shop/${encodeURIComponent(v.shop_id)}">${esc(v.shop_name || 'Shop')}</a>${v.note ? `<div class="pre small">${esc(v.note)}</div>` : ''}</li>`).join('')}</ul>` : empty('No check-ins on this day. Open a shop and tap "Check in" when you visit.')}
    </div>`;
  },
  actions: {
    setDate: el => { date = el.value || today(); draft = null; render(); },
    tick: el => {
      const i = Number(el.dataset.i);
      draft.done = el.checked ? [...new Set([...draft.done, i])].sort((a, b) => a - b) : draft.done.filter(x => x !== i);
      save(); render();
    },
    dm: el => { draft.decision_makers = Number(el.value) || 0; saveSoon(); },
    notes: el => { draft.notes = el.value; saveSoon(); }
  }
};
