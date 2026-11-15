package com.imeilens.scanner;

/**
 * When the background crop queue has stopped making progress, and for how long the phone may be kept awake meanwhile.
 * Plain Java (no android.* classes), unit-tested on a normal JVM; QueueService supplies the clock.
 *
 * Conservative: progress means the number of finished photos (done + failed) or the total changed. The page's own limit
 * (5 minutes per photo, see src/stall-guard.ts) counts a stuck photo as failed, which is progress, so a queue that is
 * working never reaches the 10 minutes below. Only a page that has died or froze completely does.
 */
final class QueueWatchdog {
    /** No progress for this long: the queue is treated as stalled and the service stops (the saved queue is kept, the page shows it paused). */
    static final long STALL_MS = 10 * 60 * 1000L;
    /** The wake lock's own time limit, renewed by every sign of progress, so it can never outlive a stall by long. */
    static final long LOCK_MS = STALL_MS + 2 * 60 * 1000L;
    /** How often the service looks. */
    static final long CHECK_MS = 60 * 1000L;

    private long lastProgressAt;
    private int done, total;

    QueueWatchdog(long now, int done, int total) {
        this.lastProgressAt = now; this.done = done; this.total = total;
    }

    /** Records a status report from the page. True when it shows progress (so the wake lock should be renewed). */
    boolean update(int newDone, int newTotal, long now) {
        if (newDone == done && newTotal == total) return false;
        done = newDone; total = newTotal; lastProgressAt = now;
        return true;
    }

    long idleMs(long now) { return Math.max(0, now - lastProgressAt); }

    boolean stalled(long now) { return idleMs(now) >= STALL_MS; }
}
