package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** The scan report and the repeat-scan rules: source photos counted apart from product records; nothing selected vanishes; no duplicate empties. */
public class ScanLedgerTest {
    static final String AT = "2026-11-13T00:00:00.000Z";
    static final JSONArray NONE = new JSONArray();

    static JSONObject product(String id, String imei, boolean review) throws Exception {
        return new JSONObject().put("id", id).put("imei", imei).put("status", imei.isEmpty() ? "Review" : "Valid").put("cropNeedsReview", review);
    }

    static JSONObject scanned(String uri, String name, String hash, String job, JSONArray products, JSONArray saved, JSONArray dups) throws Exception {
        return ScanLedger.scanned(uri, name, hash, job, AT, products, saved, dups, new JSONArray(), new JSONArray());
    }

    // ---- the report --------------------------------------------------------------------------------------------------

    @Test public void aPhotoWithTwoProductsOneDuplicateIsAccountedFor() throws Exception {
        JSONArray products = new JSONArray().put(product("a", "351973130000001", false)).put(product("b", "351973130000002", false));
        JSONArray saved = new JSONArray().put(products.get(0));
        JSONArray duplicates = new JSONArray().put(new JSONObject().put("imei", "351973130000002").put("of", "old-record"));
        JSONObject entry = scanned("content://x/1", "two.jpg", "h1", "job1", products, saved, duplicates);
        assertEquals(2, entry.getInt("products"));
        assertEquals(1, entry.getInt("saved"));
        assertEquals(2, entry.getJSONArray("imeis").length());
        assertEquals(0, entry.getInt("missingImei"));
        assertEquals("the dropped duplicate names the record that already holds the IMEI", "old-record", entry.getJSONArray("duplicates").getJSONObject(0).getString("of"));
        assertFalse(entry.getBoolean("needsRescan"));
    }

    @Test public void aPhotoMissingALabelIsReportedForRetakeWithItsReason() throws Exception {
        JSONObject row = product("a", "351973130000001", true).put("labelIssue", "cut-edge").put("labelIssueSide", "bottom").put("labelsMissing", 1);
        JSONArray products = new JSONArray().put(row);
        JSONObject entry = scanned("content://x/9", "cut.jpg", "h9", "job1", products, products, NONE);
        assertTrue(entry.getBoolean("retake"));
        assertEquals("cut-edge", entry.getString("retakeKind"));
        assertEquals("bottom", entry.getString("retakeSide"));
        assertEquals(1, entry.getInt("retakeMissing"));
        JSONObject plain = scanned("content://x/10", "ok.jpg", "h10", "job1", new JSONArray().put(product("b", "351973130000002", false)), new JSONArray().put(product("b", "351973130000002", false)), NONE);
        assertFalse("no issue, no retake entry", plain.has("retake"));
        JSONObject summary = ScanLedger.summarize(new JSONArray().put(entry).put(plain), "job1");
        assertEquals(1, summary.getInt("retake"));
    }

    @Test public void aProductWithoutImeiMakesThePhotoEligibleForRescan() throws Exception {
        JSONArray products = new JSONArray().put(product("a", "", true));
        JSONObject entry = scanned("content://x/2", "blank.jpg", "h2", "job1", products, products, NONE);
        assertEquals(1, entry.getInt("missingImei"));
        assertEquals(1, entry.getInt("review"));
        assertTrue(entry.getBoolean("needsRescan"));
    }

    @Test public void aFailedPhotoKeepsItsReasonAndStaysEligible() throws Exception {
        JSONObject entry = ScanLedger.failed("content://x/3", "bad.jpg", "", "job1", AT, "IllegalArgumentException: Cannot decode image");
        assertEquals("failed", entry.getString("outcome"));
        assertEquals("IllegalArgumentException: Cannot decode image", entry.getString("reason"));
        assertTrue(entry.getBoolean("needsRescan"));
        assertEquals(0, entry.getInt("products"));
    }

    @Test public void aRepeatedPictureIsLinkedToTheFirstCopyNotSilentlySkipped() throws Exception {
        JSONObject entry = ScanLedger.duplicatePhoto("content://x/5", "copy.jpg", "h1", "job1", AT, "content://x/1");
        assertEquals("duplicate-photo", entry.getString("outcome"));
        assertEquals("content://x/1", entry.getString("duplicateOfUri"));
        assertFalse(entry.getBoolean("needsRescan"));
    }

    @Test public void summaryObeysTheAccountingRules() throws Exception {
        JSONArray photos = new JSONArray();
        // photo 1: 2 products, 1 saved, 1 duplicate IMEI
        JSONArray p1 = new JSONArray().put(product("a", "351973130000001", false)).put(product("b", "351973130000002", false));
        ScanLedger.upsert(photos, scanned("u1", "one.jpg", "h1", "job1", p1, new JSONArray().put(p1.get(0)),
            new JSONArray().put(new JSONObject().put("imei", "351973130000002").put("of", "old"))));
        // photo 2: 1 product without IMEI that is a repeat of an earlier empty record (not added again)
        JSONArray p2 = new JSONArray().put(product("c", "", true));
        ScanLedger.upsert(photos, ScanLedger.scanned("u2", "two.jpg", "h2", "job1", AT, p2, NONE, NONE,
            new JSONArray().put(new JSONObject().put("of", "earlier-empty")), NONE));
        // photo 3: failed; photo 4: same picture as photo 1
        ScanLedger.upsert(photos, ScanLedger.failed("u3", "three.jpg", "", "job1", AT, "boom"));
        ScanLedger.upsert(photos, ScanLedger.duplicatePhoto("u4", "four.jpg", "h1", "job1", AT, "u1"));
        // an older job's photo that still needs a new scan
        ScanLedger.upsert(photos, ScanLedger.failed("u9", "old.jpg", "", "job0", AT, "earlier failure"));

        JSONObject s = ScanLedger.summarize(photos, "job1");
        assertEquals(4, s.getInt("photos"));
        assertEquals(2, s.getInt("scanned"));
        assertEquals(1, s.getInt("failed"));
        assertEquals(1, s.getInt("duplicatePhotos"));
        assertEquals("every photo has exactly one outcome", s.getInt("photos"), s.getInt("scanned") + s.getInt("failed") + s.getInt("duplicatePhotos"));
        assertEquals(3, s.getInt("products"));
        assertEquals(1, s.getInt("saved"));
        assertEquals(1, s.getInt("duplicateImeis"));
        assertEquals(1, s.getInt("emptyRepeats"));
        assertEquals("every product is saved, a linked duplicate IMEI, or a linked empty repeat", s.getInt("products"), s.getInt("saved") + s.getInt("duplicateImeis") + s.getInt("emptyRepeats"));
        assertEquals(2, s.getInt("imeisDetected"));
        assertEquals(1, s.getInt("missingImei"));
        assertEquals("imeis read + products without an IMEI = products", s.getInt("products"), s.getInt("imeisDetected") + s.getInt("missingImei"));
        assertEquals("needing a new scan in this job: the empty-repeat photo and the failed one", 2, s.getInt("needRescanInJob"));
        assertEquals("needing a new scan overall includes the older job", 3, s.getInt("needRescan"));
    }

    @Test public void scanningThePhotoAgainReplacesItsEntryAndKeepsAHistory() throws Exception {
        JSONArray photos = new JSONArray();
        ScanLedger.upsert(photos, ScanLedger.failed("u1", "a.jpg", "h", "job1", AT, "first try"));
        JSONArray products = new JSONArray().put(product("a", "351973130000001", false));
        ScanLedger.upsert(photos, scanned("u1", "a.jpg", "h", "job2", products, products, NONE));
        assertEquals("still one entry for the photo", 1, photos.length());
        JSONObject entry = photos.getJSONObject(0);
        assertEquals(2, entry.getInt("scans"));
        assertEquals("scanned", entry.getString("outcome"));
        assertFalse("it read an IMEI this time, so it no longer needs a rescan", entry.getBoolean("needsRescan"));
        assertEquals("failed", entry.getJSONArray("history").getJSONObject(0).getString("outcome"));
    }

    @Test public void historyIsCapped() throws Exception {
        JSONArray photos = new JSONArray();
        for (int i = 0; i < 12; i++) ScanLedger.upsert(photos, ScanLedger.failed("u1", "a.jpg", "h", "job" + i, AT, "try " + i));
        JSONObject entry = photos.getJSONObject(0);
        assertEquals(12, entry.getInt("scans"));
        assertEquals(ScanLedger.HISTORY, entry.getJSONArray("history").length());
        assertEquals("job10", entry.getJSONArray("history").getJSONObject(ScanLedger.HISTORY - 1).getString("jobId"));
    }

    @Test public void rescanQueueHoldsOnlyPhotosThatNeedIt() throws Exception {
        JSONArray photos = new JSONArray();
        JSONArray ok = new JSONArray().put(product("a", "351973130000001", false));
        ScanLedger.upsert(photos, scanned("u1", "ok.jpg", "h1", "job1", ok, ok, NONE));
        ScanLedger.upsert(photos, ScanLedger.failed("u2", "bad.jpg", "", "job1", AT, "x"));
        JSONArray none = new JSONArray().put(product("b", "", true));
        ScanLedger.upsert(photos, scanned("u3", "blank.jpg", "h3", "job1", none, none, NONE));
        ScanLedger.upsert(photos, ScanLedger.duplicatePhoto("u4", "copy.jpg", "h1", "job1", AT, "u1"));
        JSONArray queue = ScanLedger.rescanQueue(photos);
        assertEquals(2, queue.length());
        assertEquals("u2", queue.getJSONObject(0).getString("uri"));
        assertEquals("u3", queue.getJSONObject(1).getString("uri"));
    }

    @Test public void anOldFileWithoutAPhotosListStillSummarizes() throws Exception {
        JSONObject s = ScanLedger.summarize(new JSONArray(), "none");
        assertEquals(0, s.getInt("photos"));
        assertEquals(0, s.getInt("needRescan"));
    }

    // ---- repeat scans: no duplicate empty records, nothing existing lost ------------------------------------------------

    static JSONArray rows(JSONObject... items) { JSONArray a = new JSONArray(); for (JSONObject o : items) a.put(o); return a; }

    @Test public void aRepeatScanOfAPhotoWithoutImeiAddsNoSecondEmptyRecord() throws Exception {
        List<String> dropped = new ArrayList<>();
        ScanLedger.Split s = ScanLedger.split(rows(product("new1", "", true)), new HashMap<>(), Arrays.asList("old-empty"), row -> dropped.add(row.optString("id")));
        assertEquals(0, s.unique.length());
        assertEquals(1, s.emptyRepeats.length());
        assertEquals("linked to the record that is kept", "old-empty", s.emptyRepeats.getJSONObject(0).getString("of"));
        assertEquals("only the picture just made for the repeat is dropped", Arrays.asList("new1"), dropped);
        assertEquals(0, s.supersedes.length());
    }

    @Test public void aFirstScanStillSavesTheEmptyRecord() throws Exception {
        ScanLedger.Split s = ScanLedger.split(rows(product("new1", "", true)), new HashMap<>(), new ArrayList<>(), row -> { });
        assertEquals("a photo with no earlier record keeps its evidence record", 1, s.unique.length());
        assertEquals(0, s.emptyRepeats.length());
    }

    @Test public void aPhotoWithTwoUnreadableProductsKeepsExactlyTwoEmptyRecordsAcrossRepeats() throws Exception {
        // First scan: 2 empties saved. Repeat: 2 empties, both linked. A third empty product (a better read of a third label) is still saved.
        ScanLedger.Split repeat = ScanLedger.split(rows(product("n1", "", true), product("n2", "", true)), new HashMap<>(), Arrays.asList("e1", "e2"), row -> { });
        assertEquals(0, repeat.unique.length());
        assertEquals(2, repeat.emptyRepeats.length());
        ScanLedger.Split more = ScanLedger.split(rows(product("n1", "", true), product("n2", "", true), product("n3", "", true)), new HashMap<>(), Arrays.asList("e1", "e2"), row -> { });
        assertEquals(1, more.unique.length());
        assertEquals("n3", more.unique.getJSONObject(0).getString("id"));
    }

    @Test public void aRescanThatFinallyReadsAnImeiSavesItAndMentionsTheEarlierEmptyRecord() throws Exception {
        ScanLedger.Split s = ScanLedger.split(rows(product("n1", "351973130000001", false)), new HashMap<>(), Arrays.asList("old-empty"), row -> { });
        assertEquals(1, s.unique.length());
        assertEquals(0, s.emptyRepeats.length());
        assertEquals("the earlier empty record is kept and only mentioned", "old-empty", s.supersedes.getString(0));
    }

    @Test public void duplicateImeisStillLinkToTheRecordThatHoldsThem() throws Exception {
        Map<String, String> seen = new HashMap<>();
        seen.put("351973130000001", "holder");
        List<String> dropped = new ArrayList<>();
        ScanLedger.Split s = ScanLedger.split(rows(product("n1", "351973130000001", false), product("n2", "351973130000002", false)), seen, new ArrayList<>(), row -> dropped.add(row.optString("id")));
        assertEquals(1, s.unique.length());
        assertEquals("holder", s.duplicates.getJSONObject(0).getString("of"));
        assertEquals(Arrays.asList("n1"), dropped);
        assertEquals("the new IMEI is now known, so a second copy in the same scan is linked to it", "n2", seen.get("351973130000002"));
    }

    @Test public void theSameImeiTwiceInOnePhotoIsOneRecordAndOneLinkedDuplicate() throws Exception {
        ScanLedger.Split s = ScanLedger.split(rows(product("n1", "351973130000001", false), product("n2", "351973130000001", false)), new HashMap<>(), new ArrayList<>(), row -> { });
        assertEquals(1, s.unique.length());
        assertEquals("n1", s.duplicates.getJSONObject(0).getString("of"));
    }

    @Test public void emptyRecordsOfAPhotoAreFoundByUriEvenWithoutAReport() throws Exception {
        // Records saved by an older version carry sourceUri but no report entry exists for them.
        JSONArray records = rows(
            new JSONObject().put("id", "r1").put("imei", "").put("sourceUri", "u1"),
            new JSONObject().put("id", "r2").put("imei", "351973130000001").put("sourceUri", "u1"),   // has an IMEI: not empty
            new JSONObject().put("id", "r3").put("imei", "").put("sourceUri", "u2"),                  // another photo
            new JSONObject().put("id", "r4").put("imei", "").put("sourceUri", "u1"));                 // picture gone: does not count
        List<String> found = ScanLedger.emptyRecordsOfPhoto(records, new JSONArray(), "u1", "", id -> !id.equals("r4"));
        assertEquals(Arrays.asList("r1"), found);
    }

    @Test public void theSamePictureFromAnotherPlaceIsMatchedByItsContent() throws Exception {
        JSONArray records = rows(new JSONObject().put("id", "r1").put("imei", "").put("sourceUri", "uOld"));
        JSONArray photos = new JSONArray();
        ScanLedger.upsert(photos, ScanLedger.scanned("uOld", "a.jpg", "samehash", "job1", AT, rows(product("r1", "", true)), rows(product("r1", "", true)), NONE, NONE, NONE));
        List<String> found = ScanLedger.emptyRecordsOfPhoto(records, photos, "uNew", "samehash", id -> true);
        assertEquals(Arrays.asList("r1"), found);
        assertTrue("a different picture is not matched", ScanLedger.emptyRecordsOfPhoto(records, photos, "uNew", "otherhash", id -> true).isEmpty());
    }

    @Test public void theSamePictureIsStillMatchedByContentAfterARepeatScanSavedNothingNew() throws Exception {
        // After a repeat scan the photo's entry has no savedIds (nothing new was saved); the kept record is named in emptyRepeats.
        JSONArray records = rows(new JSONObject().put("id", "r1").put("imei", "").put("sourceUri", "uOld"));
        JSONArray photos = new JSONArray();
        ScanLedger.upsert(photos, ScanLedger.scanned("uOld", "a.jpg", "samehash", "job2", AT, rows(product("n1", "", true)), NONE, NONE,
            new JSONArray().put(new JSONObject().put("of", "r1")), NONE));
        assertEquals(0, photos.getJSONObject(0).getJSONArray("savedIds").length());
        assertEquals(Arrays.asList("r1"), ScanLedger.emptyRecordsOfPhoto(records, photos, "uNew", "samehash", id -> true));
    }

    @Test public void emptyRecordsWithoutHashOrUriMatchNothing() throws Exception {
        JSONArray records = rows(new JSONObject().put("id", "r1").put("imei", "").put("sourceUri", ""));
        assertTrue(ScanLedger.emptyRecordsOfPhoto(records, new JSONArray(), "", "", id -> true).isEmpty());
    }
}
