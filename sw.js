const CACHE_NAME = 'mindfulday-v6-rename';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './firebase-config.js',
    './settings_activities.json',
    './icons/ayurveda_activity.svg',
    './icons/baby.svg',
    './icons/bath_activity.svg',
    './icons/chat_activity.svg',
    './icons/coffee-break_activity.svg',
    './icons/dress-up_activity.svg',
    './icons/drive_activity.svg',
    './icons/eat_activity.svg',
    './icons/entertainment_activity.svg',
    './icons/evening_time.svg',
    './icons/exercise_activity.svg',
    './icons/family-time_activity.svg',
    './icons/hobby_activity.svg',
    './icons/measure_mode.svg',
    './icons/meeting.svg',
    './icons/mid-night_time.svg',
    './icons/noon_time.svg',
    './icons/office-work_activity.svg',
    './icons/old.svg',
    './icons/run_mode.svg',
    './icons/sadhana_activity.svg',
    './icons/settings_mode.svg',
    './icons/sleep_activity.svg',
    './icons/sunrise_time.svg',
    './icons/sunset_time.svg',
    './icons/wake-up_activity.svg',
    './icons/walk_activity.svg',
    './icons/shakthi.png',
    './icons/shambhavi.png',
    './icons/shoonya.png',
    './audio/Shakthi.mp3',
    './audio/Shambhavi.mp3',
    './sadhguru.json',
    './icons/sadhguru.png',
    './icons/sadhguru-sign.png'
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
            fetch(e.request).catch(() => caches.match(e.request, { ignoreSearch: true }))
        );
        return;
    }

    e.respondWith(
        // ignoreSearch: true ensures that style.css?v=2.1 matches style.css in cache
        caches.match(e.request, { ignoreSearch: true }).then((response) => response || fetch(e.request))
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
