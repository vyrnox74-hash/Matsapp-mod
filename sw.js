/* MAtSapp Service Worker – Phase 8 */
const CACHE = 'matsapp-v21';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/phone.js',
  './js/db.js',
  './js/auth.js',
  './js/ui.js',
  './js/contacts.js',
  './js/media.js',
  './js/social.js',
  './js/calls.js',
  './js/ai.js',
  './js/admin.js',
  './js/push.js',
  './js/chat.js',
  './js/app.js',
  './manifest.json',
  './icons/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for app shell (always try fresh), cache fallback offline
// Cache-first for icons
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Don't cache Supabase API
  if (url.hostname.includes('supabase')) return;

  const isIcon = url.pathname.includes('/icons/');
  const isStatic = isIcon || url.pathname.endsWith('.png') || url.pathname.endsWith('.svg');

  if (isStatic) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })).catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
  );
});

// Web Push
self.addEventListener('push', (event) => {
  let data = { title: 'MAtSapp', body: 'New notification', url: '/' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (_) {
    try {
      data.body = event.data.text();
    } catch (_) {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'MAtSapp', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
