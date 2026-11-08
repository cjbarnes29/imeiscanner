package com.imeilens.scanner;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.net.Uri;
import androidx.exifinterface.media.ExifInterface;
import com.google.android.gms.tasks.Tasks;
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

    private ImageScanner() {}

    static JSONArray scan(Context context, Uri uri, String filename, String personId, TextRecognizer recognizer) throws Exception {
        Bitmap bitmap = decode(context, uri);
        try {
            Text full = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)));
            List<Rect> labels = labels(full, bitmap.getWidth(), bitmap.getHeight());
            String sourceId = pictureId();
            JSONArray output = new JSONArray();
            if (labels.size() <= 1) {
                output.put(makeRecord(context, bitmap, filename, personId, sourceId, uri, false, recognizer));
                return output;
            }
            List<Rect> regions = boxRegions(bitmap, labels);
            if (regions.isEmpty()) {
                // Keep the full photo available for guided manual cropping rather than saving cut-off labels.
                output.put(makeRecord(context, bitmap, filename, personId, sourceId, uri, true, recognizer));
                return output;
            }
            for (Rect region : regions) {
                Bitmap crop = Bitmap.createBitmap(bitmap, region.left, region.top, region.width(), region.height());
                try { output.put(makeRecord(context, crop, filename, personId, sourceId, uri, false, recognizer)); }
                finally { crop.recycle(); }
            }
            return output;
        } finally { bitmap.recycle(); }
    }

    private static JSONObject makeRecord(Context context, Bitmap photo, String filename, String personId,
                                         String sourceId, Uri sourceUri, boolean cropReview, TextRecognizer recognizer) throws Exception {
        Text ocr = Tasks.await(recognizer.process(InputImage.fromBitmap(photo, 0)));
        String raw = ocr.getText();
        String imei = preferredImei(ocr);
        String id = UUID.randomUUID().toString();
        try (FileOutputStream stream = new FileOutputStream(ScanStore.image(context, id))) {
            if (!photo.compress(Bitmap.CompressFormat.JPEG, 85, stream)) throw new IllegalStateException("Could not save crop");
        }
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
        row.put("number", 0);
        return row;
    }

    private static String pictureId() { return "PIC-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(); }

    static Bitmap decode(Context context, Uri uri) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true;
        try (InputStream stream = context.getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(stream, null, bounds); }
        int sample = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / sample > 3000) sample *= 2;
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

    private static List<Rect> labels(Text text, int width, int height) {
        List<Rect> hits = new ArrayList<>();
        List<String> numbers = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) for (Text.Line line : block.getLines()) {
            if (!LABEL_ONE.matcher(line.getText()).find() || line.getBoundingBox() == null) continue;
            Rect box = line.getBoundingBox();
            Matcher number = NUMBER.matcher(line.getText());
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
        List<Integer> seams = new ArrayList<>();
        for (int index = 1; index < ordered.size(); index++) {
            Rect before = ordered.get(index - 1), after = ordered.get(index);
            int from = vertical ? before.bottom : before.right;
            int to = vertical ? after.top : after.left;
            if (to - from < Math.max(18, extent / 70)) return new ArrayList<>();
            int seam = visibleSeam(image, vertical, from, to);
            if (seam < 0) return new ArrayList<>();
            seams.add(seam);
        }
        List<Rect> regions = new ArrayList<>();
        int start = 0;
        for (int index = 0; index < ordered.size(); index++) {
            int end = index < seams.size() ? seams.get(index) : extent;
            Rect region = vertical ? new Rect(0, start, width, end) : new Rect(start, 0, end, height);
            if (!region.contains(ordered.get(index).centerX(), ordered.get(index).centerY())
                || region.width() < width / 8 || region.height() < height / 8) return new ArrayList<>();
            regions.add(region);
            start = end;
        }
        return regions;
    }

    private static int visibleSeam(Bitmap image, boolean vertical, int from, int to) {
        int extent = vertical ? image.getHeight() : image.getWidth();
        int minor = vertical ? image.getWidth() : image.getHeight();
        int stride = Math.max(2, extent / 900);
        int probe = Math.max(3, extent / 240);
        double bestScore = 0;
        int best = -1;
        for (int position = from + probe; position < to - probe; position += stride) {
            double strength = 0;
            int strong = 0, samples = 0;
            for (int offset = minor / 12; offset < minor * 11 / 12; offset += Math.max(3, minor / 65)) {
                int left = luminance(image, vertical, position - probe, offset);
                int right = luminance(image, vertical, position + probe, offset);
                int delta = Math.abs(left - right);
                strength += delta;
                if (delta > 24) strong++;
                samples++;
            }
            double coverage = samples == 0 ? 0 : (double) strong / samples;
            double score = samples == 0 ? 0 : strength / samples * coverage;
            if (coverage >= 0.28 && score > bestScore) { bestScore = score; best = position; }
        }
        return bestScore >= 10 ? best : -1;
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
        String value = text.toLowerCase();
        if (value.matches("(?s).*samsung.*s26.*|.*sm[- ]?s94.*")) return "Samsung Galaxy S26 series";
        if (value.matches("(?s).*samsung.*s25.*|.*sm[- ]?s93.*")) return "Samsung Galaxy S25 series";
        if (value.matches("(?s).*samsung.*a56.*|.*sm[- ]?a566.*")) return "Samsung Galaxy A56";
        if (value.contains("iphone 17")) return "Apple iPhone 17";
        if (value.contains("iphone 16")) return "Apple iPhone 16";
        return "Unknown unit — review";
    }
}
