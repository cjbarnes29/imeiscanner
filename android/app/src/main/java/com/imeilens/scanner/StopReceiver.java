package com.imeilens.scanner;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.work.WorkManager;

public final class StopReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        ScanStore.stop(context);
        WorkManager.getInstance(context).cancelUniqueWork("imei-lens-background-scan");
    }
}
