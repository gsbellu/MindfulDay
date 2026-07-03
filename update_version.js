const fs = require('fs');
const path = require('path');

const versionFilePath = path.join(__dirname, 'version.json');
const appJsPath = path.join(__dirname, 'app.js');
const swJsPath = path.join(__dirname, 'sw.js');

// 1. Read current version
let versionData = { build: 0 };
if (fs.existsSync(versionFilePath)) {
    try {
        versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
    } catch (e) {
        console.error("Error reading version.json", e);
    }
}

// 2. Increment Build
versionData.build = (versionData.build || 0) + 1;

// 3. Format Date: DD.MM.YYYY-HH:MM AM/PM
const now = new Date();
const day = String(now.getDate()).padStart(2, '0');
const month = String(now.getMonth() + 1).padStart(2, '0');
const year = now.getFullYear();

let hours = now.getHours();
const minutes = String(now.getMinutes()).padStart(2, '0');
const ampm = hours >= 12 ? 'PM' : 'AM';
hours = hours % 12;
hours = hours ? hours : 12; // the hour '0' should be '12'
const strHours = String(hours).padStart(2, '0');

const newVersionString = `V${versionData.build}-${day}.${month}.${year}-${strHours}:${minutes} ${ampm}`;

versionData.version = newVersionString;

// 4. Save version.json
fs.writeFileSync(versionFilePath, JSON.stringify(versionData, null, 2));
console.log(`Updated version.json to ${newVersionString}`);

// 5. Update app.js
if (fs.existsSync(appJsPath)) {
    let appContent = fs.readFileSync(appJsPath, 'utf8');

    // Regex to replace: const BUILD_DATE = "...";
    // We strictly look for lines like: const ClientVersion = "..."; or const BUILD_DATE = "...";
    // Based on user request, let's standardize on a variable name.
    // The current file has: const BUILD_DATE = "1 Feb 2026, 1:15 AM";

    // We will replace it with: const ClientVersion = "V<Build>-...";
    const regex = /const\s+(?:BUILD_DATE|ClientVersion)\s*=\s*".*?";/;
    const replacement = `const ClientVersion = "${newVersionString}";`;

    if (regex.test(appContent)) {
        appContent = appContent.replace(regex, replacement);
        fs.writeFileSync(appJsPath, appContent, 'utf8');
        console.log(`Updated app.js with version ${newVersionString}`);
    } else {
        console.warn("Could not find version constant in app.js to replace.");
    }
} else {
    console.error("app.js not found!");
}

// 6. Update sw.js CACHE_NAME so every deploy installs a fresh service worker
// and invalidates the old asset cache (index.html, style.css, icons, ...).
if (fs.existsSync(swJsPath)) {
    let swContent = fs.readFileSync(swJsPath, 'utf8');

    const swRegex = /const\s+CACHE_NAME\s*=\s*['"].*?['"];/;
    const swReplacement = `const CACHE_NAME = 'mindfulday-v${versionData.build}';`;

    if (swRegex.test(swContent)) {
        swContent = swContent.replace(swRegex, swReplacement);
        fs.writeFileSync(swJsPath, swContent, 'utf8');
        console.log(`Updated sw.js CACHE_NAME to mindfulday-v${versionData.build}`);
    } else {
        console.warn("Could not find CACHE_NAME constant in sw.js to replace.");
    }
} else {
    console.error("sw.js not found!");
}
