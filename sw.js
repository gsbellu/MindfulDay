const CACHE_NAME = 'mindfulday-v3-layout-fix';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((name) => {
                    if (name !== CACHE_NAME) {
                        return caches.delete(name);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', (e) => {
    // Network first for JSON/API, Cache first for assets?
    // For now, sticking to Cache First with Network Fallback (or StaleWhileRevalidate) logic is better for PWA,
    // BUT the user wants "Update" to update immediately.
    // The current logic is: caches.match(e.request).then((response) => response || fetch(e.request))
    // This is Cache Falling Back to Network.

    // We want to ensure version.json is ALWAYS network first
    if (e.request.url.includes('version.json') || e.request.url.includes('app.js')) {
        e.respondWith(
            fetch(e.request).catch(() => caches.match(e.request))
        );
        return;
    }

    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
