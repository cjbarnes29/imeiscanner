package com.imeilens.scanner;

import android.content.Context;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The loaded brand profiles and the brand decision for one label.
 * Decision: the label's OWN text is searched for evidence of every ACTIVE brand. Exactly one brand with evidence -> that brand. None, or more than
 * one -> the generic profile (no brand rules) and the record is marked "brand unclear". A brand is never inferred from the IMEI digits.
 * Profiles come from the app's assets (brands/*.json, copied from the repository's brands/profiles at build time); unit tests read the repository files.
 */
final class BrandRegistry {
    private BrandRegistry() { }

    static final String[] FILES = {"samsung.json", "generic.json", "apple.json"};
    private static volatile List<BrandProfile> profiles;

    /** Result of the brand decision. */
    static final class Decision {
        final BrandProfile brand;  // the chosen profile (never null: generic at worst)
        final boolean unclear;     // no brand, or several brands, had evidence
        Decision(BrandProfile brand, boolean unclear) { this.brand = brand; this.unclear = unclear; }
    }

    /** Loads the profiles from the app's assets once. A broken or missing file is skipped: the other brands keep working. */
    static synchronized void init(Context context) {
        if (profiles != null) return;
        List<BrandProfile> list = new ArrayList<>();
        for (String file : FILES) {
            try (InputStream in = context.getAssets().open("brands/" + file)) {
                list.add(BrandProfile.parse(new String(readAll(in), StandardCharsets.UTF_8)));
            } catch (Exception ignored) { /* skipped */ }
        }
        profiles = Collections.unmodifiableList(list);
    }

    /** Unit tests: read the repository's profiles. */
    static synchronized void loadFromDirectory(File directory) throws Exception {
        List<BrandProfile> list = new ArrayList<>();
        for (String file : FILES) list.add(BrandProfile.parse(new String(Files.readAllBytes(new File(directory, file).toPath()), StandardCharsets.UTF_8)));
        profiles = Collections.unmodifiableList(list);
    }

    private static List<BrandProfile> all() {
        if (profiles == null) {
            try { loadFromDirectory(new File("../../brands/profiles")); }
            catch (Exception error) { throw new IllegalStateException("Brand profiles are not loaded", error); }
        }
        return profiles;
    }

    static BrandProfile byId(String id) {
        for (BrandProfile p : all()) if (p.id.equals(id)) return p;
        throw new IllegalStateException("No brand profile " + id);
    }

    static Decision detect(String labelText) {
        BrandProfile chosen = null; int count = 0;
        for (BrandProfile p : all()) if (p.active() && !"generic".equals(p.id) && p.hasEvidence(labelText)) { chosen = p; count++; }
        return count == 1 ? new Decision(chosen, false) : new Decision(byId("generic"), true);
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[8192]; int n;
        while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
        return out.toByteArray();
    }
}
