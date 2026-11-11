# IMEI Lens 1.5

## Reading
- Barcode confirmation for every photo in every browser (zxing-wasm, bundled): exact IMEI and serial values replace OCR misreads.
- Misread guard: Luhn-valid IMEIs that disagree with another OCR reading by 1-2 digits go to review.
- IMEI 1, IMEI 2 and serial stored per record and editable.
- Serial labels `SN`, `Serial No`, `Serial Number`; bare `IMEI:` labels.
- Several labels on one OCR line are split per label; device grouping scales with text size.
- Camera and upload photos with several devices split using barcode positions; uncertain splits ask "Is this 1 device or N?".
- The laptop/cloud scanner has the same barcode and serial upgrades.

## Export and sharing
- New default export: IMEI 1, IMEI 2, Serial, Picture and a Download picture link, one sheet. Word/CSV/Sheets use the same number columns.
- Saved as a normal folder (no ZIP): native folder picker in the Android app 1.5.0, browser folder picker in Chrome/Edge, otherwise Downloads.
- Excel links on phones: web links (`#picture=<id>`) that open the picture with Download and Share buttons, because Excel mobile cannot open phone file paths.
- Sharing sends picture and numbers as separate messages; IMEI mode falls back to the serial.

## Interface
- Phone-first audit: quick-nav gap under the top bar fixed, 44px touch targets, styled serial field, 16px inputs, accessible labels.

## Tooling
- `npm test`, `scripts/scan-real-photos.mjs` (local, git-ignored `test-photos/`), CI runs both test scripts.
- Android app 1.5.0 adds the folder picker; the web app changes after 1.5.0 (barcodes, picture links) do not need a new APK.

## Known limits
- Small barcodes on photos near 1000 px wide are often unreadable; use full-resolution camera photos.
- Picture links work in the browser that scanned the photos.
- Android 1.5.0 folder export is compiled but has not been tried on a physical phone.
