package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Why a label has no IMEI 1: words only, from what the reader saw. No number is ever part of a reason. */
public class FailReasonTest {
    /** A checksum-valid 15-digit number built at run time (no complete number is written in this file). */
    static String imei(String body14) {
        for (char digit = '0'; digit <= '9'; digit++) if (ImeiSource.luhn(body14 + digit)) return body14 + digit;
        throw new IllegalStateException();
    }

    static final String GOOD = imei("49015420323751");

    @Test public void aLabelWhoseImeiWasReadHasNoReason() {
        assertEquals("", FailReason.classify("IMEI 1: " + GOOD, GOOD, false, ""));
    }

    @Test public void imei2StandingInForImei1IsSaidSoAndNeverTreatedAsRead() {
        assertEquals(FailReason.IMEI2_ONLY, FailReason.classify("IMEI 2: " + GOOD, GOOD, true, ""));
    }

    @Test public void aLabelCutByTheEdgeIsCutEdgeWhateverElseWasRead() {
        assertEquals(FailReason.CUT_EDGE, FailReason.classify("IMEI 1: 3569 3803", "", false, LabelIssue.CUT_EDGE));
    }

    @Test public void someDigitsOnTheImei1LineArePartial() {
        assertEquals(FailReason.PARTIAL, FailReason.classify("Model: SM-S938B\nIMEI 1: 49015420 3237", "", false, ""));
    }

    @Test public void aFullNumberThatFailsTheChecksumIsSaidSo() {
        String wrong = GOOD.substring(0, 14) + (GOOD.charAt(14) == '0' ? '1' : '0');
        assertFalse(ImeiSource.luhn(wrong));
        assertEquals(FailReason.CHECKSUM, FailReason.classify("IMEI 1: " + wrong, "", false, ""));
    }

    @Test public void theLineWithoutDigitsIsUnreadable() {
        assertEquals(FailReason.LINE_UNREADABLE, FailReason.classify("S/N: R58X\nIMEI 1:\nIMEI 2: ", "", false, ""));
    }

    @Test public void labelTextWithoutAnImei1LineIsNoImeiLine() {
        assertEquals(FailReason.NO_IMEI_LINE, FailReason.classify("Model: SM-S938B\nS/N: R58X1234ABC", "", false, ""));
    }

    @Test public void nothingReadableIsNoText() {
        assertEquals(FailReason.NO_TEXT, FailReason.classify("", "", false, ""));
        assertEquals(FailReason.NO_TEXT, FailReason.classify("   a table and a cable  ", "", false, ""));
        assertEquals(FailReason.NO_TEXT, FailReason.classify(null, null, false, ""));
    }

    @Test public void onlyACutEdgeIsBeyondARetry() {
        for (String kind : FailReason.ALL) assertEquals(kind, FailReason.CUT_EDGE.equals(kind), FailReason.unfixableByRetry(kind));
    }

    @Test public void aReasonIsAlwaysAWordNeverANumber() {
        // "imei2-only" holds the "2" of "IMEI 2"; what must never happen is a run of digits that could be (part of) a number.
        for (String kind : FailReason.ALL) assertTrue(kind, kind.matches("[a-z0-9-]+") && !kind.matches(".*[0-9]{3,}.*"));
    }

    @Test public void thePrintedRunIsTheLongestRunOfDigitsAfterTheImei1Label() {
        assertEquals("490154203237", FailReason.printedRun("Model: SM-S938B\nIMEI 1: 4901 5420 3237"));
        assertEquals("", FailReason.printedRun("IMEI 2: " + GOOD));
        assertEquals("", FailReason.printedRun(null));
        assertEquals("the longest of several lines", "4901542032", FailReason.printedRun("IMEI 1: 49015\nIMEI 1: 4901542032"));
    }
}
