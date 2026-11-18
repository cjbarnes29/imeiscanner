# RetailLens 1.27.1 / Android code 44 audit

## Current source and scope

Branch `ux/photo-editor`. User authorized implementation, audit, commit, push and an update APK in this conversation. No uninstall, production device data mutation or main merge is authorized/needed.

Global automatic/manual processing; edit-priority background queue; late detection cancellation; quiet Store / Available upload workflows; new-upload-only Auto give; Home suggestions for today/coming days; global availability target policy; same-day/range calendar editing; local text assistant fallback; calendar model quantities and giving/release/report projections; Home attention summary. Detailed People visibility and Home-only swipe notice are fixed.

## Validation checkpoint

- Full npm test passed, including 49 release-planning groups and processing/edit lifecycle checks.
- TypeScript / production build passed before the final calendar connection; final build and browser sweep pending at this checkpoint.
- New automation browser suite passed quiet storing, Home calculation, text fallback, global target policy, same-day upsert, 32/44/44, new-only giving, unavailable skip, daily cap, future forecast, no unapproved sales.
- New processing browser suite passed global switches, Detailed People/filter visibility, explicitly configured Manual mode, draw priority, cancellation, navigation, swipe dismissal and record retention. Test fixtures use Manual preferences; production default is Automatic.
- Final calendar/browser/layout/Android/upgrade/artifact publication verification will be recorded below when completed.

## Limits to preserve

No claim of zero bugs or measured physical-phone performance. Real WhatsApp final sending is user-operated; no real messages sent in tests. New optional model chat inference is not verified by saved-data fallback tests. Prior dependency audit has six vulnerable paths (two moderate ExcelJS/uuid and four high picomatch paths); not resolved by this UI release. No private user photos, reports or IMEIs may be published. Android updates require the same package and signing certificate as the installed app.

## Quality findings — 2026-11-18 (classes: [APP-QUALITY-STANDARDS.md](APP-QUALITY-STANDARDS.md))

Open findings after the Claude continuation session. Only things that were checked or could not be checked are listed; nothing here is a guess about code that was not run.

**Critical:** none known.

**High**
- H1. The current working source has not been run on the Android emulator (assistant face, Auto give, Edit all, Undo popups, restore messages). Browser tests and the 178 JVM tests pass; the emulator and a real phone were not used. Needed before any release.
- H2. In-place upgrade retention for the new APK is not verified (the old AI LENS / RetailLens 1.27.0 APK is the only published one). Needed before any release.

**Medium**
- M1. Undo popups leave after 2 seconds (user request). After that, a person deleted with "keep phones" can only be re-added by hand; "Delete person and phones" has no Undo at all (it asks first). Archived photos and duplicates stay restorable from the archive.
- M2. `e2e-review` and `e2e-bulk` were not run (they use real photos); review and bulk screens are covered only by the synthetic photo-edit, studio and queue suites.
- M3. Handover follow-ups still open: browser tests for manual phone stock add / Undo, accessory balances, TXT / CSV / XLSX interpretation, file failure and restart, roster review, routine prepare-once; file truncation (an edited smaller text does not clear the truncation flag); no PDF reader.
- M4. Dependency advisories remain from the earlier audit (2 moderate in ExcelJS / uuid, 4 high in development-tool picomatch paths). Not changed; do not downgrade blindly.
- M5. A backup that failed to restore on the user's phone was not reproduced (the app's own Download opens the Save screen; the emulator's file picker hung with an Android "not responding" message, so a full save-and-restore round trip could not be completed). The restore step now names the file and retries an empty read. Ask for the file name and whether it was just saved if it happens again.

**Low**
- L1. Some Java files show as modified only by line-ending changes (handover item 14); the branding diff has not been reviewed line by line.
- L2. Optional on-device model (Qwen) free-text answers were not verified; saved-data answers and the calculated fallback are tested.


**Medium (added later the same day)**
- M6. The new assistant report files (Excel, PowerPoint, notes) were validated with exceljs, python-pptx and openpyxl and in the browser build, but not opened in Microsoft PowerPoint / Excel or on a phone; slide text fit is by conservative limits, not a renderer. Open one real file before relying on it.
- M7. The full emulator suite was started on the isolated test app (`1.27.1-phonetest`, installed OK, starts with no crash) but stopped after the first flows: 00-smoke, 01-scan-gallery and 02-records failed while Android's own `android.process.media` and Google Docs processes logged "not responding", so the results are emulator noise. A cold boot of the emulator in Android Studio is needed (not done by Claude without asking) before the emulator gate (H1) can be closed.

## Artifacts built 2026-11-18 (not published)

Built from commit `6e0ef94` (branch `ux/photo-editor`, pushed): `AI-LENS-6e0ef94.apk` (`com.imeilens.scanner`, 1.27.1, code 44, SHA-256 `bb5e0c48af6ef5fe9dfdeafca5e13c6da3551deff953f318a31a4d9e579d41ee`) and `AI-LENS-Test-6e0ef94.apk` (`com.imeilens.scanner.phonetest`, SHA-256 `efd779eb596adbaa0d296e4f1be4899b3139eda102562a9bf998437150214a31`), both signed with certificate `f2a58bb2…a387a27`. Package ids and signing unchanged. The test APK installed and started on the emulator with 0 crashes. **Not published**: the upload was approved but blocked by the permission check; see `docs/HANDOFF-AI-LENS.md`. Still open from the findings above: H1 (emulator suite), H2 (in-place upgrade retention), M6 (Office files), plus the real-phone check.

**Medium (added after the small-chat round)**
- M8. Many questions in a row leave many requests pending on Home (cap 20; the 44-question browser battery left 19). Informational requests are saved as answered, but actionable ones wait for review. Consider a bulk reject or expiry.
- M9. The user's "manual save everywhere" request is not built (Settings switch Automatic / Manual with Save and Discard on edit screens). Home and Targets redesign not started.
- M10. The round assistant button was checked in a browser at 411 px and 360 px with 130% zoom (layout test passes) but not on an emulator or phone; it can overlap content at the right edge.
