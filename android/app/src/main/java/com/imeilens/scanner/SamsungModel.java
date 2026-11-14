package com.imeilens.scanner;

/**
 * Samsung model codes, read with the Samsung profile (brands/profiles/samsung.json): the grammar, the allowed OCR repairs and the review notes are
 * DATA there; this class only keeps the Samsung-named entry points that the scanner and its tests use. Behaviour is pinned by the shared
 * conformance file (brands/conformance/samsung.json) and by SamsungModelTest.
 *
 * Rules (unchanged): a code read cleanly on both lines (or one clean code only) is certain. A code that needed a character repair, or two lines
 * that disagree, is returned but marked uncertain, so the record asks for a review. It never invents a code from nothing.
 */
final class SamsungModel {
    private SamsungModel() { }

    static final class Reading {
        final String model;      // "SM-A165F", or "" when nothing was found
        final boolean uncertain;
        final String note;       // why it is uncertain (for the review screen), "" when certain
        Reading(String model, boolean uncertain, String note) { this.model = model; this.uncertain = uncertain; this.note = note; }
    }

    private static BrandProfile profile() { return BrandRegistry.byId("samsung"); }

    static Reading read(String text) {
        BrandProfile.Reading r = profile().readModel(text);
        return new Reading(r.model, r.uncertain, r.note);
    }

    /** The code with confusable letters in the three digit positions turned into digits, or "" when it still does not fit the shape. */
    static String repaired(String code) { return profile().repaired(code); }

    /** True when a typed model code has the Samsung shape (used to validate manual edits on the page as well). */
    static boolean looksLikeSamsungCode(String model) { return profile().looksLikeCode(model); }

    static String noCodeNote() { return profile().note("noCode"); }
}
