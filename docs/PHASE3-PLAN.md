# Phase 3: investigation and improvement plan (for approval; nothing in this plan is implemented)

Status: written before the real-phone results arrived. It rests on emulator evidence, the code, and the Phase 2 benchmarks. Every item says what the phone results must confirm; when they arrive the root-cause sections are re-checked and the order below may change. Rules that stay in force: no merge, no history rewrite, no production release, no deletion or replacement of user data, and compatibility with the installed app and its data.

## 0. Evidence base
| Source | What it gives |
|---|---|
| Phase 2 benchmark (emulator, isolated test app) | Standard/Auto 11/12 IMEIs on 5 labelled photos; Products = 4 gives 12/12; 24 photos in 55 s, peak 367 MB, 0 failures; warm 6-photo scan 10 s (cold or first run 17 to 26 s) |
| Settings matrix, 9 runs on identical photos | The typed product count, not the speed, decides the blurred label; Detailed adds time without accuracy on this set |
| Scanner diagnostics (`IMEI-Lens/diag`) | Per photo: Model lines counted, barcode labels, target, groups, tile passes, stage timings |
| CSV investigation | Empty export reproduced when the app process ends during the Save dialog |
| Automated emulator suite (Maestro + scenarios, synthetic photos) | Repeatable regression baseline: see `e2e/COVERAGE.md` |
| Phone results (pending) | Real camera photos, real memory pressure and speed, share targets |

### Findings from building the automated suite (new, small, for the plan)
* **Restore from the archive list works.** It asks `window.confirm()`, the Android WebView shows a native OK / Cancel dialog, and the test that taps OK passes. (An early run looked like a defect because the test did not answer the dialog; this was checked and corrected.) The older code uses the same confirm dialog in the camera and settings screens, so it is an existing, working pattern. A later polish item: an in-app confirmation would look the same on every phone.
* **"Valid IMEI" and "Needs review" overlap.** "Valid IMEI" means "checksum passed", so a record that needs review (for example the IMEI-2 fallback, or a crop flagged for review) is counted in both. This is existing behavior, not a regression; it can confuse the tiles. Proposed: show "Valid and confirmed" separately, or document it in the tile text.
* **Saving to local storage is delayed by about 350 ms.** Anything that reads the store right after an action must wait. I did not test what happens if the app is killed inside that window; the last change could be lost. To verify, then (candidate) flush immediately after archive actions.
* **Maestro cannot read stacked modal dialogs** (Crop Studio over the review dialog); those screens are driven through DevTools plus real touch gestures. Not a product issue, but accessibility of the stacked modal (screen readers see the same limit) is worth a look.

## 1. Auto product-count detection (priority 1) and why a typed count helps (priority 2)

### Root cause (proven in the logs)
The typed number is only a **trigger**. In `ImageScanner.scan`, the enlarged tile re-read runs only when `target > labels found`. In Auto, `target` is `max(Model lines counted, barcode labels)`, and both are read from the same first pass that already missed the label. So for the 4-label photo: 3 Model lines, 2 barcode labels, target 3, groups 3, tile passes 0: the re-read never starts and the blurred label stays invisible. With 4 typed, target 4 > 3, one tile pass (about 3 s) runs and the fourth label is found. Detailed speed does not help in Auto because it only adds a second, finer pass after the first has been triggered. The extra accuracy therefore comes from the **second look at higher effective resolution**, not from the number itself.

This is circular: Auto counts what it already read, so it cannot discover what it did not read.

### Proposed solution: a completeness check that can raise the target
After the first read, estimate whether the photo holds more labels than were found, using evidence that does not depend on the failed read:
1. **Layout evidence (cheap, no OCR):** the found groups give a label pitch. Texture with label-like stripes (barcode bands) outside the found groups' extents by more than about one pitch suggests a missing label. Preliminary check on 5 photos: the 4-label photo has 1.5 pitches of unexplained texture above its first group; the correctly counted two-label photos have 0.6 to 0.8. Five photos prove nothing yet: this is the hypothesis the phone photos must test.
2. **Partial evidence:** a barcode or "IMEI" fragment seen in the full read that belongs to no group; Model lines minus groups; distinct valid barcodes minus labels.
3. **Targeted second look:** when the check says "probably N+1", read only the suspicious region (or the tile pass) at higher effective resolution, and keep the result only if it yields a checksum-valid IMEI in a region that does not overlap a known group. If nothing is found, the photo is flagged "a label may be missing" (never silently saved as complete) and becomes eligible for the existing rescan.

### Trade-offs
* More reads on photos that look incomplete (about +3 s each). Photos that pass the check pay a few milliseconds.
* False alarms add a pointless second look; the guard (keep only non-overlapping, checksum-valid finds) prevents phantom records.
* Not a fix for a label that is not visible at all: that stays a "needs review / scan again" case.

### Test plan
* Offline experiment first: layout signal and thresholds on every labelled photo (the 5 existing plus the 20 to 30 phone photos), reporting false alarms and misses; no app change.
* JVM tests on captured geometry (as for the grouping code), emulator A/B against the Phase 2 matrix (same photos, Auto only), phone photos, and the synthetic emulator suite for regressions.
* Success: the blurred 4-label photo reaches 4/4 in Auto without Detailed or a typed count; no new wrong records; extra time only on flagged photos.

## 2. CSV export reliability (priority 4)
**Root cause (confirmed):** the system "Save as" dialog creates the empty file when Save is tapped; the app copies its temp file afterwards from memory-only fields. If Android ends the app in between, the restarted app has nothing to copy and does not know a save was pending: a 0-byte file and no message. The second, unexplained case (one empty file without a process change) stays open until the phone logs show it.
**Fix design:** persist the pending export (temp file path, target name) so a restarted app can finish or clean up; after every write check the size and warn on 0 or mismatch; when a save cannot be completed delete the empty document and tell the user to retry; clean stale temp files; apply to the folder export too.
**Trade-offs:** a few lines of state in `SharedPreferences`, a startup check; no format change. 
**Tests:** the automated scenario `07-export-interrupted` (kills the app during the dialog) turns green; cancellation, double tap, same-name and large-export scenarios stay green; on the phone repeat part 10 of the test plan.

## 3. Unknown-model recognition (priority 3) without inventing details
**Root cause:** the model is read only from the label's printed Model line. A crop that lacks that line is stored as "Unknown unit" even when the user's own records already contain the same TAC (first 8 IMEI digits, the model identifier) with a confirmed model. In the emulator data one of two unknown crops shares its TAC with another record that has a confirmed model (SM-A376B); the other TAC has no confirmed record, so it correctly stays unknown. The web side already learns TAC to model for display, but the stored record, native records and exports keep "Unknown" or blank.
**Proposed solution:** when the printed model is missing, fill the model from **the user's own confirmed records with the same TAC and a single consistent model**, and mark it as inferred (visible badge "model from TAC, confirm"; `modelSource: 'tac'`); never from a guessed or downloaded table, never when two models disagree, never for IMEI 2 only records. An inferred model counts as Needs review until confirmed. A user-confirmed value is stored as read.
**Trade-offs:** an inferred model could be wrong if one TAC is shared by two commercial models (rare; the single-consistent-model rule and the review flag cover it). Exports get the inferred model only after confirmation.
**Tests:** unit tests (consistent TAC, conflicting TACs, no TAC, IMEI 2 only), synthetic emulator flow with two labels of one model, one with the Model line cut off; phone photos for the unknown-model rate before and after.

## 4. Automatic second-pass recognition for uncertain results only (priority 3 in the request)
**Today:** an opt-in second pass exists (Detailed speed, or a photo that was scanned before and still needs a look). Evidence so far: 1 trigger in 13 labels, 0 hits, 2 s wasted.
**Design:** run a second pass automatically, and only for products that are uncertain by a defined rule, with a time budget:
| Signal | Second pass |
|---|---|
| Product without any IMEI 1 candidate | enlarged contrast re-read (existing), one attempt first |
| IMEI 1 candidate that fails the checksum | one enlarged re-read, then digit-voting repair against the first read |
| Completeness check says "label probably missing" | targeted region read (section 1) |
| Barcode and text disagree | re-read the barcode region only |
| Everything valid and consistent | nothing (no cost) |
Budget: at most one extra pass per uncertain product and a per-photo cap; the result is kept only if it passes the checksum and does not contradict a stronger reading; otherwise the product is flagged for review.
**Trade-offs:** adds time only on uncertain photos; the phone photo groups D, E, F decide whether each rule earns its cost. A rule with no measured hits is removed, not kept.
**Tests:** per-rule hit and miss counts on the phone set; timing with and without; the matrix of settings on identical photos.

## 5. Performance (priority 4)
**Profile (6 photos):** ML Kit full-photo read 35%, crop re-reads 29%, barcode scan 15%, tilt re-read 9%, rescue 8% (now opt-in), decode and save 4%.
**Candidates, each gated by an accuracy A/B on the labelled set:** reuse the full-photo lines for a crop when they already give a valid IMEI 1 and 2 (saves most of the 29%); skip the barcode scan when text already gives checksum-valid numbers for every label; limit tilt levelling to tilts that matter.
**Benchmark protocol (to make numbers comparable):** same photos, byte-distinct copies, test app cleared, then one warm-up scan, then 3 timed runs; record time, peak and idle PSS (`dumpsys meminfo`), failures, crashes, per-stage timings. Phase 2 baseline: 6 photos 10.1 to 10.3 s warm, 24 photos 55 s, peak 367 MB, 0 failures; Phase 1 reference 45 s and 358 MB.
**Memory:** peak 367 MB is close to what low-memory phones allow; any change that increases it needs a lower-memory phone test.

## 6. Issues from the real phone (priority 6)
Placeholder. Method when the results arrive: for every failure in `RESULTS-actions.csv` and every wrong row in `RESULTS-photos.csv`, collect the masked IMEIs, the diagnostics line (`IMEI-Lens/diag`, available through `adb logcat` or the report), the setting used and the time; sort into: detection (count, grouping), reading (OCR, blur, glare), model, export and sharing, performance, crash. Each gets a root cause with evidence before any fix is proposed.

## 7. Safety, compatibility and the installed app (priority 7)
* **Data:** all Phase 3 changes keep the additive schema: new optional fields only (`modelSource`, pending-export state); the archive keys from Phase 2 stay. Old files load; an older build ignores the new keys. No migration rewrites records.
* **Installed app:** the phone-test app has its own app id, so testing never touches the installed app. A future release to the real app must be signed with the same key as the installed one and keep `versionCode` increasing; this needs a separate decision.
* **Nothing is deleted:** the archive stays the only way records leave the list; the 57 originals, empty duplicates and repeated test records stay as they are until you approve a cleanup.
* **Existing features:** the emulator suite and the 53 JVM and 17 JS tests are the regression gate for each step.

## 8. Implementation order (each step ends with a stop for your review)
| Step | Content | Gate |
|---|---|---|
| 0 | Fix anything the phone test shows to be a data-safety bug first | your approval |
| 1 | CSV export reliability | scenario 07 green, phone part 10 repeated |
| 2 | Offline experiment for the completeness check (no app change), then Auto count | 4-label photo 4/4 in Auto, no new false records |
| 3 | Unknown-model inference with provenance | unit tests, emulator flow, phone unknown-model rate |
| 4 | Uncertain-only second pass (rules that earned their cost) | per-rule hits, timing budget |
| 5 | Performance candidates, one at a time | accuracy A/B unchanged, memory not higher |
| 6 | Benchmark against Phase 2 and the real-phone retest | report with before/after |

## 9. Risks
* Five labelled photos are too few to tune thresholds; the phone set must be split into a tuning part and a held-out part.
* Real-phone camera photos behave differently from the files used so far.
* Every extra read costs battery and time on the phone; budgets above must be checked there.
* Emulator results do not predict real memory pressure.

## 10. What I need from you
1. The real-phone results (the three sheets, masked) and any logs.
2. Approval of the plan or of changes to its order.
3. Decisions already open: cleanup of the old records, Git history exposure, and whether to ship anything beyond phone testing.
