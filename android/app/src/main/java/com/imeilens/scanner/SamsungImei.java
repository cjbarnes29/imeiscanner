package com.imeilens.scanner;

/**
 * Samsung-only IMEI rules, read from the Samsung profile (brands/profiles/samsung.json). Kept apart from the general IMEI code (ImeiSource) so they are
 * never applied to another manufacturer's label.
 *
 * The same-device rule: on Samsung box labels, IMEI 1 and IMEI 2 of one device have the same serial part (digits 9 to 14) and different first
 * 8 digits. This was seen on every label of three Samsung models in the test data. It is NOT assumed for any other brand, and it is not proven
 * for every Samsung model: a number found this way is always marked for review (trust level "observed" in the profile).
 */
final class SamsungImei {
    private SamsungImei() { }

    private static BrandProfile profile() { return BrandRegistry.byId("samsung"); }

    /** Shown on a record whose IMEI 1 was found by the rule. */
    static String ruleNote() { return profile().rule("shared-digits").note; }

    /** True when the label's text shows it is a Samsung label. Without this, no Samsung rule is used. */
    static boolean isSamsungLabel(String labelText) { return profile().hasEvidence(labelText); }

    /**
     * Among decoded barcodes, the one that is THIS device's IMEI 1: checksum-valid, not IMEI 2 itself, same serial part, different first
     * 8 digits. Exactly one such barcode, or "" (never guessed, never computed). Callers must check isSamsungLabel first.
     */
    static String sameDeviceImei1(String imei2, Iterable<String> barcodes) {
        return BrandProfile.sharedDigitsCounterpart(profile().rule("shared-digits"), imei2, barcodes);
    }
}
