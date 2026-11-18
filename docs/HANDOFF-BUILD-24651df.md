# Handover: main APK build from 24651df (2026-11-19)

## What was done
- Cleaned up old local branches. Deleted (all already merged into origin/main): ai/assistant-upgrade, fix/phase2-safety-phone-testing, merge/ux-into-main, performance-update, release-1.22, release-1.23, test/phase2-export-fix-ci, ux/crop-simple, ux/photo-editor, ux/simple-buttons, web-label-count-review. GitHub (origin) copies were not touched.
- Kept: ci/release-main-apk, main, improvements/multi-product-camera (NOT merged, may hold unfinished work), release-1.21 (git refused: not merged into the remote web-label-count-review).
- The local `main` in `github-deploy-work` was stale (92b5845, 234 commits behind). It was reset to origin/main (24651df). The one old commit it had, 92b5845 "Add files via upload", is no longer on any branch; recover it from the reflog if ever needed.
- Pushed ci/release-main-apk (f5be083..24651df). This only runs the normal CI check. main was not pushed, nothing was tagged or published.

## State
- origin/main = 24651df, version 1.27.3, versionCode 46. Working tree clean.
- Checks on 24651df: `npm run typecheck`, `npm test` (all pass) and `npm run build` OK. Emulator/browser e2e suites and real-phone tests were NOT run.
- `github-deploy-work` had no node_modules; `npm ci` was run there (git-ignored).

## APK
- File: `github-live/phase2-results/builds/AI-LENS-24651df.apk` (git-ignored), 50,611,119 bytes.
- SHA-256: 6F6DA978E2566C6F2421A7C1F3C9ADD2A81CA6E68500BC4F8C3996380C51172E
- `node scripts/verify-apk.mjs --kind main --cert f2a58bb2...7a27` passed: package com.imeilens.scanner, 1.27.3 (46), label "AI LENS", one signer, signature verifies, same key as earlier local builds (updates installs in place).
- The older `AI-LENS-1.27.3.apk` in the project root has a different hash (different build); it was left untouched.

## How it was built (no wrapper in the repo)
1. `npm run build`, then `node scripts/copy-android-assets.mjs`
2. Set for the session only: `ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk`, `JAVA_HOME=%USERPROFILE%\.jdks\temurin-25.0.4`
3. `gradle-9.3.0\bin\gradle.bat --project-dir android :app:assembleDebug --offline` (path in HANDOFF-AI-LENS.md). Without ANDROID_HOME it fails with "SDK location not found".

## Still open
- Real-phone test of 1.27.3 (see PHONE-TEST-CHECKLIST.md); never use the real phone without the user's say-so.
- Decide on improvements/multi-product-camera and release-1.21.
- Publishing the APK to GitHub releases (tag beta-v*) was not done in this session.
- The fix below was committed and pushed to the branch ci/release-main-apk (not main); no new APK was published to GitHub.

## Update: assistant people commands and the "looks done but nothing set" fix (on top of 24651df)
- **People by chat** (`src/retail/people-commands.ts`): add, rename, delete, list. "add 3 person khuram raseen and carlou" makes three people. Strict name matching (whole name, or a word only one person has). Deleting never deletes phones: they move to Unassigned and Undo gives them back (same person id). Undo is blocked if the person was renamed, got phones or someone reused the name. The receipt keeps `peopleOps` (cleaned in `data.ts`). The app side is `editPeopleFromAssistant` in `App.tsx` (all or nothing); ctx gets `editPeople` and `latestPeople`. Autopilot class `people` (off by default; deleting always asks, class `remove`).
- **Bug fixed:** an understood command that cannot be done (for example a target command with no people yet) was saved as "waiting for review", so the chat said saved and the mascot showed the ready tick while nothing was set. Now `queueAssistant` returns `blocked`, saves it as an answer, and the chat says "Nothing was changed". With no people, target commands say "Add your people first". Pending requests now say "Not applied yet: waiting for your approval".
- **Tests:** new `scripts/test-assistant-people.mjs` (in `npm test`); `test-assistant-queue.mjs` updated (it asserted the old behaviour); module added to the file list in `test-release-plan.mjs`. Verified: tsc, `npm test` (110 checks), build, e2e-assistant, e2e-retail (51), e2e-simple (5), e2e-layout (2).
- **Regression check vs 24651df:** 102 commands run through old and new code: 95 identical (stock, giving, reports, calendar, routines, settings), 7 differ only by the intended no-people wording.
- **Not done:** no emulator or real-phone test; the wider "talk like a normal person" understanding (planned: follow-up questions, conversation memory, in-chat Approve button, much wider wording); the user must still check which assistant mode the phone uses (Settings; default Assistant waits for approval on Home).
