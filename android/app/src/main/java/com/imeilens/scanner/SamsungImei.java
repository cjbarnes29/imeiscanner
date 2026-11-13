package com.imeilens.scanner;

import java.util.regex.Pattern;

/**
 * Samsung-only IMEI rules. Kept apart from the general IMEI code (ImeiSource) so they are never applied to another manufacturer's label.
 *
 * The same-device rule: on Samsung box labels, IMEI 1 and IMEI 2 of one device have the same serial part (digits 9 to 14) and different first
 * 8 digits. This was seen on every label of three Samsung models in the test data. It is NOT assumed for any other brand, and it is not proven
 * for every Samsung model: a number found this way is always marked for review. Pure Java (unit-tested on the JVM).
 */
final class SamsungImei {
    private SamsungImei() { }

    /** Samsung evidence in the label's own text: the word SAMSUNG or a Samsung model code ("SM-" + 5 characters, as printed or misread). */
    private static final Pattern SAMSUNG_EVIDENCE = Pattern.compile("(?i:\\bSAMSUNG\\b)|\\bS\\s*M\\s*[-–—]\\s*[A-Z0-9|]{5}");

    static final String RULE_NOTE = "IMEI 1 was taken from its barcode because its printed number could not be read. Check it against the label.";

    /** True when the label's text shows it is a Samsung label. Without this, no Samsung rule is used. */
    static boolean isSamsungLabel(String labelText) {
        return labelText != null && SAMSUNG_EVIDENCE.matcher(labelText).find();
    }

    /**
     * Among decoded barcodes, the one that is THIS device's IMEI 1: checksum-valid, not IMEI 2 itself, same serial part, different first
     * 8 digits. Exactly one such barcode, or "" (never guessed, never computed: the number is the barcode's own). A barcode of another label
     * cannot match, because its serial part is different. Callers must check isSamsungLabel first.
     */
    static String sameDeviceImei1(String imei2, Iterable<String> barcodes) {
        if (!ImeiSource.luhn(imei2)) return "";
        java.util.Set<String> found = new java.util.HashSet<>();
        for (String value : barcodes) {
            if (!ImeiSource.luhn(value) || value.equals(imei2)) continue;
            if (value.substring(8, 14).equals(imei2.substring(8, 14)) && !value.substring(0, 8).equals(imei2.substring(0, 8))) found.add(value);
        }
        return found.size() == 1 ? found.iterator().next() : "";
    }
}
