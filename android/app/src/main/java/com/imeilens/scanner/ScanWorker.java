package com.imeilens.scanner;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.net.Uri;
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

    private ForegroundInfo foreground(int completed, int total) {
        Context context = getApplicationContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "IMEI scans", NotificationManager.IMPORTANCE_LOW));
        PendingIntent stopAction = PendingIntent.getBroadcast(context, 1001,
            new Intent(context, StopReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("IMEI Lens is scanning")
            .setContentText(completed + " of " + total + " photos")
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setProgress(total, completed, false)
            .addAction(android.R.drawable.ic_delete, "Stop", stopAction);
        if (Build.VERSION.SDK_INT >= 35) return new ForegroundInfo(1001, builder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING);
        return new ForegroundInfo(1001, builder.build());
    }

    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        JSONObject job = ScanStore.read(context);
        JSONArray queue = job.optJSONArray("queue");
        if (queue == null || queue.length() == 0) return Result.success();
        int completed = job.optInt("completed", 0);
        int failed = job.optInt("failed", 0);
        try {
            setForegroundAsync(foreground(completed, queue.length())).get();
            ScanStore.update(context, completed, failed, new JSONArray());
            TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            try {
                for (int index = completed; index < queue.length(); index++) {
                    if (isStopped() || "stopped".equals(ScanStore.read(context).optString("status"))) return Result.success();
                    JSONObject photo = queue.optJSONObject(index);
                    JSONArray additions = new JSONArray();
                    try {
                        additions = ImageScanner.scan(context, Uri.parse(photo.getString("uri")),
                            photo.optString("name", "Phone photo.jpg"), job.optString("personId", "person-1"), recognizer);
                    } catch (Exception error) { failed++; }
                    if (isStopped() || "stopped".equals(ScanStore.read(context).optString("status"))) return Result.success();
                    ScanStore.update(context, index + 1, failed, additions);
                    setForegroundAsync(foreground(index + 1, queue.length())).get();
                }
            } finally { recognizer.close(); }
            ScanStore.finish(context, "completed", "");
            return Result.success();
        } catch (Exception error) {
            ScanStore.finish(context, "queued", "Scan paused; Android will retry it.");
            return Result.retry();
        }
    }
}
