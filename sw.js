const CACHE_NAME = 'mindfulday-v14-debug';
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
    './icons/sadhguru-sign.png',
    './lotus-icon.png',
    './icons/cinema_activity.svg',
    './icons/groom_activity.svg',
    './icons/listen_activity.svg',
    './icons/read_activity.svg',
    './icons/relax_activity.svg',
    './icons/travel_activity.svg',
    './icons/web_activity.svg',
    './icons/youtube_activity.svg'
];

self.addEventListener('install', (e) => {
    // Force the waiting service worker to become the active service worker.
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', (event) => {
    // Make the service worker take control of the page immediately.
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((name) => {
                        if (name !== CACHE_NAME) {
                            return caches.delete(name);
                        }
                    })
                );
            })
        ])
    );
});

self.addEventListener('fetch', (e) => {
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
