package com.imeilens.scanner;
import org.junit.Test;
import static org.junit.Assert.*;
public class ScanRecoveryTest {
    @Test public void interruptedJobResumesOnlyRemaining() {
        assertEquals(7, ScanRecovery.remaining(10,3));
        assertTrue(ScanRecovery.canResume("job","processing",10,3,false));
        assertTrue(ScanRecovery.canResume("job","stopped",10,3,false));
    }
    @Test public void activeCompletedAndEmptyJobsCannotRestart() {
        assertFalse(ScanRecovery.canResume("job","processing",10,3,true));
        assertFalse(ScanRecovery.canResume("job","completed",10,3,false));
        assertFalse(ScanRecovery.canResume("","queued",10,0,false));
        assertFalse(ScanRecovery.canResume("job","queued",10,10,false));
        assertEquals(0,ScanRecovery.remaining(1,5));
    }
}
