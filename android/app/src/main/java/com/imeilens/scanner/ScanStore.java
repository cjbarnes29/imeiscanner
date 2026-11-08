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

final class ScanStore {
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

    static synchronized JSONObject read(Context context) {
        File file = new File(root(context), "current.json");
        if (!file.exists()) return empty();
        try (FileInputStream input = new FileInputStream(file)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int length;
            while ((length = input.read(chunk)) != -1) bytes.write(chunk, 0, length);
            return new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new IllegalStateException("Cannot read saved scan", error);
        }
    }

    static JSONObject empty() {
        JSONObject job = new JSONObject();
        try {
            job.put("id", ""); job.put("status", "idle"); job.put("count", 0);
            job.put("completed", 0); job.put("failed", 0);
            job.put("records", new JSONArray()); job.put("queue", new JSONArray());
        } catch (Exception error) { throw new IllegalStateException(error); }
        return job;
    }

    static synchronized void write(Context context, JSONObject job) {
        File file = new File(root(context), "current.json");
        File temp = new File(root(context), "current-" + UUID.randomUUID() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temp)) {
            output.write(job.toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        } catch (Exception error) { throw new IllegalStateException("Cannot save scan", error); }
        if (!temp.renameTo(file)) {
            // Android's app-private storage uses one filesystem; remove the old file before retrying.
            if (!file.delete() || !temp.renameTo(file)) throw new IllegalStateException("Cannot replace saved scan");
        }
    }

    static synchronized boolean start(Context context, JSONArray queue, String personId) {
        JSONObject job = read(context);
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
            write(context, job);
            return true;
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    static synchronized void update(Context context, int completed, int failed, JSONArray additions) {
        JSONObject job = read(context);
        if ("stopped".equals(job.optString("status"))) return;
        JSONArray records = job.optJSONArray("records");
        if (records == null) records = new JSONArray();
        for (int index = 0; index < additions.length(); index++) records.put(additions.optJSONObject(index));
        try {
            job.put("records", records);
            job.put("completed", completed);
            job.put("failed", failed);
            job.put("status", "processing");
            write(context, job);
        } catch (Exception error) { throw new IllegalStateException(error); }
    }

    static synchronized void finish(Context context, String status, String error) {
        JSONObject job = read(context);
        if ("stopped".equals(job.optString("status"))) return;
        try { job.put("status", status); job.put("error", error); write(context, job); }
        catch (Exception failure) { throw new IllegalStateException(failure); }
    }

    static synchronized void stop(Context context) {
        JSONObject job = read(context);
        try { job.put("status", "stopped"); write(context, job); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
}
