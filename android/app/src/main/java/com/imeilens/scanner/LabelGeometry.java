package com.imeilens.scanner;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Where the product labels in one photo are, worked out from the "IMEI 1" text lines the reader found.
 * Plain Java (no android.* classes) so it can be unit-tested on a normal JVM; ImageScanner converts to and from Rect.
 */
final class LabelGeometry {
    private LabelGeometry() {}

    /** A line that names IMEI 1, tolerating the usual misreads of "IMEI" and of the 1. */
    static final Pattern LABEL_ONE = Pattern.compile("(?i)\\bI\\s*M\\s*[E3]\\s*[I1!|l]\\s*[:#-]?\\s*[1I]\\b");
    /** Exactly 15 digits, spaces and dashes allowed between them. */
    static final Pattern NUMBER = Pattern.compile("(?<!\\d)(?:\\d[\\s-]*){15}(?!\\d)");

    /** An integer rectangle (the parts of android.graphics.Rect that are needed here). */
    static final class Box {
        int left, top, right, bottom;
        Box(int left, int top, int right, int bottom) { this.left = left; this.top = top; this.right = right; this.bottom = bottom; }
        Box(Box other) { this(other.left, other.top, other.right, other.bottom); }
        int centerX() { return (left + right) >> 1; }
        int centerY() { return (top + bottom) >> 1; }
        int width() { return right - left; }
        int height() { return bottom - top; }
        void union(Box other) { left = Math.min(left, other.left); top = Math.min(top, other.top); right = Math.max(right, other.right); bottom = Math.max(bottom, other.bottom); }
    }

    /** One line of read text and where it is. */
    static final class Item {
        final String text; final Box box;
        Item(String text, Box box) { this.text = text; this.box = box; }
    }

    /** One "IMEI 1" line that was kept (a repeat of the same place is dropped) and the group it ended up in. */
    static final class Hit {
        final Box box;
        /** The 15 digits on the line, or "" when the line has fewer or more (cut off at the photo's edge, misread, joined). */
        final String number;
        int group = -1;
        /** Diagnostics only: why this line started a group of its own instead of joining one (never contains digits). */
        String note = "";
        /** How many digits the line shows and how long its text is (to tell a line that was cut off by the photo edge). */
        int digits, length;
        Hit(Box box, String number) { this.box = box; this.number = number; }
    }

    static final class Grouping {
        final List<Hit> hits = new ArrayList<>();
        final List<Box> groups = new ArrayList<>();
        boolean vertical;
        /** "IMEI 1" scraps of neighbouring labels at the photo border that were not made into labels. */
        int fragments;
    }

    /**
     * The printed IMEI 1 of ONE label as the whole-photo read saw it: the checksum-valid 15-digit numbers on "IMEI 1" lines whose centre lies
     * inside the label's region. Exactly one distinct number, or "" (two different numbers: unclear which belongs to this label, so nothing is
     * chosen). Used only when the label's own crop gave no IMEI 1, and then only with a review mark.
     */
    static String printedImei1In(List<Hit> hits, Box region) {
        String found = "";
        for (Hit hit : hits) {
            if (hit.number.length() != 15 || !ImeiSource.luhn(hit.number)) continue;
            int x = hit.box.centerX(), y = hit.box.centerY();
            if (x < region.left || x > region.right || y < region.top || y > region.bottom) continue;
            if (!found.isEmpty() && !found.equals(hit.number)) return "";
            found = hit.number;
        }
        return found;
    }

    /** The digits of a masked IMEI for logs: first 8 and last 4 digits, the rest hidden. Anything else is only counted. */
    static String mask(String digits) {
        if (digits == null || digits.isEmpty()) return "";
        if (digits.length() == 15) return digits.substring(0, 8) + "***" + digits.substring(11);
        return "#" + digits.length();
    }

    /** The share (0..1) of the inner box's area that lies inside the outer box. */
    static double insideFraction(Box inner, Box outer) {
        int width = Math.min(inner.right, outer.right) - Math.max(inner.left, outer.left);
        int height = Math.min(inner.bottom, outer.bottom) - Math.max(inner.top, outer.top);
        long area = (long) inner.width() * inner.height();
        if (width <= 0 || height <= 0 || area <= 0) return 0;
        return (double) width * height / area;
    }

    /** The "IMEI 1" lines of a photo, repeats of the same place and pieces of known lines removed. */
    static List<Hit> imeiOneHits(List<Item> lines) {
        List<Hit> hits = new ArrayList<>();
        for (Item line : lines) {
            Matcher label = LABEL_ONE.matcher(line.text);
            if (!label.find()) continue;
            Box box = line.box;
            Matcher number = NUMBER.matcher(line.text);
            String imei = number.find() ? number.group().replaceAll("\\D", "") : "";
            Hit hit = new Hit(new Box(box), imei);
            hit.length = line.text.length();
            // Digits of the number only: the "1" of "IMEI 1" is not one of them (counting it made a line with 14 of 15 digits look complete,
            // so a number cut off by the photo edge was not recognised as cut off; seen on real photos).
            for (int i = label.end(); i < line.text.length(); i++) if (Character.isDigit(line.text.charAt(i))) hit.digits++;
            boolean duplicate = false;
            int replace = -1;
            for (int index = 0; index < hits.size(); index++) {
                Hit previous = hits.get(index);
                // Reading the photo again in tiles also returns pieces of lines that are already known (a few digits of a
                // line, lying inside its box). A piece of a known line is that line, not another label.
                // The reverse, a piece seen first and the whole line later: keep the whole line (checked before the
                // same-place rule below, which measures against the new line's width and would drop the longer one).
                if (insideFraction(previous.box, box) >= 0.8) replace = index;
                else if (insideFraction(box, previous.box) >= 0.8) duplicate = true;
                else if (Math.abs(previous.box.centerX() - box.centerX()) < Math.max(24, box.width() / 3)
                    && Math.abs(previous.box.centerY() - box.centerY()) < Math.max(24, box.height() * 2)) duplicate = true;
            }
            if (!duplicate && replace >= 0) hits.set(replace, hit);
            else if (!duplicate) hits.add(hit);
        }
        return hits;
    }

    /** Which way the labels are stacked, judged from where the "IMEI 1" lines are (the long-standing rule, kept as the tie-breaker). */
    static boolean stackedVertically(List<Hit> hits, int width, int height) {
        int minX = Integer.MAX_VALUE, maxX = Integer.MIN_VALUE, minY = Integer.MAX_VALUE, maxY = Integer.MIN_VALUE;
        for (Hit hit : hits) {
            minX = Math.min(minX, hit.box.centerX()); maxX = Math.max(maxX, hit.box.centerX());
            minY = Math.min(minY, hit.box.centerY()); maxY = Math.max(maxY, hit.box.centerY());
        }
        return (double) (maxY - minY) / height >= (double) (maxX - minX) / width;
    }

    private static List<Hit> copyOf(List<Hit> hits) {
        List<Hit> copy = new ArrayList<>(hits.size());
        for (Hit hit : hits) { Hit c = new Hit(new Box(hit.box), hit.number); c.digits = hit.digits; c.length = hit.length; copy.add(c); }
        return copy;
    }

    /**
     * Groups the "IMEI 1" lines of a photo into labels. Lines with the same full 15-digit number that sit close together
     * (one label prints each IMEI more than once) become one label.
     *
     * Two things were found on real photos of two stacked boxes (2 labels were counted as 4 to 6):
     * - The label's left and right "IMEI 1" lines spread the line centres as much sideways as the labels are spread
     *   downwards, so the stacking direction was guessed wrong and same-label lines could not join. The grouping is now
     *   tried both ways and the way that joins more lines wins (a tie keeps the old guess).
     * - A line cut off by the photo's edge has no full number, so it became a "label" of its own. It now joins the
     *   nearest numbered label when that label would still be no taller than the limit used for joining.
     */
    static Grouping group(List<Item> lines, int width, int height) {
        List<Hit> found = imeiOneHits(lines);
        if (found.size() < 2) {
            Grouping single = new Grouping();
            single.hits.addAll(found);
            for (Hit hit : found) { single.groups.add(new Box(hit.box)); hit.group = single.groups.size() - 1; }
            return single;
        }
        boolean guess = stackedVertically(found, width, height);
        Grouping first = groupAlong(copyOf(found), guess, width, height);
        Grouping other = groupAlong(copyOf(found), !guess, width, height);
        if (other.groups.size() != first.groups.size()) return other.groups.size() < first.groups.size() ? other : first;
        // Same number of labels both ways: the way that explains more lines (fewer left over as border scraps) wins.
        if (other.fragments != first.fragments) return other.fragments < first.fragments ? other : first;
        // Still a tie: every label prints one "S/N" line, so the labels are stacked in the direction the S/N lines are spread. (The old guess
        // from the IMEI 1 lines fails on wide labels, whose right-column lines spread sideways as much as the labels spread downwards.)
        Boolean bySerial = stackedBySerial(lines, width, height);
        if (bySerial != null && bySerial != first.vertical) return other;
        return first;
    }

    /** True / false when at least two distinct "S/N" lines show the stacking direction clearly; null when they do not. */
    static Boolean stackedBySerial(List<Item> lines, int width, int height) {
        List<Box> serials = distinctBoxes(lines, SERIAL);
        if (serials.size() < 2) return null;
        int minX = Integer.MAX_VALUE, maxX = Integer.MIN_VALUE, minY = Integer.MAX_VALUE, maxY = Integer.MIN_VALUE;
        for (Box box : serials) {
            minX = Math.min(minX, box.centerX()); maxX = Math.max(maxX, box.centerX());
            minY = Math.min(minY, box.centerY()); maxY = Math.max(maxY, box.centerY());
        }
        double down = (double) (maxY - minY) / height, across = (double) (maxX - minX) / width;
        if (down > across * 2 && down > 0.15) return true;
        if (across > down * 2 && across > 0.15) return false;
        return null; // diagonal or too close together: no opinion
    }

    /** One grouping attempt with the labels assumed stacked top-to-bottom (vertical) or side by side. */
    static Grouping groupAlong(List<Hit> hits, boolean vertical, int width, int height) {
        Grouping result = new Grouping();
        result.hits.addAll(hits);
        result.vertical = vertical;
        int major = vertical ? height : width, minor = vertical ? width : height;
        List<Hit> numbered = new ArrayList<>(), partial = new ArrayList<>();
        for (Hit hit : hits) (hit.number.isEmpty() ? partial : numbered).add(hit);
        java.util.Comparator<Hit> along = (a, b) -> Integer.compare(vertical ? a.box.centerY() : a.box.centerX(), vertical ? b.box.centerY() : b.box.centerX());
        numbered.sort(along);
        partial.sort(along);
        // Lines misread in the open first (each stays a label of its own, unchanged), then lines cut off by the edge, so a cut-off line can join
        // the label of a misread line on the same row (a label whose only full-width IMEI 1 line was misread; seen on a real photo).
        List<Hit> ordered = new ArrayList<>(partial.size());
        for (Hit hit : partial) if (!cutOffByEdge(hit, width)) ordered.add(hit);
        for (Hit hit : partial) if (cutOffByEdge(hit, width)) ordered.add(hit);
        partial = ordered;
        List<String> groupNumbers = new ArrayList<>();
        for (Hit hit : numbered) {
            int match = -1;
            for (int groupIndex = 0; groupIndex < result.groups.size(); groupIndex++) {
                Box group = result.groups.get(groupIndex);
                if (!hit.number.equals(groupNumbers.get(groupIndex))) continue;
                int gap = vertical ? hit.box.centerY() - group.bottom : hit.box.centerX() - group.right;
                int cross = vertical ? Math.abs(hit.box.centerX() - group.centerX()) : Math.abs(hit.box.centerY() - group.centerY());
                int span = vertical ? Math.max(hit.box.bottom, group.bottom) - Math.min(hit.box.top, group.top)
                    : Math.max(hit.box.right, group.right) - Math.min(hit.box.left, group.left);
                if (gap < major * 0.18 && cross < minor * 0.65 && span < major * 0.27) { match = groupIndex; break; }
                // One device has one IMEI 1: the same full number printed again on the same row of the label (left and right
                // columns of a wide label, further apart than the cross limit) is that label, not a second one. Still limited along
                // the stacking direction, so two far-apart reads of one number are not glued over another label.
                if (span < major * 0.27) { match = groupIndex; hit.note = "joined label " + groupIndex + " (same number on the same row)"; break; }
            }
            if (match >= 0) { result.groups.get(match).union(hit.box); hit.group = match; }
            else {
                hit.note = explain(hit, result.groups, groupNumbers, vertical, major, minor, width, height);
                result.groups.add(new Box(hit.box)); groupNumbers.add(hit.number); hit.group = result.groups.size() - 1;
            }
        }
        int numberedGroups = result.groups.size();
        for (Hit hit : partial) {
            int best = -1, bestDistance = Integer.MAX_VALUE;
            boolean cut = cutOffByEdge(hit, width);
            int centre = vertical ? hit.box.centerY() : hit.box.centerX();
            // A number cut off by the photo edge may join any label close enough along the stacking direction, including a label made of
            // other cut-off lines (the right column of a label whose numbered line was not read). A line misread in the open is never
            // attached (unchanged rule): it stays a label of its own and is reviewed, rather than being guessed into a neighbour.
            if (cut) for (int groupIndex = 0; groupIndex < result.groups.size(); groupIndex++) {
                Box group = result.groups.get(groupIndex);
                int span = vertical ? Math.max(hit.box.bottom, group.bottom) - Math.min(hit.box.top, group.top)
                    : Math.max(hit.box.right, group.right) - Math.min(hit.box.left, group.left);
                int cross = vertical ? Math.abs(hit.box.centerX() - group.centerX()) : Math.abs(hit.box.centerY() - group.centerY());
                if (span >= major * 0.27) continue; // it would make the label taller than a label can be: not this one
                // A label without a read number: the cut-off right column of a wide label sits up to about 0.7 of the photo width away.
                if (groupIndex >= numberedGroups && cross >= minor * 0.80) continue;
                int distance = Math.abs(centre - (vertical ? group.centerY() : group.centerX()));
                if (distance < bestDistance) { best = groupIndex; bestDistance = distance; }
            }
            if (best >= 0) {
                result.groups.get(best).union(hit.box); hit.group = best;
                hit.note = "joined label " + best + " (line cut off at the photo edge)";
            } else if (edgeFragment(hit, width, height) && numberedGroups > 0) {
                // A scrap of a neighbouring label at the photo's border ("IMEI 1" with almost no digits): it cannot become a product and
                // must not stop the visible labels from being cut apart. Counted, never silently: see Grouping.fragments.
                hit.note = "edge fragment (" + hit.digits + " digits at the photo border), not a label";
                result.fragments++;
            } else {
                hit.note = explain(hit, result.groups, groupNumbers, vertical, major, minor, width, height);
                result.groups.add(new Box(hit.box)); groupNumbers.add(""); hit.group = result.groups.size() - 1;
            }
        }
        return result;
    }

    static final Pattern SERIAL = Pattern.compile("(?i)\\bS\\s*/\\s*N\\b");
    /**
     * The memory line of a label: the whole line is RAM and storage ("4GB |128GB", "8GB 256GB"). A single capacity is not enough (some layouts
     * print RAM and storage on separate lines). Glare misreads seen on real photos are allowed in the units ("128G8", "4PG", "128 GE") as long
     * as one of the two units reads exactly GB or TB.
     */
    static final Pattern STORAGE = Pattern.compile("(?i)^(?=.*\\d\\s*[GT]B)\\s*\\d{1,2}\\s*[A-Z68]{1,2}\\s*[|/Il1!]?\\s*\\d{2,4}\\s*[A-Z68]{1,2}\\s*$");

    /**
     * How many labels the landmarks show, as a second opinion on the label count that does not need the "Model" line (cut off by the frame on
     * 3 of 11 real photos) or a readable IMEI 1: the larger of the distinct "S/N" lines and the distinct memory lines, one of each per label on
     * every label seen so far. Repeats at the same place count once.
     * "IMEI 2" is NOT used: some labels print it several times or on one line with IMEI 1 (it counted 4 and 9 labels on 2- and 4-label photos).
     */
    static int landmarkLabels(List<Item> lines) {
        return Math.max(distinctBoxes(lines, SERIAL).size(), distinctBoxes(lines, STORAGE).size());
    }

    private static List<Box> distinctBoxes(List<Item> lines, Pattern pattern) {
        List<Box> found = new ArrayList<>();
        for (Item line : lines) {
            if (!pattern.matcher(line.text).find()) continue;
            boolean seen = false;
            // The line's thickness is its smaller side: on a photo turned by 90 degrees the text runs downwards.
            int thick = Math.min(line.box.width(), line.box.height());
            boolean upright = line.box.width() >= line.box.height();
            for (Box known : found) {
                int across = upright ? Math.abs(known.centerY() - line.box.centerY()) : Math.abs(known.centerX() - line.box.centerX());
                int along = upright ? Math.abs(known.centerX() - line.box.centerX()) : Math.abs(known.centerY() - line.box.centerY());
                if (across < Math.max(12, thick * 3 / 2) && along < Math.max(40, thick * 6)) seen = true;
            }
            if (!seen) found.add(line.box);
        }
        return found;
    }

    /** "IMEI 1" with fewer than 6 digits, touching the photo border: a cut-off scrap of a neighbouring label. */
    static boolean edgeFragment(Hit hit, int width, int height) {
        if (hit.digits >= 6) return false;
        int marginX = Math.max(4, width / 100), marginY = Math.max(4, height / 100);
        return hit.box.left <= marginX || hit.box.top <= marginY || hit.box.right >= width - marginX || hit.box.bottom >= height - marginY;
    }

    /**
     * True when the line shows fewer than 15 digits and the digits it is missing would not fit before the photo's right edge
     * (judged from this line's own character width), so the number was cut off by the edge and not misread in the open.
     */
    static boolean cutOffByEdge(Hit hit, int width) {
        if (hit.digits >= 15 || hit.length <= 0 || hit.box.width() <= 0) return false;
        double characterWidth = hit.box.width() / (double) hit.length;
        return hit.box.right + (15 - hit.digits) * characterWidth >= width - 4;
    }

    /** How many digit positions differ between two numbers of the same length. */
    static int differences(String a, String b) {
        if (a.length() != b.length()) return Math.max(a.length(), b.length());
        int count = 0;
        for (int i = 0; i < a.length(); i++) if (a.charAt(i) != b.charAt(i)) count++;
        return count;
    }

    /** Diagnostics: the reason a line did not join an existing group. Describes, never prints, the digits. */
    private static String explain(Hit hit, List<Box> groups, List<String> groupNumbers, boolean vertical, int major, int minor, int width, int height) {
        if (hit.number.isEmpty()) return "no 15-digit number on this line (" + hit.digits + " digits)" + (cutOffByEdge(hit, width) ? " (cut off by the photo edge)" : "");
        StringBuilder reasons = new StringBuilder();
        for (int index = 0; index < groups.size(); index++) {
            Box group = groups.get(index);
            int gap = vertical ? hit.box.centerY() - group.bottom : hit.box.centerX() - group.right;
            int cross = vertical ? Math.abs(hit.box.centerX() - group.centerX()) : Math.abs(hit.box.centerY() - group.centerY());
            int span = vertical ? Math.max(hit.box.bottom, group.bottom) - Math.min(hit.box.top, group.top)
                : Math.max(hit.box.right, group.right) - Math.min(hit.box.left, group.left);
            boolean geometry = gap < major * 0.18 && cross < minor * 0.65 && span < major * 0.27;
            String other = groupNumbers.get(index);
            if (other.isEmpty()) continue;
            int off = differences(hit.number, other);
            if (off == 0 && !geometry) reasons.append("g").append(index).append(": same digits but geometry fails (gap ").append(gap).append("/").append((int) (major * 0.18))
                .append(", cross ").append(cross).append("/").append((int) (minor * 0.65)).append(", span ").append(span).append("/").append((int) (major * 0.27)).append("); ");
            else if (off > 0 && geometry) reasons.append("g").append(index).append(": geometry fits but ").append(off).append(" digit(s) differ; ");
            else if (off > 0 && off <= 4) reasons.append("g").append(index).append(": ").append(off).append(" digit(s) differ and geometry fails; ");
        }
        return reasons.length() == 0 ? "first line of a label" : reasons.toString().trim();
    }
}
