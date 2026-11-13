package com.imeilens.scanner;

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads the Samsung model code from a label's text and says how sure it is.
 *
 * Samsung codes have a fixed shape: "SM-" + a letter + three digits + a letter or digit (SM-A165F, SM-S938B). A label prints the code twice:
 * on the "Model : SM-A165F/DS" line and at the start of the product code line ("SM-A165FZADMEA"). The text reader sometimes returns a letter in
 * a digit position (S for 5, O for 0, I or l for 1, B for 8, Z for 2, G for 6), seen on a real photo as "SM-A16SF".
 *
 * Rules: a code read cleanly on both lines (or one clean code only) is certain. A code that needed one of those character repairs, or two lines
 * that disagree, is returned but marked uncertain, so the record asks for a review. It never invents a code from nothing.
 * Pure Java (unit-tested on the JVM).
 */
final class SamsungModel {
    private SamsungModel() { }

    static final class Reading {
        final String model;      // "SM-A165F", a name like "Samsung Galaxy S25 series", or "" when nothing was found
        final boolean uncertain;
        final String note;       // why it is uncertain (for the review screen), "" when certain
        Reading(String model, boolean uncertain, String note) { this.model = model; this.uncertain = uncertain; this.note = note; }
    }

    private static final Pattern LABELLED = Pattern.compile("\\bmodel\\s*[:：;.-]?\\s*S\\s*M\\s*[-–—]?\\s*([A-Z0-9|]{5})", Pattern.CASE_INSENSITIVE);
    private static final Pattern VISIBLE = Pattern.compile("\\bS\\s*M\\s*[-–—]\\s*([A-Z0-9|]{5})", Pattern.CASE_INSENSITIVE);
    static final Pattern EXACT = Pattern.compile("[A-Z][0-9]{3}[A-Z0-9]");
    static final String NO_CODE_NOTE = "No model code was read. Type the code from the label (for example SM-A165F).";

    /** A letter the reader gives for a digit, in a position that must be a digit. */
    static char digitFor(char c) {
        switch (c) {
            case 'O': case 'D': case 'Q': return '0';
            case 'I': case 'L': case '|': case 'T': return '1';
            case 'Z': return '2';
            case 'S': return '5';
            case 'G': case 'b': return '6';
            case 'B': return '8';
            default: return c;
        }
    }

    /** The code with confusable letters in the three digit positions turned into digits, or "" when it still does not fit the shape. */
    static String repaired(String code) {
        if (code.length() != 5) return "";
        StringBuilder out = new StringBuilder().append(code.charAt(0));
        for (int i = 1; i <= 3; i++) out.append(digitFor(code.charAt(i)));
        out.append(code.charAt(4));
        String result = out.toString();
        return EXACT.matcher(result).matches() ? result : "";
    }

    static Reading read(String text) {
        Matcher labelled = LABELLED.matcher(text);
        String labelledCode = labelled.find() ? labelled.group(1).toUpperCase(Locale.US) : "";
        Set<String> exact = new LinkedHashSet<>(), repairedCodes = new LinkedHashSet<>();
        Matcher visible = VISIBLE.matcher(text);
        while (visible.find()) {
            String code = visible.group(1).toUpperCase(Locale.US);
            if (EXACT.matcher(code).matches()) exact.add(code);
            else { String fixed = repaired(code); if (!fixed.isEmpty()) repairedCodes.add(fixed); }
        }
        if (!labelledCode.isEmpty()) {
            if (EXACT.matcher(labelledCode).matches()) exact.add(labelledCode);
            else { String fixed = repaired(labelledCode); if (!fixed.isEmpty()) repairedCodes.add(fixed); }
        }
        if (exact.size() == 1) {
            String code = exact.iterator().next();
            // A cleanly read code: certain, unless another line of the same label repairs to something different.
            for (String other : repairedCodes) if (!other.equals(code)) return new Reading("SM-" + code, true, "The two model lines disagree (SM-" + code + " / SM-" + other + "). Check the model.");
            return new Reading("SM-" + code, false, "");
        }
        if (exact.size() > 1) {
            String first = exact.contains(labelledCode) ? labelledCode : exact.iterator().next();
            return new Reading("SM-" + first, true, "Different model codes were read (" + String.join(", ", exact) + "). Check the model.");
        }
        if (repairedCodes.size() == 1) {
            String code = repairedCodes.iterator().next();
            return new Reading("SM-" + code, true, "The model code was not clearly readable; read as SM-" + code + ". Check the model.");
        }
        if (repairedCodes.size() > 1) {
            return new Reading("SM-" + repairedCodes.iterator().next(), true, "The model code was not clearly readable. Check the model.");
        }
        // Text that looks like a model code but fits no Samsung shape even after repairs: the caller keeps it as read, flagged.
        if (!labelledCode.isEmpty() || VISIBLE.matcher(text).find()) return new Reading("", true, "The model code could not be read clearly. Check the model.");
        return new Reading("", true, "");
    }

    /** True when a typed model code has the Samsung shape (used to validate manual edits on the page as well). */
    static boolean looksLikeSamsungCode(String model) {
        return model != null && model.toUpperCase(Locale.US).matches("SM-[A-Z][0-9]{3}[A-Z0-9][A-Z0-9/]*");
    }
}
