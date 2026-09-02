const CACHE = 'galaxyfm-v1';
const ASSETS = [
  '/Galaxy.FM/',
  '/Galaxy.FM/index.html',
  '/Galaxy.FM/config.js',
  '/Galaxy.FM/art.js',
  '/Galaxy.FM/db.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first for API calls
  if (e.request.url.includes('googleapis') || e.request.url.includes('onrender') || e.request.url.includes('cloudinary')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('/Galaxy.FM/index.html')))
  );
});
