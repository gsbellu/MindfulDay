/**
 * MindfulDay - Core Logic (v3)
 */

const STATE_KEY = 'mindfulDayState';
// This value is updated automatically by update_version.js
const ClientVersion = "V43-08.02.2026-03:37 PM";

// Correct SVG List
// Default activities removed. 
// Now strictly using settings_activities.json as source of truth.
const DEFAULT_ACTIVITIES = [];

// PWA Install Prompt
let deferredPrompt;
window.pwaDebugLog = window.pwaDebugLog || [];

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.pwaDebugLog.push(new Date().toLocaleTimeString() + ': beforeinstallprompt fired!');

    // Update UI
    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) installBtn.style.display = 'flex';
});

window.addEventListener('appinstalled', () => {
    window.pwaDebugLog.push(new Date().toLocaleTimeString() + ': App Installed');
    deferredPrompt = null;
});

async function installPWA() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    deferredPrompt = null;
    const installBtn = document.getElementById('pwaInstallBtn');
    if (installBtn) {
        installBtn.style.display = 'none';
    }
}

let state = {
    currentActivityId: null,
    currentActivityStartTime: null,
    dayStartTime: null,
    isDayStarted: false,
    history: [],
    yesterday: null, // Stores previous day's data
    activitySettings: null, // Check loadState for initialization
    quotes: [], // Stores all Sadhguru quotes
    quoteBag: [], // For "Shuffle Bag" logic to prevent repeats
    startToEnd: null // { bornOn: '', endAt: '' }
};

function getActivities() {
    return state.activitySettings || [];
}

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    checkUpdateSuccess();

    // Fetch quotes
    fetchQuotes();

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
    // Use ResizeObserver for more robust grid resizing handling
    const grid = document.getElementById('activityGrid');
    if (grid) {
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Only re-render if visible and has size
                if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
                    // Debounce or just call? Rendering is cheap enough here.
                    // Check if we already have items to render
                    if (state.activitySettings) {
                        // requestAnimationFrame to avoid loop limits if it triggers another resize
                        requestAnimationFrame(() => renderActivities());
                    }
                }
            }
        });
        resizeObserver.observe(grid);
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

            // Restore Label if we have a valid current activity (Fix for missing label on reload)
            if (state.currentActivityId) {
                const act = state.activitySettings.find(a => a.id === state.currentActivityId);
                if (act) updateMetaDisplay(act);
            }
        })
        .catch(err => {
            console.warn("Could not load settings_activities.json, using defaults.", err);
        });
}

function fetchQuotes() {
    fetch(`sadhguru.json?t=${Date.now()}`)
        .then(response => {
            if (!response.ok) throw new Error("Quotes file not found");
            return response.json();
        })
        .then(data => {
            state.quotes = data;
            console.log("Loaded quotes:", data.length);
        })
        .catch(err => {
            console.warn("Could not load sadguru.json", err);
            state.quotes = [];
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

    // Ensure activitySettings exists (initially empty, waiting for fetch)
    if (!state.activitySettings) {
        state.activitySettings = [];
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
                state.activitySettings = [];
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

    const itemCount = uniqueActivities.length;
    if (itemCount === 0) return;

    // --- Dynamic Grid Calculation ---
    // We need to fit 'itemCount' squares into the grid container.
    // We want to maximize the side length 's'.

    // Get container dimensions
    // Use getBoundingClientRect to get precise pixels
    const containerRect = grid.getBoundingClientRect();
    const W = containerRect.width;
    const H = containerRect.height;
    const GAP = 8; // Must match CSS

    let bestCols = 1;
    let bestRows = itemCount;
    let maxSquareSize = 0;

    // Brute force optimal columns (1 to itemCount)
    for (let cols = 1; cols <= itemCount; cols++) {
        const rows = Math.ceil(itemCount / cols);

        // Calculate available width/height accounting for gaps
        // Width = cols * s + (cols - 1) * GAP
        // s * cols = Width - (cols - 1) * GAP
        // s = (Width - (cols - 1) * GAP) / cols

        const availableW = W - (cols - 1) * GAP;
        const sW = availableW / cols;

        const availableH = H - (rows - 1) * GAP;
        const sH = availableH / rows;

        const s = Math.min(sW, sH);

        if (s > maxSquareSize) {
            maxSquareSize = s;
            bestCols = cols;
            bestRows = rows;
        }
    }

    // Apply styles to grid
    // Ensure we don't end up with negative values if container is hidden/0
    if (maxSquareSize > 0) {
        grid.style.gridTemplateColumns = `repeat(${bestCols}, ${maxSquareSize}px)`;
        grid.style.gridTemplateRows = `repeat(${bestRows}, ${maxSquareSize}px)`;
    } else {
        // Fallback if hidden
        grid.style.gridTemplateColumns = `repeat(3, 1fr)`;
        grid.style.gridTemplateRows = `auto`;
    }


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

        // Reset Sadhana state if we are switching TO it (or just re-opening it)
        // Wait, if it IS the current activity, do we reset? 
        // User said "When Sadhana activity starts... should start from zero".
        // If I click the focused activity again, maybe I want to check time. 
        // But here we are returning early if it IS the current activity.
        // So this logic only runs if we are *switching* to it or opening it fresh. 

        // Actually, the block above handles "If clicking the SAME activity again".
        // So we need to insert the reset logic there too if we want "Re-clicking resets"? 
        // No, re-clicking usually just shows the focus view. 
        // The user says "When Sadhana activity starts...". 
        // Let's assume on "Switch".

        // Show Focus Mode only for Sadhana
        if (activity.id === 'sadhana') {
            showFocusMode(activity);
        } else {
            hideFocusMode();
        }

        // Show Quote Overlay with slight delay to appear "after" switch
        // Show Quote Overlay with minimal delay (next tick) to ensure DOM update
        setTimeout(() => {
            showQuoteOverlay();
        }, 0);
        return;
    }

    // New Activity Clicked

    // Reset Sadhana state for fresh start whenever we switch activities
    state.sadhanaMode = null;
    state.sadhanaTimerStart = null;
    if (window.sadhanaAudio) {
        window.sadhanaAudio.pause();
        window.sadhanaAudio = null;
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

    // Show Focus Mode only for Sadhana
    if (activity.id === 'sadhana') {
        showFocusMode(activity);
    } else {
        hideFocusMode();
    }

    // Show Quote Overlay with slight delay
    // Show Quote Overlay with minimal delay (next tick)
    setTimeout(() => {
        showQuoteOverlay();
    }, 0);
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
    // Show standard icon for Sadhana too
    const standardIcon = document.getElementById('focusIcon');
    if (standardIcon) {
        standardIcon.src = './icons/sadhana_activity.svg';
        standardIcon.style.display = 'block';
    }

    // Hide the redundant timer block in Sadhana view
    const timerBlock = container.querySelector('.focus-timer-block');
    if (timerBlock) {
        timerBlock.style.display = 'none';
    }

    // Check if controls already exist
    let controls = document.getElementById('sadhanaControls');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'sadhanaControls';
        controls.className = 'sadhana-container';

        // Insert at the end of the container (Focus Content)
        // This ensures it sits BELOW the icon wrapper
        container.appendChild(controls);
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

    // Update Green Pill Label too
    const activityLabel = document.getElementById('currentActivityLabel');
    if (activityLabel) {
        if (state.sadhanaMode) {
            activityLabel.textContent = state.sadhanaMode.toUpperCase();
        } else {
            activityLabel.textContent = 'SADHANA';
        }
    }

    // Highlight Active Button
    const btns = document.querySelectorAll('.sadhana-btn');
    btns.forEach(btn => {
        // logic to verify which button corresponds to state.sadhanaMode
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
    // Stop Audio if running
    stopSadhanaAudio();

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
                // If sadhana is active but no sub-mode selected, show TOTAL duration
                const diff = now - state.currentActivityStartTime;
                focusTimer.textContent = formatTimer(diff);
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
        bar.style.width = `${percentage}%`; // Horizontal
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

    // Reset All Main Area Content
    const grid = document.getElementById('activityGrid');
    if (grid) grid.style.display = 'none';
    if (measurePanel) measurePanel.style.display = 'none';
    if (settingsPanel) settingsPanel.style.display = 'none';

    // Hide Focus View if switching modes (unless we want to persist it? usually switching implies leaving activity view)
    // Actually, user might want to check settings while timer runs. 
    // But for now, let's just show the target panel.
    const focusView = document.getElementById('focusView');
    if (focusView) focusView.style.display = 'none';

    switch (mode) {
        case 'run':
            // Logic: If activity is running, show Focus View? Or just grid?
            // "Run" usually means the main activity selection or current activity.
            if (state.currentActivityId && focusView && state.currentActivityId !== 'sadhana') { // Sadhana has its own logic?
                // Actually, let's simple show grid, and let click handling show focus.
                // Or if persistent?
                // For simplicity: Show Grid. 
                if (grid) grid.style.display = 'grid';
                renderActivities();
            } else {
                if (grid) grid.style.display = 'grid';
                renderActivities();
            }
            break;

        case 'measure':
            if (measurePanel) {
                measurePanel.style.display = 'flex';
                renderMonitorView('measureToday');
                renderMonitorView('measureYesterday');
            }
            break;

        case 'settings':
            if (settingsPanel) {
                settingsPanel.style.display = 'flex'; // Settings now inside main panel
                showSettings();
            }
            break;
    }

    // Trigger Progress Bar Animation
    // Reset to 0 then restore
    const timelineBar = document.getElementById('timelineProgress');
    const lifeBar = document.getElementById('lifeProgressBar');

    // Disable transition temporarily? No, we want the visual shrink then grow? 
    // Or just grow from 0? 
    // "Ensure progress bars animate from 0% every time you switch modes."
    // implying they should start at 0 and grow to current value.

    if (timelineBar) {
        timelineBar.style.transition = 'none'; // Disable transition for instant reset
        timelineBar.style.width = '0%';
        void timelineBar.offsetWidth; // Force reflow
        timelineBar.style.transition = 'width 0.5s ease'; // Re-enable

        // Slight delay to ensure the 0% is registered before animating
        setTimeout(() => {
            updateTimeline();
        }, 50);
    }

    if (lifeBar) {
        lifeBar.style.transition = 'none';
        lifeBar.style.width = '0%';
        void lifeBar.offsetWidth;
        lifeBar.style.transition = 'width 0.5s ease';

        setTimeout(() => {
            updateLifeProgress();
        }, 50);
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
async function renderGeneralSettings() {
    // Show 'Loading...' initially? Or just await?

    let serverVer = "Unknown";
    try {
        serverVer = await getServerVersion();
    } catch (e) { console.warn("Version fetch failed", e); }

    // Use ClientVersion from top of file
    const isMismatch = (serverVer !== "Unknown" && serverVer !== ClientVersion);

    // Button style: Grey if disabled, Blue if enabled
    const btnColor = isMismatch ? '#007aff' : '#ccc';
    const btnText = isMismatch ? 'Update' : 'Up to Date';
    const btnDisabled = isMismatch ? '' : 'disabled';

    const settingsContent = document.getElementById('settingsContent');
    if (!settingsContent) return;

    settingsContent.innerHTML = `
        <div style="padding: 10px; text-align: center; margin-top: 10px;">
            <h3>MindfulDay</h3>
            
            <div style="margin: 15px 0; padding: 10px; background: rgba(0,0,0,0.05); border-radius: 10px; text-align: left;">
                <p style="margin: 5px 0;"><strong>Client Version:</strong> <br><span style="color: #007aff;">${ClientVersion}</span></p>
                <p style="margin: 5px 0; border-top: 1px solid #ccc; padding-top: 5px;"><strong>Server Version:</strong> <br><span style="color: ${isMismatch ? '#ff9500' : '#34c759'};">${serverVer}</span></p>
            </div>

            <button onclick="performUpdate()" 
                    id="updateBtn"
                    ${btnDisabled}
                    style="width: 100%; padding: 12px; background: ${btnColor}; color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; margin-bottom: 20px;">
                ${btnText}
            </button>

            <button onclick="if(confirm('Reset all data?')) { localStorage.clear(); alert('Application has been reset.'); location.reload(); }" 
                    style="width: 100%; padding: 12px; background: #ff3b30; color: white; border: none; border-radius: 12px; font-size: 16px; font-weight: 600;">
                ⚠️ Reset App Data
            </button>
        </div>
    `;
}
// Cleanup complete

// Cleanup step 2 complete

// Cleanup complete

function setupTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.onclick = () => {
            const targetId = tab.dataset.target;
            // Use closest measure-container or fallback to document query if needed, 
            // but measure-container is the parent of the tab nav.
            let container = tab.closest('.measure-container');
            if (!container) container = document; // Fallback

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

            // If switching to yesterday, force render to ensure data shows
            if (targetId === 'measureYesterday') {
                renderMonitorView('measureYesterday');
            }
        };
    });
}
window.hideQuoteOverlay = function () {
    const overlay = document.getElementById('quoteOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
};

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

// Consolidated/Removed duplicate updateLifeProgress - see the one at the bottom
function updateLifeProgress_OLD_REMOVED() { }

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

    // Close on background click
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) {
                hideConfirmModal();
            }
        };
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

    // Set dynamic title
    const confirmTitle = document.getElementById('confirmTitle');
    if (confirmTitle) {
        confirmTitle.textContent = `Switch to ${activity.label}?`;
    }

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

    // If dragged more than 50% (User requested: force complete if > 50%)
    const threshold = maxDrag * 0.5;
    console.log(`[Slider Debug] Drag End. px: ${px}, maxDrag: ${maxDrag}, threshold: ${threshold}, isClick: ${isClick}`);

    if (px > threshold || isClick) {
        // User requested "Force complete it" - ensure this path is robust
        console.log("Triggering confirmation via drag/click");
        triggerConfirmAnimation();
    } else {
        // Snap Back
        console.log("Snapping back (did not reach 50%)");
        handle.style.transition = 'transform 0.3s ease';
        handle.style.transform = 'translateX(0px)';
        const text = document.querySelector('.slider-text');
        if (text) text.style.opacity = '1';
    }
}

function triggerConfirmAnimation() {
    // Capture activity immediately to prevent race conditions with hideConfirmModal
    const activityToStart = pendingActivity;
    if (!activityToStart) return;

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
        // Use local variable
        if (activityToStart) {
            confirmStart(activityToStart);
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



// --- Sadhguru Quote Logic (Shuffle Bag) ---

// Fisher-Yates Shuffle
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function showQuoteOverlay() {
    // 1. Ensure Bag is Ready
    if (!state.quoteBag || state.quoteBag.length === 0) {
        let pool = state.quotes;

        // Fallback if main list empty
        if (!pool || pool.length === 0) {
            console.warn("Using fallback quotes");
            pool = [
                "How deeply you touch another life is how rich your life is.",
                "You cannot exist without the universe. You are not a separate existence.",
                "Learning is not about earning, but a way of flowering."
            ];
        }

        // Create a shallow copy and shuffle
        state.quoteBag = [...pool];
        shuffleArray(state.quoteBag);
        console.log("Refilled Quote Bag with", state.quoteBag.length, "quotes.");
    }

    // 2. Pop one unique quote
    const randomQuote = state.quoteBag.pop();

    // Handle both object structure and simple string
    const quoteText = typeof randomQuote === 'object' ? randomQuote.text : randomQuote;

    let overlay = document.getElementById('quoteOverlay');
    if (!overlay) return;

    const textEl = document.getElementById('quoteText');
    const authorImg = document.getElementById('quoteAuthorImg');
    const signImg = document.getElementById('quoteSignImg');

    if (textEl) textEl.textContent = `“${quoteText}”`;

    // Explicitly set images every time
    if (authorImg) authorImg.src = './icons/sadhguru.png';
    if (signImg) signImg.src = './icons/sadhguru-sign.png';

    // Force display and higher z-index inline to debug
    overlay.style.display = 'flex';
    overlay.style.zIndex = '99999';
    // console.log("Showing Quote:", quoteText);

    // Auto close after 20 seconds
    if (window.quoteTimeout) clearTimeout(window.quoteTimeout);
    window.quoteTimeout = setTimeout(() => {
        hideQuoteOverlay();
    }, 20000);

    // Global click listener to close on ANY click (even outside the overlay)
    // Add small delay to prevent immediate triggering if created by a click
    setTimeout(() => {
        const clickHandler = () => {
            hideQuoteOverlay();
            document.removeEventListener('click', clickHandler);
        };
        document.addEventListener('click', clickHandler);
    }, 100);
}


// --- Settings Mode Logic ---

async function showSettings() {
    state.settingsMode = true;
    document.body.classList.add('settings-active');

    const container = document.getElementById('settingsContent');
    if (!container) return;

    // Load saved values
    const msg = localStorage.getItem('countdownMsg') || "? Days to Retirement";
    const start = localStorage.getItem('countdownStart') || "";
    const end = localStorage.getItem('countdownEnd') || "";

    // Version Logic
    let serverVer = "Unknown";
    try {
        serverVer = await getServerVersion();
    } catch (e) {
        console.warn("Version fetch failed", e);
    }
    const isMismatch = (serverVer !== "Unknown" && serverVer !== ClientVersion);
    const btnColor = isMismatch ? '#007aff' : '#ccc';
    const btnText = isMismatch ? 'Update Available' : 'Up to Date';
    // We allow clicking even if up to date to force refresh

    container.innerHTML = `
        <div class="settings-section">
            <div class="settings-header">Countdown</div>
            
            <div class="settings-group">
                <label class="settings-label">Text:</label>
                <input type="text" id="cdMsg" class="settings-input" value="${msg}">
            </div>

            <div class="settings-date-row">
                <div class="settings-date-group">
                    <label class="settings-label">Start:</label>
                    <input type="date" id="cdStart" class="settings-input" value="${start}">
                </div>
                <div class="settings-date-group">
                    <label class="settings-label">End:</label>
                    <input type="date" id="cdEnd" class="settings-input" value="${end}">
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-header">App Info</div>
            
            <div style="margin: 10px 0; padding: 10px; background: rgba(0,0,0,0.05); border-radius: 10px;">
                <p style="margin: 5px 0; font-size:14px;"><strong>Client:</strong> <span style="color: #007aff;">${ClientVersion}</span></p>
                <p style="margin: 5px 0; font-size:14px; border-top: 1px solid #e0e0e0; padding-top: 5px;"><strong>Server:</strong> <span style="color: ${isMismatch ? '#ff9500' : '#34c759'};">${serverVer}</span></p>
            </div>
            
            <div class="settings-section">
            <div class="settings-header">App Control</div>
            
            <!-- PWA Install Button (Hidden by default) -->
            <button id="pwaInstallBtn" onclick="installPWA()" 
                    style="width: 100%; padding: 12px; background: #007aff; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; display: none; align-items: center; justify-content: center; gap: 8px; margin-bottom: 20px;">
                <i class="ph ph-download-simple" style="font-size: 18px;"></i>
                Install App
            </button>
            
            <!-- Debug Logs -->
            <div style="background: #f0f0f0; padding: 10px; border-radius: 8px; font-family: monospace; font-size: 11px; color: #333; max-height: 100px; overflow-y: auto;">
                <strong>Debug Log:</strong><br>
                ${(window.pwaDebugLog || []).length > 0 ? (window.pwaDebugLog || []).join('<br>') : 'No logs yet...'}
            </div>
            
            <br>

            <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button onclick="performUpdate()" 
                        style="flex: 1; padding: 12px; background: ${btnColor}; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <i class="ph ph-arrows-clockwise" style="font-size: 18px;"></i>
                    ${btnText}
                </button>

                <button onclick="if(confirm('Reset all data?')) { localStorage.clear(); alert('Application has been reset.'); location.reload(); }" 
                        style="flex: 1; padding: 12px; background: #ff3b30; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <i class="ph ph-trash" style="font-size: 18px;"></i>
                    Reset
                </button>
            </div>
        </div>
    `;

    setupCountdownEvents();
}

function setupCountdownEvents() {
    const msgInput = document.getElementById('cdMsg');
    const startInput = document.getElementById('cdStart');
    const endInput = document.getElementById('cdEnd');

    const saveAndRender = () => {
        localStorage.setItem('countdownMsg', msgInput.value);
        localStorage.setItem('countdownStart', startInput.value);
        localStorage.setItem('countdownEnd', endInput.value);
        updateLifeProgress();
    };

    if (msgInput) msgInput.oninput = saveAndRender;
    if (startInput) startInput.onchange = saveAndRender;
    if (endInput) endInput.onchange = saveAndRender;
}

function updateLifeProgress() {
    const msg = localStorage.getItem('countdownMsg') || "? Days to Retirement";
    const startStr = localStorage.getItem('countdownStart');
    const endStr = localStorage.getItem('countdownEnd');

    const progressBar = document.getElementById('lifeProgressBar');
    const progressText = document.getElementById('lifeProgressText');

    if (!progressBar || !progressText) return;

    // Default state
    let percentage = 0;
    let daysLeft = "?";

    if (startStr && endStr) {
        const start = new Date(startStr).getTime();
        const end = new Date(endStr).getTime();
        const now = Date.now();

        if (end > start) {
            const total = end - start;
            const elapsed = now - start;
            percentage = (elapsed / total) * 100;

            // Clamp
            if (percentage < 0) percentage = 0;
            if (percentage > 100) percentage = 100;

            // Days Calculation
            const diffTime = end - now;
            // Round up to nearest day
            daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (daysLeft < 0) daysLeft = 0;
        } else {
            console.warn("Countdown: End date must be after Start date");
            daysLeft = "Error";
        }
    }

    // Update Bar - Width (Horizontal now)
    progressBar.style.width = `${percentage}%`;

    // Update Text (Replace ? with number)
    if (daysLeft === "Error") {
        progressText.textContent = "Check Dates";
        progressText.style.color = "red";
    } else if (msg.includes('?')) {
        progressText.textContent = msg.replace('?', daysLeft);
        progressText.style.color = ""; // reset
    } else {
        progressText.textContent = msg;
        progressText.style.color = ""; // reset
    }
}
