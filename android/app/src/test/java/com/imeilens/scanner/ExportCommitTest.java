package com.imeilens.scanner;

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
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

/** Interrupted saves and incomplete exports must never leave an empty or partial file unannounced. */
public class ExportCommitTest {
    private static final class MapStore implements ExportCommit.Store {
        final Map<String, String> map = new HashMap<>();
        @Override public String get(String key) { return map.get(key); }
        @Override public void put(String key, String value) { map.put(key, value); }
        @Override public void remove(String key) { map.remove(key); }
    }

    private static File staged(byte[] content) throws IOException {
        File file = File.createTempFile("imei-export-", ".bin");
        file.deleteOnExit();
        try (FileOutputStream out = new FileOutputStream(file)) { out.write(content); }
        return file;
    }

    @Test public void emptyExportIsRefusedBeforeTheDialog() throws Exception {
        MapStore store = new MapStore();
        try { ExportCommit.begin(store, staged(new byte[0]), "a.csv"); fail("0-byte export must be refused"); }
        catch (IOException expected) { assertTrue(store.map.isEmpty()); }
    }

    @Test public void normalSaveCopiesEveryByte() throws Exception {
        byte[] data = new byte[100_000];
        for (int i = 0; i < data.length; i++) data[i] = (byte) i;
        MapStore store = new MapStore();
        ExportCommit.Pending pending = ExportCommit.begin(store, staged(data), "a.csv");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        assertEquals(data.length, ExportCommit.copyVerified(pending, out));
        assertEquals(data.length, out.size());
        assertEquals(ExportCommit.Outcome.SAVED, ExportCommit.decide(true, false, pending, true));
        assertEquals("saved", ExportCommit.status(ExportCommit.Outcome.SAVED));
        assertFalse(ExportCommit.mustRemoveTarget(ExportCommit.Outcome.SAVED));
    }

    @Test public void processKilledDuringDialogIsRecoveredFromTheJournal() throws Exception {
        // Scenario G: the staged file survives on disk, the in-memory record does not.
        MapStore store = new MapStore();
        File file = staged("IMEI,Model\n350000000000000,Test\n".getBytes("UTF-8"));
        ExportCommit.begin(store, file, "phones.csv");
        ExportCommit.Pending recovered = ExportCommit.recover(store); // new process, same journal
        assertNotNull(recovered);
        assertEquals("phones.csv", recovered.name);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ExportCommit.copyVerified(recovered, out);
        assertEquals(file.length(), out.size());
        assertEquals(ExportCommit.Outcome.SAVED, ExportCommit.decide(true, false, recovered, true));
    }

    @Test public void lostStagedFileIsInterruptedAndTheEmptyTargetMustBeRemoved() throws Exception {
        MapStore store = new MapStore();
        File file = staged("abc".getBytes("UTF-8"));
        ExportCommit.begin(store, file, "phones.csv");
        assertTrue(file.delete()); // cache cleared by the system
        assertNull(ExportCommit.recover(store));
        ExportCommit.Outcome outcome = ExportCommit.decide(true, false, null, false);
        assertEquals(ExportCommit.Outcome.INTERRUPTED, outcome);
        assertTrue("the 0-byte document the system created must be deleted", ExportCommit.mustRemoveTarget(outcome));
        assertEquals("interrupted", ExportCommit.status(outcome));
    }

    @Test public void stagedFileThatChangedSizeIsNotTrusted() throws Exception {
        MapStore store = new MapStore();
        File file = staged("abcdef".getBytes("UTF-8"));
        ExportCommit.begin(store, file, "a.csv");
        try (FileOutputStream out = new FileOutputStream(file)) { out.write("ab".getBytes("UTF-8")); } // truncated
        assertNull(ExportCommit.recover(store));
    }

    @Test public void cancelLeavesNothingToRemove() throws Exception {
        ExportCommit.Outcome outcome = ExportCommit.decide(false, true, null, false);
        assertEquals(ExportCommit.Outcome.CANCELLED, outcome);
        assertFalse(ExportCommit.mustRemoveTarget(outcome));
        assertEquals("cancelled", ExportCommit.status(outcome));
    }

    @Test public void writeFailureRemovesThePartialFile() throws Exception {
        MapStore store = new MapStore();
        ExportCommit.Pending pending = ExportCommit.begin(store, staged(new byte[50_000]), "a.csv");
        OutputStream failing = new OutputStream() {
            int total;
            @Override public void write(int b) throws IOException { throw new IOException("disk full"); }
            @Override public void write(byte[] b, int off, int len) throws IOException {
                total += len; if (total > 10_000) throw new IOException("disk full");
            }
        };
        try { ExportCommit.copyVerified(pending, failing); fail("must report the failure"); }
        catch (IOException expected) { assertEquals("disk full", expected.getMessage()); }
        ExportCommit.Outcome outcome = ExportCommit.decide(true, false, pending, false);
        assertEquals(ExportCommit.Outcome.FAILED, outcome);
        assertTrue(ExportCommit.mustRemoveTarget(outcome));
    }

    @Test public void shortCopyIsDetected() throws Exception {
        MapStore store = new MapStore();
        File file = staged(new byte[1000]);
        ExportCommit.Pending real = ExportCommit.begin(store, file, "a.csv");
        ExportCommit.Pending claimsMore = new ExportCommit.Pending(real.file, real.name, 2000);
        try { ExportCommit.copyVerified(claimsMore, new ByteArrayOutputStream()); fail("size mismatch must fail"); }
        catch (IOException expected) { assertTrue(expected.getMessage().contains("1000 of 2000")); }
    }

    @Test public void destinationSizeCheck() {
        assertTrue(ExportCommit.sizeMatches(500, 500));
        assertTrue("an unknown size is accepted", ExportCommit.sizeMatches(-1, 500));
        assertFalse("0 bytes on disk after a successful-looking copy is a failure", ExportCommit.sizeMatches(0, 500));
        assertFalse(ExportCommit.sizeMatches(499, 500));
    }

    @Test public void clearForgetsThePendingSaveAndExposesItsPathForCacheCleaning() throws Exception {
        MapStore store = new MapStore();
        File file = staged("abc".getBytes("UTF-8"));
        ExportCommit.begin(store, file, "a.csv");
        assertEquals(file.getAbsolutePath(), ExportCommit.journaledPath(store));
        ExportCommit.clear(store);
        assertNull(ExportCommit.journaledPath(store));
        assertNull(ExportCommit.recover(store));
    }

    @Test public void failedResultWithoutDestinationIsFailedNotSaved() {
        assertEquals(ExportCommit.Outcome.FAILED, ExportCommit.decide(false, false, null, false));
    }
}
