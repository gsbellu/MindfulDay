/**
 * MindfulDay - Core Logic
 */

const STATE_KEY = 'mindfulDayState';

const ACTIVITIES = [
    { id: 'wakeup', icon: 'ph-alarm', label: 'Wake Up' },
    { id: 'bath', icon: 'ph-shower', label: 'Bath' },
    { id: 'medicines', icon: 'ph-pill', label: 'Meds' },
    { id: 'sadhana', icon: 'ph-lotus', label: 'Sadhana' },
    { id: 'family', icon: 'ph-users-three', label: 'Family' },
    { id: 'exercise', icon: 'ph-barbell', label: 'Exercise' },
    { id: 'breakfast', icon: 'ph-coffee', label: 'Breakfast' },
    { id: 'dress', icon: 'ph-coat-hanger', label: 'Dress' },
    { id: 'drive', icon: 'ph-car', label: 'Drive' },
    { id: 'work', icon: 'ph-briefcase', label: 'Work' },
    { id: 'shoonya', icon: 'ph-yin-yang', label: 'Shoonya' },
    { id: 'lunch', icon: 'ph-bowl-food', label: 'Lunch' },
    { id: 'chat', icon: 'ph-chat-circle', label: 'Chat' },
    { id: 'coffee', icon: 'ph-coffee-bean', label: 'Coffee' },
    { id: 'entertainment', icon: 'ph-television', label: 'Fun' },
    { id: 'walk', icon: 'ph-footprints', label: 'Walk' },
    { id: 'hobby', icon: 'ph-paint-brush', label: 'Hobby' },
    { id: 'sleep', icon: 'ph-bed', label: 'Sleep' }
];

let state = {
    currentActivityId: null,
    currentActivityStartTime: null,
    dayStartTime: null,
    isDayStarted: false,
    history: [] // { activityId, startTime, endTime, duration }
};

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    renderActivities();
    setupNavigation();
    startTimerLoop();
    registerServiceWorker();
});

function loadState() {
    const saved = localStorage.getItem(STATE_KEY);
    if (saved) {
        state = JSON.parse(saved);
        // Resume logic could go here if needed
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

        // Use Phosphor Icon class
        const i = document.createElement('i');
        i.className = `ph ${act.icon}`;
        i.style.fontSize = '32px'; // Ensure good size

        btn.appendChild(i);

        btn.onclick = () => handleActivityClick(act);
        grid.appendChild(btn);
    });
}

function handleActivityClick(activity) {
    const now = Date.now();

    // 1. Logic for "Wake Up" (Start of Day)
    if (activity.id === 'wakeup') {
        // Reset Day Timer
        state.dayStartTime = now;
        state.isDayStarted = true;
        // Reset History for the day? Or keep continuous log?
        // Requirement: "Day timer resets when wake up is pressed."
    }

    // 2. Log Previous Activity (if any)
    if (state.currentActivityId && state.currentActivityStartTime) {
        const duration = now - state.currentActivityStartTime;
        state.history.push({
            activityId: state.currentActivityId,
            startTime: state.currentActivityStartTime,
            endTime: now,
            duration: duration
        });
    }

    // 3. Switch Context
    state.currentActivityId = activity.id;
    state.currentActivityStartTime = now;

    // 4. Update UI
    updateMetaDisplay(activity);
    renderActivities(); // To update active state styling
    saveState();
}

function updateMetaDisplay(activity) {
    document.getElementById('currentActivityLabel').textContent = activity.label;
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
        document.getElementById('dayTimer').textContent = formatTime(dayDiff); // Shows HH:MM:SS

        // Update Side Panel Timeline
        updateTimeline(dayDiff);
    } else {
        document.getElementById('dayTimer').textContent = "00:00:00";
    }

    requestAnimationFrame(timerTick);
}

function updateTimeline(dayDurationMs) {
    // Assumption: A typical "Active Day" is ~16 hours (Wake 6am -> Sleep 10pm)
    // We map 0 to 16h as 0% to 100%.
    const TYPICAL_DAY_MS = 16 * 60 * 60 * 1000;
    let percentage = (dayDurationMs / TYPICAL_DAY_MS) * 100;

    if (percentage > 100) percentage = 100; // Cap at 100% or let it overflow?
    // Let's cap visual at 100% (Moon)

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

    // Format: HH:MM:SS or MM:SS if < 1 hour? user wanted "Day timer... 24 hours"
    // So always HH:MM:SS for Day Timer.
    // For Activity Timer, maybe MM:SS? 
    // Requirement says "Timer for current activity". I'll use HH:MM:SS for both for consistency.

    const pad = (n) => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function setupNavigation() {
    const btns = document.querySelectorAll('.nav-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Mode Switching Logic (Placeholder)
            const mode = btn.dataset.mode;
            console.log("Switch to mode:", mode);

            if (mode === 'run') {
                document.getElementById('mainPanel').style.display = 'flex';
            } else {
                // Hide run panel for now
                // document.getElementById('mainPanel').style.display = 'none';
            }
        });
    });
}

function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('Service Worker Registered'))
            .catch(err => console.error('Service Worker Failed', err));
    }
}
