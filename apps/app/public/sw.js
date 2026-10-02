// Keeps the app on the device so it opens without a connection.
//  - Opening the app asks the network first (so a new version shows straight away, as before) and
//    falls back to the saved copy when there is no connection or it takes over 3 seconds.
//  - Code, fonts and icons are served from the saved copy; their names change when they do.
//  - Only this site's own files are handled. Data requests to Supabase are never touched here
//    (see src/lib/offline.ts for those).
// VERSION and FILES are filled in by scripts/make-sw.mjs after `expo export`.
const VERSION = '__VERSION__';
const FILES = [/*__FILES__*/];
const CACHE = 'app-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/index.html', ...FILES])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  // Keep the previous version's files too: a page still open on it may yet ask for one of them.
  e.waitUntil(caches.keys().then((keys) => {
    const old = keys.filter((k) => k.startsWith('app-') && k !== CACHE).sort().reverse().slice(1);
    return Promise.all(old.map((k) => caches.delete(k)));
  }).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(new Promise((done) => {
      const saved = () => caches.match('/index.html').then((r) => r || fetch(req));
      const timer = setTimeout(() => done(saved()), 3000);
      fetch(req).then((r) => { clearTimeout(timer); done(r.ok ? r : saved()); }, () => { clearTimeout(timer); done(saved()); });
    }));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});
