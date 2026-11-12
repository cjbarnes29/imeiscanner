package com.imeilens.scanner;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;
import org.json.JSONObject;

/** Sizes the scan to the phone: more parallel photos on strong phones, safe settings on weak ones. */
final class DeviceProfile {
    static final String PREFS = "scan-speed";
    static final String MODE = "mode";

    final String mode;       // auto | safe | balanced | turbo
    final int startWorkers;  // workers used at the start of a scan
    final int maxWorkers;    // most workers this scan may grow to
    final int maxEdge;       // longest photo edge decoded for OCR
    final String label;

    private DeviceProfile(String mode, int startWorkers, int maxWorkers, int maxEdge, String label) {
        this.mode = mode; this.startWorkers = startWorkers; this.maxWorkers = maxWorkers; this.maxEdge = maxEdge; this.label = label;
    }

    static String savedMode(Context context) {
        String mode = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(MODE, "auto");
        return "safe".equals(mode) || "balanced".equals(mode) || "turbo".equals(mode) ? mode : "auto";
    }

    static boolean setMode(Context context, String mode) {
        if (!"auto".equals(mode) && !"safe".equals(mode) && !"balanced".equals(mode) && !"turbo".equals(mode)) return false;
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(MODE, mode).commit();
    }

    /** The most photos this phone can scan at once, from CPU cores, RAM and the app memory limit. */
    static int capacity(Context context) {
        ActivityManager activity = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        activity.getMemoryInfo(memory);
        int cores = Runtime.getRuntime().availableProcessors();
        long totalGb = memory.totalMem / (1024L * 1024L * 1024L);
        if (activity.isLowRamDevice() || totalGb < 3 || cores < 4) return 1;
        int byCpu = cores >= 8 && totalGb >= 10 ? 5 : cores >= 8 && totalGb >= 6 ? 4 : cores >= 6 && totalGb >= 4 ? 3 : 2;
        // Each worker can hold a few decoded bitmaps; stay inside the app heap limit.
        return Math.max(1, Math.min(byCpu, activity.getMemoryClass() / 96));
    }

    static DeviceProfile detect(Context context) {
        String mode = savedMode(context);
        int capacity = capacity(context);
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        boolean saver = power != null && power.isPowerSaveMode();
        int edge = capacity == 1 ? 2000 : 3000;
        switch (mode) {
            case "safe": return new DeviceProfile(mode, 1, 1, 2000, "Safe");
            case "balanced": { int n = Math.min(2, capacity); return new DeviceProfile(mode, n, n, edge, "Balanced"); }
            case "turbo": return new DeviceProfile(mode, capacity, capacity, edge, "Turbo");
            default: {
                if (saver) { int n = Math.min(2, capacity); return new DeviceProfile(mode, 1, n, edge, "Auto · battery saver"); }
                return new DeviceProfile(mode, Math.min(2, capacity), capacity, edge, "Auto");
            }
        }
    }

    static boolean isHot(Context context) {
        if (Build.VERSION.SDK_INT < 29) return false;
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return power != null && power.getCurrentThermalStatus() >= PowerManager.THERMAL_STATUS_SEVERE;
    }

    /** True when there is enough free memory to safely add another worker. */
    static boolean hasMemoryRoom(Context context) {
        ActivityManager activity = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        activity.getMemoryInfo(memory);
        Runtime runtime = Runtime.getRuntime();
        long heapFree = runtime.maxMemory() - (runtime.totalMemory() - runtime.freeMemory());
        return !memory.lowMemory && memory.availMem > memory.totalMem / 5 && heapFree > 160L * 1024L * 1024L;
    }

    /** Details shown on the Settings screen. */
    static String describe(Context context) {
        ActivityManager activity = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        activity.getMemoryInfo(memory);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        DeviceProfile profile = detect(context);
        JSONObject json = new JSONObject();
        try {
            json.put("mode", profile.mode);
            json.put("label", profile.label);
            json.put("startWorkers", profile.startWorkers);
            json.put("maxWorkers", profile.maxWorkers);
            json.put("capacity", capacity(context));
            json.put("maxPhotos", ScanStore.MAX_PHOTOS);
            PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            json.put("batterySaver", power != null && power.isPowerSaveMode());
            json.put("hot", isHot(context));
            json.put("lowRam", activity.isLowRamDevice());
            json.put("androidVersion", Build.VERSION.RELEASE);
            json.put("device", Build.MANUFACTURER + " " + Build.MODEL);
            json.put("cores", Runtime.getRuntime().availableProcessors());
            json.put("ramGb", Math.round(memory.totalMem / (1024.0 * 1024.0 * 1024.0)));
            json.put("lastRate", prefs.getInt("lastRate", 0));
            json.put("lastWorkers", prefs.getInt("lastWorkers", 0));
            json.put("lastMode", prefs.getString("lastMode", ""));
        } catch (Exception ignored) { }
        return json.toString();
    }

    static void rememberRun(Context context, int perMinute, int workers, String label) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt("lastRate", perMinute).putInt("lastWorkers", workers).putString("lastMode", label).apply();
    }
}
