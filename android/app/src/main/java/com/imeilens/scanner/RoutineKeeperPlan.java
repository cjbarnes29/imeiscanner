package com.imeilens.scanner;

/**
 * The rules of the routine helper, kept free of Android classes so they can be unit-tested.
 * The page reports the next time a timed routine is due; Android keeps the app alive and wakes it at that moment.
 */
final class RoutineKeeperPlan {
    /** Never plan further ahead than a week and a day: the page re-reports after every run. */
    static final long MAX_AHEAD_MS = 8L * 24 * 3600 * 1000;
    /** The CPU is held awake only this long around the due time, so the page can run the routine. Never a continuous wake lock. */
    static final long WAKE_LOCK_MS = 2L * 60 * 1000;

    private RoutineKeeperPlan() {}

    /** The time to set the alarm for, or -1 when there is nothing valid to wait for (past, not set, or absurdly far away). */
    static long alarmAt(long now, long next) {
        return next > now && next - now <= MAX_AHEAD_MS ? next : -1;
    }

    /** What the ongoing notification says. The label comes from the page ("auto give at 09:00"). */
    static String notificationText(String label) {
        String clean = label == null ? "" : label.trim();
        if (clean.length() > 80) clean = clean.substring(0, 80) + "...";
        return clean.isEmpty() ? "Waiting for the next timed routine" : "Next: " + clean;
    }

    /** Cleans the label so it is safe to show: no control characters, one line. */
    static String cleanLabel(String label) {
        if (label == null) return "";
        return label.replaceAll("[\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
    }
}
