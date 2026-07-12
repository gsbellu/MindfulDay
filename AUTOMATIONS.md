# MindfulDay — iOS Automations (hands-free task switching)

Goal: task switches get logged even when you don't think to open the app.
iOS Shortcuts **Automations** fire on phone events (alarm stopped, car
connected, arriving at a place) and open a MindfulDay deep link that
performs the switch.

## The deep link

Opening this URL switches the task (no quote popup, shows a toast):

    https://mindfulday-gsb.web.app/?switch=<task>

`<task>` is an activity id or label from `settings_activities.json`:
`wakeup`, `bath`, `meds`, `sadhana`, `family-time`, `exercise`, `groom`,
`dressup`, `eat`, `drive`, `work`, `chat`, `coffee`, `learn`, `hobby`,
`fun`, `relax`, `walk`, `sleep`, `switch`.

`wakeup` is special: it rotates the day (yesterday's history is archived,
timers reset) — the morning anchor.

## Recommended automations (Shortcuts app → Automation → +)

| Trigger (choose in Shortcuts)         | Action: Open URL with ?switch= | Notes |
|----------------------------------------|-------------------------------|-------|
| When my alarm is stopped               | `wakeup`                      | The flagship: day starts when you silence the alarm. Set "Run Immediately". |
| When connected to car Bluetooth/CarPlay| `drive`                       | Fires as the car connects. |
| When I arrive at \<office address\>    | `work`                        | Location trigger. |
| When I leave \<office address\>        | `drive`                       | Or `family-time` if preferred. |
| Time of day (e.g. 22:45)               | `sleep`                       | Only if bedtime is consistent; sensor triggers are more truthful than clock triggers. |

Setup per automation:
1. Shortcuts app → **Automation** tab → **+** → pick the trigger.
2. Add action **Open URLs** (Safari) with the deep link above.
3. Choose **Run Immediately** (don't ask) where iOS allows it.

## Notes

- The URL opens Safari briefly; the switch applies instantly and syncs to
  all devices via Firebase.
- Manual Siri phrases work the same way: create a plain Shortcut with the
  Open URLs action and name it (e.g. "Mindful Work") — the name is the
  Siri phrase.
- A fully silent variant (no browser, via a token-protected command queue
  in the database) exists in the client code (`COMMAND_TOKEN` in app.js)
  but is deliberately NOT enabled: the required database rule would allow
  login-free writes, which the owner declined (2026-07-12). If ever
  wanted, deploy the `commands/$token/queue` rule and switch automations
  to "Get Contents of URL" POSTs.
