# IMEI Lens 1.4 preview

This release extends the existing upload/OCR, crop editing, assignment, duplicate checking and exports.

- Camera capture with rear-camera preference, preview/rescan, optional continuous focus and torch. Capture adds the photo to the existing scan queue. Camera photos require a readable, checksum-valid IMEI 1; uploads retain IMEI 1 then silent IMEI 2 fallback. Repeated camera IMEIs are skipped against existing records.
- Native BarcodeDetector is used where supported. Unlabelled numeric barcodes cannot safely distinguish IMEI 1 from IMEI 2 and are not substituted for unreadable text. Explicit IMEI 1 barcode payloads can supplement OCR; conflicts remain for review.
- Persistent simple view adds editable model, IMEI and serial, per-field copying, Copy all, and matching crop photo downloads. Serial numbers remain text. Existing pagination is retained.
- Samsung catalog: official source URLs and check dates, exact model-code matching, search, optional images/structured specifications, local name corrections, saved offline metadata and manual refresh. Regional variants are separate records. Missing release dates/specifications/compatibility remain unknown. Images need connectivity unless already cached by the browser.
- Daily GitHub job at 03:17 UTC checks official sources independently of the app. GitHub schedules are best effort, not an exact-time guarantee. The manual job link requires repository Actions access; the local refresh button downloads the latest published snapshot. App photos and IMEIs are not uploaded by this job.
- APK fetches catalog updates from GitHub Pages and can fall back to its bundled snapshot on first use offline. Official catalog updates do not overwrite local catalog name corrections or manually corrected scan records.
- Excel import compatibility fix supports both module export shapes.

## Verification

`node scripts/test-records.mjs` passes: camera IMEI selection, upload fallback, unreadable/ambiguous inputs, serial leading zeros/manual overrides, duplicate flags, record identity for incremental storage, cropped-image selection, generated offline HTML entries and disabled empty copy actions, CSV output, and Excel generation/reload.

`npm run build` passes. ExcelJS remains a large lazily loaded export bundle.

Chrome: app loading, camera dialog opening/closing, catalog refresh/search and product detail expansion verified. Real-photo upload was blocked by the browser extension's file-access setting. No physical Android device, live camera/torch capture, Excel mobile/desktop UI or Google Sheets import was verified in this run. The generated HTML download/copy buttons were checked by source/data regression, not a full offline click-through test.

Catalog coverage is incomplete. The initial snapshot contains 109 variants; daily discovery expands the queue. This is not a complete Samsung historical catalog. Older models, all regions and full accessory compatibility still need coverage verification.

The Android download is a debug preview, not a production-signed Play Store release. Export important records before replacing an older debug APK: generated debug keys can differ and require uninstalling the old build.
