/**
 * MindfulDay - Core Logic (v3)
 */

const STATE_KEY = 'mindfulDayState';
const BUILD_DATE = "31 Jan 2026, 6:40 PM";

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
});

// --- Helper Functions ---

function loadState() {
    const saved = localStorage.getItem(STATE_KEY);
    if (saved) {
        state = JSON.parse(saved);
    }
}

function saveState() {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
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

    // Start Day Timer on FIRST activity of any kind if not started
    if (!state.isDayStarted) {
        state.dayStartTime = now;
        state.isDayStarted = true;
    }

    if (state.currentActivityId && state.currentActivityStartTime) {
        const duration = now - state.currentActivityStartTime;
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
            } else if (mode === 'settings') {
                document.getElementById('mainPanel').style.display = 'none';
                document.getElementById('settingsPanel').style.display = 'block';
                // Render Build Info
                document.getElementById('settingsContent').innerHTML = `
                    <div style="padding: 20px; text-align: center;">
                        <h2>MindfulDay</h2>
                        <p>Version: 1.0.0</p>
                        <p>Build: ${BUILD_DATE}</p>
                        <br>
                        <button onclick="localStorage.clear(); location.reload();" 
                                style="padding: 10px 20px; background: #ff3b30; color: white; border: none; border-radius: 12px; font-size: 16px;">
                            Reset App
                        </button>
                    </div>
                `;
            }
        });
    });
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
