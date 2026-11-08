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
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ImageScanner {
    private static final Pattern LABEL_ONE = Pattern.compile("(?i)\\bI\\s*M\\s*E\\s*I\\s*[:#-]?\\s*[1I]\\b");
    private static final Pattern NUMBER = Pattern.compile("(?<!\\d)(?:\\d[\\s-]*){15}(?!\\d)");
    private static final Pattern FIRST = Pattern.compile("(?i)\\bI\\s*M\\s*E\\s*I\\s*[:#-]?\\s*[1I]\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?!\\d)");
    private static final Pattern SECOND = Pattern.compile("(?i)\\bI\\s*M\\s*E\\s*I\\s*[:#-]?\\s*2\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?!\\d)");

    private ImageScanner() {}

    static JSONArray scan(Context context, Uri uri, String filename, String personId, TextRecognizer recognizer) throws Exception {
        Bitmap bitmap = decode(context, uri);
        try {
            Text full = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)));
            List<Rect> labels = labels(full);
            String sourceId = pictureId();
            JSONArray output = new JSONArray();
            if (labels.size() <= 1) {
                output.put(makeRecord(context, bitmap, filename, personId, sourceId, false, recognizer));
                return output;
            }
            List<Rect> regions = new ArrayList<>();
            boolean uncertain = false;
            for (Rect label : labels) {
                Rect region = stickerBoundary(bitmap, label, labels);
                if (region == null) { region = conservativeBoundary(bitmap, label, labels); uncertain = true; }
                regions.add(region);
            }
            for (int i = 0; i < regions.size(); i++) {
                Rect region = regions.get(i);
                boolean shared = false;
                for (int j = 0; j < regions.size(); j++) {
                    if (i != j && Rect.intersects(region, labels.get(j))) shared = true;
                }
                if (shared) {
                    // Keep the full source visible for manual review when sticker boundaries overlap.
                    output.put(makeRecord(context, bitmap, filename, personId, sourceId, true, recognizer));
                    return output;
                }
            }
            for (Rect region : regions) {
                Bitmap crop = Bitmap.createBitmap(bitmap, region.left, region.top, region.width(), region.height());
                try { output.put(makeRecord(context, crop, filename, personId, sourceId, uncertain, recognizer)); }
                finally { crop.recycle(); }
            }
            return output;
        } finally { bitmap.recycle(); }
    }

    private static JSONObject makeRecord(Context context, Bitmap photo, String filename, String personId,
                                         String sourceId, boolean cropReview, TextRecognizer recognizer) throws Exception {
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

    private static Bitmap decode(Context context, Uri uri) throws Exception {
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

    private static List<Rect> labels(Text text) {
        List<Rect> found = new ArrayList<>();
        for (Text.TextBlock block : text.getTextBlocks()) for (Text.Line line : block.getLines()) {
            if (!LABEL_ONE.matcher(line.getText()).find() || line.getBoundingBox() == null) continue;
            Rect box = line.getBoundingBox();
            boolean duplicate = false;
            for (Rect previous : found) {
                if (Math.abs(previous.centerX() - box.centerX()) < Math.max(24, box.width() / 3)
                    && Math.abs(previous.centerY() - box.centerY()) < Math.max(24, box.height() * 2)) duplicate = true;
            }
            if (!duplicate) found.add(new Rect(box));
        }
        return found;
    }

    private static Rect stickerBoundary(Bitmap image, Rect label, List<Rect> labels) {
        int step = Math.max(4, Math.max(image.getWidth(), image.getHeight()) / 550);
        int width = (image.getWidth() + step - 1) / step, height = (image.getHeight() + step - 1) / step;
        int seedX = Math.max(0, Math.min(width - 1, (label.left - label.width() / 5) / step));
        int seedY = Math.max(0, Math.min(height - 1, (label.top - label.height() * 2) / step));
        int seed = image.getPixel(Math.min(image.getWidth() - 1, seedX * step), Math.min(image.getHeight() - 1, seedY * step));
        boolean[] seen = new boolean[width * height];
        ArrayDeque<Integer> queue = new ArrayDeque<>();
        queue.add(seedY * width + seedX); seen[seedY * width + seedX] = true;
        int minX = seedX, maxX = seedX, minY = seedY, maxY = seedY, count = 0;
        while (!queue.isEmpty()) {
            int point = queue.removeFirst(), x = point % width, y = point / width;
            int color = image.getPixel(Math.min(image.getWidth() - 1, x * step), Math.min(image.getHeight() - 1, y * step));
            if (distance(color, seed) > 55) continue;
            count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            for (int next : new int[]{point - 1, point + 1, point - width, point + width}) {
                if (next < 0 || next >= seen.length || seen[next]) continue;
                if ((next == point - 1 && x == 0) || (next == point + 1 && x == width - 1)) continue;
                seen[next] = true; queue.add(next);
            }
        }
        Rect region = new Rect(Math.max(0, (minX - 3) * step), Math.max(0, (minY - 3) * step),
            Math.min(image.getWidth(), (maxX + 4) * step), Math.min(image.getHeight(), (maxY + 4) * step));
        if (count < 25 || region.width() < label.width() * 2 || region.height() < label.height() * 3
            || region.width() * region.height() > image.getWidth() * image.getHeight() * 0.72
            || !region.contains(label.centerX(), label.centerY())) return null;
        for (Rect other : labels) if (other != label && Rect.intersects(region, other)) return null;
        return region;
    }

    private static int distance(int a, int b) {
        return Math.abs((a >> 16 & 255) - (b >> 16 & 255)) + Math.abs((a >> 8 & 255) - (b >> 8 & 255))
            + Math.abs((a & 255) - (b & 255));
    }

    private static Rect conservativeBoundary(Bitmap image, Rect label, List<Rect> labels) {
        int width = image.getWidth(), height = image.getHeight();
        int left = Math.max(0, label.left - Math.max(label.width(), width / 6));
        int right = Math.min(width, label.right + Math.max(label.width(), width / 6));
        int top = Math.max(0, label.top - Math.max(label.height() * 3, height / 7));
        int bottom = Math.min(height, label.bottom + Math.max(label.height() * 8, height / 4));
        for (Rect other : labels) {
            if (other == label) continue;
            int dx = other.centerX() - label.centerX(), dy = other.centerY() - label.centerY();
            if (Math.abs(dx) >= Math.abs(dy)) {
                int boundary = (other.centerX() + label.centerX()) / 2;
                if (dx > 0) right = Math.min(right, boundary); else left = Math.max(left, boundary);
            } else {
                int boundary = (other.centerY() + label.centerY()) / 2;
                if (dy > 0) bottom = Math.min(bottom, boundary); else top = Math.max(top, boundary);
            }
        }
        return new Rect(left, top, Math.max(left + 1, right), Math.max(top + 1, bottom));
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
        String value = text.toLowerCase();
        if (value.matches("(?s).*samsung.*s26.*|.*sm[- ]?s94.*")) return "Samsung Galaxy S26 series";
        if (value.matches("(?s).*samsung.*s25.*|.*sm[- ]?s93.*")) return "Samsung Galaxy S25 series";
        if (value.matches("(?s).*samsung.*a56.*|.*sm[- ]?a566.*")) return "Samsung Galaxy A56";
        if (value.contains("iphone 17")) return "Apple iPhone 17";
        if (value.contains("iphone 16")) return "Apple iPhone 16";
        return "Unknown unit — review";
    }
}
