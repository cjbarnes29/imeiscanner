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
    private static final Pattern LABEL_ONE = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*[1I]\\b");
    private static final Pattern NUMBER = Pattern.compile("(?<!\\d)(?:\\d[\\s-]*){15}(?!\\d)");
    private static final Pattern FIRST = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*[1I]\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?!\\d)");
    private static final Pattern SECOND = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*2\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?!\\d)");

    private static final int RECORD_EDGE = 1800;

    private ImageScanner() {}

    static JSONArray scan(Context context, Uri uri, String filename, String personId, TextRecognizer recognizer, int maxEdge) throws Exception {
        Bitmap bitmap = decode(context, uri, maxEdge);
        try {
            Text full = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)));
            // No valid IMEI read: the photo may be sideways or upside down. Try the other turns and keep the best.
            int rotation = 0, best = score(full);
            if (best < 100) {
                for (int turn : new int[]{90, 270, 180}) {
                    Bitmap turned = rotate(bitmap, turn);
                    Text candidate;
                    try { candidate = Tasks.await(recognizer.process(InputImage.fromBitmap(turned, 0))); }
                    catch (Exception error) { turned.recycle(); throw error; }
                    int value = score(candidate);
                    if (value > best + 10) { bitmap.recycle(); bitmap = turned; full = candidate; best = value; rotation = turn; }
                    else turned.recycle();
                    if (best >= 100) break;
                }
            }
            // A tilted photo: level it so the products can be separated with straight cuts.
            float tilt = medianAngle(full);
            if (Math.abs(tilt) >= 2f && Math.abs(tilt) <= 20f) {
                Bitmap levelled = level(bitmap, -tilt);
                Text again;
                try { again = Tasks.await(recognizer.process(InputImage.fromBitmap(levelled, 0))); }
                catch (Exception error) { levelled.recycle(); throw error; }
                // Keep it only if the text really became straighter and nothing was lost.
                if (Math.abs(medianAngle(again)) < Math.abs(tilt) && score(again) >= score(full)) { bitmap.recycle(); bitmap = levelled; full = again; }
                else levelled.recycle();
            }
            List<Code> codes = barcodes(bitmap);
            List<Rect> labels = labels(full, bitmap.getWidth(), bitmap.getHeight());
            // More "Model : SM-…" labels are visible than products were found: read the photo again in
            // overlapping pieces (each piece is read at a higher effective resolution) and look again.
            int expected = modelLabels(full);
            if (expected > labels.size() && expected <= 6) {
                List<Line> lines = linesOf(full);
                for (Rect tile : tiles(bitmap.getWidth(), bitmap.getHeight(), expected)) {
                    Bitmap part = Bitmap.createBitmap(bitmap, tile.left, tile.top, tile.width(), tile.height());
                    try {
                        Text read = Tasks.await(recognizer.process(InputImage.fromBitmap(part, 0)));
                        for (Line line : linesOf(read)) {
                            Rect box = new Rect(line.box); box.offset(tile.left, tile.top);
                            if (!repeats(lines, line.text, box)) lines.add(new Line(line.text, box));
                        }
                    } finally { part.recycle(); }
                }
                List<Rect> more = labels(lines, bitmap.getWidth(), bitmap.getHeight());
                if (more.size() > labels.size()) labels = more;
            }
            String sourceId = pictureId();
            JSONArray output = new JSONArray();
            if (labels.size() <= 1) {
                output.put(makeRecord(context, bitmap, filename, personId, sourceId, uri, false, recognizer, full, rotation, codes, null));
                return output;
            }
            List<Rect> regions = boxRegions(bitmap, labels);
            if (regions.isEmpty()) {
                // Keep the full photo available for guided manual cropping rather than saving cut-off labels.
                output.put(makeRecord(context, bitmap, filename, personId, sourceId, uri, true, recognizer, full, rotation, codes, null));
                return output;
            }
            boolean perspectiveReview = false;
            for (int index = 1; index < regions.size(); index++)
                if (Rect.intersects(regions.get(index - 1), regions.get(index))) perspectiveReview = true;
            for (Rect region : regions) {
                Bitmap crop = Bitmap.createBitmap(bitmap, region.left, region.top, region.width(), region.height());
                try { output.put(makeRecord(context, crop, filename, personId, sourceId, uri, perspectiveReview, recognizer, null, rotation, codes, region)); }
                finally { crop.recycle(); }
            }
            for (int index = 0; index < output.length(); index++) output.getJSONObject(index).put("siblings", output.length());
            return output;
        } finally { bitmap.recycle(); }
    }

    private static JSONObject makeRecord(Context context, Bitmap photo, String filename, String personId,
                                         String sourceId, Uri sourceUri, boolean cropReview, TextRecognizer recognizer, Text known, int rotation,
                                         List<Code> codes, Rect region) throws Exception {
        // Whole-photo records reuse the first OCR pass instead of reading the same bitmap twice.
        Text ocr = known != null ? known : Tasks.await(recognizer.process(InputImage.fromBitmap(photo, 0)));
        String raw = ocr.getText();
        String imei = preferredImei(ocr);
        // Barcodes are exact: pair each with the "IMEI 1" / "IMEI 2" text printed under it.
        String barcode1 = labelledBarcode(ocr, codes, region, LABEL_ONE), barcode2 = labelledBarcode(ocr, codes, region, LABEL_TWO);
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
        try (FileOutputStream stream = new FileOutputStream(ScanStore.image(context, id))) {
            if (!saved.compress(Bitmap.CompressFormat.JPEG, 80, stream)) throw new IllegalStateException("Could not save crop");
        } finally { if (saved != photo) saved.recycle(); }
        JSONObject row = new JSONObject();
        row.put("id", id);
        row.put("pictureId", pictureId());
        row.put("sourcePictureId", sourceId);
        row.put("sourceUri", sourceUri.toString());
        row.put("personId", personId);
        row.put("name", filename);
        row.put("imageName", id + ".jpg");
        row.put("model", model(raw + " " + filename));
        row.put("imei", imei);
        row.put("status", imei.isEmpty() ? "Review" : "Valid");
        row.put("cropNeedsReview", cropReview);
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

    /** Overlapping pieces: 2 labels → halves, 3 → thirds, 4 → 2×2, 5-6 → 3×2 (long side first). */
    static List<Rect> tiles(int width, int height, int products) {
        boolean landscape = width >= height;
        int along = products <= 2 ? 2 : products == 3 ? 3 : products == 4 ? 2 : 3, across = products <= 3 ? 1 : 2;
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

    private static List<Rect> labels(Text text, int width, int height) { return labels(linesOf(text), width, height); }

    private static List<Rect> labels(List<Line> lines, int width, int height) {
        List<Rect> hits = new ArrayList<>();
        List<String> numbers = new ArrayList<>();
        for (Line line : lines) {
            if (!LABEL_ONE.matcher(line.text).find()) continue;
            Rect box = line.box;
            Matcher number = NUMBER.matcher(line.text);
            String imei = number.find() ? number.group().replaceAll("\\D", "") : "";
            boolean duplicate = false;
            for (Rect previous : hits) {
                if (Math.abs(previous.centerX() - box.centerX()) < Math.max(24, box.width() / 3)
                    && Math.abs(previous.centerY() - box.centerY()) < Math.max(24, box.height() * 2)) duplicate = true;
            }
            if (!duplicate) { hits.add(new Rect(box)); numbers.add(imei); }
        }
        if (hits.size() < 2) return hits;
        int xSpread = hits.stream().mapToInt(Rect::centerX).max().orElse(0) - hits.stream().mapToInt(Rect::centerX).min().orElse(0);
        int ySpread = hits.stream().mapToInt(Rect::centerY).max().orElse(0) - hits.stream().mapToInt(Rect::centerY).min().orElse(0);
        boolean vertical = (double) ySpread / height >= (double) xSpread / width;
        int major = vertical ? height : width, minor = vertical ? width : height;
        List<Integer> order = new ArrayList<>();
        for (int index = 0; index < hits.size(); index++) order.add(index);
        order.sort(Comparator.comparingInt(index -> vertical ? hits.get(index).centerY() : hits.get(index).centerX()));
        List<Rect> groups = new ArrayList<>();
        List<String> groupNumbers = new ArrayList<>();
        for (int index : order) {
            Rect hit = hits.get(index);
            String imei = numbers.get(index);
            int match = -1;
            for (int groupIndex = 0; groupIndex < groups.size(); groupIndex++) {
                Rect group = groups.get(groupIndex);
                if (imei.isEmpty() || !imei.equals(groupNumbers.get(groupIndex))) continue;
                int gap = vertical ? hit.centerY() - group.bottom : hit.centerX() - group.right;
                int cross = vertical ? Math.abs(hit.centerX() - group.centerX()) : Math.abs(hit.centerY() - group.centerY());
                int span = vertical ? Math.max(hit.bottom, group.bottom) - Math.min(hit.top, group.top)
                    : Math.max(hit.right, group.right) - Math.min(hit.left, group.left);
                if (gap < major * 0.18 && cross < minor * 0.65 && span < major * 0.27) { match = groupIndex; break; }
            }
            if (match >= 0) groups.get(match).union(hit);
            else { groups.add(new Rect(hit)); groupNumbers.add(imei); }
        }
        return groups;
    }

    private static List<Rect> boxRegions(Bitmap image, List<Rect> labels) {
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
            if (to - from < Math.max(18, extent / 70)) return new ArrayList<>();
            int[] seam = visibleSeam(image, vertical, from, to);
            if (seam == null) return new ArrayList<>();
            seams.add(seam);
        }
        List<Rect> regions = new ArrayList<>();
        for (int index = 0; index < ordered.size(); index++) {
            int start = index == 0 ? 0 : seams.get(index - 1)[0];
            int end = index < seams.size() ? seams.get(index)[1] : extent;
            Rect region = vertical ? new Rect(0, start, width, end) : new Rect(start, 0, end, height);
            if (!region.contains(ordered.get(index).centerX(), ordered.get(index).centerY())
                || region.width() < width / 8 || region.height() < height / 8) return new ArrayList<>();
            for (int other = 0; other < ordered.size(); other++)
                if (other != index && Rect.intersects(region, ordered.get(other))) return new ArrayList<>();
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

    private static String model(String text) {
        java.util.regex.Matcher labelled = java.util.regex.Pattern.compile("\\bmodel\\s*[:：-]?\\s*S\\s*M\\s*[-–—]?\\s*([A-Z0-9]{5})", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text);
        java.util.regex.Matcher visible = java.util.regex.Pattern.compile("\\bS\\s*M\\s*[-–—]\\s*([A-Z0-9]{5})", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text);
        String labelledCode = labelled.find() ? labelled.group(1).toUpperCase(java.util.Locale.US) : "";
        java.util.HashSet<String> exactCodes = new java.util.HashSet<>();
        String firstCode = "";
        while (visible.find()) {
            String code = visible.group(1).toUpperCase(java.util.Locale.US);
            if (firstCode.isEmpty()) firstCode = code;
            if (code.matches("[A-Z][0-9]{3}[A-Z0-9]")) exactCodes.add(code);
        }
        if (!labelledCode.isEmpty() && exactCodes.contains(labelledCode)) return "SM-" + labelledCode;
        if (exactCodes.size() == 1) return "SM-" + exactCodes.iterator().next();
        if (!labelledCode.isEmpty()) return "SM-" + labelledCode;
        if (!firstCode.isEmpty()) return "SM-" + firstCode;
        String value = text.toLowerCase(java.util.Locale.ROOT);
        if (value.matches("(?s).*samsung.*s26.*|.*sm[- ]?s94.*")) return "Samsung Galaxy S26 series";
        if (value.matches("(?s).*samsung.*s25.*|.*sm[- ]?s93.*")) return "Samsung Galaxy S25 series";
        if (value.matches("(?s).*samsung.*a56.*|.*sm[- ]?a566.*")) return "Samsung Galaxy A56";
        if (value.contains("iphone 17")) return "Apple iPhone 17";
        if (value.contains("iphone 16")) return "Apple iPhone 16";
        return "Unknown unit — review";
    }
}
