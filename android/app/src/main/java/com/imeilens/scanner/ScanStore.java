package com.imeilens.scanner;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.UUID;

/**
 * Holds the current scan job in memory and writes it to disk in batches, instead of
 * rewriting the whole file after every photo (which got slow for 500-photo scans).
 */
final class ScanStore {
    /** Most photos one scan batch can hold. */
    static final int MAX_PHOTOS = 1000;

    private static JSONObject cache;
    private static boolean dirty;
    private static long lastWrite;
    private static int pending;
    private static String snapshot;

    private ScanStore() {}

    static File root(Context context) {
        File folder = new File(context.getFilesDir(), "native-scans");
        if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("Cannot create scan folder");
        return folder;
    }

    static File image(Context context, String id) {
        if (!id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid picture ID");
        File folder = new File(root(context), "images");
        if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("Cannot create image folder");
        return new File(folder, id + ".jpg");
    }

    private static JSONObject load(Context context) {
        if (cache != null) return cache;
        File file = new File(root(context), "current.json");
        if (!file.exists()) { cache = empty(); return cache; }
        try (FileInputStream input = new FileInputStream(file)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int length;
            while ((length = input.read(chunk)) != -1) bytes.write(chunk, 0, length);
            cache = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            return cache;
        } catch (Exception error) {
            throw new IllegalStateException("Cannot read saved scan", error);
        }
    }

    /** A private copy of the job, safe to read while a scan is running. */
    static synchronized JSONObject read(Context context) {
        try { return new JSONObject(load(context).toString()); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }

    /** The job as JSON text for the web page. */
    static synchronized String json(Context context) {
        if (snapshot == null) snapshot = load(context).toString();
        return snapshot;
    }

    /**
     * The job for the web page, with only the records from index "from" (at most 200) and without the photo queue.
     * With 1000 records the full job is several megabytes; this keeps each call small.
     */
    static synchronized String jsonFrom(Context context, int from) {
        JSONObject job = load(context);
        JSONArray records = job.optJSONArray("records");
        int total = records == null ? 0 : records.length();
        int start = Math.max(0, Math.min(from, total));
        try {
            JSONObject out = new JSONObject();
            for (Iterator<String> keys = job.keys(); keys.hasNext(); ) {
                String key = keys.next();
                if (!"records".equals(key) && !"queue".equals(key) && !"pending".equals(key) && !"photos".equals(key)) out.put(key, job.get(key));
            }
            JSONArray slice = new JSONArray();
            for (int index = start; index < total && index < start + 200; index++) slice.put(records.get(index));
            out.put("records", slice);
            out.put("recordsFrom", start);
            out.put("recordsTotal", total);
            // The scan report: counts for the current scan (the per-photo list is fetched separately, see reportJson).
            out.put("report", ScanLedger.summarize(photosOf(job), job.optString("id")));
            return out.toString();
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    /** The scan report ledger of a job; jobs saved by older versions have none. */
    private static JSONArray photosOf(JSONObject job) {
        JSONArray photos = job.optJSONArray("photos");
        return photos == null ? new JSONArray() : photos;
    }

    /** The scan report for the web page: the summary of the current scan and one entry per source photo. */
    static synchronized String reportJson(Context context) {
        JSONObject job = load(context);
        try {
            JSONArray photos = photosOf(job);
            return new JSONObject().put("jobId", job.optString("id")).put("report", ScanLedger.summarize(photos, job.optString("id"))).put("photos", photos).toString();
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    /**
     * This photo's earlier records that have no IMEI and still have their picture: a new scan of the same photo must not add another
     * empty copy next to them. Reads the saved job in place (no copy), so it is cheap to call once per photo.
     */
    static synchronized java.util.List<String> emptyRecordsOfPhoto(Context context, String uri, String hash) {
        JSONObject job = load(context);
        JSONArray records = job.optJSONArray("records");
        return ScanLedger.emptyRecordsOfPhoto(records == null ? new JSONArray() : records, photosOf(job), uri == null ? "" : uri, hash,
            id -> { try { return image(context, id).isFile(); } catch (RuntimeException error) { return false; } });
    }

    /** The photos that failed or show a product without an IMEI, as a queue to scan them again. */
    static synchronized JSONArray rescanQueue(Context context) {
        try { return ScanLedger.rescanQueue(photosOf(load(context))); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }

    static synchronized String status(Context context) { return load(context).optString("status"); }

    static synchronized boolean isStopped(Context context) { return "stopped".equals(status(context)); }

    static JSONObject empty() {
        JSONObject job = new JSONObject();
        try {
            job.put("id", ""); job.put("status", "idle"); job.put("count", 0);
            job.put("completed", 0); job.put("failed", 0);
            job.put("records", new JSONArray()); job.put("queue", new JSONArray()); job.put("photos", new JSONArray());
        } catch (Exception error) { throw new IllegalStateException(error); }
        return job;
    }

    private static void write(Context context, JSONObject job) {
        File file = new File(root(context), "current.json");
        File temp = new File(root(context), "current-" + UUID.randomUUID() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temp)) {
            output.write(job.toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        } catch (Exception error) { temp.delete(); throw new IllegalStateException("Cannot save scan", error); }
        if (!temp.renameTo(file)) {
            // Android's app-private storage uses one filesystem; remove the old file before retrying.
            if (!file.delete() || !temp.renameTo(file)) throw new IllegalStateException("Cannot replace saved scan");
        }
        dirty = false; pending = 0; lastWrite = System.currentTimeMillis();
    }

    /** Write to disk now. Called when a scan ends, pauses or is stopped. */
    static synchronized void flush(Context context) {
        if (dirty) write(context, load(context));
    }

    private static void save(Context context, boolean force) {
        dirty = true; snapshot = null;
        // Big scans write less often: the saved file grows with every record.
        JSONArray records = cache.optJSONArray("records");
        int count = records == null ? 0 : records.length();
        long flushMs = count > 300 ? 6000 : count > 100 ? 3500 : 2000;
        int flushEvery = count > 300 ? 40 : count > 100 ? 16 : 8;
        if (force || pending >= flushEvery || System.currentTimeMillis() - lastWrite >= flushMs) write(context, cache);
    }

    static synchronized boolean start(Context context, JSONArray queue, String personId) {
        JSONObject job = load(context);
        String status = job.optString("status");
        if ("queued".equals(status) || "processing".equals(status)) return false;
        try {
            job.put("id", UUID.randomUUID().toString());
            job.put("status", "queued");
            job.put("count", queue.length());
            job.put("completed", 0);
            job.put("failed", 0);
            job.put("queue", queue);
            job.put("personId", personId);
            job.put("error", "");
            save(context, true);
            return true;
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    /** A scan is already running: keep these photos and scan them as soon as it finishes. */
    static synchronized void addPending(Context context, JSONArray queue, String personId) {
        JSONObject job = load(context);
        try {
            JSONArray pending = job.optJSONArray("pending");
            if (pending == null) pending = new JSONArray();
            for (int index = 0; index < queue.length(); index++) pending.put(queue.get(index));
            job.put("pending", pending);
            job.put("pendingPerson", personId);
            save(context, true);
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    /** Start the photos that were shared during the last scan. True when a new scan was started. */
    static synchronized boolean promotePending(Context context) {
        JSONObject job = load(context);
        JSONArray pending = job.optJSONArray("pending");
        if (pending == null || pending.length() == 0 || job.optString("id").isEmpty()) return false;
        String person = job.optString("pendingPerson", "person-1");
        try {
            job.remove("pending"); job.remove("pendingPerson");
            String status = job.optString("status");
            if ("queued".equals(status) || "processing".equals(status)) job.put("status", "completed");
        } catch (Exception error) { throw new IllegalStateException(error); }
        return start(context, pending, person);
    }

    static synchronized void update(Context context, int completed, int failed, JSONArray additions) { update(context, completed, failed, additions, null); }

    /** Also writes the source photo's entry in the scan report, in the same save as its records. */
    static synchronized void update(Context context, int completed, int failed, JSONArray additions, JSONObject photo) {
        JSONObject job = load(context);
        // A scan that was reset has no job id: late results from it must not come back.
        if ("stopped".equals(job.optString("status")) || job.optString("id").isEmpty()) return;
        JSONArray records = job.optJSONArray("records");
        if (records == null) records = new JSONArray();
        for (int index = 0; index < additions.length(); index++) records.put(additions.optJSONObject(index));
        try {
            if (photo != null) {
                JSONArray photos = photosOf(job);
                ScanLedger.upsert(photos, photo);
                job.put("photos", photos);
            }
            job.put("records", records);
            job.put("completed", completed);
            job.put("failed", failed);
            job.put("status", "processing");
            pending++;
            save(context, false);
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    static synchronized void finish(Context context, String status, String error) {
        JSONObject job = load(context);
        if ("stopped".equals(job.optString("status")) || job.optString("id").isEmpty()) { flush(context); return; }
        try { job.put("status", status); job.put("error", error); save(context, true); }
        catch (Exception failure) { throw new IllegalStateException(failure); }
    }

    /** Delete the saved scan job and every cropped photo kept for it. */
    static synchronized void clear(Context context) {
        File[] images = new File(root(context), "images").listFiles();
        if (images != null) for (File image : images) image.delete();
        File[] shared = new File(root(context), "shared").listFiles();
        if (shared != null) for (File item : shared) item.delete();
        cache = empty(); snapshot = null;
        write(context, cache);
    }

    static synchronized void stop(Context context) {
        JSONObject job = load(context);
        try { job.put("status", "stopped"); save(context, true); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
}
