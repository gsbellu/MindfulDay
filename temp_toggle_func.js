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
