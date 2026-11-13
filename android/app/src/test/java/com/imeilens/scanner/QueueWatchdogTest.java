package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The crop queue's stall policy: conservative, progress-based, and a lock that cannot outlive a stall by long. */
public class QueueWatchdogTest {
    static final long MIN = 60 * 1000L;

    @Test public void aWorkingQueueIsNeverStalled() {
        QueueWatchdog dog = new QueueWatchdog(0, 0, 5);
        // The page counts a stuck photo as failed after 5 minutes, which is progress: one photo every 5 minutes is healthy.
        long now = 0;
        for (int finished = 1; finished <= 5; finished++) {
            now += 5 * MIN;
            assertFalse("not stalled before the photo finishes", dog.stalled(now - 1));
            assertTrue("a finished (or failed) photo is progress", dog.update(finished, 5, now));
            assertFalse(dog.stalled(now));
        }
    }

    @Test public void noProgressForTenMinutesIsAStall() {
        QueueWatchdog dog = new QueueWatchdog(0, 2, 8);
        assertFalse(dog.stalled(9 * MIN + 59 * 1000));
        assertTrue(dog.stalled(10 * MIN));
        assertEquals(10 * MIN, dog.idleMs(10 * MIN));
    }

    @Test public void repeatingTheSameStatusIsNotProgressAndDoesNotRenewTheClock() {
        QueueWatchdog dog = new QueueWatchdog(0, 3, 8);
        for (int minute = 1; minute < 10; minute++) assertFalse("the page repeats the same numbers", dog.update(3, 8, minute * MIN));
        assertTrue("so the stall is still detected on time", dog.stalled(10 * MIN));
    }

    @Test public void progressRestartsTheClock() {
        QueueWatchdog dog = new QueueWatchdog(0, 0, 3);
        assertTrue(dog.update(1, 3, 9 * MIN));
        assertFalse(dog.stalled(18 * MIN));
        assertTrue(dog.stalled(19 * MIN));
    }

    @Test public void addingPhotosToTheQueueCountsAsProgress() {
        QueueWatchdog dog = new QueueWatchdog(0, 2, 2);
        assertTrue("the total changed", dog.update(2, 5, 8 * MIN));
        assertFalse(dog.stalled(17 * MIN));
    }

    @Test public void theWakeLockCannotOutliveAStallByMoreThanTwoMinutes() {
        assertEquals(QueueWatchdog.STALL_MS + 2 * MIN, QueueWatchdog.LOCK_MS);
        assertTrue("the service looks well before the lock would run out", QueueWatchdog.CHECK_MS * 2 <= QueueWatchdog.LOCK_MS - QueueWatchdog.STALL_MS);
        assertTrue("the old fixed 30 minutes is gone", QueueWatchdog.LOCK_MS < 30 * MIN);
    }
}
