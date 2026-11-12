package com.imeilens.scanner;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Holds the current scan job in memory and writes it to disk in batches, instead of
 * rewriting the whole file after every photo (which got slow for 500-photo scans).
 */
final class ScanStore {
    private static final long FLUSH_MS = 2000;
    private static final int FLUSH_EVERY = 8;

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

    static synchronized String status(Context context) { return load(context).optString("status"); }

    static synchronized boolean isStopped(Context context) { return "stopped".equals(status(context)); }

    static JSONObject empty() {
        JSONObject job = new JSONObject();
        try {
            job.put("id", ""); job.put("status", "idle"); job.put("count", 0);
            job.put("completed", 0); job.put("failed", 0);
            job.put("records", new JSONArray()); job.put("queue", new JSONArray());
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
        if (force || pending >= FLUSH_EVERY || System.currentTimeMillis() - lastWrite >= FLUSH_MS) write(context, cache);
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

    static synchronized void update(Context context, int completed, int failed, JSONArray additions) {
        JSONObject job = load(context);
        // A scan that was reset has no job id: late results from it must not come back.
        if ("stopped".equals(job.optString("status")) || job.optString("id").isEmpty()) return;
        JSONArray records = job.optJSONArray("records");
        if (records == null) records = new JSONArray();
        for (int index = 0; index < additions.length(); index++) records.put(additions.optJSONObject(index));
        try {
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
