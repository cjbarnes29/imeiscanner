package com.imeilens.scanner;

import static org.junit.Assert.*;
import org.junit.Test;

public class ImeiSourceTest {
    // Synthetic numbers (Luhn-valid), not from real devices.
    static final String A = "490154203237518", B = "356938035643809";

    @Test public void imei1IsNotAFallback() {
        assertFalse(ImeiSource.usesSecondImei("IMEI 1: " + A + " IMEI 2: " + B, A));
    }
    @Test public void onlyImei2ReadableIsAFallback() {
        assertTrue(ImeiSource.usesSecondImei("IMEI 1: 49015420323751 IMEI 2: " + B, B));
    }
    @Test public void imei1ThatFailsChecksumDoesNotCountAsImei1() {
        assertTrue(ImeiSource.usesSecondImei("IMEI 1: 490154203237519 IMEI 2: " + B, B));
    }
    @Test public void barcodeConfirmedImei1IsNotAFallback() {
        assertFalse(ImeiSource.usesSecondImei("IMEI 2: " + B + "\nIMEI 1 (barcode): " + B, B));
    }
    @Test public void emptyOrUnrelatedIsNotAFallback() {
        assertFalse(ImeiSource.usesSecondImei("", A));
        assertFalse(ImeiSource.usesSecondImei("IMEI 1: " + A, ""));
        assertFalse(ImeiSource.usesSecondImei("no labels here " + A, A));
    }
    @Test public void checksum() { assertTrue(ImeiSource.luhn(A)); assertFalse(ImeiSource.luhn("490154203237519")); assertFalse(ImeiSource.luhn("12")); }

    /** 14 digits + their check digit, built at run time (no checksum-valid number is written in the source). */
    static String withCheck(String fourteen) {
        for (int d = 0; d <= 9; d++) if (ImeiSource.luhn(fourteen + d)) return fourteen + d;
        throw new IllegalStateException();
    }

    @Test public void secondImeiInTextNeedsAValidNumber() {
        String imei2 = withCheck("99434383811431");
        assertEquals(imei2, ImeiSource.secondImeiInText("IMEI 1: 1234\nIMEI 2 : " + imei2));
        assertEquals("", ImeiSource.secondImeiInText("IMEI 2: 99434383811430" + (imei2.endsWith("0") ? "1" : "")));
        assertEquals("", ImeiSource.secondImeiInText(null));
    }
}
