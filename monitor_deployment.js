const https = require('https');
const fs = require('fs');
const path = require('path');

const GITHUB_PAGES_URL = 'https://gsbellu.github.io/MindfulDay/version.json';
const MAX_RETRIES = 30; // 5 minutes (30 * 10s)
const RETRY_INTERVAL = 10000; // 10 seconds

// Read local version
const localVersionPath = path.join(__dirname, 'version.json');
let localVersionData;
try {
    localVersionData = JSON.parse(fs.readFileSync(localVersionPath, 'utf8'));
} catch (e) {
    console.error("Error reading local version.json:", e.message);
    process.exit(1);
}

const targetVersion = localVersionData.version;
console.log(`\nWaiting for version [${targetVersion}] to be live on GitHub Pages...`);

let attempts = 0;

function checkVersion() {
    attempts++;
    process.stdout.write(`Attempt ${attempts}/${MAX_RETRIES}: Checking ${GITHUB_PAGES_URL} ... `);

    https.get(GITHUB_PAGES_URL + '?t=' + Date.now(), (res) => {
        if (res.statusCode !== 200) {
            console.log(`Failed (Status: ${res.statusCode})`);
            scheduleRetry();
            return;
        }

        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            try {
                const remoteData = JSON.parse(data);
                if (remoteData.version === targetVersion) {
                    console.log(`\n\nSUCCESS! Version ${targetVersion} is now live!`);
                    console.log("You can verify at: https://gsbellu.github.io/MindfulDay/");
                    process.exit(0);
                } else {
                    console.log(`Found old version [${remoteData.version || 'unknown'}]`);
                    scheduleRetry();
                }
            } catch (e) {
                console.log("Invalid JSON response.");
                scheduleRetry();
            }
        });

    }).on('error', (e) => {
        console.log(`Error: ${e.message}`);
        scheduleRetry();
    });
}

function scheduleRetry() {
    if (attempts >= MAX_RETRIES) {
        console.error("\n\nTimeout! The new version did not appear within 5 minutes.");
        process.exit(1);
    }
    setTimeout(checkVersion, RETRY_INTERVAL);
}

checkVersion();
