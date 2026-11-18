# Claude — start here for AI LENS

This is the current handoff index. Read this first, then `../CLAUDE.md`, `APP-QUALITY-STANDARDS.md`, and the detailed `HANDOFF-AI-LENS.md`.

**Newer work (branch `ai/assistant-upgrade`, version 1.27.3 / code 46): read [HANDOFF-AI-ASSISTANT.md](HANDOFF-AI-ASSISTANT.md).** It covers multi-step tasks, Assistant/Copilot/Autopilot modes, timed routines with the Android background helper, Auto give, WhatsApp report preparation, offline voice input, one-person target edits, the user's decisions, tests, APK artifacts and a real-phone checklist. Where it differs from older notes below, it is newer.

The user asked this assistant to **finish handoff/docs only** and will forward them to Claude. No app code, tests, APKs, publishing or Git commits were changed/run as part of this documentation-only handoff. Earlier implementation/release requests remain context for the next authorized continuation.

## Verified repository snapshot

- Actual repository: `C:/Users/carlou/Desktop/imeiscanner-main/github-live`.
- Branch: `ux/photo-editor`.
- HEAD inspected for this handoff: `9fee3a8`.
- The working tree was clean before these documentation edits. The older “uncommitted at c095684” statements in the detailed historical notes are obsolete.
- Source version:1.27.1; Android code44. Product **AI LENS**, isolated label **AI LENS Test**.
- Recent commits, newest first:
  - `9fee3a8`: synthetic privacy-test allowlist update.
  - `18cbebc`: floating assistant bubble/small chat, history suggestions, summary answers, working next steps, natural target-split wording and navigation search.
  - `f34d03c`: AI LENS Test release workflow naming.
  - `d916ea0`: APK-only rule, artifact checkpoint and audit documentation.
  - `6e0ef94`: assistant activity face; Excel/PowerPoint/notes reports with download/WhatsApp; quality standards and test/handoff updates.
  - `f92d930`: initial accumulated AI LENS1.27.1 assistant/routines/global-automation work and related fixes.

## Current product decisions

1. **Deliver APKs only.** The web build is an internal APK asset/developer test input, not a standalone user deliverable or web deployment.
2. Assistant access is available throughout the app. Latest implementation is a **floating bubble and small chat card**, with history-based suggestions and short structured answers. The full assistant workspace still exists.
3. Home is the central review surface: detailed proposals, automatic checks, stock/target/calendar/report warnings, suggested work, approvals, receipts, History and guarded Undo.
4. The app should prepare useful work automatically, reduce navigation and yield to manual edits. Recheck current saved data before approval.
5. **Routine learning** suggests recurring tasks from completed work on different days. Users can create/edit/pause/remove routines; modes are suggest, prepare for daily review and off. It prepares fresh work; it does not silently approve sales or send messages.
6. Latest documented redesign order: **Assistant → Home → Targets**. Assistant work is built; simpler Home (three key cards + More) and grouped/less crowded Targets remain unfinished.
7. Latest documented manual-save request: a **Settings Automatic / Manual save switch**, with suitable Save/Discard handling on edit screens. **Not built.** Do not confuse this with the existing Automatic/Manual photo-processing or daily-plan modes.
8. Brief notices/Undo bars follow the requested two-second behavior and dismissal controls; persistent issues belong on Home. Never auto-dismiss critical approval/edit decisions in a way that loses work.
9. Keep one canonical setting for shared policies. Availability-to-target linking is global across people. Preserve individual phone edits, identities and recipient contact details.
10. Background work should finish where Android permits and be resumable otherwise. Respect explicit Stop/Pause; do not promise execution through force-stop/process death or a closed-app daily web scheduler.

## Features already present — do not reimplement from old TODOs

- Global processing controls, detection/retry cancellation, manual-edit priority, bulk crop Finish/background queue, Home swipe notices and Detailed People visibility.
- Quiet Store/Available upload options, eligible new-upload-only Auto give, daily release/report forecasts, caps/reserves, shared stock budgeting and day/general IMEI calendar model quantities.
- Global target-link policy, editable same-day/range availability, work calendars, reviewed roster interpretation, store-target splitting and editable32/44/44 redistribution example.
- **Shift Calendar → annual leave (added after the 1.27.1 audit):** `src/retail/leave-bridge.ts` + `RosterLeavePanel.tsx`. AL days in imported rosters are offered under Shifts with the calculated effect (40/(30−5)×5=8 → 32/44/44); "Save as annual leave" records the range only and never changes targets; the reviewed Availability & calculation days flow still applies them under the global policy. Days already entered by hand or already adjusted are not offered again. Calendar days carry an AL mark. Tests: `scripts/test-retail-v2.mjs` (bridge) and `scripts/e2e-schedules-accessories.mjs`.
- **Hide suggestions (added after the 1.27.1 audit):** `hideSuggestions` master switch plus `suggestionChips` and `leaveSuggestions` in the workflow options; one helper, `showSuggestions(options, kind)`, decides chat chips, next steps, routines, the Home forecast and leave proposals. Warnings and approvals are never hidden. Chat command "hide suggestions" / "show suggestions". Test: `scripts/test-release-plan.mjs`.
- Reviewed assistant commands for giving, stock states/manual additions/removals, phone report drafts, accessory balances, target division, unavailable ranges, settings and routine creation.
- Local file interpretation: photos/TXT/CSV/TSV/JSON/XLSX; original private files; editable extracted text; report/OSR/roster proposals. No PDF parser.
- Saved questions, recent results, request History, guarded Undo, diagnostics and restart breadcrumbs.
- **Activity face implemented** in `assistant-activity.ts` / `AssistantMascot.tsx` / `AssistantBubble.tsx`, with real checking/reading/thinking/waiting/ready/error states and reduced motion. The historical “not implemented” activity TODO is obsolete. No fabricated cooling/temperature/progress.
- **20-pending cap acknowledgement fixed**: `saveAssistantHistory` returns an ID/null and `queueAssistant` returns `saved`; the chat no longer claims a failed save succeeded. The old TODO describing this as unfixed is obsolete.
- **Make a report** on Home: month/person scoped Excel, PowerPoint or plain notes, built from existing app numbers without IMEI/photo lists; download/share/WhatsApp preparation. Modules: `report-model`, `report-notes`, `report-xlsx`, `report-pptx`, `report-intent`; UI `AssistantReportFiles.tsx`.
- **Navigation search** via `NavSearch.tsx` / `retail/nav-search.ts`, including screen/tool/settings/saved-question search and explicit deep links.
- `AssistantAnswer.tsx` provides headlines/bullets/emphasized figures and working follow-up actions. Suggestions invoke the question instead of merely inserting text.

## Important invariants

- Plan approval reserves Stored phones; actual release requires confirmation and counts sales once.
- Giving is ownership, not a sale. Editing reports does not change actual phone stock or achieved targets.
- Shift schedules are separate from planned IMEI giving/releases; roster imports do not create phones or sales.
- Accessory/tablet stock and phone IMEIs are separate ledgers; approved accessory snapshots replace matching balances instead of double adding.
- Global target policy defaults Manual only; linked changes require reviewed balanced application.40/(30−5)×5=8, split4+4, gives32/44/44 while preserving store120; divisors/shares stay editable.
- Undo protects newer edits/moved/sold phones. Existing permanent reset/person deletion and external sent messages are not universally reversible. Report actual limits.
- WhatsApp final Send is user-operated; opened/prepared is never proof of delivery. Never send real messages during tests.
- Preserve package IDs, signing, data keys and legacy backup compatibility. No production uninstall/reset or real customer-data publication.

## Validation evidence — distinguish history from final release QA

The detailed handoff records full npm tests, TypeScript/privacy checks,178 JVM tests and browser flows at earlier checkpoints. The later chat/search work records tests for assistant suggestions, navigation search and coverage of44 questions, plus browser immutability checks. These are **recorded results, not reruns in this docs-only handoff**.

Browser checks are useful development evidence. They do not replace the APK emulator suite, in-place retention or a physical-phone check. The latest bubble/search changes have not been verified on a phone/emulator according to the current audit.

Read `RELEASE-1.27.1-AUDIT.md` for classified findings. The newest artifact and later-source notes supersede the first historical validation paragraphs.

## Existing APKs are older than current source

APKs exist locally under `phase2-results/builds/`, built from **6e0ef94**, not 9fee3a8:

| Artifact | Package | SHA-256 |
|---|---|---|
| `AI-LENS-6e0ef94.apk` | `com.imeilens.scanner` | `bb5e0c48af6ef5fe9dfdeafca5e13c6da3551deff953f318a31a4d9e579d41ee` |
| `AI-LENS-Test-6e0ef94.apk` | `com.imeilens.scanner.phonetest` | `efd779eb596adbaa0d296e4f1be4899b3139eda102562a9bf998437150214a31` |

Both are1.27.1/code44 and use the prior local debug certificate. The recorded test install/start had0 crashes, but the emulator suite encountered Android media/Documents ANRs. Cold-boot/recheck the isolated emulator before further APK QA. Upgrade retention and real-phone behavior remain unverified.

These APKs do **not** contain the later floating-chat/search commit. Rebuild from the final audited source for the next delivery and choose a versionCode above the installed/distributed44 where appropriate.

No AI LENS GitHub release/upload is recorded. Publishing was previously blocked by permission review of stored GitHub credentials. Do not bypass that rejection or print tokens. The old `publish-ai-lens-release.py 6e0ef94` command checks HEAD and is now stale; do not run it unchanged for newer source. The workflow naming has since been corrected by f34d03c, but CI debug signing can differ from installed local APKs; do not offer a differently signed build as an in-place update.

## Prioritized continuation

1. Confirm Git state and read the quality standards; preserve newer commits and user changes.
2. Finish the requested Automatic/Manual save setting and screen Save/Discard inventory without duplicating existing processing/plan settings.
3. Simplify Home to key cards with More; simplify Targets/group advanced controls. Keep all existing features accessible.
4. Audit assistant questions: informational/answered requests should not unnecessarily fill the20 pending slots. Consider reviewed bulk rejection/expiry, respecting approval history and user choices.
5. Finish integration tests for manual stock add/Undo archive, accessory edits, TXT/CSV/XLSX interpretation, reader failure/restart, roster review and routine once-per-day/next-day/off behavior.
6. Address remaining file truncation UX (smaller edited text still has the truncation flag); preserve explicit review before partial stock imports. PDF unsupported should be explained.
7. Verify current activity/bubble/search UI at360px, large text, keyboard/nested modals and on Android; check overlap with the Top button/content.
8. Test generated Office files in actual Excel/PowerPoint and check slide fit, not just package validity. Plain notes/report sharing must preserve the no-delivery-claim rule.
9. Run final full checks, APK emulator suite and isolated in-place retention. Document real-phone/Qwen/WhatsApp limits and known dependency advisories.
10. Only after the audit, perform the user-authorized commit/push/build/release work with the final source stamp, matching certificate, correct version and verified public download hashes. Do not merge main, force push, uninstall production or treat old APKs as current.

## Practical test/build notes

- Repository shell: PowerShell. JDK: `C:/Program Files/Android/Android Studio/jbr`; SDK: `C:/Users/carlou/AppData/Local/Android/Sdk`.
- Gradle: `C:/Users/carlou/.gradle/wrapper/dists/gradle-9.3.0-bin/79n14ral3mx1ozqr3csh2u872/gradle-9.3.0/bin/gradle.bat`.
- Installed package IDs remain `com.imeilens.scanner` and `com.imeilens.scanner.phonetest`.
- Matching local certificate SHA-256: `f2a58bb2e0ba7296dba017d3a89070deb7f959b80b0af17bce7d6a4dfa387a27`.
- Use only isolated test APK installs, with `adb install -r`; never uninstall/reset production data.
- Build dist and wait for completion before developer browser checks. Retail/layout/simple share4196 and must run sequentially. Photo4195, planner4198, workforce4199, schedule4201, processing4202, automation4203, assistant4204.
- Native tests/builds: `:app:testDebugUnitTest -PphoneTest --offline`; test APK `:app:assembleDebug -PphoneTest --offline`; copy it before the regular build overwrites the same output path.
- Stamp/build web assets after final source commit; `node scripts/copy-android-assets.mjs`; verify APK assets/version/certificate and retention. Use `scripts/check-android-upgrade.mjs` on the isolated app only; recheck the current baseline/PID/socket.
- Keep synthetic-only tests/artifacts. Some review/bulk harnesses use real photos; do not run or publish those data casually. Privacy checks must pass before committing.
- Known dependency advisory paths remain in ExcelJS/uuid and development picomatch tooling; do not claim they are resolved or downgrade blindly.

## Documents to forward

- This file: current start point and decisions.
- `HANDOFF-AI-ASSISTANT.md`: the AI assistant upgrade (tasks, modes, routines, helper, WhatsApp, voice, targets): what was built, decisions, tests, APKs, limits, next steps. Newest.
- `HANDOFF-AI-LENS.md`: detailed architecture, prior checkpoints, artifact/build details and subsequent progress notes.
- `RELEASE-1.27.1-AUDIT.md`: classified QA findings and artifact limits.
- `APP-QUALITY-STANDARDS.md`: required engineering/QA standards.
- `../CLAUDE.md`: repository workflow and APK-only rule.

Claude also needs the current repository checkout to continue code work. The documents ZIP contains documentation only; it is not source code or a new APK.
