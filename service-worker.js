const CACHE_NAME = 'staffing-cache-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './tile_blue.png',
  './New_Logo_v2.png'
];

// Install Event - Caches the shell UI files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Some static assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate Event - Cleans up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event - Bypasses cache for your live Google Sheets API, retrieves other assets locally if offline
self.addEventListener('fetch', (event) => {
  // Always let Google Apps Script API calls run live without caching interference
  if (event.request.url.includes('script.google.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});