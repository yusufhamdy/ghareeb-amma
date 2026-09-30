// Service Worker for caching and offline support
const CACHE_NAME = 'ghareeb-pwa-v1';
const assetsToCache = [
    '/',
    '/index.html',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/og-image.png'
];

// Install event - caching core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(assetsToCache);
            })
    );
});

// Fetch event - serving from cache or network
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cached version if found, else fetch from network
                return response || fetch(event.request);
            })
    );
});
