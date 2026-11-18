package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WhatsAppReadyPlanTest {
    @Test public void numbersAreCleanedAndValidatedLikeThePage() {
        assertEquals("971501234567", WhatsAppReadyPlan.cleanPhone("+971 (50) 123-4567"));
        assertEquals("", WhatsAppReadyPlan.cleanPhone(null));
        assertTrue(WhatsAppReadyPlan.validPhone("971501234567"));
        assertFalse("a leading zero is not international", WhatsAppReadyPlan.validPhone("0501234567"));
        assertFalse("too short", WhatsAppReadyPlan.validPhone("12345"));
        assertFalse("not digits", WhatsAppReadyPlan.validPhone("97150abc4567"));
        assertFalse(WhatsAppReadyPlan.validPhone(null));
    }

    @Test public void chatLinkFillsInTheTextSafely() {
        assertEquals("https://wa.me/971501234567?text=Daily%20Report%202026-11-18%0AA17%20%3A%2003%2F10",
            WhatsAppReadyPlan.chatLink("971501234567", "Daily Report 2026-11-18\nA17 : 03/10"));
        assertNull("an invalid number never makes a link", WhatsAppReadyPlan.chatLink("0501234567", "text"));
        assertNull("no text, no link", WhatsAppReadyPlan.chatLink("971501234567", ""));
        assertNull(WhatsAppReadyPlan.chatLink("971501234567", null));
        assertNull("a long message uses the share sheet instead", WhatsAppReadyPlan.chatLink("971501234567", "x".repeat(WhatsAppReadyPlan.MAX_LINK_TEXT + 1)));
        assertEquals("the limit itself is allowed", true, WhatsAppReadyPlan.chatLink("971501234567", "x".repeat(WhatsAppReadyPlan.MAX_LINK_TEXT)) != null);
    }

    @Test public void specialCharactersCannotBreakTheLink() {
        String link = WhatsAppReadyPlan.chatLink("971501234567", "a&b=c?d#e + f");
        assertFalse(link.substring(link.indexOf("?text=") + 6).contains("&"));
        assertFalse(link.substring(link.indexOf("?text=") + 6).contains("#"));
        assertFalse(link.contains("+ f"));
    }
}
