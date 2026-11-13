# Scan performance profile and the second-pass OCR (emulator `imei-api35`, x86_64 with ARM translation; absolute times are pessimistic)

## 1. The reported regression: 12 to 19 s (Phase 1) vs 20 to 22 s (Phase 2) for the 6-photo accuracy set
Method: per-stage timers (`ImageScanner.Prof`, printed as `ms` in the `IMEI-Lens/diag` log line, no IMEIs), then an A/B of the Phase 1 final build and the Phase 2 build on the same device state, two rounds each, wall time from the first to the last photo.

| Build | Round 1 | Round 2 |
|---|---|---|
| Phase 1 final | 17.3 s | 16.6 s |
| Phase 2 (before the fix) | 20.8 s | 20.4 s |
| Phase 2 after the fix (standard, Auto) | 17.3 s | 18.1 s |
| Phase 2 after the fix, isolated phone-test APK (minified) | 18.6 s | |

The gap was real (about +3.5 s, +22 %) and sat in ONE photo: multi-03 took 2.4 s in Phase 1 and 4.8 s in Phase 2. Every other photo differed by 0.1 to 0.4 s (noise). The cause is the new enlarged re-read ("rescue") of a label without a valid IMEI 1: it tried two extra reads (about 2.1 to 2.3 s) on a label whose IMEI 1 is printed but fails its checksum, and found nothing.

### Where the time goes (6 photos, 13 labels, sum of stages)
| Stage | ms | share |
|---|---|---|
| ML Kit text read of the whole photo | 9,800 | 35 % |
| ML Kit re-read of each crop (13 reads) | 7,900 | 29 % |
| Barcode scan of the whole photo | 4,100 | 15 % |
| Tilt levelling re-read (2 photos) | 2,500 | 9 % |
| Rescue re-read (1 miss) | 2,100 | 8 % |
| Decode + JPEG save | 1,200 | 4 % |
Stages overlap (photos are read by parallel workers), so the stage sum exceeds the wall time.

### Fix
The slower second-pass reads now run only when they are asked for: Detailed speed, or a photo that was scanned before and still has a product without an IMEI (or failed). A first scan of a photo in Standard or Fast never pays for them. Result: the regression is gone and accuracy is unchanged (11/12 Standard/Auto, 12/12 Detailed + 4).

### Not optimized (candidates, each needs a measured accuracy check first)
* The 29 % crop re-read could reuse the lines of the whole-photo read when they already give a valid IMEI 1 and IMEI 2 for that crop. This risks losing the accuracy that re-reading a tighter crop gives, so it needs the phone photos as a test set.
* The 15 % barcode scan could be skipped when the text already gives checksum-valid IMEI 1 and 2 for every label.
* Tilt levelling costs an extra full read; it is only used for tilts above 2 degrees.

## 2. Optional second-pass OCR fallback for uncertain scans
Design (implemented): a label that has no valid IMEI 1 after the normal read gets up to two extra reads of an enlarged, grey, contrast-stretched copy; a photo where the product count is known from the labels but one is missing gets a contrast-boosted tile pass. Both run only on the second pass (see above), so successful scans are never slowed down.

Evidence so far (emulator set): second pass triggered once in 13 labels (0 hits, 1 miss, 2.1 s), in Detailed mode the same single trigger; the Detailed run took 19.4 s vs 17.3 to 18.1 s. The blurred label of `1-1000380365` is never a group in Auto, so it is never a candidate: it needs Detailed + the real product count.

Conclusion: keep it as an opt-in second pass; it has no measured benefit yet. The phone photo set (groups D, E, F) decides whether to keep, tune or remove it. Candidate tuning: one attempt instead of two when a 15-digit candidate exists; skip when the candidate only fails the checksum.
