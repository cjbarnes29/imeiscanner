package com.imeilens.scanner;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Safe completion of a single-file export (CSV, one workbook).
 *
 * The system creates the empty target file the moment the user taps Save, and only then does the app copy
 * the staged file into it. If Android ends the app process while the Save dialog is open, the in-memory
 * record of the staged file is gone and the empty target would stay behind without any message. This class
 * keeps a small journal (name, size, path) outside memory, copies the staged file with a size check, and
 * tells the caller exactly what happened so an incomplete file is never left unannounced.
 *
 * Pure Java (no Android classes) so the rules are unit-tested on the JVM.
 */
final class ExportCommit {
    private ExportCommit() { }

    /** Tiny key/value persistence (SharedPreferences in the app, a map in tests). */
    interface Store {
        String get(String key);
        void put(String key, String value);
        void remove(String key);
    }

    /** A staged export waiting for the user's chosen destination. */
    static final class Pending {
        final File file;
        final String name;
        final long size;
        Pending(File file, String name, long size) { this.file = file; this.name = name; this.size = size; }
    }

    /** What the caller must do after the destination answered. */
    enum Outcome {
        SAVED,        // complete file written and verified
        CANCELLED,    // user cancelled; nothing was created
        INTERRUPTED,  // the staged copy was lost (process ended): remove the empty target, ask the user to retry
        FAILED        // writing failed or the written size is wrong: remove the target
    }

    private static final String PATH = "export-pending-path";
    private static final String NAME = "export-pending-name";
    private static final String SIZE = "export-pending-size";

    /** Record a staged export before the Save dialog opens. A zero-byte export is refused up front. */
    static Pending begin(Store store, File file, String name) throws IOException {
        long size = file.length();
        if (size <= 0) throw new IOException("Nothing to save");
        store.put(PATH, file.getAbsolutePath());
        store.put(NAME, name);
        store.put(SIZE, Long.toString(size));
        return new Pending(file, name, size);
    }

    /** The export that was waiting when the app was last stopped, or null when there is none (or its file is gone/changed). */
    static Pending recover(Store store) {
        String path = store.get(PATH), name = store.get(NAME), size = store.get(SIZE);
        if (path == null || name == null || size == null) return null;
        try {
            File file = new File(path);
            long expected = Long.parseLong(size);
            if (!file.isFile() || expected <= 0 || file.length() != expected) return null;
            return new Pending(file, name, expected);
        } catch (NumberFormatException error) { return null; }
    }

    /** Path of the journaled file, so cache cleaning never removes a save that is still pending. */
    static String journaledPath(Store store) { return store.get(PATH); }

    static void clear(Store store) {
        store.remove(PATH); store.remove(NAME); store.remove(SIZE);
    }

    /** Copy the whole staged file and confirm every byte arrived. Returns the byte count; throws when anything is short. */
    static long copyVerified(Pending pending, OutputStream output) throws IOException {
        long copied = 0;
        try (InputStream input = new FileInputStream(pending.file)) {
            byte[] chunk = new byte[8192]; int count;
            while ((count = input.read(chunk)) != -1) { output.write(chunk, 0, count); copied += count; }
        }
        output.flush();
        if (copied != pending.size) throw new IOException("Copied " + copied + " of " + pending.size + " bytes");
        return copied;
    }

    /**
     * Decide the result once the destination answered.
     * @param resultOk       the system dialog returned OK with a destination
     * @param cancelled      the user cancelled the dialog
     * @param pending        the staged export, or null when it could not be found (app restarted without it)
     * @param writeSucceeded the copy finished and was verified (only meaningful when pending != null)
     */
    static Outcome decide(boolean resultOk, boolean cancelled, Pending pending, boolean writeSucceeded) {
        if (cancelled) return Outcome.CANCELLED;
        if (!resultOk) return Outcome.FAILED;
        if (pending == null) return Outcome.INTERRUPTED;
        return writeSucceeded ? Outcome.SAVED : Outcome.FAILED;
    }

    /** True when the target must be removed so no empty or partial file stays on the phone. */
    static boolean mustRemoveTarget(Outcome outcome) {
        return outcome == Outcome.INTERRUPTED || outcome == Outcome.FAILED;
    }

    /** Status string sent to the page. */
    static String status(Outcome outcome) {
        switch (outcome) {
            case SAVED: return "saved";
            case CANCELLED: return "cancelled";
            case INTERRUPTED: return "interrupted";
            default: return "failed";
        }
    }

    /** Whether the size reported by the destination proves a complete file (unknown size is accepted). */
    static boolean sizeMatches(long reportedSize, long expected) {
        return reportedSize < 0 || reportedSize == expected;
    }
}
