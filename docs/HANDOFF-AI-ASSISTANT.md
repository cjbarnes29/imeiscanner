# AI assistant upgrade: handover (2026-11-18)

Branch `ai/assistant-upgrade` (from `ux/photo-editor`). Version 1.27.2, Android versionCode 45 (the installed/published build was 1.27.1 / 44, so this installs over it with the same package and certificate).
Read after `docs/CLAUDE-START-HERE.md`. Standing rules still apply: APK-only deliverables, emulator tests on the isolated `com.imeilens.scanner.phonetest` app only, never touch the user's real app, no real customer data.

## What was built (all additive; Assistant mode behaves exactly as before)

| Area | Where | What |
|---|---|---|
| Shift Calendar to annual leave | `src/retail/leave-bridge.ts`, `src/RosterLeavePanel.tsx` | AL days from an imported roster are offered with the calculated effect (40/(30-5)x5=8 -> 32/44/44). Saving records leave only; targets change only through the reviewed calculation. No double counting. |
| Hide suggestions | `showSuggestions()` in `src/retail/auto-workflow.ts` | Master switch plus chip and leave switches; chat command "hide/show suggestions". |
| Multi-step tasks | `src/retail/assistant-tasks.ts` (pure), `src/AssistantTasks.tsx` (runner + Home panel) | "store 4 Fold6, then give 4 Fold6 to Maya" becomes a task: ordered steps, progress, Stop, retries for stale data (max 2), Undo for the whole task. Every step is a normal request with a receipt (`commitAssistantRequest` in `AssistantReview.tsx` is the single apply/undo path). |
| Modes | `assistantMode` in workflow options | Assistant (approve each step), Copilot (approve once), Autopilot (allowed kinds apply by themselves, daily limit). Only Settings changes the mode; the chat cannot (tests prove it). |
| Autopilot permissions | `AUTOPILOT_CLASSES`, `decideStep()` | Default allow: stock, give, report, calendar, **targets**, routine. Never self-applies: steps with warnings, removals, or anything the assistant cannot do at all (confirm sales, release, send messages, delete). |
| Handover summary | `handoverSummary()`; chat "handover summary"; button under Tasks | Last 24 hours + what is waiting, from saved data, no model tokens. |
| Auto give tool | `AUTO_GIVE` branch in `src/retail/assistant-actions.ts` | "auto give" / "divide phones per person": the Give & share rules (`recommendFor`) with per-person limits; previewed, then approved like any give. |
| Timed routines | `src/retail/routine-schedule.ts`, `src/RoutineLearning.tsx` | "give phones by the limits every day at 9:00" (also weekdays, named days, am/pm). Routine = text + `time` + `days` + `runs` history. Runs **at its time only**: later than `routineGraceMinutes` (default 5) it is skipped and logged as missed. Run now never uses up the day's run. Multi-step routines become tasks in every mode. |
| Android helper | `RoutineKeeperService.java`, `RoutineAlarmReceiver.java`, `RoutineKeeperPlan.java`, `src/routine-keeper.ts` | Foreground service (type specialUse, notification with Turn off) keeps the app alive while a timed routine waits. `AlarmManager.setAlarmClock` (exact, works in Doze) wakes the page at the due time (`retaillens-routine-wake` event). CPU held at most 2 minutes around the due time. Needs `USE_EXACT_ALARM` (Android 13+, auto-granted; Google Play restricts it to alarm/calendar apps, fine for sideloaded APKs) or `SCHEDULE_EXACT_ALARM` (Android 12). If Android refuses, it falls back to a best-effort alarm and the notification says so. Swiping the app away stops it and says so. Switch: "Keep the app running in the background" in Settings. |

## How a timed routine runs
1. Chat sentence -> `parseSchedule` -> routine saved (needs approval in Assistant/Copilot; applies in Autopilot because class `routine` is allowed).
2. `RoutineLearningEngine` (mounted with the app) re-checks every 30 s, on every state change and on the wake event. Timed routines run even when routine mode is "suggest" (not when "off").
3. `prepare()` -> `startAssistantTask` (multi-step, or any step in Autopilot) else a normal pending request. The run is appended to `routine.runs` (last 10).
4. `syncRoutineKeeper` tells Android the next due time (only when it changed). The service shows "Next: ...".

## Decisions made by the user (do not reverse without asking)
- Timed routines run only at their time. No catch-up runs hours later.
- Autopilot may split targets (no manual step). Warnings and removals still wait for a person.
- A background helper must keep the app from closing unexpectedly.
- After every finished task write handover docs (this file is the example).

## Tests (all passing at this commit)
- `npm test` (includes 74 release-planning checks: task engine, modes, handover, schedule parser, due rules, keeper sync, load validation).
- Browser: `e2e-assistant` (Copilot approve-once + Undo, Autopilot auto-apply + held step, chat cannot change mode, timed routine saved from one sentence / ran at its time / once a day / history / Run now, "auto give" applied), plus layout, retail, simple, workforce, schedules, automation.
- Android JVM: `RoutineKeeperPlanTest` (alarm validity, 2-minute CPU limit, label cleaning). Run: `:app:testDebugUnitTest -PphoneTest --offline`.
- Emulator: `scripts/check-android-routine-helper.mjs` (isolated test app, `ADB_SERIAL=emulator-5554`, devtools forwarded to 9229) calls the real bridge and checks the foreground service, notification, alarm, the page wake event, switch-off and a refused past time. `scripts/check-android-upgrade.mjs before|after` proves `install -r` keeps data.
- Screenshots: `phase2-results/assistant-actions/40..45*.png` (git-ignored).

## Not verified / known limits
- The Android helper is built and unit-tested, but **not yet proven on a real phone**: Doze behaviour with the screen off for a long time, OEM battery savers that kill foreground services, and notification permission denied are untested. Emulator smoke checks are listed in the release notes of the APK step.
- Tasks and routines need the app process alive. If the user swipes the app away, routines cannot run (the app says so). After a phone restart alarms are gone until the app is opened once (no boot receiver).
- Autopilot cannot reach: per-person target/sold edits, people changes, model names/aliases, scan queue, exports/backups, WhatsApp preparation. Tool registry refactor (one tool = preview/apply/undo) is the planned way to add them; people changes must stay out of Autopilot.
- Multi-step tasks stop after a step that adds or removes phones (the phone list must refresh); approve again to continue.
- Report-file requests (Excel/PowerPoint) inside a multi-step task are not supported.
- Optional on-device model (Qwen2.5-0.5B) only writes answers; first use downloads it from Hugging Face. A larger model needs a pinned revision hash, about 1 GB download and device-RAM checks.
- No independent code review has been done. Request one before release.

## Gotchas found while building
- **The first emulator run crashed the app**: `setAlarmClock` throws `SecurityException` on Android 12+ without an exact-alarm permission. Unit and browser tests cannot see this. Always run `check-android-routine-helper.mjs` on the emulator after any native change, and never ship an APK that was not started on the emulator.
- `ctx.records` is a snapshot of the last draw. Multi-step tasks must use `ctx.latestRecords()` (added in `App.tsx` via `recordsRef`, mirrored synchronously in `assignOwners`) or a later step can reuse phones given by the step before.
- A sentence the old parser already understood as one request must not be split ("change flagship 3 target to 12 and divide it to promoters"). `startAssistantTask` tries an explicit sequence first, then the whole sentence, then falls back to the old single-request path.
- The Home "waiting requests" limit is 20 (audit item M8). Clarification requests also count; reject them or the task/routine steps are stopped by the limit.
- Editing files with shell here-docs: `\b` becomes a backspace character and `\\d` loses a backslash. Use the Edit/Write tools for regexes, and scan with `grep -lP '\x08'`.

## Next steps (suggested order)
1. Run the emulator suite on the isolated test APK and an in-place upgrade check (`scripts/check-android-upgrade.mjs`, isolated app only); then a real-phone check of the helper.
2. Tool registry refactor, then add the missing tools (per-person targets/sold, release plans draft/approve with manual confirm, exports, scan queue).
3. Optional: boot receiver to re-arm alarms after restart; bigger on-device model.
