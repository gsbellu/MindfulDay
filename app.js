/**
 * MindfulDay - Core Logic (v3)
 */

const STATE_KEY = 'mindfulDayState';
// This value is updated automatically by update_version.js
const ClientVersion = "V74-05.08.2026-09:56 PM";

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

// --- Siri / Shortcuts Deep Link (?switch=<activity-id-or-label>) ---
// An iOS Shortcut opens e.g. https://mindfulday-gsb.web.app/?switch=work
// and the app performs the normal activity switch via confirmStart().
// The switch waits until BOTH the activity list and the initial
// Firebase state have loaded, otherwise the incoming snapshot would
// overwrite the freshly switched state.
let pendingSwitchId = null;
const deepLinkReady = { settings: false, firebase: false };

(function captureDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('switch');
    if (target) {
        pendingSwitchId = target.trim().toLowerCase();
        // Clean the URL so a manual reload doesn't switch again
        params.delete('switch');
        const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        history.replaceState(null, '', clean);
    }
})();

function showToast(msg) {
    const old = document.querySelector('.toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

function deepLinkGate(part) {
    deepLinkReady[part] = true;
    if (deepLinkReady.settings && deepLinkReady.firebase) {
        processPendingSwitch();
    }
}

function processPendingSwitch() {
    if (!pendingSwitchId) return;
    const target = pendingSwitchId;
    pendingSwitchId = null;

    const acts = getActivities();
    if (!acts.length) {
        // Activity list momentarily empty (cleared for refetch after the
        // Firebase snapshot) - re-arm and wait for the next gate call.
        pendingSwitchId = target;
        return;
    }

    const act = acts.find(a =>
        a.id.toLowerCase() === target || a.label.toLowerCase() === target);

    if (!act) {
        showToast(`Unknown activity "${target}"`);
        return;
    }
    if (state.currentActivityId === act.id) {
        showToast(`${act.label} is already running`);
        return;
    }
    console.log('Deep link switch to:', act.id);
    // quiet: no quote overlay for Siri/URL-triggered switches
    confirmStart(act, null, { quiet: true });
    showToast(`Switched to ${act.label}`);
}

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupAuth();
    checkUpdateSuccess();
    setupUpdateBadge();

    // Deep-link safety net: if the initial Firebase load hangs
    // (offline), let a pending ?switch= proceed on local state.
    setTimeout(() => deepLinkGate('firebase'), 4000);

    // Never act on a stale in-memory state after waking from background
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshStateFromServer('foreground');
    });

    // Desktop gap: a window covered by other windows (not minimized)
    // counts as "visible" the whole time, so visibilitychange never
    // fires when it is brought back to the front - but focus does.
    window.addEventListener('focus', () => {
        refreshStateFromServer('focus');
    });

    // Heartbeat: an open window that the OS froze and thawed may miss
    // every event above; reconcile every 5 minutes so it can never
    // drift far from reality.
    setInterval(() => {
        if (document.visibilityState === 'visible') refreshStateFromServer('heartbeat');
    }, 5 * 60000);

    // When connectivity returns, reconcile: push local changes made
    // offline, or adopt a newer server copy - whichever is fresher.
    window.addEventListener('online', () => {
        refreshStateFromServer('online');
    });

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

    // Viewport diagnostics for the iOS bottom-gap issue.
    // Shows up in Settings > App Control > Debug Log.
    setTimeout(() => {
        try {
            const nav = document.querySelector('.navigation-area');
            const cont = document.querySelector('.app-container');
            const sab = nav ? getComputedStyle(nav).paddingBottom : '?';
            const sat = cont ? getComputedStyle(cont).paddingTop : '?';
            const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
            logPWA(`VP screen=${screen.height} inner=${window.innerHeight} vv=${window.visualViewport ? Math.round(window.visualViewport.height) : '?'} contBot=${cont ? Math.round(cont.getBoundingClientRect().bottom) : '?'} navBot=${nav ? Math.round(nav.getBoundingClientRect().bottom) : '?'} sat=${sat} sab=${sab} standalone=${standalone}`);
        } catch (e) {
            logPWA('VP diag failed: ' + e.message);
        }
    }, 1000);

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
            renderTimelineView('measureToday');
            renderTimelineView('measureYesterday');

            // Restore Label if we have a valid current activity (Fix for missing label on reload)
            if (state.currentActivityId) {
                const act = state.activitySettings.find(a => a.id === state.currentActivityId);
                if (act) updateMetaDisplay(act);
            }
            deepLinkGate('settings');
        })
        .catch(err => {
            console.warn("Could not load settings_activities.json, using defaults.", err);
            deepLinkGate('settings');
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

// --- Firebase Auth (Google Sign-In) ---
// Database rules only allow the owner's Google account, so Firebase
// sync is attached after sign-in. Signed-out = local-only mode.
let firebaseSyncAttached = false;

function setupAuth() {
    // Guard: during an update the old cached index.html (without the auth
    // SDK) can briefly run this new app.js - don't let that break init.
    if (typeof firebase === 'undefined' || !firebase.auth) {
        console.warn('Auth SDK not loaded yet - running local-only until next reload.');
        return;
    }
    firebase.auth().onAuthStateChanged((user) => {
        const overlay = document.getElementById('signInOverlay');
        if (user) {
            console.log('Signed in as', user.email);
            if (overlay) overlay.style.display = 'none';
            attachFirebaseSync();
        } else {
            console.log('Not signed in - running local-only');
            if (overlay && !sessionStorage.getItem('signInDismissed')) {
                overlay.style.display = 'flex';
            }
            // No Firebase state will arrive; deep links may proceed
            deepLinkGate('firebase');
        }
    });
}

function signInWithGoogle() {
    if (typeof firebase === 'undefined' || !firebase.auth) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).catch((err) => {
        console.warn('Popup sign-in failed, trying redirect:', err);
        firebase.auth().signInWithRedirect(provider);
    });
}

function dismissSignIn() {
    sessionStorage.setItem('signInDismissed', 'true');
    const overlay = document.getElementById('signInOverlay');
    if (overlay) overlay.style.display = 'none';
}

function isSignedIn() {
    return !!(firebase.auth && firebase.auth().currentUser);
}

function loadState() {
    // Try localStorage first for offline fallback
    const saved = localStorage.getItem(STATE_KEY);
    if (saved) {
        state = JSON.parse(saved);
    }
    delete state.quoteBag; // legacy stored bag, now device-local

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
}

// --- Remote Command Queue (silent Siri Shortcuts) ---
// An iOS Shortcut POSTs {"task":"work"} to
//   https://<db>/commands/<token>/queue.json
// via the RTDB REST API (no browser opens). Database rules allow
// unauthenticated writes only under this unguessable token path; any
// signed-in client claims each command with a transaction (so exactly
// one device applies it) and performs the normal switch, backdated to
// when the command was issued.
const COMMAND_TOKEN = '3c30bd9b888c218221e9f772796539f59f66c7aad3c52329';

// Firebase push ids encode their creation time in the first 8 chars.
function decodePushIdTime(key) {
    const ALPHABET = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
    if (!key || key.length < 8) return null;
    let ts = 0;
    for (let i = 0; i < 8; i++) {
        const idx = ALPHABET.indexOf(key.charAt(i));
        if (idx === -1) return null;
        ts = ts * 64 + idx;
    }
    return ts;
}

function attachCommandListener() {
    const queueRef = window.firebaseDB.ref('commands/' + COMMAND_TOKEN + '/queue');
    queueRef.on('child_added', (snap) => {
        let claimed = null;
        snap.ref.transaction((current) => {
            if (current === null) return; // another device claimed it
            claimed = current;
            return null; // delete = claim
        }, (err, committed) => {
            if (err || !committed || !claimed) return;
            applyRemoteCommand(snap.key, claimed, 0);
        });
    });
}

function applyRemoteCommand(key, cmd, attempt) {
    const target = String(cmd.task || '').trim().toLowerCase();
    if (!target) return;

    // Activity list may not be loaded yet on a cold start - retry briefly
    if (!getActivities().length) {
        if (attempt < 30) setTimeout(() => applyRemoteCommand(key, cmd, attempt + 1), 1000);
        return;
    }

    const act = getActivities().find(a =>
        a.id.toLowerCase() === target || a.label.toLowerCase() === target);
    if (!act) {
        console.warn('Remote command: unknown activity', target);
        return;
    }
    if (state.currentActivityId === act.id) return;

    // Apply at the moment the command was issued (push id timestamp),
    // unless that would break the timeline.
    const now = Date.now();
    let at = (typeof cmd.ts === 'number') ? cmd.ts : decodePushIdTime(key);
    if (!at || at <= (state.currentActivityStartTime || 0) || at > now + 60000) at = now;

    console.log('Remote command: switching to', act.id, 'at', new Date(at).toLocaleTimeString());
    confirmStart(act, at, { quiet: true });
    showToast(`Switched to ${act.label} (Siri)`);
}

// Re-pull the server state when the app returns to the foreground so a
// device waking from background never acts on (or shows) a stale copy.
// Two-way reconcile with the server: the NEWEST copy wins in BOTH
// directions. If the local copy is newer (e.g. taps made offline
// overnight - the SDK's unsent writes live only in memory and die with
// the app), keep it and push it up instead of adopting stale server
// data. Used at startup, on foreground return, and when connectivity
// comes back.
function refreshStateFromServer(tag) {
    if (!isSignedIn() || !firebaseSyncAttached) return Promise.resolve();
    return stateRef.once('value').then((snapshot) => {
        const fs = snapshot.val();
        const serverTs = fs ? (fs.lastUpdate || 0) : 0;
        const localTs = state.lastUpdate || 0;

        if (localTs > serverTs) {
            console.log(`[sync:${tag}] Local state is newer than server - pushing local copy up.`);
            saveState();
            return;
        }
        if (!fs || serverTs === 0 || serverTs === localTs) return;

        const keepQuotes = state.quotes;
        state = fs;
        state.quotes = keepQuotes || [];
        delete state.quoteBag; // legacy synced bag, now device-local
        state.activitySettings = null;
        fetchActivitySettings(); // re-renders grid and restores the label
        renderActivities();
        renderTimelineView('measureToday');
        renderTimelineView('measureYesterday');
    }).catch((e) => {
        console.log(`[sync:${tag}] refresh failed:`, e && e.message);
    });
}

// Attach Firebase load + real-time listener. Called once, after sign-in.
function attachFirebaseSync() {
    if (firebaseSyncAttached) return;
    firebaseSyncAttached = true;
    attachCommandListener();

    // Initial load: two-way reconcile (newest copy wins in both
    // directions - a fresh local copy from an offline night must not be
    // clobbered by stale server data).
    refreshStateFromServer('startup').finally(() => {
        deepLinkGate('firebase');
    });

    // Listen for real-time updates from other devices
    stateRef.on('value', (snapshot) => {
        const firebaseState = snapshot.val();
        if (firebaseState && firebaseState.lastUpdatedBy !== DEVICE_ID) {
            // Freshness guard: a device waking from background can flush
            // a stale copy; never let an older state replace a newer one.
            if (firebaseState.lastUpdate && state.lastUpdate && firebaseState.lastUpdate < state.lastUpdate) {
                console.log('Ignoring stale remote state', firebaseState.lastUpdate, '<', state.lastUpdate);
                return;
            }
            const keepQuotes = state.quotes;
            state = firebaseState;
            state.quotes = keepQuotes || [];
            delete state.quoteBag; // legacy synced bag, now device-local
            // Keep remote settings? User said "settings in JSON file".
            // So we should arguably ignore remote settings for activities too.
            // But let's assume JSON file is the source of truth for THIS client.
            state.activitySettings = null;
            fetchActivitySettings();

            renderTimelineView('measureToday');
            renderTimelineView('measureYesterday');
            updateMetaDisplay({ label: '' }); // potentially clear
        }
    });
}

function saveState() {
    state.lastUpdatedBy = DEVICE_ID;
    state.lastUpdate = Date.now();

    // Persist a slim copy: quotes and the activity list are loaded from
    // their JSON files on every start and must not be stored or synced
    // (the synced quote bag was the cause of repeating quotes).
    const outgoing = { ...state };
    delete outgoing.quotes;
    delete outgoing.quoteBag;
    delete outgoing.activitySettings;

    // Save locally for offline support
    localStorage.setItem(STATE_KEY, JSON.stringify(outgoing));

    // Save to Firebase (only when signed in; rules reject anonymous writes)
    if (!isSignedIn()) return;
    // Transaction instead of set: refuse to clobber a newer server state
    // (e.g. this device slept and another one switched tasks meanwhile).
    stateRef.transaction((current) => {
        if (current && current.lastUpdate && outgoing.lastUpdate && current.lastUpdate > outgoing.lastUpdate) {
            return; // abort - server is newer
        }
        return outgoing;
    }).catch((error) => {
        console.log('Firebase save failed:', error);
    });
}

// Main render function - updates all UI elements
function render() {
    renderActivities();
    // Timer updates happen via setInterval, not here
}

function renderTimelineView(containerId, historySource) {
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

    // One card per session (not deduped by activity type) - a repeated
    // activity shows up as multiple cards, oldest data first in the array.
    const entries = [...(historySource || state.history || [])];

    // The still-running activity gets its own card, with no duration yet.
    if (!historySource && state.currentActivityId && state.currentActivityStartTime) {
        entries.push({ activityId: state.currentActivityId, startTime: state.currentActivityStartTime, duration: null });
    }

    const activityMap = {};
    getActivities().forEach(act => { activityMap[act.id] = act; });

    const cards = entries
        .filter(entry => activityMap[entry.activityId])
        .sort((a, b) => b.startTime - a.startTime); // Latest on top

    if (cards.length === 0) {
        monitorContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No recorded activities</div>';
        return;
    }

    monitorContainer.innerHTML = `<div class="timeline-grid">${cards.map(entry => {
        const act = activityMap[entry.activityId];
        const durationStr = entry.duration != null ? formatDuration(entry.duration) : '...';
        return `
            <div class="timeline-card">
                <div class="timeline-card-time">${formatClockTime(entry.startTime)}</div>
                <img src="./icons/${act.icon}" class="timeline-card-icon" alt="${act.label}">
                <div class="timeline-card-duration">${durationStr}</div>
            </div>
        `;
    }).join('')}</div>`;
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

function confirmStart(activity, atTime, opts) {
    // atTime: backdate the switch (remote Siri commands are applied at
    // the moment they were issued). opts.quiet: no quote overlay.
    const now = atTime || Date.now();

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
        renderTimelineView('measureToday');
        renderTimelineView('measureYesterday');
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

        // Show Quote Overlay with today's Isha calendar entries.
        // Bounded wait: if the calendar is slow or unavailable, the
        // quote appears alone after 3s.
        if (!opts || !opts.quiet) {
            Promise.race([
                fetchTodaysIshaEvents(),
                new Promise((resolve) => setTimeout(() => resolve(null), 3000))
            ]).catch(() => null).then((events) => showQuoteOverlay(events));
        }
        return;
    }

    // New Activity Clicked

    // Reset Sadhana state for fresh start whenever we switch activities
    stopSadhanaAudio();

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
    renderTimelineView('measureToday');
    saveState();

    // Show Focus Mode only for Sadhana
    if (activity.id === 'sadhana') {
        showFocusMode(activity);
    } else {
        hideFocusMode();
    }

    // Show Quote Overlay with slight delay
    // Show Quote Overlay with minimal delay (next tick)
    if (!opts || !opts.quiet) {
        setTimeout(() => {
            showQuoteOverlay();
        }, 0);
    }
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

// --- Sadhana Audio Player ---
// Rebuilt for stability: a persistent DOM <audio> element (index.html),
// an explicit "should play" intent flag, stall/error recovery with a
// watchdog, Media Session integration, and a screen wake lock so iOS
// auto-lock cannot kill playback mid-meditation.

let sadhanaShouldPlay = false;
let sadhanaWatchdog = null;
let sadhanaWakeLock = null;
let sadhanaAudioWired = false;

function getSadhanaAudio() {
    return document.getElementById('sadhanaAudioEl');
}

async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    if (sadhanaWakeLock) return;
    try {
        sadhanaWakeLock = await navigator.wakeLock.request('screen');
        sadhanaWakeLock.addEventListener('release', () => { sadhanaWakeLock = null; });
    } catch (e) {
        console.warn('Wake lock unavailable:', e.message);
    }
}

function releaseWakeLock() {
    if (sadhanaWakeLock) {
        sadhanaWakeLock.release().catch(() => { });
        sadhanaWakeLock = null;
    }
}

function sadhanaPlay() {
    const el = getSadhanaAudio();
    if (!el || !el.src) return;
    sadhanaShouldPlay = true;
    el.play().then(() => {
        acquireWakeLock();
        updateSadhanaUI();
    }).catch((e) => {
        console.warn('Audio play failed:', e.message);
        updateSadhanaUI();
    });
}

function sadhanaPause() {
    const el = getSadhanaAudio();
    sadhanaShouldPlay = false;
    if (el) el.pause();
    releaseWakeLock();
    updateSadhanaUI();
}

// Reload the file and continue from where playback stopped
function recoverSadhanaAudio() {
    const el = getSadhanaAudio();
    if (!el || !el.src) return;
    const pos = el.currentTime || 0;
    console.warn('Recovering sadhana audio at position', Math.round(pos), 's');
    const onMeta = () => {
        el.removeEventListener('loadedmetadata', onMeta);
        try { el.currentTime = Math.min(pos, el.duration || pos); } catch (e) { }
        if (sadhanaShouldPlay) el.play().catch(() => { });
    };
    el.addEventListener('loadedmetadata', onMeta);
    el.load();
}

// Watchdog: whatever interrupts playback (stall, decode error, screen
// lock, backgrounding), if audio is supposed to be playing, bring it back.
function startSadhanaWatchdog() {
    if (sadhanaWatchdog) return;
    sadhanaWatchdog = setInterval(() => {
        const el = getSadhanaAudio();
        if (!el || !sadhanaShouldPlay || el.ended || !el.src) return;
        if (el.error) {
            recoverSadhanaAudio();
        } else if (el.paused) {
            el.play().catch(() => { });
        }
    }, 5000);
}

// One-time wiring of the persistent element and system integrations
function wireSadhanaAudio() {
    if (sadhanaAudioWired) return;
    const el = getSadhanaAudio();
    if (!el) return;
    sadhanaAudioWired = true;

    el.addEventListener('ended', () => {
        sadhanaShouldPlay = false;
        releaseWakeLock();
        updateSadhanaUI();
    });
    el.addEventListener('error', () => {
        if (sadhanaShouldPlay) recoverSadhanaAudio();
    });
    el.addEventListener('stalled', () => {
        if (sadhanaShouldPlay && el.paused) el.play().catch(() => { });
    });
    el.addEventListener('play', updateSadhanaUI);
    el.addEventListener('pause', updateSadhanaUI);

    // Coming back to the foreground: re-acquire the wake lock (iOS
    // releases it on background) and resume if playback was interrupted
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || !sadhanaShouldPlay) return;
        acquireWakeLock();
        if (el.paused && !el.ended) el.play().catch(() => { });
    });

    // Lock screen / Control Center transport controls
    if ('mediaSession' in navigator) {
        try {
            navigator.mediaSession.setActionHandler('play', sadhanaPlay);
            navigator.mediaSession.setActionHandler('pause', sadhanaPause);
        } catch (e) { }
    }
}

function stopSadhanaAudio() {
    sadhanaShouldPlay = false;
    const el = getSadhanaAudio();
    if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
    }
    if (sadhanaWatchdog) {
        clearInterval(sadhanaWatchdog);
        sadhanaWatchdog = null;
    }
    releaseWakeLock();
    state.sadhanaMode = null;
    state.sadhanaTimerStart = null;
}

// Sadhana practice modes. audio: null = silent practice (timer only).
// Adding a meditation = one line here + the icon in sw.js ASSETS.
const SADHANA_MODES = [
    { id: 'shakthi', label: 'Shakthi', icon: 'shakthi.png', audio: 'Shakthi.mp3' },
    { id: 'shambhavi', label: 'Shambhavi', icon: 'shambhavi.png', audio: 'Shambhavi.mp3' },
    { id: '61points', label: '61 Points', icon: '61points.png', audio: '61PointsRelaxation.mp3' },
    { id: 'gurupooja', label: 'Guru Pooja', icon: 'gurupooja.png', audio: 'GuruPooja.mp3' },
    { id: 'shoonya', label: 'Shoonya', icon: 'shoonya.png', audio: null }
];

function getSadhanaMode(id) {
    return SADHANA_MODES.find(m => m.id === id) || null;
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
    const modeButtons = SADHANA_MODES.map(m => `
            <button class="sadhana-btn" data-mode="${m.id}" onclick="startSadhanaMode('${m.id}')">
                <img src="./icons/${m.icon}" alt="${m.label}">
            </button>`).join('');

    controls.innerHTML = `
        <div class="sadhana-buttons">${modeButtons}
        </div>

        <div class="media-controls" id="mediaControls">
            <button class="media-btn play-pause-btn" onclick="toggleSadhanaPlay()">▶</button>
        </div>
    `;

    updateSadhanaUI();
}

window.startSadhanaMode = function (mode) {
    const entry = getSadhanaMode(mode);
    if (!entry) return;

    state.sadhanaMode = mode;
    state.sadhanaTimerStart = Date.now(); // Start separate timer

    wireSadhanaAudio();
    const el = getSadhanaAudio();

    if (!entry.audio) {
        // Silent practice: timer only, no audio
        sadhanaShouldPlay = false;
        if (el) {
            el.pause();
            el.removeAttribute('src');
            el.load();
        }
        releaseWakeLock();
    } else {
        if (el) {
            el.src = `./audio/${entry.audio}`; // (re)selecting restarts from 0
            sadhanaPlay();
            startSadhanaWatchdog();
        }

        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: entry.label,
                    artist: 'MindfulDay',
                    album: 'Sadhana'
                });
            } catch (e) { }
        }
    }

    updateSadhanaUI();
    updateFocusTimers(); // Immediate update
};

window.toggleSadhanaPlay = function () {
    const el = getSadhanaAudio();
    if (!el || !el.src) return;
    if (el.paused) {
        sadhanaPlay();
    } else {
        sadhanaPause();
    }
};

function updateSadhanaUI() {
    const entry = getSadhanaMode(state.sadhanaMode);
    const modeLabel = entry ? entry.label.toUpperCase() : 'SADHANA';

    // Update Label to show Sub-Mode
    const labelEl = document.getElementById('focusLabel');
    if (labelEl) labelEl.textContent = modeLabel;

    // Update Green Pill Label too
    const activityLabel = document.getElementById('currentActivityLabel');
    if (activityLabel) activityLabel.textContent = modeLabel;

    // Highlight Active Button
    const btns = document.querySelectorAll('.sadhana-btn');
    btns.forEach(btn => {
        if (btn.dataset.mode === state.sadhanaMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Show/Hide Media Controls (hidden for silent modes)
    const mediaControls = document.getElementById('mediaControls');
    if (mediaControls) {
        if (!entry || !entry.audio) {
            mediaControls.style.display = 'none';
        } else {
            mediaControls.style.display = 'flex';
        }
    }

    // Update Play/Pause Icon (intent + element state)
    const playBtn = document.querySelector('.play-pause-btn');
    const audioEl = getSadhanaAudio();
    if (playBtn && audioEl) {
        playBtn.textContent = (sadhanaShouldPlay && !audioEl.paused) ? '⏸' : '▶';
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

// --- Overdue Awareness ---
// Ambient only, no dialogs: the green timer pill AND the running
// task's tile turn amber, then red (pulsing), when the task exceeds
// its expected duration. Thresholds derive from the activity's target
// duration in settings_activities.json: warn at 2x target, alert at
// 3x target (tasks without a target: warn 3h, alert 4.5h).
// Popups are reserved for real push notifications (future round).
const OVERDUE_DEFAULT_MIN = 180;

function getOverdueStatus(now) {
    if (!state.currentActivityId || !state.currentActivityStartTime) return null;
    const act = getActivities().find(a => a.id === state.currentActivityId);
    if (!act) return null;

    const elapsed = now - state.currentActivityStartTime;
    const targetMin = act.duration || 0;
    const warnMs = (targetMin > 0 ? targetMin * 2 : OVERDUE_DEFAULT_MIN) * 60000;
    const alertMs = warnMs * 1.5;

    if (elapsed >= alertMs) return { level: 'alert', act, elapsed };
    if (elapsed >= warnMs) return { level: 'warn', act, elapsed };
    return null;
}

function checkOverdue(now) {
    // Hold off until the startup reconcile has settled: right after
    // launch the local state can be days old and would flash bogus
    // red moments before the server copy heals it.
    if (!deepLinkReady.firebase) return;

    const status = getOverdueStatus(now);
    const warn = !!status && status.level === 'warn';
    const alert = !!status && status.level === 'alert';

    const pill = document.querySelector('.green-pill');
    if (pill) {
        pill.classList.toggle('overdue-warn', warn);
        pill.classList.toggle('overdue-alert', alert);
    }

    // The running task's tile carries the same signal - the red-filled
    // icon is the visual cue to switch when opening the app.
    const activeTile = document.querySelector('.activity-btn.active');
    if (activeTile) {
        activeTile.classList.toggle('overdue-warn', warn);
        activeTile.classList.toggle('overdue-alert', alert);
    }
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

    checkOverdue(now);

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
                renderTimelineView('measureToday');
                renderTimelineView('measureYesterday');
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
                renderTimelineView('measureYesterday');
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

    // Wipe SW caches so nothing stale survives the reload
    if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
    }

    // Fetch the new service worker; if it changed, it installs,
    // skipWaiting + controllerchange will reload the page with fresh assets
    if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (let registration of registrations) {
            await registration.update();
        }
    }

    // reload(true) is deprecated and ignored; caches are gone so a
    // plain reload fetches everything from the network
    window.location.reload();
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
    await performUpdate();
};

// --- Update Badge ---
// Compares the deployed version.json against ClientVersion on load and
// whenever the app comes back to the foreground; shows a dot on the
// settings nav button when a newer build is on the server.
async function refreshUpdateBadge() {
    const settingsBtn = document.querySelector('.nav-btn[data-mode="settings"]');
    if (!settingsBtn) return;

    const serverVer = await getServerVersion();
    const isMismatch = (serverVer !== "Unknown" && serverVer !== ClientVersion);

    let badge = settingsBtn.querySelector('.update-badge');
    if (isMismatch) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'update-badge';
            settingsBtn.appendChild(badge);
        }
    } else if (badge) {
        badge.remove();
    }
}

function setupUpdateBadge() {
    refreshUpdateBadge();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshUpdateBadge();
    });
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

        // iOS fires touchcancel (not touchend) when a system gesture or
        // notification interrupts the drag - snap back, never rest mid-way
        window.addEventListener('touchcancel', () => {
            if (!isDraggingSlider) return;
            isDraggingSlider = false;
            snapSliderBack();
        });
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

function snapSliderBack() {
    const handle = document.getElementById('sliderHandle');
    if (handle) {
        handle.style.transition = 'transform 0.3s ease';
        handle.style.transform = 'translateX(0px)';
    }
    const text = document.querySelector('.slider-text');
    if (text) text.style.opacity = '1';
}

function endDrag(e) {
    if (!isDraggingSlider) return;
    isDraggingSlider = false;

    const handle = document.getElementById('sliderHandle');
    const currentTransform = handle.style.transform;
    const px = parseFloat(currentTransform.replace('translateX(', '').replace('px)', '')) || 0;

    // Check for "Click" (negligible movement). NOTE: touchend events have
    // an EMPTY e.touches list - the lifted finger is only in
    // e.changedTouches. Reading e.touches[0] here used to throw and leave
    // the handle stuck mid-way.
    let endX = sliderStartX;
    if (e.type.includes('mouse')) {
        endX = e.pageX;
    } else if (e.changedTouches && e.changedTouches.length) {
        endX = e.changedTouches[0].pageX;
    }
    const movedDist = Math.abs(endX - sliderStartX);
    const isClick = movedDist < 5; // moved less than 5 pixels

    // If dragged more than 50%: complete; otherwise snap back.
    // The handle must never rest in between.
    const threshold = maxDrag * 0.5;

    if (px > threshold || isClick) {
        triggerConfirmAnimation();
    } else {
        snapSliderBack();
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

// --- Push Notifications (Web Push / VAPID) ---
// Subscriptions are stored per device in RTDB /pushSubs (owner-only);
// Cloud Functions send the actual pushes.
const VAPID_PUBLIC_KEY = 'BIwhlC6aQXGcLz26tVB6SoKQnPA_D0h2eO93jfSuwmXOCgZMcApXNdQnxdTwcIonHqeLMoqQJ0784h3yykUOLfI';

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
}

function updatePushStatus(msg) {
    const el = document.getElementById('pushStatus');
    if (el) el.textContent = msg;
}

window.enablePush = async function () {
    try {
        if (!isSignedIn()) {
            alert('Sign in first - notifications are tied to your account.');
            return false;
        }
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            alert('Push is not supported in this browser. On iPhone the app must be installed to the Home Screen (iOS 16.4+).');
            return false;
        }
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            updatePushStatus('Permission was not granted.');
            return false;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
        await window.firebaseDB.ref('pushSubs/' + DEVICE_ID).set(JSON.parse(JSON.stringify(sub)));
        updatePushStatus('Notifications enabled on this device ✓');
        return true;
    } catch (e) {
        updatePushStatus('Enable failed: ' + e.message);
        return false;
    }
};

// Global toggle (Settings button): flips /pushSettings/enabled, which
// the Cloud Functions check before sending anything. Turning on also
// runs the normal subscribe flow for this device; turning off best-
// effort unsubscribes this device too, though the server flag alone
// already blocks every push regardless of subscriptions.
window.toggleNotifications = async function () {
    if (!isSignedIn()) {
        alert('Sign in first - notifications are tied to your account.');
        return;
    }
    try {
        const snap = await window.firebaseDB.ref('pushSettings/enabled').get();
        const currentlyEnabled = snap.val() !== false;

        if (currentlyEnabled) {
            await window.firebaseDB.ref('pushSettings/enabled').set(false);
            try {
                const reg = await navigator.serviceWorker.ready;
                const sub = await reg.pushManager.getSubscription();
                if (sub) await sub.unsubscribe();
                await window.firebaseDB.ref('pushSubs/' + DEVICE_ID).remove();
            } catch (e) { /* best effort */ }
            updatePushStatus('Notifications disabled — the server will not send any pushes.');
        } else {
            const ok = await enablePush();
            if (ok) await window.firebaseDB.ref('pushSettings/enabled').set(true);
        }
    } catch (e) {
        updatePushStatus('Toggle failed: ' + e.message);
    }
    if (state.settingsMode) showSettings();
};

window.sendTestPush = async function () {
    if (!isSignedIn()) {
        alert('Sign in first.');
        return;
    }
    try {
        await window.firebaseDB.ref('pushTest').set({ requestedAt: Date.now(), by: DEVICE_ID });
        updatePushStatus('Test requested - LOCK YOUR PHONE NOW. The notification arrives in ~15 seconds.');
    } catch (e) {
        updatePushStatus('Test failed: ' + e.message);
    }
};

// --- Isha Calendar (shown with the Wake Up quote) ---
// Public calendar, read via the Calendar API with the project API key
// (the key must have the Calendar API allowed in Google Cloud console).
// Cached per day; failures degrade silently to the plain quote.
const ISHA_CALENDAR_ID = 'ishacalendar@gmail.com';
const CALENDAR_API_KEY = 'AIzaSyBlLidQHcn4PQtW1v-tYlFLkT12NSTtdzY';

function fetchTodaysIshaEvents() {
    const today = new Date();
    const dayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const cacheKey = 'ishaEvents:' + dayKey;

    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return Promise.resolve(JSON.parse(cached));
    } catch (e) { }

    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const url = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(ISHA_CALENDAR_ID) + '/events'
        + '?key=' + CALENDAR_API_KEY
        + '&timeMin=' + encodeURIComponent(dayStart.toISOString())
        + '&timeMax=' + encodeURIComponent(dayEnd.toISOString())
        + '&singleEvents=true&orderBy=startTime&maxResults=10';

    return fetch(url)
        .then(r => {
            if (!r.ok) throw new Error('calendar http ' + r.status);
            return r.json();
        })
        .then(data => {
            const events = (data.items || []).map(ev => ev.summary).filter(Boolean);
            try { localStorage.setItem(cacheKey, JSON.stringify(events)); } catch (e) { }
            return events;
        });
}

// Device-local shuffle bag of quote indices. Lives in localStorage and
// is persisted immediately after each draw. The old bag inside the
// synced state was clobbered by every device sync and rewound by every
// reload (saves happened before the draw), which caused the repeats.
const QUOTE_BAG_KEY = 'quoteBagV2';

function nextQuote() {
    const pool = (state.quotes && state.quotes.length) ? state.quotes : [
        "How deeply you touch another life is how rich your life is.",
        "You cannot exist without the universe. You are not a separate existence.",
        "Learning is not about earning, but a way of flowering."
    ];

    let bag = [];
    try { bag = JSON.parse(localStorage.getItem(QUOTE_BAG_KEY)) || []; } catch (e) { }

    // Refill when empty or when the quote list changed size
    if (!bag.length || bag.some(i => i >= pool.length)) {
        bag = pool.map((_, i) => i);
        shuffleArray(bag);
        console.log("Refilled quote bag with", bag.length, "quotes.");
    }

    const idx = bag.pop();
    localStorage.setItem(QUOTE_BAG_KEY, JSON.stringify(bag));
    return pool[idx];
}

function showQuoteOverlay(calendarEvents) {
    const randomQuote = nextQuote();

    // Handle both object structure and simple string
    const quoteText = typeof randomQuote === 'object' ? randomQuote.text : randomQuote;

    let overlay = document.getElementById('quoteOverlay');
    if (!overlay) return;

    // Isha calendar section (Wake Up mornings); built with DOM nodes,
    // never markup, since event titles come from an external calendar.
    const calEl = document.getElementById('quoteCalendar');
    if (calEl) {
        calEl.innerHTML = '';
        if (calendarEvents && calendarEvents.length) {
            const dateDiv = document.createElement('div');
            dateDiv.className = 'quote-cal-date';
            dateDiv.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
            calEl.appendChild(dateDiv);
            calendarEvents.forEach((title) => {
                const ev = document.createElement('div');
                ev.className = 'quote-cal-event';
                ev.textContent = title;
                calEl.appendChild(ev);
            });
            calEl.style.display = 'block';
        } else {
            calEl.style.display = 'none';
        }
    }

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
    const btnColor = isMismatch ? '#0a84ff' : '#3a3a3c';
    const btnText = isMismatch ? 'Update Available' : 'Up to Date';
    // We allow clicking even if up to date to force refresh

    let notificationsEnabled = true;
    try {
        const notifSnap = await window.firebaseDB.ref('pushSettings/enabled').get();
        notificationsEnabled = notifSnap.val() !== false;
    } catch (e) {
        console.warn("Notification setting fetch failed", e);
    }
    const permGranted = (typeof Notification !== 'undefined' && Notification.permission === 'granted');
    const notifStatusMsg = !notificationsEnabled
        ? 'Disabled — the server will not send any pushes.'
        : (permGranted ? 'Enabled — permission granted on this device.' : 'Enabled, but not yet permitted on this device.');

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
            <div class="settings-header">Notifications</div>
            <p id="pushStatus" style="font-size: 13px; color: #8e8e93; margin: 0 0 10px;">${notifStatusMsg}</p>
            <div style="display: flex; gap: 10px;">
                <button id="notifToggleBtn" onclick="toggleNotifications()"
                        style="flex: 1; padding: 12px; background: ${notificationsEnabled ? '#34c759' : '#3a3a3c'}; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer;">
                    Notifications: ${notificationsEnabled ? 'On' : 'Off'}
                </button>
                <button onclick="sendTestPush()"
                        style="flex: 1; padding: 12px; background: #3a3a3c; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer;">
                    Send test 🔔
                </button>
            </div>
        </div>

        <div class="settings-section">
            <div class="settings-header">App Info</div>
            
            <div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.08); border-radius: 10px;">
                <p style="margin: 5px 0; font-size:14px;"><strong>Client:</strong> <span style="color: #0a84ff;">${ClientVersion}</span></p>
                <p style="margin: 5px 0; font-size:14px; border-top: 1px solid #3a3a3c; padding-top: 5px;"><strong>Server:</strong> <span style="color: ${isMismatch ? '#ff9500' : '#34c759'};">${serverVer}</span></p>
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
            <div style="background: #1c1c1e; padding: 10px; border-radius: 8px; font-family: monospace; font-size: 11px; color: #8e8e93; max-height: 100px; overflow-y: auto;">
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
