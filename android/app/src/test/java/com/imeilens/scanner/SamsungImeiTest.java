package com.imeilens.scanner;

import static com.imeilens.scanner.ImeiSourceTest.withCheck;
import static org.junit.Assert.*;
import java.util.Arrays;
import org.junit.Test;

/** Samsung-only rules. Numbers are synthetic, with check digits computed at run time. */
public class SamsungImeiTest {
    @Test public void sameDeviceImei1IsFoundByTheSharedSerialPart() {
        String imei2 = withCheck("99434383811431"), imei1 = withCheck("99132678811431");
        String otherDevice = withCheck("99132678811432"); // the next box: another serial part
        assertEquals(imei1, SamsungImei.sameDeviceImei1(imei2, Arrays.asList(otherDevice, imei1, imei2)));
    }

    @Test public void sameDeviceImei1NeverGuesses() {
        String imei2 = withCheck("99434383811431");
        assertEquals("only IMEI 2 itself", "", SamsungImei.sameDeviceImei1(imei2, Arrays.asList(imei2)));
        assertEquals("another device only", "", SamsungImei.sameDeviceImei1(imei2, Arrays.asList(withCheck("99132678811432"))));
        assertEquals("two candidates: no choice is made", "", SamsungImei.sameDeviceImei1(imei2, Arrays.asList(withCheck("99132678811431"), withCheck("99555555811431"))));
        assertEquals("same first 8 digits is not IMEI 1", "", SamsungImei.sameDeviceImei1(imei2, Arrays.asList(withCheck("99434383811432").substring(0, 8) + imei2.substring(8, 14) + "0")));
        assertEquals("invalid IMEI 2 anchor", "", SamsungImei.sameDeviceImei1("12345", Arrays.asList(withCheck("99132678811431"))));
        String bad = withCheck("99132678811431"); bad = bad.substring(0, 14) + ((bad.charAt(14) - '0' + 1) % 10);
        assertEquals("a barcode with a wrong checksum is never used", "", SamsungImei.sameDeviceImei1(imei2, Arrays.asList(bad)));
    }

    @Test public void samsungLabelsAreRecognisedByTheirOwnText() {
        assertTrue(SamsungImei.isSamsungLabel("SAMSUNG\nModel : SM-A165F/DS"));
        assertTrue(SamsungImei.isSamsungLabel("Model: SM-A16SF/DS"));     // misread code still shows a Samsung label
        assertTrue(SamsungImei.isSamsungLabel("Samsung Electronics"));
        assertTrue(SamsungImei.isSamsungLabel("SM - S938B"));
    }

    @Test public void otherBrandsNeverGetTheSamsungRule() {
        assertFalse(SamsungImei.isSamsungLabel("iPhone 16 Pro 256GB\nIMEI/MEID 1234\nIMEI2 5678"));
        assertFalse(SamsungImei.isSamsungLabel("Xiaomi Redmi Note 14 IMEI1 IMEI2"));
        assertFalse(SamsungImei.isSamsungLabel("Pixel 9 Model GR83Y"));
        assertFalse(SamsungImei.isSamsungLabel("OPPO A79 CPH2553"));
        assertFalse(SamsungImei.isSamsungLabel("vivo V2318"));
        assertFalse(SamsungImei.isSamsungLabel("sm-a165f"));             // lower case "sm-" is not how Samsung prints its codes
        assertFalse(SamsungImei.isSamsungLabel(""));
        assertFalse(SamsungImei.isSamsungLabel(null));
    }
}
