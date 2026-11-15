package com.imeilens.scanner;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Why a label has no usable IMEI 1, from what the reader saw in the label's own text. Words only: a kind is never made of, or
 * followed by, any digit of a number. The scan report counts these kinds and the review screens show them, so a person (and the
 * retry that follows a scan) can tell "nothing to read here" from "almost read" from "cut by the photo edge".
 * Pure Java (unit-tested on the JVM).
 *
 *   cut-edge          the label touches the photo's edge (LabelIssue): a retake is needed, nothing is guessed
 *   imei2-only        IMEI 2 was read but IMEI 1 was not (never copied into IMEI 1)
 *   checksum-failed   a full 15-digit number was read on the IMEI 1 line but it is not a valid IMEI (or two different ones were read)
 *   partial-number    only some digits of the IMEI 1 line were read
 *   line-unreadable   the "IMEI 1" line is there, its digits could not be read
 *   no-imei-line      other label text was read (model, serial, IMEI 2) but no IMEI 1 line
 *   no-text           no label text at all (blank, very blurry, not a label)
 *   barcode-conflict  the barcode and the printed digits disagree, so neither was trusted
 */
final class FailReason {
    private FailReason() { }

    static final String CUT_EDGE = "cut-edge", IMEI2_ONLY = "imei2-only", CHECKSUM = "checksum-failed", PARTIAL = "partial-number",
        LINE_UNREADABLE = "line-unreadable", NO_IMEI_LINE = "no-imei-line", NO_TEXT = "no-text", CONFLICT = "barcode-conflict";

    /** Every kind, in the order the report lists them. */
    static final String[] ALL = {CUT_EDGE, IMEI2_ONLY, CHECKSUM, PARTIAL, LINE_UNREADABLE, NO_IMEI_LINE, NO_TEXT, CONFLICT};

    private static final Pattern ONE_LABEL = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*[1I](?![0-9A-Za-z])");
    private static final Pattern OTHER_LABEL_TEXT = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]|\\bS\\s*/\\s*N\\b|\\bSERIAL\\b|\\bMODEL\\b|SM\\s*-\\s*[A-Z]\\d{3}|\\bSAMSUNG\\b");

    /** True for a kind a retry cannot change (the number is simply not in the photo). */
    static boolean unfixableByRetry(String kind) { return CUT_EDGE.equals(kind); }

    /**
     * @param raw          the label's text as read (lines separated by newlines)
     * @param imei         the IMEI that was found for the record ("" when none)
     * @param imei2Only    true when that IMEI is IMEI 2 standing in for the missing IMEI 1
     * @param labelIssue   the LabelIssue kind of the record ("" when none)
     * @return "" when IMEI 1 was read; otherwise one kind from {@link #ALL}
     */
    static String classify(String raw, String imei, boolean imei2Only, String labelIssue) {
        if (imei2Only) return IMEI2_ONLY;
        if (imei != null && !imei.isEmpty()) return "";
        if (LabelIssue.CUT_EDGE.equals(labelIssue)) return CUT_EDGE;
        String text = raw == null ? "" : raw;
        boolean sawLine = false;
        int most = 0;
        for (String line : text.split("\\r?\\n")) {
            Matcher label = ONE_LABEL.matcher(line);
            if (!label.find()) continue;
            sawLine = true;
            most = Math.max(most, digitsAfter(line, label.end()));
        }
        if (sawLine) return most >= 15 ? CHECKSUM : most > 0 ? PARTIAL : LINE_UNREADABLE;
        return OTHER_LABEL_TEXT.matcher(text).find() ? NO_IMEI_LINE : NO_TEXT;
    }

    /** How many digits follow the label on the same line (spaces and hyphens inside a number are skipped). */
    static int digitsAfter(String line, int from) {
        int count = 0;
        for (int index = from; index < line.length(); index++) {
            char c = line.charAt(index);
            if (c >= '0' && c <= '9') count++;
            else if (c == ' ' || c == '-' || c == ':' || c == '#' || c == '.') continue;
            else if (count > 0) break; // letters after the number end it; letters before it are OCR noise
        }
        return count;
    }

    /**
     * The longest run of digits printed after the label "IMEI 1" in the text (spaces and hyphens skipped), "" when none. Used only to
     * check a barcode against what was printed; never stored and never shown.
     */
    static String printedRun(String raw) {
        String best = "";
        if (raw == null) return best;
        for (String line : raw.split("\\r?\\n")) {
            Matcher label = ONE_LABEL.matcher(line);
            if (!label.find()) continue;
            StringBuilder run = new StringBuilder();
            for (int index = label.end(); index < line.length(); index++) {
                char c = line.charAt(index);
                if (c >= '0' && c <= '9') run.append(c);
                else if (c == ' ' || c == '-' || c == ':' || c == '#' || c == '.') continue;
                else if (run.length() > 0) break;
            }
            if (run.length() > best.length()) best = run.toString();
        }
        return best;
    }
}
