// Offline support: the app files are kept on the phone. Always tries the newest version first,
// falls back to the saved copy with no signal. Prices are handled by the app itself (saved in storage).
const C = 'eme-v8';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'engine.js', 'data.js', 'live.js', 'i18n.js', 'manifest.webmanifest', 'icon-192.png'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(ks => Promise.all(ks.filter(k => (k.startsWith('vela-') || k.startsWith('eme-')) && k !== C).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(r, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(C).then(c => c.put(r, copy)); }
    return res;
  }).catch(() => caches.match(r, { ignoreSearch: true })));
});
