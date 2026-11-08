# IMEI Lens — Photo Scanner

An inventory scanner for phone-label photos. Regular OCR runs in the browser. Optional laptop background scanning keeps processing after the browser closes, provided the laptop stays powered on and awake.

## Free Android app for scanning after closing the screen

Install the Android APK from the [latest Android release](https://github.com/cjbarnes29/imeiscanner/releases). Open **IMEI Lens**, then choose **Scan on this phone in the background** and select up to 500 photos. Keep the scan notification enabled. The phone saves progress after each photo and shows the cropped records when you reopen the app. Use **Stop scan** in the app or notification to stop it. Exports use Android's save-file picker. Photos and IMEIs remain on the phone; no laptop, paid server, or Google authorization is needed. The GitHub Pages website remains available for browser-only scanning.

Android may pause and retry queued work when it restricts background activity, and force-stopping the app in phone settings prevents work until the app is opened again. Android 15 also limits `mediaProcessing` foreground services to six hours in a 24-hour period. This APK is a debug-signed preview; later APKs may require uninstalling it before installation, which erases its local records. Export important records first. A phone test is still needed to validate scanning on your device.

## Features
- Bulk image upload with browser OCR or a laptop background scan queue.
- IMEI extraction prioritizes a readable `IMEI 1`, then a readable `IMEI 2` from the same picture. Ambiguous or unreadable numbers are left for review.
- When multiple distinct IMEI 1 labels are detected, the scanner attempts to separate them using visible box edges. Uncertain splits are marked for review and crops can be adjusted manually.
- The Android scanner frames each separated box using a visible seam between labels and keeps the full width or height of that box face. If it cannot find a reliable seam, it keeps the full photo as one review record for manual splitting instead of saving a cut-off label. The review editor loads the original photo and saves manually selected crops even when automatic text reading fails.
- Review a photo to rotate it, draw crops by touch or mouse, and enter an unreadable IMEI manually. Guided cropping can replace one review record with several separate records.
- Luhn checksum validation.
- Each new upload skips exact copies of a photo and removes later rows with the same readable 15-digit IMEI within that upload. Rows without a readable IMEI remain for review. Older saved uploads are not compared or deleted.
- Manual exports only; scanning does not start downloads automatically.
- Numbered photos, selected-only downloads, and image names matched to the `#3`-starting record numbers.
- Excel and Word exports with optional embedded photos, plus CSV and Google Sheets exports.
- Person groups with editable names, per-record assignment, and person tabs in Excel/Google Sheets.
- Photo exports can save the report, photo gallery HTML, and record photos to a folder when the browser supports folder selection. Other browsers provide separate downloads for the report, the self-contained HTML gallery, and each photo. Split records use the cropped picture.
- Best-effort device model classification from OCR text and filenames; unknown models can be edited.
- Original photo retained with each record; click the thumbnail to inspect the image and raw OCR text.
- Scanned records offers detailed and simple views, a model filter, and per-record deletion from the review window. Uploads can be stopped; a browser scan finishes its current photo and leaves unprocessed photos queued.
- Samsung labels with an `SM-` model code record the next five characters, such as `SM-A075F`, when OCR can read them.
- The in-app photo viewer and self-contained offline HTML gallery keep their controls in place when moving between differently sized pictures. The HTML gallery can view, download, and copy the IMEI for each cropped picture.
- Editable model and IMEI values; records recalculate validation and duplicate state.
- Excel and Google Sheets workbooks include an all-records tab, model tabs, and person tabs.
- Android exports transfer files to the system save picker in small pieces, then report whether the file was saved, cancelled, or failed. Sheets-compatible exports download as Excel files to import into Google Sheets.

## Run locally
Install Node.js 24 or newer, then:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually http://localhost:5173).
The first OCR scan requires internet access to download the recognition engine and English language data.

Build for production:

```bash
npm run build
npm run preview
```

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
