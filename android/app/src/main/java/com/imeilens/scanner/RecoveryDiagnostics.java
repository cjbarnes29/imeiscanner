package com.imeilens.scanner;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/** Local crash summary: classes and code frames only, never exception messages or scanned data. */
final class RecoveryDiagnostics {
    private static boolean installed;
    static synchronized void install(Context context) {
        if (installed) return;
        installed = true;
        Context app = context.getApplicationContext();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                JSONObject value = new JSONObject().put("at", System.currentTimeMillis()).put("type", error.getClass().getSimpleName());
                JSONArray frames = new JSONArray();
                for (StackTraceElement frame : error.getStackTrace()) {
                    if (frames.length() >= 12) break;
                    frames.put(frame.getClassName() + "." + frame.getMethodName() + ":" + frame.getLineNumber());
                }
                value.put("frames", frames);
                app.getSharedPreferences("recovery-diagnostics", Context.MODE_PRIVATE).edit().putString("last-crash", value.toString()).commit();
            } catch (Throwable ignored) { /* diagnostics must not prevent the platform crash handler */ }
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }
}
