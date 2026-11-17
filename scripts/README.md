# scripts

## Overview
Standalone Node (`.mjs`) and PowerShell helpers for the IMEI Lens project: build steps, the unit-style test suite run by `npm test`, optional browser end-to-end checks, accuracy evaluations on local photos, and laptop-scanner install helpers. Tests load the TypeScript sources in `../src/` by transpiling them with `typescript` into a temp directory, then assert with `node:assert/strict`. Each script's first comment lines state its purpose and usage.

## Interface
Build and release helpers (wired as npm lifecycle hooks):
- `write-version.mjs` - writes `src/version.ts` (`APP_VERSION`, `APP_COMMIT`); runs in `predev`, `prebuild`, `pretypecheck`.
- `copy-ocr-assets.mjs` - copies the Tesseract worker, core and language data into `public/ocr`; `OCR_MODEL` env selects the model (default `4.0.0_best_int`).
- `update-catalog.mjs` - crawls Samsung sitemaps/product pages and updates `public/samsung-catalog.json`; `CATALOG_PAGE_LIMIT` (default 80). Needs network.
- `check-private-data.mjs` - privacy guard against real IMEIs in Git (`npm run check:private`; `--ci` for `npm run check:private:ci`). Allowed synthetic numbers are listed in `synthetic-imeis.allow`.

Unit-style tests (all in `npm test`): `test-records`, `test-device-splitting`, `test-people`, `test-models`, `test-custom-models`, `test-multi-detect`, `test-learning`, `test-crop-engine`, `test-crop-apply`, `test-frame-quality`, `test-seed-layout`, `test-crop-queue`, `test-ocr-config`, `test-scan-report`, `test-fail-reason`, `test-retail`, `test-retail-v2`, `test-stall-guard`, `test-archive`, `test-privacy-check`, `test-label-issue`, `test-camera-mode`, `test-brand-conformance` (all `scripts/test-*.mjs`).

Browser end-to-end checks (headless Edge/Chrome, not in `npm test`; run `npm run build` first): `e2e-bulk`, `e2e-camera`, `e2e-layout`, `e2e-photo-edit`, `e2e-queue`, `e2e-retail`, `e2e-review`, `e2e-scan`, `e2e-simple`, `e2e-studio` (`scripts/e2e-*.mjs`). Optional env: `SHOTS`, `WIDTH`, `ZOOM`, `SIMPLE`, `OFFLINE`, `ONLY`, `E2E_LOG`.

Accuracy evaluations and fixtures (need local, git-ignored `test-photos/`): `eval-labeled`, `eval-frame-quality`, `eval-multi-barcodes`, `eval-multi-count`, `eval-multi-ocr`, `eval-multi-tiles`, `calibrate-frame-quality`, `scan-real-photos` (runs the `../server/scan.mjs` scanner over a folder, `--write-expected`), `make-composites` (builds `test-photos/composite/` and `truth.json`).

Data tooling: `dry-run-records.mjs` (read-only masked comparison of backup/web record copies), `make-geometry-fixture.mjs` (turns masked diagnostics into a replay fixture with checksum-invalid synthetic numbers), `sanitize-test-imeis.mjs` (one-off replacement of real IMEIs in tracked scripts).

Windows laptop scanner: `install-laptop-scanner.ps1 [-PhoneAccess]` registers the logon task "IMEI Lens Laptop Scanner" running `server/index.mjs`; `uninstall-laptop-scanner.ps1` removes it. See [../server/README.md](../server/README.md).

## Invariants
- Test data is synthetic only. Any checksum-valid 15-digit number in a committed file must appear in `synthetic-imeis.allow`; real IMEIs must never be added to it.
- `test-photos/`, `phase1-results/`, `phase2-results/` and `server-data/` hold real data and stay git-ignored.
- `dry-run-records.mjs` is read-only toward the app and the data it inspects, and reports masked IMEIs (first 8 and last 4 digits).
- Tests that need the browser, `sharp` or local photos are deliberately outside `npm test`; the `npm test` list in `../package.json` is the authoritative set (plus `e2e/phone-tools/page-snapshot.test.mjs`).
- `test-brand-conformance.mjs` must pass against the same `../brands/conformance/samsung.json` the Java tests use.

## Side Effects
- Tests write transpiled modules to OS temp directories (`mkdtemp`); `test-privacy-check.mjs` builds a throw-away git repo.
- `write-version.mjs` overwrites `src/version.ts`; `copy-ocr-assets.mjs` writes `public/ocr/`; `update-catalog.mjs` makes HTTP requests and rewrites `public/samsung-catalog.json`.
- E2E scripts start headless browsers, use a local server on the built `dist/`, and may write screenshots when a folder or `SHOTS` is given.
- `make-composites`, `scan-real-photos`, `make-geometry-fixture`, `sanitize-test-imeis` and `eval-frame-quality` read or write files under `test-photos/` or paths given on the command line.
- The PowerShell scripts register or remove a Windows scheduled task; with `-PhoneAccess` (administrator) they also create the inbound firewall rule "IMEI Lens private Wi-Fi" for TCP 8787 on the private profile.

## Verification
- Run: `npm test` (from the repository root); privacy check: `npm run check:private:ci`.
- A single test: `node scripts/test-records.mjs`.
