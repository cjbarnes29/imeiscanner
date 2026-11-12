package com.imeilens.scanner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * Keeps the app alive while the background crop queue is running in the page: an ongoing notification ("Cropping 3 of 12",
 * with Stop) and a wake lock, so Android does not stop the app when it is minimized or the screen turns off.
 * The page tells this service how far it is (MainActivity bridge queueStatus); Stop only sets a flag the page reads.
 */
public final class QueueService extends Service {
    static final String ACTION_STOP = "com.imeilens.scanner.QUEUE_STOP";
    private static final String CHANNEL = "imei-lens-queue";
    private static final int ID = 1002;
    /** Set by the notification's Stop button; the page reads and clears it (queueStopRequested). */
    static volatile boolean stopRequested;
    private static volatile boolean running;
    private PowerManager.WakeLock lock;

    static boolean isRunning() { return running; }

    private static Notification build(Context context, int done, int total) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Background cropping", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(context, 2001, new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(context, 2002, new Intent(context, QueueService.class).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_crop)
            .setContentTitle("IMEI Lens is cropping photos")
            .setContentText(done + " of " + total + " photos done ? tap to open")
            .setContentIntent(open).setOnlyAlertOnce(true).setOngoing(true)
            .setProgress(Math.max(1, total), Math.min(done, Math.max(1, total)), false)
            .addAction(android.R.drawable.ic_media_pause, "Pause", stop)
            .build();
    }

    /** Start (or update) the notification. Safe to call often. */
    static void show(Context context, int done, int total) {
        if (running) {
            ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(ID, build(context, done, total));
            return;
        }
        Intent intent = new Intent(context, QueueService.class).putExtra("done", done).putExtra("total", total);
        try { androidx.core.content.ContextCompat.startForegroundService(context, intent); }
        catch (Exception error) { android.util.Log.w("IMEI-Lens", "Could not start the crop service", error); }
    }

    static void hide(Context context) { context.stopService(new Intent(context, QueueService.class)); }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopRequested = true;
            hide(this);
            return START_NOT_STICKY;
        }
        int done = intent == null ? 0 : intent.getIntExtra("done", 0), total = intent == null ? 0 : intent.getIntExtra("total", 0);
        Notification notification = build(this, done, total);
        if (Build.VERSION.SDK_INT >= 35) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING);
        else startForeground(ID, notification);
        running = true;
        if (lock == null) {
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "imeilens:crop-queue");
            lock.setReferenceCounted(false);
        }
        lock.acquire(30L * 60L * 1000L); // renewed by every update; released when the queue ends
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        running = false;
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
