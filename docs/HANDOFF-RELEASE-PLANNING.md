> **Newer state: read `docs/HANDOFF-AI-LENS.md` (Progress update and Checkpoint sections) and follow `docs/APP-QUALITY-STANDARDS.md`. APK only: no web builds or web releases.**

# LIVE WORKING CHECKPOINT — AI LENS 1.27.1 / code 44

2026-11-18: User renamed RetailLens to **AI LENS**. Preserve package/signature/storage/schema compatibility. Latest steering: AI icon is a SUMMARY CHAT for questions/checks; detailed outputs, action approvals, warnings, results, Undo and file interpretation belong on HOME. AI integration settings allow optional detailed workspace, automatic check summaries and follow-up suggestions. Optional Qwen inference is not a continuous background task.

Work is UNCOMMITTED; source/branch remain c095684 on ux/photo-editor until release. User explicitly authorized audit/fixes, commit, push and downloadable update APK. No production device may be uninstalled or reset. Continue finishing and testing; do not claim release complete yet.

New assistant code: AssistantReview.tsx / AssistantFiles.tsx / AutomaticAttention.tsx; pure retail/assistant-actions.ts / retail/attention.ts / assistant-settings.ts. Supported reviewed commands: give quantities to named people, dated report quantity changes, global preferences, Store/Available/remove-from-stock, manual phone additions with real valid IMEIs, accessory balances, equal store target split, unavailable ranges, report-file proposals. Canonical existing domain engines are reused. Saved questions / requests / receipts are in RetailState and cleaned by data.ts. Undo refuses newer conflicting edits or moved/sold IMEIs; external sent messages and permanent app reset are not reversible assistant actions.

Files: local photos/text/CSV/TSV/JSON/XLSX; original Blob in private roster-file store, metadata/text in assistantFiles; serial restartable reader. File content is data, not instructions. Explicit report interpretation creates pending reviewed draft/snapshot; roster interpretation embeds existing calendar reviewer. Pending: finish browser testing, attachment-truncation UX, current docs/audit, final release. No PDF support yet. Original blobs are not included in retail JSON backup.

Global forecasts now run in AutomaticForecastEngine mounted in App, even when Home is hidden. Shared generator budgets Stored IMEIs sequentially across people to prevent duplicate forecast reservations. Home/assistant attention share pure checks. Device logs capture action and before/after storage stages; unfinished write marker is checked at restart.

Testing so far: 58 planning/assistant pure groups passed before the latest attention/summary changes; first assistant browser suite passed global request/give4+10/receipt/Undo/report/settings/Home history, but it must be rewritten for SUMMARY CHAT → HOME REVIEW (latest UI requirement). Browser photos have been shown to user; earlier settings screenshot captured during a transition and must be replaced. Existing manual/automation/photo/workforce/report/layout suites need final sweep. New scripts e2e-assistant.mjs (4204/9364), e2e-automation.mjs (4203/9363), e2e-processing.mjs (4202/9362). Retail/layout/simple share4196 and MUST run sequentially. Build before browser tests; wait until complete. Source version remains1.27.1, Android44. APKs still old1.27.0 until rebuilt after a source commit.

---

# Current checkpoint: 1.27.1 / Android 44

This supersedes the historical 1.27.0 checkpoint below. Read [RELEASE-1.27.1-AUDIT.md](RELEASE-1.27.1-AUDIT.md) for current validation and artifact state.

- Automatic photo processing is the global default. Manual / Custom presets and individual global switches remain available. Never overwrite a crop, rotation, typed field or active photo with a late background result. Finished bulk crops queue checks and close immediately.
- Global Settings > processing / after-upload automation applies to every person and future batch: Store/Ask/Available, giving Suggest/Auto, goal, horizon, reserve, report percentage, live preview and optional report preparation after release approval. Ownership changes never imply a sale. Only new uploads are unassigned for automatic allocation; existing owned stock stays owned.
- Home owns Automation · Today & coming days, Needs attention, the local assistant, schedule reminders and links to the IMEI calendar. The calendar shows person/model/quantity/date and proposed vs approved vs completed. Forecasts use known stock only; approved reservations replace fresh proposals for the same person. Future giving is a projection, not an executed assignment or assumed future upload.
- Availability/target policy is GLOBAL for all people. Default Manual only. Linked requires explicit balanced review. Changing this preference never applies or reverses prior adjustments. Removed the Specific unavailable date form: From=To records a single day; old offDates remain preserved and displayed. Exact range saves upsert rather than duplicate.
- Device automation/processing preferences live in localStorage; in-place updates preserve them. Retail business backup preserves schedules/plans/targets, but does not copy these device preferences to another device.
- Optional local-model free-text answers plus a deterministic saved-data fallback. No model can approve a release, change targets or claim to have sent WhatsApp. Model inference and physical-phone endurance require separate verification.
- Detailed People tab, filters and Home people chips stay visible in summary mode. Multi-product notice is Home-only, swipe/close dismissible; dismissal never deletes records.
- Shift calendars remain separate from IMEI giving/release calendars. True phone stock, report quantities and tablet/accessory balances remain separate ledgers.

---

# Claude continuation checkpoint — 2026-11-18

Read this before CLAUDE.md. Branch `ux/photo-editor`, source commit `11432a7` (started from74fa186). Delivered version1.27.0 / Android code43; previous local test APK is code42. [Published prerelease](https://github.com/cjbarnes29/imeiscanner/releases/tag/retaillens-test-11432a7), [final release audit](RELEASE-1.27.0-AUDIT.md). Later docs/tool commits do not change APK application source. User explicitly authorized implementation, commit, push, APK and GitHub download in this conversation. Do not merge main or rewrite history.

## Decisions that must remain true

- Automatic preparation → review → approve/reject. Auto refreshes daily calculations, never confirms sales silently. Plan approval reserves eligible Stored IMEIs. Confirmed daily release counts sales once, updates achievement and reduces true stock.
- Home is the daily entry point: release/not today, upcoming editable days, true phone stock, pending reporting, shift review reminder, daily upload check and tablets/accessories stock summary. Give & share contains Give / Plan / Share. Secondary tools remain behind Show all.
- Finished scans ask Use now / Store for now / Plan release. Pending choices survive restart as Held. Live scan estimates cannot execute incomplete results. Stored retains normal selection/edit/share/export tools. Upload-choice popup must wait while a photo/review editor or queue dialog is open.
- True phone stock includes Available + Stored unsold. Reporting is separate: release30/report20/pending10; stock and achievement reflect30. Already-included linking prevents counting pasted sales twice. Undo uses report revision links so old sales cannot subtract newer-day report totals.
- Plan modes: Auto/Manual daily quantities, days/end-date/month-end duration, goal percent/points/milestones/spread/stored-percent/fixed units, reserves/limits/skips, caps and typed milestone levels. Recheck saved availability at actual release time.
- Primary statuses **Available / Not available**. Internal off/annual fields remain for compatibility. Recurring weekdays, specific dates, date ranges, timed/code shifts, overnight and split periods are saved. Manual unavailable overrides require warning and History entry.
- Calendar changes: Manual only versus Link to targets. Linked target adjustments require a separate balanced review/application. Agreed formula `40/(30-5)*5=8`, editable total8 split4+4 produces32/44/44, preserving store120, stock and achieved sales. Month days, daily divisor, unavailable divisor and final shares are editable. Cancellation/edit reverses prior deltas and restores typed levels. Do not revert to the earlier planning-only target interpretation.
- Store monthly target per segment auto-divides into editable promoter base targets. Existing linked adjustments are reapplied; totals must balance.
- **Shift calendars and IMEI activity calendars are separate.** Planned IMEI activity means releases/shares of Stored (user confirmed), not expected future scans. Rosters never create scanned records, stock or sales.
- Report → Phones → Schedules: Shifts / IMEI calendar / Import / Codes. XLSX, CSV/TSV/text and images interpret into editable proposals, then approve/reject. Unknown names/dates/codes require correction. Original uploaded Blob is viewable privately; calendar edits are separate. Day/week/month, codes/times and share/export are supported. Legends are not dated rosters; ambiguous working/split codes require review. New import replaces exact matching date ranges; explicit ID edit preserves other periods. Overlapping nonidentical ranges need user review.
- Home shift review range expires; calendar/code changes invalidate fingerprint. Daily upload quick check shows date/current person/model/count/expandable IMEIs, with duplicates/review separate. Current ownership is not an historical assignment snapshot.
- Phone Report has editable full final text, quantity selection, Auto/Manual dated drafts, mismatch warning and future projection labels. Text edits never change phone stock. Copy, mobile prefilled chat and group chooser are available.
- Per-person optional approval defaults prepare report+IMEI packet after confirmed release, with all or preset segment report quantities. Prepared/opened/user-confirmed sent are separate; opening is NOT proof of delivery. Ordinary WhatsApp needs final Send tap. No unattended Business API integration. Tests must never send messages.
- **Tablets & accessories** (tablets, watches, buds, Fit, bundles) is a separate Report category. Manual OSR, editable final text, and saved quantity stock register are connected to Home/Report/Export/Backup/History. Read proposes absolute balances; approval REPLACES listed model quantities, never adds the same report twice. Zero clears a model; omitted models remain unchanged. Keep report only is available. Later text/row edits require explicit stock review to change saved stock. Samsung Sold mismatch is warned. No user's real header/contacts are bundled.
- Global/context Help opens interactive local demo state, never actual records. First-use Home checklist links setup. Demos cover uploading/storing/bulk/plans/reports/people/models/availability/shifts/accessory OSR.
- Optional local AI: Transformers.js4.3.2 + pinned Qwen2.5-0.5B q4 in WASM worker. Separate weight download/cache/remove/cancel. Aggregate context only; no photos/IMEIs sent. AI cannot execute sales. Invalid schema is rejected. One browser download/inference succeeded but output failed schema. Physical-phone performance is unverified.
- Recovery: saved native queue/job/results resume after committed checkpoint; WorkManager KEEP guards active workers. A few photos since last batched save may repeat and are deduplicated. Android force stop halts until reopening. Lost file permission may require reselecting originals. Saved crop jobs resume; unsaved browser selections cannot survive termination.
- Error recording is automatic **local only**. Web error/rejection types and native crash class/frames, not messages or scanned data. Startup check, React error boundary, exportable diagnostic JSON and Auto/Safe/notification/battery/storage guidance are implemented. Unclosed session is a possible interruption, not proof of crash. No remote telemetry; diagnostics are not backups.
- Preserve package IDs/signing and increase code. Production `com.imeilens.scanner`; test `.phonetest`. Never uninstall/reset real app data. Different signing certificate cannot update an installation.

## Storage and exports

Android private `native-scans/current.json/images`; web IndexedDB `imei-lens-v2/inventory`, `record:`/`source:` and `retail:state`. Roster Blobs ONLY `retail:roster-file:<uuid>`, never scanner prefixes. Retail state persists plans, targets, calendars, report drafts, accessory stock and prepared delivery snapshots.

Export12 categories: phone stock, targets, plans, pending reporting, dated drafts, availability/divisors, linked shares, shifts/codes, prepared-sharing status, tablet/accessory OSR+register, history, retail backup. CSV formulas escaped. Retail backup excludes original photos and roster Blobs; save originals separately/download rosters from Schedules. Uninstall/clear app data removes private storage.

## Implementation map

- `retail/planning.ts`, `planning-data.ts`, `RetailPlan.tsx`: eligibility/reservations/daily proposals/release/undo/report links.
- `availability.ts`, `store-targets.ts`, `RetailWorkforce.tsx`, `RetailStoreTargets.tsx`: calendars/formula/reversible deltas/store split.
- `shift-codes.ts`, `availability-import.ts`, `RetailAvailability.tsx`: roster proposals/code legend/time checks/original viewer/sharing.
- `daily-uploads.ts`, `RetailCalendarActivity.tsx`: daily counts, separate IMEI calendar, Home reminders.
- `dated-reports.ts`, `RetailDatedReports.tsx`, `RetailReport.tsx`: actual/projected drafts and editable final phone message.
- `accessory-report.ts`, `RetailAccessoryReport.tsx`: independent OSR and approved stock snapshots.
- `delivery.ts`, `RetailDelivery.tsx`: approval defaults, packet preparation, opened/user-confirmed states.
- `RetailUpload.tsx`, `RetailScanPlan.tsx`, `RetailExports.tsx`: saved gate/live preview/exports.
- `diagnostics.ts`, `RecoveryPanel.tsx`; native `ScanRecovery`, `RecoveryDiagnostics`: local logging/startup/native resume/error boundary/performance.
- `Guide.tsx`, `InteractiveTutorial.tsx`: demo-only practice; context topic names must match exactly.
- `App.tsx`: integration, unavailable warnings/audit merge, persistence failures and photo-editor deferral.

## Observed checks and pending delivery

- Full npm test passed, including43 planner/accessory/calendar groups and diagnostics privacy/restart tests. Final tsc also passed.
- tsc/build passed; bundle large-chunk warning remains. WASM runtime adds about27MB uncompressed; model weights are separate.
- Release-flow browser test passed: reserve40/release to70%/report20of30/pending10/true stock38/duration/manual/future/Home/tutorial isolation/reload.
- Workforce browser passed store120→40/40/40→32/44/44/calendar/manual override cancel+accept/History/reload and all12 exports.
- Schedule/accessory browser passed actual CSV Blob/proposal/approval/calendar ID edit/overnight codes/original viewer/week+month sharing/separate IMEI calendar/independent stock snapshots/mismatch/mocked group share/Home/reload/mocked recovery. No messages sent. XLSX and image/OCR UI have not yet received the same end-to-end coverage.
- Storage browser:4 groups passed (round trip/rollback, read/write failures, damaged scan data).
- Native JVM suite:178 tests,0 failures/errors; native compilation passed. Real-phone force-stop/performance unverified.
- Layout360px/130% passed all summary/detail screens and Settings after fixing full-bleed header margins. New toolbar buttons widened after screenshot review.
- Original retail browser suite passed51 checks after updating My target selector.
- Photo-edit browser suite passed23 checks: crop/rotate/delete/undo, draft resume, typed-value preservation, retry once, people tools, and no upload popup over editor. Live plan preview moved after main scan controls (first control334px). Simple-mode browser passed5 checks. Legacy e2e-review requires a private photo; review behavior is covered using synthetic photo-edit fixtures instead.
- Privacy check passed0 new leaks in331files; CI privacy passed before staging. Only synthetic IMEIs prefix49015420 in test code/public artifacts.
- npm audit: ExcelJS/uuid moderate paths and picomatch ReDoS high paths through Vite/fdir/tinyglobby remain. Vite6.4.6 removed older direct dev-server advisories. Do not force old vulnerable downgrades or claim zero findings. Save final audit.

Release completed: source committed/pushed11432a7; rebuilt/stamped web copied into both APKs; all46 assets verified; matching certificate/package and code42→43 checked. `adb install -r` on the isolated emulator retained1 synthetic record/photo/IMEI/model and saved audit sentinel. Native recovery bridge/startup health passed. APKs, checksums and18-picture gallery were published as prerelease/latest=false. All5 public downloads returned200 and matched expected bytes; both APK hashes matched. Real installed app data was never touched. See final audit for hashes/limits. Remaining work is the explicitly listed physical-device/file-layout/AI coverage, not an unfinished release.

Artifacts: ignored `phase2-results/release-planner`, screenshots01..37. `node scripts/build-change-gallery.mjs` produces a self-contained HTML gallery and ZIP with18 curated demo screenshots. Gallery contains no actual user attachments. Previous `retaillens-test-74fa186` APK is old. `scripts/check-android-upgrade.mjs before|after` checks the isolated emulator WebView forwarded to9229, stores only hashes/counts in its local evidence, and verifies retained records/photos/audit after install-r.

## Environment/commands

PowerShell cwd `C:/Users/carlou/Desktop/imeiscanner-main/github-live`. No Gradle wrapper. JDK `C:/Program Files/Android/Android Studio/jbr`; SDK `C:/Users/carlou/AppData/Local/Android/Sdk`; Gradle `C:/Users/carlou/.gradle/wrapper/dists/gradle-9.3.0-bin/79n14ral3mx1ozqr3csh2u872/gradle-9.3.0/bin/gradle.bat`. Use `-PphoneTest --offline` for native test/assemble. Signing/package settings unchanged.

`npm test`, `npx tsc --noEmit`, `npm run build`, `npm run check:private`. Browser scripts: e2e-release-plan, e2e-workforce-plan, e2e-schedules-accessories, e2e-retail, e2e-layout, e2e-storage, e2e-simple, e2e-photo-edit (all scripts/*.mjs).

Do not share harness ports: retail/layout/simple HTTP4196 sequential; photo-edit/review4195/CDP9351 sequential. Planner4198/9358, workforce4199/9359, schedule4201/9361 independent. CHECK_AI=1 downloads hundreds MB; avoid unnecessary repeats. Never test with real user records or installed app data.
