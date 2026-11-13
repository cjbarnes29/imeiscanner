package com.imeilens.scanner;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

/**
 * Replays the geometry the scanner saw on 11 real camera photos and the 5 Phase 2 labelled photos (src/test/resources/label-geometry-replay.txt,
 * made by scripts/make-geometry-fixture.mjs; synthetic checksum-invalid numbers). The text recognition itself cannot run on the JVM, so this checks
 * what happens after it: grouping the "IMEI 1" lines into labels and estimating how many labels the photo shows.
 */
public class LabelGeometryReplayTest {
    static final class Photo {
        String id; int width, height, labels, deviceGroups, deviceTarget, modelLines, barcodeLabels;
        final List<LabelGeometry.Item> lines = new ArrayList<>();
    }

    static List<Photo> load() throws Exception {
        List<Photo> photos = new ArrayList<>();
        try (BufferedReader in = new BufferedReader(new InputStreamReader(
                LabelGeometryReplayTest.class.getClassLoader().getResourceAsStream("label-geometry-replay.txt"), StandardCharsets.UTF_8))) {
            Photo photo = null;
            for (String row; (row = in.readLine()) != null; ) {
                if (row.startsWith("#") || row.trim().isEmpty()) continue;
                String[] p = row.split(" ", -1);
                if (p[0].equals("photo")) {
                    photo = new Photo(); photo.id = p[1]; photo.width = Integer.parseInt(p[2]); photo.height = Integer.parseInt(p[3]);
                    photo.labels = Integer.parseInt(p[4]); photo.deviceGroups = Integer.parseInt(p[5]); photo.deviceTarget = Integer.parseInt(p[6]);
                    photo.modelLines = Integer.parseInt(p[7]); photo.barcodeLabels = Integer.parseInt(p[8]);
                    photos.add(photo);
                } else if (p[0].equals("i1")) {
                    String text = row.substring(row.indexOf(p[5], p[0].length() + p[1].length() + p[2].length() + p[3].length() + p[4].length() + 5));
                    photo.lines.add(new LabelGeometry.Item(text, box(p, 1)));
                } else if (p[0].equals("a")) {
                    int length = Integer.parseInt(p[6]);
                    String text = p[1].equals("model") ? "Model : SM-A000X/DS" : p[1].equals("imei2") ? "IMEI 2 : 99" : "S/N : RXXX";
                    StringBuilder padded = new StringBuilder(text); while (padded.length() < length) padded.append('x');
                    photo.lines.add(new LabelGeometry.Item(padded.toString(), box(p, 2)));
                }
            }
        }
        return photos;
    }

    private static LabelGeometry.Box box(String[] p, int from) {
        return new LabelGeometry.Box(Integer.parseInt(p[from]), Integer.parseInt(p[from + 1]), Integer.parseInt(p[from + 2]), Integer.parseInt(p[from + 3]));
    }

    @Test public void fixtureLoads() throws Exception {
        List<Photo> photos = load();
        assertEquals(16, photos.size());
        for (Photo photo : photos) assertTrue(photo.id + " has lines", !photo.lines.isEmpty());
    }

    /**
     * Grouping and the Auto label estimate on every replayed photo. (Before the change the replay reproduced the phone's grouping on 16 of 16
     * photos, so the "device" column is what the old code did on the phone.)
     */
    @Test public void groupingAndCountOnRealAndLabelledPhotos() throws Exception {
        StringBuilder report = new StringBuilder("photo    labels | old groups -> new groups | old target -> new target | fragments\n");
        int inventedGroups = 0, exactGroups = 0, exactBefore = 0, overTarget = 0, underTarget = 0, underTargetBefore = 0;
        for (Photo photo : load()) {
            LabelGeometry.Grouping grouping = LabelGeometry.group(photo.lines, photo.width, photo.height);
            int groups = grouping.groups.size();
            int target = Math.max(Math.max(photo.modelLines, photo.barcodeLabels), LabelGeometry.landmarkLabels(photo.lines));
            report.append(String.format("%-8s %d      | %d -> %d                  | %d -> %d                  | %d%n", photo.id, photo.labels,
                photo.deviceGroups, groups, photo.deviceTarget, target, grouping.fragments));
            if (groups != photo.labels) for (LabelGeometry.Hit hit : grouping.hits)
                report.append(String.format("      line y %.2f-%.2f x %.2f-%.2f digits %d cut %b -> group %d: %s%n", hit.box.top / (double) photo.height,
                    hit.box.bottom / (double) photo.height, hit.box.left / (double) photo.width, hit.box.right / (double) photo.width, hit.digits,
                    LabelGeometry.cutOffByEdge(hit, photo.width), hit.group, hit.note));
            if (groups > photo.labels) inventedGroups++;
            if (groups == photo.labels) exactGroups++;
            if (photo.deviceGroups == photo.labels) exactBefore++;
            if (target > photo.labels) overTarget++;
            if (target < photo.labels) underTarget++;
            if (photo.deviceTarget < photo.labels) underTargetBefore++;
        }
        report.append(String.format("exact groups %d -> %d of 16; Auto target too low %d -> %d; too high %d; more groups than labels %d%n",
            exactBefore, exactGroups, underTargetBefore, underTarget, overTarget, inventedGroups));
        System.out.println(report);
        assertEquals("never more groups than real labels (a group becomes a product)\n" + report, 0, inventedGroups);
        assertEquals("the Auto estimate never exceeds the real labels on this set (no false review flags)\n" + report, 0, overTarget);
        assertTrue("grouping must improve, not regress\n" + report, exactGroups > exactBefore);
        assertTrue("the Auto estimate must improve\n" + report, underTarget < underTargetBefore);
    }

    /** Photos that were right before must stay exactly as they were. */
    @Test public void photosThatWereRightStayRight() throws Exception {
        for (Photo photo : load()) {
            if (photo.deviceGroups != photo.labels) continue;
            assertEquals(photo.id, photo.labels, LabelGeometry.group(photo.lines, photo.width, photo.height).groups.size());
        }
    }
}
