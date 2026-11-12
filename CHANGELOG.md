# Changelog

What changed in each Android app / web release since 1.7. The web and the Android app are the same build; every version below was published together. Older notes: [1.6](RELEASE-1.6.md), [1.5](RELEASE-1.5.md), [1.4](RELEASE-1.4.md).

## 1.19.0 — the background scanner reads barcodes and levels tilted photos
- **Choose photos and scan** (the Android background scanner) now reads the label barcodes (ML Kit barcode scanning, on the phone). Each barcode is paired with the "IMEI 1" / "IMEI 2" text printed under it; when exactly one fits, its exact number is used, so OCR misreads of IMEI 1 are corrected. Barcode-confirmed records show it in the confidence score.
- **Tilted photos are levelled** before the products are separated (angle of the text lines, 2–20°). The levelled photo is kept only if the text really became straighter and nothing was lost.
- **Model codes edited in the records list** now teach the learning too (when you leave the field), not only review saves.
- The app is about 2–3 MB larger because of the barcode reader.

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
