# IMEI Lens: developer notes

For using the app, see [README.md](README.md). This file holds build, test and release steps.

## Quality standards

All work follows [docs/APP-QUALITY-STANDARDS.md](docs/APP-QUALITY-STANDARDS.md): what to check before calling a change done, which test commands cover which screen, how findings are classed (Critical / High / Medium / Low), and the release quality gate.

## Run locally
Install Node.js 24 or newer, then:

```bash
npm install
npm run dev
npm test    # unit tests for parsing, splitting, barcode matching, exports, people and model names
```

Open the local URL printed by Vite (usually http://localhost:5173). The first OCR scan requires internet access to download the recognition engine and English language data. `npm run dev` and `npm run build` first write `src/version.ts` (the version and commit shown in Settings).

Build for production:

```bash
npm run build
npm run preview
```

Build the Android app (needs the Android SDK and JDK 17; the web build is copied into `android/app/src/main/assets`).

macOS or Linux (bash):

```bash
npm run build
npm run android:assets
gradle --project-dir android :app:assembleDebug
```

Windows (PowerShell):

```powershell
npm run build
npm run android:assets
gradle --project-dir android :app:assembleDebug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. A signed release build reads `IMEI_KEYSTORE`, `IMEI_KEYSTORE_PASSWORD`, `IMEI_KEY_ALIAS` and `IMEI_KEY_PASSWORD` from the environment (keep the keystore backed up: without it users cannot upgrade).

## Render hosted scanner (optional, paid)
The optional [Render deployment](https://render.com/deploy?repo=https://github.com/cjbarnes29/imeiscanner) runs the same scanner on an online server. It is a paid service: the prepared configuration requests one 2 GB web service and a 20 GB persistent disk. Review the price in Render before deploying (currently about US$40/month for compute plus US$5/month for the disk, and possible bandwidth charges). No paid service is created by publishing this repository.

1. On your phone, open the Render deployment link, sign in, connect this GitHub repository, and review the proposed service and cost.
2. Enter an `IMEI_ACCESS_KEY` of at least 24 characters when Render asks. Save it in your phone password manager. Do not put the value in GitHub.
3. Deploy the Blueprint. When its health check passes, open the service's HTTPS `onrender.com` URL on your phone. Enter the same access code in **Keep scanning after closing the browser**.
4. Upload photos and wait for **Upload finished** before closing the phone app. The online server continues OCR and keeps the original uploads and crops on its persistent disk. Reopen the same HTTPS address to import finished records, or use **Stop background scan** to cancel remaining work.

This hosted option stores photos and IMEIs with Render rather than on your laptop. The GitHub Pages version remains a separate browser-only copy; use the Render address for background scans. The Blueprint has automatic redeploys off so a GitHub push does not interrupt an active scan. Deploy future code changes manually from Render after the current scan finishes. A 20 GB disk is finite: large batches can fill it, so monitor storage and keep exports/backups of important records.

## Testing in a real browser
Besides `npm test` there are scripts that drive the built app in headless Edge/Chrome (run `npm run build` first; photos go in `test-photos/`, which is git-ignored):

| Script | What it checks |
|---|---|
| `node scripts/e2e-review.mjs [folder]` | Review sheet at phone size: fits the screen, no overlap between header/body/footer, fields not clipped, compact preview that enlarges on tap, typing kept, Save, Previous/Next/Finish, unsaved-changes prompt (writes screenshots to the folder when given) |
| `node scripts/eval-labeled.mjs [folder] [filter] [--products=truth] [--speed=..] [--split] [--verbose]` | Accuracy on labeled photos (`node scripts/make-composites.mjs` builds them from `test-photos`): IMEI 1 found / invented / mixed, serial, IMEI 2, model, flagged |
| `node scripts/e2e-queue.mjs` | Background crop queue: queue all, banner, originals replaced, resume offer, discard |
| `node scripts/e2e-studio.mjs` | Crop Studio: automatic count, Save for later, Resume, exit prompt, Save all, original replaced |
| `node scripts/e2e-camera.mjs` | Camera: live advice, tap-to-focus ring and shot check, with a sharp and a blurred photo as the fake camera |
| `node scripts/e2e-scan.mjs 01 02 …` | The real scan on `test-photos/multi-NN.jpg`: records, valid IMEIs, IMEI 1/2 agreement, review flags, seconds |
| `node scripts/eval-frame-quality.mjs` | Blur/dark thresholds on the real photos |

## Real-photo regression check
Real label photos contain IMEIs and this repository is public, so they are never committed (`test-photos/` is git-ignored). To check the scanner against your own photos:

1. Put label photos in `test-photos/`.
2. Run `node scripts/scan-real-photos.mjs`. It scans each photo with the same scanner the laptop/cloud server uses and prints IMEI 1, IMEI 2, serials and how many records need review.
3. Once the output is verified by hand, run it with `--write-expected` to save `test-photos/expected.json`, edit anything wrong, and later runs report PASS/FAIL per photo.

## Signing releases with a permanent key
Without a permanent key, each release APK gets a new debug key and cannot update over the previous one. To sign with one key:

1. Create the keystore once, on your own computer (keep the file and its passwords somewhere safe and backed up; if you lose them, users must uninstall before updating):
   ```bash
   keytool -genkeypair -v -keystore imei-lens-release.jks -alias imeilens -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Encode it as text: `base64 -w0 imei-lens-release.jks` (macOS: `base64 -i imei-lens-release.jks`).
3. In GitHub, open the repository's **Settings → Secrets and variables → Actions** and add four secrets: `IMEI_KEYSTORE_B64` (the encoded text), `IMEI_KEYSTORE_PASSWORD`, `IMEI_KEY_ALIAS` (`imeilens` above) and `IMEI_KEY_PASSWORD`.
4. Push a tag `android-vX.Y.Z`. `.github/workflows/android.yml` then builds `assembleRelease` (shrunk with R8) and signs it; the release notes say "signed with the release key". With no secrets set, it builds the debug APK as before.

Never commit the keystore or put its passwords in the repository. The first release signed this way will not install over an older debug-signed app: users export their records, uninstall once, then install it. Later updates install over it. Test the first release build on a phone before sharing it, because the shrunk release build has so far only been tested through the debug `-PminifyDebug` option.

## Releases and GitHub
- **Pages (the website)** deploys on every push to `main`. **Android releases** build from a tag named `android-vX.Y.Z` pushed on a `main` commit: the workflow builds the APK and attaches it to a GitHub release.
- Both run `npm run build`, so one commit gives one web bundle: the website and the APK contain the **same** files. Compare the version line in Settings.
- **CI** (`Build`) runs the unit tests and the production build on every push and pull request.
- **Backups:** before each merge to `main`, the previous `main` is saved as tag `backup-main-before-X.Y.Z` and branch `backup/main-before-X.Y.Z`, and the feature branch as `backup/feature-X.Y.Z`. To undo a merge: `git revert -m 1 <merge commit>`, or reset `main` to the backup tag.
- Commit the source files and `package-lock.json`; `.gitignore` excludes local dependencies, build output, environment files, the generated `src/version.ts`, and local `verification-*` photo and screenshot files. Do not upload private test photos.
- Browser records stay in that browser's IndexedDB. Background jobs are saved on the laptop and imported when the app reopens. Publishing the site does not upload photos or IMEIs to GitHub.
- To publish the website for the first time, choose **GitHub Actions** under **Settings → Pages**; a deployment can also be started from **Actions → Deploy GitHub Pages → Run workflow**.
