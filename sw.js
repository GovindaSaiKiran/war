/**
 * @fileoverview Service Worker for Smart Stadium Experience
 * @description Provides offline caching, asset precaching, and network-first strategy
 * for improved performance and reliability.
 * @version 2.0.0
 */

const CACHE_NAME = 'smart-stadium-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/firebase-config.js',
  '/manifest.json'
];

/** Install event — precache critical assets */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.info('[SW] Precaching app shell');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.error('[SW] Precache failed:', err))
  );
});

/** Activate event — clean old caches */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.info('[SW] Removing old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

/**
 * Fetch event — Network-first strategy with cache fallback
 * CDN resources use cache-first for performance.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') { return; }

  const url = new URL(request.url);

  // Cache-first for external CDN resources (fonts, icons, Firebase SDK)
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) { return cached; }
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Network-first for same-origin
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => {
        if (cached) { return cached; }
        if (request.headers.get('accept')?.includes('text/html')) {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      }))
  );
});
