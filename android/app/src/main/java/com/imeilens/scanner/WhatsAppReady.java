package com.imeilens.scanner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/**
 * "Your WhatsApp report is ready": one notification whose tap opens WhatsApp with the message filled in.
 * The app never sends anything. WhatsApp always needs the person's own Send tap (and the page then asks "I sent it").
 * The message text is kept only inside the notification's tap action, not shown on the lock screen.
 */
final class WhatsAppReady {
    private static final String CHANNEL = "imei-lens-ready";
    private static final int ID = 1010;

    private WhatsAppReady() {}

    private static boolean installed(Context context, String pkg) {
        try { context.getPackageManager().getPackageInfo(pkg, 0); return true; } catch (Exception missing) { return false; }
    }

    static void show(Context context, String destination, String phone, String text) {
        if (text == null || text.trim().isEmpty()) return;
        String pkg = installed(context, "com.whatsapp") ? "com.whatsapp" : installed(context, "com.whatsapp.w4b") ? "com.whatsapp.w4b" : null;
        String link = "mobile".equals(destination) ? WhatsAppReadyPlan.chatLink(WhatsAppReadyPlan.cleanPhone(phone), text) : null;
        Intent intent;
        if (link != null) {
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse(link));
            if (pkg != null) intent.setPackage(pkg);
        } else {
            intent = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
            if (pkg != null) intent.setPackage(pkg); else intent = Intent.createChooser(intent, "Send the report");
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent open = PendingIntent.getActivity(context, 2201, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Reports ready", NotificationManager.IMPORTANCE_HIGH));
        Notification note = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle("Your WhatsApp report is ready")
            .setContentText("Tap to open WhatsApp with the message filled in. You press Send.")
            .setContentIntent(open).setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();
        manager.notify(ID, note);
    }
}
