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

    @Test public void sameDeviceImei1IsFoundByTheSharedSerialPart() {
        String imei2 = withCheck("99434383811431"), imei1 = withCheck("99132678811431");
        String otherDevice = withCheck("99132678811432"); // the next box: another serial part
        assertEquals(imei1, ImeiSource.sameDeviceImei1(imei2, java.util.Arrays.asList(otherDevice, imei1, imei2)));
    }

    @Test public void sameDeviceImei1NeverGuesses() {
        String imei2 = withCheck("99434383811431");
        assertEquals("only IMEI 2 itself", "", ImeiSource.sameDeviceImei1(imei2, java.util.Arrays.asList(imei2)));
        assertEquals("another device only", "", ImeiSource.sameDeviceImei1(imei2, java.util.Arrays.asList(withCheck("99132678811432"))));
        assertEquals("two candidates: no choice is made", "", ImeiSource.sameDeviceImei1(imei2, java.util.Arrays.asList(withCheck("99132678811431"), withCheck("99555555811431"))));
        assertEquals("same first 8 digits is not IMEI 1", "", ImeiSource.sameDeviceImei1(imei2, java.util.Arrays.asList(withCheck("99434383811432").substring(0, 8) + imei2.substring(8, 14) + "0")));
        assertEquals("invalid IMEI 2 anchor", "", ImeiSource.sameDeviceImei1("12345", java.util.Arrays.asList(withCheck("99132678811431"))));
        String bad = withCheck("99132678811431"); bad = bad.substring(0, 14) + ((bad.charAt(14) - '0' + 1) % 10);
        assertEquals("a barcode with a wrong checksum is never used", "", ImeiSource.sameDeviceImei1(imei2, java.util.Arrays.asList(bad)));
    }

    @Test public void secondImeiInTextNeedsAValidNumber() {
        String imei2 = withCheck("99434383811431");
        assertEquals(imei2, ImeiSource.secondImeiInText("IMEI 1: 1234\nIMEI 2 : " + imei2));
        assertEquals("", ImeiSource.secondImeiInText("IMEI 2: 99434383811430" + (imei2.endsWith("0") ? "1" : "")));
        assertEquals("", ImeiSource.secondImeiInText(null));
    }
}
