/**
 * MindfulDay - Core Logic (v3)
 */

const STATE_KEY = 'mindfulDayState';
// This value is updated automatically by update_version.js
const ClientVersion = "V33-06.02.2026-08:45 PM";

// Correct SVG List
const DEFAULT_ACTIVITIES = [
    { "id": "wakeup", "label": "Wake Up", "icon": "wake-up_activity.svg", "duration": 10 },
    { "id": "bath", "label": "Bath", "icon": "bath_activity.svg", "duration": 30 },
    { "id": "meds", "label": "Meds", "icon": "ayurveda_activity.svg", "duration": 0 },
    { "id": "sadhana", "label": "Sadhana", "icon": "sadhana_activity.svg", "duration": 0 },
    { "id": "exercise", "label": "Exercise", "icon": "exercise_activity.svg", "duration": 0 },
    { "id": "groom", "label": "Groom", "icon": "groom_activity.svg", "duration": 15 },
    { "id": "dressup", "label": "Dress-up", "icon": "dress-up_activity.svg", "duration": 15 },
    { "id": "eat", "label": "Eat", "icon": "eat_activity.svg", "duration": 20 },
    { "id": "drive", "label": "Drive", "icon": "drive_activity.svg", "duration": 0 },
    { "id": "work", "label": "Work", "icon": "office-work_activity.svg", "duration": 0 },
    { "id": "chat", "label": "Chat", "icon": "chat_activity.svg", "duration": 0 },
    { "id": "coffee", "label": "Coffee", "icon": "coffee-break_activity.svg", "duration": 0 },
    { "id": "fun", "label": "Fun", "icon": "entertainment_activity.svg", "duration": 0 },
    { "id": "learn", "label": "Learn", "icon": "read_activity.svg", "duration": 0 },
    { "id": "walk", "label": "Walk", "icon": "walk_activity.svg", "duration": 0 },
    { "id": "relax", "label": "Relax", "icon": "relax_activity.svg", "duration": 0 },
    { "id": "sleep", "label": "Sleep", "icon": "sleep_activity.svg", "duration": 360 }
];

let state = {
    currentActivityId: null,
    currentActivityStartTime: null,
    dayStartTime: null,
    isDayStarted: false,
    history: [],
    yesterday: null, // Stores previous day's data
    activitySettings: null, // Check loadState for initialization
    startToEnd: null // { bornOn: '', endAt: '' }
};

function getActivities() {
    return state.activitySettings || DEFAULT_ACTIVITIES;
}

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    checkUpdateSuccess();

    // Fetch external settings (fire and forget, it will re-render when done)
    fetchActivitySettings();

    renderActivities();

    // Restore Label if activity is active
    if (state.currentActivityId) {
        const act = getActivities().find(a => a.id === state.currentActivityId);
        if (act) {
            // function is hoisted, so this is safe technically, 
            // but we'll ensure it's defined globally.
            updateMetaDisplay(act);
        }
    }

    setupNavigation();
    setupTabs();
    setupConfirmModal(); // Initialize Slider Logic
    startTimerLoop();
    registerServiceWorker();

    const closeBtn = document.getElementById('closeFocusBtn');
    if (closeBtn) {
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            hideFocusMode();
        };
    }
});

// Fetch activities from JSON file
function fetchActivitySettings() {
    // Add cache buster to ensure fresh data
    fetch(`settings_activities.json?t=${Date.now()}`)
        .then(response => {
            if (!response.ok) throw new Error("Settings file not found");
            return response.json();
        })
        .then(data => {
            console.log("Loaded activity settings:", data);
            state.activitySettings = data;
            renderActivities();
        })
        .catch(err => {
            console.warn("Could not load settings_activities.json, using defaults.", err);
        });
}

// --- Helper Functions ---

// Format timestamp to 12-hour time
function formatClockTime(timestamp) {
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
function getActivitySummary(targetHistory = null) {
    const summary = {};
    const historyToUse = targetHistory || state.history;

    // Initialize all activities
    getActivities().forEach(act => {
        summary[act.id] = {
            id: act.id, // Fixed: was activityId, caused mismatch
            label: act.label,
            icon: act.icon,
            count: 0,
            totalDuration: 0,
            firstOccurrence: null
        };
    });

    // Process history
    if (historyToUse) {
        historyToUse.forEach(entry => {
            const activityId = entry.activityId;
            if (summary[activityId]) {
                summary[activityId].count++;
                summary[activityId].totalDuration += entry.duration;
                if (!summary[activityId].firstOccurrence) {
                    summary[activityId].firstOccurrence = entry.startTime;
                }
            }
        });
    }

    // Include current activity if active AND we are looking at TODAY (no targetHistory passed)
    if (!targetHistory && state.currentActivityId && state.currentActivityStartTime) {
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

    // Ensure activitySettings is NOT loaded from stale local state
    // We want to force it to load from settings_activities.json or DEFAULT_ACTIVITIES
    state.activitySettings = null;

    // Ensure activitySettings exists (fallback to default immediately for initial paint)
    if (!state.activitySettings) {
        state.activitySettings = JSON.parse(JSON.stringify(DEFAULT_ACTIVITIES));
    }
    if (!state.startToEnd) {
        // Default values as requested
        state.startToEnd = { bornOn: '31-05-1978', endAt: '60' };
    }

    // Load from Firebase (will override local if exists)
    stateRef.once('value').then((snapshot) => {
        const firebaseState = snapshot.val();
        if (firebaseState) {
            state = firebaseState;
            // AGAIN, force clear settings to use JSON file
            state.activitySettings = null;

            if (!state.activitySettings) {
                state.activitySettings = JSON.parse(JSON.stringify(DEFAULT_ACTIVITIES));
            }
            fetchActivitySettings(); // Refetch to be sure
            renderActivities(); // Render defaults then update
        }
    }).catch((error) => {
        console.log('Firebase load failed, using local state:', error);
    });

    // Listen for real-time updates from other devices
    stateRef.on('value', (snapshot) => {
        const firebaseState = snapshot.val();
        if (firebaseState && firebaseState.lastUpdatedBy !== DEVICE_ID) {
            state = firebaseState;
            // Keep remote settings? User said "settings in JSON file".
            // So we should arguably ignore remote settings for activities too.
            // But let's assume JSON file is the source of truth for THIS client.
            state.activitySettings = null;
            fetchActivitySettings();

            renderMonitorView('measureToday');
            renderMonitorView('measureYesterday');
            updateMetaDisplay({ label: '' }); // potentially clear
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

function renderMonitorView(containerId, historySource) {
    const monitorContainer = document.getElementById(containerId);
    if (!monitorContainer) return;

    // Check if we have data to render
    if (historySource === undefined && containerId === 'measureYesterday') {
        // Special case for yesterday if it is null/undefined
        if (!state.yesterday || !state.yesterday.history || state.yesterday.history.length === 0) {
            monitorContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No data for yesterday</div>';
            return;
        }
        historySource = state.yesterday.history;
    }

    const summary = getActivitySummary(historySource);

    // Filter out items with no activity (User Request: "Do not show the activities that are not started")
    const activeItems = summary.filter(item => item.count > 0);

    if (activeItems.length === 0) {
        monitorContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No recorded activities</div>';
        return;
    }

    // Sort: Chronological (Latest on top)
    // "I meant the latest one should be there on the top" -> Descending start time
    activeItems.sort((a, b) => {
        if (a.firstOccurrence && !b.firstOccurrence) return -1;
        if (!a.firstOccurrence && b.firstOccurrence) return 1;
        if (!a.firstOccurrence && !b.firstOccurrence) return 0;
        return b.firstOccurrence - a.firstOccurrence; // Descending
    });

    monitorContainer.innerHTML = activeItems.map(item => {
        const tracked = item.count > 0;
        const timeStr = tracked ? formatClockTime(item.firstOccurrence) : '';
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

// Helper to get total duration for each activity today
function getTodayActivityDurations() {
    const durations = {};
    const summary = getActivitySummary(); // Uses state.history by default (Today)

    // Initialize all from settings to 0
    getActivities().forEach(act => durations[act.id] = 0);

    summary.forEach(item => {
        if (durations[item.id] !== undefined) {
            durations[item.id] = item.totalDuration; // ms
        }
    });

    return durations;
}

function renderActivities() {
    const grid = document.getElementById('activityGrid');
    grid.innerHTML = '';

    const activities = getActivities();
    // Deduplicate by ID
    const uniqueActivities = [];
    const seenIds = new Set();

    activities.forEach(act => {
        if (!seenIds.has(act.id)) {
            seenIds.add(act.id);
            uniqueActivities.push(act);
        }
    });

    console.log('Rendering activities:', uniqueActivities.length, uniqueActivities.map(a => a.label));

    // Get durations for status dots
    const currentDurations = getTodayActivityDurations();

    uniqueActivities.forEach(act => {
        const btn = document.createElement('div');
        btn.className = `activity-btn ${state.currentActivityId === act.id ? 'active' : ''}`;
        btn.style.position = 'relative'; // Ensure dot positioning works

        // STATUS DOT LOGIC
        const totalMs = currentDurations[act.id] || 0;
        const targetMin = act.duration || 0;
        const targetMs = targetMin * 60000;

        let dotClass = '';

        if (totalMs > 0) {
            // Activity has started/run at least once
            if (targetMin === 0) {
                // Unspecified duration: Green if >= 1 minute (60000ms)
                if (totalMs >= 60000) {
                    dotClass = 'green';
                } else {
                    dotClass = 'orange'; // Started but less than a minute
                }
            } else {
                // Specified duration
                if (totalMs >= targetMs) { // Changed > to >= just in case
                    dotClass = 'green';
                } else {
                    dotClass = 'orange';
                }
            }
        }

        const img = document.createElement('img');
        img.src = `./icons/${act.icon}`;
        img.alt = act.label;
        btn.appendChild(img);

        if (dotClass) {
            const dot = document.createElement('div');
            dot.className = `status-dot ${dotClass}`;
            btn.appendChild(dot);
        }

        btn.onclick = () => handleActivityClick(act);
        grid.appendChild(btn);
    });
}

function handleActivityClick(activity) {
    showConfirmModal(activity);
}

function confirmStart(activity) {
    const now = Date.now();

    // RESET ALL TIMERS when Wake Up is pressed (new day starts)
    if (activity.id === 'wakeup') {
        // Capture final activity of the day if one is running
        if (state.currentActivityId && state.currentActivityStartTime) {
            const duration = now - state.currentActivityStartTime;
            if (!state.history) state.history = [];
            state.history.push({
                activityId: state.currentActivityId,
                startTime: state.currentActivityStartTime,
                endTime: now,
                duration: duration
            });
        }

        // ROTATE HISTORY: Move current day to "Yesterday"
        const previousHistory = state.history || [];
        // Only rotate if there was actually a day started or some history
        if (state.isDayStarted || previousHistory.length > 0) {
            state.yesterday = {
                dayStartTime: state.dayStartTime,
                history: [...previousHistory] // Deep copy simple array of objects
            };
        }

        // Reset Today
        state.currentActivityId = null;
        state.currentActivityStartTime = null;
        state.history = [];
        state.isDayStarted = false;
        state.dayStartTime = null;

        // Now start the new day with wake-up activity
        state.dayStartTime = now;
        state.isDayStarted = true;
        state.currentActivityId = activity.id;
        state.currentActivityStartTime = now;

        updateMetaDisplay(activity);
        renderActivities();
        saveState();

        // Show Focus Mode for Wake Up too
        showFocusMode(activity);
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

    // Show Focus Mode on new activity click
    showFocusMode(activity);
}

// --- Focus Mode Logic ---
function showFocusMode(activity) {
    const focusView = document.getElementById('focusView');
    const activityGrid = document.getElementById('activityGrid');

    if (!focusView) return;

    // Customize title for Sadhana if needed, or rely on updateMetaDisplay
    if (activity.id === 'sadhana') {
        renderSadhanaView(focusView);
    } else {
        // Standard View
        // Populate standard data
        document.getElementById('focusIcon').src = `./icons/${activity.icon}`;
        document.getElementById('focusIcon').style.display = 'block';
        document.getElementById('focusLabel').textContent = activity.label;

        // Ensure Sadhana controls are hidden
        const sadhanaControls = document.getElementById('sadhanaControls');
        if (sadhanaControls) sadhanaControls.style.display = 'none';
    }

    // Initial Timer Render
    updateFocusTimers();

    // Show View
    focusView.style.display = 'flex';
    if (activityGrid) activityGrid.style.display = 'none';

    // Hide the bottom small timers (capsule)
    const timersCapsule = document.querySelector('.timers-capsule');
    if (timersCapsule) timersCapsule.style.display = 'none';

    // Add dismiss listeners
    focusView.onclick = (e) => {
        // Only dismiss if clicking the backdrop, NOT the interactive controls
        if (state.currentActivityId === 'sadhana') {
            // For Sadhana, be more careful about accidental closes
            if (e.target === focusView || e.target.classList.contains('close-btn')) {
                stopSadhanaAudio(); // Stop audio on close
                hideFocusMode();
            }
        } else {
            // Standard behavior
            if (e.target.closest('.focus-timer-block') || e.target.closest('.focus-icon-wrapper')) {
                // allow, maybe?
            }
            hideFocusMode();
        }
    };
}

function stopSadhanaAudio() {
    if (window.sadhanaAudio) {
        window.sadhanaAudio.pause();
        window.sadhanaAudio = null;
    }
    state.sadhanaMode = null;
    state.sadhanaTimerStart = null;
}

function renderSadhanaView(container) {
    // Hide standard icon
    const standardIcon = document.getElementById('focusIcon');
    if (standardIcon) standardIcon.style.display = 'none';

    // Check if controls already exist
    let controls = document.getElementById('sadhanaControls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'sadhanaControls';
        controls.className = 'sadhana-container';

        // Insert after icon wrapper
        const iconWrapper = container.querySelector('.focus-icon-wrapper');
        if (iconWrapper) {
            iconWrapper.appendChild(controls);
        }
    }

    controls.style.display = 'flex';

    // Render Buttons and Media Controls
    controls.innerHTML = `
        <div class="sadhana-buttons">
            <button class="sadhana-btn" onclick="startSadhanaMode('shakthi')">
                <img src="./icons/shakthi.png" alt="Shakthi">
            </button>
            <button class="sadhana-btn" onclick="startSadhanaMode('shambhavi')">
                <img src="./icons/shambhavi.png" alt="Shambhavi">
            </button>
            <button class="sadhana-btn" onclick="startSadhanaMode('shoonya')">
                <img src="./icons/shoonya.png" alt="Shoonya">
            </button>
        </div>
        
        <div class="media-controls" id="mediaControls">
            <button class="media-btn" onclick="seekSadhana(-10)">⏮</button>
            <button class="media-btn" onclick="restartSadhana()">|◀</button>
            <button class="media-btn play-pause-btn" onclick="toggleSadhanaPlay()">▶</button>
            <button class="media-btn" onclick="endSadhana()">▶|</button>
            <button class="media-btn" onclick="seekSadhana(10)">⏭</button>
        </div>
    `;

    updateSadhanaUI();
}

window.startSadhanaMode = function (mode) {
    state.sadhanaMode = mode;
    state.sadhanaTimerStart = Date.now(); // Start separate timer

    // Stop previous
    if (window.sadhanaAudio) {
        window.sadhanaAudio.pause();
    }

    if (mode === 'shoonya') {
        window.sadhanaAudio = null;
    } else {
        // Capitalize for filename: shakthi -> Shakthi.mp3
        const filename = mode.charAt(0).toUpperCase() + mode.slice(1);
        window.sadhanaAudio = new Audio(`./audio/${filename}.mp3`);
        window.sadhanaAudio.play().catch(e => console.error("Audio play failed", e));

        // Loop? User didn't specify. Assuming single play.
        window.sadhanaAudio.onended = () => {
            // Maybe auto-advance? NO requirements.
            updateSadhanaUI(); // Update play/pause icon
        };
    }

    updateSadhanaUI();
    updateFocusTimers(); // Immediate update
};

window.toggleSadhanaPlay = function () {
    if (window.sadhanaAudio) {
        if (window.sadhanaAudio.paused) {
            window.sadhanaAudio.play();
        } else {
            window.sadhanaAudio.pause();
        }
        updateSadhanaUI();
    }
};

window.seekSadhana = function (seconds) {
    if (window.sadhanaAudio) {
        window.sadhanaAudio.currentTime += seconds;
    }
};

window.restartSadhana = function () {
    if (window.sadhanaAudio) {
        window.sadhanaAudio.currentTime = 0;
        window.sadhanaAudio.play();
        updateSadhanaUI();
    }
};

window.endSadhana = function () {
    if (window.sadhanaAudio) {
        // Go to end
        window.sadhanaAudio.currentTime = window.sadhanaAudio.duration;
    }
};

function updateSadhanaUI() {
    // Update Label to show Sub-Mode
    const labelEl = document.getElementById('focusLabel');
    if (labelEl) {
        if (state.sadhanaMode) {
            labelEl.textContent = state.sadhanaMode.toUpperCase();
        } else {
            labelEl.textContent = 'SADHANA';
        }
    }

    // Highlight Active Button
    const btns = document.querySelectorAll('.sadhana-btn');
    btns.forEach(btn => {
        // logic to verify which button corresponds to state.sadhanaMode
        // Simpler: checking src relative path is flaky. 
        // Better: add data attributes or ID logic. 
        // For now, based on onclick string matching which is sloppy but works for simple DOM
        const mode = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
        if (mode === state.sadhanaMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Show/Hide Media Controls
    const mediaControls = document.getElementById('mediaControls');
    if (mediaControls) {
        if (state.sadhanaMode === 'shoonya' || !state.sadhanaMode) {
            mediaControls.style.display = 'none';
        } else {
            mediaControls.style.display = 'flex';
        }
    }

    // Update Play/Pause Icon
    const playBtn = document.querySelector('.play-pause-btn');
    if (playBtn && window.sadhanaAudio) {
        playBtn.textContent = window.sadhanaAudio.paused ? '▶' : '⏸';
    }
}

function hideFocusMode() {
    const focusView = document.getElementById('focusView');
    const activityGrid = document.getElementById('activityGrid');

    if (focusView) focusView.style.display = 'none';
    if (activityGrid) activityGrid.style.display = ''; // Clear inline style to let CSS control visibility

    // Restore standard elements
    const standardIcon = document.getElementById('focusIcon');
    if (standardIcon) standardIcon.style.display = 'block';

    // Restore bottom small timers
    const timersCapsule = document.querySelector('.timers-capsule');
    if (timersCapsule) timersCapsule.style.display = 'flex';
}

function updateFocusTimers() {
    const focusTimer = document.getElementById('focusTimer');
    const focusDayTimer = document.getElementById('focusDayTimer');
    if (!focusTimer || !focusDayTimer) return;

    const now = Date.now();

    if (state.currentActivityStartTime) {
        if (state.currentActivityId === 'sadhana') {
            // Debug Log
            // console.log('DEBUG Timer:', state.sadhanaTimerStart, state.currentActivityId);
            if (state.sadhanaTimerStart) {
                const diff = now - state.sadhanaTimerStart;
                focusTimer.textContent = formatTimer(diff);
            } else {
                // If sadhana is active but no sub-mode selected, maybe show total? 
                // Or if Shoonya, maybe 0? User asked for 0.
                focusTimer.textContent = "00:00:00";
            }
        } else {
            const diff = now - state.currentActivityStartTime;
            focusTimer.textContent = formatTimer(diff);
        }
    } else {
        focusTimer.textContent = "00:00:00";
    }

    if (state.isDayStarted && state.dayStartTime) {
        const dayDiff = now - state.dayStartTime;
        focusDayTimer.textContent = formatTimer(dayDiff);
    } else {
        focusDayTimer.textContent = "00:00:00";
    }
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
        document.getElementById('currentActivityTimer').textContent = formatTimer(diff);
    }

    if (state.isDayStarted && state.dayStartTime) {
        const dayDiff = now - state.dayStartTime;
        document.getElementById('dayTimer').textContent = formatTimer(dayDiff);
    } else {
        document.getElementById('dayTimer').textContent = "00:00:00";
    }

    // Always update timeline (Absolute Time of Day)
    updateTimeline();

    // Update Focus View timers if visible
    const focusView = document.getElementById('focusView');
    if (focusView && focusView.style.display !== 'none') {
        updateFocusTimers();
    }

    // Update Confirm Modal timers
    updateConfirmTimers();

    updateLifeProgress();

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

function formatTimer(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Toggle Monitor View - REMOVED
// function toggleMonitorView() {}

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

    // 2. Handle Panels
    const mainPanel = document.getElementById('mainPanel');
    const measurePanel = document.getElementById('measurePanel');
    const settingsPanel = document.getElementById('settingsPanel');

    // Side Panel Visibility
    const sidePanel = document.querySelector('.side-panel');
    const timers = document.querySelector('.timers-capsule');

    // Reset All
    mainPanel.style.display = 'none';
    measurePanel.style.display = 'none';
    settingsPanel.style.display = 'none';

    switch (mode) {
        case 'run':
            mainPanel.style.display = 'flex';
            if (sidePanel) sidePanel.style.display = 'flex';
            if (timers) timers.style.visibility = 'visible';
            break;

        case 'measure':
            measurePanel.style.display = 'flex';
            if (sidePanel) sidePanel.style.display = 'flex';
            if (timers) timers.style.visibility = 'visible';
            renderMonitorView('measureToday');
            renderMonitorView('measureYesterday');
            break;

        case 'settings':
            settingsPanel.style.display = 'flex';
            if (sidePanel) sidePanel.style.display = 'none';
            // if (timers) timers.style.visibility = 'hidden'; // Don't hide timers if user wants them? Actually user didn't specify, but let's stick to previous logic.
            // Wait, previous code had `if (timers) timers.style.visibility = 'hidden';`? No, let's check view_file.
            // View file line 600: `if (sidePanel) sidePanel.style.display = 'none';`.
            // The view didn't show the break or closing brace. I should view more lines to be safe, OR utilize the lines I saw.
            // I saw lines 598-600.
            // Let's replace ONLY lines 598-600 and append new lines.

            settingsPanel.style.display = 'flex';
            if (sidePanel) sidePanel.style.display = 'none';
            if (timers) timers.style.visibility = 'hidden';
            renderSettings();
            break;
    }
}

function renderSettings() {

    const content = document.getElementById('settingsContent');
    if (content) {
        content.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <h3>MindfulDay</h3>
                <p>Version: ${ClientVersion}</p>
                <br>
                <button onclick="checkForUpdates()" style="
                    padding: 10px 20px;
                    background: #f07c10;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    cursor: pointer;
                ">
                    Check for Updates / Refresh
                </button>
                <br><br>
                <p style="color: #666; font-size: 0.9em;">
                    Activity configuration is now managed via <code>settings_activities.json</code>
                </p>
            </div>
        `;
    }
}

// Removed old renderAllSettings calls and definitions as they are replaced by renderSettings
function renderAllSettings() { } // Stub or remove
function renderGeneralSettings() { }
// Cleanup complete

// Cleanup step 2 complete

// Cleanup complete

function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.onclick = () => {
            const targetId = tab.dataset.target;
            const container = tab.closest('.main-panel');

            // Update Buttons
            container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            tab.classList.add('active');

            // Update Content
            container.querySelectorAll('.tab-content').forEach(content => {
                if (content.id === targetId) {
                    content.style.display = 'flex';
                } else {
                    content.style.display = 'none';
                }
            });
        };
    });
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

async function renderGeneralSettings() {
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


// toggleSettingsMode removed - handled directly in switchMode


// Check for updates
window.checkForUpdates = async function () {
    console.log('Checking for updates...');
    if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let registration of registrations) {
            await registration.update();
        }
    }
    // Force reload ignoring cache
    window.location.reload(true);
};

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

function updateLifeProgress() {
    const bar = document.getElementById('lifeProgress');
    const label = document.getElementById('lifeProgressText');

    if (!state.startToEnd || !state.startToEnd.bornOn || !state.startToEnd.endAt) {
        if (label) label.textContent = '';
        return;
    }

    try {
        const parts = state.startToEnd.bornOn.split('-');
        if (parts.length !== 3) return;

        const born = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
        const endYears = parseInt(state.startToEnd.endAt);
        const end = new Date(born);
        end.setFullYear(born.getFullYear() + endYears);

        const now = new Date();
        const totalMs = end.getTime() - born.getTime();
        const elapsedMs = now.getTime() - born.getTime();

        let pct = (elapsedMs / totalMs) * 100;
        if (pct < 0) pct = 0;
        if (pct > 100) pct = 100;

        if (bar) {
            bar.style.height = `${pct}%`;
        }

        const remainingMs = end.getTime() - now.getTime();
        const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));

        if (label) {
            label.textContent = `${remainingDays} days to live`;
        }
    } catch (e) {
        console.warn('Life calculation error', e);
    }
}

// --- Slide-to-Confirm Logic ---

let pendingActivity = null;
let isDraggingSlider = false;
let sliderStartX = 0;
let sliderWidth = 0;
let handleWidth = 0;
let maxDrag = 0;

function setupConfirmModal() {
    const modal = document.getElementById('confirmModal');
    const closeBtn = document.getElementById('closeConfirmBtn');
    const handle = document.getElementById('sliderHandle');
    const container = document.getElementById('sliderContainer');

    if (closeBtn) {
        closeBtn.onclick = hideConfirmModal;
    }

    // Slider Events
    if (handle) {
        handle.addEventListener('mousedown', startDrag);
        handle.addEventListener('touchstart', startDrag, { passive: false });

        window.addEventListener('mousemove', onDrag);
        window.addEventListener('touchmove', onDrag, { passive: false });

        window.addEventListener('mouseup', endDrag);
        window.addEventListener('touchend', endDrag);
    }

    // Click on track to confirm (Right side click)
    if (container) {
        container.onclick = (e) => {
            // Check if we clicked the handle (already handled by drag/click logic there)
            if (e.target === handle || handle.contains(e.target)) return;

            // Otherwise, track click -> Confirm
            triggerConfirmAnimation();
        };
    }
}

function showConfirmModal(activity) {
    pendingActivity = activity;
    const modal = document.getElementById('confirmModal');

    // reset slider
    const handle = document.getElementById('sliderHandle');
    const text = document.querySelector('.slider-text');
    if (handle) {
        handle.style.transition = 'none';
        handle.style.transform = 'translateX(0px)';
    }
    if (text) text.style.opacity = '1';

    // Populate Data
    document.getElementById('confirmNewIcon').src = `./icons/${activity.icon}`;

    // Current Icon
    const curIconImg = document.getElementById('confirmCurrentIcon');
    if (state.currentActivityId) {
        const currentAct = getActivities().find(a => a.id === state.currentActivityId);
        if (currentAct) {
            curIconImg.src = `./icons/${currentAct.icon}`;
            curIconImg.style.opacity = '1';
        } else {
            curIconImg.src = `./icons/run_mode.svg`;
            curIconImg.style.opacity = '0.3';
        }
    } else {
        curIconImg.src = `./icons/run_mode.svg`;
        curIconImg.style.opacity = '0.3';
    }

    // Current Timer Data
    const currentLabel = document.getElementById('confirmCurrentLabel');
    const currentTimer = document.getElementById('confirmCurrentTimer');
    const currentBlock = document.getElementById('confirmCurrentBlock');

    if (state.currentActivityId) {
        const currentAct = getActivities().find(a => a.id === state.currentActivityId);
        currentLabel.textContent = currentAct ? currentAct.label : "UNKNOWN";
        currentBlock.style.background = "#468e40";
    } else {
        currentLabel.textContent = "READY";
        currentTimer.textContent = "00:00:00";
        currentBlock.style.background = "#ccc";
    }

    updateConfirmTimers();
    modal.style.display = 'flex';
}

function hideConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
    pendingActivity = null;
}

function startDrag(e) {
    isDraggingSlider = true;
    const handle = document.getElementById('sliderHandle');
    const container = document.getElementById('sliderContainer');

    handle.style.transition = 'none'; // distinct 1:1 movement

    sliderStartX = e.type.includes('mouse') ? e.pageX : e.touches[0].pageX;
    sliderWidth = container.offsetWidth;
    handleWidth = handle.offsetWidth;
    maxDrag = sliderWidth - handleWidth - 8; // 8px total padding (4px each side)
}

function onDrag(e) {
    if (!isDraggingSlider) return;

    e.preventDefault(); // Prevent scrolling on touch

    const currentX = e.type.includes('mouse') ? e.pageX : e.touches[0].pageX;
    let diff = currentX - sliderStartX;

    if (diff < 0) diff = 0;
    if (diff > maxDrag) diff = maxDrag;

    const handle = document.getElementById('sliderHandle');
    handle.style.transform = `translateX(${diff}px)`;

    // Opacity fade for text
    const text = document.querySelector('.slider-text');
    const opacity = 1 - (diff / maxDrag);
    if (text) text.style.opacity = opacity;
}

function endDrag(e) {
    if (!isDraggingSlider) return;
    isDraggingSlider = false;

    const handle = document.getElementById('sliderHandle');
    const currentTransform = handle.style.transform;
    const px = parseFloat(currentTransform.replace('translateX(', '').replace('px)', '')) || 0;

    // Check for "Click" (negligible movement)
    const currentX = e.type.includes('mouse') ? e.pageX : e.touches[0].pageX;
    // For mouseup, e.pageX is valid. For touchend, it's in e.changedTouches
    const endX = e.type.includes('mouse') ? e.pageX : e.changedTouches[0].pageX;
    const movedDist = Math.abs(endX - sliderStartX);

    const isClick = movedDist < 5; // moved less than 5 pixels

    // If dragged more than 50% (Lowered from 90% for better feel) OR Clicked
    if (px > maxDrag * 0.5 || isClick) {
        triggerConfirmAnimation();
    } else {
        // Snap Back
        handle.style.transition = 'transform 0.3s ease';
        handle.style.transform = 'translateX(0px)';
        const text = document.querySelector('.slider-text');
        if (text) text.style.opacity = '1';
    }
}

function triggerConfirmAnimation() {
    if (!pendingActivity) return;

    const handle = document.getElementById('sliderHandle');
    const container = document.getElementById('sliderContainer');
    const width = container.offsetWidth;
    const hWidth = handle.offsetWidth;
    const finalDrag = width - hWidth - 8;

    handle.style.transition = 'transform 0.2s ease'; // Fast slide
    handle.style.transform = `translateX(${finalDrag}px)`;

    // Hide text
    const text = document.querySelector('.slider-text');
    if (text) text.style.opacity = '0';

    setTimeout(() => {
        if (pendingActivity) {
            confirmStart(pendingActivity);
        }
        hideConfirmModal();
    }, 250);
}

function updateConfirmTimers() {
    if (document.getElementById('confirmModal').style.display === 'none') return;

    const now = Date.now();

    // Current Activity Timer
    if (state.currentActivityStartTime) {
        const diff = now - state.currentActivityStartTime;
        document.getElementById('confirmCurrentTimer').textContent = formatTimer(diff);
    }

    // Day Timer
    if (state.isDayStarted && state.dayStartTime) {
        const dayDiff = now - state.dayStartTime;
        document.getElementById('confirmDayTimer').textContent = formatTimer(dayDiff);
    } else {
        document.getElementById('confirmDayTimer').textContent = "00:00:00";
    }
}
