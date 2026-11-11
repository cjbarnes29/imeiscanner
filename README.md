# IMEI Lens — Photo Scanner

What changed in each version: [RELEASE-1.6.md](RELEASE-1.6.md), [RELEASE-1.5.md](RELEASE-1.5.md), [RELEASE-1.4.md](RELEASE-1.4.md).

An inventory scanner for phone-label photos. Regular OCR runs in the browser. Optional laptop background scanning keeps processing after the browser closes, provided the laptop stays powered on and awake.

## Free Android app for scanning after closing the screen

Install the Android APK from the [latest Android release](https://github.com/cjbarnes29/imeiscanner/releases). Open **IMEI Lens**, then choose **Scan on this phone in the background** and select up to 500 photos. Keep the scan notification enabled. The phone saves progress after each photo and shows the cropped records when you reopen the app. Use **Stop scan** in the app or notification to stop it. Exports use Android's save-file picker. Photos and IMEIs remain on the phone; no laptop, paid server, or Google authorization is needed. The GitHub Pages website remains available for browser-only scanning.

Android may pause and retry queued work when it restricts background activity, and force-stopping the app in phone settings prevents work until the app is opened again. Android 15 also limits `mediaProcessing` foreground services to six hours in a 24-hour period. This APK is a debug-signed preview; later APKs may require uninstalling it before installation, which erases its local records. Export important records first. A phone test is still needed to validate scanning on your device.

## The simple interface
The app is one short screen with two sections.
1. **Scan phones**: **Take photos** (camera) or **Choose photos**. Scanning starts by itself and works the same on a phone and on a computer. There is no separate upload queue, scan-speed menu or background-scan panel.
2. **Phones**: every scanned phone, grouped under its series (for example *S26 series*, *S25 series*, *Fold series*), each showing the phone name, IMEI, IMEI 2 and serial with a Copy button for each, instead of a model code.
   - **People:** *Everyone* plus one button per person. The pencil renames a person; **+ Person** adds one and opens its name box. Move phones in three ways: the person menu on each row, **Move selected to** in the toolbar (tick phones first), or the Person menu in the photo review window.
   - **Bulk actions** (their own labelled row; they apply to the ticked phones, or to everything shown when none are ticked): **Bulk share** (pictures 10 at a time, then all numbers as one message), **Send numbers** (one numbered message with IMEI, IMEI 2 and serial, straight to the share menu or copied), **Bulk edit** (set the model code, move to a person, mark as checked for many phones at once) and **Bulk crop** (draw or auto-detect boxes on many photos, then process them together).
   - **One-tap actions:** **Export Excel** (the ticked phones, or all), **Download pictures**, **Share**, **Delete**, and **Fix photos** (bulk crop) when some photos need it.
   - Phone names come from the Samsung catalog first, then from Samsung's model-number rules; a phone whose model code could not be read borrows the name of another scanned phone with the same first 8 IMEI digits.

Everything else is still available, collapsed so the main screen stays simple:
- **More scan options** (under Scan phones): scan speed (Fast / Standard / Detailed), the photo queue with drop zone, laptop and background scanning, the Android background scan, and the Samsung catalog.
- **More export options** (under the action buttons): Excel, Word, Google Sheets or CSV, what to include, which records, and the choose-records list.
- **Detailed table view**: the full table with model code, picture ID and validation columns, plus model filter chips.
- **More for this phone** (on every phone): edit IMEI, serial and model code in place, copy the model code or the whole record, download the photo, share the photo and number, and edit or crop the photo.
- Summary cards at the top: scanned records, valid IMEI, needs review, models.

## Features
- Bulk image upload with browser OCR or a laptop background scan queue.
- IMEI extraction prioritizes a readable `IMEI 1`, then a readable `IMEI 2` from the same picture. Ambiguous or unreadable numbers are left for review. Records store **IMEI 1, IMEI 2 and serial number**; all three are editable in the review window.
- **Barcode confirmation.** Every photo is also read for Code 128 barcodes (zxing-wasm, bundled with the app, works in every browser including iPhone Safari). A barcode value that matches what OCR read on its label replaces misread digits, and serial numbers are confirmed from the S/N barcode. Barcode-confirmed numbers outrank OCR.
- **Misread guard.** If OCR reads the same IMEI twice and the readings differ by 1-2 digits, the record is marked **Needs review** even when the checksum passes.
- Recognised serial labels: `S/N`, `SN`, `Serial`, `Serial No`, `Serial Number`. A bare `IMEI:` label (no 1 or 2) is accepted when exactly one number passes Luhn.
- **Multiple devices in one photo.** Device labels are grouped with OCR text positions, barcode positions and visible sticker/box edges. A line holding several labels (`IMEI 1: ... IMEI 2: ...`) is split per label. Grouping distance scales with the printed text size. Uncertain splits are not cut blindly: the record asks **"Is this 1 device or N?"** and offers one record or the crop tool with N prefilled. Crops can be adjusted manually.
- The Android scanner frames each separated box using a visible seam between labels and keeps the full width or height of that box face. If it cannot find a reliable seam, it keeps the full photo as one review record for manual splitting instead of saving a cut-off label. The review editor loads the original photo and saves manually selected crops even when automatic text reading fails.
- Review a photo to rotate it, draw crops by touch or mouse, and enter an unreadable IMEI manually. Guided cropping can replace one review record with several separate records: enter how many labels there are (for example 2), draw all the boxes first (each stays numbered on the photo; **Undo** removes the last one), then tap **Process all** to read them together and review every result before saving. **Auto-detect** counts the labels in the photo and draws the numbered boxes for you to check. **Bulk crop** (in *Scanned records*) handles every record that needs cropping in two stages: draw (or auto-detect) the boxes photo by photo with nothing read, review the plan, then **Process all** reads every photo together and replaces the records.
- Luhn checksum validation.
- Each new upload skips exact copies of a photo and removes later rows with the same readable 15-digit IMEI within that upload. Rows without a readable IMEI remain for review. Older saved uploads are not compared or deleted.
- Manual exports only; scanning does not start downloads automatically.
- Numbered photos, selected-only downloads, and image names matched to the `#3`-starting record numbers.
- **Default export: IMEI + picture with download button.** Every format uses columns **IMEI 1, IMEI 2, Serial** (blank when not detected), with no person, validation or status columns. Excel adds **Picture** and **Download picture**. Word adds the picture. CSV and Google Sheets (imported from Excel) are numbers only, one tab. The older layouts (IMEI and model, or with person and photos) remain in the *Information to include* menu.
- **No ZIP.** The Excel file and the picture files are saved as normal files in one folder: the Android app and Chrome/Edge on a computer ask you to pick a location and create `IMEI pictures <date time>` inside it; other browsers download the workbook and pictures together into Downloads.
- **Download picture links on phones.** Excel for Android and iOS cannot open links to files on the phone (Chrome shows an error). When exported from the website, each link is `https://<site>/#picture=<id>`; opening it shows that picture from this browser's saved records with **Download picture** and **Share picture** buttons. It works on the phone and browser that scanned the photos. The Android app and desktop Excel use the local picture file beside the workbook instead. Excel desktop also offers **Save as Picture** on the embedded image.
- Person groups with editable names, per-record assignment, and person tabs in Excel/Google Sheets.
- Photo exports can save the report, photo gallery HTML, and record photos to a folder when the browser supports folder selection. Other browsers provide separate downloads for the report, the self-contained HTML gallery, and each photo. Split records use the cropped picture.
- **Photo orientation.** A photo taken upside down, sideways or mirrored is read automatically: when nothing label-like is read, the scanner tries each orientation on a smaller copy and scans the best one (about 6 to 8 extra seconds, only for photos where nothing was read). The review window still has **Rotate** buttons for manual fixes.
- **Counting devices first.** A device has one IMEI 1, one IMEI 2 and one serial, so each different readable IMEI 1 (or serial) is a device; repeats of the same number on tear-off strips, small misreads and numbers that fail the checksum never add devices. Labels are matched to devices along the direction the boxes are stacked. Stacked white boxes with no visible seam are cut halfway between one device's labels and the next. A box that is visible but unreadable still gets its own record for review.
- **IMEI 2 and serial second reads.** When IMEI 2 is missing, the area right of each IMEI 1 line is re-read enlarged; Samsung prints the same six serial digits (positions 9-14) in IMEI 1 and IMEI 2, so a reading is accepted when it matches that block, corrected when only that block was misread, and left blank otherwise. When the serial is missing, the top-left of the label (where Samsung prints S/N) is re-read on its own.
- **Test data.** Tests use made-up IMEIs and serials only. Real label photos stay in the git-ignored `test-photos/` folder.
- **Speed and offline use.** Crops of one photo are read on two workers in parallel (4+ cores); dark labels are read inverted from the start; the reading engine, language data and fonts are bundled with the app (no CDN, works offline once opened; copied at build time by `scripts/copy-ocr-assets.mjs`); the stored original photo is capped at 3200 px.
- **Navigation.** The Back button / swipe-back (browser and Android app) closes the popup you are in (review, crop editor, share, camera) instead of leaving the app; it closes only the top popup, and the camera still asks before discarding unscanned photos. Popup headers with Close stay pinned while the content scrolls, and a floating **Top** button returns to the start of a long list.
- Best-effort device model classification from OCR text and filenames; unknown models can be edited.
- Original photo retained with each record; click the thumbnail to inspect the image and raw OCR text.
- Scanned records offers detailed and simple views, a model filter, and per-record deletion from the review window. Uploads can be stopped; a browser scan finishes its current photo and leaves unprocessed photos queued.
- Samsung labels with an `SM-` model code record the next five characters, such as `SM-A075F`, when OCR can read them.
- The in-app photo viewer and self-contained offline HTML gallery keep their controls in place when moving between differently sized pictures. The HTML gallery can view, download, and copy the IMEI for each cropped picture.
- Editable model and IMEI values; records recalculate validation and duplicate state.
- The older Excel/Google Sheets layouts include an all-records tab, model tabs, and person tabs; the default IMEI + picture layout is one sheet.
- **Bulk download.** **Download all pictures (N)** in *Scanned records* saves every ticked record (or every visible record when none is ticked, up to 500) as numbered files `1.jpg`, `2.jpg`, `3.jpg`, ... (numbers only, no IMEI or other text in the file name) plus `numbers.txt` listing the same numbers with IMEI 1, IMEI 2 and serial. It uses the same folder rules as the Excel export: a new folder in the Android app or Chrome/Edge on a computer, otherwise Downloads. No ZIP.
- **Sharing many records.** **Share all (N)** (or tick records and choose **Share selected**) shares the pictures 10 at a time in one message each, then all the numbers as one separate numbered message (`1. IMEI`, `2. IMEI`, ... in the same order as the pictures). **Copy one by one** lists every record with its number, picture, **Download picture** button and tap-to-copy buttons for IMEI 1, IMEI 2 and serial; each copied value gets a tick so you can work down the list. Picture files are named by number only (`1.jpg`, `2.jpg`, ...), with the same number in the list, the Excel export and bulk downloads; a single record's download uses its record number (for example `3.jpg`). **Download all pictures instead** and **Copy numbers** are fallbacks, and **Share one record at a time** keeps the old per-record flow. *Picture + IMEI* falls back to the serial when a unit has no IMEI; *Picture + IMEI + Serial* adds `S/N ...` on the same line. A browser cannot force separate chat messages from a single share, so the pictures and the numbers are two share steps into the same chat.
- Android exports transfer files to the system save picker in small pieces, then report whether the file was saved, cancelled, or failed. Sheets-compatible exports download as Excel files to import into Google Sheets.

## Run locally
Install Node.js 24 or newer, then:

```bash
npm install
npm run dev
npm test    # unit tests for parsing, splitting, barcode matching and exports
```

Open the local URL printed by Vite (usually http://localhost:5173).
The first OCR scan requires internet access to download the recognition engine and English language data.

Build for production:

```bash
npm run build
npm run preview
```

## Real-photo regression check
Real label photos contain IMEIs and this repository is public, so they are never committed (`test-photos/` is git-ignored). To check the scanner against your own photos:

1. Put label photos in `test-photos/`.
2. Run `node scripts/scan-real-photos.mjs`. It scans each photo with the same scanner the laptop/cloud server uses and prints IMEI 1, IMEI 2, serials and how many records need review.
3. Once the output is verified by hand, run it with `--write-expected` to save `test-photos/expected.json`, edit anything wrong, and later runs report PASS/FAIL per photo.

## Scan and review
1. Choose photos and select **Extract IMEI**. Wait for scanning to finish.
2. In **Scanned records**, open a photo marked **Needs review**. Rotate it if needed, then enter the IMEI manually or choose how many labels to crop. Include the label and the complete number in each crop.
3. Select the records and export format. For Google Sheets, download the Excel file and import it into Sheets. For an offline photo viewer, choose the option with photo download, export, and download the photo gallery HTML.

The app uses mobile-friendly controls, though browser support for photo formats and folder selection varies. The first recognition data download requires an internet connection.

## Keep scanning after closing the browser (Windows laptop)
> **Note:** laptop and background scanning is under *More scan options* on the main screen.

1. Keep the laptop plugged in, connected, and configured to stay awake when you close the lid. A sleeping or shut-down laptop cannot scan.
2. Run `npm ci` and `npm run build` in this folder.
3. Run `& .\scripts\install-laptop-scanner.ps1` in PowerShell. This starts a Windows sign-in task that runs the scanner independently of the browser.
4. Open `http://127.0.0.1:8787/` on the laptop, or use the published GitHub Pages app from the same laptop. Expand **Keep scanning after closing the browser**. Use the access code in `server-data/access-code.txt` and the default laptop address `http://127.0.0.1:8787`.
5. Choose up to 500 photos and press **Scan on laptop**. Wait until **Upload finished** appears. You can now close the browser. Reopen the same app later to import the finished records and crops.

Original uploads, scan status, and cropped photos are kept under `server-data/` on this laptop; this folder is ignored by Git. The API requires the access code and listens only on the laptop's loopback address by default. The access code is saved in the browser so the job can reconnect after closing. Anyone with access to the laptop's browser profile or the code file can access the scans.

To stop automatic startup, run `& .\scripts\uninstall-laptop-scanner.ps1`. This leaves saved photos and jobs in `server-data/`. A restart or sign-in resumes any queued job after an interruption.

The default local address works on the laptop itself. To reach the laptop scanner from a phone away from home, you need a private HTTPS tunnel and a stable address; GitHub Pages alone cannot keep jobs running. Keep the access code private and use only an HTTPS address for remote access.

### Scan from a phone on the same Wi-Fi
1. Set the trusted Wi-Fi connection to **Private** in Windows network settings. Leave public networks on **Public**.
2. Open PowerShell **as administrator** in this project and run `& .\scripts\install-laptop-scanner.ps1 -PhoneAccess`. This allows port 8787 only on the private local subnet and makes the scanner listen for the phone.
3. On the laptop, open `http://127.0.0.1:8787/`, expand **Keep scanning after closing the browser**, and copy the displayed phone address. Open that `http://192.168...:8787/` address on the phone while both devices are on the same Wi-Fi. Use the access code from `server-data/access-code.txt` once on the phone.
4. Choose photos and press **Scan on laptop**. Keep the phone page open until **Upload finished** appears. After that, minimizing or closing the phone app does not stop laptop processing. Reopen the same phone address to see progress and import finished rows, or press **Stop background scan** in the app to cancel the remaining photos.

The phone uploads cannot continue reliably after the phone browser is closed, so wait for the upload confirmation. The laptop must remain on and awake. A changed Wi-Fi address may require opening the new address and entering the access code again. The GitHub Pages HTTPS page cannot directly call a plain HTTP private-network address from every mobile browser; use the laptop's local address on the phone. This setup is for the same trusted Wi-Fi, not remote internet access.

### Scan from a phone without the laptop
The optional [Render deployment](https://render.com/deploy?repo=https://github.com/cjbarnes29/imeiscanner) runs the same scanner on an online server. It is a paid service: the prepared configuration requests one 2 GB web service and a 20 GB persistent disk. Review the price in Render before deploying (currently about US$40/month for compute plus US$5/month for the disk, and possible bandwidth charges). No paid service is created by publishing this repository.

1. On your phone, open the Render deployment link, sign in, connect this GitHub repository, and review the proposed service and cost.
2. Enter an `IMEI_ACCESS_KEY` of at least 24 characters when Render asks. Save it in your phone password manager. Do not put the value in GitHub.
3. Deploy the Blueprint. When its health check passes, open the service's HTTPS `onrender.com` URL on your phone. Enter the same access code in **Keep scanning after closing the browser**.
4. Upload photos and wait for **Upload finished** before closing the phone app. The online server continues OCR and keeps the original uploads and crops on its persistent disk. Reopen the same HTTPS address to import finished records, or use **Stop background scan** to cancel remaining work.

This hosted option stores photos and IMEIs with Render rather than on your laptop. The GitHub Pages version remains a separate browser-only copy; use the Render address for background scans. The Blueprint has automatic redeploys off so a GitHub push does not interrupt an active scan. Deploy future code changes manually from Render after the current scan finishes. A 20 GB disk is finite: large batches can fill it, so monitor storage and keep exports/backups of important records.

## GitHub and GitHub Pages
- Commit the source files and `package-lock.json`; `.gitignore` excludes local dependencies, build output, environment files, and local `verification-*` photo and screenshot files. Do not manually upload those private test files to GitHub.
- GitHub Actions checks the install and production build on pushes and pull requests.
- To publish, push the project to the `main` branch and choose **GitHub Actions** under **Settings → Pages**. The deployment runs on pushes to `main`; it can also be started from **Actions → Deploy GitHub Pages → Run workflow**. The relative asset paths support both a user site and a repository site.
- Browser records stay in that browser's IndexedDB. Background jobs are saved on the laptop and imported into the browser when the app reopens. Publishing the site does not upload photos or IMEIs to GitHub.

## Using Google Sheets
Exports work without Google authorization. To use a report in Google Sheets, import the Excel file. Links to a local photo folder depend on the spreadsheet app and do not work after import into Google Sheets; the original photos remain on your device.

## Accuracy and privacy notes
- OCR is not guaranteed. Glare, blur, small print, curved labels, and low resolution can cause errors. Always compare extracted digits against the original label before relying on them.
- The browser scanner saves records in IndexedDB; the laptop scanner saves jobs and original photos under `server-data/`. Export regularly and keep a backup of that folder if relying on background jobs.
- IMEI values are sensitive device identifiers. Use a trusted device and Google account, and avoid sharing exported sheets publicly.
- The model classifier is heuristic and currently contains common Samsung Galaxy S/A/Z families plus selected iPhone and Pixel models. It uses OCR text and filenames; an unknown result needs manual correction.
- IMEI 1 cannot always be distinguished from IMEI 2 if the photo contains multiple unlabeled numbers. The tool deliberately sends ambiguous cases to review rather than guessing.
- Barcodes need enough pixels: on photos around 1000 px wide, small S/N and IMEI 2 barcodes often cannot be read and fall back to OCR or review. Full-resolution camera photos work best.
- If a second device shows only an IMEI 2 or serial close under another device's IMEI 1 with no visible sticker edge between them, it is treated as the same device; the scanner cannot tell them apart from the text alone.
- Picture links in Excel exported from the website open the picture saved in the browser that scanned it; on another phone or browser they show *Picture not found*.
