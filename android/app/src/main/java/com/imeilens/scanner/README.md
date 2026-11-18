# com.imeilens.scanner

## Overview
The whole native Android layer of RetailLens (IMEI Lens). `MainActivity` hosts the web app (built from the repository's `src/`; the build output is copied into `app/src/main/assets` by hand, see `DEVELOPERS.md`) in a WebView and exposes a JavaScript bridge. Photos are read on the phone with ML Kit text and barcode recognition (`ImageScanner`), driven by a WorkManager worker (`ScanWorker`). Results are kept in `ScanStore` and `ScanLedger`. The remaining classes are small rule helpers (IMEI checks, label geometry, brand rules). Most of them are plain Java that never use `android.*`, so they can be unit-tested on a plain JVM: `BarcodeRecovery`, `FailReason`, `LabelIssue`, `LabelGeometry`, `SamsungImei`, `SamsungModel`, `ImeiSource`, `BrandProfile`, `ScanLedger`, `QueueWatchdog`, `ExportCommit`, `FolderExport` and `CameraInbox`. `BrandRegistry` is the exception: it imports `android.content.Context` (`init(Context)` reads the brand files from assets), and its `loadFromDirectory(File)` is the path used by JVM tests. `ScanStore` also imports `Context`.

## Interface
Entry points (declared in `app/src/main/AndroidManifest.xml`):
- `MainActivity` (public, launcher; also receives `SEND` for `image/*` and `text/plain`, and `SEND_MULTIPLE` for `image/*` only). Loads `https://appassets.androidplatform.net/assets/index.html` through `WebViewAssetLoader` and registers the bridge as `AndroidScanner`.
- `ScanWorker` (public `Worker`; not declared in the manifest, WorkManager starts it): `doWork()` scans the queued photos, with the number of photos processed in parallel set by `DeviceProfile`.
- `QueueService` (public foreground `Service`): notification and wake lock while the page's crop queue runs. Its notification has its own Stop button (a `PendingIntent.getService` with `ACTION_STOP`).
- `StopReceiver` (public `BroadcastReceiver`): the Stop action of the background-scan notification built in `ScanWorker`. It calls `ScanStore.stop` and cancels the unique work `imei-lens-background-scan`.

Bridge methods (`MainActivity.Bridge`, all `@JavascriptInterface`):
- Photos and scanning: `choosePhotos`, `takePhoto`, `cameraWaiting`, `scanWaitingCamera`, `discardWaitingCamera`, `setScanOptions`, `scanReport`, `rescanNeeded`, `status`, `statusFrom`, `image`, `sourceImage`, `setActivePerson`, `resetScans`, `stop`, `takeSharedText`.
- Crop queue: `queueStatus`, `queueStopRequested`.
- Export and sharing: `beginFile` / `appendFile` / `finishFile` / `abortFile`, `beginFolder` / `appendFolderFile` / `finishFolder` / `abortFolder`, `shareText`, `shareFolder`, `shareFolderText`, `shareFolderBluetooth`, `sendCapabilities`, `saveFolderInfo`, `chooseSaveFolder`, `forgetSaveFolder`, `commitStaged`.
- Device speed: `speedInfo`, `setSpeedMode`.

Package-private building blocks:

| Class | Role |
| --- | --- |
| `ImageScanner` | `scan(...)` reads one photo (decode, tiling, enhancement, ML Kit OCR and barcodes) and returns a `JSONArray` of product rows |
| `ScanStore` | In-memory scan job, written to disk in batches; declares the constant `MAX_PHOTOS = 1000` (it does not enforce it); `start`, `addPending`, `promotePending`, `update`, `finish`, `stop`, `clear`, `rescanQueue`, `reportJson` |
| `ScanLedger` | Scan report, one entry per source photo (`scanned`, `failed`, `duplicatePhoto`, `split`, `summarize`, `autoRetryQueue`) |
| `DeviceProfile` | Chooses the parallelism and speed mode for the phone (`detect`, `capacity`, `setMode`, `isHot`, `hasMemoryRoom`) |
| `CameraInbox` | Private `camera-waiting/` and `camera-photos/` folders for photos from the phone's camera app |
| `ExportCommit`, `FolderExport` | Journaled, size-verified completion of single-file and folder exports |
| `QueueWatchdog` | Detects a stalled crop queue (`STALL_MS` 10 min, `LOCK_MS` 12 min, `CHECK_MS` 1 min) |
| `BrandRegistry`, `BrandProfile` | Brand profiles loaded from assets `brands/*.json`; brand detection from the label's own text |
| `SamsungImei`, `SamsungModel` | Samsung-only rules read from the Samsung profile |
| `ImeiSource`, `FailReason`, `LabelIssue`, `LabelGeometry`, `BarcodeRecovery` | Pure-Java IMEI checks (Luhn), failure reasons, label grouping and barcode trust decisions |

## Invariants
- No number is ever invented or completed: `BarcodeRecovery`, `FailReason`, `LabelIssue` and `BrandRegistry` only decide or explain. A brand is never inferred from IMEI digits; no single brand, or more than one, falls back to the generic profile and is marked "brand unclear".
- A barcode value is accepted as IMEI 1 only when `BarcodeRecovery.decide` allows it (15 digits, Luhn, and consistency with the printed line).
- Samsung same-device rules are applied only to Samsung labels (`SamsungImei.isSamsungLabel`) and their results are marked for review.
- Every selected photo gets exactly one scan-report outcome in `ScanLedger`; a duplicate IMEI never changes the existing record.
- A job holds at most `ScanStore.MAX_PHOTOS` (1000) photos. `ScanStore` only declares the constant; the callers enforce it (`MainActivity` stops adding photos when `queue.length() >= ScanStore.MAX_PHOTOS`, and passes it to `CameraInbox.acceptAllWaiting`). `DeviceProfile` only reports it to the page as `maxPhotos`.
- Exports are verified by byte count; an earlier export file is never truncated in place (`FolderExport`, `ExportCommit`).
- `CameraInbox` only deletes files it named (`camera-*.jpg`), and only inside its two private folders.
- The WebView only trusts the host `appassets.androidplatform.net` over `https`, with file access off and cleartext traffic off (`AndroidManifest.xml`).
- The plain-Java classes listed in the Overview use no `android.*` types, so they stay JVM-testable. `BrandRegistry` and `ScanStore` do import `android.content.Context`.
- The brand profiles are copied to `public/brands` by `scripts/copy-ocr-assets.mjs`, which runs in `predev` and `prebuild`.

## Side Effects
- Permissions: `INTERNET`, `CAMERA`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROCESSING`. Package queries for WhatsApp, WhatsApp Business and Bluetooth sharing.
- Writes scan state, source photos and camera photos under the app's private storage (`ScanStore.root`, `FileProvider` paths in `res/xml/file_paths.xml`); writes exports to a folder or file the user chose.
- Starts WorkManager jobs (`ScanWorker`), a foreground notification and a wake lock (`QueueService`).
- Opens share sheets and system pickers (photos, camera, save folder).

## Verification
- Run (from `android/`, with a Gradle install; this folder has no wrapper): `gradle :app:testDebugUnitTest`
- Unit tests live in `app/src/test/java/com/imeilens/scanner` (JUnit 4).
