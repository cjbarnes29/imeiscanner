# Camera and identifier update

Camera and uploaded photos now follow the same priority: readable checksum-valid IMEI 1, then IMEI 2, then labelled S/N when neither IMEI is readable. Serial numbers remain separate text fields; they never fill an IMEI cell. Ambiguous readings remain for review.

Camera controls offer remembered bottom-center, left-hand or right-hand placement, single exposure or 3/5-photo bursts, stopping capture, a thumbnail batch and removal before Scan all. Burst frames remain subject to the existing duplicate-IMEI policy during scanning. Phone camera opens the operating system's camera picker as an alternative to the browser's preview.

The camera requests a higher resolution and prefers ImageCapture.takePhoto when available, with video-frame capture as a fallback. A failed scan or stopped setup preserves camera files in the upload queue. Accepting photos does not start a continuous live OCR stream: Scan all reads the accepted photos.

Research used official documentation:

- https://developer.chrome.com/blog/imagecapture/ — a video-frame canvas can be limited to preview resolution; still capture can access photographic capabilities.
- https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html — rescaling, borders, contrast and deskewing affect OCR.
- https://github.com/zxing-js/browser — adopted as a lazy-loaded open-source barcode fallback. Native BarcodeDetector remains the preferred available decoder. Explicit barcode labels can supplement OCR; bare 15-digit barcodes require a unique spatial association with an OCR IMEI label before use.
- https://scanapp.org/html5-qrcode-docs/ — reviewed as another browser barcode-scanning implementation. It does not replace text OCR for model and serial labels.

Splitting uses IMEI 1, IMEI 2 and serial anchors, grouping nearby identifiers and identifiers sharing a connected pale sticker background. Repeated OCR detections and repeated serial tear-off strips are suppressed. The existing edge-based crop planner is reused; missing or ambiguous separating edges leave the original visible for manual review. Each accepted crop gets its own record/Picture ID and is read independently. Downloads, HTML and spreadsheet exports continue using the record crop.

Verification:

- Production build, identifier/export/sharing regression tests and new device-splitting tests pass.
- Generated fixtures test serial-only, IMEI-2-only and mixed multi-device boundaries, neighbour exclusion, duplicate OCR suppression, shared sticker grouping and missing-edge safety. These are not physical camera tests.
- Local OCR of the supplied real watch photo reads RFGYC2L1PLK with IMEI blank. The supplied real phone-box photo yields IMEI 357126894573692 as one device. A real image crop containing IMEI 2 only yields 357937314573694.
- Browser phone-width checks verify placement, preference persistence, burst settings and camera-unavailable handling. The computer camera is unavailable; physical ImageCapture, live bursts and a real multi-device phone-camera photo remain unverified.
- This is a web-only release. No APK build is requested or triggered.
