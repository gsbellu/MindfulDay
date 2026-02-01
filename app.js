/**
 * MindfulDay - Core Logic (v3)
 */

const STATE_KEY = 'mindfulDayState';
// This value is updated automatically by update_version.js
const ClientVersion = "V15-01.02.2026-09:44 PM";

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
    checkUpdateSuccess();
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

// Format timestamp to 12-hour time
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

// Format duration in milliseconds to human-readable
function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 60) {
        return `${totalMinutes} min${totalMinutes !== 1 ? 's' : ''}`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (minutes === 0) {
        return `${hours} hr${hours !== 1 ? 's' : ''}`;
    }
    return `${hours}h ${minutes}m`;
}

// Get activity summary for monitor view
function getActivitySummary() {
    const summary = {};

    // Initialize all activities
    ACTIVITIES.forEach(act => {
        summary[act.id] = {
            activityId: act.id,
            label: act.label,
            icon: act.icon,
            count: 0,
            totalDuration: 0,
            firstOccurrence: null
        };
    });

    // Process history
    state.history.forEach(entry => {
        const activityId = entry.activityId;
        if (summary[activityId]) {
            summary[activityId].count++;
            summary[activityId].totalDuration += entry.duration;
            if (!summary[activityId].firstOccurrence) {
                summary[activityId].firstOccurrence = entry.startTime;
            }
        }
    });

    // Include current activity if active
    if (state.currentActivityId && state.currentActivityStartTime) {
        const currentDuration = Date.now() - state.currentActivityStartTime;
        if (summary[state.currentActivityId]) {
            if (summary[state.currentActivityId].count === 0) {
                summary[state.currentActivityId].firstOccurrence = state.currentActivityStartTime;
            }
            summary[state.currentActivityId].count++;
            summary[state.currentActivityId].totalDuration += currentDuration;
        }
    }

    return Object.values(summary);
}


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

function renderMonitorView() {
    const monitorContainer = document.getElementById('monitorView');
    if (!monitorContainer) return;

    const summary = getActivitySummary();

    // Sort by first occurrence (tracked first, then by time)
    summary.sort((a, b) => {
        if (a.firstOccurrence && !b.firstOccurrence) return -1;
        if (!a.firstOccurrence && b.firstOccurrence) return 1;
        if (!a.firstOccurrence && !b.firstOccurrence) return 0;
        return a.firstOccurrence - b.firstOccurrence;
    });

    monitorContainer.innerHTML = summary.map(item => {
        const tracked = item.count > 0;
        const timeStr = tracked ? formatTime(item.firstOccurrence) : '';
        const countStr = item.count > 1 ? ` (${item.count})` : '';
        const durationStr = tracked ? formatDuration(item.totalDuration) : 'Not tracked';

        return `
            <div class="activity-row ${tracked ? 'tracked' : 'not-tracked'}">
                <img src="./icons/${item.icon}" class="activity-row-icon" alt="${item.label}">
                <div class="activity-row-details">
                    <div class="activity-row-name">${item.label}</div>
                    <div class="activity-row-info">
                        ${tracked ? `${timeStr}${countStr} - ${durationStr}` : durationStr}
                    </div>
                </div>
            </div>
        `;
    }).join('');
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

// Toggle Monitor View
function toggleMonitorView() {
    const isMonitorActive = document.body.classList.toggle('monitor-active');

    if (isMonitorActive) {
        renderMonitorView();
    }
}

function setupNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');

    navButtons.forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const mode = btn.dataset.mode;
            if (mode) switchMode(mode);
        };
    });
}

function switchMode(mode) {
    // 1. Update Nav Buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 2. Handle Panels & Content
    const mainPanel = document.getElementById('mainPanel');
    const settingsPanel = document.getElementById('settingsPanel');
    const body = document.body;

    switch (mode) {
        case 'run':
            mainPanel.style.display = 'flex';
            settingsPanel.style.display = 'none';
            body.classList.remove('monitor-active');
            toggleSettingsMode(false);
            break;

        case 'measure':
            mainPanel.style.display = 'flex';
            settingsPanel.style.display = 'none';
            body.classList.add('monitor-active');
            toggleSettingsMode(false);
            renderMonitorView();
            break;

        case 'settings':
            mainPanel.style.display = 'none';
            settingsPanel.style.display = 'flex';
            body.classList.remove('monitor-active'); // Ensure monitor doesn't bleed through
            toggleSettingsMode(true);
            renderSettings();
            break;
    }
}

// --- Versioning & Update Logic ---


async function getServerVersion() {
    try {
        const response = await fetch('version.json?t=' + Date.now());
        if (!response.ok) throw new Error("ver.json missing");
        const data = await response.json();
        return data.version;
    } catch (e) {
        console.warn("Could not fetch server version:", e);
        return "Unknown";
    }
}

async function renderSettings() {
    const serverVer = await getServerVersion();
    const isMismatch = (serverVer !== "Unknown" && serverVer !== ClientVersion);

    // Button style: Grey if disabled, Blue if enabled
    const btnColor = isMismatch ? '#007aff' : '#ccc';
    const btnText = isMismatch ? 'Update' : 'Up to Date';
    const btnDisabled = isMismatch ? '' : 'disabled';

    document.getElementById('settingsContent').innerHTML = `
        <div style="padding: 20px; text-align: center; margin-top: 50px;">
            <h2>MindfulDay</h2>
            
            <div style="margin: 20px 0; padding: 15px; background: rgba(0,0,0,0.05); border-radius: 10px; text-align: left;">
                <p style="margin: 5px 0;"><strong>Client Version:</strong> <br><span style="color: #007aff;">${ClientVersion}</span></p>
                <p style="margin: 5px 0; border-top: 1px solid #ccc; padding-top: 5px;"><strong>Server Version:</strong> <br><span style="color: ${isMismatch ? '#ff9500' : '#34c759'};">${serverVer}</span></p>
            </div>

            <button onclick="performUpdate()" 
                    id="updateBtn"
                    ${btnDisabled}
                    style="width: 100%; padding: 15px; background: ${btnColor}; color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; margin-bottom: 20px;">
                ${btnText}
            </button>

            <button onclick="if(confirm('Reset all data?')) { localStorage.clear(); alert('Application has been reset.'); location.reload(); }" 
                    style="width: 100%; padding: 15px; background: #ff3b30; color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600;">
                ⚠️ Reset App Data
            </button>
        </div>
    `;
}

async function performUpdate() {
    const btn = document.getElementById('updateBtn');
    if (btn) btn.textContent = "Updating...";

    // Set flag to show alert on reload
    localStorage.setItem('justUpdated', 'true');

    // Unregister SW to force fresh load on next visit immediately, or trigger update found
    if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let registration of registrations) {
            await registration.update(); // Try to update the SW
        }
    }

    // Force reload ignoring cache
    window.location.reload(true);
}

function checkUpdateSuccess() {
    if (localStorage.getItem('justUpdated') === 'true') {
        localStorage.removeItem('justUpdated');
        // Give UI a moment to render
        setTimeout(() => {
            alert(`Application successfully updated!\n\nCurrent Version:\n${ClientVersion}`);
        }, 500);
    }
}


function toggleSettingsMode(isSettings) {
    const side = document.querySelector('.side-panel');
    const timers = document.querySelector('.timers-capsule');

    if (isSettings) {
        if (side) {
            side.style.display = 'none';
            side.style.visibility = 'hidden';
        }
        if (timers) timers.style.visibility = 'hidden';
    } else {
        if (side) {
            side.style.display = 'flex';
            side.style.visibility = 'visible';
        }
        if (timers) timers.style.visibility = 'visible';
    }
}


function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then((reg) => {
                console.log('Service Worker Registered', reg);

                // Check if there's a waiting SW (update ready)
                if (reg.waiting) {
                    // Update available
                }

                reg.onupdatefound = () => {
                    const installingWorker = reg.installing;
                    installingWorker.onstatechange = () => {
                        if (installingWorker.state === 'installed') {
                            if (navigator.serviceWorker.controller) {
                                // New content available; please refresh.
                                console.log("New content available");
                            } else {
                                // Content cached for offline use.
                                console.log("Content cached for offline use");
                            }
                        }
                    };
                };
            })
            .catch((err) => {
                console.error('Service Worker Registration Failed', err);
            });

        // Handle controller change (when new SW takes over)
        let refreshing;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            window.location.reload();
            refreshing = true;
        });
    }
}
