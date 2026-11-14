package com.imeilens.scanner;

import static com.imeilens.scanner.ImeiSourceTest.withCheck;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * The shared conformance file (brands/conformance/samsung.json) captured the Samsung behaviour BEFORE the profile refactor. The same file is
 * run by the web tests, so the Java and web readers cannot drift apart. Synthetic text and numbers only.
 */
public class BrandConformanceTest {
    static JSONObject load(String name) throws Exception {
        File file = new File("../../brands/conformance/" + name);
        return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
    }

    @Test public void samsungEvidenceGate() throws Exception {
        JSONArray cases = load("samsung.json").getJSONArray("evidence");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            assertEquals(c.getString("text"), c.getBoolean("match"), SamsungImei.isSamsungLabel(c.getString("text")));
        }
    }

    @Test public void samsungModelReads() throws Exception {
        JSONArray cases = load("samsung.json").getJSONArray("modelReads");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            SamsungModel.Reading r = SamsungModel.read(c.getString("text"));
            assertEquals(c.getString("text"), c.getString("model"), r.model);
            assertEquals(c.getString("text"), c.getBoolean("uncertain"), r.uncertain);
            String has = c.optString("noteHas", null);
            if (has != null && !has.isEmpty()) assertTrue(r.note, r.note.contains(has));
            if (has != null && has.isEmpty()) assertEquals("", r.note);
        }
    }

    @Test public void samsungRepairsAndTypedShape() throws Exception {
        JSONObject file = load("samsung.json");
        JSONArray repairs = file.getJSONArray("repairs");
        for (int i = 0; i < repairs.length(); i++) assertEquals(repairs.getJSONObject(i).getString("code"), repairs.getJSONObject(i).getString("repaired"), SamsungModel.repaired(repairs.getJSONObject(i).getString("code")));
        JSONArray shapes = file.getJSONArray("editShape");
        for (int i = 0; i < shapes.length(); i++) assertEquals(shapes.getJSONObject(i).getString("model"), shapes.getJSONObject(i).getBoolean("ok"), SamsungModel.looksLikeSamsungCode(shapes.getJSONObject(i).getString("model")));
    }

    @Test public void samsungSameDeviceRule() throws Exception {
        JSONArray cases = load("samsung.json").getJSONArray("sameDeviceImei1");
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            String imei2 = withCheck(c.getString("imei2"));
            List<String> barcodes = new ArrayList<>();
            for (int k = 0; k < c.getJSONArray("barcodes").length(); k++) barcodes.add(withCheck(c.getJSONArray("barcodes").getString(k)));
            int expect = c.getInt("expect");
            assertEquals(c.getString("name"), expect < 0 ? "" : barcodes.get(expect), SamsungImei.sameDeviceImei1(imei2, barcodes));
        }
    }
}
