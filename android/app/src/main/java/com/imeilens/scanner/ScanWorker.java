package com.imeilens.scanner;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.net.Uri;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HashSet;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ScanWorker extends Worker {
    private static final String CHANNEL = "imei-lens-scans";

    public ScanWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    private String photoFingerprint(Uri uri) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = getApplicationContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalStateException("Cannot open photo");
            byte[] buffer = new byte[8192];
            int length;
            while ((length = input.read(buffer)) != -1) digest.update(buffer, 0, length);
        }
        StringBuilder value = new StringBuilder();
        for (byte part : digest.digest()) value.append(String.format("%02x", part & 0xff));
        return value.toString();
    }

    private ForegroundInfo foreground(int completed, int total, String detail) {
        Context context = getApplicationContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "IMEI scans", NotificationManager.IMPORTANCE_LOW));
        PendingIntent stopAction = PendingIntent.getBroadcast(context, 1001,
            new Intent(context, StopReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("IMEI Lens is scanning")
            .setContentText(completed + " of " + total + " photos · " + detail)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setProgress(total, completed, false)
            .addAction(android.R.drawable.ic_delete, "Stop", stopAction);
        if (Build.VERSION.SDK_INT >= 35) return new ForegroundInfo(1001, builder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING);
        return new ForegroundInfo(1001, builder.build());
    }

    @NonNull @Override public Result doWork() {
        final Context context = getApplicationContext();
        JSONObject job = ScanStore.read(context);
        JSONArray queue = job.optJSONArray("queue");
        if (queue == null || queue.length() == 0) return Result.success();
        int completed = job.optInt("completed", 0);
        int failed = job.optInt("failed", 0);
        final java.util.Set<String> seenPhotos = java.util.concurrent.ConcurrentHashMap.newKeySet();
        HashSet<String> seenImeis = new HashSet<>();
        JSONArray existingRecords = job.optJSONArray("records");
        if (existingRecords != null) for (int index = 0; index < existingRecords.length(); index++) {
            JSONObject row = existingRecords.optJSONObject(index);
            if (row != null && row.optString("imei").matches("[0-9]{15}")) seenImeis.add(row.optString("imei"));
        }
        for (int index = 0; index < completed; index++) {
            JSONObject previous = queue.optJSONObject(index);
            if (previous != null) try { seenPhotos.add(photoFingerprint(Uri.parse(previous.getString("uri")))); }
            catch (Exception ignored) { /* A previous photo may no longer be accessible. */ }
        }
        final DeviceProfile profile = DeviceProfile.detect(context);
        final int maxWorkers = profile.maxWorkers;
        final String personId = job.optString("personId", "person-1");
        // The Scan speed and Products in each photo the user chose on the Scan screen (also used by the camera scan).
        final android.content.SharedPreferences prefs = context.getSharedPreferences("app-state", Context.MODE_PRIVATE);
        final String speed = prefs.getString("scan-speed", "standard");
        final int expectedProducts = prefs.getInt("scan-expected", 0);
        final java.util.concurrent.atomic.AtomicInteger maxEdge = new java.util.concurrent.atomic.AtomicInteger(profile.maxEdge);
        // The pool can grow up to maxWorkers; permits decide how many are actually running.
        final java.util.concurrent.Semaphore permits = new java.util.concurrent.Semaphore(profile.startWorkers);
        final java.util.concurrent.BlockingQueue<TextRecognizer> recognizers = new java.util.concurrent.ArrayBlockingQueue<>(maxWorkers);
        final java.util.concurrent.ExecutorService pool = java.util.concurrent.Executors.newFixedThreadPool(maxWorkers);
        final java.util.Map<Integer, java.util.concurrent.Future<JSONArray>> futures = new java.util.HashMap<>();
        final boolean adaptive = "auto".equals(profile.mode);
        int next = completed, active = profile.startWorkers, peak = active;
        boolean growing = adaptive && maxWorkers > active;
        long started = android.os.SystemClock.elapsedRealtime();
        long windowStart = started;
        int windowDone = 0;
        double lastRate = 0;
        try {
            setForegroundAsync(foreground(completed, queue.length(), profile.label)).get();
            ScanStore.update(context, completed, failed, new JSONArray());
            for (int slot = 0; slot < maxWorkers; slot++) recognizers.add(TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS));
            for (int index = completed; index < queue.length(); index++) {
                // Keep a few photos decoding/reading ahead; results are still saved in order.
                while (next < queue.length() && next < index + maxWorkers * 2) {
                    final JSONObject photo = queue.optJSONObject(next);
                    futures.put(next, pool.submit(() -> {
                        permits.acquire();
                        try {
                            TextRecognizer recognizer = recognizers.take();
                            try {
                                Uri uri = Uri.parse(photo.getString("uri"));
                                if (!seenPhotos.add(photoFingerprint(uri))) return new JSONArray();
                                String name = photo.optString("name", "Phone photo.jpg");
                                try { return ImageScanner.scan(context, uri, name, personId, recognizer, maxEdge.get(), speed, expectedProducts); }
                                catch (OutOfMemoryError tooBig) {
                                    maxEdge.set(1600); // Out of memory: shrink for every worker and retry once.
                                    return ImageScanner.scan(context, uri, name, personId, recognizer, 1600, speed, expectedProducts);
                                }
                            } finally { recognizers.put(recognizer); }
                        } finally { permits.release(); }
                    }));
                    next++;
                }
                if (isStopped() || ScanStore.isStopped(context)) return Result.success();
                JSONArray additions = new JSONArray();
                try { additions = futures.remove(index).get(); }
                catch (Exception error) { failed++; additions = new JSONArray(); }
                JSONArray unique = new JSONArray();
                for (int rowIndex = 0; rowIndex < additions.length(); rowIndex++) {
                    JSONObject row = additions.optJSONObject(rowIndex);
                    if (row == null) continue;
                    String imei = row.optString("imei");
                    if (imei.matches("[0-9]{15}") && !seenImeis.add(imei)) {
                        ScanStore.image(context, row.optString("id")).delete();
                        continue;
                    }
                    unique.put(row);
                }
                if (isStopped() || ScanStore.isStopped(context)) return Result.success();
                ScanStore.update(context, index + 1, failed, unique);

                // Adapt: back off when the phone is hot or low on memory, grow while it keeps up.
                windowDone++;
                if (active > 1 && (DeviceProfile.isHot(context) || maxEdge.get() < profile.maxEdge) && permits.tryAcquire()) { active--; growing = false; }
                else if (windowDone >= 6) {
                    long now = android.os.SystemClock.elapsedRealtime();
                    double rate = windowDone * 60000.0 / Math.max(1, now - windowStart);
                    if (growing) {
                        if (lastRate > 0 && rate < lastRate * 1.1) growing = false; // The last extra worker did not help.
                        else if (active < maxWorkers && !DeviceProfile.isHot(context) && DeviceProfile.hasMemoryRoom(context)) {
                            permits.release(); active++; peak = Math.max(peak, active);
                        } else growing = false;
                    }
                    lastRate = rate; windowStart = now; windowDone = 0;
                }
                long seconds = Math.max(1, (android.os.SystemClock.elapsedRealtime() - started) / 1000);
                int perMinute = (int) ((index + 1 - completed) * 60L / seconds);
                setForegroundAsync(foreground(index + 1, queue.length(), profile.label + " · " + active + " at once · " + perMinute + "/min")).get();
            }
            long seconds = Math.max(1, (android.os.SystemClock.elapsedRealtime() - started) / 1000);
            DeviceProfile.rememberRun(context, (int) ((queue.length() - completed) * 60L / seconds), peak, profile.label);
            ScanStore.finish(context, "completed", "");
            if (ScanStore.promotePending(context)) {
                androidx.work.WorkManager.getInstance(context).enqueueUniqueWork("imei-lens-background-scan",
                    androidx.work.ExistingWorkPolicy.APPEND_OR_REPLACE, new androidx.work.OneTimeWorkRequest.Builder(ScanWorker.class).build());
            }
            return Result.success();
        } catch (Exception error) {
            ScanStore.finish(context, "queued", "Scan paused; Android will retry it.");
            return Result.retry();
        } finally {
            pool.shutdownNow();
            ScanStore.flush(context);
            TextRecognizer recognizer;
            while ((recognizer = recognizers.poll()) != null) recognizer.close();
        }
    }
}
