package com.imeilens.scanner;

import static org.junit.Assert.*;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Hints that make a photo need a look: IMEI 2 used instead of IMEI 1, barcode numbers without a label. */
public class ScanLedgerHintsTest {
    private static JSONObject row(String id, String imei) throws Exception {
        return new JSONObject().put("id", id).put("imei", imei).put("status", "Valid").put("cropNeedsReview", false);
    }
    private static JSONObject scan(JSONArray products) throws Exception {
        return ScanLedger.scanned("content://x/1", "a.jpg", "h", "job", "2026-01-01T00:00:00Z", products, products, new JSONArray(), new JSONArray(), new JSONArray());
    }

    @Test public void imei2FallbackCountsAsReviewButNotAsMissing() throws Exception {
        JSONArray products = new JSONArray().put(row("1", "490154203237518").put("imeiFallback", true)).put(row("2", "356938035643809"));
        JSONObject entry = scan(products);
        assertEquals(1, entry.getInt("review"));
        assertEquals(0, entry.getInt("missingImei"));
        assertFalse(entry.getBoolean("needsRescan"));
    }

    @Test public void barcodeNumbersWithoutALabelMakeThePhotoEligibleForRescan() throws Exception {
        JSONArray products = new JSONArray().put(row("1", "490154203237518").put("orphanBarcodes", 2)).put(row("2", "356938035643809").put("orphanBarcodes", 2));
        JSONObject entry = scan(products);
        assertEquals(2, entry.getInt("orphanBarcodes"));
        assertTrue(entry.getBoolean("needsRescan"));
        JSONArray photos = new JSONArray().put(entry);
        assertEquals(1, ScanLedger.rescanQueue(photos).length());
    }

    @Test public void cleanPhotoNeedsNothing() throws Exception {
        JSONObject entry = scan(new JSONArray().put(row("1", "490154203237518")));
        assertEquals(0, entry.getInt("orphanBarcodes"));
        assertFalse(entry.getBoolean("needsRescan"));
        assertEquals(0, entry.getInt("review"));
    }
}
