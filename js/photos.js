// Shop photos (name card, SSM): shrink on the phone, keep on the phone until uploaded (works offline),
// upload to Google Drive through the script, cache downloaded photos on the phone, share to WhatsApp.
import { store, V, notify, registerSyncHook, dispatch, shopById } from './store.js';
import { call } from './api.js';
import { uid, nowIso, cleanAddress } from './util.js';

export const KINDS = { namecard: 'Name card', ssm: 'SSM' };
const DB_NAME = 'zuss-photos';
let dbp = null;
const pending = [];          // metadata of photos not yet uploaded
const urls = new Map();      // photo id -> object URL
const loading = new Map();   // photo id -> Promise<Blob>
let uploading = false;
export let lastUploadError = '';

function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('pending', { keyPath: 'id' }); d.createObjectStore('cache'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(storeName, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(storeName, mode);
    const st = tx.objectStore(storeName);
    let out;
    const r = fn(st);
    if (r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => res(out);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

export async function initPhotos() {
  try {
    const all = await idb('pending', 'readonly', st => st.getAll());
    pending.splice(0, pending.length, ...(all || []).map(x => x.meta));
    notify();
  } catch (e) { console.warn('photo store unavailable', e); }
}

export const pendingPhotoCount = () => pending.length;
const isPending = id => pending.some(p => p.id === id);

export function photosFor(shopId, kind) {
  const server = (V().photos || []).filter(p => p.shop_id === shopId && !p.deleted);
  const local = pending.filter(p => p.shop_id === shopId && !server.some(s => s.id === p.id)).map(p => ({ ...p, _pending: true }));
  return server.concat(local).filter(p => !kind || p.kind === kind).sort((a, b) => String(a.taken_at).localeCompare(String(b.taken_at)));
}
export const hasDocs = shopId => photosFor(shopId).some(p => KINDS[p.kind]);

/* ───────── Taking / choosing a photo ───────── */
function loadImage(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res(img); URL.revokeObjectURL(u); };
    img.onerror = () => { rej(new Error('Not an image')); URL.revokeObjectURL(u); };
    img.src = u;
  });
}
// Long side 1600 px, JPEG ~80%: sharp enough to read a name card or SSM, ~200–400 KB.
async function shrink(file) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = await loadImage(file); }
  const w = src.width, h = src.height;
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  if (!blob) throw new Error('Could not process photo');
  return blob;
}

export async function addPhoto(shopId, kind, file) {
  const blob = await shrink(file);
  const shop = shopById(shopId) || {};
  const meta = { id: uid('ph-'), shop_id: shopId, shop_name: shop.name || '', kind, taken_at: nowIso(), by: store.session.me.name };
  await idb('pending', 'readwrite', st => st.put({ id: meta.id, meta, blob }));
  await idb('cache', 'readwrite', st => st.put(blob, meta.id));
  urls.set(meta.id, URL.createObjectURL(blob));
  pending.push(meta);
  notify();
  uploadPending().catch(() => {});
  return meta;
}

const toBase64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

export async function uploadPending() {
  if (uploading || !pending.length || !store.session || !navigator.onLine) return;
  uploading = true;
  try {
    for (const meta of pending.slice()) {
      const rec = await idb('pending', 'readonly', st => st.get(meta.id));
      if (!rec) { pending.splice(pending.findIndex(p => p.id === meta.id), 1); continue; }
      const r = await call('photoUpload', { token: store.session.token, meta, data: await toBase64(rec.blob), mime: 'image/jpeg' }, 90000);
      if (r.ok) {
        await idb('pending', 'readwrite', st => st.delete(meta.id));
        pending.splice(pending.findIndex(p => p.id === meta.id), 1);
        if (store.base) { store.base.photos = (store.base.photos || []).filter(p => p.id !== r.photo.id).concat([r.photo]); try { localStorage.setItem('zuss.base', JSON.stringify(store.base)); } catch (e) { /* full */ } }
        lastUploadError = '';
        notify();
      } else if (r.rejected) {
        await idb('pending', 'readwrite', st => st.delete(meta.id));
        pending.splice(pending.findIndex(p => p.id === meta.id), 1);
        store.rejected.unshift({ at: nowIso(), type: 'photo.upload', message: r.message });
        notify();
      } else {
        lastUploadError = r.message || r.error || 'Upload failed';
        break; // auth / busy: try again on the next sync
      }
    }
  } catch (e) {
    lastUploadError = e.message || String(e);
  } finally {
    uploading = false;
  }
}
registerSyncHook(uploadPending);

/* ───────── Showing ───────── */
export const photoUrlNow = id => urls.get(id) || '';

export function photoBlob(id) {
  if (loading.has(id)) return loading.get(id);
  const p = (async () => {
    let blob = await idb('cache', 'readonly', st => st.get(id)).catch(() => null);
    if (!blob) {
      if (!navigator.onLine) throw new Error('Offline — photo not on this phone yet');
      const r = await call('photoGet', { token: store.session.token, id }, 60000);
      if (!r.ok) throw new Error(r.message || 'Could not load photo');
      const bin = atob(r.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: r.mime || 'image/jpeg' });
      idb('cache', 'readwrite', st => st.put(blob, id)).catch(() => {});
    }
    if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob));
    return blob;
  })();
  loading.set(id, p);
  p.catch(() => loading.delete(id));
  return p;
}

// Fill <img data-photo="id"> elements inside a screen.
export function hydrate(root) {
  root.querySelectorAll('img[data-photo]').forEach(img => {
    const id = img.dataset.photo;
    const u = urls.get(id);
    if (u) { if (img.src !== u) img.src = u; return; }
    img.closest('.ph-thumb, .ph-view')?.classList.add('loading');
    photoBlob(id).then(() => {
      img.src = urls.get(id);
      img.closest('.ph-thumb, .ph-view')?.classList.remove('loading');
    }).catch(() => { img.closest('.ph-thumb, .ph-view')?.classList.replace('loading', 'failed'); });
  });
}

/* ───────── Removing ───────── */
export async function deletePhoto(id) {
  if (isPending(id)) {
    await idb('pending', 'readwrite', st => st.delete(id));
    pending.splice(pending.findIndex(p => p.id === id), 1);
    notify();
  } else {
    dispatch('photo.delete', { id });
  }
}

/* ───────── Sharing / copying ───────── */
const safe = s => String(s || '').replace(/[\\/:*?"<>|]/g, ' ').trim();

export function shopDocsText(shop) {
  return [`Shop: ${shop.name}`, shop.contact ? `Contact: ${shop.contact}` : '', shop.phone ? `Phone: ${shop.phone}` : '',
    cleanAddress(shop.address) ? `Address: ${cleanAddress(shop.address)}${shop.area ? ', ' + shop.area : ''}` : ''].filter(Boolean).join('\n');
}

// Build File objects for sharing. Returns null if any photo still has to be downloaded first.
export function docFilesNow(shopId, kinds = Object.keys(KINDS)) {
  const shop = shopById(shopId) || {};
  const list = photosFor(shopId).filter(p => kinds.includes(p.kind));
  return Promise.all(list.map(p => photoBlob(p.id))).then(blobs => {
    const n = {};
    return blobs.map((b, i) => {
      const k = list[i].kind; n[k] = (n[k] || 0) + 1;
      return new File([b], `${safe(shop.name)} - ${KINDS[k] || k} ${n[k]}.jpg`, { type: 'image/jpeg' });
    });
  });
}

export const canShareFiles = files => !!(navigator.canShare && files.length && navigator.canShare({ files }));

export async function shareFiles(files, text) {
  if (canShareFiles(files)) {
    try { await navigator.share({ files, text }); return 'shared'; }
    catch (e) { return e && e.name === 'AbortError' ? 'cancelled' : 'failed'; }
  }
  // Fallback (e.g. desktop browsers): download each file.
  files.forEach(f => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  return 'downloaded';
}

// Copy one photo to the clipboard (paste into WhatsApp). Browsers only accept PNG images on the clipboard.
export async function copyPhoto(id) {
  if (!navigator.clipboard || !window.ClipboardItem) return false;
  const png = photoBlob(id).then(async blob => {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return new Promise(r => c.toBlob(r, 'image/png'));
  });
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); return true; } catch (e) { return false; }
}
