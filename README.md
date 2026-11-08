# IMEI Lens — Photo Scanner

A standalone browser-based inventory scanner for phone-label photos. OCR runs locally in the browser with Tesseract.js. Records and image data are saved in this browser's local storage. No backend is required for local scanning.

## Features
- Bulk image upload and browser OCR.
- IMEI extraction prioritizes a readable `IMEI 1`, then a readable `IMEI 2` from the same picture. Ambiguous or unreadable numbers are left for review.
- When multiple distinct IMEI 1 labels are detected, the scanner attempts to separate them using visible box edges. Uncertain splits are marked for review and crops can be adjusted manually.
- Review a photo to rotate it, draw crops by touch or mouse, and enter an unreadable IMEI manually. Guided cropping can replace one review record with several separate records.
- Luhn checksum validation.
- Duplicate 15-digit IMEIs are removed automatically, keeping the existing record; records without a complete IMEI are retained for review.
- Manual exports only; scanning does not start downloads automatically.
- Numbered photos, selected-only downloads, and image names matched to the `#3`-starting record numbers.
- Excel and Word exports with optional embedded photos, plus CSV and Google Sheets exports.
- Person groups with editable names, per-record assignment, and person tabs in Excel/Google Sheets.
- Photo exports can save the report, photo gallery HTML, and record photos to a folder when the browser supports folder selection. Other browsers provide separate downloads for the report, the self-contained HTML gallery, and each photo. Split records use the cropped picture.
- Best-effort device model classification from OCR text and filenames; unknown models can be edited.
- Original photo retained with each record; click the thumbnail to inspect the image and raw OCR text.
- Editable model and IMEI values; records recalculate validation and duplicate state.
- Excel and Google Sheets workbooks include an all-records tab, model tabs, and person tabs.

## Run locally
Install Node.js 20 LTS or newer, then:

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

## GitHub and GitHub Pages
- Commit the source files and `package-lock.json`; `.gitignore` excludes local dependencies, build output, environment files, and local `verification-*` photo and screenshot files. Do not manually upload those private test files to GitHub.
- GitHub Actions checks the install and production build on pushes and pull requests.
- To publish, push the project to the `main` branch and choose **GitHub Actions** under **Settings → Pages**. The deployment runs on pushes to `main`; it can also be started from **Actions → Deploy GitHub Pages → Run workflow**. The relative asset paths support both a user site and a repository site.
- Records stay in each browser's local storage. Publishing the site does not upload existing records to GitHub or share records between devices. Browser storage is limited; export records before clearing site data or changing devices.

## Using Google Sheets
Exports work without Google authorization. To use a report in Google Sheets, import the Excel file. Links to a local photo folder depend on the spreadsheet app and do not work after import into Google Sheets; the original photos remain on your device.

## Accuracy and privacy notes
- OCR is not guaranteed. Glare, blur, small print, curved labels, and low resolution can cause errors. Always compare extracted digits against the original label before relying on them.
- The scanner stores image data URLs and records in browser local storage. Large batches can exceed browser storage limits; the app displays a warning if saving fails. Export regularly; for large-scale usage, migrate storage to IndexedDB.
- IMEI values are sensitive device identifiers. Use a trusted device and Google account, and avoid sharing exported sheets publicly.
- The model classifier is heuristic and currently contains common Samsung Galaxy S/A/Z families plus selected iPhone and Pixel models. It uses OCR text and filenames; an unknown result needs manual correction.
- IMEI 1 cannot always be distinguished from IMEI 2 if the photo contains multiple unlabeled numbers. The tool deliberately sends ambiguous cases to review rather than guessing.
