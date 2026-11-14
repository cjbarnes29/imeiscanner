package com.imeilens.scanner;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.net.Uri;
import androidx.exifinterface.media.ExifInterface;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognizer;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ImageScanner {
    private static final Pattern LABEL_ONE = LabelGeometry.LABEL_ONE;
    private static final Pattern NUMBER = LabelGeometry.NUMBER;
    private static final Pattern FIRST = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*[1I]\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?!\\d)");
    private static final Pattern SECOND = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*2\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?!\\d)");

    private static final int RECORD_EDGE = 1800;

    private ImageScanner() {}

    static JSONArray scan(Context context, Uri uri, String filename, String personId, TextRecognizer recognizer, int maxEdge) throws Exception {
        return scan(context, uri, filename, personId, recognizer, maxEdge, "standard", 0);
    }

    /** Most products one photo is split into (the "Products in each photo" list goes up to 12). */
    static final int MAX_PRODUCTS = 12;

    /**
     * @param speed    "fast" (one read, no tilt or tile passes unless a product count is given), "standard" or
     *                 "detailed" (extra tile pass whenever two or more products are expected)
     * @param expected products the user says each photo holds, or 0 to count them from the labels (Auto)
     */
    static JSONArray scan(Context context, Uri uri, String filename, String personId, TextRecognizer recognizer, int maxEdge,
                          String speed, int expected) throws Exception {
        return scan(context, uri, filename, personId, recognizer, maxEdge, speed, expected, "detailed".equals(speed));
    }

    /** Extra reads (enlarged re-read of a label without IMEI 1, contrast-boosted tile pass) only run on a second pass: Detailed speed, or a photo that was scanned before and still needs a look. */
    private static final ThreadLocal<Boolean> SECOND_PASS = new ThreadLocal<>();
    private static boolean secondPass() { return Boolean.TRUE.equals(SECOND_PASS.get()); }

    /**
     * @param secondPass true to allow the slower rescue reads for labels that stay unreadable. First scans of a photo in Standard or Fast never pay for them.
     */
    static JSONArray scan(Context context, Uri uri, String filename, String personId, TextRecognizer recognizer, int maxEdge,
                          String speed, int expected, boolean secondPass) throws Exception {
        SECOND_PASS.set(secondPass);
        try { return scanOnce(context, uri, filename, personId, recognizer, maxEdge, speed, expected); }
        finally { SECOND_PASS.remove(); }
    }

    private static JSONArray scanOnce(Context context, Uri uri, String filename, String personId, TextRecognizer recognizer, int maxEdge,
                          String speed, int expected) throws Exception {
        final boolean fast = "fast".equals(speed), detailed = "detailed".equals(speed);
        expected = Math.max(0, Math.min(MAX_PRODUCTS, expected));
        Prof.begin();
        final long scanStart = Prof.now();
        long t0 = Prof.now();
        Bitmap bitmap = decode(context, uri, maxEdge);
        Prof.add("decode", t0);
        try {
            t0 = Prof.now();
            Text full = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)));
            Prof.add("ocrFull", t0);
            // No valid IMEI read: the photo may be sideways or upside down. Try the other turns and keep the best.
            int rotation = 0, best = score(full);
            if (best < 100) {
                for (int turn : new int[]{90, 270, 180}) {
                    Bitmap turned = rotate(bitmap, turn);
                    Text candidate;
                    long tr = Prof.now();
                    try { candidate = Tasks.await(recognizer.process(InputImage.fromBitmap(turned, 0))); Prof.add("ocrRotate", tr); }
                    catch (Exception error) { turned.recycle(); throw error; }
                    int value = score(candidate);
                    if (value > best + 10) { bitmap.recycle(); bitmap = turned; full = candidate; best = value; rotation = turn; }
                    else turned.recycle();
                    if (best >= 100) break;
                }
            }
            // A tilted photo: level it so the products can be separated with straight cuts.
            float tilt = medianAngle(full);
            if (!fast && Math.abs(tilt) >= (detailed ? 1.2f : 2f) && Math.abs(tilt) <= 20f) {
                long tl = Prof.now();
                Bitmap levelled = level(bitmap, -tilt);
                Text again;
                try { again = Tasks.await(recognizer.process(InputImage.fromBitmap(levelled, 0))); Prof.add("ocrLevel", tl); }
                catch (Exception error) { levelled.recycle(); throw error; }
                // Keep it only if the text really became straighter and nothing was lost.
                if (Math.abs(medianAngle(again)) < Math.abs(tilt) && score(again) >= score(full)) { bitmap.recycle(); bitmap = levelled; full = again; }
                else levelled.recycle();
            }
            t0 = Prof.now();
            List<Code> codes = barcodes(bitmap);
            Prof.add("barcodesFull", t0);
            LabelGeometry.Grouping grouping = grouping(linesOf(full), bitmap.getWidth(), bitmap.getHeight());
            List<Rect> labels = rects(grouping);
            // More "Model : SM-…" labels are visible than products were found: read the photo again in
            // overlapping pieces (each piece is read at a higher effective resolution) and look again.
            int counted = modelLabels(full);
            // The user's number wins; Auto uses the "Model : SM-…" lines. Distinct valid barcodes (two per label) also hint at how many labels there are.
            int target = expected > 0 ? expected : counted;
            int barcodeLabels = (distinctImeiBarcodes(codes) + 1) / 2;
            if (expected == 0 && barcodeLabels > target) target = Math.min(MAX_PRODUCTS, barcodeLabels);
            // Labels whose "Model" line the frame cut off still show their "S/N" line: a second opinion for Auto. It only starts the
            // re-read and, if a label is still missing, marks the photo for review ("1 device or N?"); it never creates a record.
            int serialLabels = LabelGeometry.landmarkLabels(items(linesOf(full)));
            if (expected == 0 && serialLabels > target) target = Math.min(MAX_PRODUCTS, serialLabels);
            List<Line> lines = null;
            final List<Line> firstLines = linesOf(full); // the first read: used when no re-read in tiles happened
            final int firstGroups = labels.size();
            final List<Rect> firstLabels = labels;
            final LabelGeometry.Grouping firstGrouping = grouping;
            int tilePasses = 0;
            if (target > labels.size() && target <= MAX_PRODUCTS && (!fast || expected > 1)) {
                lines = linesOf(full);
                t0 = Prof.now();
                lines = readInTiles(recognizer, bitmap, lines, target);
                Prof.add("tilesPass1", t0);
                tilePasses++;
                LabelGeometry.Grouping moreGrouping = grouping(lines, bitmap.getWidth(), bitmap.getHeight());
                List<Rect> more = rects(moreGrouping);
                if (more.size() > labels.size()) { labels = more; grouping = moreGrouping; }
                // Detailed: still short of the count, so look once more with finer pieces.
                if (detailed && target > labels.size() && target < MAX_PRODUCTS) {
                    t0 = Prof.now();
                    lines = readInTiles(recognizer, bitmap, lines, Math.min(MAX_PRODUCTS, target + 2));
                    Prof.add("tilesFine", t0);
                    tilePasses++;
                    moreGrouping = grouping(lines, bitmap.getWidth(), bitmap.getHeight());
                    more = rects(moreGrouping);
                    if (more.size() > labels.size()) { labels = more; grouping = moreGrouping; }
                }
                // Auto count (the number comes from the labels themselves: Model lines or barcodes) and a label is still missing:
                // blurred or washed-out text is read again in tiles on a contrast-stretched copy. Not used for a number the user typed in,
                // so a too-high setting cannot invent products.
                if (expected == 0 && !fast && secondPass() && target > labels.size()) {
                    Bitmap boosted = null;
                    t0 = Prof.now();
                    try {
                        boosted = enhance(bitmap, 1f, 1.8f);
                        List<Line> boostedLines = readInTiles(recognizer, boosted, lines, target);
                        Prof.add("tilesBoosted", t0);
                        tilePasses++;
                        LabelGeometry.Grouping boostedGrouping = grouping(boostedLines, bitmap.getWidth(), bitmap.getHeight());
                        List<Rect> boostedRects = rects(boostedGrouping);
                        if (boostedRects.size() > labels.size() && boostedRects.size() <= target) { labels = boostedRects; grouping = boostedGrouping; lines = boostedLines; }
                    } catch (Exception error) { /* an extra read never breaks a scan */ }
                    finally { if (boosted != null) boosted.recycle(); }
                }
            }
            // Fewer products found than expected: never save them quietly as if all were found.
            final boolean short_ = target >= 2 && labels.size() < target;
            // Why a label is missing (cut by an edge, partly read, unreadable): explained to the person, never guessed; set on every record of the photo.
            final LabelIssue.Result issue = short_ ? LabelIssue.classify(items(lines != null ? lines : firstLines), grouping.hits, bitmap.getWidth(), bitmap.getHeight()) : null;
            final int missingLabels = short_ ? target - labels.size() : 0;
            String sourceId = pictureId();
            JSONArray output = new JSONArray();
            final JSONObject diag = diagStart(filename, bitmap, rotation, tilt, speed, expected, counted, barcodeLabels, target, grouping, firstGroups, tilePasses);
            diagAnchors(diag, linesOf(full));
            try {
                // Diagnostics only: every decoded barcode, masked, with its place and whether its checksum is valid.
                JSONArray barcodes = new JSONArray();
                for (Code code : codes) barcodes.put(new JSONArray().put(LabelGeometry.mask(code.value.replaceAll("\\D", "").length() == 15 ? code.value.replaceAll("\\D", "") : ""))
                    .put(code.box.left).put(code.box.top).put(code.box.right).put(code.box.bottom).put(luhn(code.value)).put(code.value.length()));
                diag.put("barcodes", barcodes);
            } catch (Exception ignored) { /* diagnostics only */ }
            try { diag.put("serialLabels", serialLabels); } catch (Exception ignored) { /* diagnostics only */ }
            if (labels.size() <= 1) {
                output.put(makeRecord(context, bitmap, filename, personId, sourceId, uri, short_, recognizer, full, rotation, codes, null, short_ ? target : 0, ""));
                if (issue == null && output.length() == 1) markRecordIssue(output.getJSONObject(0), items(lines != null ? lines : firstLines), grouping.hits, bitmap.getWidth(), bitmap.getHeight());
                markIssue(output, issue, missingLabels, diag);
                markOrphans(diag, codes, output);
                diagFinish(diag, output, "single", "one label or fewer", 0);
                return output;
            }
            String[] why = new String[1];
            List<Rect> regions = boxRegions(bitmap, labels, why);
            // The finer read found more groups than could be cut apart (a too-high "Products in each photo" makes a fragment look like a label):
            // the first, cleaner grouping is used instead of giving up on the split. The crops are then flagged for review.
            boolean retriedFirst = false;
            if (regions.isEmpty() && firstLabels.size() >= 2 && firstLabels.size() < labels.size()) {
                List<Rect> retry = boxRegions(bitmap, firstLabels, new String[1]);
                if (!retry.isEmpty()) { regions = retry; labels = firstLabels; grouping = firstGrouping; retriedFirst = true; try { diag.put("retriedFirstGrouping", true); } catch (Exception ignored) { /* diagnostics only */ } }
            }
            if (regions.isEmpty()) {
                // Keep the full photo available for guided manual cropping rather than saving cut-off labels.
                output.put(makeRecord(context, bitmap, filename, personId, sourceId, uri, true, recognizer, full, rotation, codes, null, Math.max(target, labels.size()), ""));
                markIssue(output, issue, missingLabels, diag);
                markOrphans(diag, codes, output);
                diagFinish(diag, output, "whole-photo", why[0], 0);
                return output;
            }
            boolean perspectiveReview = short_ || retriedFirst || (target >= 2 && labels.size() < target);
            for (int index = 1; index < regions.size(); index++)
                if (Rect.intersects(regions.get(index - 1), regions.get(index))) perspectiveReview = true;
            // What the whole-photo read saw as each label's printed IMEI 1 (checksum-valid, inside the label). A number claimed by two labels is dropped.
            List<String> printed = new ArrayList<>();
            for (Rect region : regions) printed.add(LabelGeometry.printedImei1In(grouping.hits, new LabelGeometry.Box(region.left, region.top, region.right, region.bottom)));
            for (int a = 0; a < printed.size(); a++) for (int b = a + 1; b < printed.size(); b++)
                if (!printed.get(a).isEmpty() && printed.get(a).equals(printed.get(b))) { printed.set(a, ""); printed.set(b, ""); }
            for (int index = 0; index < regions.size(); index++) {
                Rect region = regions.get(index);
                Bitmap crop = Bitmap.createBitmap(bitmap, region.left, region.top, region.width(), region.height());
                try {
                    JSONObject made = makeRecord(context, crop, filename, personId, sourceId, uri, perspectiveReview, recognizer, null, rotation, codes, region, 0, printed.get(index));
                    {
                        LabelGeometry.Box area = new LabelGeometry.Box(region.left, region.top, region.right, region.bottom);
                        markRecordIssue(made, LabelIssue.itemsIn(items(lines != null ? lines : firstLines), area), LabelIssue.hitsIn(grouping.hits, area), bitmap.getWidth(), bitmap.getHeight());
                    }
                    output.put(made);
                } finally { crop.recycle(); }
            }
            for (int index = 0; index < output.length(); index++) output.getJSONObject(index).put("siblings", output.length());
            markIssue(output, issue, missingLabels, diag);
            markOrphans(diag, codes, output);
            diagFinish(diag, output, "split", "ok", regions.size());
            return output;
        } finally { bitmap.recycle(); }
    }

    // ---- Diagnostics: why a photo was split, kept whole or counted the way it was. IMEIs are always masked (first 8 + last 4 digits). ----

    private static final String TAG = "IMEI-Lens/diag";

    /** The "possible missed label" hint (barcode numbers that match no label). Disabled until it is proven on real photos; the code stays. */
    static final boolean ORPHAN_HINT_ENABLED = false;

    /** Per-scan stage timings (milliseconds and call counts), printed with the diagnostics line so slow stages can be found before optimizing. */
    static final class Prof {
        private static final ThreadLocal<java.util.LinkedHashMap<String, long[]>> STAGES = new ThreadLocal<>();
        static void begin() { STAGES.set(new java.util.LinkedHashMap<>()); }
        static long now() { return android.os.SystemClock.elapsedRealtime(); }
        static void add(String stage, long since) {
            java.util.LinkedHashMap<String, long[]> map = STAGES.get();
            if (map == null) return;
            long[] slot = map.get(stage);
            if (slot == null) { slot = new long[2]; map.put(stage, slot); }
            slot[0] += now() - since; slot[1]++;
        }
        static JSONObject end() {
            JSONObject out = new JSONObject();
            java.util.LinkedHashMap<String, long[]> map = STAGES.get();
            STAGES.remove();
            if (map == null) return out;
            try { for (java.util.Map.Entry<String, long[]> entry : map.entrySet()) out.put(entry.getKey(), entry.getValue()[0] + "ms x" + entry.getValue()[1]); } catch (Exception ignored) { /* diagnostics only */ }
            return out;
        }
    }

    /** A record without any IMEI: say why, from the lines of its own label area only (the photo's edges decide "cut off"). Never adds a number. */
    private static void markRecordIssue(JSONObject row, List<LabelGeometry.Item> lines, List<LabelGeometry.Hit> hits, int width, int height) {
        if (!row.optString("imei").isEmpty() || row.optBoolean("imeiFallback")) return;
        try {
            LabelIssue.Result issue = LabelIssue.classify(lines, hits, width, height);
            row.put("labelIssue", issue.kind).put("labelsMissing", 1);
            if (!issue.side.isEmpty()) row.put("labelIssueSide", issue.side);
            if (issue.digits > 0) row.put("labelIssueDigits", issue.digits);
        } catch (Exception ignored) { /* the explanation is optional */ }
    }

    /** Adds the explanation (never a number) to every record of a photo that is missing a label. */
    private static void markIssue(JSONArray output, LabelIssue.Result issue, int missing, JSONObject diag) {
        if (issue == null) return;
        try {
            for (int index = 0; index < output.length(); index++) {
                JSONObject row = output.getJSONObject(index);
                if (row.has("labelIssue")) continue; // a more specific reason for this very record is already there
                row.put("labelIssue", issue.kind).put("labelsMissing", Math.max(1, missing));
                if (!issue.side.isEmpty()) row.put("labelIssueSide", issue.side);
                if (issue.digits > 0) row.put("labelIssueDigits", issue.digits);
            }
            diag.put("labelIssue", issue.kind + (issue.side.isEmpty() ? "" : ":" + issue.side));
        } catch (Exception ignored) { /* the explanation is optional: never breaks a scan */ }
    }

    private static List<LabelGeometry.Item> items(List<Line> lines) {
        List<LabelGeometry.Item> out = new ArrayList<>(lines.size());
        for (Line line : lines) out.add(new LabelGeometry.Item(line.text, new LabelGeometry.Box(line.box.left, line.box.top, line.box.right, line.box.bottom)));
        return out;
    }

    private static LabelGeometry.Grouping grouping(List<Line> lines, int width, int height) { return LabelGeometry.group(items(lines), width, height); }

    private static List<Rect> rects(LabelGeometry.Grouping grouping) {
        List<Rect> out = new ArrayList<>(grouping.groups.size());
        for (LabelGeometry.Box box : grouping.groups) out.add(new Rect(box.left, box.top, box.right, box.bottom));
        return out;
    }

    private static JSONObject diagStart(String filename, Bitmap bitmap, int rotation, float tilt, String speed, int expected, int counted,
                                        int barcodeLabels, int target, LabelGeometry.Grouping grouping, int firstGroups, int tilePasses) {
        JSONObject diag = new JSONObject();
        try {
            diag.put("v", 1).put("photo", filename).put("w", bitmap.getWidth()).put("h", bitmap.getHeight()).put("rot", rotation)
                .put("tilt", Math.round(tilt * 10) / 10.0).put("speed", speed).put("expected", expected)
                .put("modelLines", counted).put("barcodeLabels", barcodeLabels).put("target", target)
                .put("groupsFirstRead", firstGroups).put("tilePasses", tilePasses).put("groups", grouping.groups.size()).put("vertical", grouping.vertical)
                .put("edgeFragments", grouping.fragments);
            JSONArray hits = new JSONArray();
            for (LabelGeometry.Hit hit : grouping.hits)
                hits.put(new JSONObject().put("b", new JSONArray().put(hit.box.left).put(hit.box.top).put(hit.box.right).put(hit.box.bottom))
                    .put("n", LabelGeometry.mask(hit.number)).put("g", hit.group).put("why", hit.note)
                    .put("d", hit.digits).put("len", hit.length).put("luhn", ImeiSource.luhn(hit.number)));
            diag.put("imeiOneLines", hits);
        } catch (Exception ignored) { /* diagnostics must never break a scan */ }
        return diag;
    }

    /**
     * Valid IMEI barcodes on the photo whose number appears in none of the records: a label may have been missed (blurred text, no
     * group found). Every record of the photo carries the count, the report flags the photo and the scan can be repeated.
     */
    private static void markOrphans(JSONObject diag, List<Code> codes, JSONArray output) {
        try {
            if (!ORPHAN_HINT_ENABLED || codes == null || codes.isEmpty()) return;
            StringBuilder known = new StringBuilder();
            for (int index = 0; index < output.length(); index++) known.append(output.getJSONObject(index).optString("raw").replaceAll("[^0-9]", " ")).append(' ');
            String digits = known.toString().replaceAll("\\s+", "");
            Set<String> orphans = new HashSet<>();
            for (Code code : codes) if (luhn(code.value) && !digits.contains(code.value)) orphans.add(code.value);
            if (orphans.isEmpty()) return;
            JSONArray masked = new JSONArray();
            for (String value : orphans) masked.put(LabelGeometry.mask(value));
            diag.put("orphanBarcodes", masked);
            for (int index = 0; index < output.length(); index++) output.getJSONObject(index).put("orphanBarcodes", orphans.size());
        } catch (Exception ignored) { /* a hint only */ }
    }

    private static final Pattern DIAG_IMEI_TWO = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*2\\b");
    private static final Pattern DIAG_SERIAL = Pattern.compile("(?i)\\bS\\s*/\\s*N\\b");
    private static final Pattern DIAG_STORAGE = Pattern.compile("(?i)\\b\\d{1,4}\\s*[GT]B\\b");

    /** Diagnostics only: where the first read saw label landmarks (Model, IMEI 2, S/N lines). Positions and text length, never digits. */
    private static void diagAnchors(JSONObject diag, List<Line> lines) {
        try {
            JSONArray model = new JSONArray(), imeiTwo = new JSONArray(), serial = new JSONArray(), storage = new JSONArray(), other = new JSONArray();
            for (Line line : lines) {
                JSONArray where = new JSONArray().put(line.box.left).put(line.box.top).put(line.box.right).put(line.box.bottom).put(line.text.length());
                if (MODEL_LINE.matcher(line.text).find()) model.put(where);
                else if (DIAG_IMEI_TWO.matcher(line.text).find()) imeiTwo.put(where);
                else if (DIAG_SERIAL.matcher(line.text).find()) serial.put(where);
                else if (DIAG_STORAGE.matcher(line.text).find()) storage.put(where.put(line.text.replaceAll("[0-9]", "#")).put(LabelGeometry.STORAGE.matcher(line.text).find()));
                else {
                    // Other text as a shape only: every digit becomes '#', so no number can appear in the log.
                    String shape = line.text.replaceAll("[0-9]", "#").replaceAll("[^#A-Za-z/|:. -]", "");
                    other.put(where.put(shape.substring(0, Math.min(14, shape.length()))));
                }
            }
            diag.put("anchors", new JSONObject().put("model", model).put("imei2", imeiTwo).put("sn", serial).put("storage", storage).put("other", other));
        } catch (Exception ignored) { /* diagnostics must never break a scan */ }
    }

    private static void diagFinish(JSONObject diag, JSONArray output, String path, String why, int regions) {
        try {
            diag.put("path", path).put("why", why == null ? "" : why).put("regions", regions);
            JSONArray found = new JSONArray();
            for (int index = 0; index < output.length(); index++) {
                String imei = output.getJSONObject(index).optString("imei");
                found.put(imei.isEmpty() ? "" : LabelGeometry.mask(imei));
            }
            diag.put("recordImeis", found);
            diag.put("ms", Prof.end());
            int fallbacks = 0;
            for (int index = 0; index < output.length(); index++) if (output.getJSONObject(index).optBoolean("imeiFallback")) fallbacks++;
            if (fallbacks > 0) diag.put("imei2Fallback", fallbacks);
            String text = diag.toString();
            android.util.Log.d(TAG, text);
            // Kept on the records that need a look (no IMEI, or flagged), so the cause can be traced later without a computer.
            for (int index = 0; index < output.length(); index++) {
                JSONObject row = output.getJSONObject(index);
                if (row.optString("imei").isEmpty() || row.optBoolean("cropNeedsReview")) row.put("diag", text.length() > 2400 ? text.substring(0, 2400) : text);
            }
        } catch (Exception ignored) { /* diagnostics must never break a scan */ }
    }

    private static JSONObject makeRecord(Context context, Bitmap photo, String filename, String personId,
                                         String sourceId, Uri sourceUri, boolean cropReview, TextRecognizer recognizer, Text known, int rotation,
                                         List<Code> codes, Rect region, int deviceCount, String printedImei1) throws Exception {
        // Whole-photo records reuse the first OCR pass instead of reading the same bitmap twice.
        long tm = Prof.now();
        Text ocr = known != null ? known : Tasks.await(recognizer.process(InputImage.fromBitmap(photo, 0)));
        if (known == null) Prof.add("ocrCrop", tm);
        String raw = ocr.getText();
        String imei = preferredImei(ocr);
        // Blurred or washed-out label: one more read, enlarged and with stronger contrast, before giving up on IMEI 1.
        if (secondPass() && firstImeiIn(raw).isEmpty()) {
            tm = Prof.now();
            String extra = rescueText(recognizer, photo);
            Prof.add(extra.isEmpty() ? "rescueMiss" : "rescueHit", tm);
            if (!extra.isEmpty()) { raw += "\n" + extra; imei = firstImeiIn(extra); }
        }
        // Barcodes are exact: pair each with the "IMEI 1" / "IMEI 2" text printed under it.
        String barcode1 = labelledBarcode(ocr, codes, region, LABEL_ONE), barcode2 = labelledBarcode(ocr, codes, region, LABEL_TWO);
        // IMEI 1's own text line was not read: find IMEI 1's barcode by the Samsung same-device rule (same serial part as this label's IMEI 2).
        // Samsung labels only (the label's text must show SAMSUNG or an SM- model code); the number is the barcode's own, never computed from
        // IMEI 2; and unless the printed IMEI 1 confirms it, the record is marked for review.
        boolean imei1ByRule = false;
        if (barcode1.isEmpty() && SamsungImei.isSamsungLabel(raw)) {
            String anchor = ImeiSource.secondImeiInText(raw);
            if (anchor.isEmpty()) anchor = barcode2;
            if (!anchor.isEmpty()) {
                List<String> values = new ArrayList<>();
                if (codes != null) for (Code code : codes) values.add(code.value);
                String found = SamsungImei.sameDeviceImei1(anchor, values);
                // Not among the photo's barcodes: read the barcodes of this label again, enlarged (only for a record that would show IMEI 2 only).
                if (found.isEmpty() && (imei.isEmpty() || ImeiSource.usesSecondImei(raw, imei))) {
                    long tb = Prof.now();
                    for (Code code : barcodesEnlarged(photo)) values.add(code.value);
                    found = SamsungImei.sameDeviceImei1(anchor, values);
                    Prof.add(found.isEmpty() ? "barcodeRetryMiss" : "barcodeRetryHit", tb);
                }
                if (!found.isEmpty()) {
                    barcode1 = found;
                    imei1ByRule = !found.equals(firstImeiIn(raw)); // the printed IMEI 1, when read, confirms it
                    if (barcode2.equals(found)) barcode2 = ""; // that barcode was IMEI 1, wrongly taken as IMEI 2 (a wide barcode box over both lines)
                }
            }
        }
        // The label's own crop gave no IMEI 1 (nothing, or only IMEI 2), but the whole-photo read had this label's printed IMEI 1 line with a
        // valid checksum: that number is used, marked for review (it was not confirmed by the label's own read). Never when a barcode decided.
        boolean imei1FromPhoto = false;
        if (barcode1.isEmpty() && !printedImei1.isEmpty() && (imei.isEmpty() || ImeiSource.usesSecondImei(raw, imei)) && !printedImei1.equals(barcode2)) {
            imei = printedImei1; imei1FromPhoto = true; raw += "\nIMEI 1 (photo): " + printedImei1;
        }
        if (!barcode2.isEmpty() && barcode2.equals(barcode1)) barcode2 = "";
        if (!barcode1.isEmpty()) { imei = barcode1; raw += "\nIMEI 1 (barcode): " + barcode1; }
        if (!barcode2.isEmpty()) raw += "\nIMEI 2 (barcode): " + barcode2;
        String id = UUID.randomUUID().toString();
        // Saved pictures are kept small (long edge 1800 px): 1000 full-size pictures would not fit in the page's memory.
        Bitmap saved = photo;
        int longest = Math.max(photo.getWidth(), photo.getHeight());
        if (longest > RECORD_EDGE) {
            float factor = RECORD_EDGE / (float) longest;
            saved = Bitmap.createScaledBitmap(photo, Math.max(1, Math.round(photo.getWidth() * factor)), Math.max(1, Math.round(photo.getHeight() * factor)), true);
        }
        tm = Prof.now();
        try (FileOutputStream stream = new FileOutputStream(ScanStore.image(context, id))) {
            if (!saved.compress(Bitmap.CompressFormat.JPEG, 80, stream)) throw new IllegalStateException("Could not save crop");
        } finally { if (saved != photo) saved.recycle(); Prof.add("saveJpeg", tm); }
        JSONObject row = new JSONObject();
        row.put("id", id);
        row.put("pictureId", pictureId());
        row.put("sourcePictureId", sourceId);
        row.put("sourceUri", sourceUri.toString());
        row.put("personId", personId);
        row.put("name", filename);
        row.put("imageName", id + ".jpg");
        String modelText = raw + " " + filename;
        row.put("model", model(modelText));
        // Never silent about an unclear model code: the record asks for a check (the IMEI status is not affected).
        SamsungModel.Reading modelReading = SamsungModel.read(modelText);
        if (modelReading.uncertain && !modelReading.note.isEmpty()) { row.put("modelNeedsReview", true); row.put("modelNote", modelReading.note); }
        // No model code read at all (only a series name, or nothing): never presented as a checked model.
        else if (modelReading.model.isEmpty()) { row.put("modelNeedsReview", true); row.put("modelNote", SamsungModel.NO_CODE_NOTE); }
        row.put("imei", imei);
        // Never silent: when only the label's IMEI 2 could be read, the number is kept but marked so the app asks for a review.
        if (!imei.isEmpty() && ImeiSource.usesSecondImei(raw, imei)) row.put("imeiFallback", true);
        // IMEI 1 found by a rule, not read from its own printed line: kept, but never accepted without a person's check.
        if (imei1ByRule && imei.equals(barcode1)) { row.put("imeiNeedsReview", true); row.put("imeiNote", SamsungImei.RULE_NOTE); }
        else if (imei1FromPhoto) { row.put("imeiNeedsReview", true); row.put("imeiNote", ImeiSource.PHOTO_READ_NOTE); }
        row.put("status", imei.isEmpty() ? "Review" : "Valid");
        row.put("cropNeedsReview", cropReview);
        // The review screen asks "1 device or N?" for a photo that shows more labels than could be separated.
        if (cropReview && deviceCount > 1 && region == null) row.put("deviceCount", deviceCount);
        row.put("duplicate", false);
        java.text.SimpleDateFormat clock = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
        clock.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        row.put("createdAt", clock.format(new java.util.Date()));
        row.put("raw", raw);
        if (rotation != 0) row.put("rotation", rotation);
        if (known != null) { JSONObject focus = focusBox(ocr, photo); if (focus != null) row.put("focus", focus); }
        row.put("number", 0);
        return row;
    }

    private static final Pattern LABEL_TEXT = Pattern.compile("(?i)IM[E3][I1!|l]|\\bS/?N\\b|SERIAL|MODEL|SM-[A-Z]\\d{3}|(?<!\\d)(?:\\d[\\s-]*){15}(?!\\d)");

    /** How much label text was read: a valid IMEI counts most, then label words, then amount of text. */
    private static int score(Text text) {
        String raw = text.getText().replace('\n', ' ');
        int total = 0;
        Matcher numbers = NUMBER.matcher(raw);
        while (numbers.find()) if (luhn(numbers.group().replaceAll("\\D", ""))) total += 100;
        Matcher words = LABEL_TEXT.matcher(raw);
        while (words.find()) total += 10;
        return total + Math.min(raw.length() / 20, 10);
    }

    static Bitmap rotate(Bitmap source, int degrees) {
        Matrix matrix = new Matrix();
        matrix.postRotate(degrees);
        return Bitmap.createBitmap(source, 0, 0, source.getWidth(), source.getHeight(), matrix, true);
    }

    /**
     * Where the phone box is in the photo, as fractions of its width and height, so the review screen can open
     * on the whole box. It grows outward from the label text over pixels of the same colour as the label paper.
     * Falls back to a generous area around the text. Null when no label text was found or the box fills the photo.
     */
    static JSONObject focusBox(Text text, Bitmap photo) {
        int width = photo.getWidth(), height = photo.getHeight();
        Rect union = null;
        for (Text.TextBlock block : text.getTextBlocks()) for (Text.Line line : block.getLines()) {
            Rect box = line.getBoundingBox();
            if (box == null || !LABEL_TEXT.matcher(line.getText()).find()) continue;
            if (union == null) union = new Rect(box); else union.union(box);
        }
        if (union == null || width <= 0 || height <= 0) return null;
        union.intersect(0, 0, width, height);
        double left, top, right, bottom;
        Rect whole = wholeBox(photo, union);
        if (whole != null) {
            int padX = Math.max(4, width / 33), padY = Math.max(4, height / 33);
            left = Math.max(0, whole.left - padX); top = Math.max(0, whole.top - padY);
            right = Math.min(width, whole.right + padX); bottom = Math.min(height, whole.bottom + padY);
        } else {
            int padX = Math.max(union.width() * 35 / 100, width / 16), padY = Math.max(union.height() * 80 / 100, height / 12);
            left = Math.max(0, union.left - padX); top = Math.max(0, union.top - padY);
            right = Math.min(width, union.right + padX); bottom = Math.min(height, union.bottom + padY);
        }
        double w = (right - left) / width, h = (bottom - top) / height;
        if (w * h > 0.75 || w < 0.05 || h < 0.03) return null;
        try {
            return new JSONObject().put("x", left / width).put("y", top / height).put("w", w).put("h", h);
        } catch (Exception error) { return null; }
    }

    private static Rect wholeBox(Bitmap photo, Rect text) {
        int width = photo.getWidth(), height = photo.getHeight();
        int step = Math.max(2, Math.max(width, height) / 160);
        int gw = (width + step - 1) / step, gh = (height + step - 1) / step;
        int[] colors = new int[gw * gh];
        for (int gy = 0; gy < gh; gy++) for (int gx = 0; gx < gw; gx++)
            colors[gy * gw + gx] = photo.getPixel(Math.min(width - 1, gx * step + step / 2), Math.min(height - 1, gy * step + step / 2));
        int tx0 = Math.max(0, text.left / step), tx1 = Math.min(gw - 1, text.right / step);
        int ty0 = Math.max(0, text.top / step), ty1 = Math.min(gh - 1, text.bottom / step);
        if (tx1 < tx0 || ty1 < ty0) return null;
        // Label paper colour: the average of the brighter half of the pixels under the text.
        List<Integer> lums = new ArrayList<>();
        for (int gy = ty0; gy <= ty1; gy++) for (int gx = tx0; gx <= tx1; gx++) lums.add(lum(colors[gy * gw + gx]));
        if (lums.isEmpty()) return null;
        java.util.Collections.sort(lums);
        int median = lums.get(lums.size() / 2);
        long sr = 0, sg = 0, sb = 0, count = 0;
        for (int gy = ty0; gy <= ty1; gy++) for (int gx = tx0; gx <= tx1; gx++) {
            int c = colors[gy * gw + gx];
            if (lum(c) < median) continue;
            sr += c >> 16 & 255; sg += c >> 8 & 255; sb += c & 255; count++;
        }
        if (count == 0) return null;
        int rr = (int) (sr / count), gg = (int) (sg / count), bb = (int) (sb / count);
        boolean[] paper = new boolean[gw * gh];
        for (int index = 0; index < paper.length; index++) {
            int c = colors[index];
            paper[index] = Math.abs((c >> 16 & 255) - rr) + Math.abs((c >> 8 & 255) - gg) + Math.abs((c & 255) - bb) < 110;
        }
        boolean[] seen = new boolean[gw * gh];
        int[] queue = new int[gw * gh];
        int head = 0, tail = 0, minX = gw, minY = gh, maxX = -1, maxY = -1, cells = 0;
        for (int gy = ty0; gy <= ty1; gy++) for (int gx = tx0; gx <= tx1; gx++) {
            int index = gy * gw + gx;
            if (paper[index] && !seen[index]) { seen[index] = true; queue[tail++] = index; }
        }
        while (head < tail) {
            int index = queue[head++], x = index % gw, y = index / gw;
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); cells++;
            if (x > 0 && paper[index - 1] && !seen[index - 1]) { seen[index - 1] = true; queue[tail++] = index - 1; }
            if (x < gw - 1 && paper[index + 1] && !seen[index + 1]) { seen[index + 1] = true; queue[tail++] = index + 1; }
            if (y > 0 && paper[index - gw] && !seen[index - gw]) { seen[index - gw] = true; queue[tail++] = index - gw; }
            if (y < gh - 1 && paper[index + gw] && !seen[index + gw]) { seen[index + gw] = true; queue[tail++] = index + gw; }
        }
        if (maxX < 0) return null;
        Rect found = new Rect(minX * step, minY * step, Math.min(width, (maxX + 1) * step), Math.min(height, (maxY + 1) * step));
        found.union(text);
        double area = (double) found.width() * found.height() / ((double) width * height);
        // Too large: the colour leaked into the table or wall. Too small: only the text patch was found.
        if (area > 0.6 || found.width() * found.height() < text.width() * text.height() * 1.3) return null;
        return found;
    }

    private static int lum(int color) {
        return ((color >> 16 & 255) * 3 + (color >> 8 & 255) * 6 + (color & 255)) / 10;
    }

    private static String pictureId() { return "PIC-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(java.util.Locale.ROOT); }

    static Bitmap decode(Context context, Uri uri) throws Exception { return decode(context, uri, 3000); }

    static Bitmap decode(Context context, Uri uri, int maxEdge) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        try (InputStream stream = context.getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(stream, null, bounds); }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sample > maxEdge) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = sample;
        Bitmap bitmap;
        try (InputStream stream = context.getContentResolver().openInputStream(uri)) { bitmap = BitmapFactory.decodeStream(stream, null, options); }
        if (bitmap == null) throw new IllegalArgumentException("Cannot decode image");
        int orientation;
        try (InputStream stream = context.getContentResolver().openInputStream(uri)) {
            orientation = new ExifInterface(stream).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        }
        Matrix matrix = new Matrix();
        if (orientation == ExifInterface.ORIENTATION_ROTATE_90) matrix.postRotate(90);
        else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) matrix.postRotate(180);
        else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) matrix.postRotate(270);
        else return bitmap;
        Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        bitmap.recycle();
        return rotated;
    }

    /** One line of read text and where it is. */
    static final class Line { final String text; final Rect box; Line(String text, Rect box) { this.text = text; this.box = box; } }

    static List<Line> linesOf(Text text) {
        List<Line> lines = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) for (Text.Line line : block.getLines())
            if (line.getBoundingBox() != null) lines.add(new Line(line.getText(), new Rect(line.getBoundingBox())));
        return lines;
    }

    /** The same text already known at about the same place (tiles overlap, so lines are read twice). */
    static boolean repeats(List<Line> lines, String text, Rect box) {
        for (Line known : lines)
            if (known.text.trim().equals(text.trim()) && Math.abs(known.box.centerX() - box.centerX()) < Math.max(24, box.height() * 2)
                && Math.abs(known.box.centerY() - box.centerY()) < Math.max(24, box.height() * 2)) return true;
        return false;
    }

    /** Read the photo again in overlapping pieces and add every line that was not already known. */
    private static List<Line> readInTiles(TextRecognizer recognizer, Bitmap bitmap, List<Line> known, int products) throws Exception {
        for (Rect tile : tiles(bitmap.getWidth(), bitmap.getHeight(), products)) {
            Bitmap part = Bitmap.createBitmap(bitmap, tile.left, tile.top, tile.width(), tile.height());
            try {
                Text read = Tasks.await(recognizer.process(InputImage.fromBitmap(part, 0)));
                for (Line line : linesOf(read)) {
                    Rect box = new Rect(line.box); box.offset(tile.left, tile.top);
                    if (!repeats(known, line.text, box)) known.add(new Line(line.text, box));
                }
            } finally { part.recycle(); }
        }
        return known;
    }

    /** Different 15-digit barcodes that pass the IMEI checksum (a label has one per IMEI). */
    static int distinctImeiBarcodes(List<Code> codes) {
        Set<String> values = new HashSet<>();
        for (Code code : codes) if (luhn(code.value)) values.add(code.value);
        return values.size();
    }

    private static final Pattern MODEL_LINE = Pattern.compile("(?i)m[o0]del\\s*[:;.]?\\s*s\\s*m");
    /** How many product labels the text shows, counted by their "Model : SM-…" lines (one per label). */
    static int modelLabels(Text text) {
        List<Rect> found = new ArrayList<>();
        for (Line line : linesOf(text)) {
            if (!MODEL_LINE.matcher(line.text).find()) continue;
            boolean seen = false;
            for (Rect known : found)
                if (Math.abs(known.centerY() - line.box.centerY()) < Math.max(12, line.box.height() * 3 / 2)
                    && Math.abs(known.centerX() - line.box.centerX()) < Math.max(40, line.box.height() * 6)) seen = true;
            if (!seen) found.add(line.box);
        }
        return found.size();
    }

    /** Overlapping pieces: 2 labels → halves, 3 → thirds, 4 → 2×2, 5-6 → 3×2, 7-8 → 4×2, 9-12 → 4×3 (long side first). */
    static List<Rect> tiles(int width, int height, int products) {
        boolean landscape = width >= height;
        int along = products <= 2 ? 2 : products == 3 ? 3 : products == 4 ? 2 : products <= 6 ? 3 : products <= 8 ? 4 : products == 9 ? 3 : 4;
        int across = products <= 3 ? 1 : products <= 6 ? 2 : products <= 8 ? 2 : 3;
        int cols = landscape ? along : across, rows = landscape ? across : along;
        double tw = (double) width / cols, th = (double) height / rows, overlap = 0.14;
        List<Rect> out = new ArrayList<>();
        for (int r = 0; r < rows; r++) for (int col = 0; col < cols; col++) {
            int x0 = (int) Math.max(0, col * tw - (col > 0 ? tw * overlap : 0)), x1 = (int) Math.min(width, (col + 1) * tw + (col < cols - 1 ? tw * overlap : 0));
            int y0 = (int) Math.max(0, r * th - (r > 0 ? th * overlap : 0)), y1 = (int) Math.min(height, (r + 1) * th + (r < rows - 1 ? th * overlap : 0));
            if (x1 - x0 > 8 && y1 - y0 > 8) out.add(new Rect(x0, y0, x1, y1));
        }
        return out;
    }

    /** @param why receives, in why[0], the reason when no regions could be made (diagnostics only). */
    private static List<Rect> boxRegions(Bitmap image, List<Rect> labels, String[] why) {
        int width = image.getWidth(), height = image.getHeight();
        int xSpread = labels.stream().mapToInt(Rect::centerX).max().orElse(0) - labels.stream().mapToInt(Rect::centerX).min().orElse(0);
        int ySpread = labels.stream().mapToInt(Rect::centerY).max().orElse(0) - labels.stream().mapToInt(Rect::centerY).min().orElse(0);
        boolean vertical = (double) ySpread / height >= (double) xSpread / width;
        List<Rect> ordered = new ArrayList<>(labels);
        ordered.sort(vertical ? Comparator.comparingInt(Rect::centerY) : Comparator.comparingInt(Rect::centerX));
        int extent = vertical ? height : width;
        List<int[]> seams = new ArrayList<>();
        for (int index = 1; index < ordered.size(); index++) {
            Rect before = ordered.get(index - 1), after = ordered.get(index);
            int from = vertical ? before.bottom : before.right;
            int to = vertical ? after.top : after.left;
            if (to - from < Math.max(18, extent / 70)) { why[0] = "gap " + (to - from) + "px between labels " + (index - 1) + "/" + index + " < " + Math.max(18, extent / 70); return new ArrayList<>(); }
            int[] seam = visibleSeam(image, vertical, from, to);
            if (seam == null) { why[0] = "no visible seam between labels " + (index - 1) + "/" + index + " (gap " + (to - from) + "px)"; return new ArrayList<>(); }
            seams.add(seam);
        }
        List<Rect> regions = new ArrayList<>();
        for (int index = 0; index < ordered.size(); index++) {
            int start = index == 0 ? 0 : seams.get(index - 1)[0];
            int end = index < seams.size() ? seams.get(index)[1] : extent;
            Rect region = vertical ? new Rect(0, start, width, end) : new Rect(start, 0, end, height);
            if (!region.contains(ordered.get(index).centerX(), ordered.get(index).centerY())
                || region.width() < width / 8 || region.height() < height / 8) { why[0] = "region " + index + " does not hold its label or is too small"; return new ArrayList<>(); }
            for (int other = 0; other < ordered.size(); other++)
                if (other != index && Rect.intersects(region, ordered.get(other))) { why[0] = "region " + index + " overlaps label " + other; return new ArrayList<>(); }
            regions.add(region);
        }
        return regions;
    }

    private static int[] visibleSeam(Bitmap image, boolean vertical, int from, int to) {
        int extent = vertical ? image.getHeight() : image.getWidth();
        int minor = vertical ? image.getWidth() : image.getHeight();
        int stride = Math.max(2, extent / 900);
        int probe = Math.max(3, extent / 240);
        double bestScore = 0;
        int[] best = null;
        for (int pass = 0; pass < 2; pass++) {
            double[] slopes = pass == 0 ? new double[]{0} : new double[]{-0.12, -0.08, -0.04, 0.04, 0.08, 0.12};
            for (int position = from + probe; position < to - probe; position += stride) {
                for (double slopeFraction : slopes) {
                    double slope = slopeFraction * extent / minor;
                    double strength = 0;
                    int strong = 0, samples = 0;
                    for (int offset = minor / 12; offset < minor * 11 / 12; offset += Math.max(3, minor / 65)) {
                        int tilted = position + (int) Math.round(slope * (offset - minor / 2.0));
                        if (tilted - probe < 0 || tilted + probe >= extent) continue;
                        int left = luminance(image, vertical, tilted - probe, offset);
                        int right = luminance(image, vertical, tilted + probe, offset);
                        int delta = Math.abs(left - right);
                        strength += delta;
                        if (delta > 24) strong++;
                        samples++;
                    }
                    double coverage = samples == 0 ? 0 : (double) strong / samples;
                    double score = samples == 0 ? 0 : strength / samples * coverage;
                    if (coverage >= 0.28 && score > bestScore) {
                        int halfTilt = (int) Math.ceil(Math.abs(slope) * minor * 5 / 12);
                        bestScore = score;
                        best = new int[]{Math.max(0, position - halfTilt), Math.min(extent, position + halfTilt)};
                    }
                }
            }
            if (bestScore >= 10) break;
        }
        return bestScore >= 10 ? best : null;
    }

    private static int luminance(Bitmap image, boolean vertical, int major, int minor) {
        int color = image.getPixel(vertical ? minor : major, vertical ? major : minor);
        return ((color >> 16 & 255) * 3 + (color >> 8 & 255) * 6 + (color & 255)) / 10;
    }

    /**
     * Last chance for a label whose IMEI 1 could not be read (blurred, glare): read it again enlarged and with stronger contrast.
     * Returns the text of the first enlarged read that gives a checksum-valid IMEI 1 line, or "" when nothing helped.
     * Costs extra reads only for labels that would otherwise be left without an IMEI.
     */
    private static String rescueText(TextRecognizer recognizer, Bitmap photo) {
        if (recognizer == null || photo == null) return "";
        float[][] tries = {{2f, 1.7f}, {1.5f, 2.4f}};
        for (float[] attempt : tries) {
            Bitmap big = null;
            try {
                big = enhance(photo, attempt[0], attempt[1]);
                String text = Tasks.await(recognizer.process(InputImage.fromBitmap(big, 0))).getText();
                if (!firstImeiIn(text).isEmpty()) return text;
            } catch (Exception error) { /* a rescue never breaks a scan */ }
            finally { if (big != null) big.recycle(); }
        }
        return "";
    }

    /** Enlarged grey copy with stretched contrast (text on a blurred, glare-washed label becomes easier to read). */
    static Bitmap enhance(Bitmap source, float scale, float contrast) {
        float fit = Math.min(scale, 3600f / Math.max(source.getWidth(), source.getHeight()));
        int width = Math.max(1, Math.round(source.getWidth() * fit)), height = Math.max(1, Math.round(source.getHeight() * fit));
        Bitmap out = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG);
        android.graphics.ColorMatrix grey = new android.graphics.ColorMatrix();
        grey.setSaturation(0f);
        float shift = (-0.5f * contrast + 0.5f) * 255f;
        grey.postConcat(new android.graphics.ColorMatrix(new float[]{contrast, 0, 0, 0, shift, 0, contrast, 0, 0, shift, 0, 0, contrast, 0, shift, 0, 0, 0, 1, 0}));
        paint.setColorFilter(new android.graphics.ColorMatrixColorFilter(grey));
        new Canvas(out).drawBitmap(source, null, new Rect(0, 0, width, height), paint);
        return out;
    }

    /** A valid IMEI taken from "IMEI 1" text only (never the IMEI 2 fallback). */
    private static String firstImeiIn(String text) {
        String raw = text.replace('\n', ' ');
        Set<String> values = new HashSet<>(); Matcher found = FIRST.matcher(raw);
        while (found.find()) { String value = found.group(1).replaceAll("\\D", ""); if (luhn(value)) values.add(value); }
        return values.size() == 1 ? values.iterator().next() : "";
    }

    private static String preferredImei(Text text) {
        String raw = text.getText().replace('\n', ' ');
        for (Pattern pattern : new Pattern[]{FIRST, SECOND}) {
            Set<String> values = new HashSet<>(); Matcher found = pattern.matcher(raw);
            while (found.find()) {
                String value = found.group(1).replaceAll("\\D", "");
                if (luhn(value)) values.add(value);
            }
            if (values.size() == 1) return values.iterator().next();
        }
        return "";
    }

    private static final Pattern LABEL_TWO = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*2\\b");

    /** One decoded barcode and where it is in the (rotated, levelled) photo. */
    static final class Code { final String value; final Rect box; Code(String value, Rect box) { this.value = value; this.box = box; } }

    /** Every Code 128 / EAN-13 barcode in the photo. A failure only means no barcode help for this photo. */
    /** Barcodes of a label read again at up to twice the size (long edge at most 2400 px, so memory stays bounded). Empty when it cannot help. */
    private static List<Code> barcodesEnlarged(Bitmap photo) {
        int longest = Math.max(photo.getWidth(), photo.getHeight());
        float factor = Math.min(2f, 2400f / longest);
        if (factor < 1.25f) return new ArrayList<>();
        Bitmap big = null;
        try {
            big = Bitmap.createScaledBitmap(photo, Math.round(photo.getWidth() * factor), Math.round(photo.getHeight() * factor), true);
            return barcodes(big);
        } catch (Throwable error) { return new ArrayList<>(); } // never break a scan (out of memory included)
        finally { if (big != null && big != photo) big.recycle(); }
    }

    private static List<Code> barcodes(Bitmap bitmap) {
        List<Code> found = new ArrayList<>();
        BarcodeScanner scanner = BarcodeScanning.getClient(new BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_CODE_128, Barcode.FORMAT_EAN_13).build());
        try {
            for (Barcode code : Tasks.await(scanner.process(InputImage.fromBitmap(bitmap, 0)))) {
                String value = code.getRawValue();
                Rect box = code.getBoundingBox();
                if (value != null && box != null) found.add(new Code(value.trim(), box));
            }
        } catch (Exception error) { /* barcodes are a bonus; text reading still works */ }
        finally { scanner.close(); }
        return found;
    }

    /**
     * The valid 15-digit barcode printed directly above the one "IMEI 1" (or "IMEI 2") text line of this label.
     * Empty unless exactly one value fits, so a wrong barcode is never taken.
     */
    static String labelledBarcode(Text ocr, List<Code> codes, Rect region, Pattern label) {
        if (codes == null || codes.isEmpty()) return "";
        int dx = region == null ? 0 : region.left, dy = region == null ? 0 : region.top;
        Set<String> values = new HashSet<>();
        for (Text.TextBlock block : ocr.getTextBlocks()) for (Text.Line line : block.getLines()) {
            Rect text = line.getBoundingBox();
            if (text == null || !label.matcher(line.getText()).find()) continue;
            int height = Math.max(8, text.height());
            for (Code code : codes) {
                if (!luhn(code.value)) continue;
                Rect box = new Rect(code.box); box.offset(-dx, -dy);
                boolean above = box.bottom >= text.top - height * 3 && box.bottom <= text.top + height;
                boolean overlaps = box.left < text.right + height * 4 && box.right > text.left - height;
                if (above && overlaps) values.add(code.value);
            }
        }
        return values.size() == 1 ? values.iterator().next() : "";
    }

    /** Median slant of the text lines in degrees (0 when there are too few lines to tell). */
    static float medianAngle(Text text) {
        List<Float> angles = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) for (Text.Line line : block.getLines())
            if (line.getText().trim().length() >= 4) angles.add(line.getAngle());
        if (angles.size() < 3) return 0f;
        java.util.Collections.sort(angles);
        return angles.get(angles.size() / 2);
    }

    /** The photo turned by the given degrees on a white background (no black corners). */
    static Bitmap level(Bitmap source, float degrees) {
        double radians = Math.toRadians(Math.abs(degrees));
        int width = source.getWidth(), height = source.getHeight();
        int outWidth = (int) Math.ceil(width * Math.cos(radians) + height * Math.sin(radians));
        int outHeight = (int) Math.ceil(width * Math.sin(radians) + height * Math.cos(radians));
        Bitmap out = Bitmap.createBitmap(outWidth, outHeight, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);
        canvas.drawColor(Color.WHITE);
        Matrix matrix = new Matrix();
        matrix.postTranslate(-width / 2f, -height / 2f);
        matrix.postRotate(degrees);
        matrix.postTranslate(outWidth / 2f, outHeight / 2f);
        canvas.drawBitmap(source, matrix, new Paint(Paint.FILTER_BITMAP_FLAG));
        return out;
    }

    private static boolean luhn(String value) {
        if (!value.matches("\\d{15}")) return false;
        int total = 0;
        for (int i = 0; i < 15; i++) {
            int digit = value.charAt(14 - i) - '0';
            if ((i & 1) == 1) { digit *= 2; if (digit > 9) digit -= 9; }
            total += digit;
        }
        return total % 10 == 0;
    }

    /** The model as stored (see SamsungModel for the rules); modelReading() says whether it needs a review. */
    private static String model(String text) {
        SamsungModel.Reading reading = SamsungModel.read(text);
        if (!reading.model.isEmpty()) return reading.model;
        // No usable code shape at all: an unreadable code is kept as read (as before), then the series names.
        java.util.regex.Matcher visible = java.util.regex.Pattern.compile("\\bS\\s*M\\s*[-–—]\\s*([A-Z0-9]{5})", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text);
        if (visible.find()) return "SM-" + visible.group(1).toUpperCase(java.util.Locale.US);
        String value = text.toLowerCase(java.util.Locale.ROOT);
        if (value.matches("(?s).*samsung.*s26.*|.*sm[- ]?s94.*")) return "Samsung Galaxy S26 series";
        if (value.matches("(?s).*samsung.*s25.*|.*sm[- ]?s93.*")) return "Samsung Galaxy S25 series";
        if (value.matches("(?s).*samsung.*a56.*|.*sm[- ]?a566.*")) return "Samsung Galaxy A56";
        if (value.contains("iphone 17")) return "Apple iPhone 17";
        if (value.contains("iphone 16")) return "Apple iPhone 16";
        return "Unknown unit — review";
    }
}
