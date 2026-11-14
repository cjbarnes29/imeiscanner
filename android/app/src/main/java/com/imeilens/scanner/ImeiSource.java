package com.imeilens.scanner;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Which printed line an IMEI was taken from. Pure Java, unit-tested on a normal JVM. */
final class ImeiSource {
    private static final Pattern FIRST = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*[1I]\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?!\\d)");
    private static final Pattern SECOND = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*2\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?!\\d)");

    private ImeiSource() {}

    /** Shown on a record whose IMEI 1 came from the whole-photo read because the label's own crop gave none. Never accepted without a person's check. */
    static final String PHOTO_READ_NOTE = "IMEI 1 was read from the whole photo because this label's own crop could not be read. Check it against the label.";

    static boolean luhn(String value) {
        if (value == null || !value.matches("[0-9]{15}")) return false;
        int sum = 0;
        for (int i = 0; i < 15; i++) {
            int n = value.charAt(14 - i) - '0';
            if (i % 2 == 1) { n *= 2; if (n > 9) n -= 9; }
            sum += n;
        }
        return sum % 10 == 0;
    }

    /** The first checksum-valid number printed after "IMEI 2" in the text, or "". */
    static String secondImeiInText(String raw) {
        if (raw == null) return "";
        Matcher second = SECOND.matcher(raw.replace('\n', ' '));
        while (second.find()) { String value = second.group(1).replaceAll("\\D", ""); if (luhn(value)) return value; }
        return "";
    }

    /**
     * True when the IMEI is the label's IMEI 2: it is printed after "IMEI 2" and the label has no valid IMEI 1 with the same number
     * (and it was not confirmed by the barcode under IMEI 1). Such a record is kept, but it is never presented as IMEI 1:
     * the app marks it "IMEI 1 not read" and asks for a review.
     */
    static boolean usesSecondImei(String raw, String imei) {
        if (raw == null || imei == null || imei.isEmpty()) return false;
        String text = raw.replace('\n', ' ');
        Matcher first = FIRST.matcher(text);
        while (first.find()) if (first.group(1).replaceAll("\\D", "").equals(imei) && luhn(imei)) return false;
        if (raw.contains("IMEI 1 (barcode): " + imei)) return false;
        Matcher second = SECOND.matcher(text);
        while (second.find()) if (second.group(1).replaceAll("\\D", "").equals(imei)) return true;
        return false;
    }
}
