# RetailLens — Scan. Sell. Track. Achieve.

RetailLens opens each screen with its main content. **Show all** reveals the extra controls; **Show less** returns to the summary. Targets show segment progress and percentage caps first. Models & segments shows the models inside each segment, with one search and a shared model editor.

The main tabs are **Home, Scan, Phones, Report, Targets, Export**. **More** has three groups: **People & sharing** (people, suggestions, allocation by model and sending), **Models & segments** (names, segments, colours and Samsung source tools), and **Settings & backup** (preferences, backup, restore and history). Existing tools are kept inside these groups.

**RetailLens** is an offline retail app for phone sellers: it scans label photos (IMEI Lens is the scanning engine), sorts phones into segments, tracks targets and stock, recommends who should get which phones, and writes your WhatsApp report. See [docs/RETAILLENS-PROGRESS.md](docs/RETAILLENS-PROGRESS.md) for what RetailLens does and how far it has got. RetailLens appears in Detailed mode only, and it is not in the tab table below. Everything below describes the scanning engine, which works as before.

# IMEI Lens — Photo Scanner (the scanning engine)

Built by CJB. Version history: [CHANGELOG.md](CHANGELOG.md) (older notes: [1.6](RELEASE-1.6.md), [1.5](RELEASE-1.5.md), [1.4](RELEASE-1.4.md)). Build, test and release steps: [DEVELOPERS.md](DEVELOPERS.md).

IMEI Lens reads phone label photos (IMEI 1, IMEI 2, serial, model), lets you check and fix them, groups the phones by person, and sends or saves the results. It comes in two forms with the same screens and version number but different scan engines (see Scanning):

- **Web:** https://cjbarnes29.github.io/imeiscanner/ — OCR runs in your browser.
- **Android app:** the same screens in an app, plus the features that need a phone (background scanning, sharing, Bluetooth, saving to a folder).

Open **Settings**: the last line shows `Version X (commit) · Web` or `· Android app`. When the version numbers match, the two have the same screens and features.

## Install and update the Android app
1. Open the [releases page](https://github.com/cjbarnes29/imeiscanner/releases) on your phone, take the newest `android-v…` release at the top (releases are marked pre-release, so the "latest" shortcut does not show them), and download `IMEI-Lens-Android.apk` from its assets. The release notes say whether the file is signed with the release key or debug-signed; only releases signed with the release key install over each other without uninstalling.
2. Open the file and allow installing from this source when Android asks.
3. To update, install the newer APK over the old one. If Android refuses (a different signature), **export your records first**, uninstall the old app, then install the new one. Records live inside the app and are removed by uninstalling.

**Export your records before every update.** An update keeps your records only if the new APK has the same signature as the old one. This version cannot import records back, so keep your export files as your backup.

Android may pause queued work when it restricts background activity, and force-stopping the app in phone settings stops scanning until you open it again (tap **Stop scan**, then choose the remaining photos). Android 15 also limits `mediaProcessing` foreground services to six hours in a 24-hour period; after that, scanning stops until you tap **Stop scan** and choose the remaining photos. Keep the scan notification enabled.

## The screen
A bar at the bottom switches between six sections (Detailed mode):

| Tab | What it is for |
|---|---|
| **Scan** | Upload or take photos. On Android: **Choose photos and scan** (background scan) and photos shared from other apps. |
| **Records** | Search, filter by model (drop-down) and status, group by person, select, review each picture. |
| **Give** | Decide how many of each model each person gets. The default export does not include person columns. |
| **Unknown** | Models with no name yet: the phones are listed, with suggestions and fixes. |
| **Share** | Send a person's pictures and numbers, one by one, or save them to your phone. |
| **Export** | Excel, Word, Google Sheets and CSV reports. |

The top bar has the **Simple | Detailed** switch, **Reset** (the trash button: deletes every scanned record and photo after you confirm; people, model names and settings are kept) and **Settings**. Simple mode hides the **More** menu and most of the detailed panels and keeps scanning and a simple send and export screen; switching modes removes no data. Some sections below call the **Records** tab "Scanned records".

### Scanning
- **Android app:** choose up to **1000 photos** per batch. They scan in the background with a progress notification. The app measures the phone (cores, memory, heat, battery saver) and scans several photos at once. In **Settings → Phone scanning power** you can pick **Auto** (starts gently and speeds up while the phone stays cool), **Turbo**, **Balanced** or **Safe**. If a photo has no readable IMEI, the scanner also tries it turned 90°, 270° and 180° and keeps the best result (about 6 to 8 extra seconds, only for photos where nothing was read).
- **Share into the app:** from WhatsApp, Gallery or any app, share photos to **IMEI Lens**. They are copied into the app and scanned automatically and added to the person last selected, so check the person before you send. Photos shared during a running scan wait and scan next.
- **Web:** choose photos and tap **Extract IMEI**, or use **Scan with camera**. Browser scans run only while the page stays open.
- **Laptop or Render server:** see the sections further down.
- **Three scan settings, three different jobs.** **Phone scanning power** (Settings, Android only) sets how many photos the phone scans at once. **Scan speed** (Fast, Standard, Detailed) and **Products in each photo** (Auto or 1 to 12) are on the Scan tab; they set how hard the scanner works on each photo. "Detailed" here is a scan speed, not the Detailed screen mode.
- Saved pictures in the Android app are kept at up to 1800 px.

### Reviewing a picture
Tap a record to open the review. **All the buttons live in one floating bar at the bottom** (they stay in view while you scroll the fields): Previous / *n of N* / Next (the last picture shows **Finish ✓**), Copy IMEI, Photo, Edit photo, rotate left and right, then **Save**, **Save & next** and a status (*All saved* or *N unsaved*).
- You can move between pictures without saving. What you typed is kept, and after the last picture (or when you close the review) a pop-up asks **Save all**, **Discard changes** or **Keep editing**.
- **Warnings pop up** with an OK button: IMEI digits missing, a duplicate IMEI, an invalid checksum, or a failed send.
- **Duplicates:** an IMEI that appears more than once in any scan is flagged. The **Duplicates** chip shows only those; **Archive duplicates** keeps the most complete copy of each IMEI and moves the others to the archive after you confirm. Nothing is deleted: Undo is offered right away, and **View / restore** brings an archived copy back at any time.
- When the scanner is unsure it floats a question above the Save bar: **Is this 1 device or N?**, or **Check the crop**.
- **Device model** is a button that opens a big list of every known model (built-in, downloaded catalog, your own names, models already scanned) with search. Tap one to choose it, **＋ Add a new model** to save a new code and name, or **Type for this phone only**.
- On the Android app a photo opens zoomed on the label when its position is known; **Show full photo** switches back.

### Unknown models
The **Unknown** tab lists every model that has no name. Under each one are its phones (tap one to open it), suggestions (a known code one character away offers **Misread? Use SM-…**, similar models fill the name), a name box, and **More options**: fix the model code, pick the model for all those phones, or move them to a person. **Settings → Add many at once** accepts a list of `code, name` lines.

### Welcome, tutorials and credit
The first time the app opens (and after each new version) a dialog lists the features and improvements. **Settings → Help** reopens it (**What’s new**) and has **Tutorials: how to do everything**. The review window keeps the picture fixed at the top; the typing section and the person / IMEI 2 group fold up and down.

### Models, catalog and Settings
**Settings** has: **Text size** (Small, Normal, Large, Extra large), Phone scanning power (Android), **Where files are saved** (Android), **What this app can handle**, Devices in my scans, **My Samsung models** (add, import, export; **Check models** opens the list in a big dialog with Edit and Delete), and the **downloaded Samsung catalog** (**Check catalog** opens it in a big dialog with search, Edit, Delete, ＋ Add a model and Restore deleted; your changes are kept when the catalog updates).

## Sending and saving
Open **Share** and pick a person. Each person has these buttons:

- **WhatsApp · pictures + IMEI:** all unsent pictures go in **one send with one caption** listing every IMEI and serial once, in picture order. WhatsApp may take only about 30 pictures at once: the app warns, then asks how many arrived and **remembers where it stopped**, so **Continue** sends the next ones. Optional: write the IMEI/serial on each picture (slower) and send the numbers again as one message.
- **Bluetooth / nearby:** sends the pictures (clean, with no text on them) plus a `numbers.txt` with every IMEI and serial, straight to Bluetooth when the phone has it. The Android app checks whether WhatsApp is installed and works; if not, or if WhatsApp took fewer pictures than sent, a pop-up offers Bluetooth instead. After a Bluetooth send you say how many arrived, the same way.
- **One by one:** a large picture with its IMEI and serial, one big button, **Download image + copy IMEI & next**, that saves the picture, copies IMEI 1 and moves on, plus **Copy S/N**, Back and Skip. It remembers the position and what was downloaded. **Download all remaining** saves the rest.
- **Save to my phone:** a folder with every picture (resized and sharpened, no text on it) and `numbers.txt` with every IMEI and serial. Folder saves put no text on the pictures; the numbers are in `numbers.txt`.
- **Text only** and **Copy:** plain lists.

| Send method | Text written on the pictures | Numbers sent as |
|---|---|---|
| WhatsApp | None, unless you turn on the optional stamping | One caption (and optionally one message) |
| Bluetooth / nearby | None | `numbers.txt` |
| One by one | None | Copy IMEI / Copy S/N buttons |
| Save to my phone | None | `numbers.txt` |
| Text only / Copy | None (plain text) | The text itself |

Records marked **Needs review** are still sent if you select them. Check them first.

**Choose the save folder once.** The first time you use One by one or Save to my phone, Android asks for a folder (pick or create one such as `Documents/IMEI`). After that both save into `IMEI-<person>` inside it **without asking**, and saving again **replaces** the earlier pictures and `numbers.txt` (only files named like `001-<IMEI number>.jpg` and `numbers.txt` are touched, including a `numbers.txt` of your own in that folder; use a new folder to keep older files). Change or forget the folder in **Settings → Where files are saved**.

**File names.** Single downloads and folder saves are named in picture order with the IMEI: `001-352099001761002.jpg`, `002-…`. Sorting by name keeps the order. Excel and Word reports keep their plain numbered picture links.

## Export
The **Export** tab makes Excel, Word, Google Sheets and CSV reports. The default export has IMEI 1, IMEI 2, serial and a picture. See Features for the layouts. Picture links in Excel exported from the website only open in the browser that scanned the photo.

## Limits (also listed in Settings → What this app can handle)
- One scan batch: up to **1000 photos** in the Android app; **500** on the laptop or Render server. Records are shown a page at a time.
- 1000 IMEI numbers as text are about 17 KB: one message. Long lists open the phone's share menu.
- WhatsApp: about 30 pictures per send (an estimate, not measured on every phone). Use Continue, or Bluetooth.
- Excel or Word with the pictures inside: about 40 pictures per GB of phone memory, between 100 and 600 (an estimate, not measured on a phone); the app warns. For more, export numbers only or use the folder export.
- Blurry, glare-covered or cut-off labels cannot be read; they go to **Needs review**.
- Sending to WhatsApp always needs a tap to choose the chat.

## Backups and safety
- **Export before** uninstalling the app, clearing its data, or using **Reset**.
- IMEI numbers are sensitive. Your photos and IMEIs stay on the phone or in the browser. If you use the laptop server, they are also stored in `server-data\` on that laptop. If you use the Render option, they are stored on Render's disk. The phone-on-Wi-Fi laptop mode sends data without encryption (see that section).


## Features
- Bulk image upload with browser OCR or a laptop background scan queue.
- IMEI extraction prioritizes a readable `IMEI 1`, then a readable `IMEI 2` from the same picture. Ambiguous or unreadable numbers are left for review. Records store **IMEI 1, IMEI 2 and serial number**; all three are editable in the review window.
- **Barcode confirmation.** Every photo is also read for Code 128 barcodes (zxing-wasm, bundled with the app, works in every browser including iPhone Safari). A barcode value that matches what OCR read on its label replaces misread digits, and serial numbers are confirmed from the S/N barcode. Barcode-confirmed numbers outrank OCR.
- **Misread guard.** If OCR reads the same IMEI twice and the readings differ by 1-2 digits, the record is marked **Needs review** even when the checksum passes.
- Recognised serial labels: `S/N`, `SN`, `Serial`, `Serial No`, `Serial Number`. A bare `IMEI:` label (no 1 or 2) is accepted when exactly one number passes Luhn.
- **Scan speed and Products in each photo apply everywhere (1.22).** The two choices on the Scan tab are remembered and sent to the Android background scanner (`AndroidScanner.setScanOptions`), so *Choose photos and scan* and *Scan with camera* behave the same. Fast: one read, no tilt or tile passes unless a number of products is chosen. Standard: today's behaviour. Detailed: levels smaller tilts and, when still short of the count, reads once more with finer tiles. A photo that shows fewer products than the count (chosen, or counted from the Model lines and from pairs of valid IMEI barcodes) is never saved quietly: it is flagged and the review screen asks "1 device or N?". Older installed APKs ignore the setting for background scans and the Scan screen says so.
- **Products in each photo (Scan tab).** Choose Auto or 1–12. If fewer products are found than chosen, the photo is read again in overlapping enlarged tiles (OCR and barcodes), the results are merged and the products are split again; every crop is straightened (tilt up to about 15° is found from the text lines). The camera shows how many IMEI barcodes were readable after each shot. **Review → Straighten** levels a photo by hand.
- **Scanning paths.** In the Android app, gallery photos are scanned by *Choose photos and scan* (ML Kit text and barcode reading on the phone, in the background; tilted photos are levelled, IMEI 1 is taken from its barcode when one fits, and the photo is re-read in overlapping pieces when more Model labels are visible than products were found); *Scan with camera* uses the in-app scanner (Tesseract + barcodes, products per photo, tiled re-read). On the website the browser upload is the scan path.
- **Confidence and learning.** Every record has a confidence score (high / medium / low) at the top of the review window with the reasons. The app applies corrections it has seen before on this phone, automatically and without asking: a model code you correct in review is fixed automatically next time, and an unverified code one character away from a code seen on two or more other phones is corrected to it. Catalog-named models are never changed.
- **Sideways and tilted photos.** A photo tilted about 2.5° or more is levelled before the products are located. With Products in each photo on Auto, the number of Model lines found decides whether to re-read in tiles. `scripts/eval-multi-*.mjs` measure these steps on photos in `test-photos`.
- **Cropping (web).** Crop Studio: draw, move, resize and delete boxes (the box count is the product count), Auto-detect, zoom, Select several, Undo, Save all / Save for later (drafts are kept on this device), and a confirmation when you leave with unsaved work. Saving replaces the original record with one record per crop. The original is moved to the archive, not deleted: use Undo or **View / restore** to bring it back. Your gallery is never touched. Every IMEI is checksum-checked, read in several picture treatments, retried when weak, and flagged for review when uncertain.
- **Multiple devices in one photo.** Device labels are grouped with OCR text positions, barcode positions and visible sticker/box edges. A line holding several labels (`IMEI 1: ... IMEI 2: ...`) is split per label. Grouping distance scales with the printed text size. Uncertain splits are not cut blindly: the record asks **"Is this 1 device or N?"** and offers one record or the crop tool with N prefilled. Crops can be adjusted manually.
- The Android scanner frames each separated box using a visible seam between labels and keeps the full width or height of that box face. If it cannot find a reliable seam, it keeps the full photo as one review record for manual splitting instead of saving a cut-off label. The review editor loads the original photo and saves manually selected crops even when automatic text reading fails.
- Review a photo to rotate it, draw crops by touch or mouse, and enter an unreadable IMEI manually. Guided cropping (Crop Studio) replaces one review record with several separate records: draw a box around each label, then **Save all** to read them together and check every result before saving. **Auto-detect** draws the boxes for you to check. **Bulk crop** (in *Scanned records*) does the same for every record that needs cropping.
- Luhn checksum validation.
- Each new upload skips exact copies of a photo. Rows with the same readable 15-digit IMEI are flagged as duplicates and are removed only after you confirm (see Reviewing a picture). Rows without a readable IMEI remain for review.
- Manual exports only; scanning does not start downloads automatically.
- Numbered photos, selected-only downloads, and image names matched to the `#3`-starting record numbers.
- **Default export: IMEI + picture with download button** (picture links open only in the browser that scanned the photo). Every format uses columns **IMEI 1, IMEI 2, Serial** (blank when not detected), with no person, validation or status columns. Excel adds **Picture** and **Download picture**. Word adds the picture. CSV and Google Sheets (imported from Excel) are numbers only, one tab. The older layouts (IMEI and model, or with person and photos) remain in the *Information to include* menu.
- **No ZIP.** The Excel file and the picture files are saved as normal files in one folder: the Android app and Chrome/Edge on a computer ask you to pick a location and create `IMEI pictures <date time>` inside it; other browsers download the workbook and pictures together into Downloads.
- **Download picture links on phones.** Excel for Android and iOS cannot open links to files on the phone (Chrome shows an error). When exported from the website, each link is `https://<site>/#picture=<id>`; opening it shows that picture from this browser's saved records with **Download picture** and **Share picture** buttons. It works on the phone and browser that scanned the photos. The Android app and desktop Excel use the local picture file beside the workbook instead. Excel desktop also offers **Save as Picture** on the embedded image.
- Person groups with editable names, per-record assignment, and person tabs in Excel/Google Sheets.
- Photo exports can save the report, photo gallery HTML, and record photos to a folder when the browser supports folder selection. Other browsers provide separate downloads for the report, the self-contained HTML gallery, and each photo. Split records use the cropped picture.
- **Photo orientation.** A photo taken upside down or sideways is read automatically (see Scanning). The review window still has **Rotate** buttons for manual fixes.
- **Counting devices first.** A device has one IMEI 1, one IMEI 2 and one serial, so each different readable IMEI 1 (or serial) is a device; repeats of the same number on tear-off strips, small misreads and numbers that fail the checksum never add devices. Labels are matched to devices along the direction the boxes are stacked. Stacked white boxes with no visible seam stay as one review record with the full photo, and the scanner asks **"Is this 1 device or N?"**. A box that is visible but unreadable still gets its own record for review.
- **IMEI 2 and serial second reads.** When IMEI 2 is missing, the area right of each IMEI 1 line is re-read enlarged; Samsung prints the same six serial digits (positions 9-14) in IMEI 1 and IMEI 2, so a reading is accepted when it matches that block, corrected when only that block was misread, and left blank otherwise. When the serial is missing, the top-left of the label (where Samsung prints S/N) is re-read on its own.
- **Test data.** Tests use made-up IMEIs and serials only. Real label photos stay in the git-ignored `test-photos/` folder.
- **Speed and offline use.** Crops of one photo are read on two workers in parallel (4+ cores); dark labels are read inverted from the start; the reading engine, language data and fonts are bundled with the app (no CDN; copied at build time by `scripts/copy-ocr-assets.mjs`). The first scan in the web app needs internet to download the English language data; after that it works offline; the stored original photo is capped at 3200 px.
- **Navigation.** The Back button / swipe-back (browser and Android app) closes the popup you are in (review, crop editor, share, bulk crop, bulk edit, delete confirmation) instead of leaving the app; it closes only the top popup, and the camera still asks before discarding unscanned photos. Popup headers with Close stay pinned while the content scrolls, and a floating **Top** button returns to the start of a long list.
- Best-effort device model classification from OCR text and filenames; unknown models can be edited.
- Original photo retained with each record; click the thumbnail to inspect the image and raw OCR text.
- Scanned records offers detailed and simple views, a model filter, and per-record deletion from the review window. Uploads can be stopped; a browser scan finishes its current photo and leaves unprocessed photos queued.
- Samsung labels with an `SM-` model code record the next five characters, such as `SM-A075F`, when OCR can read them.
- The in-app photo viewer and self-contained offline HTML gallery keep their controls in place when moving between differently sized pictures. The HTML gallery can view, download, and copy the IMEI for each cropped picture.
- Editable model and IMEI values; records recalculate validation and duplicate state.
- The older Excel/Google Sheets layouts include an all-records tab, model tabs, and person tabs; the default IMEI + picture layout is one sheet.
- **Bulk download.** **Download all pictures (N)** in *Scanned records* saves every ticked record (or every visible record when none is ticked) as numbered files `1.jpg`, `2.jpg`, `3.jpg`, ... (numbers only, no IMEI or other text in the file name) plus `numbers.txt` listing the same numbers with IMEI 1, IMEI 2 and serial. It uses the same folder rules as the Excel export: a new folder in the Android app or Chrome/Edge on a computer, otherwise Downloads. No ZIP.
- Android exports transfer files to the system save picker in small pieces, then report whether the file was saved, cancelled, or failed. Sheets-compatible exports download as Excel files to import into Google Sheets.

## Camera advice and tap-to-focus
The in-app camera (also used inside the Android app's WebView) shows live advice under the picture: **Sharp and clear**, **A little soft**, **Blurry**, **Glare** or **Too dark**, measured on a 480 px grey copy of the frame about 1.4 times a second (`src/frame-quality.ts`; thresholds are in that file and were chosen from real photos with `scripts/calibrate-frame-quality.mjs`). Tap the label to focus there (`pointsOfInterest`, where the phone's camera supports it). After a shot the app repeats the check and counts the readable IMEI barcodes. This is advice only: it never blocks a shot.

## Scan and review
1. Choose photos and select **Extract IMEI**. Wait for scanning to finish.
2. In **Scanned records**, open a photo marked **Needs review**. Rotate it if needed, then enter the IMEI manually or choose how many labels to crop. Include the label and the complete number in each crop.
3. Select the records and export format. For Google Sheets, download the Excel file and import it into Sheets. For an offline photo viewer, choose the option with photo download, export, and download the photo gallery HTML.

The app uses mobile-friendly controls, though browser support for photo formats and folder selection varies. The first recognition data download requires an internet connection.

## Keep scanning after closing the browser (Windows laptop)

1. Keep the laptop plugged in, connected, and configured to stay awake when you close the lid. A sleeping or shut-down laptop cannot scan.
2. Run `npm ci` and `npm run build` in this folder.
3. Run `& .\scripts\install-laptop-scanner.ps1` in PowerShell. This starts a Windows sign-in task that runs the scanner independently of the browser.
4. Open `http://127.0.0.1:8787/` on the laptop, or use the published GitHub Pages app from the same laptop. Expand **Keep scanning after closing the browser**. Use the access code in `server-data/access-code.txt` and the default laptop address `http://127.0.0.1:8787`.
5. Choose up to 500 photos and press **Scan on laptop** (the Android app itself takes 1000). Wait until **Upload finished** appears. You can now close the browser. Reopen the same app later to import the finished records and crops.

Original uploads, scan status, and cropped photos are kept under `server-data/` on this laptop; this folder is ignored by Git. The API requires the access code and listens only on the laptop's loopback address by default. The access code is saved in the browser so the job can reconnect after closing. Anyone with access to the laptop's browser profile or the code file can access the scans.

To stop automatic startup, run `& .\scripts\uninstall-laptop-scanner.ps1`. This leaves saved photos and jobs in `server-data/`. A restart or sign-in resumes any queued job after an interruption.

The default local address works on the laptop itself. To reach the laptop scanner from a phone away from home, you need a private HTTPS tunnel and a stable address; GitHub Pages alone cannot keep jobs running. Keep the access code private and use only an HTTPS address for remote access.

### Scan from a phone on the same Wi-Fi
1. Set the trusted Wi-Fi connection to **Private** in Windows network settings. Leave public networks on **Public**.
2. Open PowerShell **as administrator** in this project and run `& .\scripts\install-laptop-scanner.ps1 -PhoneAccess`. This allows port 8787 only on the private local subnet and makes the scanner listen for the phone.
3. On the laptop, open `http://127.0.0.1:8787/`, expand **Keep scanning after closing the browser**, and copy the displayed phone address. Open that `http://192.168...:8787/` address on the phone while both devices are on the same Wi-Fi. Use the access code from `server-data/access-code.txt` once on the phone.
4. Choose photos and press **Scan on laptop**. Keep the phone page open until **Upload finished** appears. After that, minimizing or closing the phone app does not stop laptop processing. Reopen the same phone address to see progress and import finished rows, or press **Stop background scan** in the app to cancel the remaining photos.

The phone uploads cannot continue reliably after the phone browser is closed, so wait for the upload confirmation. The laptop must remain on and awake. A changed Wi-Fi address may require opening the new address and entering the access code again. The GitHub Pages HTTPS page cannot directly call a plain HTTP private-network address from every mobile browser; use the laptop's local address on the phone. This setup is for the same trusted Wi-Fi, not remote internet access. **This mode sends the access code and scan data without encryption. Use it only on a network you control.**

### Scan from a phone without the laptop
An optional paid Render deployment can run the scanner on an online server. It stores photos and IMEIs on Render's disk, not on your laptop. Setup, price and limits are in [DEVELOPERS.md](DEVELOPERS.md#render-hosted-scanner-optional-paid).

## Using Google Sheets
Exports work without Google authorization. To use a report in Google Sheets, import the Excel file. Links to a local photo folder depend on the spreadsheet app and do not work after import into Google Sheets; the original photos remain on your device.

## Accuracy and privacy notes
- OCR is not guaranteed. Glare, blur, small print, curved labels, and low resolution can cause errors. Always compare extracted digits against the original label before relying on them.
- The browser scanner saves records in IndexedDB; the laptop scanner saves jobs and original photos under `server-data/`. Export regularly and keep a backup of that folder if relying on background jobs.
- IMEI values are sensitive device identifiers. Use a trusted device and Google account, and avoid sharing exported sheets publicly.
- The scanner is built for Samsung labels first; other brands are best-effort. Brand rules live in `brands/`.
- The model classifier is heuristic and currently contains common Samsung Galaxy S/A/Z families plus selected iPhone and Pixel models. It uses OCR text and filenames; an unknown result needs manual correction.
- IMEI 1 cannot always be distinguished from IMEI 2 if the photo contains multiple unlabeled numbers. The tool deliberately sends ambiguous cases to review rather than guessing.
- Barcodes need enough pixels: on photos around 1000 px wide, small S/N and IMEI 2 barcodes often cannot be read and fall back to OCR or review. Full-resolution camera photos work best.
- If a second device shows only an IMEI 2 or serial close under another device's IMEI 1 with no visible sticker edge between them, the scanner cannot tell them apart from the text alone, so it asks **"Is this 1 device or N?"** instead of deciding.
- Picture links in Excel exported from the website open the picture saved in the browser that scanned it; on another phone or browser they show *Picture not found*.

---

*The sections below are for developers and AI assistants working on the code. If you only use the app, you can stop here.*

## Local Interface & Invariants
Direct source files in the repository root:
- `vite.config.ts`: Vite config (`defineConfig`, `base: './'`, the React plugin). The web build is copied into the Android app, so the relative base must stay.
- `verification-bands-runtime.mjs`, `verification-gallery-refactor.cjs`: scratch scripts. `.gitignore` excludes `verification-*`, so they are not part of the project.

## Subdirectories & System Boundaries
- `src/`: [src/README.md](src/README.md) - React and TypeScript front end: screens, OCR and barcode reading, IMEI validation, cropping, people and model handling, browser storage. `src/retail/` ([src/retail/README.md](src/retail/README.md)) holds the pure-logic RetailLens modules.
- `android/`: [android/README.md](android/README.md) - the WebView shell and all native Android code (background scanning, exports, brand rules). Its package chain has one README per folder down to `android/app/src/main/java/com/imeilens/scanner/`.
- `server/`: [server/README.md](server/README.md) - laptop and Render background scanner: HTTP job API (`index.mjs`) and scan engine (`scan.mjs`).
- `scripts/`: [scripts/README.md](scripts/README.md) - build helpers, the unit-style tests behind `npm test`, optional browser checks, accuracy evals, privacy guard, and the Windows laptop-scanner install scripts.
- `brands/`: [brands/README.md](brands/README.md) - brand profile data shared by the web and Android readers, with a conformance file shared with the Java tests.
- `e2e/`: [e2e/README.md](e2e/README.md) - emulator and phone test suite for the isolated test app (`com.imeilens.scanner.phonetest`). `e2e/phone-tools/` has its own [contract](e2e/phone-tools/README.md).
- `docs/`: plans, progress notes and the phone-test checklist. It contains no source code, so it has no contract file.
- Git-ignored, not documented: `test-photos/`, `phase1-results/`, `phase2-results/`, `server-data/`, `e2e/reports/`, `public/ocr/`, `public/brands/`, `verification-ocr-eval/`.

## Global Invariants
- Test data is synthetic. Real label photos and real IMEIs are never committed; `npm run check:private` enforces this.
- An IMEI is reported only if it passes the Luhn check or is confirmed by a barcode.
- Every `/api` route on the scanner server except health requires the access key.
- The Android test suite only drives the isolated test app, never the user's real app.

## Global Side Effects
- Browser: IndexedDB database `imei-lens-v2` and several `localStorage` keys (see [src/README.md](src/README.md)).
- Laptop server: writes `server-data/` (jobs, photos, crops, `access-code.txt`) and listens on port 8787.
- Android: private app storage, WorkManager jobs, a foreground notification, and user-chosen export folders.
- Windows laptop scanner install adds a scheduled task and, with `-PhoneAccess`, a firewall rule for TCP 8787.

## System Verification
- Run: `npm test`
- Also: `npm run typecheck`, `npm run build`, `npm run check:private`
