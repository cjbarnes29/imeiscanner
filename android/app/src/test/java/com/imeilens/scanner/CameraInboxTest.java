package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.file.Files;
import java.util.List;
import org.junit.Before;
import org.junit.Test;

public class CameraInboxTest {
    private File root;

    @Before public void setUp() throws Exception {
        root = Files.createTempDirectory("camera-inbox-test").toFile();
        root.deleteOnExit();
    }

    private static File photo(File file, int bytes) throws Exception {
        Files.write(file.toPath(), new byte[bytes]);
        return file;
    }

    @Test public void newShotLivesInTheWaitingFolderWithAFreshName() {
        File a = CameraInbox.newShot(root), b = CameraInbox.newShot(root);
        assertEquals(CameraInbox.waitingDir(root), a.getParentFile());
        assertTrue(CameraInbox.isOurs(a));
        assertFalse(a.equals(b));
    }

    @Test public void aCancelledCameraLeavesNothingBehind() throws Exception {
        File missing = CameraInbox.newShot(root);
        assertFalse(CameraInbox.settle(missing));
        File empty = photo(CameraInbox.newShot(root), 0);
        assertFalse(CameraInbox.settle(empty));
        assertFalse("an empty file is removed", empty.exists());
    }

    @Test public void aRealPhotoSurvivesSettle() throws Exception {
        File shot = photo(CameraInbox.newShot(root), 100);
        assertTrue(CameraInbox.settle(shot));
        assertTrue(shot.exists());
    }

    @Test public void acceptMovesThePhotoNeverCopiesOrDeletesIt() throws Exception {
        File shot = photo(CameraInbox.newShot(root), 100);
        File moved = CameraInbox.accept(root, shot);
        assertNotNull(moved);
        assertEquals(CameraInbox.photosDir(root), moved.getParentFile());
        assertEquals(100, moved.length());
        assertFalse(shot.exists());
    }

    @Test public void acceptRefusesFilesThatAreNotOursOrNotPhotos() throws Exception {
        File foreign = photo(new File(CameraInbox.waitingDir(root), "holiday.jpg"), 50);
        assertNull(CameraInbox.accept(root, foreign));
        assertTrue("a foreign file is left alone", foreign.exists());
        assertNull(CameraInbox.accept(root, CameraInbox.newShot(root)));
        assertNull(CameraInbox.accept(root, null));
    }

    @Test public void collectedPhotosAreListedOldestFirstAndMovedTogether() throws Exception {
        File first = photo(CameraInbox.newShot(root), 10), second = photo(CameraInbox.newShot(root), 20);
        assertTrue(first.setLastModified(1_000_000L));
        assertTrue(second.setLastModified(2_000_000L));
        photo(CameraInbox.newShot(root), 0); // an empty one is not a photo
        List<File> waiting = CameraInbox.waiting(root);
        assertEquals(2, waiting.size());
        assertEquals(first.getName(), waiting.get(0).getName());
        List<File> moved = CameraInbox.acceptAllWaiting(root, 50);
        assertEquals(2, moved.size());
        assertEquals(0, CameraInbox.waiting(root).size());
    }

    @Test public void theLimitIsRespectedAndTheRestStaysWaiting() throws Exception {
        for (int i = 0; i < 5; i++) photo(CameraInbox.newShot(root), 10 + i);
        assertEquals(3, CameraInbox.acceptAllWaiting(root, 3).size());
        assertEquals(2, CameraInbox.waiting(root).size());
    }

    @Test public void discardRemovesOnlyUnscannedPhotosOfOurs() throws Exception {
        File waiting = photo(CameraInbox.newShot(root), 10);
        File foreign = photo(new File(CameraInbox.waitingDir(root), "mine.jpg"), 10);
        File scanned = CameraInbox.accept(root, photo(CameraInbox.newShot(root), 10));
        assertEquals(1, CameraInbox.discardWaiting(root));
        assertFalse(waiting.exists());
        assertTrue("a file that is not ours is never deleted", foreign.exists());
        assertTrue("a scanned photo is never deleted", scanned.exists());
    }

    @Test public void namesWithPathTricksAreNotOurs() {
        assertFalse(CameraInbox.isOurs(new File("camera-../x.jpg")));
        assertFalse(CameraInbox.isOurs(new File("photo.jpg")));
        assertFalse(CameraInbox.isOurs(new File("camera-1.png")));
        assertTrue(CameraInbox.isOurs(new File("camera-1.jpg")));
    }
}
