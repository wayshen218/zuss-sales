// Name card & SSM photos on the shop page, the photo viewer, and sharing.
import { esc, fmtDateTime } from '../util.js';
import { shopById } from '../store.js';
import { openSheet, closeSheet, toast, confirmBox } from '../ui.js';
import { KINDS, photosFor, photoUrlNow, addPhoto, deletePhoto, docFilesNow, shopDocsText, shareFiles, canShareFiles, copyPhoto, hydrate, photoBlob } from '../photos.js';

export function docsCard(shop) {
  const groups = Object.keys(KINDS).map(kind => {
    const list = photosFor(shop.id, kind);
    return `<div class="ph-group">
      <div class="ph-label">${esc(KINDS[kind])} <span class="count">${list.length}</span></div>
      <div class="ph-strip">
        ${list.map(p => `<button class="ph-thumb ${p._pending ? 'pending' : ''}" data-act="viewPhoto" data-id="${esc(p.id)}" aria-label="Open ${esc(KINDS[kind])} photo">
            <img data-photo="${esc(p.id)}" alt="" ${photoUrlNow(p.id) ? `src="${photoUrlNow(p.id)}"` : ''}>
            ${p._pending ? '<span class="ph-badge">⏳ uploading</span>' : ''}
          </button>`).join('')}
        <label class="ph-add" aria-label="Add ${esc(KINDS[kind])} photo">
          <span>📷</span><small>${list.length ? 'Add more' : 'Add photo'}</small>
          <input type="file" accept="image/*" multiple hidden data-change="photoPicked" data-kind="${kind}">
        </label>
      </div>
    </div>`;
  }).join('');
  const any = photosFor(shop.id).some(p => KINDS[p.kind]);
  return `<div class="card">
    <div class="card-head"><h3>📇 Name card & SSM</h3></div>
    ${groups}
    <button class="btn ${any ? 'cta' : 'ghost'} full mt-s" data-act="shareDocs" ${any ? '' : 'disabled'}>Share name card + SSM</button>
    <p class="tiny muted mt-s">Photos are saved to your Google Drive (folder "ZUSS Sales — Photos"). Taken offline? They upload automatically when there's signal.</p>
  </div>`;
}

async function doShare(files, text) {
  const r = await shareFiles(files, text);
  if (r === 'downloaded') toast('Sharing not supported here — photos downloaded instead');
  if (r === 'failed') toast('Could not open sharing. Try again.', 'error');
}

// Share all name card + SSM photos of a shop (e.g. to the ZUSS WhatsApp chat). extraText goes under the shop details.
export async function shareShopDocs(shopId, extraText = '') {
  const list = photosFor(shopId).filter(p => KINDS[p.kind]);
  if (!list.length) { toast('No name card or SSM photo for this shop yet', 'error'); return; }
  const allOnPhone = list.every(p => photoUrlNow(p.id));
  let files;
  try { files = await docFilesNow(shopId); } catch (e) { toast(e.message || 'Could not load photos', 'error'); return; }
  const text = shopDocsText(shopById(shopId) || {}) + (extraText ? '\n' + extraText : '');
  if (!allOnPhone && canShareFiles(files)) {
    // Photos had to be downloaded first; phones need a fresh tap to open the share menu.
    openSheet({
      title: 'Ready to share',
      html: `<p>${files.length} photo${files.length > 1 ? 's' : ''} ready.</p><div class="sheet-actions"><button class="btn cta grow" data-act="goShare">Share now</button></div>`,
      actions: { goShare: async () => { closeSheet(); await doShare(files, text); } }
    });
    return;
  }
  await doShare(files, text);
}

export function openPhotoViewer(shopId, id) {
  const p = photosFor(shopId).find(x => x.id === id);
  if (!p) return;
  const shop = shopById(shopId) || {};
  openSheet({
    title: `${KINDS[p.kind] || 'Photo'} — ${shop.name || ''}`,
    wide: true,
    html: `<div class="ph-view"><img data-photo="${esc(p.id)}" alt="${esc(KINDS[p.kind] || 'Photo')}" ${photoUrlNow(p.id) ? `src="${photoUrlNow(p.id)}"` : ''}></div>
      <p class="small muted">${esc(fmtDateTime(p.taken_at))} · ${esc(p.by || '')}${p._pending ? ' · waiting to upload' : ''}</p>
      <div class="sheet-actions">
        <button class="btn danger ghost" data-act="phDelete">Delete</button>
        <button class="btn" data-act="phCopy">Copy</button>
        <button class="btn cta grow" data-act="phShare">Share</button>
      </div>`,
    actions: {
      phShare: async () => {
        try {
          const blob = await photoBlob(p.id);
          const f = new File([blob], `${(shop.name || 'Shop').replace(/[\\/:*?"<>|]/g, ' ')} - ${KINDS[p.kind] || 'Photo'}.jpg`, { type: 'image/jpeg' });
          await doShare([f], shopDocsText(shop));
        } catch (e) { toast(e.message || 'Could not share', 'error'); }
      },
      phCopy: async () => {
        toast((await copyPhoto(p.id)) ? 'Photo copied — paste it in WhatsApp' : 'Copy is not supported on this phone — use Share', '');
      },
      phDelete: async () => {
        if (!(await confirmBox(`Delete this ${KINDS[p.kind] || 'photo'} photo?\n\nThe file goes to Google Drive Trash (recoverable for 30 days).`, { ok: 'Delete', danger: true }))) return;
        await deletePhoto(p.id);
        closeSheet();
        toast('Photo deleted');
      }
    }
  });
  hydrate(document.getElementById('sheet'));
}

export async function handlePicked(shopId, input) {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  const kind = input.dataset.kind;
  toast(files.length > 1 ? `Saving ${files.length} photos…` : 'Saving photo…');
  let ok = 0;
  for (const f of files) {
    try { await addPhoto(shopId, kind, f); ok++; } catch (e) { toast('Could not use that photo: ' + (e.message || e), 'error'); }
  }
  if (ok) toast(`${KINDS[kind]} saved${navigator.onLine ? ' — uploading' : ' on phone — uploads when online'}`);
}
