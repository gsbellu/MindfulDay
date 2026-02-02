/**
 * MindfulDay - Core Logic (v3)
 */

const STATE_KEY = 'mindfulDayState';
// This value is updated automatically by update_version.js
const ClientVersion = "V23-02.02.2026-10:18 PM";

// Correct SVG List
const DEFAULT_ACTIVITIES = [
    { id: 'wakeup', icon: 'wake-up_activity.svg', label: 'Wake Up', startTime: '5:00 AM', duration: 10 },
    { id: 'bath', icon: 'bath_activity.svg', label: 'Bath', startTime: '5:15 AM', duration: 20 },
    { id: 'medicines', icon: 'ayurveda_activity.svg', label: 'Meds', startTime: '5:45 AM', duration: 15 },
    { id: 'sadhana', icon: 'sadhana_activity.svg', label: 'Sadhana', startTime: '6:00 AM', duration: 120 },
    { id: 'family', icon: 'family-time_activity.svg', label: 'Family', startTime: '8:00 AM', duration: 30 },
    { id: 'exercise', icon: 'exercise_activity.svg', label: 'Exercise', startTime: '8:30 AM', duration: 30 },
    { id: 'breakfast', icon: 'eat_activity.svg', label: 'Breakfast', startTime: '9:00 AM', duration: 30 },
    { id: 'dress', icon: 'dress-up_activity.svg', label: 'Dress', startTime: '9:30 AM', duration: 15 },
    { id: 'drive', icon: 'drive_activity.svg', label: 'Drive', startTime: '9:45 AM', duration: 45 },
    { id: 'work', icon: 'office-work_activity.svg', label: 'Work', startTime: '10:30 AM', duration: 480 },
    { id: 'shoonya', icon: 'sadhana_activity.svg', label: 'Shoonya', startTime: '6:00 PM', duration: 15 },
    { id: 'lunch', icon: 'eat_activity.svg', label: 'Lunch', startTime: '1:00 PM', duration: 30 },
    { id: 'chat', icon: 'chat_activity.svg', label: 'Chat', startTime: '7:00 PM', duration: 30 },
    { id: 'coffee', icon: 'coffee-break_activity.svg', label: 'Coffee', startTime: '4:00 PM', duration: 15 },
    { id: 'entertainment', icon: 'entertainment_activity.svg', label: 'Fun', startTime: '8:00 PM', duration: 60 },
    { id: 'walk', icon: 'walk_activity.svg', label: 'Walk', startTime: '7:30 PM', duration: 30 },
    { id: 'hobby', icon: 'hobby_activity.svg', label: 'Hobby', startTime: '9:00 PM', duration: 60 },
    { id: 'sleep', icon: 'sleep_activity.svg', label: 'Sleep', startTime: '10:00 PM', duration: 420 }
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

    // Ensure activitySettings exists
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
            if (!state.activitySettings) {
                state.activitySettings = JSON.parse(JSON.stringify(DEFAULT_ACTIVITIES));
            }
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
            if (!state.activitySettings) {
                state.activitySettings = JSON.parse(JSON.stringify(DEFAULT_ACTIVITIES));
            }
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

    // Filter out items with no activity if it's yesterday
    const itemsFunc = (item) => {
        if (containerId === 'measureYesterday') {
            return item.count > 0;
        }
        return true;
    };

    // Check if empty after filter
    const activeItems = summary.filter(itemsFunc);

    if (containerId === 'measureYesterday' && activeItems.length === 0) {
        monitorContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No recorded activities</div>';
        return;
    }

    // Sort: Tracked first
    summary.sort((a, b) => {
        if (a.firstOccurrence && !b.firstOccurrence) return -1;
        if (!a.firstOccurrence && b.firstOccurrence) return 1;
        if (!a.firstOccurrence && !b.firstOccurrence) return 0;
        return a.firstOccurrence - b.firstOccurrence;
    });

    monitorContainer.innerHTML = summary.map(item => {
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

function renderActivities() {
    const grid = document.getElementById('activityGrid');
    grid.innerHTML = '';

    getActivities().forEach(act => {
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

    // Populate data
    document.getElementById('focusIcon').src = `./icons/${activity.icon}`;
    document.getElementById('focusLabel').textContent = activity.label;

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
        // If clicking the container background (not the inner content blocks ideally, but user said "anywhere")
        // User said "click anywhere in the screen". 
        // We'll just close it.
        hideFocusMode();
    };

    // Prevent immediate close if bubble propagation issues (optional, but "anywhere" is broad)
    // Actually, "anywhere" includes the buttons themselves usually? 
    // Let's assume clicking ANYWHERE dismisses it. 
    // BUT, we have a specific Close button too. 
}

function hideFocusMode() {
    const focusView = document.getElementById('focusView');
    const activityGrid = document.getElementById('activityGrid');

    if (focusView) focusView.style.display = 'none';
    if (activityGrid) activityGrid.style.display = ''; // Clear inline style to let CSS control visibility

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
        const diff = now - state.currentActivityStartTime;
        focusTimer.textContent = formatTimer(diff);
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
    if (focusView && focusView.style.display !== 'none') {
        updateFocusTimers();
    }

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
            if (timers) timers.style.visibility = 'hidden';
            if (timers) timers.style.visibility = 'hidden';
            renderAllSettings();
            break;
    }
}

function renderAllSettings() {
    renderGeneralSettings();
    renderActivitySettings();
}

function renderActivitySettings() {
    const container = document.getElementById('settingsActivity');
    if (!container) return;

    // Clear container to avoid duplicates if re-rendered
    container.innerHTML = '';

    getActivities().forEach(act => {
        // Safe accessors
        const labelSafe = act.label || '';
        const startSafe = act.startTime || '';
        const durationSafe = act.duration || '';

        const row = document.createElement('div');
        row.className = 'settings-row';
        row.innerHTML = `
            <div class="settings-icon">
                <img src="./icons/${act.icon}" alt="${labelSafe}">
            </div>
            
            <input type="text" 
                   class="settings-input settings-name" 
                   value="${labelSafe}" 
                   onchange="updateActivitySetting('${act.id}', 'label', this.value)"
                   placeholder="Name">
                   
            <input type="text" 
                   class="settings-input settings-time" 
                   value="${startSafe}" 
                   onchange="updateActivitySetting('${act.id}', 'startTime', this.value)"
                   placeholder="5:00 AM">
                   
            <input type="number" 
                   class="settings-input settings-duration" 
                   value="${durationSafe}" 
                   onchange="updateActivitySetting('${act.id}', 'duration', this.value)"
                   placeholder="Min">
        `;
        container.appendChild(row);
    });

    // Add a "Restore Defaults" button at the bottom
    const restoreDiv = document.createElement('div');
    restoreDiv.style.padding = '20px';
    restoreDiv.style.textAlign = 'center';
    restoreDiv.innerHTML = `<button style="color: #ff3b30; background: none; border: none; font-size: 14px; cursor: pointer;">Restore Defaults</button>`;
    restoreDiv.querySelector('button').onclick = () => {
        if (confirm('Reset all activity names and times to default?')) {
            state.activitySettings = null; // Will trigger reload from default
            saveState();
            location.reload();
        }
    };
    container.appendChild(restoreDiv);

    // Start-to-End Section
    const steSection = document.createElement('div');
    steSection.className = 'ste-section';
    steSection.innerHTML = `
        <div class="ste-title">Start to End:</div>
        <div class="ste-row">
            <span class="ste-label">Born on:</span>
            <input type="text" 
                   value="${(state.startToEnd && state.startToEnd.bornOn) || ''}" 
                   onchange="updateStartToEnd('bornOn', this.value)"
                   class="ste-input"
                   placeholder="DD-MM-YYYY">
        </div>
        <div class="ste-row">
            <span class="ste-label">End at</span>
            <input type="number" 
                   value="${(state.startToEnd && state.startToEnd.endAt) || ''}" 
                   onchange="updateStartToEnd('endAt', this.value)"
                   class="ste-input-small"
                   placeholder="60">
            <span style="margin-left: 5px;">Years</span>
        </div>
    `;
    container.appendChild(steSection);
}

window.updateStartToEnd = function (field, value) {
    if (!state.startToEnd) state.startToEnd = { bornOn: '', endAt: '' };
    state.startToEnd[field] = value;
    saveState();
};

// Exposed globally for onchange events
window.updateActivitySetting = function (id, field, value) {
    if (!state.activitySettings) {
        state.activitySettings = JSON.parse(JSON.stringify(DEFAULT_ACTIVITIES));
    }

    const act = state.activitySettings.find(a => a.id === id);
    if (act) {
        if (field === 'duration') {
            act[field] = parseInt(value) || 0;
        } else {
            act[field] = value;
        }
        saveState();
        // Re-render main grid to reflect name changes immediately
        renderActivities();
    }
};

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
