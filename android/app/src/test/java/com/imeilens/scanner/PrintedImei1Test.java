package com.imeilens.scanner;

import static com.imeilens.scanner.ImeiSourceTest.withCheck;
import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;

/**
 * The whole-photo read's printed IMEI 1 of one label (used only when the label's own crop gave none, and then marked for review).
 * Synthetic numbers with check digits computed at run time: no real IMEI is stored here.
 */
public class PrintedImei1Test {
    private static LabelGeometry.Hit hit(int centerX, int centerY, String number) {
        return new LabelGeometry.Hit(new LabelGeometry.Box(centerX - 100, centerY - 10, centerX + 100, centerY + 10), number);
    }
    private static final LabelGeometry.Box TOP = new LabelGeometry.Box(0, 0, 1000, 700);
    private static final LabelGeometry.Box BOTTOM = new LabelGeometry.Box(0, 800, 1000, 1500);

    @Test public void theValidNumberInsideTheLabelIsReturned() {
        String a = withCheck("99132678811431"), b = withCheck("99132678822222");
        List<LabelGeometry.Hit> hits = Arrays.asList(hit(300, 500, a), hit(300, 1450, b));
        assertEquals(a, LabelGeometry.printedImei1In(hits, TOP));
        assertEquals(b, LabelGeometry.printedImei1In(hits, BOTTOM));
    }

    @Test public void aNumberOutsideTheLabelIsNeverTaken() {
        String a = withCheck("99132678811431");
        assertEquals("", LabelGeometry.printedImei1In(Arrays.asList(hit(300, 500, a)), BOTTOM));
    }

    @Test public void aWrongChecksumIsNeverTaken() {
        String a = withCheck("99132678811431");
        String bad = a.substring(0, 14) + ((a.charAt(14) - '0' + 1) % 10);
        assertEquals("", LabelGeometry.printedImei1In(Arrays.asList(hit(300, 500, bad)), TOP));
    }

    @Test public void shortOrEmptyLinesGiveNothing() {
        assertEquals("", LabelGeometry.printedImei1In(Arrays.asList(hit(300, 500, ""), hit(300, 520, "9913267881143")), TOP));
        assertEquals("", LabelGeometry.printedImei1In(new ArrayList<>(), TOP));
    }

    @Test public void twoDifferentNumbersInsideOneLabelMeansNothingIsChosen() {
        String a = withCheck("99132678811431"), b = withCheck("99132678822222");
        assertEquals("", LabelGeometry.printedImei1In(Arrays.asList(hit(300, 500, a), hit(600, 600, b)), TOP));
    }

    @Test public void theSameNumberReadTwiceIsStillOneNumber() {
        String a = withCheck("99132678811431");
        assertEquals(a, LabelGeometry.printedImei1In(Arrays.asList(hit(300, 500, a), hit(320, 520, a)), TOP));
    }
}
