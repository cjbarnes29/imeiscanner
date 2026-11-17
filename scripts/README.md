# scripts

## Overview
Standalone Node (`.mjs`) and PowerShell helpers for the IMEI Lens project: build steps, the unit-style test suite run by `npm test`, optional browser end-to-end checks, accuracy evaluations on local photos, and laptop-scanner install helpers. Most tests load the TypeScript sources in `../src/` by transpiling them with `typescript` into a temp directory, then assert with `node:assert/strict`. Exceptions: `test-records.mjs` and `test-crop-apply.mjs` pull helper functions out of `src/App.tsx` through the TypeScript syntax tree, and `test-privacy-check.mjs` loads no `src/` code and runs `check-private-data.mjs` in a throw-away git repo. Most scripts state their purpose and usage in their first comment lines; `test-device-splitting`, `test-frame-quality`, `test-learning`, `test-multi-detect`, `test-records` and `update-catalog` start with an import instead.

## Interface
Build and release helpers (wired as npm lifecycle hooks):
- `write-version.mjs` - writes `src/version.ts` (`APP_VERSION`, `APP_COMMIT`); runs in `predev`, `prebuild`, `pretypecheck`.
- `copy-android-assets.mjs` (`npm run android:assets`) replaces the generated Android assets with exactly the current `dist/`. Run after the web build and before Gradle; this removes old hashed bundles.
- `copy-ocr-assets.mjs` - copies the Tesseract worker, core and language data into `public/ocr`, and also copies `brands/profiles/*.json` into `public/brands/` (git-ignored) so the brand profiles reach `dist/`; `OCR_MODEL` env selects the model (default `4.0.0_best_int`).
- `update-catalog.mjs` - crawls Samsung sitemaps/product pages and updates `public/samsung-catalog.json`; `CATALOG_PAGE_LIMIT` (default 80). Needs network.
- `check-private-data.mjs` - privacy guard against real IMEIs in Git (`npm run check:private`; `--ci` for `npm run check:private:ci`). Allowed synthetic numbers are listed in `synthetic-imeis.allow`.

Unit-style tests (all in `npm test`): `test-records`, `test-device-splitting`, `test-people`, `test-models`, `test-custom-models`, `test-multi-detect`, `test-learning`, `test-crop-engine`, `test-crop-apply`, `test-frame-quality`, `test-seed-layout`, `test-crop-queue`, `test-ocr-config`, `test-scan-report`, `test-fail-reason`, `test-retail`, `test-retail-v2`, `test-stall-guard`, `test-archive`, `test-privacy-check`, `test-label-issue`, `test-camera-mode`, `test-brand-conformance` (all `scripts/test-*.mjs`).

Browser end-to-end checks (headless Edge/Chrome, not in `npm test`; run `npm run build` first, `scripts/e2e-*.mjs`). Extra needs per script:
- Fully synthetic, nothing else needed: `e2e-layout`, `e2e-retail`, `e2e-simple`.
- `node scripts/e2e-storage.mjs`: actual IndexedDB transactions in an isolated browser; snapshot retention, rollback, record/photo isolation, read/save failures with retry, and damaged-record protection. Build first; optional `SHOTS` saves warning screenshots.
- `node scripts/test-server-api.mjs`: temporary scanner data directory; authorization, CORS, invalid requests, parallel uploads, stop state and image/path boundaries. Does not start OCR.
- Need the private `test-photos/multi-02.jpg`: `e2e-bulk`, `e2e-camera`, `e2e-review`, `e2e-studio`.
- `e2e-scan` needs `test-photos/multi-NN.jpg` (photo numbers as arguments, default `02 04 09`).
- `e2e-queue` needs `node scripts/make-composites.mjs` first (reads `test-photos/composite/`).
- `e2e-photo-edit` needs `node e2e/fixtures/make-fixtures.mjs` first (synthetic photos).

Optional env and arguments: `SHOTS` (screenshot folder) for `e2e-layout`, `e2e-retail` and `e2e-simple`, while `e2e-bulk` and `e2e-review` take the folder as their first argument; `WIDTH`, `ZOOM` and `SIMPLE` only for `e2e-layout`; `OFFLINE` only for `e2e-scan`; `ONLY` and `E2E_LOG` only for `e2e-queue`.

Accuracy evaluations and fixtures (need local, git-ignored `test-photos/`): `eval-labeled` (needs `npm run build` and a headless browser; defaults to the folder `test-photos/composite`; options `--products=N` and `--speed=fast|standard|detailed`), `eval-frame-quality`, `eval-multi-barcodes`, `eval-multi-count`, `eval-multi-ocr`, `eval-multi-tiles`, `calibrate-frame-quality`, `scan-real-photos` (runs the `../server/scan.mjs` scanner over a folder, `--write-expected`), `make-composites` (builds `test-photos/composite/` and `truth.json`).

Data tooling: `dry-run-records.mjs` (read-only masked comparison of backup/web record copies), `make-geometry-fixture.mjs` (turns masked diagnostics into a replay fixture with checksum-invalid synthetic numbers), `sanitize-test-imeis.mjs` (one-off replacement of real IMEIs in tracked scripts).

Windows laptop scanner: `install-laptop-scanner.ps1 [-PhoneAccess]` registers the logon task "IMEI Lens Laptop Scanner" running `server/index.mjs`; `uninstall-laptop-scanner.ps1` removes it. See [../server/README.md](../server/README.md).

## Invariants
- Test data is synthetic only. Any checksum-valid 15-digit number in a committed file must appear in `synthetic-imeis.allow`; real IMEIs must never be added to it.
- `test-photos/`, `phase1-results/`, `phase2-results/` and `server-data/` hold real data and stay git-ignored.
- `dry-run-records.mjs` is read-only toward the app and the data it inspects, and reports masked IMEIs (first 8 and last 4 digits).
- Tests that need the browser, `sharp` or local photos are deliberately outside `npm test`; the `npm test` list in `../package.json` is the authoritative set (plus `e2e/phone-tools/page-snapshot.test.mjs`).
- `test-brand-conformance.mjs` must pass against the same `../brands/conformance/samsung.json` the Java tests use.

## Side Effects
- 21 of the 23 tests write transpiled modules to OS temp directories (`mkdtemp`); `test-privacy-check.mjs` builds a throw-away git repo. `test-records.mjs` writes `verification-records-runtime.mjs`, and `test-crop-apply.mjs` writes `verification-crop-apply-runtime.mjs` and `verification-record-store-runtime.mjs`, into the repository root and deletes them at the end (git-ignored through `verification-*`).
- `write-version.mjs` overwrites `src/version.ts`; `copy-ocr-assets.mjs` writes `public/ocr/` and `public/brands/`; `update-catalog.mjs` makes HTTP requests and rewrites `public/samsung-catalog.json`.
- E2E scripts start headless browsers, use a local server on the built `dist/`, and may write screenshots when a folder or `SHOTS` is given.
- `make-composites`, `scan-real-photos`, `make-geometry-fixture`, `sanitize-test-imeis` and `eval-frame-quality` read or write files under `test-photos/` or paths given on the command line.
- The PowerShell scripts register or remove a Windows scheduled task; with `-PhoneAccess` (administrator) they also create the inbound firewall rule "IMEI Lens private Wi-Fi" for TCP 8787 on the private profile.

## Verification
- Run: `npm test` (from the repository root); privacy check: `npm run check:private:ci`.
- A single test: `node scripts/test-records.mjs`.
