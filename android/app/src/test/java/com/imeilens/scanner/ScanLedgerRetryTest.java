package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * Failure reasons in the scan report, the one automatic retry per photo, and the rule that a retry replaces an earlier unreadable record
 * only when it is certain which one (no duplicates, nothing unresolved lost).
 */
public class ScanLedgerRetryTest {
    static final String AT = "2026-11-15T00:00:00.000Z";
    static final String A = FailReasonTest.imei("49015420323751"), B = FailReasonTest.imei("49015420323752"), C = FailReasonTest.imei("49015420323753");

    static JSONObject product(String id, String imei, String reason) throws Exception {
        JSONObject row = new JSONObject().put("id", id).put("imei", imei).put("status", imei.isEmpty() ? "Review" : "Valid");
        if (!reason.isEmpty()) row.put("failReason", reason);
        return row;
    }

    static JSONObject scanned(String uri, String job, JSONArray products) throws Exception {
        return ScanLedger.scanned(uri, "p.jpg", "h-" + uri, job, AT, products, products, new JSONArray(), new JSONArray(), new JSONArray());
    }

    // ---- reasons ------------------------------------------------------------------------------------------------------------

    @Test public void theEntryCountsWhyEachProductHasNoImei() throws Exception {
        JSONArray products = new JSONArray().put(product("a", "", FailReason.PARTIAL)).put(product("b", "", FailReason.PARTIAL))
            .put(product("c", "", FailReason.NO_TEXT)).put(product("d", A, ""));
        JSONObject entry = scanned("u1", "job", products);
        JSONObject reasons = entry.getJSONObject("reasons");
        assertEquals(2, reasons.getInt(FailReason.PARTIAL));
        assertEquals(1, reasons.getInt(FailReason.NO_TEXT));
        assertFalse("a product with an IMEI has no reason", reasons.has(""));
        assertTrue(entry.getBoolean("retryWorthy"));
    }

    @Test public void anImei2OnlyProductIsCountedAndWorthARetry() throws Exception {
        JSONArray products = new JSONArray().put(product("a", A, "").put("imeiFallback", true));
        JSONObject entry = scanned("u2", "job", products);
        assertEquals(1, entry.getInt("imei2Only"));
        assertEquals(1, entry.getJSONObject("reasons").getInt(FailReason.IMEI2_ONLY));
        assertTrue(entry.getBoolean("retryWorthy"));
    }

    @Test public void aPhotoWhoseOnlyProblemIsACutEdgeIsNotWorthARetry() throws Exception {
        JSONObject entry = scanned("u3", "job", new JSONArray().put(product("a", "", FailReason.CUT_EDGE)));
        assertFalse("the number is not in the photo: another read cannot help", entry.getBoolean("retryWorthy"));
        JSONObject mixed = scanned("u4", "job", new JSONArray().put(product("a", "", FailReason.CUT_EDGE)).put(product("b", "", FailReason.PARTIAL)));
        assertTrue("one fixable label is enough", mixed.getBoolean("retryWorthy"));
    }

    @Test public void aCleanPhotoIsNeverRetried() throws Exception {
        JSONObject entry = scanned("u5", "job", new JSONArray().put(product("a", A, "")));
        assertFalse(entry.getBoolean("retryWorthy"));
        ScanLedger.markAutoRetry(entry, false);
        assertFalse(entry.has("autoRetry"));
    }

    // ---- one automatic retry per photo --------------------------------------------------------------------------------------

    @Test public void aWorthyPhotoWaitsForItsRetryAndTheRetryMarksItDone() throws Exception {
        JSONObject first = scanned("u6", "job", new JSONArray().put(product("a", "", FailReason.LINE_UNREADABLE)));
        ScanLedger.markAutoRetry(first, false);
        assertEquals("pending", first.getString("autoRetry"));
        JSONObject retry = scanned("u6", "job", new JSONArray().put(product("a2", "", FailReason.LINE_UNREADABLE)));
        ScanLedger.markAutoRetry(retry, true);
        assertEquals("done", retry.getString("autoRetry"));
        assertTrue(retry.getBoolean("retryJob"));
    }

    @Test public void aFailedPhotoIsWorthOneRetryToo() throws Exception {
        JSONObject failed = ScanLedger.failed("u7", "x.jpg", "h", "job", AT, "OutOfMemoryError");
        ScanLedger.markAutoRetry(failed, false);
        assertEquals("pending", failed.getString("autoRetry"));
    }

    @Test public void aRepeatedPictureIsLeftAlone() throws Exception {
        JSONObject copy = ScanLedger.duplicatePhoto("u8", "x.jpg", "h", "job", AT, "u1");
        ScanLedger.markAutoRetry(copy, false);
        ScanLedger.markAutoRetry(copy, true);
        assertFalse(copy.has("autoRetry"));
    }

    @Test public void theRetryQueueHoldsOnlyPendingPhotos() throws Exception {
        JSONArray photos = new JSONArray();
        JSONObject pending = scanned("u9", "job", new JSONArray().put(product("a", "", FailReason.NO_TEXT)));
        ScanLedger.markAutoRetry(pending, false);
        JSONObject done = scanned("u10", "job", new JSONArray().put(product("b", "", FailReason.NO_TEXT)));
        ScanLedger.markAutoRetry(done, true);
        JSONObject clean = scanned("u11", "job", new JSONArray().put(product("c", A, "")));
        ScanLedger.markAutoRetry(clean, false);
        photos.put(pending).put(done).put(clean);
        JSONArray queue = ScanLedger.autoRetryQueue(photos);
        assertEquals(1, queue.length());
        assertEquals("u9", queue.getJSONObject(0).getString("uri"));
    }

    @Test public void doneSurvivesLaterScansSoThereIsNeverASecondAutomaticRetry() throws Exception {
        JSONArray photos = new JSONArray();
        JSONObject first = scanned("u12", "job1", new JSONArray().put(product("a", "", FailReason.PARTIAL)));
        ScanLedger.markAutoRetry(first, false);
        ScanLedger.upsert(photos, first);
        JSONObject retry = scanned("u12", "job1", new JSONArray().put(product("a2", "", FailReason.PARTIAL)));
        ScanLedger.markAutoRetry(retry, true);
        ScanLedger.upsert(photos, retry);
        // the person scans it again by hand and it still fails: it must not become "pending" again
        JSONObject manual = scanned("u12", "job2", new JSONArray().put(product("a3", "", FailReason.PARTIAL)));
        ScanLedger.markAutoRetry(manual, false);
        assertEquals("pending", manual.getString("autoRetry"));
        ScanLedger.upsert(photos, manual);
        assertEquals("done", photos.getJSONObject(0).getString("autoRetry"));
        assertEquals(0, ScanLedger.autoRetryQueue(photos).length());
        assertEquals(1, photos.length());
    }

    // ---- what the retry recovered, and the report -------------------------------------------------------------------------

    @Test public void aRetryThatReadAnImeiCountsAsRecovered() throws Exception {
        JSONArray photos = new JSONArray();
        JSONObject first = scanned("u13", "job", new JSONArray().put(product("a", "", FailReason.PARTIAL)).put(product("b", "", FailReason.NO_TEXT)));
        ScanLedger.markAutoRetry(first, false);
        ScanLedger.upsert(photos, first);
        JSONObject retry = scanned("u13", "job", new JSONArray().put(product("a2", A, "")).put(product("b2", "", FailReason.NO_TEXT)));
        ScanLedger.markAutoRetry(retry, true);
        ScanLedger.upsert(photos, retry);
        JSONObject entry = photos.getJSONObject(0);
        assertEquals(1, entry.getInt("recovered"));
        JSONObject summary = ScanLedger.summarize(photos, "job");
        assertEquals(1, summary.getInt("retried"));
        assertEquals(1, summary.getInt("recovered"));
        assertEquals("one label is still unresolved", 1, summary.getInt("unresolved"));
        assertEquals(0, summary.getInt("retryPending"));
    }

    @Test public void theReportAddsUpTheReasonsOfTheCurrentScanOnly() throws Exception {
        JSONArray photos = new JSONArray();
        ScanLedger.upsert(photos, scanned("u14", "job", new JSONArray().put(product("a", "", FailReason.PARTIAL))));
        ScanLedger.upsert(photos, scanned("u15", "job", new JSONArray().put(product("b", "", FailReason.PARTIAL)).put(product("c", "", FailReason.NO_TEXT))));
        ScanLedger.upsert(photos, scanned("u16", "older-job", new JSONArray().put(product("d", "", FailReason.NO_TEXT))));
        JSONObject reasons = ScanLedger.summarize(photos, "job").getJSONObject("reasons");
        assertEquals(2, reasons.getInt(FailReason.PARTIAL));
        assertEquals(1, reasons.getInt(FailReason.NO_TEXT));
    }

    @Test public void pendingRetriesAreCountedAcrossScans() throws Exception {
        JSONArray photos = new JSONArray();
        JSONObject entry = scanned("u17", "older-job", new JSONArray().put(product("a", "", FailReason.NO_TEXT)));
        ScanLedger.markAutoRetry(entry, false);
        ScanLedger.upsert(photos, entry);
        assertEquals(1, ScanLedger.summarize(photos, "job").getInt("retryPending"));
    }

    @Test public void theNewReportNumbersStillBalance() throws Exception {
        JSONArray photos = new JSONArray();
        ScanLedger.upsert(photos, scanned("u18", "job", new JSONArray().put(product("a", A, "")).put(product("b", "", FailReason.PARTIAL))));
        JSONObject s = ScanLedger.summarize(photos, "job");
        assertEquals(s.getInt("photos"), s.getInt("scanned") + s.getInt("failed") + s.getInt("duplicatePhotos"));
        assertEquals(s.getInt("products"), s.getInt("saved") + s.getInt("duplicateImeis") + s.getInt("emptyRepeats"));
    }

    // ---- pairing: which earlier unreadable record does a new reading replace? ----------------------------------------------

    static List<ScanLedger.Old> olds(String... idAndImei) {
        List<ScanLedger.Old> list = new ArrayList<>();
        for (int i = 0; i < idAndImei.length; i += 2) list.add(new ScanLedger.Old(idAndImei[i], idAndImei[i + 1]));
        return list;
    }

    static ScanLedger.Split split(JSONArray rows, Map<String, String> seen, List<String> empties, List<ScanLedger.Old> photoRecords) throws Exception {
        return ScanLedger.split(rows, seen, empties, photoRecords, row -> { });
    }

    @Test public void oneUnreadableRecordAndOneNewReadingArePaired() throws Exception {
        JSONArray rows = new JSONArray().put(product("new1", A, ""));
        ScanLedger.Split result = split(rows, new HashMap<>(), Arrays.asList("old1"), olds("old1", ""));
        assertEquals(1, result.unique.length());
        assertEquals("the new record names the one it replaces", "old1", result.unique.getJSONObject(0).getString("replaces"));
        assertEquals("old1", result.supersedes.getString(0));
    }

    @Test public void anUnresolvedLabelKeepsItsOwnEarlierRecordWhileTheOtherIsReplaced() throws Exception {
        // the photo had two unreadable labels; this time label 1 stays unreadable and label 2 is read
        JSONArray rows = new JSONArray().put(product("n1", "", FailReason.NO_TEXT)).put(product("n2", B, ""));
        ScanLedger.Split result = split(rows, new HashMap<>(), Arrays.asList("e1", "e2"), olds("e1", "", "e2", ""));
        assertEquals("the unresolved label is not added again", 1, result.unique.length());
        assertEquals("e2", result.unique.getJSONObject(0).getString("replaces"));
        assertEquals("the unresolved label points at ITS earlier record, not just the first one", "e1", result.emptyRepeats.getJSONObject(0).getString("of"));
    }

    @Test public void labelsAlreadyReadAreNotTouchedWhenTheRestAreRecovered() throws Exception {
        // earlier: label 1 read (A), labels 2 and 3 unreadable. Now all three are read.
        Map<String, String> seen = new HashMap<>();
        seen.put(A, "rec-A");
        JSONArray rows = new JSONArray().put(product("n1", A, "")).put(product("n2", B, "")).put(product("n3", C, ""));
        ScanLedger.Split result = split(rows, seen, Arrays.asList("e2", "e3"), olds("rec-A", A, "e2", "", "e3", ""));
        assertEquals("the already-read label is a duplicate of its record", 1, result.duplicates.length());
        assertEquals(2, result.unique.length());
        assertEquals("e2", result.unique.getJSONObject(0).getString("replaces"));
        assertEquals("e3", result.unique.getJSONObject(1).getString("replaces"));
    }

    @Test public void whenTheCountsDoNotMatchNothingIsPairedAndNothingIsLost() throws Exception {
        // one unreadable record before, two labels now: ambiguous
        JSONArray rows = new JSONArray().put(product("n1", A, "")).put(product("n2", B, ""));
        ScanLedger.Split result = split(rows, new HashMap<>(), Arrays.asList("e1"), olds("e1", ""));
        assertEquals(2, result.unique.length());
        assertFalse(result.unique.getJSONObject(0).has("replaces"));
        assertFalse(result.unique.getJSONObject(1).has("replaces"));
    }

    @Test public void anEarlierReadLabelThatWasNotReadAgainStopsThePairing() throws Exception {
        // earlier: A read, e1 unreadable. Now only one new number (B) and no A: which label is B? unknown.
        JSONArray rows = new JSONArray().put(product("n1", B, ""));
        ScanLedger.Split result = split(rows, new HashMap<>(), Arrays.asList("e1"), olds("rec-A", A, "e1", ""));
        assertFalse(result.unique.getJSONObject(0).has("replaces"));
        assertNull(ScanLedger.pairWithOld(rows, olds("rec-A", A, "e1", "")));
    }

    @Test public void noEarlierRecordsMeansNoPairing() throws Exception {
        JSONArray rows = new JSONArray().put(product("n1", A, ""));
        assertNull(ScanLedger.pairWithOld(rows, new ArrayList<>()));
        assertNull(ScanLedger.pairWithOld(rows, null));
        ScanLedger.Split result = ScanLedger.split(rows, new HashMap<>(), new ArrayList<String>(), row -> { });
        assertFalse(result.unique.getJSONObject(0).has("replaces"));
    }

    @Test public void anEarlierImei2OnlyRecordIsReplacedByTheRecoveredImei1() throws Exception {
        // the first scan could read only IMEI 2 (kept as a stand-in, flagged); the retry recovered IMEI 1 from the barcode
        JSONArray rows = new JSONArray().put(product("n1", A, ""));
        ScanLedger.Split result = split(rows, new HashMap<>(), new ArrayList<String>(), Arrays.asList(new ScanLedger.Old("old1", B, true)));
        assertEquals(1, result.unique.length());
        assertEquals("the stand-in record is the one replaced", "old1", result.unique.getJSONObject(0).getString("replaces"));
    }

    @Test public void anEarlierRecordWithARealImei1IsNeverTreatedAsReplaceable() throws Exception {
        JSONArray rows = new JSONArray().put(product("n1", B, ""));
        // earlier record holds an IMEI 1 (not a stand-in) and the new reading is a different number: ambiguous, nothing is paired
        assertNull(ScanLedger.pairWithOld(rows, Arrays.asList(new ScanLedger.Old("old1", A, false))));
    }

    @Test public void waitingPhotosNeverReplaceAScanThatIsQueuedOrRunning() {
        assertFalse("a photo shared right after the last scan started its own job: the waiting photos must not overwrite it", ScanLedger.mayPromotePending("queued"));
        assertFalse(ScanLedger.mayPromotePending("processing"));
        assertTrue(ScanLedger.mayPromotePending("completed"));
        assertTrue(ScanLedger.mayPromotePending("idle"));
        assertTrue(ScanLedger.mayPromotePending(""));
    }

    @Test public void theOldFourArgumentSplitKeepsItsBehaviour() throws Exception {
        JSONArray rows = new JSONArray().put(product("n1", "", FailReason.NO_TEXT));
        ScanLedger.Split result = ScanLedger.split(rows, new HashMap<>(), Arrays.asList("e1"), row -> { });
        assertEquals(0, result.unique.length());
        assertEquals("e1", result.emptyRepeats.getJSONObject(0).getString("of"));
        assertNotNull(result.supersedes);
    }
}
