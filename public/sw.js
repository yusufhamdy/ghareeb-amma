const CACHE_NAME = 'ghareeb-pwa-v33';
const assetsToCache = [
    '/',
    '/index.html',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/og-image.png',
    '/css/app.css',
    '/theme-boot.js',
    '/quiz-core.js',
    '/migrate.js',
    '/firebase-config.js',
    '/word-gap.js',
    '/qfont.js',
    '/qtext.js',
    '/fonts/fonts.css',
    '/fonts/kfgqpc-uthmanic-hafs-v22.ttf',
    '/words.json',
    '/challenge.json'
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

function cacheKey(req) {
    const u = new URL(req.url);
    u.search = '';
    u.hash = '';
    return u.toString();
}

function putInCache(req, res) {
    if (!res || !res.ok || res.type !== 'basic') return;
    const copy = res.clone();
    caches.open(CACHE_NAME).then(c => c.put(cacheKey(req), copy)).catch(() => {});
}

async function fromCache(req) {
    return (await caches.match(cacheKey(req))) ||
           (await caches.match(req, { ignoreSearch: true }));
}

const OFFLINE_HTML = '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>غير متصل</title><p style="font-family:sans-serif;text-align:center;margin-top:40vh">لا يوجد اتصال بالإنترنت</p></html>';

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return;

    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then(res => { putInCache(req, res); return res; })
                .catch(async () =>
                    (await fromCache(req)) ||
                    (await caches.match('/index.html')) ||
                    (await caches.match('/')) ||
                    new Response(OFFLINE_HTML, {
                        status: 503,
                        headers: { 'Content-Type': 'text/html; charset=utf-8' }
                    })
                )
        );
        return;
    }

    const isAppFile =
        url.pathname === '/words.json' ||
        url.pathname === '/challenge.json' ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css');

    if (isAppFile) {
        event.respondWith(
            fetch(req, { cache: 'no-cache' })
                .then(res => { putInCache(req, res); return res; })
                .catch(async () => (await fromCache(req)) || Response.error())
        );
        return;
    }

    event.respondWith(
        caches.match(req).then(cached => cached || fetch(req))
    );
});
