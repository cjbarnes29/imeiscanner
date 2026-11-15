package com.imeilens.scanner;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Why a photo is missing a label (fewer labels were found than the photo should show): the evidence the reader already has about
 * lines at the photo's border and about IMEI lines that were only partly read. Pure Java (unit-tested on the JVM).
 * It never produces or guesses any number: it only explains, and the record stays "Needs review".
 *
 * Kinds, strongest evidence first:
 *   cut-edge        label text (an IMEI line, or an S/N / Model line) touches a photo edge, or an IMEI 1 line was cut off by the edge
 *   partial-number  an IMEI 1 line was seen but only some of its digits were read (blur, glare)
 *   unreadable      a label is expected but no usable text was found
 */
final class LabelIssue {
    private LabelIssue() { }

    static final String CUT_EDGE = "cut-edge", PARTIAL = "partial-number", UNREADABLE = "unreadable";

    static final class Result {
        final String kind;
        /** "left", "right", "top" or "bottom" for cut-edge, else "". */
        final String side;
        /** Digits of the partly read IMEI 1 line (partial-number only), else 0. */
        final int digits;
        Result(String kind, String side, int digits) { this.kind = kind; this.side = side; this.digits = digits; }
    }

    private static final Pattern IMEI_LINE = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]");
    private static final Pattern OTHER_LABEL_LINE = Pattern.compile("(?i)\\bS\\s*/\\s*N\\b|\\bModel\\b|\\bMODEL\\b");
    private static final String[] SIDES = {"bottom", "top", "right", "left"}; // tie-break order

    /** The lines whose centre lies inside the region (one label's area). */
    static List<LabelGeometry.Item> itemsIn(List<LabelGeometry.Item> lines, LabelGeometry.Box region) {
        List<LabelGeometry.Item> out = new java.util.ArrayList<>();
        for (LabelGeometry.Item line : lines) if (inside(line.box, region)) out.add(line);
        return out;
    }

    /** The "IMEI 1" lines whose centre lies inside the region. */
    static List<LabelGeometry.Hit> hitsIn(List<LabelGeometry.Hit> hits, LabelGeometry.Box region) {
        List<LabelGeometry.Hit> out = new java.util.ArrayList<>();
        for (LabelGeometry.Hit hit : hits) if (inside(hit.box, region)) out.add(hit);
        return out;
    }

    private static boolean inside(LabelGeometry.Box box, LabelGeometry.Box region) {
        return box.centerX() >= region.left && box.centerX() <= region.right && box.centerY() >= region.top && box.centerY() <= region.bottom;
    }

    /**
     * @param lines  every text line of the photo with its box
     * @param hits   the "IMEI 1" lines found (see LabelGeometry)
     * @param width  photo width in pixels
     * @param height photo height in pixels
     */
    static Result classify(List<LabelGeometry.Item> lines, List<LabelGeometry.Hit> hits, int width, int height) {
        int marginX = Math.max(4, width / 100), marginY = Math.max(4, height / 100);
        int[] score = new int[4]; // bottom, top, right, left
        for (LabelGeometry.Item line : lines) {
            boolean imei = IMEI_LINE.matcher(line.text).find();
            boolean other = !imei && OTHER_LABEL_LINE.matcher(line.text).find();
            if (!imei && !other) continue;
            // A complete IMEI 1 line (15 digits) is not evidence of a cut label.
            if (imei && LabelGeometry.LABEL_ONE.matcher(line.text).find() && LabelGeometry.NUMBER.matcher(line.text).find()) continue;
            int weight = imei ? 2 : 1; // IMEI lines say more than an S/N or Model line next to the edge
            if (line.box.bottom >= height - marginY) score[0] += weight;
            if (line.box.top <= marginY) score[1] += weight;
            if (line.box.right >= width - marginX) score[2] += weight;
            if (line.box.left <= marginX) score[3] += weight;
        }
        int partialDigits = 0;
        for (LabelGeometry.Hit hit : hits) {
            if (!hit.number.isEmpty() || hit.digits <= 0) continue;
            partialDigits = Math.max(partialDigits, hit.digits);
            if (LabelGeometry.cutOffByEdge(hit, width)) score[2] += 2; // the missing digits would run past the right edge
            else {
                if (hit.box.bottom >= height - marginY) score[0] += 2;
                if (hit.box.top <= marginY) score[1] += 2;
                if (hit.box.right >= width - marginX) score[2] += 2;
                if (hit.box.left <= marginX) score[3] += 2;
            }
        }
        int best = 0;
        for (int i = 1; i < 4; i++) if (score[i] > score[best]) best = i;
        if (score[best] > 0) return new Result(CUT_EDGE, SIDES[best], 0);
        if (partialDigits > 0) return new Result(PARTIAL, "", partialDigits);
        return new Result(UNREADABLE, "", 0);
    }
}
