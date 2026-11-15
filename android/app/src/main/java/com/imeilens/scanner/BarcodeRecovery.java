package com.imeilens.scanner;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The strict decision for an IMEI 1 recovered from a barcode that was found again at full resolution (the strip above the label's own
 * "IMEI 1" line, read in several sizes and contrasts). The decoding itself is ML Kit's (Code 128 has its own check character); this class
 * only decides whether what was decoded may be trusted as IMEI 1. It never computes or completes a number: the value is a barcode's own.
 * Pure Java (unit-tested on the JVM).
 *
 * A candidate is accepted only when ALL of these hold:
 *   1. it has 15 digits and passes the IMEI checksum (Luhn);
 *   2. it is the only distinct valid value found (two different values = ambiguous, nothing is taken);
 *   3. it is not this label's IMEI 2;
 *   4. it agrees with the digits that were printed-and-read on the IMEI 1 line, when at least 6 were read (an OCR slip is tolerated,
 *      a different number is not: then the barcode and the printed digits disagree and neither is trusted).
 * The caller adds the position rule (the strip is the area directly above the label's own "IMEI 1" text line).
 */
final class BarcodeRecovery {
    private BarcodeRecovery() { }

    static final String OK = "ok", NONE = "none", AMBIGUOUS = "ambiguous", IS_IMEI2 = "is-imei2", CONFLICT = "conflict";

    static final class Decision {
        final String imei;
        /** One of OK, NONE, AMBIGUOUS, IS_IMEI2, CONFLICT. */
        final String why;
        Decision(String imei, String why) { this.imei = imei; this.why = why; }
        boolean accepted() { return OK.equals(why); }
    }

    /**
     * @param candidates every barcode value decoded in the strip, from every variant tried (repeats are fine)
     * @param imei2      this label's IMEI 2 when known ("" otherwise)
     * @param printedRun the longest run of digits read on the printed IMEI 1 line ("" when none)
     */
    static Decision decide(List<String> candidates, String imei2, String printedRun) {
        Set<String> valid = new LinkedHashSet<>();
        if (candidates != null) for (String value : candidates) if (value != null && ImeiSource.luhn(value)) valid.add(value);
        if (valid.isEmpty()) return new Decision("", NONE);
        if (valid.size() > 1) return new Decision("", AMBIGUOUS);
        String value = valid.iterator().next();
        if (imei2 != null && value.equals(imei2)) return new Decision("", IS_IMEI2);
        if (!consistent(value, printedRun)) return new Decision("", CONFLICT);
        return new Decision(value, OK);
    }

    /**
     * True when the printed digits do not contradict the number. A run shorter than 6 digits says too little and never contradicts.
     * Otherwise the run is slid along the 15 digits and the best fit may differ in at most one digit per 6 read (an OCR slip such as 8
     * for 6), so a barcode of a different number (which differs in most places) is refused.
     */
    static boolean consistent(String value, String run) {
        if (run == null || run.length() < 6) return true;
        String digits = run.length() > 15 ? run.substring(0, 15) : run;
        int allowed = digits.length() / 6;
        int best = Integer.MAX_VALUE;
        for (int offset = 0; offset + digits.length() <= value.length(); offset++) {
            int different = 0;
            for (int index = 0; index < digits.length(); index++) if (value.charAt(offset + index) != digits.charAt(index)) different++;
            best = Math.min(best, different);
        }
        return best <= allowed;
    }
}
