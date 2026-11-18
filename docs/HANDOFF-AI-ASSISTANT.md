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
| One person's target | `oneTarget` branch in `src/retail/assistant-actions.ts` (before the store-target branch) | "set Maya's Flagship 1 target to 12", "set my ...", "set everyone's ...". Uses `setTargetLine` (the Edit all primitive), this month only, `business.targets` snapshot so Undo works; class `targets`. Never edits sold/achieved. It acts only when a person, "my" or "everyone" is named and the sentence has no divide/split/store-target words; otherwise the older store-target question is kept (a test depends on that wording). |
| Voice input | `src/voice-text.ts` (pure), `src/voice.ts`, `src/voice.worker.ts`, `src/VoiceInput.tsx`, mic code in `MainActivity.java`, `RECORD_AUDIO` in the manifest | Speak button in the chat. `MediaRecorder` -> decode to 16 kHz mono -> Whisper tiny.en (`onnx-community/whisper-tiny.en`, revision pinned in the worker, Apache-2.0, q8, about 43 MB, downloaded once into Cache Storage `retaillens-voice-v1`, then offline). Transcript goes into the question box (editable) with a "Heard:" line; option `voiceAutoSend` asks right away. `normalizeTranscript`: noise tags, number words to digits, "Fold 6" to "Fold6", mis-heard capitalised mid-sentence names corrected to the app's people (distance rule, never everyday words or sentence starts). Audio is never stored or sent. English only. Android: page asks for the microphone, `onPermissionRequest` grants audio capture only for the app's own origin after the runtime permission. |
| WhatsApp report tool | `WHATSAPP_REPORT` branch in `src/retail/assistant-actions.ts`, `src/whatsapp-ready.ts`, `WhatsAppReady.java` + `WhatsAppReadyPlan.java`, `RetailDelivery.tsx` | "prepare today's WhatsApp report" (also send/share wording, which still only prepares) builds the daily report (`calculatedDatedReport` + `datedReportText`) and saves it as a `DeliveryPacket` with `kind:'report'`, status `prepared`. Never sent: WhatsApp needs the person's Send tap, then "I sent it". Class `whatsapp` (Autopilot default allow; prepare only). When a routine/Autopilot prepares it, `notifyWhatsAppReady` asks Android (`AndroidScanner.whatsappReady`) for a notification; its tap opens `wa.me/<number>?text=` or the WhatsApp share sheet (group, or text over 6000 chars). Destination and number come from the person's delivery setting or the global options. Undo removes the packet. |
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

## APK artifacts (local, git-ignored: `phase2-results/builds/`)
Built from commit `ae46780` (the commit after it changes only this document). Version **1.27.3 / versionCode 46**. Both are debug-signed with the local certificate SHA-256 `f2a58bb2e0ba7296dba017d3a89070deb7f959b80b0af17bce7d6a4dfa387a27`, the same signer as the previous local APKs (`AI-LENS-6e0ef94.apk`, 1.27.1 / 44), so the regular APK installs over them as an update (data is kept).

| File | Package | Version | Size | SHA-256 |
|---|---|---|---|---|
| `AI-LENS-ae46780.apk` | `com.imeilens.scanner` | 1.27.3 / 46 | 50,605,371 bytes | `e7a34b92f70df1736db73fd4c811425fa54f60624d8d34610b16110a263b7918` |
| `AI-LENS-Test-ae46780.apk` | `com.imeilens.scanner.phonetest` | 1.27.3-phonetest / 46 | 50,605,387 bytes | `01567725556b8e3191110ee3f283dbba092cb8a2e57d62488ac7c5fa80591abb` |

Permissions added across this work: `RECORD_AUDIO` (voice), `FOREGROUND_SERVICE_SPECIAL_USE` and `USE_EXACT_ALARM` / `SCHEDULE_EXACT_ALARM` (routine helper), `WAKE_LOCK`. Android asks for the microphone and notifications when first needed.

Emulator results on the build from `ae46780` (`emulator-5554`, Android 15, isolated test app only): `install -r` over 1.27.2-class code 45 kept the saved data (`check-android-upgrade.mjs` PASS); `check-android-routine-helper.mjs` PASS (foreground service, exact alarm, page wake, switch-off, past time refused); `check-android-voice.mjs` PASS (permission path, model download and load in the WebView, cached for offline); 0 crashes in the log. **The emulator has no microphone (`-no-audio`), so recording on Android was not verified.** The regular package `com.imeilens.scanner` was never installed or touched by these checks.
An in-place update only works on a phone whose installed app was signed with the same certificate. A build from GitHub CI uses a different debug certificate and cannot update a locally signed install (and the reverse). A first-time install of a differently signed build needs the old one removed, which loses data: back up first.
Earlier APKs from `a9f698f` (crashed when a timed routine was saved) and `0ff9cd1` (before WhatsApp reporting and voice) are superseded; do not distribute them.

## Real-phone checklist (not done yet)
1. Install `AI-LENS-ae46780.apk` over the current app. Check the version in Settings reads 1.27.3 and the data is there.
2. Voice: open the assistant, tap Speak, allow the microphone, say "give 4 Fold6 to Maya", Stop. Check the transcript and the editable box. First use needs internet once (43 MB).
3. Timed routine: say or type "give 1 Fold6 to Maya every day at <a time 2 minutes ahead>". Leave the app in the background with the screen off. Check the notification "AI LENS timed routines are on" and that it ran at that minute.
4. WhatsApp: "prepare today's WhatsApp report" in Autopilot. Check the notification, tap it, WhatsApp opens with the text; send it yourself; tap "I sent it".

## Not verified / known limits
- The Android helper is built and unit-tested, but **not yet proven on a real phone**: Doze behaviour with the screen off for a long time, OEM battery savers that kill foreground services, and notification permission denied are untested. Emulator smoke checks are listed in the release notes of the APK step.
- Tasks and routines need the app process alive. If the user swipes the app away, routines cannot run (the app says so). After a phone restart alarms are gone until the app is opened once (no boot receiver).
- Autopilot/assistant cannot reach yet: sold edits (deliberately: sold counts by itself from the phones), people changes, model names/aliases, scan queue, exports/backups. Tool registry refactor (one tool = preview/apply/undo) is the planned way to add them; people changes must stay out of Autopilot.
- Multi-step tasks stop after a step that adds or removes phones (the phone list must refresh); approve again to continue.
- Report-file requests (Excel/PowerPoint) inside a multi-step task are not supported.
- Optional on-device model (Qwen2.5-0.5B) only writes answers; first use downloads it from Hugging Face. A larger model needs a pinned revision hash, about 1 GB download and device-RAM checks.
- No independent code review has been done. Request one before release.

## Gotchas found while building
- Cache Storage keys that are relative resolve differently in the page and in a worker (different base URLs). Use an absolute URL for any marker shared between them (`https://retaillens.invalid/voice-ready`). Found on the emulator: the "model ready" marker was invisible to the page.
- Chrome's fake microphone (`--use-file-for-fake-audio-capture`) loops its audio file, so a recording longer than the sentence hears it twice. The real-voice browser test is `E2E_VOICE=1 node scripts/e2e-assistant.mjs` (needs internet once, uses Windows speech to make the spoken sentence).
- **The first emulator run crashed the app**: `setAlarmClock` throws `SecurityException` on Android 12+ without an exact-alarm permission. Unit and browser tests cannot see this. Always run `check-android-routine-helper.mjs` on the emulator after any native change, and never ship an APK that was not started on the emulator.
- `ctx.records` is a snapshot of the last draw. Multi-step tasks must use `ctx.latestRecords()` (added in `App.tsx` via `recordsRef`, mirrored synchronously in `assignOwners`) or a later step can reuse phones given by the step before.
- A sentence the old parser already understood as one request must not be split ("change flagship 3 target to 12 and divide it to promoters"). `startAssistantTask` tries an explicit sequence first, then the whole sentence, then falls back to the old single-request path.
- The Home "waiting requests" limit is 20 (audit item M8). Clarification requests also count; reject them or the task/routine steps are stopped by the limit. Home > Assistant review now has "Reject all N waiting" (two-step, tested in `e2e-assistant`). Not done: making clarification-only requests "answered" instead of pending (would change what existing tests classify).
- Editing files with shell here-docs: `\b` becomes a backspace character and `\\d` loses a backslash. Use the Edit/Write tools for regexes, and scan with `grep -lP '\x08'`.

- `e2e-automation` line 86 waits a fixed 1.6 s after a reload before reading the Auto give result. It failed once in three runs (0 !== 1) and passed on both reruns, with no change to that code path. If it fails, rerun before investigating; a proper fix is to poll for the result.

## Next steps (suggested order)
1. Run the emulator suite on the isolated test APK and an in-place upgrade check (`scripts/check-android-upgrade.mjs`, isolated app only); then a real-phone check of the helper.
2. Tool registry refactor, then add the missing tools (per-person targets/sold, release plans draft/approve with manual confirm, exports, scan queue).
3. Optional: boot receiver to re-arm alarms after restart; bigger on-device model.
