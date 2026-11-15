# Phone checklist and automatic result collection (IMEI Lens Test only)

A digital replacement for the paper sheet. It runs on the computer, the phone opens it in its browser over the ADB link, and nothing is printed or sent to the internet.

```
node e2e/phone-tools/checklist-server.mjs --device <phone serial>
```

It prints `http://localhost:8787/?t=<code>`. Open that on the phone in Chrome. (`adb reverse` makes `localhost` on the phone reach the computer; the code stops other pages or programs from using the server.)

## How a test case works
1. **Start**: the computer takes a masked baseline of the test app (its records and archive).
2. You do the steps in **IMEI Lens Test** (choose photos, take a photo, crop, review, export).
3. **Check**: the computer compares with the baseline and tells you what changed: new products (masked IMEI 1, model, "Needs review" or "shown as fine"), archived originals and crops, edited fields, new export files (name and size). It warns about **silent problems**: a product that is wrong or incomplete but not marked for review, an export file that is empty.
4. You tap **Matches the label** or **Wrong** for each new product (you compare the masked number with the real label), then **Pass / Fail / Skip**, optionally a note.

Saved on the computer in `e2e/reports/phone-checklist/<time>/`: `RESULTS.json`, `FAILURES.csv` (case, photo reference, expected, actual masked, whether the app flagged it, steps to reproduce), `SUMMARY.md`.

## What it reads, and what it never does
* Only `com.imeilens.scanner.phonetest`. The real app is never read (`guardApp`), and the tool also refuses on a phone where the test app is missing.
* Records and archive entries come from the test app's own page (IndexedDB through the WebView DevTools socket). **IMEIs are masked inside the page** (first 8 + last 4 digits), and masked again on the computer, in notes too. Photos, crop images and OCR text are never read.
* Export files: **names, sizes and times only** of files with "imei" or "export" in the name under Download and Documents. File contents are never opened. No gallery listing.
* It writes nothing to the phone. The real-phone safety net (`E2E_REAL_PHONE=1`) is switched on by the server: no uninstall, no deleting in Download, no clearing another app.

## Camera, crop and review
* **Camera** ("Take photo") results appear as records named `camera-…`; the case checks they come from the camera and shows each one for your tick. The reference photo (taken first with the phone's Camera app) stays on the phone; the failure row names the in-app photo and its time.
* **Crop / undo**: the archive shows the original kept and the crops linked to it; Undo shows as a restored original.
* **Review**: every changed field (IMEI 1, model, flags, status) is listed; a cleared "Needs review" mark is shown so you can confirm you really checked the label.

## Tests
`node --test e2e/phone-tools/page-snapshot.test.mjs` (also part of `npm test`): masking, diffing, silent-problem detection, export checks, case list. No phone needed.
