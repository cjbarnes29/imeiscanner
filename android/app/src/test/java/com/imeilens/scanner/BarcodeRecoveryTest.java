package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

/** The strict rules for taking IMEI 1 from a barcode found again at full resolution: wrong or doubtful numbers are refused, never guessed. */
public class BarcodeRecoveryTest {
    static String imei(String body14) { return FailReasonTest.imei(body14); }

    static final String ONE = imei("49015420323751");
    static final String TWO = imei("35693803323752");   // the label's IMEI 2
    static final String OTHER = imei("86000000999001"); // a number from some other label

    @Test public void oneValidBarcodeIsAccepted() {
        BarcodeRecovery.Decision decision = BarcodeRecovery.decide(Arrays.asList(ONE), "", "");
        assertTrue(decision.accepted());
        assertEquals(ONE, decision.imei);
    }

    @Test public void theSameValueSeenInSeveralSizesStillCountsOnce() {
        assertTrue(BarcodeRecovery.decide(Arrays.asList(ONE, ONE, ONE), "", "").accepted());
    }

    @Test public void nothingDecodedMeansNothingIsTaken() {
        assertEquals(BarcodeRecovery.NONE, BarcodeRecovery.decide(Collections.<String>emptyList(), "", "").why);
        assertEquals(BarcodeRecovery.NONE, BarcodeRecovery.decide(null, "", "").why);
    }

    @Test public void aValueThatFailsTheChecksumIsIgnored() {
        String bad = ONE.substring(0, 14) + (ONE.charAt(14) == '0' ? '1' : '0');
        assertEquals(BarcodeRecovery.NONE, BarcodeRecovery.decide(Arrays.asList(bad, "12345", "ABCDEF"), "", "").why);
    }

    @Test public void twoDifferentValidNumbersAreAmbiguousAndNothingIsTaken() {
        BarcodeRecovery.Decision decision = BarcodeRecovery.decide(Arrays.asList(ONE, OTHER), "", "");
        assertFalse(decision.accepted());
        assertEquals(BarcodeRecovery.AMBIGUOUS, decision.why);
        assertEquals("", decision.imei);
    }

    @Test public void theLabelsOwnImei2IsNeverTakenForImei1() {
        BarcodeRecovery.Decision decision = BarcodeRecovery.decide(Arrays.asList(TWO), TWO, "");
        assertEquals(BarcodeRecovery.IS_IMEI2, decision.why);
        assertEquals("", decision.imei);
    }

    @Test public void printedDigitsThatAgreeConfirmTheBarcode() {
        assertTrue(BarcodeRecovery.decide(Arrays.asList(ONE), "", ONE.substring(0, 9)).accepted());
        assertTrue("a run from the middle fits too", BarcodeRecovery.decide(Arrays.asList(ONE), "", ONE.substring(4, 12)).accepted());
    }

    @Test public void oneOcrSlipInThePrintedDigitsIsTolerated() {
        String run = ONE.substring(0, 9);
        char changed = run.charAt(5) == '8' ? '3' : '8';
        String slipped = run.substring(0, 5) + changed + run.substring(6);
        assertTrue(BarcodeRecovery.decide(Arrays.asList(ONE), "", slipped).accepted());
    }

    @Test public void printedDigitsOfAnotherNumberContradictTheBarcodeAndNeitherIsTrusted() {
        BarcodeRecovery.Decision decision = BarcodeRecovery.decide(Arrays.asList(ONE), "", OTHER.substring(0, 10));
        assertFalse(decision.accepted());
        assertEquals(BarcodeRecovery.CONFLICT, decision.why);
        assertEquals("", decision.imei);
    }

    @Test public void aVeryShortRunSaysTooLittleToContradict() {
        assertTrue(BarcodeRecovery.decide(Arrays.asList(ONE), "", "99999").accepted());
        assertTrue(BarcodeRecovery.consistent(ONE, ""));
        assertTrue(BarcodeRecovery.consistent(ONE, null));
    }

    @Test public void consistencyAllowsOneDifferenceInSixButNotTwoInNine() {
        String twoOff = ONE.substring(0, 9);
        StringBuilder broken = new StringBuilder(twoOff);
        broken.setCharAt(1, broken.charAt(1) == '1' ? '2' : '1');
        broken.setCharAt(6, broken.charAt(6) == '1' ? '2' : '1');
        assertFalse("two different digits in nine is a different number", BarcodeRecovery.consistent(ONE, broken.toString()));
        assertTrue(BarcodeRecovery.consistent(ONE, twoOff));
    }
}
