package com.imeilens.scanner;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * Fires at the due time of a timed routine. It holds the CPU for two minutes (and not longer) and tells the page to check its routines now.
 * If the page is not alive it cannot run the routine, so it says so with a notification; tapping it opens the app, and the routine
 * still runs if that happens within its grace time.
 */
public final class RoutineAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock lock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "imeilens:routine-due");
        lock.setReferenceCounted(false);
        lock.acquire(RoutineKeeperPlan.WAKE_LOCK_MS); // released by the timeout, never held for longer
        if (MainActivity.wakePage()) return;
        RoutineKeeperService.ensureChannel(context);
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(RoutineKeeperService.ID + 2, new NotificationCompat.Builder(context, RoutineKeeperService.CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("A timed routine is due")
            .setContentText("Open AI LENS now. It runs only within a few minutes of its time.")
            .setContentIntent(android.app.PendingIntent.getActivity(context, 2104, new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE))
            .setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).build());
    }
}
