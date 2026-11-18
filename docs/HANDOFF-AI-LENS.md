# AI LENS — live continuation handover

Updated 2026-11-18, 09:44 UTC / 13:44 Dubai. **Read this document first, and follow [APP-QUALITY-STANDARDS.md](APP-QUALITY-STANDARDS.md) for all work.** It supersedes the older checkpoints in HANDOFF-RELEASE-PLANNING.md.

## Current state — do not mistake this for a finished release

- Workspace: `C:/Users/carlou/Desktop/imeiscanner-main`; actual Git repository: `github-live/`.
- Branch: `ux/photo-editor`. HEAD: `c095684` (last application source commit: `11432a7`). Extensive application changes remain **uncommitted**. Do not discard them or restart implementation.
- Working source version: **1.27.1**, Android versionCode **44**. Product renamed **AI LENS**; isolated app label **AI LENS Test**.
- Latest `npm run typecheck` passed against the current working source at this handover.
- A full `npm test` run passed with **63 planning/assistant check groups**, plus the other existing suites, earlier in this working session. Some later UI/routine/context changes have only had TypeScript verification; run the full suite again.
- **No new AI LENS APK has been built, installed, committed, pushed or published.** The old published APK is RetailLens1.27.0/code43, source11432a7. Never present it as this update.
- User's latest instruction is to write handover documentation now. The wider authorized work remains: finish implementation, audit/fix integrations, verify, commit/push, create an in-place update APK, publish a GitHub download and provide actual updated screenshots/report for evaluation.

## Latest user decisions, in priority order

1. **AI icon = compact chat for questions/checks and short summaries. Full information/review belongs on Home.** This supersedes earlier requests/screenshots showing approval controls inside the global assistant panel. Header icon must remain accessible in every tab, including screens under More and Simple mode.
2. Home is the central place for automatic attention checks, suggestions, pending assistant actions, file work, detailed report/IMEI outputs, approvals, receipts, History and guarded Undo.
3. Assistant should reduce navigation and understand supported requests using all relevant saved information: people, exact models, stock, targets/caps, calendars/shifts, plans, reports, shared settings, history and files. Ambiguous/unsupported requests require clarification; never invent data or claim execution.
4. Examples: give4 Fold phones to one promoter and10 to another; prepare or edit a dated report; add/remove/store phone stock; accessory balance changes; global settings changes; targets and availability. Show the interpretation/output, allow approve/reject, then explain exactly what changed.
5. **Routine learning** is the exact requested settings name. Learn suggestions from repeated completed tasks on different days. User can add/edit/pause/remove routines, create one from suitable history or ask for one in chat. Modes: suggest only, prepare daily review, pause. Prepare fresh work using today's information; do not blindly replay yesterday's quantities/files/IMEIs.
6. Most work should be prepared automatically in background, yielding to typing/cropping. Native scans already use durable background work/notifications. Web tasks need checkpoints/resumption; do not promise work can continue through Android force-stop or process death. Respect explicit Stop/Pause.
7. New pending requirement: **interactive assistant activity visuals** — blinking/shimmering, reading/"eating", checking/thinking, cooling/waiting/ready. Implement real activity states with lightweight CSS/SVG, transform/opacity and reduced-motion support. Do not fake completed work, invent temperature, continuously run the model, or delay tasks artificially. This visual component has **not** been implemented yet.
8. Brief notifications: auto-hide after2 seconds and swipe-dismiss. Approval/edit dialogs remain until a decision; important issues remain in Home. Toast changes are implemented, but test final timing/swipe.
9. Consolidate duplicated preferences into canonical shared settings. Contextual shortcuts and assistant access are allowed; target-link policy must remain global across all people. Per-record edits, person identity and recipient contact details remain individual.
10. Preserve all existing scanning, crop, export, report, stock, calendar and target features. Simplify navigation without removing functionality. User explicitly requested internet research for modern/responsive/performance guidance and applying appropriate improvements.
11. Rename user-facing product to **AI LENS**, preserving installed package/signing/data compatibility.

## Standing data and approval invariants

- Planning approval reserves eligible Stored IMEIs. It never records a sale. Each actual release still needs confirmation, reduces true stock and updates achievement once.
- Giving changes ownership; it is not a sale. Report draft edits never change actual phone stock or achieved sales. Release30/report20/pending10 remains valid.
- Phones/IMEIs and tablet/accessory OSR have separate stock sources. Accessory imports replace approved absolute balances rather than adding the same snapshot twice.
- Shift calendars and planned IMEI giving/release calendars are separate. Roster files never create phones, uploads, sales or automatic target changes.
- Available / Not available is primary UI language. Single-day unavailability uses equal From/To dates. Legacy offDates remain compatible.
- Global target policy defaults Manual only. Linked changes require separately reviewed balanced target application. Changing policy does not apply/reverse old adjustments.
- Agreed editable calculation:40/(30-5)*5=8; redistribute4+4; targets32/44/44 preserve store120. Keep editable divisors/month days/shares.
- Final WhatsApp Send remains user-operated. Opened/prepared is not proof of delivery. Never send real messages during testing.
- Undo is for supported in-app changes and is guarded against newer edits/moved/sold IMEIs. It cannot unsend external messages or reverse the existing permanent app-data reset. Assistant does not expose arbitrary destructive execution.
- Never uninstall/reset the user's production app. Only use isolated emulator `.phonetest` builds and synthetic fixtures. No real photos/IMEIs/reports/names in public artifacts.

## Implemented working files

### Global processing/edit priority

- `src/processing-options.ts`: Automatic defaults, eight switches, manual-editor gates, per-photo revisions, ResultGuard; cooperative idle wait now accepts AbortSignal.
- `src/ProcessingSettings.tsx`: shared Automatic / Manual / Custom presets and switches; typing priority; no per-photo competing preference.
- `src/CropStudio.tsx`: detection no longer disables drawing/close/navigation; cancellation and stale-result invalidation; global settings shortcut; last-photo Finish queues changed photos and closes immediately.
- `src/App.tsx`: native/laptop result imports held during manual edits; queued crop commits check latest record/revisions; saved unresolved picture checks/retries; global native retry preference; automatic upload disposition and new-upload-only Auto give.
- `src/SwipeNotice.tsx`: Home-only multi-product notice dismissal; SwipeToast,2-second transient notifications.
- Native `setProcessingOptions(boolean)` bridge and ScanWorker retry flag. Package/signing unchanged.

### Automation, calendars and Home

- `src/retail/auto-workflow.ts`: shared workflow preference schema, release/report forecast, upcoming giving, calendar read model. **automaticSuggestions generator budgets shared unassigned Stored stock sequentially**, so one IMEI cannot be proposed to multiple people.
- `src/AutoWorkflow.tsx`: global background `AutomaticForecastEngine`, shared forecast subscription, Home Today/coming-days view and settings. Producer is mounted in App and continues when Home cards/screens are hidden.
- `src/retail/attention.ts` + `src/AutomaticAttention.tsx`: shared read-only checks for Home/chat — review/duplicate/pending uploads, reports/drafts/accessory mismatches, due/stale/short plans, approvals/files, shift review/codes and store target balance. Also shows forecast shortages and technical/native-health attention. Home shows a short list with Show all; chat shows summary only.
- `src/RetailCalendarActivity.tsx` / `RetailAvailability.tsx`: This day vs General/all planned days; person/model/quantity/status and report-share suggestion; Everyone default. Shifts stay separate. Calendar can open the corresponding plan review.
- `src/home-options.ts` / `HomeSettings.tsx`:21 Home sections with Default / Always show / Hide, Essential / Show every section / Reset. Hiding cards does not stop background work. Defaults preserve existing Show all behavior.
- `RetailWorkforce.tsx`, `RetailAvailability.tsx`: one global target policy; remove Specific unavailable date form; same-day/range upsert; retain old stored data.

### Assistant and supported reviewed actions

- `src/assistant-settings.ts`: allowlisted natural-language settings interpretation and snapshots; explained changes; explicit apply/Undo; no arbitrary localStorage/code/tool access. Negated/ambiguous instructions need clarification.
- `src/retail/assistant-actions.ts`: previews and guarded apply/Undo using existing allocation, target, report, stock and availability engines.
- Supported examples: `give 4 Fold6 to [saved person] and 10 to [saved person]`; `set report Fold6 to 6`; `prepare today report`; `store 4 Fold6`; `make 4 Fold6 available`; `remove 2 Fold6 from stock`; `add phone stock F956 IMEI [real valid number]`; `set Buds4 stock to 8`; `split store target 120 for Flagship 1 among everyone`; `mark [person] not available from YYYY-MM-DD to YYYY-MM-DD`; `create daily routine to prepare today report`.
- Exact/unique model resolution; person matching includes unique name tokens and limited typo distance. Ambiguity/shortage/duplicates/pending disposition are blocked; availability/limit/report warnings require review. Mixed unsupported tasks never partially execute. Give+report can be reviewed together.
- Removing stock marks it out of stock and keeps records, not permanent deletion. Manual phone additions require valid unique real IMEIs, are Stored/unassigned, and have an explicit neutral no-photo placeholder. Undo archives added records after conflict checks.
- `src/AssistantReview.tsx`: Home pending selection, latest full result/receipt, lazy paged history, Save question / Ask again / Save daily review / Undo. Pending cap20, request history100, saved questions50.
- `src/RetailPlanAI.tsx`: shared chat, saved questions, report checks/previews, local calculated fallback, optional local model. Summary chat is default; model/advanced controls hidden there. Optional model explanation now follows verified calculation; model cannot approve operations. Global chat no longer contains AssistantRequests; requests go Home. Plan review button switches to Home and opens existing PlanEditor portal.
- `src/retail/local-assistant.ts`, `capabilities.ts`: offline saved-data answers and app feature guide. Optional model context includes app capabilities, settings, availability, plan counts and routine/file summaries, without IMEI lists/photos.
- `App.tsx`: one header assistant across modes/routes, Home review routing, guarded stock add/archive callbacks. Header reset moved into Settings danger section to reduce crowding; permanent confirmation remains.

### File support

- `src/AssistantFiles.tsx`: local photos/TXT/CSV/TSV/JSON/XLSX. Up to5 at once,12MB each,20 saved metadata entries. Serial reader with saved queued/reading/ready/failed state; originals stored privately using roster-file Blob helpers. App resumes pending readers; boundaries yield to manual edits.
- Text limit150,000 characters; truncated extraction cannot be applied. XLSX reader refuses sheets over5,000 rows rather than silently dropping rows. **No PDF support.**
- Extracted text editable on blur (not persisted every key); file details lazy-render. Explicit interpretation as phone report, accessory OSR or shift calendar. File content is data, not instructions.
- Phone file becomes a dated draft proposal. Accessory file becomes approved absolute stock/report proposal with mismatch warnings. Shift file opens the existing reviewer embedded in Home, preserving date/code/person corrections and explicit approval.
- `assistantFiles`, `assistantRequests.fileReport` and receipt metadata are cleaned in `src/retail/data.ts` and included in business backup. Original Blobs are not in JSON backup. Remove-from-list is not physical Blob deletion.
- `RetailExports.tsx` adds assistant request/result history export (now13 categories; update old test counts).

### Routine learning

- `src/retail/routines.ts`: derive candidates only from completed/answered tasks on at least2 different days; exclude fixed ISO dates, individual15-digit IMEIs and file-report snapshots. Explicit user Save daily can use a suitable single task.
- `src/RoutineLearning.tsx`: Home routine UI and global preparation engine. Editable enable/pause/remove; suggest vs prepare vs off mode. One preparation per routine/day; fresh eligibility and calculations; no automatic business approval.
- `assistantRoutines` and request `routineId` persist through cleanState/backup. Task prep uses current offline engines, not background model inference. App-active/resumed scheduling only; no OS daily alarm/closed-app guarantee.
- Reviewed chat routine creation can use explicit task text or a learned history candidate. Check semantic/queue edge cases below.

### Diagnostics, branding and performance

- `src/diagnostics.ts`: private event-only logs, before/after storage breadcrumbs, unfinished-write restart marker, native-health attention and reviewed-log acknowledgement. Never logs exception messages, paths, contacts, IMEIs or raw reports.
- `RecoveryPanel.tsx`: diagnostics export, mark events reviewed, startup/native performance guidance. Native background scanning/recovery existed before this work; do not claim new native scheduling that was not implemented.
- `retail/dated-reports.ts`: compare generated report lines directly with expected names before catalog fallback, fixing an app-generated Fold abbreviation mismatch. Further normalization of Galaxy-prefix variants may still be useful; test before changing.
- User-facing TSX/index/Android labels/notification text updated to AI LENS. Preserve legacy `app:'RetailLens'` backup format marker and all lowercase storage keys/package IDs for compatibility.
- Already existing: phone pagination, lazy Word/Excel imports, reduced-motion support. New: lazy assistant history/file bodies, isolated chat inputs, serial background file work, idle-yielding forecasts, mobile blur reduction, shorter chat/model setup and larger primary assistant controls. Do not add useDeferredValue blindly; official React guidance requires isolating/memoizing the slow subtree.

## Verification and actual artifacts

Passed at earlier checkpoints (rerun after final changes):

- Full npm test:63 planning/assistant groups plus record/crop/retail/diagnostics/storage/privacy/brand/etc. suites.
- Retail browser:51 checks. Photo editor:23 checks, including background Finish, crop-number protection, archive Undo, resume and one retry.
- New processing browser, automation browser, workforce, release-plan, schedule/accessory flows passed before later summary-chat/routine/layout changes.
- Android JVM tests:178,0 failures/errors, before final branding changes.
- Latest current working-tree **TypeScript passed** at handover.

Not final-current verification:

- Final production build, final browser sweep/layout, new file/routine workflows and summary-chat→Home flow still need verification.
- First `e2e-assistant.mjs` passed old global-panel actions (give4/10, approve, receipt, Undo, report/settings, Home history). It **must be rewritten** for the user's later summary-only icon flow.
- Actual Qwen free-text inference and physical-phone endurance/performance are not verified. Earlier1.27.0 model smoke loaded/inferred but returned invalid structured output; fallback tests do not prove the new model flow.
- Six dependency advisory paths remain from prior audit:2 moderate ExcelJS/uuid,4 high development-tool picomatch paths. Do not claim these are fixed or downgrade dependencies blindly.

Actual demo screenshots already shown to user:

- `phase2-results/manual-edit/01..16*.png` (global settings, People, manual editing, notices, forecasts, calendar, Home options). Some are stale;01 settings was captured mid-transition and must be replaced.
- `phase2-results/assistant-actions/17-assistant-panel.png`,18 give preview,19 receipt,20 Undo,21 report warning,22 settings result,23 Home history. These show the **earlier detailed assistant panel**, not final summary chat. Capture replacements after final UI.
- All public-ready screenshots must be synthetic only. These ignored result folders are not source commits.

## Known follow-ups / audit targets

1. Implement the latest requested activity visuals (real checking/reading/thinking/waiting/cooling/ready/error; CSS/SVG, reduced motion; no continuous expensive inference).
2. Update `scripts/e2e-assistant.mjs`: request in compact global chat → Home full preview → approve/reject → latest receipt/Undo. Assert no approvals/full report inside default chat. Exercise hidden tabs/Simple mode and Settings advanced model entry.
3. Update `e2e-automation.mjs`: old `.home-automation details` LocalAI was removed in favor of universal chat. Use header icon, then Home history. Home layout now21 sections. Verify General calendar and per-day model quantities.
4. Update tests for reset moved from header to Settings → Delete scanned records; More title/People entry; branding; assistant export makes13 categories. Preserve existing behavior, not obsolete selectors.
5. Add browser tests for phone/manual stock addition and Undo archive, removal without sale, accessory balances, TXT/CSV/XLSX interpretation, file failure/restart, roster review and routine prepare-once/next-day/disabled modes. Verify warnings and no unapproved sales/messages.
6. `saveAssistantHistory` returns void when pending cap20 is reached, but `queueAssistant` currently still reports a ready request. Return a result/id and do not claim it was saved if full. Background routine engine prechecks the cap; chat needs the same correctness.
7. Verify receipt canonicalization/Undo after cleanState, optional undefined accessory reports, newer calendar/target changes, routine enable/removal, and no partial operations. Business receipt size limit1.9MB protects against truncated Undo snapshots.
8. Confirm standalone task detection and negation. Settings parser runs before business parser with an exclusion for routine wrappers; test routines whose task mentions settings. Fixed-dated tasks/IMEIs should not recur automatically.
9. File truncation currently requires splitting/reupload; edited smaller text does not clear truncation flag. Decide whether an explicit “Use edited extraction” confirmation is needed; never silently apply partial stock snapshots. Invalid/empty edited file text should remain blocked.
10. File original download exists; direct original viewing/sharing is via existing roster viewer/export paths, not fully embedded for every assistant file type. No PDF parser; communicate supported formats.
11. Proactive checks should include reading/failed files, approvals, report drafts, stock/target mismatches, due plans and diagnostics; ensure notifications are not repeatedly raised or expensive loops triggered. Ready-but-not-yet-interpreted file attention could be improved with an explicit used/reviewed marker.
12. Avoid resetting Home preferences to make hidden sections visible. If a user hides the assistant review card, provide an obvious Settings restore/shortcut. Chat's Home/file links currently navigate Home but do not auto-expand the file details.
13. Latest routine/feature changes need a new full test run and browser runtime checks for circular imports (AssistantReview↔RoutineLearning; file/calendar/Plan/AI reusable components).
14. Review Java branding diff and source paths before release. Functional native changes should only be retry preference bridge/flag; app data paths must not change. Some Git modified flags are newline normalization with no substantive diff.
15. Formatting/large text: test411px and360px with130% zoom; responsive header, dark textarea,48px primary controls, nested modal scroll containment, keyboard resizing, toast swipe and activity reduced motion. Earlier layout failures were small summary tap targets; those were enlarged but latest layout not yet rerun.

## Test execution and tool constraints

- Windows PowerShell, full access, approval policy never. Do not pass sandbox_permissions. No subagents unless explicitly requested by user or applicable instructions.
- Read CLAUDE.md, retain user authorization. Never use real-data e2e-review harness; synthetic photo-edit suite covers this work.
- Build `dist` before browser tests and **wait for completion**. Running a new build while tests serve dist causes transient404s; do not do it.
- Ports: retail/layout/simple shareHTTP4196 (run sequentially). Photo-edit4195; release-plan4198; workforce4199; schedules/accessories4201; processing4202/CDP9362; automation4203/CDP9363; assistant4204/CDP9364. Check storage harness port before parallel runs.
- `npm run typecheck`; `npm test`; `npm run build`; relevant e2e scripts. `e2e-layout.mjs` accepts WIDTH=360 and ZOOM=1.3 environment variables. Capture final screenshots only after transitions settle.
- Test fixes should preserve coverage; explicit Manual prefs in legacy crop tests are intentional. Production default remains Automatic.
- Before commit: `git diff --check`, local privacy check, stage intended files and run `npm run check:private:ci`. Test IMEIs are generated synthetic49015420 prefixes; do not print actual data.

## APK/update/release continuation

- JDK: `C:/Program Files/Android/Android Studio/jbr`.
- SDK: `C:/Users/carlou/AppData/Local/Android/Sdk`.
- Gradle: `C:/Users/carlou/.gradle/wrapper/dists/gradle-9.3.0-bin/79n14ral3mx1ozqr3csh2u872/gradle-9.3.0/bin/gradle.bat`; Android project has no wrapper.
- Native checks: `:app:testDebugUnitTest -PphoneTest --offline`; build `:app:assembleDebug -PphoneTest --offline`, copy isolated APK, then build regular `:app:assembleDebug --offline` (same output path overwritten).
- Package IDs: regular `com.imeilens.scanner`; isolated `com.imeilens.scanner.phonetest`. **Keep them unchanged.**
- Existing debug certificate SHA256: `f2a58bb2e0ba7296dba017d3a89070deb7f959b80b0af17bce7d6a4dfa387a27`.
- Emulators5554 and5562 available. Only install isolated test package using `adb install -r`; no uninstall/reset. A test upgrade baseline with1 synthetic record was already saved by `scripts/check-android-upgrade.mjs before`; baseline oldAPK43 still installed when captured. Recheck baseline/current app state before installing.
- Source commit first after successful audit, then web build again for exact APP_COMMIT stamp, `node scripts/copy-android-assets.mjs`, native builds, apksigner/aapt checks, source-asset verification and in-place retention test.
- `scripts/check-android-upgrade.mjs before|after` uses forwarded isolated WebView devtools9229. Cold starts can change PID/context; wait until ready and forward the current process. Existing health/recovery bridge checked; add setProcessingOptions check if useful.
- Adapt ignored old scripts `phase2-results/release-planner/verify-apks.py` and `publish-release.py`: currently hardcoded11432a7 /1.27.0 and RetailLens filenames. Use new exact source hash and **AI-LENS** artifact names, new prerelease tag, no main merge/force-push.
- Verify credentials only in process memory; never print/store tokens. Old publisher uses git credential fill→REST. Discover GitHub plugin release/upload capabilities if useful; use API/CLI fallback if file-upload tools are insufficient.
- Generate actual screenshot gallery/ZIP with updated scripts; don't publish stale assistant UI. Existing `scripts/build-automation-gallery.mjs` needs branding/new screenshots/paths updated; it currently covers manual-edit files and older naming.
- Publish test and regular APKs, SHA256SUMS and screenshot gallery/ZIP. Verify public download bytes/hashes, not just release existence. Copy new test APK to outer `RetailLens-Latest-Test.apk` only as a compatibility alias if desired; also provide clearly named AI-LENS latest files.
- Record final source hash, checks, APK certificates/hashes, public links, upgrade retention and honest physical-phone/model/WhatsApp limits in release audit; final docs-only commit after artifact verification is fine. Push user-authorized branch without merging main.

Old release for reference only: https://github.com/cjbarnes29/imeiscanner/releases/tag/retaillens-test-11432a7 . It is **not** this AI LENS update.

## Primary performance references checked this session

- React, deferred rendering/isolating slow lists: https://react.dev/reference/react/useDeferredValue
- Android WebView startup: https://developer.android.com/develop/ui/views/layout/webapps/optimize-webview-startup
- Android WebView memory: https://developer.android.com/develop/ui/views/layout/webapps/manage-webview-memory
- Google/Android touch target guidance: https://support.google.com/accessibility/android/answer/7101858?hl=en
- web.dev INP guidance: https://web.dev/explore/how-to-optimize-inp

Do not claim experimental native startup APIs, arbitrary closed-app AI work, universal natural-language comprehension, zero bugs or measured physical-phone responsiveness. Deliver a verified, reviewable update with explicit remaining limitations.

## Progress update — Claude, 2026-11-18 (after commit f92d930)

Done and verified in this session (all synthetic data, browser tests on built `dist`):

- **Undo popups** (person delete, archived duplicates, deleted photos) now use `SwipeUndoBar` in `src/SwipeNotice.tsx`: 2 seconds, swipe sideways, clock waits while touched. `scripts/e2e-undo-bar.mjs` (7 checks, port 4205/CDP 9365). A test can lengthen the clock with `localStorage['imei-lens-undo-ms']` (photo-edit test does).
- **Follow-up 1 (activity visuals): implemented.** `src/assistant-activity.ts` (store, priority error > thinking > reading > checking > waiting > ready > idle) and `src/AssistantMascot.tsx` (SVG face, transform/opacity only, still picture per state, `prefers-reduced-motion` stops all movement). Real sources only: forecast engine (`AutoWorkflow.tsx`: checking / waiting while you edit by hand / error), optional model answering (`RetailPlanAI.tsx`: thinking), files queued/reading and pending Home requests (derived in `App.tsx`: reading / ready). No invented temperature or progress, no timers for show. Unit test `scripts/test-assistant-activity.mjs`; browser checks in `e2e-assistant.mjs`.
- **Follow-up 2 (e2e-assistant) rewritten** for compact chat -> Home review -> approve / Undo (give 4+10, report warning tick, settings). **Follow-up 3 (e2e-automation)** now uses the header chat. Guide topic number shift (new "AI assistant" topic is 1) fixed in `e2e-release-plan.mjs`. `e2e-studio.mjs` seeds the Manual preference and leaves room for a third box (a press within 26 px of a box edge grabs that box).
- **Follow-up 6 fixed:** `saveAssistantHistory` returns the id or `null`; `queueAssistant` returns `saved`; the chat says "Not saved: too many requests are waiting on Home" instead of claiming it was saved; the routine engine does not mark a routine prepared when nothing was saved. `scripts/test-assistant-queue.mjs` (part of `npm test`).
- Backup restore (`DataTab.pick`) names the file, retries an empty read and lets the same file be chosen again; the legacy backup marker stays `app:'RetailLens'` (a rename pass had changed it in the retail test; fixed).

Verification at this point: `npm test` (all groups), `tsc`, privacy check, JVM 178/0 failures; browser: retail 51, photo-edit 23, undo-bar 7, studio 12, queue, layout at 411px and 360px with 130% zoom, simple, storage, processing, automation, assistant, workforce-plan, release-plan, schedules-accessories. `e2e-review` / `e2e-bulk` were not run (they use real photos). Not verified: physical phone, Qwen free-text inference, the Android emulator with this build, upgrade retention of the new APK.

Still open from the list above: 4 (more test-count updates, only if a suite fails), 5 (browser tests for manual stock add + Undo, accessory balances, TXT/CSV/XLSX interpretation, file failure/restart, roster review, routine prepare-once / next-day / paused), 7-13, 14 (Java branding diff review), 15 (device-size checks done in the layout test; keyboard / nested-modal checks not done). Release work (version stamp, native builds, upgrade-retention test, AI-LENS named artifacts, GitHub prerelease, screenshot gallery) has NOT started.

### Reports made by the assistant (Claude, 2026-11-18, uncommitted)

The user asked for the AI to make a report from the app's data as Excel, PowerPoint or simple notes.

- Pure modules in `src/retail/`: `report-model.ts` (the month in numbers built only from existing engines: targets, sales, stock, month outlook; percentages rounded to four places; never an IMEI), `report-notes.ts`, `report-xlsx.ts` (exceljs, loaded only when asked), `report-pptx.ts` (hand-written package with jszip; no new dependency; slides continue instead of overflowing; text is XML-escaped), `report-intent.ts` (strict understanding of "make a PowerPoint report for last month", "excel report for Asha", "simple notes of my targets"; the older meaning of "report" = WhatsApp stock report is left to the other assistant rules; an unknown person name is reported, never guessed).
- UI: `src/AssistantReportFiles.tsx` = Home > Assistant review > **Make a report** (month, person, three buttons; the finished report offers **Download** and **Send on WhatsApp**: files go through the existing `ctx.shareFile` share menu, notes through `ctx.whatsapp` = wa.me link; notes can also be shared/copied or saved as .txt). Final send is the person's tap in WhatsApp; delivery is never claimed. The chat only understands the request, stores the choices (`localStorage['retaillens-report-request-v1']` + event) and says to open Home. Making a report changes no data.
- Tests: `scripts/test-report-builder.mjs` (in `npm test`: model numbers, notes, Excel read back with exceljs, PowerPoint package checked part by part, awkward characters, long lists, request parsing) and new steps in `scripts/e2e-assistant.mjs` (chat request -> Home card filled in -> real .pptx/.xlsx blobs -> notes -> nothing changed). Also opened with python-pptx and openpyxl in a throwaway venv (6 slides, 6 sheets, percent format).
- Not verified: the files in Microsoft PowerPoint / Excel themselves or on a phone, and slide text fit in PowerPoint (sizes are conservative; no renderer was available). Reports use no model: the optional on-device model is not involved.

## Checkpoint — APKs built from 6e0ef94, NOT published (Claude, 2026-11-18)

**Standing decision (user, 2026-11-18): deliver APKs only. No standalone web build, web deploy or web release.** The web app is built only as part of making the APK. Test the APK on an emulator (isolated `.phonetest` app); do not present browser-only runs as release evidence. Also in `CLAUDE.md`.

State: branch `ux/photo-editor`, pushed commit **6e0ef94** (earlier: f92d930). Source version 1.27.1, Android versionCode 44.

Built from that clean commit (web build re-stamped, `node scripts/copy-android-assets.mjs`, gradle debug builds), in `phase2-results/builds/` (git-ignored):

| File | Package | Label | SHA-256 | Size |
|---|---|---|---|---|
| `AI-LENS-6e0ef94.apk` | `com.imeilens.scanner` (code 44, 1.27.1) | AI LENS | `bb5e0c48af6ef5fe9dfdeafca5e13c6da3551deff953f318a31a4d9e579d41ee` | 50,366,375 |
| `AI-LENS-Test-6e0ef94.apk` | `com.imeilens.scanner.phonetest` (code 44, 1.27.1-phonetest) | AI LENS Test | `efd779eb596adbaa0d296e4f1be4899b3139eda102562a9bf998437150214a31` | 50,367,437 |

Both are signed with the existing debug certificate `f2a58bb2e0ba7296dba017d3a89070deb7f959b80b0af17bce7d6a4dfa387a27` (apksigner verified), so the regular APK can update an installed AI LENS / RetailLens in place; code 44 is above the published 43. Both bundles contain the assistant face, Make a report, Send on WhatsApp and Month outlook. The test APK was installed on `emulator-5554` (test app only) and started with 0 crashes.

**Publishing was approved by the user but BLOCKED by the permission check** (twice): the publisher script has to read the stored GitHub login through `git credential fill`, which the check refuses. Nothing was uploaded and no tag or release exists. To publish, the user can run this in their own terminal:

`python "C:\Users\carlou\Desktop\imeiscanner-main\github-live\phase2-results\release-planner\publish-ai-lens-release.py" 6e0ef94`

It creates the pre-release tag `ai-lens-6e0ef94` (never "latest", not merged to main) with both APKs and `SHA256SUMS-6e0ef94.txt`, and it refuses to run unless HEAD is 6e0ef94 and the app sources are unmodified. Alternatives: add a permission rule allowing that script; or push a `beta-v*` tag (the workflow then publishes only a CI-built isolated test APK, with old RetailLens naming; a CI-built regular APK must NOT be offered because the CI debug key differs from the installed one). After publishing, verify the public download bytes against the hashes above.

Not done / needs the user: emulator cold boot in Android Studio (the emulator logged Android media and Docs "not responding" and the suite failed in its first flows), then run `e2e\scripts\run-e2e.ps1` on the new test APK; in-place upgrade retention test of the regular APK over an installed old build (`scripts/check-android-upgrade.mjs`); a real-phone check; opening a generated report in Microsoft PowerPoint / Excel.
