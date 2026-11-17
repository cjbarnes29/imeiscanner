# RetailLens: progress, decisions, how to resume

## GitHub checkpoint — 2026-11-18

The user authorized committing and pushing the completed changes on `ux/photo-editor`, and rebuilding the RetailLens Test APK from the committed source. The audit and earlier local-work notes below describe the pre-publication checkpoint. Generated APKs, screenshots, test reports and agent state remain local and excluded from Git. No merge into main or production release is included in this checkpoint.

## Latest local checkpoint — 2026-11-17

Further work in this checkpoint: summary-first screens with Show all; model lists on segment cards; a single Models & segments library/search/editor with saved and Samsung sources; three More groups (People & sharing, Models & segments, Settings & backup); caps visible in the target overview and shared summaries. Audit fixes cover database read/save failures, transaction rollback, malformed backups/templates, zero low-stock thresholds, simultaneous server uploads, shared report delivery, popup-to-screen history, and modern Android Back handling. Reusable checks: `scripts/e2e-storage.mjs`, `scripts/test-server-api.mjs`, expanded `scripts/e2e-layout.mjs`, `scripts/e2e-retail.mjs`. Final artifacts and detailed results are in ignored `phase2-results/audit-2026-11-17/`; the final audit report there supersedes the older verification paragraph below.

Continued the uncommitted phone target-editor and backup restore changes on `ux/photo-editor` (base commit `10776b3`). Edit all uses a labeled segment row inside each person's card, with live totals and an Everyone together card. Backup selection shows reading progress, retries empty reads, identifies empty/invalid/unreadable files, and allows selecting the same file again. A selection counter prevents an older pending read from replacing a newer backup; leaving the screen invalidates pending reads too.

Verified: `npm test`, `npm run build` (includes TypeScript checking), `npm run check:private`, and `node scripts/e2e-retail.mjs` (48 checks). Browser coverage includes phone-width target labels and inputs, saving and totals, backup errors, repeated selection, and changing files while an empty read is pending. Target editor screenshot inspected: `phase2-results/continue-2026-11-17/targets-edit-all.png` (ignored local output). Build retains the existing large-chunk warning. No Android build or emulator run in this checkpoint; no commit, push or release performed.

The older status and resume notes below describe earlier phases; use `git status` and this checkpoint for the current local work.

Autonomous upgrade of IMEI Lens into **RetailLens** ("Scan. Sell. Track. Achieve."). IMEI Lens stays the scanning engine.
Branch `ux/photo-editor`. The phase notes below are historical; see the GitHub checkpoint above for the current publication scope. Checkpoints are zip snapshots in `phase2-results/checkpoints/`.

## Rules I am working under
- No commit / merge / push / deploy / release without approval. Real app (`com.imeilens.scanner`) never touched; tests use the isolated test app only.
- Package id and signing configuration unchanged. Rebrand = visible text and labels only.
- Offline, no paid APIs. Synthetic data only in tests.
- Existing records, original photos, people and the scanner keep working. Retail data lives under `retail:` keys in the same IndexedDB and never touches `record:` keys.

## Decisions taken (all reversible, all editable in the app)
| Topic | Default I chose | Why |
|---|---|---|
| Segments | Flagship 1 = S Ultra, Z Fold. Flagship 2 = S, S+, Z Flip. Flagship 3 = S FE, Z Flip FE. Mid = A3x/A5x/A7x (M3x+). Low = A0x-A2x (M0x-M2x). Tablet = Tab. Wearables = Watch, Buds, Ring. Anything else = "Unclassified" (counts toward no target) | Samsung numbering; the real mapping changes monthly, so every model can be changed per month and corrections are remembered |
| Promoter screenshot / WhatsApp report format | **I have no sample of either.** Parsers are tolerant and learn from what you give them; tested on synthetic samples | Cannot invent a format; the layout is learned from your own pasted report |
| Incentives | EXAMPLE rates (per unit by segment, x0.5 at 70 %, x1 at 100 %, x1.5 at 120 %). Edit in Targets > Incentives | The real scheme is yours; the app only multiplies |
| Achieved | The screenshot's number is the baseline; sold-but-not-submitted sales are shown as "pending" and counted in "projected", not in "achieved" | Avoids double counting what Samsung already has |
| Sales attribution | A sale belongs to the phone's owner when confirmed; unowned phones cannot be sold; a phone/IMEI sells once; moving a sale needs approval + reason and is audited | "Prevent unauthorized sales attribution" |
| Allocation | Proposals only (never auto-applied). Order: my own selected target first, then everyone below 70 % (lowest first), then others toward 100 %. Only unassigned, valid, non-duplicate, unsold phones. Manual approval per line, history, undo | "Protect my selected target", "manual approval", "allocation history" |
| WhatsApp images | Photos shared to the app are queued and scanned (existing behaviour) and now grouped by upload day. A WhatsApp-folder watcher needs storage permission, so it is **not** built (permission-gated); sharing works without any permission | "Respect permission checks; continue other tasks" |
| WhatsApp text | A report shared as text is received by the app and can be parsed | Needed for "understand my report" |
| Backup | JSON file: retail state + a plain ledger of scan records (numbers, no pictures). Restore replaces retail data, keeps the old state for Undo, never touches scan records or photos | Pictures are huge; records are protected by the archive |

## Status
Legend: DONE = built and tested, PARTIAL = built, part not verified, NOT BUILT = deliberately left out (reason given).

| Area | Status | Evidence |
|---|---|---|
| Rebrand to RetailLens (names, tagline, titles, notifications, labels); package id and signing unchanged | DONE | browser test checks name + tagline; `applicationId` still `com.imeilens.scanner` |
| WhatsApp images: shared photos are queued and scanned automatically, listed by upload day (local day), tap a day to see its phones | DONE (existing share scan + new day list) | e2e-retail, emulator test 16 |
| WhatsApp report shared as text opens Reports | PARTIAL (Android code + manifest filter written; not exercised on the emulator yet) | needs an emulator run |
| WhatsApp media-folder watcher | NOT BUILT | needs storage permission (blocked by your permission rule); sharing needs none |
| Auto segregation: Flagship 1-3, Mid, Low, Tablet, Wearables; manual and bulk editing; Records filter and badge | DONE | test-retail, e2e-retail |
| Editable catalog: models, SKU, RAM, storage, colours, abbreviations, monthly segments, remembered corrections | DONE | test-retail, e2e-retail |
| Targets: Promoter screenshot import (offline OCR), achievement, remaining, per day, incentives at 70/100/120 | DONE on synthetic screenshots; **your real screen format untested** | e2e-retail reads a generated screenshot |
| Smart allocation: protects my target, lifts people below 70 %, manual approval, history, undo | DONE | test-retail, e2e-retail |
| People and Gives: per-person targets, recommendation, approval, history | DONE | e2e-retail |
| Inventory by model/storage/colour, updates on confirmed sales, adjustments, alerts | DONE | test-retail, e2e-retail |
| Smart reports: learn the layout of your WhatsApp report; sellout, stock, colours, totals, activations, SC+, competitor, shifts | DONE on synthetic layouts; **your real report layout untested** | test-retail (3 layouts), e2e-retail |
| Today dashboard: priorities, pending submissions, stock alerts, checklist | DONE | test-retail, e2e-retail |
| Data management: no duplicate sales, monthly history, corrections, undo, backup/restore, snapshots, audit | DONE | test-retail, e2e-retail |
| Auto-retry of undetected IMEIs (ML Kit, barcode recovery, Tesseract) | DONE on emulator for barcode recovery; pairing fix needs one emulator re-run | scenario 19 |
| Emulator run of the final build | see the final report | |

## How to resume
1. `git status` on `ux/photo-editor`; latest snapshot in `phase2-results/checkpoints/`.
2. `npm test` (all unit tests, includes `scripts/test-retail.mjs`), `npx tsc --noEmit -p .`, `npm run build`.
3. JVM tests: `cd android && gradle :app:testDebugUnitTest -PphoneTest --offline` (JAVA_HOME = `~/.jdks/temurin-25.0.4`).
4. Emulator (test app only): `powershell -File e2e\scripts\run-batch.ps1 -Name x -Runs 1` (about 20 min).
