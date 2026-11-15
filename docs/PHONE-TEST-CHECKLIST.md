# IMEI Lens Test: phone test checklist (isolated build, 20 to 30 photos)

**What this build is.** `IMEI Lens Test` (app id `com.imeilens.scanner.phonetest`) installs NEXT TO your real IMEI Lens. It has its own empty data, its own name and icon label, and cannot read or change your real app or its records. Do not uninstall your real app. When the test is over, uninstall only "IMEI Lens Test".

**Keep private:** photos, exports and notes that show real IMEIs stay off GitHub, chat and email. When you report, use masked numbers (first 8 + last 4 digits).

## 0. Install
1. Copy `IMEI-Lens-Test-1.26.0-phonetest.apk` to the phone (USB or cloud). Check its SHA-256 against `.sha256` file if you like.
2. Allow "install unknown apps" for the app you open it with. Install. You will see two icons: "IMEI Lens" (real) and "IMEI Lens Test".
3. Open IMEI Lens Test. Allow notifications (needed for background scanning). Settings: Scan speed Standard, Products in each photo Auto.
4. Write down: phone model, Android version, and the date.

## 1. The photo set (20 to 30 photos)
Put them in one folder. Fill `PHONE-TEST-RESULTS.csv` (same folder as this file) while you test: one row per photo.
| Group | Photos | Why |
|---|---|---|
| A. Single label, sharp | 6 | baseline accuracy |
| B. Two products in one picture | 6 | multi-product splitting |
| C. Three or four products | 4 | counting, crops |
| D. Hard: blurry or out of focus | 3 | blurred labels |
| E. Hard: glare, dark, tilted over 10 degrees, label partly cut off | 3 | robustness |
| F. IMEI 1 unreadable or covered, IMEI 2 clear | 2 | IMEI 2 warning must appear |
| G. Same photo as another one (a copy, or a second shot of the same label) | 2 | duplicates, repeated scans |
| H. Photos you already know the answers for | at least 8 of the above | accuracy needs a truth |
Write the true IMEI 1 of every label in the CSV column `true_imei1` (this file stays on your phone or computer).

## 2. Tests (tick and note in the CSV or in notes)
| # | Area | Steps | Pass when |
|---|---|---|---|
| 1 | IMEI accuracy | Choose photos and scan all (Standard, Auto) | Per photo: devices found = devices real; IMEI 1 right. Record counts and mistakes. |
| 2 | Scan report | Show scan report | Numbers add up (products = saved + duplicates + repeats). Photos without IMEI offer "Scan N photos again". |
| 3 | Hard photos, second pass | Scan groups D and E again with Detailed speed, and use "Scan N photos again" | Compare with test 1. Note which photos only worked the second time, and how much slower it was. |
| 4 | Multiple products | Groups B and C | Each product has its own record and picture; models look right; unsure crops say Needs review. |
| 5 | Crops | Open a record with several products, Crop / edit photo, draw boxes, Save all, Check, apply | The original is archived, crops listed. Draw one box over a wrong place and check you can still Undo. |
| 6 | Undo / Restore | Tap Undo in the bar. Then View / restore, restore an archived original | Original comes back, its crops leave the list but stay in the archive. Nothing disappears. |
| 7 | Duplicates | Group G, then Archive duplicates, confirm, Undo; archive again and restore from View / restore; try Restore all duplicates | Duplicates are archived (never deleted), one copy of each IMEI stays, Undo and Restore work. |
| 8 | IMEI 2 warning | Group F | Record says Needs review with "IMEI 1 could not be read; the number shown is IMEI 2". Mark checked removes it. |
| 9 | Background queue | Queue 4 or more photos in the background, press Home, wait 2 to 3 minutes | A notification shows; reopening shows the queue finished; originals archived, crops linked. |
| 10 | Background scan | Scan 10 or more photos, lock the screen for 2 minutes | Finishes, no crash, no duplicate empty records on a repeat scan. |
| 11 | Camera | Scan with camera, Scan all, real label, bright and dim light | Shot read within a few seconds, record correct. |
| 12 | Export | Export CSV, then Excel with pictures | Row count = records shown; archived records are not in it; file opens. Watch for a 0-byte file (seen once on the emulator after cancelling a folder picker). |
| 13 | Sharing | Share numbers, share pictures, WhatsApp, Bluetooth | The share sheet opens and the other app gets pictures and numbers. |
| 14 | Persistence | Close the app from recents, reopen | Records, archive, settings still there. |
| 15 | Performance | Scan the 6 sharpest photos, then all 30; time them | Note total time, phone warmth, battery % used, any freeze. Reference (emulator, 6 photos): 17 to 19 s. |
| 16 | Isolation | Open your real IMEI Lens | Its records are exactly as before. |

## 3. Report back
* `PHONE-TEST-RESULTS.csv` with masked IMEIs only, plus: phone model, Android version, timings from test 15, screenshots of anything wrong.
* Anything that crashed, froze, showed a wrong IMEI as Valid, or lost a record or picture: top priority.

## 4. Afterwards
Uninstall "IMEI Lens Test" only. Your real app and its data are untouched.
