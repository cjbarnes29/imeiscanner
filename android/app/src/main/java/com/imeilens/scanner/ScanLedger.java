package com.imeilens.scanner;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.Predicate;

/**
 * The scan report: one entry per source PHOTO (keyed by its uri), kept apart from the product RECORDS that were read from it.
 * A photo can hold several products (labels), so the two are counted separately.
 *
 * For every photo in a scan exactly one outcome is written, so nothing a user selected can disappear without a trace:
 *   scanned          products were read; "saved" went to the records, "duplicates" were dropped because that IMEI already
 *                    has a record (each one names the record it duplicates, the existing record is never touched);
 *                    "emptyRepeats" are products without an IMEI that this photo already has a record for from an earlier
 *                    scan: no second empty copy is added (that record, with its picture, is the evidence and stays)
 *   failed           the photo could not be read (reason kept); it stays eligible for a new scan
 *   duplicate-photo  the same picture (same file content) was selected twice in one scan; linked to the first copy
 * A photo that failed, or shows a product without a readable IMEI, is flagged needsRescan.
 * Pure org.json code, so it is unit-tested on a normal JVM.
 */
final class ScanLedger {
    static final String SCANNED = "scanned", FAILED = "failed", DUPLICATE_PHOTO = "duplicate-photo";
    /** How many earlier attempts are kept per photo. */
    static final int HISTORY = 5;

    private ScanLedger() {}

    /**
     * @param products     every product (label) read from the photo, before anything is dropped
     * @param saved        the products that became records
     * @param duplicates   one {imei, of} per product dropped because its IMEI already had a record ("of" = that record's id)
     * @param emptyRepeats one {of} per product without an IMEI that the photo already had an empty record for ("of" = that record's id)
     * @param supersedes   when IMEIs were read this time: the earlier empty records of this photo (kept; only mentioned)
     */
    static JSONObject scanned(String uri, String name, String hash, String jobId, String at,
                              JSONArray products, JSONArray saved, JSONArray duplicates,
                              JSONArray emptyRepeats, JSONArray supersedes) throws JSONException {
        JSONObject entry = base(uri, name, hash, jobId, at, SCANNED);
        JSONArray imeis = new JSONArray();
        int missing = 0, orphans = 0, imei2Only = 0;
        // Why each product has no IMEI 1 (words only, see FailReason) and whether another read could still help (not for a label cut by the edge).
        JSONObject reasons = new JSONObject();
        boolean worthRetry = false;
        for (int index = 0; index < products.length(); index++) {
            JSONObject product = products.getJSONObject(index);
            String imei = product.optString("imei");
            boolean fallback = product.optBoolean("imeiFallback");
            if (imei.isEmpty()) missing++; else imeis.put(imei);
            if (fallback) imei2Only++;
            if (imei.isEmpty() || fallback) {
                String kind = product.optString("failReason");
                if (kind.isEmpty() && fallback) kind = FailReason.IMEI2_ONLY;
                if (!kind.isEmpty()) reasons.put(kind, reasons.optInt(kind) + 1);
                if (!FailReason.unfixableByRetry(kind)) worthRetry = true;
            }
            orphans = Math.max(orphans, product.optInt("orphanBarcodes"));
        }
        int review = 0;
        JSONObject retake = null; // the photo is missing a label and the scanner can say why (LabelIssue): "retake this photo"
        JSONArray ids = new JSONArray();
        for (int index = 0; index < saved.length(); index++) {
            JSONObject row = saved.getJSONObject(index);
            if (retake == null && !row.optString("labelIssue").isEmpty()) retake = row;
            ids.put(row.optString("id"));
            if ("Review".equals(row.optString("status")) || row.optBoolean("cropNeedsReview") || row.optBoolean("imeiFallback")) review++;
        }
        entry.put("products", products.length()).put("saved", saved.length()).put("savedIds", ids)
            .put("imeis", imeis).put("missingImei", missing).put("duplicates", duplicates)
            .put("emptyRepeats", emptyRepeats).put("supersedes", supersedes).put("review", review)
            .put("orphanBarcodes", orphans).put("needsRescan", missing > 0 || orphans > 0)
            .put("reasons", reasons).put("imei2Only", imei2Only).put("retryWorthy", worthRetry);
        if (retake != null) entry.put("retake", true).put("retakeKind", retake.optString("labelIssue")).put("retakeSide", retake.optString("labelIssueSide"))
            .put("retakeMissing", retake.optInt("labelsMissing", 1)).put("retakeDigits", retake.optInt("labelIssueDigits"));
        return entry;
    }

    static JSONObject failed(String uri, String name, String hash, String jobId, String at, String reason) throws JSONException {
        // A photo that could not be read at all may succeed on a second try (a busy phone, memory): it is worth one automatic retry.
        return base(uri, name, hash, jobId, at, FAILED).put("reason", reason == null ? "" : reason).put("needsRescan", true).put("retryWorthy", true);
    }

    /**
     * The automatic retry's bookkeeping on a photo's report entry. A photo that is worth another read starts as "pending"; the retry
     * job marks what it processed "done" (and "retryJob", so the report can count it). "done" is never reset (see upsert), so a photo
     * gets at most ONE automatic retry, however often it is scanned again, and a retry job never causes another retry.
     */
    static void markAutoRetry(JSONObject entry, boolean retryJob) throws JSONException {
        if (DUPLICATE_PHOTO.equals(entry.optString("outcome"))) return;
        if (retryJob) { entry.put("autoRetry", "done").put("retryJob", true); return; }
        if (entry.optBoolean("retryWorthy")) entry.put("autoRetry", "pending");
    }

    /** The photos waiting for their one automatic retry, as a scan queue ({uri, name}). */
    static JSONArray autoRetryQueue(JSONArray photos) throws JSONException {
        JSONArray queue = new JSONArray();
        for (int index = 0; index < photos.length(); index++) {
            JSONObject entry = photos.optJSONObject(index);
            if (entry != null && "pending".equals(entry.optString("autoRetry")) && !entry.optString("uri").isEmpty())
                queue.put(new JSONObject().put("uri", entry.optString("uri")).put("name", entry.optString("name")));
        }
        return queue;
    }

    static JSONObject duplicatePhoto(String uri, String name, String hash, String jobId, String at, String firstUri) throws JSONException {
        return base(uri, name, hash, jobId, at, DUPLICATE_PHOTO).put("duplicateOfUri", firstUri).put("needsRescan", false);
    }

    private static JSONObject base(String uri, String name, String hash, String jobId, String at, String outcome) throws JSONException {
        return new JSONObject().put("uri", uri).put("name", name).put("hash", hash == null ? "" : hash).put("jobId", jobId).put("at", at)
            .put("outcome", outcome).put("products", 0).put("saved", 0).put("savedIds", new JSONArray()).put("imeis", new JSONArray())
            .put("missingImei", 0).put("duplicates", new JSONArray()).put("emptyRepeats", new JSONArray()).put("supersedes", new JSONArray())
            .put("review", 0).put("reason", "").put("needsRescan", false)
            .put("reasons", new JSONObject()).put("imei2Only", 0).put("retryWorthy", false).put("recovered", 0);
    }

    /** What the products read from one photo turned into. */
    static final class Split {
        /** Products to save as new records. */
        final JSONArray unique = new JSONArray();
        /** Products dropped because their IMEI already has a record: {imei, of: that record's id}. */
        final JSONArray duplicates = new JSONArray();
        /** Products without an IMEI that this photo already has an empty record for: {of: that record's id}. */
        final JSONArray emptyRepeats = new JSONArray();
        /** When this scan read IMEIs: the earlier empty records of this photo (kept, only mentioned in the report). */
        final JSONArray supersedes = new JSONArray();
    }

    /**
     * Decides, for each product of one photo, whether it becomes a new record. Nothing existing is changed or removed.
     * @param seenImeis    IMEI -> id of the record that holds it (updated with the new records)
     * @param emptyOfPhoto ids of this photo's existing records that have no IMEI and still have their picture (from earlier scans)
     * @param dropped      called for every product that is not saved (to delete the picture just made for it)
     */
    static Split split(JSONArray rows, Map<String, String> seenImeis, List<String> emptyOfPhoto, Consumer<JSONObject> dropped) throws JSONException {
        return split(rows, seenImeis, emptyOfPhoto, null, dropped);
    }

    /** One earlier record of the photo: its id, its IMEI ("" when it has none) and whether that IMEI is only IMEI 2 standing in for the unread IMEI 1. */
    static final class Old {
        final String id, imei;
        final boolean fallback;
        Old(String id, String imei) { this(id, imei, false); }
        Old(String id, String imei, boolean fallback) { this.id = id; this.imei = imei == null ? "" : imei; this.fallback = fallback; }
    }

    /**
     * Which earlier empty record each product of this scan stands for, by position, so a retry can say exactly "this new record replaces
     * that unreadable one" (the app archives it) and an unresolved label keeps pointing at its own earlier record.
     * Only when it is certain: every earlier record that already holds an IMEI was read again with that same IMEI (those products are
     * the labels already done), and the remaining products are exactly as many as the remaining empty records. Anything else
     * (a label found or lost, a different number) gives null: nothing is paired and every earlier record stays as it is.
     * @return for each product (same order as rows) the id of the empty record it stands for, "" for a product that stands for none; null = no pairing
     */
    static String[] pairWithOld(JSONArray rows, List<Old> photoRecords) {
        if (photoRecords == null || photoRecords.isEmpty() || rows == null) return null;
        Set<String> settled = new HashSet<>();
        List<String> empties = new ArrayList<>();
        // An earlier record is "settled" when it holds an IMEI 1. One with no IMEI, or only an IMEI 2 standing in for the unread IMEI 1, is what a new reading can replace.
        for (Old old : photoRecords) { if (old.imei.matches("[0-9]{15}") && !old.fallback) settled.add(old.imei); else empties.add(old.id); }
        int settledCount = photoRecords.size() - empties.size();
        String[] pairs = new String[rows.length()];
        List<Integer> rest = new ArrayList<>();
        Set<String> matched = new HashSet<>();
        for (int index = 0; index < rows.length(); index++) {
            pairs[index] = "";
            JSONObject row = rows.optJSONObject(index);
            String imei = row == null ? "" : row.optString("imei");
            if (settled.contains(imei) && matched.add(imei)) continue; // a label that was already read
            rest.add(index);
        }
        if (matched.size() != settledCount || rest.size() != empties.size()) return null;
        for (int k = 0; k < rest.size(); k++) pairs[rest.get(k)] = empties.get(k);
        return pairs;
    }

    /**
     * @param photoRecords this photo's earlier records in the order they were made (see pairWithOld), or null for no pairing. With it, a
     *                     saved product that stands for an earlier empty record carries "replaces": that record's id.
     */
    static Split split(JSONArray rows, Map<String, String> seenImeis, List<String> emptyOfPhoto, List<Old> photoRecords, Consumer<JSONObject> dropped) throws JSONException {
        Split result = new Split();
        int nextEmpty = 0;
        boolean readAnImei = false;
        String[] pairs = pairWithOld(rows, photoRecords);
        for (int index = 0; index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row == null) continue;
            String imei = row.optString("imei");
            String paired = pairs == null ? "" : pairs[index];
            if (imei.matches("[0-9]{15}")) {
                String existing = seenImeis.putIfAbsent(imei, row.optString("id"));
                if (existing != null) {
                    result.duplicates.put(new JSONObject().put("imei", imei).put("of", existing));
                    dropped.accept(row);
                    continue;
                }
                readAnImei = true;
                if (!paired.isEmpty()) row.put("replaces", paired);
            } else if (imei.isEmpty() && nextEmpty < emptyOfPhoto.size()) {
                // An unresolved label: the earlier record it stands for stays (no second empty copy). Named exactly when the pairing is certain.
                String of = paired.isEmpty() ? emptyOfPhoto.get(nextEmpty) : paired;
                nextEmpty++;
                result.emptyRepeats.put(new JSONObject().put("of", of));
                dropped.accept(row);
                continue;
            }
            result.unique.put(row);
        }
        if (readAnImei) for (String id : emptyOfPhoto) result.supersedes.put(id);
        return result;
    }

    /**
     * The records of this photo that have no IMEI and still have their picture. Found by the photo's uri (this also covers records
     * saved before the report existed) and, when the same picture was scanned from another place, by its content hash.
     */
    static List<String> emptyRecordsOfPhoto(JSONArray records, JSONArray photos, String uri, String hash, Predicate<String> hasPicture) {
        Set<String> wanted = new HashSet<>();
        if (hash != null && !hash.isEmpty()) for (int index = 0; index < photos.length(); index++) {
            JSONObject entry = photos.optJSONObject(index);
            if (entry == null || !hash.equals(entry.optString("hash")) || uri.equals(entry.optString("uri"))) continue;
            // After a repeat scan nothing new was saved; the record that was kept is named in emptyRepeats.
            JSONArray ids = entry.optJSONArray("savedIds");
            if (ids != null) for (int i = 0; i < ids.length(); i++) wanted.add(ids.optString(i));
            JSONArray kept = entry.optJSONArray("emptyRepeats");
            if (kept != null) for (int i = 0; i < kept.length(); i++) wanted.add(kept.optJSONObject(i) == null ? "" : kept.optJSONObject(i).optString("of"));
        }
        List<String> found = new ArrayList<>();
        for (int index = 0; index < records.length(); index++) {
            JSONObject row = records.optJSONObject(index);
            if (row == null || !row.optString("imei").isEmpty()) continue;
            String id = row.optString("id");
            boolean samePhoto = !uri.isEmpty() && uri.equals(row.optString("sourceUri"));
            if ((samePhoto || wanted.contains(id)) && hasPicture.test(id)) found.add(id);
        }
        return found;
    }

    /** Adds the entry, or replaces the earlier entry of the same photo (keeping a short history and how many times it was scanned). */
    static void upsert(JSONArray photos, JSONObject entry) throws JSONException {
        String uri = entry.optString("uri");
        int position = -1;
        for (int index = 0; index < photos.length(); index++) {
            JSONObject old = photos.optJSONObject(index);
            if (old != null && uri.equals(old.optString("uri"))) { position = index; break; }
        }
        JSONArray history = new JSONArray();
        int scans = 1;
        if (position >= 0) {
            JSONObject old = photos.getJSONObject(position);
            scans = old.optInt("scans", 1) + 1;
            JSONArray before = old.optJSONArray("history");
            if (before != null) for (int index = 0; index < before.length(); index++) history.put(before.get(index));
            history.put(attempt(old));
            // One automatic retry per photo, ever: "done" survives every later scan of the same photo (a later manual scan stays manual).
            if ("done".equals(old.optString("autoRetry"))) entry.put("autoRetry", "done");
            // What this scan fixed compared with the last one: labels that had no IMEI 1 (or only IMEI 2) and now have one.
            if (SCANNED.equals(entry.optString("outcome")) && SCANNED.equals(old.optString("outcome")))
                entry.put("recovered", Math.max(0, old.optInt("missingImei") + old.optInt("imei2Only") - entry.optInt("missingImei") - entry.optInt("imei2Only")));
        }
        while (history.length() > HISTORY) history.remove(0);
        entry.put("scans", scans).put("history", history);
        if (position >= 0) photos.put(position, entry); else photos.put(entry);
    }

    private static JSONObject attempt(JSONObject entry) throws JSONException {
        return new JSONObject().put("at", entry.optString("at")).put("jobId", entry.optString("jobId")).put("outcome", entry.optString("outcome"))
            .put("products", entry.optInt("products")).put("saved", entry.optInt("saved"))
            .put("imeis", entry.optJSONArray("imeis") == null ? 0 : entry.optJSONArray("imeis").length()).put("missingImei", entry.optInt("missingImei"));
    }

    /**
     * The numbers for one scan (the photos whose latest entry belongs to jobId), plus how many photos overall still need a new scan.
     * Invariants the tests check: products = saved + duplicateImeis + emptyRepeats; photos = scanned + failed + duplicatePhotos.
     */
    static JSONObject summarize(JSONArray photos, String jobId) throws JSONException {
        int photosInJob = 0, scanned = 0, failed = 0, duplicatePhotos = 0, products = 0, saved = 0, imeis = 0, missing = 0, duplicateImeis = 0, emptyRepeats = 0, review = 0, needRescanInJob = 0, needRescanAll = 0, retake = 0;
        int retried = 0, recovered = 0, unresolved = 0, retryPending = 0;
        JSONObject reasons = new JSONObject();
        for (int index = 0; index < photos.length(); index++) {
            JSONObject entry = photos.optJSONObject(index);
            if (entry == null) continue;
            if (entry.optBoolean("needsRescan")) needRescanAll++;
            if ("pending".equals(entry.optString("autoRetry"))) retryPending++;
            if (!jobId.equals(entry.optString("jobId"))) continue;
            photosInJob++;
            JSONObject entryReasons = entry.optJSONObject("reasons");
            if (entryReasons != null) for (java.util.Iterator<String> kinds = entryReasons.keys(); kinds.hasNext(); ) {
                String kind = kinds.next();
                reasons.put(kind, reasons.optInt(kind) + entryReasons.optInt(kind));
            }
            if (entry.optBoolean("retryJob")) {
                retried++;
                recovered += entry.optInt("recovered");
                if (entry.optBoolean("retryWorthy")) unresolved++;
            }
            String outcome = entry.optString("outcome");
            if (SCANNED.equals(outcome)) scanned++; else if (FAILED.equals(outcome)) failed++; else if (DUPLICATE_PHOTO.equals(outcome)) duplicatePhotos++;
            products += entry.optInt("products");
            saved += entry.optInt("saved");
            imeis += entry.optJSONArray("imeis") == null ? 0 : entry.optJSONArray("imeis").length();
            missing += entry.optInt("missingImei");
            duplicateImeis += entry.optJSONArray("duplicates") == null ? 0 : entry.optJSONArray("duplicates").length();
            emptyRepeats += entry.optJSONArray("emptyRepeats") == null ? 0 : entry.optJSONArray("emptyRepeats").length();
            review += entry.optInt("review");
            if (entry.optBoolean("retake")) retake++;
            if (entry.optBoolean("needsRescan")) needRescanInJob++;
        }
        return new JSONObject().put("photos", photosInJob).put("scanned", scanned).put("failed", failed).put("duplicatePhotos", duplicatePhotos)
            .put("products", products).put("saved", saved).put("imeisDetected", imeis).put("missingImei", missing)
            .put("duplicateImeis", duplicateImeis).put("emptyRepeats", emptyRepeats).put("review", review)
            .put("needRescanInJob", needRescanInJob).put("needRescan", needRescanAll).put("retake", retake)
            .put("reasons", reasons).put("retried", retried).put("recovered", recovered).put("unresolved", unresolved).put("retryPending", retryPending);
    }

    /**
     * Photos shared while a scan was running wait in "pending" and start when it ends. When the finishing scan looks at them, another scan may
     * already be queued or running (a photo shared in the instant after the scan ended starts its own job): then they must keep waiting, because
     * starting them now would replace that job's queue and lose its photos. Only a scan that is neither queued nor running lets them start.
     */
    static boolean mayPromotePending(String status) { return !"queued".equals(status) && !"processing".equals(status); }

    /** The photos that failed or show a product without an IMEI, as a scan queue ({uri, name}). */
    static JSONArray rescanQueue(JSONArray photos) throws JSONException {
        JSONArray queue = new JSONArray();
        for (int index = 0; index < photos.length(); index++) {
            JSONObject entry = photos.optJSONObject(index);
            if (entry != null && entry.optBoolean("needsRescan") && !entry.optString("uri").isEmpty())
                queue.put(new JSONObject().put("uri", entry.optString("uri")).put("name", entry.optString("name")));
        }
        return queue;
    }
}
