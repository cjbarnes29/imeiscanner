# RetailLens Android Blueprint

## System Overview
A thin native shell around the web app. A WebView loads the bundled page from `app/src/main/assets` (the web build is copied there by hand, see `DEVELOPERS.md`; no Gradle or npm step does it) and talks to Java through the `AndroidScanner` bridge. Photos are read on the phone (ML Kit OCR and barcode scanning), queued with WorkManager, and the results are exported to files or folders the user chooses. The Gradle project is `ImeiLensAndroid` (`settings.gradle`), with one module, `:app`, and the Android Gradle Plugin 8.13.2 (`build.gradle`).

## Subdirectories & System Boundaries
- app: [./app/README.md](./app/README.md) - the `:app` module (build config, manifest, Java code).
  - Code contract: [./app/src/main/java/com/imeilens/scanner/README.md](./app/src/main/java/com/imeilens/scanner/README.md)

## Global Invariants
- `app/src/main/assets/`, `app/build/`, `build/` and `.gradle/` are generated and git-ignored; never edit them by hand. The brand profiles reach the web build through `public/brands`, copied by `scripts/copy-ocr-assets.mjs` in `predev` and `prebuild`.
- The page is served only from `appassets.androidplatform.net`; cleartext traffic and backups are off.
- Release signing uses the environment variables `IMEI_KEYSTORE`, `IMEI_KEYSTORE_PASSWORD`, `IMEI_KEY_ALIAS` and `IMEI_KEY_PASSWORD`; no keys live in the repo.
- `-PphoneTest` builds an isolated app (`.phonetest` id suffix, label "RetailLens Test") that installs next to the real app and cannot touch its data; `-PminifyDebug` turns on the shrinker for a debug build.

## Global Side Effects
- Builds write to `build/`, `app/build/` and `.gradle/`.
- At run time the app writes only to its private storage and to export locations the user picks.

## System Verification
- Run (from this folder; no Gradle wrapper is present): `gradle :app:testDebugUnitTest`
- Debug build: `gradle :app:assembleDebug`
