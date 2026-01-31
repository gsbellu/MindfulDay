/**
 * MindfulDay - Core Logic (v3)
 */

const STATE_KEY = 'mindfulDayState';
const BUILD_DATE = "31 Jan 2026, 11:45 PM"; /* Negative margin fix */

// Correct SVG List
const ACTIVITIES = [
    { id: 'wakeup', icon: 'wake-up_activity.svg', label: 'Wake Up' },
    { id: 'bath', icon: 'bath_activity.svg', label: 'Bath' },
    { id: 'medicines', icon: 'ayurveda_activity.svg', label: 'Meds' },
    { id: 'sadhana', icon: 'sadhana_activity.svg', label: 'Sadhana' },
    { id: 'family', icon: 'family-time_activity.svg', label: 'Family' },
    { id: 'exercise', icon: 'exercise_activity.svg', label: 'Exercise' },
    { id: 'breakfast', icon: 'eat_activity.svg', label: 'Breakfast' },
    { id: 'dress', icon: 'dress-up_activity.svg', label: 'Dress' },
    { id: 'drive', icon: 'drive_activity.svg', label: 'Drive' },
    { id: 'work', icon: 'office-work_activity.svg', label: 'Work' },
    { id: 'shoonya', icon: 'sadhana_activity.svg', label: 'Shoonya' },
    { id: 'lunch', icon: 'eat_activity.svg', label: 'Lunch' },
    { id: 'chat', icon: 'chat_activity.svg', label: 'Chat' },
    { id: 'coffee', icon: 'coffee-break_activity.svg', label: 'Coffee' },
    { id: 'entertainment', icon: 'entertainment_activity.svg', label: 'Fun' },
    { id: 'walk', icon: 'walk_activity.svg', label: 'Walk' },
    { id: 'hobby', icon: 'hobby_activity.svg', label: 'Hobby' },
    { id: 'sleep', icon: 'sleep_activity.svg', label: 'Sleep' }
];

let state = {
    currentActivityId: null,
    currentActivityStartTime: null,
    dayStartTime: null,
    isDayStarted: false,
    history: []
};

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    renderActivities();

    // Restore Label if activity is active
    if (state.currentActivityId) {
        const act = ACTIVITIES.find(a => a.id === state.currentActivityId);
        if (act) {
            // function is hoisted, so this is safe technically, 
            // but we'll ensure it's defined globally.
            updateMetaDisplay(act);
        }
    }

    setupNavigation();
    startTimerLoop();
    registerServiceWorker();

    // Fix bottom section position for PWA
    fixBottomSectionPosition();
    window.addEventListener('resize', fixBottomSectionPosition);
    window.addEventListener('orientationchange', fixBottomSectionPosition);
});

// Fix bottom section alignment in PWA standalone mode
function fixBottomSectionPosition() {
    const bottomSection = document.querySelector('.bottom-section');
    if (!bottomSection) return;

    // Get actual viewport height
    const vh = window.innerHeight;

    // Calculate bottom section height
    const bottomHeight = bottomSection.offsetHeight;

    // Position bottom section at the very bottom
    bottomSection.style.position = 'fixed';
    bottomSection.style.bottom = '0';
    bottomSection.style.left = '0';
    bottomSection.style.right = '0';
    bottomSection.style.transform = 'translateY(0)';

    // In PWA standalone mode, push down into safe area
    if (window.matchMedia('(display-mode: standalone)').matches) {
        bottomSection.style.marginBottom = '-20px';
        bottomSection.style.paddingBottom = '30px';
    }

    // Adjust main container padding to prevent overlap
    const appContainer = document.querySelector('.app-container');
    if (appContainer) {
        appContainer.style.paddingBottom = (bottomHeight + 10) + 'px';
    }
}

// --- Helper Functions ---

// Get unique device ID (or create one)
function getDeviceId() {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
        deviceId = 'device_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
}

const DEVICE_ID = getDeviceId();
const stateRef = window.firebaseDB.ref('state');

function loadState() {
    // Try localStorage first for offline fallback
    const saved = localStorage.getItem(STATE_KEY);
    if (saved) {
        state = JSON.parse(saved);
    }

    // Load from Firebase (will override local if exists)
    stateRef.once('value').then((snapshot) => {
        const firebaseState = snapshot.val();
        if (firebaseState) {
            state = firebaseState;
            render();
        }
    }).catch((error) => {
        console.log('Firebase load failed, using local state:', error);
    });

    // Listen for real-time updates from other devices
    stateRef.on('value', (snapshot) => {
        const firebaseState = snapshot.val();
        if (firebaseState && firebaseState.lastUpdatedBy !== DEVICE_ID) {
            state = firebaseState;
            render();
        }
    });
}

function saveState() {
    // Save locally for offline support
    localStorage.setItem(STATE_KEY, JSON.stringify(state));

    // Save to Firebase
    state.lastUpdatedBy = DEVICE_ID;
    stateRef.set(state).catch((error) => {
        console.log('Firebase save failed:', error);
    });
}

// Main render function - updates all UI elements
function render() {
    renderActivities();
    // Timer updates happen via setInterval, not here
}

function renderActivities() {
    const grid = document.getElementById('activityGrid');
    grid.innerHTML = '';

    ACTIVITIES.forEach(act => {
        const btn = document.createElement('div');
        btn.className = `activity-btn ${state.currentActivityId === act.id ? 'active' : ''}`;

        const img = document.createElement('img');
        img.src = `./icons/${act.icon}`;
        img.alt = act.label;

        btn.appendChild(img);

        btn.onclick = () => handleActivityClick(act);
        grid.appendChild(btn);
    });
}

function handleActivityClick(activity) {
    const now = Date.now();

    // RESET ALL TIMERS when Wake Up is pressed (new day starts)
    if (activity.id === 'wakeup') {
        state = {
            currentActivityId: null,
            currentActivityStartTime: null,
            history: [],
            isDayStarted: false,
            dayStartTime: null
        };

        // Now start the new day with wake-up activity
        state.dayStartTime = now;
        state.isDayStarted = true;
        state.currentActivityId = activity.id;
        state.currentActivityStartTime = now;

        updateMetaDisplay(activity);
        renderActivities();
        saveState();
        return;
    }

    // Start Day Timer on FIRST activity of any kind if not started
    if (!state.isDayStarted) {
        state.dayStartTime = now;
        state.isDayStarted = true;
    }

    if (state.currentActivityId && state.currentActivityStartTime) {
        const duration = now - state.currentActivityStartTime;

        // Ensure history array exists
        if (!state.history) {
            state.history = [];
        }

        state.history.push({
            activityId: state.currentActivityId,
            startTime: state.currentActivityStartTime,
            endTime: now,
            duration: duration
        });
    }

    state.currentActivityId = activity.id;
    state.currentActivityStartTime = now;

    updateMetaDisplay(activity); // Update Label
    renderActivities();
    saveState();
}

function updateMetaDisplay(activity) {
    const el = document.getElementById('currentActivityLabel');
    if (el) el.textContent = activity.label;
}

function startTimerLoop() {
    requestAnimationFrame(timerTick);
}

function timerTick() {
    const now = Date.now();

    if (state.currentActivityStartTime) {
        const diff = now - state.currentActivityStartTime;
        document.getElementById('currentActivityTimer').textContent = formatTime(diff);
    }

    if (state.isDayStarted && state.dayStartTime) {
        const dayDiff = now - state.dayStartTime;
        document.getElementById('dayTimer').textContent = formatTime(dayDiff);
    } else {
        document.getElementById('dayTimer').textContent = "00:00:00";
    }

    // Always update timeline (Absolute Time of Day)
    updateTimeline();

    requestAnimationFrame(timerTick);
}

function updateTimeline() {
    const now = new Date();
    const currentH = now.getHours();
    const currentM = now.getMinutes();
    const nowMinutes = currentH * 60 + currentM;

    // 04:30 AM (270 min) to 10:30 PM (1350 min)
    const START_MIN = 270;
    const END_MIN = 1350;
    const TOTAL_DURATION = END_MIN - START_MIN;

    let elapsed = nowMinutes - START_MIN;
    if (elapsed < 0) elapsed = 0;

    let percentage = (elapsed / TOTAL_DURATION) * 100;
    if (percentage > 100) percentage = 100;

    const bar = document.getElementById('timelineProgress');
    if (bar) {
        bar.style.height = `${percentage}%`;
    }
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function setupNavigation() {
    const btns = document.querySelectorAll('.nav-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const mode = btn.dataset.mode;
            if (mode === 'run') {
                document.getElementById('mainPanel').style.display = 'flex';
                document.getElementById('settingsPanel').style.display = 'none';
                toggleSettingsMode(false);
            } else if (mode === 'settings') {
                document.getElementById('mainPanel').style.display = 'none';
                document.getElementById('settingsPanel').style.display = 'flex';
                toggleSettingsMode(true);
                // Render Build Info
                document.getElementById('settingsContent').innerHTML = `
                    <div style="padding: 20px; text-align: center; margin-top: 50px;">
                        <h2>MindfulDay</h2>
                        <p style="color: #8e8e93; margin-top: 5px;">Build: ${BUILD_DATE}</p>
                        <br>
                        
                        <!-- Force Refresh Button -->
                        <button onclick="checkForUpdates()" 
                                style="width: 100%; padding: 15px; background: #007aff; color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; margin-bottom: 20px;">
                            🔄 Check for Updates
                        </button>

                        <button onclick="if(confirm('Reset all data?')) { localStorage.clear(); alert('Application has been reset.'); location.reload(); }" 
                                style="width: 100%; padding: 15px; background: #ff3b30; color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600;">
                            ⚠️ Reset App Data
                        </button>
                    </div>
                `;
            }
        });
    });
}

function toggleSettingsMode(isSettings) {
    const side = document.querySelector('.side-panel');
    const timers = document.querySelector('.timers-capsule');

    if (isSettings) {
        if (side) side.style.display = 'none';
        if (timers) timers.style.visibility = 'hidden'; // Keep space or remove? User said "empty page". Let's hide visibility to keep layout stable or display none?
        // User screenshot shows grid structure. If we hide side panel, main panel might stretch.
        // Let's rely on CSS class if possible, but inline is faster for now.
        // Actually, let's use display:none for side, but we might lose grid alignment.
        // Let's try opacity 0 for side to keep layout, or just hide it.
        if (side) side.style.visibility = 'hidden';
    } else {
        if (side) side.style.display = 'flex';
        if (side) side.style.visibility = 'visible';
        if (timers) timers.style.visibility = 'visible';
    }
}

async function checkForUpdates() {
    try {
        const btn = document.querySelector('button[onclick="checkForUpdates()"]');
        if (btn) btn.textContent = "Checking...";

        // Fetch app.js with cache busting
        const response = await fetch('app.js?v=' + Date.now());
        const text = await response.text();

        // Extract DATE from the file
        const match = text.match(/const BUILD_DATE = "(.*?)";/);
        const serverDate = match ? match[1] : null;

        if (serverDate && serverDate !== BUILD_DATE) {
            if (confirm(`Update Available!\nServer: ${serverDate}\nCurrent: ${BUILD_DATE}\n\nDownload now?`)) {
                window.location.search = 'v=' + Date.now();
            }
        } else {
            alert("No update available.\nYou are on the latest version.");
        }

        if (btn) btn.textContent = "🔄 Check for Updates";
    } catch (e) {
        alert("Error checking for updates.\\n" + e.message);
    }
}

function registerServiceWorker() {
    // DISABLE PWA CACHING FOR DEV
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
            for (let registration of registrations) {
                registration.unregister();
                console.log("Service Worker Unregistered (Dev Mode)");
            }
        });
    }
}
