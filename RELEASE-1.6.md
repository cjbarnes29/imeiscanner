# IMEI Lens 1.6

Changes since 1.5. The web app (GitHub Pages) has all of them; the Android app 1.6.0 has everything up to the Back-button navigation (see "Android" below).

## Reading
- **Counting devices first.** Each different readable IMEI 1 or serial is one device; repeats on tear-off strips, small misreads and numbers that fail the checksum never add devices. Labels are matched to devices along the direction the boxes are stacked, and stacked white boxes with no visible seam are cut between label groups. A box that is visible but unreadable still gets a record for review.
- **IMEI 2 and serial second reads.** The area right of each IMEI 1 is re-read enlarged and checked against IMEI 1's serial block (digits 9-14 are shared on Samsung labels): accepted, corrected when only that block was misread, otherwise left blank. The top-left of the label is re-read for the S/N.
- **Barcode confirmation** in every browser: exact IMEI and serial values replace OCR misreads; IMEI readings that disagree by 1-2 digits go to review.
- **Photo orientation.** Upside-down, sideways and mirrored photos are detected and read automatically: when nothing label-like is read, the scanner tries each orientation on a smaller copy and scans the best one. Tested on all four on a real two-box photo (the server scanner reads every number; the browser scanner reads both devices, IMEI 1 and serials). Costs about 6 to 8 extra seconds only for photos where nothing was read.

## Screen
- The full screen is as before (Upload photos, Export inventory and Scanned records, all visible, with the summary cards and quick navigation).
- Added: a Simple view that groups phones by series with phone name, IMEI, IMEI 2 and serial; a Rename button for each person; Move selected to; and the bulk tools Send numbers, Bulk edit and an always-available Bulk crop next to Share and Download all pictures.

## Speed
- **Parallel reading:** the crops of a photo are read on two workers at once (when the device has 4+ cores), in the browser and in the laptop scanner. Photos with several devices are 25-35% faster.
- **Dark labels:** a dark crop is read inverted from the start instead of wasting passes; in the browser a dark-looking photo is also read inverted first.
- **Engine bundled:** the text-reading engine, the language data (smaller, same accuracy on every test photo) and the fonts are served by the app itself instead of jsDelivr and Google Fonts: the first scan no longer downloads them (6.4 s to 4.3 s) and the app works offline once opened. They are copied into the build by `scripts/copy-ocr-assets.mjs`.
- **Storage:** the original photo is kept at up to 3200 px as a high-quality JPEG instead of the raw 3-5 MB phone file; about half the storage per photo (4.85 MB to 2.3 MB for a two-box photo).
- **Orientation check** probes at a smaller size and stops earlier.
- **Fixed:** Detailed mode could add a blank phantom record on dark photos; an unreadable label only counts as its own device when a separate box is visible for it.
- Measured on this PC with real photos (browser): single label 4.8 s to 4.4 s, two boxes 5.8 s to 4.9 s, four-box stack 9.8 s to 6.9 s, dark two-box 24.2 s to 19.7 s.

## Cropping
- **Draw all the boxes first, then process.** Enter the number of labels, draw every box (each stays numbered on the photo; Undo removes the last), then Process all reads them together and shows every result before saving.
- **Auto-detect** counts the labels and draws the boxes for you to check.
- **Bulk crop** (Scanned records): draw or auto-detect boxes photo by photo with nothing read, review the plan, then Process all.

## Export, sharing, files
- Default export is IMEI 1, IMEI 2, Serial, Picture and a Download picture link; saved as a normal folder (no ZIP). Excel links open a web page with Download, Copy and Share buttons.
- Picture files are named by number only (`1.jpg`, `2.jpg`, ...). **Download all pictures** saves them with a `numbers.txt`.
- **Share all** shares pictures 10 at a time, then all numbers as one numbered message; a copy-one-by-one list ticks each IMEI as you copy it.

## Navigation
- Back / swipe-back closes the popup you are in instead of leaving the app; popup headers stay pinned; a Top button on long pages.

## Tests and data
- `npm test` plus a local real-photo check (`scripts/scan-real-photos.mjs`, photos kept in the git-ignored `test-photos/`). Tests use made-up IMEIs and serials only.

## Android
- App 1.6.0 includes the reading, export, sharing and Back-button changes above. The crop changes (draw all boxes first, Auto-detect, Bulk crop) and photo-orientation detection are in the web app and need a new APK.

## Known limits
- Small barcodes on photos near 1000 px wide are often unreadable; use full-resolution photos.
- On rotated photos the browser scanner can miss an IMEI 2 that the upright photo gives.
- Picture links in Excel open pictures saved in the browser that scanned them.
