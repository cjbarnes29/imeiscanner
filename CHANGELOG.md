# Changelog

What changed in each Android app / web release since 1.7. The web and the Android app are the same build; every version below was published together. Older notes: [1.6](RELEASE-1.6.md), [1.5](RELEASE-1.5.md), [1.4](RELEASE-1.4.md).

## 1.25.0 — the crop queue keeps working when the app is minimized (Android)
**Android code changed (new APK).**
- While the background crop queue runs, the app shows an ongoing notification ("IMEI Lens is cropping photos · 3 of 12 done", progress bar, tap to open, **Pause**) and holds a wake lock, so Android does not stop it when you minimize the app or the screen turns off (new `QueueService`, foreground service of type media processing; bridge `queueStatus` / `queueStopRequested`). Pause in the notification pauses the queue; *Continue* in the app banner resumes it.
- The queue is still saved on the phone and offered for resuming if Android stops the app anyway.
- **Not verified:** this needs a physical phone (no phone or emulator here): the code compiles and the manifest/bridge are in the APK, but how long a given phone keeps the page running while minimized is untested; some makers' battery savers kill apps regardless (set IMEI Lens to "unrestricted" battery use). The page itself may run slower while minimized.
- **Next step (planned):** move cropping and reading into the phone's own scanner (like *Choose photos and scan*), which survives minimizing, locking and closing without any of these caveats.
## 1.24.0 — background crop queue, faster Crop Studio start, responsive Save all
- **Background crop queue (Bulk crop or Crop photo):** *Queue this photo & next →* sends the photo you just boxed to a queue and opens the next one; *Queue all in background (N)* queues every photo (photos with no boxes are cut automatically). The editor closes at once and the queue is read one photo at a time while you keep using the app. A banner shows "n of N done" with Pause / Continue and Cancel. Each original is replaced only after its crops were read; crops that are not certain are flagged, and a **Review N** button opens just those. A photo with no separate products found is left as it is (counted in the banner).
- **The queue survives closing the app:** record ids and box positions are kept on the phone; after a restart a banner offers **Resume** or **Discard** (it never starts reading silently). The queue runs on the page, so it pauses when the app is closed or in the background; the photo being read at that moment starts again.
- The Bulk crop list is fixed while the editor is open, so background replacements cannot shift it under you.
- **Why Save all felt slow and unresponsive:** the text reader (about 10 MB) was started only after tapping Save all, and several steps (cutting, straightening, barcode decoding, picture treatments) ran on the page's own thread back to back. The reader now starts when the editor opens, and the page yields between heavy steps.
- Tests: `scripts/test-crop-queue.mjs` (in `npm test`, now 14 suites) and `scripts/e2e-queue.mjs` (browser: queue all, editor closes at once, 3 photos read in the background, originals replaced, single photo kept, resume offer, discard).
- **Not verified:** not run on a physical phone; browser timing only.
## 1.23.0 — multi-product detection rebuilt around measured accuracy (web and Android)
**Why products were missed (root causes, found by measuring):** (1) the decision to "look closer" depended on the product count from the first whole-photo read, which is weakest exactly on photos with many labels (a 5-box stack: 0 of 5 IMEIs found, one record); (2) closer reads were cut from a shrunken copy; (3) the box-edge planner returned nothing when any seam was unclear, and could not handle two columns of boxes, so the whole photo became one record; (4) Crop Studio's Auto-detect was a second, weaker pipeline; (5) IMEI 2 from a neighbouring box could be attached to a product.
- **One look-closer stage for every source** (`lookCloser`): used by camera shots, uploads and Auto-detect. The product count also comes from the IMEI barcodes (two per label), the Model lines and the text size, not only the first read. Closer reads are tiles of the full-resolution photo (`gridTileRects`), up to 12 tiles.
- **Separation from label lines** (`src/seed-layout.ts`): one "Model : SM-…" line per product is a seed; seeds are split into columns (cut where the picture is emptiest), then rows between one label's last line and the next seed. Works for stacks, side by side and grids. Gives nothing rather than cut through text. Repeated labels on one box (main, "A", "B") stay one product; repeated IMEI rows are removed as before.
- **Phone-scanner photos get the web pipeline too:** a photo the background scanner could not split (one flagged record, several products) is re-read automatically after the scan with the same stages; the original record is replaced only when two or more crops were made and read. The review prompt has **Split automatically** and **Crop each myself**.
- **No field mixing:** IMEI 2 is kept only if it passes the checksum and, on Samsung labels, shares the six serial digits with IMEI 1. A photo with fewer products separated than counted flags every record for review.
- **Products in each photo / Scan speed** apply to camera and uploads (and to the phone scanner since 1.22).
- **Measured accuracy** (new `scripts/make-composites.mjs` + `scripts/eval-labeled.mjs`, real labeled label photos cut and stacked into 1/2/4/5/10/12-product photos with blur, glare, overlap and cut-off variants; 13 photos, 56 known IMEI 1): before 32% found; after **70% (Standard, Auto), 71% (count chosen), 70% (Detailed), 32% (Fast, by design: one pass)**. Per photo (Auto): 1 product 1/1; 2 products 2/2; 4 products 3/4; 5 products 4/5; 10 products 9/10; 12 products 9/12; light blur 2/4 and 1/2; glare 4/4; overlap 4/5; cut-off 1/1. Phone-scanner path (flagged photo split by the web stage): 10 → 9/10, 12 → 9/12. Fields mixed between products: **0**. Misread IMEIs that pass the checksum and are not on the label: 1–2 across the suite, always flagged for review.
- **Unit tests:** `scripts/test-seed-layout.mjs` (stacked, repeated lines, 2×3 grid with joined lines, side by side, tile grids, IMEI 2 pairing); `npm test` now 13 suites.
- **Known limits:** blur at sigma ≥ 2.2 is not read (flagged, not guessed): 0 of 6; an IMEI printed small and partly hidden at the top of a stack is the most common miss; (fixed in this release: Samsung serials never contain the letter O, so an O read is turned into 0; wrong serials in the labeled photos dropped from about a third to 1 of 24); a box whose Model line is not read merges into the box above (its numbers then appear as a flagged mix, never a silent one); the photos are composites of real labels, not physical 10-box shots; the native (Java) scanner and the phone itself were not run: no phone or emulator is available, so the Android timings are unmeasured (browser: 2–40 s per photo).
## 1.22.0 — one review sheet that fits, settings that apply everywhere, faster editing (web and Android)
**Android code changed (new APK):** background scanner settings, rotation no longer reloads the page.
- **Review sheet rebuilt.** The old sheet had a photo and a floating button panel that together covered about half the screen, so fields overlapped ("= Galaxy A57 5G" ran into the Serial label; IMEI 1 sat beside its box; the model name was cut off). Now: header, a scrolling body and a footer that sits below it (never on top). The photo is a compact preview (tap it to enlarge; *Zoom to label / Show full photo* and *Crop / edit photo* beside it). Five fields stacked with labels above (model, S/N, IMEI 1, IMEI 2, person); photo actions (Copy IMEI, Photo, Rotate left/right, Straighten) in one tidy row; footer: ← Previous · n of N · Next → / **Finish ✓**, then Save · Save & next. Leaving with unsaved changes still asks (Save all / Discard changes / Keep editing); delete still asks first.
- **Editing no longer freezes.** Root causes found: every keystroke re-rendered the whole 4,700-line page; the model picker re-sorted and drew every Samsung model on each render (and each time it opened); the phone decoded the full-size original while the review screen was opening. Fixes: text boxes keep their own text and update the page at low priority; the model list is built only when its content changes and shows 60 at a time (search or *Show more*); the original is loaded after the sheet is drawn and skipped if you move on.
- **Scan speed and Products in each photo now apply to *Choose photos and scan* (background) as well as the camera.** Both are remembered between sessions. Products in each photo goes to 12 in the phone's scanner too (tile plans for 7–12). Fewer products than expected are flagged for review ("1 device or N?") instead of being saved as one phone; in Auto, valid IMEI barcodes (two per label) also count as a hint.
- **Rotating the phone no longer reloads the app** (the Android activity handled rotation by restarting the page, which lost an unsaved edit). Added `configChanges` to the manifest.
- **Samsung names:** the model list no longer shows a storage size from the catalog ("Galaxy A57 5G 128GB (Unlocked)") for a phone whose label says 256 GB; the built-in name wins and catalog names are stripped of storage and carrier, as the records list already did.
- **IMEI paste:** pasting an IMEI with spaces or dashes ("350 357 925 907 537") was cut at 15 *characters*; it now keeps the first 15 digits.
- **Crop Studio:** Redo (Ctrl+Y / Ctrl+Shift+Z) next to Undo.
- **Tests:** new `scripts/e2e-review.mjs` (9 checks at phone size, with screenshots); `e2e-studio.mjs` now 11 checks (Redo). `npm test` unchanged and passing.
- **Not verified / still open:** nothing was run on a physical phone or emulator (none available on the build machine), so the native scanner changes compile and are code-reviewed but not measured; the layout was verified in headless Edge at 412×860. A crop that picks up the neighbouring label's IMEI 2 as IMEI 1 (seen in a screenshot of three stacked boxes) could not be reproduced without that photo and is not fixed; such records keep their review flag. Serial O/0 lookalikes (R5GL80LDKFM vs R5GL8OLDKFM) cannot be decided from the text alone and stay editable. The APK is debug-signed.
## 1.21.0 — camera advice, label counting, one crop editor (web and Android)
This release ships the web changes of 1.20.0 (Crop Studio, drafts, exit confirmation, OCR retry and IMEI repair) together with the Android app. **No new native (Java) code: the Android scanner is the one from 1.19.1.**
- **Camera that tells you what is wrong:** the camera screen measures sharpness, glare and darkness on a small copy of each frame (about 1.4 times a second) and shows advice (Sharp and clear / A little soft / Blurry / Glare / Too dark). The thresholds come from real label photos: readable photos score 250–830, blurred copies 2–10. After each shot the same check runs, followed by the count of readable IMEI barcodes.
- **Tap to focus:** tap the label on the camera screen; a ring shows where. It uses the camera's point-of-interest focus where the phone allows it and says so when it does not.
- **Better count of the products in a photo:** the label count also uses the S/N, storage (4GB | 128GB) and long model-code lines, so one misread “Model :” line no longer hides a label. *Products in each photo* now goes up to 12.
- **No quiet misses:** a photo that shows several labels but could not be split is flagged for review (“1 device or N?”) instead of being saved as one phone.
- **Unknown models:** after a scan the message tells you how many models are not in the catalog and sends you to the Unknown tab to confirm the names (kept as your own models, also after catalog updates).
- **Tests in a real browser** (not part of `npm test`, need Edge/Chrome and `npm run build`): `scripts/e2e-studio.mjs` (Crop Studio, 10 checks), `scripts/e2e-camera.mjs` (live advice, tap-to-focus and shot check with a real photo as the camera feed), `scripts/e2e-scan.mjs` (the real scan on photos in `test-photos`, with an accuracy summary), `scripts/eval-frame-quality.mjs` (the blur/dark thresholds on real photos).
- **Not done / not verified:** OpenCV and perspective (keystone) correction were not added: the ML Kit and in-app image treatments already cover tilt, and OpenCV would add tens of MB that could not be tested without a phone. Native Android camera (CameraX) was not added: the in-app camera runs in the WebView. Nothing was run on a physical phone or an Android emulator (none available on the build machine); measured numbers come from a desktop browser. One known weakness: the IMEI repair step can produce a checksum-valid IMEI 2 that is not what the label says; those records are flagged for review.

## 1.20.0 — Crop Studio, safer IMEI reading, drafts (web app only; the APK is not rebuilt)
- **Crop Studio:** one compact editor (full screen on phones, a popup on desktop). Draw a box per label; the count in the header is the number of boxes, there is no count step. Move, resize (corner handles), delete (×), Select several / Select all, Undo, zoom (1×–4×) and Pan. **Auto-detect** adds boxes it finds (it never doubles a box you already have, and it now levels tilted photos first).
- **Many photos at once:** thumbnail strip, **Save all (N crops, M photos)** and **Save for later**. Boxes are saved as a draft on this phone/computer; a banner offers **Resume** or **Discard** after a reload.
- **Exit confirmation:** closing with unsaved work asks **Save for later / Discard / Continue editing**. The Back button does the same.
- **Original removed after a crop:** each crop becomes its own record with its own IMEI, serial, model and the same person. The full photo is not copied into the crops and its stored copy is released. The check screen warns before this happens. Your gallery is never touched.
- **No mixing between products:** every box is read on its own; the model is taken from the crop's own text first, and an old record's IMEI/serial is only inherited for a single-product, single-crop split. The same IMEI found in two boxes is flagged.
- **More accurate reading:** extra picture treatments (contrast, sharpening, even light, black/white, inverted) in several passes; Luhn check on every IMEI; lookalike letters (O/0, I/1, S/5, B/8…) repaired; digits voted across passes; a repaired number is only accepted when exactly one fix matches a known model prefix, and is still flagged. Weak labels are read again automatically (up to 4 passes) and, when still uncertain, shown with a ⚠ and “Did you mean” choices for manual review. Nothing is guessed silently.
- **Build fix:** the OCR engine files are copied into the build again (they were missing from published builds since 1.19).
- **Known limits:** very blurry + tilted + low-contrast photos may need manual typing (they are flagged, not guessed); the Android app still keeps its native copy until the next APK; tests use generated photos, not a physical camera.

## 1.19.1 — the background scanner looks closer for missed products
- **Choose photos and scan** counts the "Model : SM-…" labels it can see. When that is more than the products it found, it reads the photo again in overlapping pieces (halves, thirds, 2×2 or 3×2) and separates the products again. The same idea as the in-app scanner's tiled re-read.
- Sharing: the *Share {person}* pop-up and the Share tab both stay (the pop-up is for hand-picked selections, the Share tab for whole people).

## 1.19.0 — the background scanner reads barcodes and levels tilted photos
- **Choose photos and scan** (the Android background scanner) now reads the label barcodes (ML Kit barcode scanning, on the phone). Each barcode is paired with the "IMEI 1" / "IMEI 2" text printed under it; when exactly one fits, its exact number is used, so OCR misreads of IMEI 1 are corrected. Barcode-confirmed records show it in the confidence score.
- **Tilted photos are levelled** before the products are separated (angle of the text lines, 2–20°). The levelled photo is kept only if the text really became straighter and nothing was lost.
- **Model codes edited in the records list** now teach the learning too (when you leave the field), not only review saves.
- The app is about 9 MB larger (25.8 → 35.2 MB) because the barcode reader bundles its model so it works offline.

## 1.18.1 — audit: one scan path, one catalog, consistent duplicates
- **One way to scan gallery photos in the Android app:** *Choose photos and scan* (the phone's own text reader, keeps running in the background). The browser drop zone and *Quick scan … while open* are gone from the app; the website keeps its browser upload. Simple mode's *Choose photos* now uses the same background scan on Android (it used the browser scanner before). Photos left in the queue after a failed camera scan still show with a scan button.
- **Samsung catalog in one place:** the catalog panel moved from the scan screen into **Settings → Downloaded Samsung catalog → Official product details**. It no longer downloads the catalog a second time when the app opens, and its name box (a duplicate of Check catalog's edit) is gone. Both use one download routine.
- **Duplicates use one rule everywhere:** editing an IMEI in the records list or saving in review now warns when the IMEI exists in *any* earlier scan, matching the Duplicate flag and Remove duplicates (before, only the same upload or the latest batch was checked).
- **Background scans learn too:** model corrections and repeated model references now also apply to results from *Choose photos and scan*.
- Removed unused code (an old IMEI reader, unused share/section helpers, an unused Google sign-in helper, a scan-time text region that was computed and never used, a model-series count recalculated on every screen update).
- New regression tests for duplicates across scans.

## 1.18.0 — confidence score, learning from corrections
- **Confidence score** for every record (0–100, high / medium / low) shown at the top of the review window; hover for the reasons (checksum valid, barcode confirmed, IMEI 2, serial, catalog match, crop, duplicate). A record with no IMEI never scores above 45.
- **Learns from verified corrections:** when you change a model code in review (for example a misread `SM-A1O5F` to `SM-A165F`), the same misread is fixed automatically in later scans on this phone.
- **Repeated model references:** an unverified model code that is one character away from a code seen on at least two other phones is corrected to it. Models already named from the Samsung catalog are never changed.
- Fixed: a misread model code with a letter where a digit belongs was not recognised as a code.
- New automated tests for the score and the learning.

## 1.17.1 — sideways and tilted multi-product photos
- **Orientation check** now runs whenever the first read is weak (not only when nothing is read) and turns the photo only when another angle clearly reads better. Sideways photos with stray digits are no longer left sideways.
- **The whole photo is levelled** (tilt of about 2.5° or more) before the products are located, not only the crops afterwards.
- **Automatic product count:** with *Products in each photo* on Auto, the number of “Model : SM-…” lines is used as the expected count, so photos with several labels are re-read in enlarged tiles.
- Measuring scripts for real photos in `test-photos` (`scripts/eval-multi-*.mjs`, not part of `npm test`); more tests for the new decisions.

## 1.17.0 — better detection of several products in one photo
- **Scan → Products in each photo** (Auto, 1–6). When fewer products are found than you chose, the photo is read again in overlapping, enlarged tiles (text and barcodes) and the results are merged, then split again. Photos that still come up short are counted in the finished message; ones that cannot be split are marked for review with the expected count.
- **Automatic straightening:** every crop is levelled (tilt of about 1–15° is detected from the text lines and undone) before it is read and saved.
- **Review → Straighten** button levels the whole photo and its crop.
- **Camera check:** after each shot the camera says how many IMEI barcodes were readable and warns when fewer than the expected products are readable.
- New automated test for tilt estimation, tile plans and merging.

## 1.16.0 — welcome, tutorials, steadier review
- **First launch / new version:** a dialog shows the features and improvements once. It is also in **Settings → Help → What’s new**.
- **Tutorials** for everything (scanning, camera, review, crop, people, unknown models, WhatsApp/Bluetooth, One by one, save and export, duplicates, settings, reset) in **Settings → Help → Tutorials**.
- Credit now reads **Carlou Joseph Barnes**, with a troll picture, in the welcome dialog and Settings.
- **Review window:** the picture stays fixed at the top while you scroll. The typing section (model, serial, IMEI 1) and a second group (person, IMEI 2) fold up and down.

## 1.15.1 — cleaner review
- Removed the Samsung Promoter note and link from the review window (More details).

## 1.15.0 — remove duplicates
- **Duplicates are now found across all scans**, not only the latest batch: any 15-digit IMEI that appears more than once is flagged.
- New **Duplicates** filter chip (with a count) and a **Remove duplicates** button next to the status filters. It asks first, keeps **one copy of every IMEI** (the most complete: serial, known model, valid, saved crop, then the earliest) and deletes the rest with their pictures. **Undo** is offered for a few seconds.

## 1.14.1 — one tap in One by one
- **One by one:** the main button is now **Download image + copy IMEI & next**. One tap saves the picture, copies IMEI 1 and goes to the next phone. The separate Copy IMEI button is gone; Copy S/N stays.

## 1.14.0 — clean pictures, text size
- Pictures sent or saved (WhatsApp, Bluetooth, Save to my phone, One by one) have **no text written on them**. They are resized to 1600 px and sharpened with a little extra contrast. The numbers stay in the caption and `numbers.txt`.
- The tick-box *Also write the IMEI / serial on each picture* is gone.
- Scanning and review: the Zoom/Full photo button, the camera countdown and the thumbnail remove buttons no longer sit on top of pictures; the photo area is taller and clearer.
- **Settings → Text size**: Small, Normal, Large, Extra large, remembered on the phone.

## 1.13.0 — choose the save folder once
- **One by one** and **Save to my phone** ask for a folder **once** (Android keeps the permission) and then save without asking, into `IMEI-<person>` inside it.
- Saving again **replaces** the earlier numbered pictures and `numbers.txt` automatically. Saving only "the rest" keeps the pictures already saved; `numbers.txt` always lists every phone.
- **Settings → Where files are saved** shows the folder, with Change folder and Forget this folder.

## 1.12.2 — faster, more reliable sending
- A send that was started and never finished no longer blocks the next one (the app used to refuse with "finish the current save").
- Pictures are shared as images (`image/*`) instead of "any file".
- Pictures go to the app as their own data in large pieces; the button shows *Preparing 8 of 40…* then *Sending 28 of 40…*.
- Writing the IMEI/serial on every picture is now off by default (it was the slow part; the caption carries the numbers) and stays available as a tick-box.

## 1.12.1 — Settings always reachable, one build everywhere
- On phones about 360 px wide and under, the header pushed **Settings** off the screen. The logo text now hides first and the buttons shrink.
- **Reset** is always available (it also clears results the app still has saved).
- Settings shows `Version X (commit) · Web / Android app`, written by the build, so the website and the app can be compared.
- Downloads are numbered in picture order with the IMEI: `001-352099001761002.jpg`. Saving the rest keeps each picture's place in the whole list.
- CI fix: the catalog lookup now reads its stored lists safely.

## 1.12.0 — one send, one caption; one by one; save to my phone
- **WhatsApp:** all pictures in one send with **one caption** listing every IMEI and serial once, in picture order. Over 30 pictures the app asks how many arrived and continues from there.
- **One by one** (per person): large picture and numbers, Copy IMEI / S/N, Download & next, Back, Skip, remembered position, Download all remaining.
- **Save to my phone** (per person): a folder with the pictures and a `numbers.txt`.

## 1.11.0 — Bluetooth fallback, review drafts
- The app checks whether WhatsApp is installed and works; if not (or WhatsApp took fewer pictures than sent) a pop-up offers **Bluetooth**, which sends the pictures with IMEI/serial written on them plus `numbers.txt`.
- Review: changes are kept while you move between pictures; after the last picture (or on close) a pop-up asks **Save all / Discard / Keep editing**.
- Review: every button is in **one floating bar**; warnings (bad IMEI, duplicate, checksum, failed send) **pop up** with OK.

## 1.10.x — built for 1000 photos
- **1.10.0:** batches up to **1000 photos**. The page reads the scan in slices, so 1000 records load in seconds. Saved pictures are kept at 1800 px. **Settings → What this app can handle** lists what works, what has a limit and what is not possible, with estimates for this phone. Excel/Word warn before too many pictures go inside one file. Long text goes through the phone's share menu.
- **1.10.1:** the **Unknown** tab lists the phones under each unknown model, with suggestions (misread code, similar models), fix-the-code and pick-the-model-for-all. **Settings → Check catalog** opens the downloaded Samsung catalog in a big dialog (search, edit, delete, add, restore; kept across catalog updates). The review question floats above the Save bar. Credit line *by CJB*.

## 1.9.x — adaptive speed, Unknown, sharing
- **1.9.0:** adaptive scan speed with **Auto / Turbo / Balanced / Safe**, the phone is measured (cores, memory, heat, battery saver); scanning several photos at once; the first OCR pass is reused (no double reading); results are saved in batches. **Reset** button. **Unknown** tab. Bluetooth / nearby share.
- **1.9.3:** device model drop-down with catalog and **add a model**; sideways or upside-down photos are retried at 90°/270°/180°; the preview opens on the phone box.
- **1.9.4:** model chooser in a big dialog; **Check models** dialog in Settings.
- **1.9.5:** share photos **from other apps into IMEI Lens**; scanning starts automatically.

## 1.8.0 and 1.7.0
- Compact header on phones, launcher icon, Android 15 edge-to-edge handling, release build settings. Review preview opens zoomed on the label. Settings gained Scan speed and bulk model names.
