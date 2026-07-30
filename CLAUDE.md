# MindfulDay — Project Knowledge Base

Personal, single-user mindfulness/task-tracker PWA for Gowri Shanker Bellu (gs.bellu@gmail.com).
Purpose: a mindful pause at every task transition. He is the ONLY user, on iPhone (installed PWA)
and Windows desktop (installed PWA). Vanilla HTML/JS/CSS — **no framework, no build step**.

## Architecture

| Piece | Detail |
|---|---|
| Hosting | Firebase Hosting, project **mindfulday-gsb** → https://mindfulday-gsb.web.app |
| Code repo | https://github.com/gsbellu/MindfulDay (PUBLIC — never commit secrets). gsbellu.github.io is LEGACY, do not maintain. |
| Old Firebase project | `mindfulday-timer` is NOT accessible from his account — never deploy there |
| Database | RTDB `mindfulday-gsb-default-rtdb`, region **asia-southeast1**, state at `/state` |
| Auth | Google sign-in (compat SDK), rules restrict everything to `auth.token.email === 'gs.bellu@gmail.com'` |
| Plan | **Blaze** (since Jul 2026; budget alert ₹100; expected bill ₹0) |
| Functions | `functions/` dir, Node 20, 2nd-gen, region asia-southeast1 |
| CLI | firebase-tools via `npx -y firebase-tools`, logged in as gs.bellu@gmail.com. Login is INTERACTIVE — if "credentials no longer valid", the USER must run `npx firebase-tools login --reauth` in his own terminal. |

## Deploy workflow (every app change)

```
node update_version.js        # stamps version.json + app.js ClientVersion + sw.js CACHE_NAME — all three MUST move together
npx -y firebase-tools deploy --only hosting --project mindfulday-gsb
git add -A && git commit && git push origin main
```
`deploy.bat` automates this for the user. Functions: `deploy --only functions` (add `--force` for cleanup-policy prompt). Rules: `--only database`.
Verify after deploy: `curl -s https://mindfulday-gsb.web.app/version.json`.

## Key files

- `app.js` (~2000 lines) — ALL logic. `index.html` — single page, 5 areas + modals/overlays. `style.css` — dark theme.
- `sw.js` — precache list + CACHE_NAME (auto-stamped). **Audio is deliberately NOT cached/intercepted** (see quirks).
- `settings_activities.json` — source of truth for the 20 activity tiles (id, label, icon, duration-target minutes).
- `sadhguru.json` — 135 quotes (deduped). `functions/index.js` — push functions. `database.rules.json` — RTDB rules.
- `.claude/launch.json` — dev server `mindfulday` on port **8815** (8080 is taken by his other project "CT Master").

## Sync architecture (hard-won — do not regress)

- State is one JSON blob at `/state`; every save stamps `lastUpdate` (ms) + `lastUpdatedBy` (DEVICE_ID).
- **Newest copy wins in BOTH directions.** `refreshStateFromServer(tag)` is a two-way reconcile: local newer → push up; server newer → adopt; server empty → seed. Called at startup, visibilitychange→visible, window focus, `online` event, and a 5-min heartbeat. Never bypass it with a raw `once()` adopt.
- `saveState()` uses a transaction that refuses to clobber a newer server copy; also strips `quotes`/`quoteBag`/`activitySettings` from what's persisted/synced.
- The `on('value')` listener ignores remote states older than local.
- Why: iOS/Windows freeze background PWAs; the SDK's unsent writes die with the process; localStorage is the offline vault. Historic bugs: stale desktop showed 42h-old task; offline overnight taps were erased by unguarded startup adopt.

## iOS PWA quirks (measured on his iPhone — do not re-litigate)

1. **Unpaintable dead zone**: standalone viewport is anchored at screen top but excludes the status-bar height (measured screen=852, viewport=793). iOS never paints below the viewport bottom; that band shows the page background. → This is WHY the app is dark-themed; a light theme resurrects the "black patch". Container: `position:fixed; top:0; height:100%`. Nav: in standalone, home indicator lives in the dead zone → `@media (display-mode: standalone)` drops the safe-area padding.
2. **SW must never intercept audio**: iOS streams via HTTP Range; cached full-body 200s kill playback mid-file (the "stops after 10 min" bug). `sw.js` fetch bails on `destination === 'audio'` or `/audio/` URLs.
3. `touchend` has EMPTY `e.touches` (use `changedTouches`); handle `touchcancel` — else the confirm slider sticks mid-way.
4. Update mechanism: SW CACHE_NAME must change every deploy (update_version.js does it). `location.reload(true)` is a no-op; performUpdate clears all caches then plain reload. Settings shows Client/Server version; orange badge on settings gear when server is newer.
5. A `VP ...` diagnostic line is logged to Settings → Debug Log (viewport geometry) — useful for on-device layout debugging.

## Features & their design decisions

- **Activities**: tiles from settings_activities.json; slide-to-confirm modal; `confirmStart(activity, atTime, opts)` — atTime backdates, `opts.quiet` suppresses the quote. `wakeup` rotates the day (history → yesterday).
- **Overdue awareness is AMBIENT ONLY** (user explicitly rejected popups: "a dialog asking a question the app can't act on"): running tile + green pill turn amber at 2× target, red+pulse at 3× (no-target tasks: 3h/4.5h). Gated on `deepLinkReady.firebase` so stale pre-sync state never flashes red. Popups are reserved for push notifications.
- **Quotes**: device-local shuffle bag (`quoteBagV2` in localStorage, indices) — NEVER put the bag back into synced state (caused repeats). Wake Up quote card also shows today's **Isha calendar** entries.
- **Isha calendar**: public `ishacalendar@gmail.com` via Calendar API v3, key = Firebase web API key (Calendar API allowed + key restricted to the two web.app/firebaseapp.com origins — so localhost/curl need a `Referer: https://mindfulday-gsb.web.app/` header). Cached per-day in localStorage; silent degradation.
- **Sadhana player**: `SADHANA_MODES` config (id/label/icon/audio; audio:null = silent Shoonya). Persistent DOM `<audio id="sadhanaAudioEl">`; intent flag `sadhanaShouldPlay`; 5s watchdog resumes/recovers at position; screen Wake Lock while playing; Media Session; single round play/pause button (user wants minimal UI). Adding a meditation = one config line + icon in sw.js ASSETS.
- **Siri/deep links**: `?switch=<id-or-label>` performs a quiet switch (waits for settings+firebase gates). User's Shortcuts open the URL (browser appears — accepted).
- **DECLINED**: the token-protected unauthenticated command queue (`/commands/<token>/queue`). Client code for it still exists in app.js (COMMAND_TOKEN, attachCommandListener) but the RULE WAS REFUSED by the user — do NOT deploy unauth-write rules without his fresh explicit consent. The auto-mode classifier also blocks it.

## Push notifications (Web Push/VAPID, NOT FCM)

- Public key in app.js (`VAPID_PUBLIC_KEY`); private key in Secret Manager as **VAPID_PRIVATE_KEY** (never in the repo — repo is public).
- Subscriptions: `/pushSubs/<deviceId>` (owner-only rules). sw.js has `push` + `notificationclick` handlers (tap opens the installed app).
- Settings → Notifications: **Enable** (permission+subscribe) and **Send test 🔔** (writes `/pushTest`; function waits 12s so he can lock the phone).
- `functions/index.js`:
  - `sendtestpush` — RTDB trigger on `/pushTest`.
  - `mindfulreminder` — scheduled **every 60 min** (Asia/Kolkata): any task except `sleep` running >1h → push "Mindful reminder — Again, missed to be mindful? Don't worry, All is Well! (<Task> · <dur>)". The hourly *check* is the throttle (was every 10 min — too noisy, user asked to moderate); a 55-min `MIN_GAP` guard in `/pushMeta/mindfulReminder` blocks duplicates across all sessions on scheduler jitter/retries.
- Ideas discussed but NOT built: morning starter, wind-down, evening recap.
- Native iOS app: discussed, DEFERRED. Decision: no App Store, no $99/yr for now; if ever, Capacitor wrap (never a rewrite). Free-Apple-ID sideloading rejected (no push entitlement, 7-day expiry, no Mac).

## User preferences (important)

- **Brevity**: he dislikes long answers — "give me a paragraph". Be concise; use his vocabulary.
- Confirm security-relevant changes explicitly (he declined unauth DB writes once asked plainly).
- He wants hand-holding for Google/Firebase console steps (screenshots go back and forth).
- Phone is usually on SILENT; all other reminders off; MindfulDay's reminder is his one "special" notification.
- Countdown (life-progress bar) settings are per-device localStorage — not synced (known, accepted).

## Dev environment landmines

- Windows + Git Bash: MSYS path conversion mangles `/state` args → `export MSYS_NO_PATHCONV=1` for `firebase database:get`. PowerShell tool is unavailable; use Bash.
- Browser-pane testing: ALWAYS purge SW caches + unregister before testing changes (`caches.delete` + `unregister` + reload), else stale assets mislead. The pane often reports `visibilityState === 'hidden'` (RAF frozen) — fake it via `Object.defineProperty(document,'visibilityState',...)` for popup-path tests; screenshots frequently time out — verify via computed styles/DOM instead.
- `firebase deploy` may print stale "Authentication Error" lines yet still succeed — trust the final "Deploy complete" + version.json curl.
- Hosting ignore in firebase.json excludes dotfiles/dirs (`**/.*`, `**/.*/**`), functions/, *.md, node_modules, bat/dev scripts. `.git` was once deployed publicly — the double pattern fixed it; keep both.
- **Changing a scheduled function's interval**: always verify the Cloud Scheduler job actually took the new cadence — deploy can succeed while the job keeps the old interval. Check with `functions:log` that runs stopped appearing at the old rhythm (the hourly change was confirmed this way: runs every 10 min up to the 09:23 deploy, none at 09:28/09:38 after).
- `functions:log` ordering is unreliable with large `--lines` (returns an older window); `--lines 14` reliably gives the most recent entries. Filter noise with `grep -v AuditLog`.
- `project-info.json` is tool-generated and gitignored — don't commit it.
