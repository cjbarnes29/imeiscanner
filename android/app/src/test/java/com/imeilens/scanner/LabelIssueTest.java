package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/**
 * Why a label is missing. The photo fixtures are the REAL line positions (fractions of the photo) captured from the diagnostics of two real test
 * photos; the digits are fakes. Line text is only used for its shape ("IMEI 2", "S/N", partial IMEI 1).
 */
public class LabelIssueTest {
    private static LabelGeometry.Item item(String text, double l, double t, double r, double b, int w, int h) {
        return new LabelGeometry.Item(text, new LabelGeometry.Box((int) (l * w), (int) (t * h), (int) (r * w), (int) (b * h)));
    }
    private static LabelGeometry.Hit hit(String text, int digits, double l, double t, double r, double b, int w, int h) {
        LabelGeometry.Hit hit = new LabelGeometry.Hit(item(text, l, t, r, b, w, h).box, "");
        hit.digits = digits; hit.length = text.length();
        return hit;
    }

    /** Photo like multi-06 (1032 x 1119): the second label's IMEI 2 line is on the bottom edge, its IMEI 1 line below the photo. */
    @Test public void aLabelRunningOffTheBottomIsReportedAsCutAtTheBottom() {
        int w = 1032, h = 1119;
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(item("IMEI 1: 123456789012345", .10, .31, .42, .34, w, h)); // complete line of the first label
        lines.add(item("IMEI 2: 123456789012345", .53, .30, .86, .34, w, h));
        lines.add(item("IMEI 2: 12345678901234", .55, .97, .87, 1.00, w, h)); // second label, on the edge
        lines.add(item("S/N: R58M", .89, .02, 1.00, .05, w, h));
        lines.add(item("S/N: R58M", .91, .69, .98, .73, w, h));
        LabelIssue.Result r = LabelIssue.classify(lines, new ArrayList<>(), w, h);
        assertEquals(LabelIssue.CUT_EDGE, r.kind);
        assertEquals("bottom", r.side);
    }

    /** Photo like multi-10 (1536 x 1699): the second label's IMEI 1 lines are cut by the right edge (4 and 5 digits visible). */
    @Test public void aLabelCutByTheRightEdgeIsReportedAsCutAtTheRight() {
        int w = 1536, h = 1699;
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(item("IMEI 1: 123456789012345", .13, .92, .39, .93, w, h));
        lines.add(item("IMEI 1: 12345", .86, .78, 1.00, .80, w, h));
        lines.add(item("IMEI 1: 1234", .87, .91, 1.00, .93, w, h));
        lines.add(item("S/N: R58M1234", .79, .68, 1.00, .71, w, h));
        List<LabelGeometry.Hit> hits = new ArrayList<>();
        hits.add(hit("IMEI 1: 12345", 5, .86, .78, 1.00, .80, w, h));
        hits.add(hit("IMEI 1: 1234", 4, .87, .91, 1.00, .93, w, h));
        LabelIssue.Result r = LabelIssue.classify(lines, hits, w, h);
        assertEquals(LabelIssue.CUT_EDGE, r.kind);
        assertEquals("right", r.side);
    }

    @Test public void aCompleteImei1LineOnTheEdgeIsNotEvidenceOfACutLabel() {
        int w = 1000, h = 1000;
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(item("IMEI 1: 123456789012345", .60, .50, 1.00, .52, w, h));
        assertEquals(LabelIssue.UNREADABLE, LabelIssue.classify(lines, new ArrayList<>(), w, h).kind);
    }

    @Test public void aPartlyReadLineInTheMiddleOfThePhotoIsPartialNotCut() {
        int w = 1000, h = 1000;
        List<LabelGeometry.Item> lines = new ArrayList<>();
        List<LabelGeometry.Hit> hits = new ArrayList<>();
        lines.add(item("IMEI 1: 1234567", .20, .50, .50, .52, w, h));
        hits.add(hit("IMEI 1: 1234567", 7, .20, .50, .50, .52, w, h));
        LabelIssue.Result r = LabelIssue.classify(lines, hits, w, h);
        assertEquals(LabelIssue.PARTIAL, r.kind);
        assertEquals(7, r.digits);
        assertEquals("", r.side);
    }

    @Test public void onlyTheLinesInsideOneLabelAreaAreUsedForThatLabel() {
        int w = 1000, h = 1000;
        List<LabelGeometry.Item> lines = new ArrayList<>();
        lines.add(item("IMEI 2: 123456789012345", .10, .40, .50, .42, w, h));   // upper label
        lines.add(item("IMEI 1: 1234567", .10, .98, .50, 1.00, w, h));            // lower label, cut at the bottom
        LabelGeometry.Box lower = new LabelGeometry.Box(0, 700, 1000, 1000);
        assertEquals(1, LabelIssue.itemsIn(lines, lower).size());
        LabelIssue.Result r = LabelIssue.classify(LabelIssue.itemsIn(lines, lower), new ArrayList<>(), w, h);
        assertEquals("bottom", r.side);
        LabelGeometry.Box upper = new LabelGeometry.Box(0, 0, 1000, 600);
        assertEquals("the upper label is not blamed for the lower one's edge", LabelIssue.UNREADABLE, LabelIssue.classify(LabelIssue.itemsIn(lines, upper), new ArrayList<>(), w, h).kind);
    }

    @Test public void noTextEvidenceMeansUnreadableAndNeverGuessesASide() {
        LabelIssue.Result r = LabelIssue.classify(new ArrayList<>(), new ArrayList<>(), 1000, 1000);
        assertEquals(LabelIssue.UNREADABLE, r.kind);
        assertEquals("", r.side);
    }
}
