package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class RoutineKeeperPlanTest {
    private static final long NOW = 1_700_000_000_000L;

    @Test public void alarmIsSetOnlyForAValidFutureTime() {
        assertEquals(NOW + 60_000, RoutineKeeperPlan.alarmAt(NOW, NOW + 60_000));
        assertEquals("a time in the past is never armed", -1, RoutineKeeperPlan.alarmAt(NOW, NOW - 1));
        assertEquals("now is not in the future", -1, RoutineKeeperPlan.alarmAt(NOW, NOW));
        assertEquals("nothing set", -1, RoutineKeeperPlan.alarmAt(NOW, 0));
        assertEquals("a week ahead is fine", NOW + 7L * 24 * 3600 * 1000, RoutineKeeperPlan.alarmAt(NOW, NOW + 7L * 24 * 3600 * 1000));
        assertEquals("absurdly far away is refused", -1, RoutineKeeperPlan.alarmAt(NOW, NOW + 30L * 24 * 3600 * 1000));
    }

    @Test public void theCpuIsHeldOnlyBrieflyAroundTheDueTime() {
        assertTrue("two minutes at most, never a continuous wake lock", RoutineKeeperPlan.WAKE_LOCK_MS <= 2L * 60 * 1000);
    }

    @Test public void notificationTextIsShortAndSafe() {
        assertEquals("Next: auto give at 09:00", RoutineKeeperPlan.notificationText("auto give at 09:00"));
        assertEquals("Waiting for the next timed routine", RoutineKeeperPlan.notificationText(""));
        assertEquals("Waiting for the next timed routine", RoutineKeeperPlan.notificationText(null));
        assertTrue(RoutineKeeperPlan.notificationText("x".repeat(200)).length() < 100);
        assertEquals("control characters and line breaks become spaces", "give phones by the limits at 09:00", RoutineKeeperPlan.cleanLabel("give phones\n by\tthe limits \u0007 at 09:00"));
        assertEquals("", RoutineKeeperPlan.cleanLabel(null));
    }
}
