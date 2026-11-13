package com.imeilens.scanner;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Which printed line an IMEI was taken from. Pure Java, unit-tested on a normal JVM. */
final class ImeiSource {
    private static final Pattern FIRST = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*[1I]\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?!\\d)");
    private static final Pattern SECOND = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*2\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?!\\d)");

    private ImeiSource() {}

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
     * Samsung prints IMEI 1 and IMEI 2 of one device with the same serial part (digits 9 to 14) and different first 8 digits (seen on every
     * label of three models in the test data). Among decoded barcodes, the one that is THIS device's IMEI 1: checksum-valid, not IMEI 2 itself,
     * same serial part, different first 8 digits. Exactly one such barcode, or "" (never guessed, never computed: the number is the barcode's own).
     * A barcode of another label cannot match, because its serial part is different.
     */
    static String sameDeviceImei1(String imei2, Iterable<String> barcodes) {
        if (!luhn(imei2)) return "";
        java.util.Set<String> found = new java.util.HashSet<>();
        for (String value : barcodes) {
            if (!luhn(value) || value.equals(imei2)) continue;
            if (value.substring(8, 14).equals(imei2.substring(8, 14)) && !value.substring(0, 8).equals(imei2.substring(0, 8))) found.add(value);
        }
        return found.size() == 1 ? found.iterator().next() : "";
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
