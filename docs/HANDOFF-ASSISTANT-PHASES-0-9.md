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
