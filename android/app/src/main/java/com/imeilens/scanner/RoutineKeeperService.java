package com.imeilens.scanner;

import android.app.AlarmManager;
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
import androidx.core.app.NotificationCompat;

/**
 * Keeps the app alive while a timed routine is waiting, so Android does not close it, and wakes it at the due time.
 * - An ongoing notification says what is next, with a "Turn off" button.
 * - An alarm (AlarmManager.setAlarmClock: exact, works in Doze, needs no special permission) fires RoutineAlarmReceiver at the due time.
 * - It holds no wake lock between routines. The receiver holds the CPU for two minutes around the due time only.
 * The routine logic stays in the page (one place, one set of business rules); this service never changes business data.
 * If the person swipes the app away the page is gone: the service says so and stops, instead of pretending routines still run.
 */
public final class RoutineKeeperService extends Service {
    static final String ACTION_STOP = "com.imeilens.scanner.ROUTINE_KEEPER_STOP";
    static final String CHANNEL = "imei-lens-routines";
    static final int ID = 1003;
    private static final int ALARM_CODE = 2101;
    /** Set by the notification's Turn off button; the page reads and clears it (routineKeeperStopRequested). */
    static volatile boolean stopRequested;
    private static volatile boolean running;
    private static volatile long armedAt = -1;

    static boolean isRunning() { return running; }
    static long armedAt() { return armedAt; }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE))
                .createNotificationChannel(new NotificationChannel(CHANNEL, "Timed routines", NotificationManager.IMPORTANCE_LOW));
        }
    }

    private static PendingIntent openApp(Context context) {
        return PendingIntent.getActivity(context, 2103, new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Notification build(Context context, String label) {
        ensureChannel(context);
        PendingIntent stop = PendingIntent.getService(context, 2102, new Intent(context, RoutineKeeperService.class).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("AI LENS timed routines are on")
            .setContentText(RoutineKeeperPlan.notificationText(label))
            .setContentIntent(openApp(context)).setOnlyAlertOnce(true).setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Turn off", stop)
            .build();
    }

    /** Start the helper, or update what it waits for. Safe to call often. `atMillis` is the next due time. */
    static void on(Context context, String label, long atMillis) {
        long at = RoutineKeeperPlan.alarmAt(System.currentTimeMillis(), atMillis);
        if (at < 0) { off(context); return; }
        Intent intent = new Intent(context, RoutineKeeperService.class).putExtra("label", RoutineKeeperPlan.cleanLabel(label)).putExtra("at", at);
        try { androidx.core.content.ContextCompat.startForegroundService(context, intent); }
        catch (Exception error) { android.util.Log.w("IMEI-Lens", "Could not start the routine helper", error); }
    }

    static void off(Context context) {
        cancelAlarm(context);
        context.stopService(new Intent(context, RoutineKeeperService.class));
    }

    private static PendingIntent alarmIntent(Context context) {
        return PendingIntent.getBroadcast(context, ALARM_CODE, new Intent(context, RoutineAlarmReceiver.class),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void arm(Context context, long at) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        // setAlarmClock is exact, is allowed while the phone dozes, and needs no extra permission
        alarms.setAlarmClock(new AlarmManager.AlarmClockInfo(at, openApp(context)), alarmIntent(context));
        armedAt = at;
    }

    private static void cancelAlarm(Context context) {
        ((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).cancel(alarmIntent(context));
        armedAt = -1;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopRequested = true;
            cancelAlarm(this);
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        String label = intent == null ? "" : intent.getStringExtra("label");
        long at = intent == null ? -1 : intent.getLongExtra("at", -1);
        Notification notification = build(this, label);
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(ID, notification);
        running = true;
        if (at > 0) arm(this, at);
        return START_NOT_STICKY;
    }

    /** The person swiped the app away: the page that runs routines is gone. Say so instead of pretending. */
    @Override public void onTaskRemoved(Intent rootIntent) {
        cancelAlarm(this);
        ensureChannel(this);
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(ID + 1, new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("AI LENS was closed")
            .setContentText("Timed routines cannot run until you open the app again.").setContentIntent(openApp(this)).setAutoCancel(true).build());
        stopForeground(Service.STOP_FOREGROUND_REMOVE);
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() { running = false; super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
