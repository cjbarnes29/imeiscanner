# Handover: AI assistant agent upgrade, phases 0–7 (2026-11-19)

Branch `ci/release-main-apk` (local only, **nothing pushed, merged, tagged or released**). Base: main `84d19b7` (1.27.3, code 46).

## What each phase added (one commit each)
| Phase | Commit | What |
|---|---|---|
| 0 | earlier | One safety gate (`src/retail/guard.ts`) in front of every assistant door: questions, what-ifs, negations, intentions and unclear sentences never change data (chat, tasks, routines, Autopilot). |
| 1 | earlier | Tool registry (`src/agent/registry.ts`), saved data read back before "done" (`verify.ts`), append-only audit log (`log.ts`). |
| 2 | earlier | Everyday wording understood offline (`canonical.ts`, "Understood as: …"). |
| 3 | `65b2e32` | Follow-ups ("yes", "undo that"), Approve/Reject/Undo in the chat, opt-in editable memory (`context.ts`, `AssistantMemory.tsx`). |
| 4 | `8313406` | More create/read/update/delete (`crud-commands.ts`): leave, targets, who holds phones, move/take back, restore stock, discard report draft, pause/resume/delete routine. Removals need press-and-hold (small) or typed CONFIRM (big). A refused removal is never rewritten into another action. |
| 5 | `fa2adcb`, `35ff38d`, `7328718` | Duplicate guard (same mode only), interrupted tasks go back to "waiting for you", checkpoint line + "Roll back N saved steps", Tasks card always lists every open task. |
| 6 | `a19cabb` | Live progress panel (`AgentProgress.tsx`) with Cancel/Retry; transform/opacity-only animations, reduced-motion respected. |
| 7 | `e624bcc` | Assistant history card on Home (`AssistantHistoryLog.tsx`, `agent/log-view.ts`): filters, Share, IMEIs masked. |

## Results at e624bcc
- `npm test` passes (safety: 91 unsafe + 12 multi-step + 91 Autopilot runs changed nothing; everyday-language 440/440 on the tuned sets; original 204 = 100%). Typecheck + build OK.
- Browser suites (assistant, automation, retail, review) pass.
- 102-command regression: identical to main `84d19b7`.
- Android WebView check on the isolated test app (emulator-5554): 20 of 20 pass (`/tmp/emu-p7.txt` at the time).
- Main APK: `phase2-results/builds/AI-LENS-e624bcc.apk` (git-ignored), 50,643,987 bytes, SHA-256 `9B84771F96CB4C6156C0D599CEB3FC69EB596BC9353692407AD94E47DA373676`. `verify-apk --kind main`: package com.imeilens.scanner, 1.27.3 (46), label "AI LENS", one signer `f2a58bb2…7a27` (same key as the installed app, so it updates in place). Test APK: `AI-LENS-Test-p7.apk` (separate id `…phonetest`).

## Not done / risks
- **Real phone: not tested.** Phone mode stays on Assistant until this APK is installed and checked on the phone.
- **Language accuracy on unseen sentences is below the 90% target.** The 440/440 figure is on sets used while tuning. Honest blind batches measured 69% → 77% → 80% first pass. More wording will still be missed (it asks for details instead of guessing).
- **Phase 8 (optional cloud / external adapters) not built, on purpose:** it needs your separate approval; no network code exists.
- **Routines as multi-step plans not built:** routines still run as single requests.
- Same version code (46) as the already-installed build: install over it with `adb install -r` / file manager only on your say-so.
- Storage is not atomic across IndexedDB / localStorage; "done" is only reported after reading both back, and a mismatch is reported as "could not confirm".
- The Android check script now rejects held tasks left by earlier runs; those only exist in the isolated test app.

## Next steps (need your approval)
Real-phone test; decide on pushing/merging `ci/release-main-apk`; decide on Phase 8 and routine plans; more wording tests with real sentences from the user.

## Update: final round (commits 62a5744, 3f7ae71)
- More everyday wording; two new blind batches written before tuning scored 81% and 88% first pass (earlier: 69, 77, 80, 84). Target 90% still not reached on unseen sentences; the 626-sentence set is 99% but tuned. Unsafe sentences: 0 changed anything. 102/102 identical to main 84d19b7.
- Routines were already plans: a saved routine runs through the task runner, so several steps become several checked steps (test added). A yesterday-still-open identical task blocks today's run of the same routine on purpose (no duplicates).
- Final checks on 3f7ae71: npm test, build, 4 browser suites, Android WebView 20 of 20.
- **Final main APK:** `phase2-results/builds/AI-LENS-3f7ae71.apk` (git-ignored), 50,644,723 bytes, SHA-256 `050F3B706E93609E49BDD84409EB6124D8C808C0263104A1B103086090C4B926`; package com.imeilens.scanner, 1.27.3 (46), label AI LENS, one signer f2a58bb2…7a27 (updates the installed app in place). Replaces AI-LENS-e624bcc.apk. Test APK: `AI-LENS-Test-p8.apk`.
- Deferred as instructed: Phase 8 adapters (cloud off, no network code), real-phone test, any push/merge/tag/release.

## Update: final stabilization, version 1.27.4 (47) (HEAD 40289a8)
- **Language:** two independent batches written before tuning, in a hurried shorthand style: BLIND-9 74/82 = 90.2%, BLIND-10 66/71 = 93.0% first pass (91.5% combined). Sentences that must change nothing: 0 violations (all groups). Original 204 = 100%. 102/102 identical to main 84d19b7. Fixed a misreading: "make asha hold 3 fold6" no longer becomes a plain store that ignores Asha.
- **Routines:** today's copy of a routine task is reused with a clear message; an untouched copy from an earlier day is replaced by the new run (rejecting it changes no data); a half-done earlier copy is never replaced and says so; a routine skipped because 20 requests wait says why (`startAssistantTask(..., {routine:true})`, `RoutineLearning.tsx`).
- **Cross-store consistency:** `src/agent/reconcile.ts` + `repairOnce` / `reconcileRecent` in `AssistantReview.tsx`. If a check fails after an approval, only what is missing (a person, phone owners, the saved request) is put back and checked once more. On app start (2.5 s after load) the newest applied change whose check never finished (app closed) is re-checked within 48 h; older changes and anything with a newer change after it are never touched. Unconfirmed = flagged in the history card and the person is told. Test: `scripts/test-agent-reconcile.mjs` (8 scenarios).
- **Version:** 1.27.4 (47). **Signed main APK:** `phase2-results/builds/AI-LENS-1.27.4-40289a8.apk` (git-ignored), 50,646,299 bytes, SHA-256 `3B405DF2FADCE2101B2413B995DA2831CA76C2DBCD9806289BFC8D3B5ED4190C`; package com.imeilens.scanner, 1.27.4 (47), label AI LENS, one signer f2a58bb2…7a27 (same key as the installed app; versionCode 47 > 46 so it updates in place). Test APK: `AI-LENS-Test-s2.apk`.
- **Checks on 40289a8-equivalent code:** npm test, build, 4 browser suites, Android WebView 20 of 20 (emulator-5554, isolated test app). Real phone not tested; Phase 8 / cloud AI still off; nothing pushed, merged, tagged or released.

## Release state (2026-11-19)
- Pushed `ci/release-main-apk` (CI `Build`: success on cf36b4a). Backups: tag `backup-main-before-1.27.4`, branches `backup/main-before-1.27.4`, `backup/feature-1.27.4`.
- Merged into `main` with a merge commit: **5897024** (tree identical to the tested cf36b4a). CI `Build` on main: success (run 44488621858).
- Tag `beta-v1.27.4-b1` pushed on 5897024. The release workflow (run 44489171434) **stopped at "Check the signing setup" and published nothing**: the repository has none of the signing secrets (`IMEI_KEYSTORE_B64`, `IMEI_KEYSTORE_PASSWORD`, `IMEI_KEY_ALIAS`, `IMEI_KEY_PASSWORD`) or the variable `EXPECTED_APK_CERT_SHA256`. This is the intended safeguard (see DEVELOPERS.md, "Publishing the main app", one-time setup).
- To finish: add the 4 secrets and the variable (`EXPECTED_APK_CERT_SHA256` = `f2a58bb2e0ba7296dba017d3a89070deb7f959b80b0af17bce7d6a4dfa387a27`) in GitHub > Settings > Secrets and variables > Actions, then Actions > "Beta APK pre-release" > the failed run > **Re-run all jobs**. It builds from the tag, verifies package/version/label/one signer/certificate, and publishes a pre-release (never "Latest").
- Meanwhile the locally built and verified APK (same code, version 1.27.4 (47), key f2a58bb2…7a27) is `github-live/phase2-results/builds/AI-LENS-1.27.4-40289a8.apk`, SHA-256 `3B405DF2FADCE2101B2413B995DA2831CA76C2DBCD9806289BFC8D3B5ED4190C`.
- Assistant mode remains the default (`DEFAULT_WORKFLOW.assistantMode = 'assistant'`); Phase 8 and cloud AI are off. Real-phone testing still pending.

## Release published (2026-11-19)
- **Beta release:** https://github.com/cjbarnes29/imeiscanner/releases/tag/beta-v1.27.4-b3 (pre-release, not Latest). APK: https://github.com/cjbarnes29/imeiscanner/releases/download/beta-v1.27.4-b3/AI-LENS-1.27.4-b3.apk (50,645,915 bytes), SHA-256 `14f3baa494576f512cfd1eea5a93b7f2675a390d8dac3cbca4462e97714e2e44` (matches the published .sha256 file).
- Verified after download with `scripts/verify-apk.mjs --kind main`: package com.imeilens.scanner, version 1.27.4 (47), label AI LENS, one signer `f2a58bb2e0ba7296dba017d3a89070deb7f959b80b0af17bce7d6a4dfa387a27` (the key on the installed app, so it updates in place and keeps the data), signature verifies.
- Built from tag `beta-v1.27.4-b3` = commit `fc085a7` on `main`. App code is identical to merge commit 5897024; later commits only changed the release workflow, the release gate script and docs.
- Earlier tags `beta-v1.27.4-b1` and `beta-v1.27.4-b2` failed before publishing anything (missing signing secrets, then the key text saved with the wrong content). They have no release. The signing secrets were then set with the GitHub CLI (`gh secret set`, key sent straight from the key file; nothing stored in the repo).
- The release workflow now (a) cleans invisible characters from the pasted key text and reports only counts, (b) uses the build-tools 35.0.0 the workflow installs, (c) shows the signing tool's public output if no certificate is found.
- Still true: Assistant mode is the default; Phase 8 and cloud AI are off; real-phone testing is pending.
