# server

## Overview
The "laptop scanner": a dependency-light Node HTTP server that queues photo-scan jobs, runs the OCR and barcode scanner on them in the background (so scanning continues with the browser closed), and also serves the built web app from `dist/`. `index.mjs` is the HTTP/job layer; `scan.mjs` is the scanning engine it calls. Started with `npm run laptop` (`node server/index.mjs`), or as a Windows scheduled task via [`scripts/install-laptop-scanner.ps1`](../scripts/README.md).

## Interface
- `index.mjs` (entry point, no exports). HTTP API, all JSON, CORS-limited to the allow-listed origins:
  - `GET /api/health` - unauthenticated; returns `running`, `background` and `phoneAddresses` (private LAN URLs, only when bound to `0.0.0.0` and not on Render).
  - `GET /api/jobs`, `POST /api/jobs` - list jobs / create a job (`count` 1 to 500, `mode` `fast` | `standard` | `detailed`, `personId`).
  - `GET /api/jobs/:id` - one job's public status.
  - `PUT /api/jobs/:id/photos/:index` - upload photo `index` (image content type, max 25 MB, `X-File-Name` header).
  - `POST /api/jobs/:id/start` - queue the job; `POST /api/jobs/:id/stop` - stop it.
  - `GET /api/jobs/:id/records` - scan results; `GET /api/jobs/:id/images/:uuid.jpg` - a cropped result photo.
  - Any other path is served statically from `dist/` (`serveStatic`).
- `scan.mjs`:
  - `createScanner()` returns `{ scan(input, filename, mode, orientationTried), close() }`. `scan` returns an array of result records (`id`, `pictureId`, `sourcePictureId`, `name`, `model`, `imei`, serial fields, `imei2`, `status` `Valid` | `Review`, `cropNeedsReview`, `raw`, `createdAt`, `photo` JPEG buffer, and `deviceCount` / `deviceImeis` when a split failed).
  - Reuses shared logic from `../src/` (`device-labels.ts`, `serial.ts`, `scan-layout.ts`, `barcode-imei.ts`), so the server and the in-browser scanner stay in step.

## Invariants
- Every `/api/*` route except `/api/health` requires `Authorization: Bearer <access key>`, compared with `timingSafeEqual` (`authorized`).
- Access key: `IMEI_ACCESS_KEY` (at least 24 characters) if set; otherwise read from or generated into `<data dir>/access-code.txt` (mode 0600). On Render (`RENDER` env) `IMEI_ACCESS_KEY` is mandatory and startup throws without it.
- Job ids must match `^[a-f0-9-]{36}$` (`safeId`); static paths must stay inside `dist/`; image downloads only for names listed in the job's `records.json`.
- Manifests and records are written atomically (temp file then `rename`, `atomicJson`).
- One queue run at a time (`processing` flag). Duplicate photos (SHA-256 fingerprint) and duplicate 15-digit IMEIs within a job are skipped. A job that errors is set back to `queued` with an error message and retried on restart.
- Stopping a job is honoured between photos (`stoppedJobs` set plus manifest status `stopped`).
- Binds `127.0.0.1` by default; `0.0.0.0` with `--lan`; `IMEI_HOST` can set any address.
- `scan.mjs` never invents numbers: an IMEI is only reported if it passes the Luhn check (`luhnValid`) or is barcode-confirmed; unreadable labels get status `Review`.

## Side Effects
- Creates and writes `server-data/` (override with `IMEI_DATA_DIR`): `jobs/<id>/manifest.json`, `records.json`, `input/<n>.bin` (uploaded photos) and `output/<uuid>.jpg` (result crops), plus `access-code.txt`. This folder holds real device data and is git-ignored.
- Listens on `PORT` (default 8787) on `IMEI_HOST` (default 127.0.0.1).
- Starts Tesseract.js workers (a second one, created only when a photo has 2 or more devices, the mode is not `fast` and the machine has 4+ CPUs) and reads photos with `sharp`; CPU heavy. Logs errors to the console.
- Reads `dist/` (build the app first with `npm run build`).

## Verification
- No tests live in this folder; the shared scanning logic is covered by `npm test` from the repository root.
- Real-photo regression check of `scan.mjs`: `node scripts/scan-real-photos.mjs [folder]` (needs local, git-ignored photos).
- Smoke test: `npm run laptop`, then open `http://127.0.0.1:8787/api/health`.
