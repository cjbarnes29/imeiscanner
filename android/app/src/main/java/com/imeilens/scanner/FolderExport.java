package com.imeilens.scanner;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Safe copying of a folder export (Excel with pictures, numbers.txt) into a folder the user chose.
 *
 * Rules (each one is unit-tested in FolderExportTest):
 *  - Every file is read back after writing and its byte count compared; a short file is an error, never a success.
 *  - An existing file of an earlier export is never truncated in place: the new file is written under a temporary name, verified, and only then
 *    the old one is removed and the new one renamed (the platform's AtomicFile idea). When the storage cannot rename, the export goes into a NEW
 *    dated folder instead, so the earlier export stays as it was.
 *  - Files of an earlier report that the new one no longer has are removed only after the whole new report is written and verified.
 *  - The job is journaled (Store) after every file, so a copy interrupted by the app being closed is finished on the next start.
 *  - A failed copy into a folder this export created is removed again (and the removal is checked); a failed copy into the user's existing folder
 *    leaves every earlier file unchanged.
 *
 * Pure Java (no android.*) so it runs in JVM tests; MainActivity provides the Storage Access Framework implementation of Docs.
 */
final class FolderExport {
    private FolderExport() { }

    /** The storage operations needed, in document ids. */
    interface Docs {
        String find(String parentId, String name) throws Exception;
        List<String[]> children(String parentId) throws Exception; // {id, display name}
        String createDir(String parentId, String name) throws Exception;
        String createFile(String parentId, String mime, String name) throws Exception;
        OutputStream openWrite(String id) throws Exception;
        /** Bytes actually readable, or -1 when the document cannot be opened. */
        long readBack(String id);
        boolean canRename(String id);
        /** Renames and returns the (possibly new) document id. */
        String rename(String id, String newName) throws Exception;
        /** Best effort; the caller checks exists() afterwards (some providers report success without deleting). */
        boolean delete(String id);
        boolean exists(String id);
    }

    static final String PARTIAL = ".partial";
    static final String MODE_PICKER = "picker", MODE_SAVED = "saved";

    /** One export job. Serialised to a single string for the journal (names contain no '|' or newline: the staging step replaces them). */
    static final class Job {
        String mode = MODE_SAVED, staged = "", tree = "", rootId = "", sub = "", parentId = "", where = "";
        boolean clean, createdByUs, dated, awaitingPicker;
        final Set<String> done = new LinkedHashSet<>();

        String encode() {
            return "v1\n" + mode + "\n" + staged + "\n" + rootId + "\n" + sub + "\n" + parentId + "\n" + where + "\n"
                + clean + "\n" + createdByUs + "\n" + dated + "\n" + awaitingPicker + "\n" + String.join("|", done) + "\n" + tree;
        }

        static Job decode(String text) {
            if (text == null) return null;
            String[] p = text.split("\n", -1);
            if (p.length < 13 || !p[0].equals("v1")) return null;
            Job job = new Job();
            job.mode = p[1]; job.staged = p[2]; job.rootId = p[3]; job.sub = p[4]; job.parentId = p[5]; job.where = p[6];
            job.clean = Boolean.parseBoolean(p[7]); job.createdByUs = Boolean.parseBoolean(p[8]); job.dated = Boolean.parseBoolean(p[9]);
            job.awaitingPicker = Boolean.parseBoolean(p[10]);
            if (!p[11].isEmpty()) job.done.addAll(Arrays.asList(p[11].split("\\|")));
            job.tree = p[12];
            return job;
        }
    }

    static final String KEY = "folder-export-job";

    static void save(ExportCommit.Store store, Job job) { store.put(KEY, job.encode()); }
    static Job load(ExportCommit.Store store) { return Job.decode(store.get(KEY)); }
    static void clear(ExportCommit.Store store) { store.remove(KEY); }

    /** What happened, for the message to the user. */
    static final class Result {
        boolean ok;
        int copied, total;
        String where = "", problem = "", folderName = "";
        boolean dated, resumed;
    }

    /** An earlier report's own files (numbered pictures and numbers.txt): the only files "clean" may remove, and only at the end. */
    static boolean oldReportFile(String name) {
        return name != null && (name.equals("numbers.txt") || name.matches("^\\d{3,4}-.+\\.(jpg|jpeg|png|webp)$"));
    }

    static String mimeFor(String name) {
        String lower = name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    static File[] stagedFiles(File staged) {
        File[] files = staged.listFiles(File::isFile);
        if (files == null) return new File[0];
        Arrays.sort(files);
        return files;
    }

    /**
     * Runs (or resumes) a job. The journal is updated after every finished file and cleared at the end (success or a final failure).
     * @param now used for the dated folder name
     */
    static Result run(Docs docs, ExportCommit.Store store, Job job, Date now) {
        Result result = new Result();
        result.resumed = !job.done.isEmpty() || !job.parentId.isEmpty();
        File staged = new File(job.staged);
        File[] files = stagedFiles(staged);
        result.total = files.length;
        String tempId = null;
        try {
            if (!staged.isDirectory() || files.length == 0) throw new IOException("The prepared files are gone (the phone cleared its temporary storage). Please export again.");
            if (job.parentId.isEmpty()) {
                resolveTarget(docs, job, files, now);
                save(store, job);
            }
            if (job.createdByUs) {
                // Our own new folder: write each file directly and verify it (a file already there is from this export's interrupted attempt).
                for (File file : files) {
                    String name = file.getName();
                    if (job.done.contains(name)) { result.copied++; continue; }
                    String id = docs.find(job.parentId, name);
                    if (id == null) id = docs.createFile(job.parentId, mimeFor(name), name);
                    if (id == null) throw new IOException("Cannot create " + name + ".");
                    writeVerified(docs, id, file);
                    job.done.add(name);
                    save(store, job);
                    result.copied++;
                }
            } else {
                // The user's existing folder holds an earlier export. Phase 1: every new file is written under a temporary name and verified;
                // nothing of the earlier export is touched. A failure here removes the temporary files: the folder is exactly as before.
                // Phase 2 (only when ALL new files are verified): each earlier file is replaced by its new one. An interruption in phase 2 is
                // finished on the next start from the journal ("T:" = verified temporary file, "S:" = swapped into place).
                removeUnverifiedTemps(docs, job);
                for (File file : files) {
                    String name = file.getName();
                    if (job.done.contains("T:" + name) || job.done.contains("S:" + name)) continue;
                    String id = docs.find(job.parentId, name + PARTIAL);
                    if (id == null) id = docs.createFile(job.parentId, "application/octet-stream", name + PARTIAL);
                    if (id == null) throw new IOException("Cannot create a temporary file for " + name + ".");
                    tempId = id;
                    writeVerified(docs, id, file);
                    tempId = null;
                    job.done.add("T:" + name);
                    save(store, job);
                }
                for (File file : files) {
                    String name = file.getName();
                    if (job.done.contains("S:" + name)) { result.copied++; continue; }
                    String temp = docs.find(job.parentId, name + PARTIAL);
                    String existing = docs.find(job.parentId, name);
                    if (temp == null) {
                        if (existing != null && docs.readBack(existing) == file.length()) { job.done.add("S:" + name); save(store, job); result.copied++; continue; } // swapped just before an interruption
                        throw new IOException("The new " + name + " is missing; nothing more was changed.");
                    }
                    if (docs.readBack(temp) != file.length()) throw new IOException("The new " + name + " is incomplete; nothing more was changed.");
                    if (existing != null) {
                        docs.delete(existing);
                        if (docs.exists(existing)) throw new IOException("The earlier " + name + " could not be replaced; it was left as it was.");
                    }
                    String renamed = docs.rename(temp, name);
                    if (renamed == null || docs.find(job.parentId, name) == null) throw new IOException("The new " + name + " was saved but could not get its name; look for " + name + PARTIAL + ".");
                    job.done.add("S:" + name);
                    save(store, job);
                    result.copied++;
                }
            }
            if (job.clean) removeStaleReportFiles(docs, job.parentId, files);
            result.ok = true;
        } catch (Exception error) {
            result.problem = error.getMessage() == null ? "Could not save to the folder." : error.getMessage();
            if (tempId != null) docs.delete(tempId);
            // Still in phase 1 (nothing swapped yet): remove every temporary file so the earlier export is exactly as it was.
            if (!job.createdByUs && !job.parentId.isEmpty() && !anySwapped(job)) removeAllTemps(docs, job.parentId);
            if (job.createdByUs && MODE_PICKER.equals(job.mode) && !job.parentId.isEmpty()) {
                // A half-filled new folder is worse than none: remove what this export created, and check it is gone.
                removeFolder(docs, job.parentId);
                if (docs.exists(job.parentId)) result.problem += " (The incomplete folder could not be removed: please delete it.)";
                result.copied = 0;
            }
        }
        result.where = job.where + (job.sub.isEmpty() ? "" : "/" + job.sub);
        result.folderName = job.sub;
        result.dated = job.dated;
        clear(store);
        deleteFolder(staged);
        return result;
    }

    private static void resolveTarget(Docs docs, Job job, File[] files, Date now) throws Exception {
        if (MODE_PICKER.equals(job.mode)) {
            String created = docs.createDir(job.rootId, job.sub);
            if (created == null) throw new IOException("Cannot create the folder " + job.sub + ".");
            job.parentId = created; job.createdByUs = true;
            return;
        }
        String parent = job.rootId;
        if (!job.sub.isEmpty()) {
            String existing = docs.find(job.rootId, job.sub);
            if (existing == null) {
                String created = docs.createDir(job.rootId, job.sub);
                if (created == null) throw new IOException("Cannot create the folder " + job.sub + ".");
                job.parentId = created; job.createdByUs = true;
                return;
            }
            parent = existing;
        }
        // Would this export replace or remove anything? Then the storage must be able to rename, or the export goes into a new dated folder.
        String sample = null;
        for (File file : files) { String id = docs.find(parent, file.getName()); if (id != null) { sample = id; break; } }
        if (sample == null && job.clean) for (String[] child : docs.children(parent)) if (oldReportFile(child[1])) { sample = child[0]; break; }
        if (sample != null && !docs.canRename(sample)) {
            String datedName = (job.sub.isEmpty() ? "IMEI Lens export" : job.sub) + " " + new SimpleDateFormat("yyyy-MM-dd HH-mm-ss", Locale.ROOT).format(now);
            String created = docs.createDir(job.rootId, datedName);
            if (created == null) throw new IOException("Cannot create the folder " + datedName + ".");
            job.parentId = created; job.createdByUs = true; job.dated = true; job.sub = datedName;
            return;
        }
        job.parentId = parent;
    }

    private static void writeVerified(Docs docs, String id, File file) throws Exception {
        long size = file.length();
        long copied = 0;
        try (InputStream input = new FileInputStream(file); OutputStream output = docs.openWrite(id)) {
            if (output == null) throw new IOException("Cannot open " + file.getName() + ".");
            byte[] chunk = new byte[16384]; int count;
            while ((count = input.read(chunk)) != -1) { output.write(chunk, 0, count); copied += count; }
            output.flush();
        }
        if (copied != size) throw new IOException("Only " + copied + " of " + size + " bytes of " + file.getName() + " were written.");
        long back = docs.readBack(id);
        if (back >= 0 && back != size) throw new IOException(file.getName() + " was not saved completely (" + back + " of " + size + " bytes).");
    }

    /** Temporary files of an interrupted attempt that were not verified (a verified one, "T:" in the journal, is kept for phase 2). */
    private static void removeUnverifiedTemps(Docs docs, Job job) throws Exception {
        for (String[] child : docs.children(job.parentId)) {
            if (child[1] == null || !child[1].endsWith(PARTIAL)) continue;
            String name = child[1].substring(0, child[1].length() - PARTIAL.length());
            if (!job.done.contains("T:" + name)) docs.delete(child[0]);
        }
    }

    private static void removeAllTemps(Docs docs, String parentId) {
        try { for (String[] child : docs.children(parentId)) if (child[1] != null && child[1].endsWith(PARTIAL)) docs.delete(child[0]); }
        catch (Exception ignored) { /* best effort; the next export removes leftovers too */ }
    }

    private static boolean anySwapped(Job job) {
        for (String entry : job.done) if (entry.startsWith("S:")) return true;
        return false;
    }

    private static void removeStaleReportFiles(Docs docs, String parentId, File[] files) throws Exception {
        Set<String> fresh = new LinkedHashSet<>();
        for (File file : files) fresh.add(file.getName());
        for (String[] child : docs.children(parentId)) if (oldReportFile(child[1]) && !fresh.contains(child[1])) docs.delete(child[0]);
    }

    private static void removeFolder(Docs docs, String folderId) {
        try { for (String[] child : docs.children(folderId)) docs.delete(child[0]); } catch (Exception ignored) { /* the folder delete below decides */ }
        docs.delete(folderId);
    }

    static void deleteFolder(File folder) {
        if (folder == null) return;
        File[] files = folder.listFiles();
        if (files != null) for (File file : files) file.delete();
        folder.delete();
    }
}
