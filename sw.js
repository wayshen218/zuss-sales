// Offline support. App files: network first (so updates arrive immediately), cached copy when offline.
// Product images: cache first. Calls to Google (the Sheet) are never cached.
const VERSION = 'zuss-v1.0.0';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/config.js', './js/util.js', './js/api.js', './js/store.js', './js/ui.js', './js/geo.js', './js/orderlogic.js',
  './js/views/common.js', './js/views/home.js', './js/views/shops.js', './js/views/shop.js', './js/views/shopform.js',
  './js/views/order.js', './js/views/summary.js', './js/views/orders.js', './js/views/prices.js', './js/views/daily.js', './js/views/more.js',
  './icons/icon-192.png', './icons/apple-touch-icon.png',
  ...['zr-turbo', 'zr-na', 'zd-5w30', 'zd-10w40', 'zd-15w40', 'zd-20w50', 'z-eco-0w20', 'z0-5w30', 'z1-5w40', 'z2-10w40', 'z3-5w30', 'z4-15w40', 'z5-10w30', 'z6-20w50'].map(c => `./img/products/${c}.webp`)
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/img/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); return res; })));
    return;
  }
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});
