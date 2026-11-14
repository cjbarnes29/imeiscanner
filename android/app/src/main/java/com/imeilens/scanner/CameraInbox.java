package com.imeilens.scanner;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Where photos taken with the phone's own camera app live inside this app.
 *
 * The camera app writes the full-size photo straight into {@code camera-waiting/} (a private folder: never the gallery).
 * A photo that is scanned right away is moved to {@code camera-photos/}; photos collected for a later scan stay in
 * {@code camera-waiting/} until "Scan now" moves them too, or the user discards them. Nothing outside these two folders
 * is ever touched, and only files this class named (camera-*.jpg) are ever deleted, so the user's gallery and records are safe.
 * Scanned photos are kept (the records and Crop Studio refer to them as the source photo).
 */
final class CameraInbox {
    static final String WAITING = "camera-waiting";
    static final String PHOTOS = "camera-photos";
    private static final String PREFIX = "camera-", SUFFIX = ".jpg";

    private CameraInbox() {}

    static File waitingDir(File root) { return folder(root, WAITING); }
    static File photosDir(File root) { return folder(root, PHOTOS); }

    private static File folder(File root, String name) {
        File dir = new File(root, name);
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) throw new IllegalStateException("Cannot create " + name);
        return dir;
    }

    /** A fresh, empty target the camera app should write to. */
    static File newShot(File root) { return new File(waitingDir(root), PREFIX + UUID.randomUUID() + SUFFIX); }

    /** Only files this class created: camera-<something>.jpg directly inside the folder. */
    static boolean isOurs(File file) {
        String name = file.getName();
        return name.startsWith(PREFIX) && name.endsWith(SUFFIX) && !name.contains("/") && !name.contains("\\") && !name.contains("..");
    }

    /** True when the camera app really wrote a photo (a cancelled camera leaves nothing or an empty file). */
    static boolean hasPhoto(File shot) { return shot != null && shot.isFile() && shot.length() > 0; }

    /** An empty or missing target is removed (cancelled camera). Returns true when a real photo remains. */
    static boolean settle(File shot) {
        if (shot == null || !isOurs(shot)) return false;
        if (hasPhoto(shot)) return true;
        if (shot.isFile()) shot.delete();
        return false;
    }

    /** Moves one waiting photo to the scanned folder; returns its new place, or null when it is not a real photo of ours. */
    static File accept(File root, File shot) {
        if (!hasPhoto(shot) || !isOurs(shot)) return null;
        File target = new File(photosDir(root), shot.getName());
        if (target.exists()) target = new File(photosDir(root), PREFIX + UUID.randomUUID() + SUFFIX);
        if (shot.renameTo(target)) return target;
        return null; // never copy-and-delete: the original stays where it is if it cannot be moved
    }

    /** Photos taken but not scanned yet, oldest first. */
    static List<File> waiting(File root) {
        List<File> result = new ArrayList<>();
        File[] items = waitingDir(root).listFiles();
        if (items == null) return result;
        for (File item : items) if (isOurs(item) && hasPhoto(item)) result.add(item);
        result.sort((a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        return result;
    }

    /** Moves every waiting photo to the scanned folder; returns the new files (ready to queue). */
    static List<File> acceptAllWaiting(File root, int max) {
        List<File> accepted = new ArrayList<>();
        for (File file : waiting(root)) {
            if (accepted.size() >= max) break;
            File moved = accept(root, file);
            if (moved != null) accepted.add(moved);
        }
        return accepted;
    }

    /** Deletes only the photos that were never scanned. Returns how many were removed. */
    static int discardWaiting(File root) {
        int removed = 0;
        File[] items = waitingDir(root).listFiles();
        if (items == null) return 0;
        for (File item : items) if (isOurs(item) && item.isFile() && item.delete()) removed++;
        return removed;
    }
}
