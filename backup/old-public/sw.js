const CACHE_NAME = 'ghareeb-pwa-v3';
const assetsToCache = [
    '/',
    '/index.html',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/og-image.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(assetsToCache))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => Promise.all(
                cacheNames
                    .filter(name => name.startsWith('ghareeb-pwa-') && name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const isAppFile = url.origin === self.location.origin &&
        (url.pathname === '/' ||
         url.pathname === '/index.html' ||
         url.pathname === '/words.json' ||
         url.pathname.endsWith('.js') ||
         url.pathname.endsWith('.css'));

    if (isAppFile) {
        event.respondWith(
            fetch(event.request, { cache: 'no-cache' })
                .then(response => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
