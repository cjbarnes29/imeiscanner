# Emulator tests for RetailLens (Maestro + hybrid scenarios)

Automated checks that drive the real app on an Android emulator, look at the screen, read the app's saved data, check the log for crashes and write a report. Everything runs **only against `RetailLens Test`** (`com.imeilens.scanner.phonetest`, the isolated test build; its label comes from `android/app/build.gradle`). The scripts refuse any other app id and never clear or touch the real RetailLens app. All photos and IMEIs here are **synthetic**.

## What is installed (local, free, session-only environment)
| Tool | Version / place | Notes |
|---|---|---|
| Maestro CLI | 2.12.1, `%USERPROFILE%\tools\maestro-2.12.1` | pinned; release SHA-256 `54dbb0716425626604973cbb374c585ca30272375d9ce15177a1152765ddd9d7`, as recorded by the author (not re-checked when this README was reviewed) |
| Java | existing Temurin 25 (Maestro needs 17+) | works; no second JDK installed |
| Android SDK / adb / emulator | existing | `ANDROID_HOME`, `JAVA_HOME` and PATH are set for the current PowerShell session only by `e2e/scripts/env.ps1` (nothing written to the system environment) |
| Claude Code MCP | `maestro` server (`maestro mcp`), local scope | lets Claude list devices, inspect the screen, run flows and take screenshots after a Claude Code restart |

## How to run
```powershell
# 1. emulator running, test APK built with `gradle :app:assembleDebug -PphoneTest` (from android/) and installed with
#    adb install <path to the built phonetest APK>   (never the real app; the file name depends on your build, e.g. IMEI-Lens-Test-1.26.0-phonetest.apk is only an example)
# 2. run everything (known-failing tests are skipped):
powershell -ExecutionPolicy Bypass -File e2e\scripts\run-e2e.ps1
# one or more tests, and the known-failing ones too:
powershell -ExecutionPolicy Bypass -File e2e\scripts\run-e2e.ps1 -Flows 00-smoke,03-crop-archive-undo -IncludeKnownFailing
```
The report is written to `e2e\reports\<time>\REPORT.md` with per-test logs, Maestro screenshots, JUnit XML and logcat (git-ignored).

## Real phone (safe mode) and the phone checklist
* `run-e2e.ps1 -RealPhone -Device <serial>`: never clears another app's data, skips tests that touch Download, blocks every test that uses the system picker, puts nothing in shared storage, and compares the owner's files (Download, Documents, Pictures, DCIM; names, sizes, dates) before and after. Android's own thumbnail cache is compared separately as information.
* `16-share-photos`: gives the app 5 synthetic photos through share intents (the app's own cache and FileProvider). Needs `E2E_ALLOW_SYNTHETIC_SHARE=1` on a real phone; the plan (`phase2-results/phase3-prep/PHONE-SHARE-TEST-PLAN.md`) is local-only: that folder is git-ignored and not in the repository.
* `run-e2e.ps1` skips the `18-camera-native` flow on a real phone (it only works with the emulator's camera app) and reports it as skipped; the camera cases stay on the manual phone checklist.
* `phone-tools/`: the digital phone checklist and automatic, masked result collection. See `phone-tools/README.md`.

## What is where
* `flows\*.yaml`: Maestro flows (`00-smoke`, `01-scan-gallery`) for native and system UI and for web screens that Maestro can read (file picker, save dialog, share dialog, records, background). `flows\_common\*.yaml` are reusable sub-flows (`clean-start`, `pick-photos`, `scan-all`, `scan-real`, `wait-scan`, `resume-and-wait`, `start-scan-then-home`).
* `scenarios\NN-*.mjs` (02 to 23): hybrid scenarios for screens Maestro cannot read (Crop Studio sits in stacked modal dialogs): they drive the WebView through DevTools and use real `adb input` swipes, and still call Maestro for the picker. Run one as `node e2e/scenarios/NN-name.mjs [device] [app]` (defaults `emulator-5554`, `com.imeilens.scanner.phonetest`). `scenarios\helpers.mjs` holds the shared helpers (see Interface).
* `scripts\`: `run-e2e.ps1` (suite runner), `run-batch.ps1` (repeat runs with done/failed markers), `wait-for.mjs`, `env.ps1`, `lib.mjs` (adb, guards, truth data, masking), `cdp-state.mjs` (DevTools reader), and `verify-*.mjs` that check the data the app saved (native store, IndexedDB, exported files), not just what is on screen.
* `fixtures\make-fixtures.mjs`: draws the synthetic label photos (`E2E-*.jpg`, `EDGE-*.jpg`) and `truth.json` (checksum-valid made-up IMEIs). `fixtures\make-retry-fixtures.mjs`: `RETRY-*.jpg` and `retry-truth.json` for the auto-retry test. Output goes to `fixtures\out` (git-ignored); generate it with `node e2e/fixtures/make-fixtures.mjs`.
* `phone-tools\`: digital phone checklist, see [phone-tools/README.md](./phone-tools/README.md).
* [COVERAGE.md](./COVERAGE.md): what is automated and what stays manual.
* `flows\known-failing.txt`: tests that expose confirmed defects (currently empty). They are skipped by default and reported as XFAIL; when one starts passing it is reported as XPASS.

## Interface
* Runner: `scripts\run-e2e.ps1 [-Flows a,b] [-Device <serial>] [-IncludeKnownFailing] [-RealPhone]`; `scripts\run-batch.ps1 -Name <n> [-Runs N] [-Flows ...] [-RunTimeoutMin 40]`; `node e2e/scripts/wait-for.mjs <done-file> [--timeout-min] [--pid] [--failed] [--poll-sec]`.
* `scripts/lib.mjs`: `adb`, `isEmulator`, `guardApp`, `mask`, `truth`, `extras`, `retryTruth`, `SYNTHETIC_NAME`, `shareUri`, `requireShareAllowed`, `stageSyntheticPhotos`, `sharePhoto`, `unstageSyntheticPhotos`, `nativeStore`, `check`, `finish`.
* `scripts/cdp-state.mjs`: `evaluate`, `webState` (DevTools socket, default port 9333).
* `scenarios/helpers.mjs`: `ctx`, `maestro`, `js`, `clickText`, `waitForText`, `bodyText`, `openMore`, `swipe`, `pressBack`, `canvasRect`, `scanAll`, `openStudioAndDrawTwoBoxes`, `saveAndArchive`, `startCsvExport`, `pickFolder`, `listDir`, `listDirs`, `tapSystemText`, `focusedWindow`, `webViewOrigin`, `screen`, `sleep`, plus re-exports `check`, `finish`, `webState`, `adb`.

## Invariants
* `guardApp` throws for any app id other than `com.imeilens.scanner.phonetest`.
* `E2E_REAL_PHONE=1` (set by `run-e2e.ps1 -RealPhone`) turns `isEmulator` off for the device; `requireShareAllowed` refuses on a non-emulator unless `E2E_ALLOW_SYNTHETIC_SHARE=1`.
* Staged or shared photos must match `SYNTHETIC_NAME` (`E2E-`, `EDGE-` or `RETRY-` prefix, `.jpg`).
* The `E2E-` prefix is reserved for the five-photo picker set; retry photos use `RETRY-` for that reason.

## Side effects
* Scenarios read and write the test app's data through `adb run-as` (debuggable build), DevTools and `adb input`; they can create export files and archive entries inside the test app.
* `make-*fixtures.mjs` write only under `e2e/fixtures/out`; runners write only under `e2e/reports`.

## Verification
* No phone needed: `node --test e2e/phone-tools/page-snapshot.test.mjs` (also part of `npm test`).
* Emulator suite: `powershell -ExecutionPolicy Bypass -File e2e\scripts\run-e2e.ps1`.

## How Claude uses it
1. Build or install the test APK, then run the suite (or one test) and read `REPORT.md`.
2. On a failure: look at the Maestro screenshot of the failing step, the Maestro log, `logcat.txt` and the verify output, name the cause, and propose the fix.
3. With the Maestro MCP tools (after a restart): inspect the live screen hierarchy, tap and type, take screenshots and run a single flow while investigating.
4. Real-phone-only items (camera, share target apps, Bluetooth, real memory pressure, ARM speed) stay on the manual checklist: see `COVERAGE.md`.

## Rules
* Only `com.imeilens.scanner.phonetest`. `run-e2e.ps1` aborts if any flow names another app id.
* Synthetic data only in committed files (`npm run check:private:ci` enforces it).
* No test deletes user data; the archive tests check that nothing is lost.

## Background runs: never wait without a timeout
Start long runs with `e2e\scripts\run-batch.ps1 -Name <name> -Runs N [-RunTimeoutMin 40]`: it always leaves `e2e\reports\<name>-done.txt` or `<name>-failed.txt` (a run that exceeds its timeout is stopped and marked failed). Wait for it with
`node e2e/scripts/wait-for.mjs e2e/reports/<name>-done.txt --pid <batch pid> --timeout-min 90`, which exits 0 (done), 2 (failed marker), 3 (producer died without a marker) or 4 (timeout), so a waiter can never hang. Log samplers (`adb logcat ... &`) must be started with a kill in a `finally`/trap.
