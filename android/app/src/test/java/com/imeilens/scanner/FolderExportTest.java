package com.imeilens.scanner;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.Test;

/** Folder exports: interruption, restart, duplicate names, storage errors, no-rename storage, bulk, and that earlier exports are never damaged. */
public class FolderExportTest {

    /** Thrown by the fake storage to simulate Android ending the app in the middle of a copy (nothing after it runs). */
    static final class Killed extends Error { Killed() { super("app process ended"); } }

    /** An in-memory document provider with failure switches. */
    static final class FakeDocs implements FolderExport.Docs {
        static final class Doc { String id, parent, name; boolean dir; byte[] data = new byte[0]; }
        final Map<String, Doc> docs = new LinkedHashMap<>();
        int nextId = 1;
        boolean renameSupported = true, deleteLies = false;
        String failWriteOf = null;   // storage error (disk full) while writing this name
        String killDuringWriteOf = null; // the app is ended while writing this name
        String killAfterDeleteOf = null; // ended between removing the old file and renaming the new one
        boolean shortWrites = false; // the provider silently keeps only half of every file

        String root() { Doc d = new Doc(); d.id = "root"; d.dir = true; d.name = "Download"; docs.put(d.id, d); return d.id; }
        String add(String parent, String name, boolean dir, byte[] data) {
            Doc d = new Doc(); d.id = "d" + (nextId++); d.parent = parent; d.name = name; d.dir = dir; if (data != null) d.data = data; docs.put(d.id, d); return d.id;
        }
        Doc byName(String parent, String name) { for (Doc d : docs.values()) if (parent.equals(d.parent) && name.equals(d.name)) return d; return null; }
        List<String> names(String parent) { List<String> out = new ArrayList<>(); for (Doc d : docs.values()) if (parent.equals(d.parent)) out.add(d.name); return out; }

        @Override public String find(String parentId, String name) { Doc d = byName(parentId, name); return d == null ? null : d.id; }
        @Override public List<String[]> children(String parentId) { List<String[]> out = new ArrayList<>(); for (Doc d : docs.values()) if (parentId.equals(d.parent)) out.add(new String[]{d.id, d.name}); return out; }
        @Override public String createDir(String parentId, String name) { return add(parentId, name, true, null); }
        @Override public String createFile(String parentId, String mime, String name) {
            String unique = name; int n = 1;
            while (byName(parentId, unique) != null) unique = name + " (" + (n++) + ")"; // like real providers: never two files with one name
            return add(parentId, unique, false, null);
        }
        @Override public OutputStream openWrite(String id) {
            Doc d = docs.get(id);
            d.data = new byte[0]; // "wt": truncate
            return new ByteArrayOutputStream() {
                @Override public synchronized void write(byte[] b, int off, int len) {
                    String name = d.name.endsWith(FolderExport.PARTIAL) ? d.name.substring(0, d.name.length() - FolderExport.PARTIAL.length()) : d.name;
                    if (name.equals(failWriteOf) && count + len > 100) throw new RuntimeException(new IOException("No space left on device"));
                    super.write(b, off, len);
                    d.data = shortWrites ? java.util.Arrays.copyOf(toByteArray(), size() / 2) : toByteArray();
                    if (name.equals(killDuringWriteOf) && count > 100) throw new Killed();
                }
            };
        }
        @Override public long readBack(String id) { Doc d = docs.get(id); return d == null ? -1 : d.data.length; }
        @Override public boolean canRename(String id) { return renameSupported; }
        @Override public String rename(String id, String newName) { Doc d = docs.get(id); d.name = newName; return id; }
        @Override public boolean delete(String id) {
            if (deleteLies) return true;
            Doc d = docs.remove(id);
            if (d != null) { List<String> kids = new ArrayList<>(); for (Doc k : docs.values()) if (id.equals(k.parent)) kids.add(k.id); for (String k : kids) docs.remove(k); }
            if (d != null && killAfterDeleteOf != null && killAfterDeleteOf.equals(d.name)) throw new Killed();
            return d != null;
        }
        @Override public boolean exists(String id) { return docs.containsKey(id); }
    }

    static final class MapStore implements ExportCommit.Store {
        final Map<String, String> map = new HashMap<>();
        @Override public String get(String key) { return map.get(key); }
        @Override public void put(String key, String value) { map.put(key, value); }
        @Override public void remove(String key) { map.remove(key); }
    }

    /** Staged export files like the page prepares them: a workbook, numbered pictures, numbers.txt. Content depends on "version". */
    static File stage(int pictures, String version) throws IOException {
        File dir = Files.createTempDirectory("imei-folder-").toFile();
        dir.deleteOnExit();
        write(new File(dir, "IMEI Lens.xlsx"), ("workbook " + version + " ").repeat(400));
        for (int i = 1; i <= pictures; i++) write(new File(dir, String.format("%03d-photo.jpg", i)), ("picture " + i + " " + version + " ").repeat(300));
        write(new File(dir, "numbers.txt"), "numbers " + version + " ".repeat(200));
        return dir;
    }
    static void write(File file, String text) throws IOException { try (FileOutputStream out = new FileOutputStream(file)) { out.write(text.getBytes("UTF-8")); } }
    static byte[] bytes(File file) throws IOException { return Files.readAllBytes(file.toPath()); }

    static FolderExport.Job job(String mode, File staged, String root, String sub, boolean clean) {
        FolderExport.Job job = new FolderExport.Job();
        job.mode = mode; job.staged = staged.getAbsolutePath(); job.rootId = root; job.sub = sub; job.clean = clean; job.where = "Download";
        return job;
    }

    /** Every staged file is in the folder with exactly the same bytes. */
    static void assertComplete(FakeDocs docs, String folder, File staged) throws IOException {
        for (File file : FolderExport.stagedFiles(staged)) {
            FakeDocs.Doc d = docs.byName(folder, file.getName());
            assertNotNull(file.getName() + " missing", d);
            assertArrayEquals(file.getName() + " differs", bytes(file), d.data);
        }
        for (String name : docs.names(folder)) assertFalse("no temporary file left: " + name, name.endsWith(FolderExport.PARTIAL));
    }

    // ---- new folder (chosen with the folder picker) ----------------------------------------------------------------------------------

    @Test public void pickerExportCopiesEveryFileVerified() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        File staged = stage(5, "v1"); File copy = stage(5, "v1");
        FolderExport.Result r = FolderExport.run(docs, store, job(FolderExport.MODE_PICKER, staged, root, "IMEI Lens 2026-11-13", false), new Date());
        assertTrue(r.problem, r.ok);
        assertEquals(7, r.copied);
        assertComplete(docs, docs.byName(root, "IMEI Lens 2026-11-13").id, copy);
        assertNull("journal cleared", store.get(FolderExport.KEY));
        assertFalse("staged copy removed", staged.exists());
    }

    @Test public void bulkExportOf300PicturesIsComplete() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        File staged = stage(300, "v1"); File copy = stage(300, "v1");
        FolderExport.Result r = FolderExport.run(docs, store, job(FolderExport.MODE_PICKER, staged, root, "Bulk", false), new Date());
        assertTrue(r.problem, r.ok);
        assertEquals(302, r.copied);
        assertComplete(docs, docs.byName(root, "Bulk").id, copy);
    }

    @Test public void storageErrorInANewFolderRemovesTheHalfFolder() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        docs.failWriteOf = "003-photo.jpg";
        FolderExport.Result r = FolderExport.run(docs, store, job(FolderExport.MODE_PICKER, stage(5, "v1"), root, "Half", false), new Date());
        assertFalse(r.ok);
        assertTrue(r.problem, r.problem.contains("No space"));
        assertNull("no half-filled folder is left", docs.byName(root, "Half"));
        assertNull(store.get(FolderExport.KEY));
    }

    @Test public void appKilledDuringTheCopyIsFinishedOnTheNextStart() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        File staged = stage(6, "v1"); File copy = stage(6, "v1");
        FolderExport.Job job = job(FolderExport.MODE_PICKER, staged, root, "Killed", false);
        FolderExport.save(store, job);
        docs.killDuringWriteOf = "004-photo.jpg";
        try { FolderExport.run(docs, store, job, new Date()); fail("the fake should have ended the app"); } catch (Killed expected) { }
        // the app starts again: a new process reads the journal
        FolderExport.Job again = FolderExport.load(store);
        assertNotNull("the job survived the restart", again);
        assertEquals("files before the interruption are recorded as done", 3, again.done.size()); // 001..003 (sorted: digits first)
        docs.killDuringWriteOf = null;
        FolderExport.Result r = FolderExport.run(docs, store, again, new Date());
        assertTrue(r.problem, r.ok);
        assertTrue(r.resumed);
        assertComplete(docs, docs.byName(root, "Killed").id, copy);
        assertEquals("nothing duplicated", 8, docs.names(docs.byName(root, "Killed").id).size());
    }

    @Test public void restartAfterThePhoneClearedTheStagedFilesSaysSoAndLeavesNoHalfFolder() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        File staged = stage(4, "v1");
        FolderExport.Job job = job(FolderExport.MODE_PICKER, staged, root, "Gone", false);
        docs.killDuringWriteOf = "002-photo.jpg";
        try { FolderExport.run(docs, store, job, new Date()); fail(); } catch (Killed expected) { }
        FolderExport.deleteFolder(staged); // cache cleared by the system
        docs.killDuringWriteOf = null;
        FolderExport.Result r = FolderExport.run(docs, store, FolderExport.load(store), new Date());
        assertFalse(r.ok);
        assertTrue(r.problem, r.problem.contains("export again"));
        assertNull(docs.byName(root, "Gone"));
        assertNull(store.get(FolderExport.KEY));
    }

    @Test public void shortWritesAreNeverReportedAsSaved() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        docs.shortWrites = true;
        FolderExport.Result r = FolderExport.run(docs, store, job(FolderExport.MODE_PICKER, stage(2, "v1"), root, "Short", false), new Date());
        assertFalse(r.ok);
        assertTrue(r.problem, r.problem.contains("not saved completely"));
    }

    // ---- the remembered folder (same names every time) -------------------------------------------------------------------------------

    /** The remembered folder after an earlier export (version v0, 5 pictures). */
    static String earlierExport(FakeDocs docs, String root) throws IOException {
        String sub = docs.createDir(root, "IMEI Lens");
        for (File file : FolderExport.stagedFiles(stage(5, "v0"))) docs.add(sub, file.getName(), false, bytes(file));
        return sub;
    }

    @Test public void duplicateNamesAreReplacedOnlyAfterTheNewFileIsComplete() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        String sub = earlierExport(docs, root);
        File staged = stage(5, "v1"); File copy = stage(5, "v1");
        FolderExport.Result r = FolderExport.run(docs, store, job(FolderExport.MODE_SAVED, staged, root, "IMEI Lens", false), new Date());
        assertTrue(r.problem, r.ok);
        assertFalse(r.dated);
        assertComplete(docs, sub, copy);
        assertEquals("one file per name, no '(1)' copies", 7, docs.names(sub).size());
    }

    @Test public void storageErrorWhileReplacingLeavesTheEarlierExportUnchanged() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        String sub = earlierExport(docs, root);
        File before = stage(5, "v0");
        docs.failWriteOf = "IMEI Lens.xlsx"; // written after the five pictures: those are already written when the error comes
        FolderExport.Result r = FolderExport.run(docs, store, job(FolderExport.MODE_SAVED, stage(5, "v1"), root, "IMEI Lens", true), new Date());
        assertFalse(r.ok);
        assertComplete(docs, sub, before); // every earlier file byte for byte, numbered pictures and numbers.txt included
        assertNotNull("the user's folder is never removed", docs.byName(root, "IMEI Lens"));
    }

    @Test public void killedBetweenRemovingTheOldAndRenamingTheNewIsRepairedOnRestart() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        String sub = earlierExport(docs, root);
        File staged = stage(5, "v1"); File copy = stage(5, "v1");
        docs.killAfterDeleteOf = "002-photo.jpg";
        try { FolderExport.run(docs, store, job(FolderExport.MODE_SAVED, staged, root, "IMEI Lens", false), new Date()); fail(); } catch (Killed expected) { }
        docs.killAfterDeleteOf = null;
        FolderExport.Result r = FolderExport.run(docs, store, FolderExport.load(store), new Date());
        assertTrue(r.problem, r.ok);
        assertComplete(docs, sub, copy);
        assertEquals(7, docs.names(sub).size());
    }

    @Test public void killedWhileWritingTheNewFilesLeavesTheEarlierExportIntactThenFinishes() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        String sub = earlierExport(docs, root);
        File before = stage(5, "v0");
        File staged = stage(5, "v1"); File copy = stage(5, "v1");
        docs.killDuringWriteOf = "004-photo.jpg";
        try { FolderExport.run(docs, store, job(FolderExport.MODE_SAVED, staged, root, "IMEI Lens", false), new Date()); fail(); } catch (Killed expected) { }
        // between the interruption and the restart, the earlier export is complete and unchanged (only temporary files were added)
        for (File file : FolderExport.stagedFiles(before)) assertArrayEquals(bytes(file), docs.byName(sub, file.getName()).data);
        docs.killDuringWriteOf = null;
        FolderExport.Result r = FolderExport.run(docs, store, FolderExport.load(store), new Date());
        assertTrue(r.problem, r.ok);
        assertComplete(docs, sub, copy);
        assertEquals(7, docs.names(sub).size());
    }

    @Test public void storageThatCannotRenameGetsANewDatedFolderAndTheOldExportStays() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        String sub = earlierExport(docs, root);
        File before = stage(5, "v0");
        docs.renameSupported = false;
        File staged = stage(5, "v1"); File copy = stage(5, "v1");
        FolderExport.Result r = FolderExport.run(docs, store, job(FolderExport.MODE_SAVED, staged, root, "IMEI Lens", true), new Date(0));
        assertTrue(r.problem, r.ok);
        assertTrue(r.dated);
        assertComplete(docs, sub, before);
        FakeDocs.Doc dated = null;
        for (FakeDocs.Doc d : docs.docs.values()) if (d.dir && d.name.startsWith("IMEI Lens 19")) dated = d;
        assertNotNull("a dated folder next to the old one", dated);
        assertComplete(docs, dated.id, copy);
    }

    @Test public void deleteThatReportsSuccessWithoutDeletingKeepsTheOldFile() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        String sub = earlierExport(docs, root);
        File before = stage(5, "v0");
        docs.deleteLies = true;
        FolderExport.Result r = FolderExport.run(docs, store, job(FolderExport.MODE_SAVED, stage(5, "v1"), root, "IMEI Lens", false), new Date());
        assertFalse(r.ok);
        assertTrue(r.problem, r.problem.contains("left as it was"));
        FakeDocs.Doc workbook = docs.byName(sub, "IMEI Lens.xlsx");
        assertArrayEquals(bytes(new File(before, "IMEI Lens.xlsx")), workbook.data);
    }

    @Test public void cleanRemovesOnlyStaleReportFilesAndOnlyAfterSuccess() throws Exception {
        FakeDocs docs = new FakeDocs(); String root = docs.root(); MapStore store = new MapStore();
        String sub = earlierExport(docs, root); // 5 pictures
        docs.add(sub, "my notes.docx", false, "user file".getBytes("UTF-8"));
        File staged = stage(3, "v1"); File copy = stage(3, "v1"); // the new report has 3 pictures
        FolderExport.Result r = FolderExport.run(docs, store, job(FolderExport.MODE_SAVED, staged, root, "IMEI Lens", true), new Date());
        assertTrue(r.problem, r.ok);
        assertComplete(docs, sub, copy);
        assertNull("stale picture 004 removed", docs.byName(sub, "004-photo.jpg"));
        assertNull("stale picture 005 removed", docs.byName(sub, "005-photo.jpg"));
        assertNotNull("a file that is not part of a report is never touched", docs.byName(sub, "my notes.docx"));
    }

    @Test public void journalRoundTrip() {
        FolderExport.Job job = new FolderExport.Job();
        job.mode = FolderExport.MODE_SAVED; job.staged = "/cache/imei-folder-1"; job.rootId = "primary:Download"; job.sub = "IMEI Lens";
        job.parentId = "primary:Download/IMEI Lens"; job.where = "Download"; job.clean = true; job.createdByUs = false; job.dated = false; job.awaitingPicker = true;
        job.done.add("IMEI Lens.xlsx"); job.done.add("001-a b.jpg");
        FolderExport.Job back = FolderExport.Job.decode(job.encode());
        assertEquals(job.encode(), back.encode());
        assertNull(FolderExport.Job.decode("garbage"));
        assertNull(FolderExport.Job.decode(null));
    }
}
