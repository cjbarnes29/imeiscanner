package com.imeilens.scanner;

/** Recovery never restarts completed or empty jobs and never replaces an active worker. */
final class ScanRecovery {
    static int remaining(int count, int completed) { return Math.max(0, count - Math.max(0, completed)); }
    static boolean canResume(String id, String status, int count, int completed, boolean active) {
        return id != null && !id.isEmpty() && !"completed".equals(status) && remaining(count, completed) > 0 && !active;
    }
}
