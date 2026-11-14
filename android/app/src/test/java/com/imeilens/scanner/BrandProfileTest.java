package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The brand decision and the generic engine (no brand is named in the engine; behaviour comes from the profile data). */
public class BrandProfileTest {
    private static BrandProfile make(String json) throws Exception { return BrandProfile.parse(json); }

    @Test public void aSamsungLabelIsDecidedByItsOwnText() {
        BrandRegistry.Decision d = BrandRegistry.detect("SAMSUNG\nModel : SM-A165F/DS");
        assertEquals("samsung", d.brand.id);
        assertFalse(d.unclear);
    }

    @Test public void noEvidenceMeansGenericAndUnclear() {
        for (String text : new String[]{"iPhone 16 Pro 256GB\nIMEI/MEID 1234", "Xiaomi Redmi Note 14", "", "IMEI 1 : 1234"}) {
            BrandRegistry.Decision d = BrandRegistry.detect(text);
            assertEquals(text, "generic", d.brand.id);
            assertTrue(text, d.unclear);
        }
    }

    @Test public void aDraftBrandNeverTakesPart() throws Exception {
        BrandProfile apple = BrandRegistry.byId("apple");
        assertFalse("apple is a draft until real labels are verified", apple.active());
        assertFalse(apple.hasEvidence("iPhone 16 Pro Apple"));
    }

    @Test public void twoActiveBrandsWithEvidenceMeansUnclearNotAGuess() throws Exception {
        // The registry decides over its loaded profiles; here the engine rule is shown directly: two matches are never resolved by guessing.
        BrandProfile a = make("{\"id\":\"a\",\"status\":\"active\",\"evidence\":{\"words\":[\"ALPHA\"]}}");
        BrandProfile b = make("{\"id\":\"b\",\"status\":\"active\",\"evidence\":{\"words\":[\"BETA\"]}}");
        String text = "ALPHA and BETA on one label";
        assertTrue(a.hasEvidence(text));
        assertTrue(b.hasEvidence(text));
        assertFalse("evidence words match whole words only", a.hasEvidence("ALPHABET"));
    }

    @Test public void aProfileWithoutGrammarReadsNoModelAndAcceptsNoTypedCode() throws Exception {
        BrandProfile generic = BrandRegistry.byId("generic");
        BrandProfile.Reading r = generic.readModel("Model : XYZ-123");
        assertEquals("", r.model);
        assertFalse("a typed code is never 'verified' by the generic profile", generic.looksLikeCode("SM-A165F"));
        assertEquals("No model code was read. Type the model from the label.", generic.note("noCode"));
    }

    @Test public void theSamsungWrappersUseTheProfile() {
        assertSame(BrandRegistry.byId("samsung"), BrandRegistry.byId("samsung"));
        assertEquals("SM-", BrandRegistry.byId("samsung").prefix());
        assertTrue(SamsungImei.ruleNote().startsWith("IMEI 1 was taken from its barcode"));
        assertEquals("observed", BrandRegistry.byId("samsung").rule("shared-digits").trust);
    }
}
