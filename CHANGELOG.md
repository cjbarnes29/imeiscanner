# Changelog

What changed in each Android app / web release since 1.7. The web and the Android app are the same build; every version below was published together. Older notes: [1.6](RELEASE-1.6.md), [1.5](RELEASE-1.5.md), [1.4](RELEASE-1.4.md).

## 1.14.1 — one tap in One by one
- **One by one:** the main button is now **Download image + copy IMEI & next**. One tap saves the picture, copies IMEI 1 and goes to the next phone. The separate Copy IMEI button is gone; Copy S/N stays.

## 1.14.0 — clean pictures, text size
- Pictures sent or saved (WhatsApp, Bluetooth, Save to my phone, One by one) have **no text written on them**. They are resized to 1600 px and sharpened with a little extra contrast. The numbers stay in the caption and `numbers.txt`.
- The tick-box *Also write the IMEI / serial on each picture* is gone.
- Scanning and review: the Zoom/Full photo button, the camera countdown and the thumbnail remove buttons no longer sit on top of pictures; the photo area is taller and clearer.
- **Settings → Text size**: Small, Normal, Large, Extra large, remembered on the phone.

## 1.13.0 — choose the save folder once
- **One by one** and **Save to my phone** ask for a folder **once** (Android keeps the permission) and then save without asking, into `IMEI-<person>` inside it.
- Saving again **replaces** the earlier numbered pictures and `numbers.txt` automatically. Saving only "the rest" keeps the pictures already saved; `numbers.txt` always lists every phone.
- **Settings → Where files are saved** shows the folder, with Change folder and Forget this folder.

## 1.12.2 — faster, more reliable sending
- A send that was started and never finished no longer blocks the next one (the app used to refuse with "finish the current save").
- Pictures are shared as images (`image/*`) instead of "any file".
- Pictures go to the app as their own data in large pieces; the button shows *Preparing 8 of 40…* then *Sending 28 of 40…*.
- Writing the IMEI/serial on every picture is now off by default (it was the slow part; the caption carries the numbers) and stays available as a tick-box.

## 1.12.1 — Settings always reachable, one build everywhere
- On phones about 360 px wide and under, the header pushed **Settings** off the screen. The logo text now hides first and the buttons shrink.
- **Reset** is always available (it also clears results the app still has saved).
- Settings shows `Version X (commit) · Web / Android app`, written by the build, so the website and the app can be compared.
- Downloads are numbered in picture order with the IMEI: `001-352099001761002.jpg`. Saving the rest keeps each picture's place in the whole list.
- CI fix: the catalog lookup now reads its stored lists safely.

## 1.12.0 — one send, one caption; one by one; save to my phone
- **WhatsApp:** all pictures in one send with **one caption** listing every IMEI and serial once, in picture order. Over 30 pictures the app asks how many arrived and continues from there.
- **One by one** (per person): large picture and numbers, Copy IMEI / S/N, Download & next, Back, Skip, remembered position, Download all remaining.
- **Save to my phone** (per person): a folder with the pictures and a `numbers.txt`.

## 1.11.0 — Bluetooth fallback, review drafts
- The app checks whether WhatsApp is installed and works; if not (or WhatsApp took fewer pictures than sent) a pop-up offers **Bluetooth**, which sends the pictures with IMEI/serial written on them plus `numbers.txt`.
- Review: changes are kept while you move between pictures; after the last picture (or on close) a pop-up asks **Save all / Discard / Keep editing**.
- Review: every button is in **one floating bar**; warnings (bad IMEI, duplicate, checksum, failed send) **pop up** with OK.

## 1.10.x — built for 1000 photos
- **1.10.0:** batches up to **1000 photos**. The page reads the scan in slices, so 1000 records load in seconds. Saved pictures are kept at 1800 px. **Settings → What this app can handle** lists what works, what has a limit and what is not possible, with estimates for this phone. Excel/Word warn before too many pictures go inside one file. Long text goes through the phone's share menu.
- **1.10.1:** the **Unknown** tab lists the phones under each unknown model, with suggestions (misread code, similar models), fix-the-code and pick-the-model-for-all. **Settings → Check catalog** opens the downloaded Samsung catalog in a big dialog (search, edit, delete, add, restore; kept across catalog updates). The review question floats above the Save bar. Credit line *by CJB*.

## 1.9.x — adaptive speed, Unknown, sharing
- **1.9.0:** adaptive scan speed with **Auto / Turbo / Balanced / Safe**, the phone is measured (cores, memory, heat, battery saver); scanning several photos at once; the first OCR pass is reused (no double reading); results are saved in batches. **Reset** button. **Unknown** tab. Bluetooth / nearby share.
- **1.9.3:** device model drop-down with catalog and **add a model**; sideways or upside-down photos are retried at 90°/270°/180°; the preview opens on the phone box.
- **1.9.4:** model chooser in a big dialog; **Check models** dialog in Settings.
- **1.9.5:** share photos **from other apps into IMEI Lens**; scanning starts automatically.

## 1.8.0 and 1.7.0
- Compact header on phones, launcher icon, Android 15 edge-to-edge handling, release build settings. Review preview opens zoomed on the label. Settings gained Scan speed and bulk model names.
