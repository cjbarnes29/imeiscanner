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
        int missing = 0, orphans = 0;
        for (int index = 0; index < products.length(); index++) {
            String imei = products.getJSONObject(index).optString("imei");
            if (imei.isEmpty()) missing++; else imeis.put(imei);
            orphans = Math.max(orphans, products.getJSONObject(index).optInt("orphanBarcodes"));
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
            .put("orphanBarcodes", orphans).put("needsRescan", missing > 0 || orphans > 0);
        if (retake != null) entry.put("retake", true).put("retakeKind", retake.optString("labelIssue")).put("retakeSide", retake.optString("labelIssueSide"))
            .put("retakeMissing", retake.optInt("labelsMissing", 1)).put("retakeDigits", retake.optInt("labelIssueDigits"));
        return entry;
    }

    static JSONObject failed(String uri, String name, String hash, String jobId, String at, String reason) throws JSONException {
        return base(uri, name, hash, jobId, at, FAILED).put("reason", reason == null ? "" : reason).put("needsRescan", true);
    }

    static JSONObject duplicatePhoto(String uri, String name, String hash, String jobId, String at, String firstUri) throws JSONException {
        return base(uri, name, hash, jobId, at, DUPLICATE_PHOTO).put("duplicateOfUri", firstUri).put("needsRescan", false);
    }

    private static JSONObject base(String uri, String name, String hash, String jobId, String at, String outcome) throws JSONException {
        return new JSONObject().put("uri", uri).put("name", name).put("hash", hash == null ? "" : hash).put("jobId", jobId).put("at", at)
            .put("outcome", outcome).put("products", 0).put("saved", 0).put("savedIds", new JSONArray()).put("imeis", new JSONArray())
            .put("missingImei", 0).put("duplicates", new JSONArray()).put("emptyRepeats", new JSONArray()).put("supersedes", new JSONArray())
            .put("review", 0).put("reason", "").put("needsRescan", false);
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
        Split result = new Split();
        int nextEmpty = 0;
        boolean readAnImei = false;
        for (int index = 0; index < rows.length(); index++) {
            JSONObject row = rows.optJSONObject(index);
            if (row == null) continue;
            String imei = row.optString("imei");
            if (imei.matches("[0-9]{15}")) {
                String existing = seenImeis.putIfAbsent(imei, row.optString("id"));
                if (existing != null) {
                    result.duplicates.put(new JSONObject().put("imei", imei).put("of", existing));
                    dropped.accept(row);
                    continue;
                }
                readAnImei = true;
            } else if (imei.isEmpty() && nextEmpty < emptyOfPhoto.size()) {
                result.emptyRepeats.put(new JSONObject().put("of", emptyOfPhoto.get(nextEmpty++)));
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
        for (int index = 0; index < photos.length(); index++) {
            JSONObject entry = photos.optJSONObject(index);
            if (entry == null) continue;
            if (entry.optBoolean("needsRescan")) needRescanAll++;
            if (!jobId.equals(entry.optString("jobId"))) continue;
            photosInJob++;
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
            .put("needRescanInJob", needRescanInJob).put("needRescan", needRescanAll).put("retake", retake);
    }

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
