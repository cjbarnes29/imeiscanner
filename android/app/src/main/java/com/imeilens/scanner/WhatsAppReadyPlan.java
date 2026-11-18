package com.imeilens.scanner;

/**
 * The rules for the "WhatsApp report is ready" notification, free of Android classes so they can be unit-tested.
 * The app never sends the message: the notification only opens WhatsApp with the text filled in, and the person taps Send.
 */
final class WhatsAppReadyPlan {
    /** Longer messages do not fit a wa.me link reliably: they go through the share sheet instead. */
    static final int MAX_LINK_TEXT = 6000;

    private WhatsAppReadyPlan() {}

    static String cleanPhone(String phone) {
        return phone == null ? "" : phone.replaceAll("[+()\\s-]", "");
    }

    /** International number without a leading zero, 8 to 15 digits (the same rule as the page). */
    static boolean validPhone(String phone) {
        return phone != null && phone.matches("[1-9][0-9]{7,14}");
    }

    static String encode(String text) {
        try { return java.net.URLEncoder.encode(text, "UTF-8").replace("+", "%20"); }
        catch (java.io.UnsupportedEncodingException impossible) { throw new IllegalStateException(impossible); }
    }

    /** A wa.me chat link with the text filled in, or null when the number is not valid or the text is too long (then the share sheet is used). */
    static String chatLink(String phone, String text) {
        if (!validPhone(phone) || text == null || text.isEmpty() || text.length() > MAX_LINK_TEXT) return null;
        return "https://wa.me/" + phone + "?text=" + encode(text);
    }
}
