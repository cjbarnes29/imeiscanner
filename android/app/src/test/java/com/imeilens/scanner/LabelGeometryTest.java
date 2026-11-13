package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/**
 * How the "IMEI 1" lines of a photo are grouped into product labels.
 * The photo fixtures use the REAL line positions captured from the emulator diagnostics (IMEI-Lens/diag) of the test photos in
 * test-photos/; the digits are fakes that keep the same equal/different structure (no real IMEIs are stored in the tests).
 * Row format: left, top, right, bottom, numberKey (0 = the line has no full 15-digit number: cut off by the photo edge or misread).
 */
public class LabelGeometryTest {
    // a376-2box-a.jpg 768x1024: two stacked labels, three IMEI-1 lines each (left under the barcode, two on the right)
    static final int[][] A376_A = {{166, 523, 305, 536, 1}, {168, 828, 312, 848, 2}, {549, 405, 685, 419, 1}, {549, 533, 684, 546, 1}, {570, 705, 711, 721, 2}, {569, 844, 714, 859, 2}};
    // a376-2box-b.jpg 768x1024: the right-hand lines are cut off by the photo's right edge (no full number)
    static final int[][] A376_B = {{187, 502, 343, 520, 1}, {220, 867, 382, 887, 2}, {622, 368, 741, 385, 0}, {620, 515, 766, 532, 0}, {678, 730, 767, 747, 0}, {676, 887, 764, 905, 0}};
    // multi-03.jpg 1215x1601: two clipped lines on the right edge
    static final int[][] MULTI_03 = {{71, 661, 468, 690, 1}, {92, 1527, 455, 1562, 2}, {1099, 1320, 1216, 1358, 0}, {1089, 1512, 1212, 1543, 0}};
    // s938-dark-2box.jpg 2000x1500: already grouped correctly before the fix
    static final int[][] S938 = {{360, 648, 605, 691, 1}, {975, 380, 1241, 425, 1}, {997, 593, 1242, 640, 1}, {1040, 912, 1312, 959, 2}, {1064, 1138, 1305, 1179, 2}};
    // verification-original.jpg 1200x1600
    static final int[][] VERIFICATION = {{279, 826, 503, 849, 1}, {282, 1324, 515, 1348, 2}, {893, 608, 1111, 634, 1}, {902, 812, 1122, 840, 1}, {923, 1095, 1150, 1117, 2}, {933, 1315, 1163, 1343, 2}};
    // 1-1000380365.jpg 960x1280: three labels read (a fourth was never read; unchanged by the fix)
    static final int[][] FOUR_BOX = {{150, 626, 297, 643, 1}, {486, 513, 637, 536, 1}, {147, 1204, 489, 1219, 2}, {508, 609, 654, 629, 1}, {167, 911, 871, 938, 3}, {521, 819, 872, 835, 3}, {509, 1132, 854, 1153, 2}};

    static String number(int key) { return key == 0 ? "3519731312" : "35197313000" + String.format("%04d", key); }

    static List<LabelGeometry.Item> items(int[][] rows) {
        List<LabelGeometry.Item> out = new ArrayList<>();
        for (int[] r : rows) out.add(new LabelGeometry.Item("IMEI 1 : " + number(r[4]), new LabelGeometry.Box(r[0], r[1], r[2], r[3])));
        return out;
    }

    static LabelGeometry.Grouping group(int[][] rows, int w, int h) { return LabelGeometry.group(items(rows), w, h); }

    /** Every line with this key (in the order of the fixture) ended up in one and the same group. */
    static void assertOneLabel(LabelGeometry.Grouping g, int[][] rows, int key) {
        int group = -2;
        for (int i = 0; i < rows.length; i++) {
            if (rows[i][4] != key) continue;
            LabelGeometry.Hit hit = g.hits.get(i);
            if (group == -2) group = hit.group; else assertEquals("lines of number " + key + " must be one label", group, hit.group);
        }
    }

    // ---- the proven causes -------------------------------------------------------------------------------------------

    @Test public void stackedLabelsWhoseLinesSpreadSidewaysAreStillTwoLabels() {
        // Before: the left and right IMEI lines of a label spread the line centres sideways about as much as the two labels
        // are spread downwards, so the stacking direction was guessed sideways, same-label lines could not join and
        // 2 labels were counted as 4. Now the direction that joins more lines wins: 2.
        LabelGeometry.Grouping g = group(A376_A, 768, 1024);
        assertEquals(2, g.groups.size());
        assertTrue("labels are stacked top to bottom", g.vertical);
        assertOneLabel(g, A376_A, 1);
        assertOneLabel(g, A376_A, 2);
        assertNotEquals(g.hits.get(0).group, g.hits.get(1).group);
    }

    @Test public void wrongStackingDirectionIsWhatProducedFourGroups() {
        // The proof of the cause, on the real a376-2box-a geometry: sideways gives the old 4 groups, top-to-bottom gives 2.
        assertEquals("sideways (the old guess)", 4, LabelGeometry.groupAlong(LabelGeometry.imeiOneHits(items(A376_A)), false, 768, 1024).groups.size());
        assertEquals("top to bottom", 2, LabelGeometry.groupAlong(LabelGeometry.imeiOneHits(items(A376_A)), true, 768, 1024).groups.size());
        assertFalse("the old guess from the line centres was sideways", LabelGeometry.stackedVertically(LabelGeometry.imeiOneHits(items(A376_A)), 768, 1024));
    }

    @Test public void verificationPhotoIsTwoLabels() {
        LabelGeometry.Grouping g = group(VERIFICATION, 1200, 1600);
        assertEquals(2, g.groups.size());
        assertOneLabel(g, VERIFICATION, 1);
        assertOneLabel(g, VERIFICATION, 2);
    }

    @Test public void linesCutOffByThePhotoEdgeJoinTheirLabel() {
        // Before: 4 cut-off lines became 4 extra "labels" (6 groups). Now they join the label next to them.
        LabelGeometry.Grouping g = group(A376_B, 768, 1024);
        assertEquals(2, g.groups.size());
        int top = g.hits.get(0).group, bottom = g.hits.get(1).group;
        assertNotEquals(top, bottom);
        assertEquals("cut-off line at y 368 belongs to the upper label", top, g.hits.get(2).group);
        assertEquals("cut-off line at y 515 belongs to the upper label", top, g.hits.get(3).group);
        assertEquals("cut-off line at y 730 belongs to the lower label", bottom, g.hits.get(4).group);
        assertEquals("cut-off line at y 887 belongs to the lower label", bottom, g.hits.get(5).group);
    }

    @Test public void multi03CutOffLinesJoinTheirLabel() {
        LabelGeometry.Grouping g = group(MULTI_03, 1215, 1601);
        assertEquals(2, g.groups.size());
        assertNotEquals(g.hits.get(0).group, g.hits.get(1).group);
        assertEquals("cut-off line at y 1320 belongs to the lower label", g.hits.get(1).group, g.hits.get(2).group);
        assertEquals("cut-off line at y 1512 belongs to the lower label", g.hits.get(1).group, g.hits.get(3).group);
    }

    // ---- no regression on photos that already worked ---------------------------------------------------------------------

    @Test public void s938StaysTwoLabels() {
        LabelGeometry.Grouping g = group(S938, 2000, 1500);
        assertEquals(2, g.groups.size());
        assertOneLabel(g, S938, 1);
        assertOneLabel(g, S938, 2);
    }

    @Test public void fourBoxPhotoStillGivesTheThreeLabelsItHadBefore() {
        LabelGeometry.Grouping g = group(FOUR_BOX, 960, 1280);
        assertEquals(3, g.groups.size());
        assertOneLabel(g, FOUR_BOX, 1);
        assertOneLabel(g, FOUR_BOX, 2);
        assertOneLabel(g, FOUR_BOX, 3);
    }

    // ---- safety: different products are never merged, and a line is not absorbed when that would be a guess -----------------

    @Test public void labelsWhoseImeisDifferInOneDigitStayTwoLabels() {
        // Consecutive units of one batch: IMEIs that differ in a single digit. They must never be merged.
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(new LabelGeometry.Item("IMEI 1 : 351973130000001", new LabelGeometry.Box(100, 300, 400, 330)));
        lines.add(new LabelGeometry.Item("IMEI 1 : 351973130000002", new LabelGeometry.Box(100, 800, 400, 830)));
        LabelGeometry.Grouping g = LabelGeometry.group(lines, 900, 1200);
        assertEquals(2, g.groups.size());
    }

    @Test public void sideBySideLabelsStayTwoLabels() {
        List<LabelGeometry.Item> lines = new ArrayList<>();
        for (int[] r : new int[][]{{100, 600, 380, 630, 1}, {120, 300, 400, 330, 1}, {900, 600, 1180, 630, 2}, {920, 300, 1200, 330, 2}})
            lines.add(new LabelGeometry.Item("IMEI 1 : " + number(r[4]), new LabelGeometry.Box(r[0], r[1], r[2], r[3])));
        LabelGeometry.Grouping g = LabelGeometry.group(lines, 1400, 900);
        assertEquals(2, g.groups.size());
        assertFalse("labels are side by side, not stacked", g.vertical);
    }

    @Test public void oneLabelWithThreeLinesIsOneLabel() {
        List<LabelGeometry.Item> lines = new ArrayList<>();
        // a label about a fifth of the photo's height, like the real photos (a label taller than 27% is never joined)
        lines.add(new LabelGeometry.Item("IMEI 1 : " + number(1), new LabelGeometry.Box(100, 560, 380, 590)));
        lines.add(new LabelGeometry.Item("IMEI 1 : " + number(1), new LabelGeometry.Box(600, 400, 880, 430)));
        lines.add(new LabelGeometry.Item("IMEI 1 : " + number(1), new LabelGeometry.Box(600, 560, 880, 590)));
        assertEquals(1, LabelGeometry.group(lines, 1000, 1000).groups.size());
    }

    @Test public void cutOffLineFarFromEveryLabelStaysItsOwnLabel() {
        // A label whose IMEI is unreadable and sits at the edge, far below the only numbered label: do not absorb it.
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(new LabelGeometry.Item("IMEI 1 : " + number(1), new LabelGeometry.Box(100, 100, 400, 130)));
        lines.add(new LabelGeometry.Item("IMEI 1 : " + number(1), new LabelGeometry.Box(100, 200, 400, 230)));
        lines.add(new LabelGeometry.Item("IMEI 1 : 3519731", new LabelGeometry.Box(700, 1500, 800, 1530))); // touches the right edge of an 800 px photo
        LabelGeometry.Grouping g = LabelGeometry.group(lines, 800, 2000);
        assertEquals(2, g.groups.size());
    }

    @Test public void unreadableLineInTheMiddleOfThePhotoIsNotGuessed() {
        // Not at an edge: its missing digits are not explained by the photo edge, so it is not attached.
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(new LabelGeometry.Item("IMEI 1 : " + number(1), new LabelGeometry.Box(100, 300, 400, 330)));
        lines.add(new LabelGeometry.Item("IMEI 1 : 3519731", new LabelGeometry.Box(300, 360, 450, 390)));
        assertEquals(2, LabelGeometry.group(lines, 900, 1200).groups.size());
    }

    @Test public void cutOffIsJudgedFromTheMissingDigitsNotFromAFixedMarginToTheEdge() {
        // Real case: a376-2box-b's top-right line ends at x=741 of 768 (27 px from the edge) yet its number is cut off.
        LabelGeometry.Hit cut = new LabelGeometry.Hit(new LabelGeometry.Box(622, 368, 741, 385), "");
        cut.digits = 10; cut.length = 19;
        assertTrue(LabelGeometry.cutOffByEdge(cut, 768));
        // The same line in the middle of a wide photo is simply unreadable, not cut off.
        assertFalse(LabelGeometry.cutOffByEdge(cut, 1500));
        // A line that already shows 15 digits is never "cut off".
        LabelGeometry.Hit whole = new LabelGeometry.Hit(new LabelGeometry.Box(622, 368, 741, 385), "351973130000001");
        whole.digits = 15; whole.length = 24;
        assertFalse(LabelGeometry.cutOffByEdge(whole, 768));
    }

    // 1-1000380365.jpg read again in tiles ("Detailed", 4 products): the tiles add three short pieces. Two lie inside lines that are
    // already known (real positions), one is the blurred top label's line.
    static final int[][] FOUR_BOX_TILED = {{150, 626, 297, 643, 1}, {486, 513, 637, 536, 1}, {147, 1204, 489, 1219, 2}, {508, 609, 654, 629, 1}, {167, 911, 871, 938, 3}, {521, 819, 872, 835, 3}, {509, 1132, 854, 1153, 2},
        {500, 335, 543, 346, 0}, {485, 515, 545, 536, 0}, {507, 618, 540, 628, 0}};

    @Test public void piecesOfKnownLinesFromTilesAreNotExtraLabels() {
        // Before: the pieces at (485,515) and (507,618) became labels of their own: 3 labels became 6 and the split failed.
        LabelGeometry.Grouping g = group(FOUR_BOX_TILED, 960, 1280);
        assertEquals("3 numbered labels + the top label's own piece", 4, g.groups.size());
        assertEquals("the piece inside a known line is dropped", 8, g.hits.size());
    }

    @Test public void aWholeLineReplacesAPieceSeenFirst() {
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(new LabelGeometry.Item("IMEI 1 : 3519731312", new LabelGeometry.Box(500, 515, 545, 536)));      // a piece
        lines.add(new LabelGeometry.Item("IMEI 1 : " + number(1), new LabelGeometry.Box(486, 513, 637, 536)));    // the whole line
        List<LabelGeometry.Hit> hits = LabelGeometry.imeiOneHits(lines);
        assertEquals(1, hits.size());
        assertEquals(number(1), hits.get(0).number);
    }

    @Test public void insideFractionIsTheShareOfTheInnerBox() {
        assertEquals(1.0, LabelGeometry.insideFraction(new LabelGeometry.Box(10, 10, 20, 20), new LabelGeometry.Box(0, 0, 100, 100)), 1e-9);
        assertEquals(0.0, LabelGeometry.insideFraction(new LabelGeometry.Box(10, 10, 20, 20), new LabelGeometry.Box(50, 50, 60, 60)), 1e-9);
        assertEquals(0.5, LabelGeometry.insideFraction(new LabelGeometry.Box(0, 0, 10, 10), new LabelGeometry.Box(5, 0, 100, 100)), 1e-9);
    }

    @Test public void photoWithoutImeiLinesHasNoLabels() {
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(new LabelGeometry.Item("Model : SM-A376B/DS", new LabelGeometry.Box(10, 10, 300, 40)));
        assertEquals(0, LabelGeometry.group(lines, 900, 1200).groups.size());
    }

    // ---- diagnostics never leak a full IMEI --------------------------------------------------------------------------

    @Test public void maskKeepsOnlyFirstEightAndLastFourDigits() {
        assertEquals("35197313***0365", LabelGeometry.mask("351973137770365"));
        assertEquals("", LabelGeometry.mask(""));
        assertEquals("#12", LabelGeometry.mask("351973130210"));
        assertFalse(LabelGeometry.mask("351973137770365").contains("7770"));
    }

    @Test public void differencesCountsPositions() {
        assertEquals(0, LabelGeometry.differences("351973137770365", "351973137770365"));
        assertEquals(1, LabelGeometry.differences("351973137770365", "351973137770366"));
        assertEquals("different lengths count as fully different", 15, LabelGeometry.differences("1", "351973137770365"));
    }

    @Test public void landmarkCountUsesSerialAndMemoryLinesOncePerLabel() {
        List<LabelGeometry.Item> lines = new ArrayList<>();
        // two stacked labels: S/N of the top one is lost to glare, both memory lines are read
        lines.add(new LabelGeometry.Item("4GB |128GB", new LabelGeometry.Box(100, 200, 400, 240)));
        lines.add(new LabelGeometry.Item("4GB | 128GB", new LabelGeometry.Box(100, 1100, 400, 1140)));
        lines.add(new LabelGeometry.Item("S/N : RFGL81XXXXX", new LabelGeometry.Box(1100, 1150, 1500, 1190)));
        assertEquals(2, LabelGeometry.landmarkLabels(lines));
        // the same memory line read twice (a tile re-read) counts once
        lines.add(new LabelGeometry.Item("4GB l128GB", new LabelGeometry.Box(104, 203, 398, 242)));
        assertEquals(2, LabelGeometry.landmarkLabels(lines));
    }

    @Test public void separateRamAndStorageLinesAreNotTwoLabels() {
        // A layout that prints RAM and storage on separate lines must not double the count: single capacities are ignored.
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(new LabelGeometry.Item("RAM 8GB", new LabelGeometry.Box(100, 200, 300, 240)));
        lines.add(new LabelGeometry.Item("ROM 256GB", new LabelGeometry.Box(100, 260, 330, 300)));
        assertEquals(0, LabelGeometry.landmarkLabels(lines));
        assertFalse(LabelGeometry.STORAGE.matcher("128GB").find());
        assertTrue(LabelGeometry.STORAGE.matcher("8GB 256GB").find());
        assertTrue(LabelGeometry.STORAGE.matcher("12GB|512GB").find());
        // glare misreads seen on real photos (multi-10, multi-06, multi-08)
        assertTrue(LabelGeometry.STORAGE.matcher("4GB |128G8").find());
        assertTrue(LabelGeometry.STORAGE.matcher("4PG |128GB").find());
        assertTrue(LabelGeometry.STORAGE.matcher("4GB |128 GE").find());
        // but not when neither unit is a real GB/TB, and not other short lines
        assertFalse(LabelGeometry.STORAGE.matcher("4PG |128G8").find());
        assertFalse(LabelGeometry.STORAGE.matcher("RAM 8GB").find());
        assertFalse(LabelGeometry.STORAGE.matcher("A 5G").find());
    }

    @Test public void stackingDirectionFromSerialLinesNeedsAClearSpread() {
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(new LabelGeometry.Item("S/N : R1", new LabelGeometry.Box(1000, 300, 1300, 330)));
        lines.add(new LabelGeometry.Item("S/N : R2", new LabelGeometry.Box(1010, 1200, 1310, 1230)));
        assertEquals(Boolean.TRUE, LabelGeometry.stackedBySerial(lines, 1430, 1600));
        lines.clear();
        lines.add(new LabelGeometry.Item("S/N : R1", new LabelGeometry.Box(100, 300, 300, 330)));
        lines.add(new LabelGeometry.Item("S/N : R2", new LabelGeometry.Box(900, 320, 1100, 350)));
        assertEquals(Boolean.FALSE, LabelGeometry.stackedBySerial(lines, 1430, 1600));
        lines.remove(1);
        assertNull("one S/N line gives no direction", LabelGeometry.stackedBySerial(lines, 1430, 1600));
    }
}
