// Phone location: one best reading for pinning, and a cached reading for "nearest" sorting.
let last = null; // { lat, lng, accuracy, at }

export const lastPosition = () => (last && Date.now() - last.at < 5 * 60e3) ? last : null;

export function geoErrorText(err) {
  if (!('geolocation' in navigator)) return 'This device does not support location.';
  if (err && err.code === 1) return 'Location permission is off. iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using. Android: tap the lock icon in Chrome → Permissions → Location → Allow.';
  if (err && err.code === 3) return 'Could not get a GPS fix in time. Step outside or near the shop entrance and try again.';
  return 'Could not get your location. Check that Location is turned on and try again.';
}

// Watches GPS for up to maxMs and keeps the most accurate reading; stops early once accuracy <= goodM.
export function bestPosition({ maxMs = 12000, goodM = 15, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) { reject({ code: 0 }); return; }
    let best = null, done = false;
    const finish = () => {
      if (done) return; done = true;
      navigator.geolocation.clearWatch(id); clearTimeout(timer);
      if (best) { last = best; resolve(best); } else reject({ code: 3 });
    };
    const id = navigator.geolocation.watchPosition(p => {
      const r = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy), at: Date.now() };
      if (!best || r.accuracy < best.accuracy) { best = r; if (onProgress) onProgress(best); }
      if (best.accuracy <= goodM) finish();
    }, err => { if (done) return; done = true; clearTimeout(timer); navigator.geolocation.clearWatch(id); if (best) { last = best; resolve(best); } else reject(err); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs });
    const timer = setTimeout(finish, maxMs);
  });
}

// Quick reading for sorting/distances (accepts a reading up to 2 minutes old).
export function quickPosition() {
  return new Promise((resolve, reject) => {
    const l = lastPosition();
    if (l && Date.now() - l.at < 120e3) { resolve(l); return; }
    if (!('geolocation' in navigator)) { reject({ code: 0 }); return; }
    navigator.geolocation.getCurrentPosition(p => {
      last = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), at: Date.now() };
      resolve(last);
    }, reject, { enableHighAccuracy: false, maximumAge: 120e3, timeout: 15000 });
  });
}
