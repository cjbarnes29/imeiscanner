package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Samsung model codes: clean reads are certain; repaired or conflicting reads are kept but always marked for review. */
public class SamsungModelTest {
    @Test public void bothLinesCleanIsCertain() {
        SamsungModel.Reading r = SamsungModel.read("Model : SM-A165F/DS\nSM-A165FZADMEA\nGray\n4GB |128GB");
        assertEquals("SM-A165F", r.model);
        assertFalse(r.uncertain);
    }

    @Test public void oneCleanLineIsCertain() {
        SamsungModel.Reading r = SamsungModel.read("SM-A376BZKDEUE\nIMEI 1: 35");
        assertEquals("SM-A376B", r.model);
        assertFalse(r.uncertain);
    }

    @Test public void letterInADigitPositionIsRepairedButFlagged() {
        // seen on a real photo: 5 read as S on both lines
        SamsungModel.Reading r = SamsungModel.read("Model : SM-A16SF/DS\nSM-A16SFZADMEA");
        assertEquals("SM-A165F", r.model);
        assertTrue(r.uncertain);
        assertTrue(r.note, r.note.contains("not clearly readable"));
    }

    @Test public void cleanLineWinsButAConflictingRepairIsFlagged() {
        SamsungModel.Reading r = SamsungModel.read("Model : SM-A1B5F/DS\nSM-A165FZADMEA"); // B -> 8 gives A185F, which disagrees
        assertEquals("SM-A165F", r.model);
        assertTrue(r.uncertain);
        assertTrue(r.note, r.note.contains("disagree"));
    }

    @Test public void repairThatAgreesWithTheCleanLineIsCertain() {
        SamsungModel.Reading r = SamsungModel.read("Model : SM-A16SF/DS\nSM-A165FZADMEA");
        assertEquals("SM-A165F", r.model);
        assertFalse("the clean second line confirms the repaired first one", r.uncertain);
    }

    @Test public void twoDifferentCleanCodesAreFlagged() {
        SamsungModel.Reading r = SamsungModel.read("Model : SM-A165F/DS\nSM-A175FZADMEA");
        assertEquals("the Model line wins", "SM-A165F", r.model);
        assertTrue(r.uncertain);
    }

    @Test public void unreadableCodeIsFlaggedAndNothingIsInvented() {
        SamsungModel.Reading r = SamsungModel.read("Model : SM-AXXXF/DS");
        assertEquals("", r.model);
        assertTrue(r.uncertain);
        assertFalse(r.note.isEmpty());
        SamsungModel.Reading none = SamsungModel.read("IMEI 1 : 1234");
        assertEquals("", none.model);
        assertTrue("no model text at all: no note (the existing 'Unknown unit - review' name covers it)", none.note.isEmpty());
    }

    @Test public void repairsOnlyDigitPositions() {
        assertEquals("A165F", SamsungModel.repaired("A16SF"));
        assertEquals("S938B", SamsungModel.repaired("S93BB"));   // B in a digit position -> 8; the last B stays a letter
        assertEquals("A055F", SamsungModel.repaired("AO5SF"));
        assertEquals("", SamsungModel.repaired("AXYZF"));
    }

    @Test public void typedCodeShape() {
        assertTrue(SamsungModel.looksLikeSamsungCode("SM-A165F"));
        assertTrue(SamsungModel.looksLikeSamsungCode("sm-s938b/ds"));
        assertFalse(SamsungModel.looksLikeSamsungCode("A165F"));
        assertFalse(SamsungModel.looksLikeSamsungCode("SM-A16SF"));
    }
}
