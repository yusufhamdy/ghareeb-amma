// Service Worker for caching and offline support

const CACHE_NAME = 'ghareeb-pwa-v2';

const assetsToCache = [
    '/',
    '/index.html',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/og-image.png'
];

// Install: cache the current core assets, then activate immediately.
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(assetsToCache))
            .then(() => self.skipWaiting())
    );
});

// Activate: delete old caches and take control of open pages.
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames
                        .filter(name => name !== CACHE_NAME)
                        .map(name => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

// Network-first:
// Always try to load the newest version from Firebase.
// If there is no internet, use the cached version.
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then(response => {

                if (response && response.ok) {
                    const responseClone = response.clone();

                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseClone);
                        });
                }

                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});