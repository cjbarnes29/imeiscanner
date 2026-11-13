# Coverage: what is automated and what still needs the real phone

Legend: **A** automated and verified on the emulator (synthetic photos), **P** partly automated, **M** manual / real phone only.
Results of the last run are in `e2e/reports/<time>/REPORT.md` (git-ignored). Numbers below were taken on 2026-11-13 on the `imei-api35` emulator (Android 15, x86_64) with the isolated test app.

| Area | Automated check | Level | What is NOT covered (needs the phone) |
|---|---|---|---|
| Launch, WebView content, tab navigation, screenshots | `00-smoke` | A | real device rendering, rotation, small screens |
| Android file picker: open, cancel, search, multi-select, confirm | `00-smoke`, every flow that scans | A | other gallery apps and the Google Photos picker |
| Gallery scan, accuracy of IMEI and model, multi-product split, duplicate photo, IMEI-2 fallback flag, scan report | `01-scan-gallery` + data check against `truth.json` | A | real photos, blur, glare, tilt, dark light |
| Records: filters, search by model and IMEI, Needs review list | `02-records` | A | very large lists (hundreds of records) |
| Crop Studio: draw boxes, save, archive of the original, linked crops, Undo | `03-crop-archive-undo` | A | touch precision of a human hand, pinch zoom, small boxes |
| Restore from the archive list (answers the native OK / Cancel confirmation) | `04-restore-from-archive-list` | A | wording and look of the native dialog on real phones |
| Duplicates: flagged, Archive duplicates, Undo | `05-duplicates-archive-undo` | A | Restore all duplicates (same confirmation as 04, not separately automated) |
| CSV export: save (non-empty, right rows), cancel | `06-export-csv` + file check | A | XLSX with pictures (folder picker), Word, Google Sheets file |
| CSV export while the app is ended during the Save dialog | `07-export-interrupted` | A (known failing) | the second, unexplained empty-file case |
| Share dialog contents | `08-share` | P | system share sheet, WhatsApp, Bluetooth, receiving app |
| Background scan (Home while scanning) | `09-background-scan` | A | screen off / doze, battery optimisation, long scans |
| Background crop queue | `10-background-queue` | A | process killed by low memory, many queued photos |
| Crash and ANR watch | logcat of every test | A | real-device vendor behaviour |
| Camera capture and Scan all | none | M | needs a real camera and real labels |
| Real accuracy, speed and memory | none (emulator numbers only) | M | the 20 to 30 photo phone test |
| Installing over the real app, signature, data compatibility | none | M | needs a release-signed build and a decision |

## What was run and the result
See the table in the final report of the automation setup; the live results are always in the newest `REPORT.md`.

## Not in CI (on purpose)
The emulator workflow is not added to GitHub Actions: the tooling (PowerShell runner, `adb.exe`, `cmd`) is Windows-specific, GitHub's Windows runners cannot run a hardware-accelerated emulator, and the system picker flows were tuned on one emulator image. Porting to Linux (bash runner, KVM emulator action) is possible and listed in `README.md`; it should wait until the suite has been stable for several consecutive runs.
