package com.imeilens.scanner;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * One manufacturer, as data (brands/profiles/&lt;id&gt;.json, shared with the web page): the words and code shapes that identify the brand on the
 * label's OWN text, the model-code grammar with its allowed OCR repairs, the review notes, and the brand-only IMEI rules (each with its
 * trust level). The code here is generic: it never names a brand. Only profiles with status "active" take part in brand detection.
 * Pure Java (unit-tested on the JVM).
 */
final class BrandProfile {
    final String id, name, status;
    private final List<Pattern> words = new ArrayList<>(), shapes = new ArrayList<>();
    private final JSONObject model;
    private final List<Rule> rules = new ArrayList<>();

    /** A brand-only IMEI rule. `trust` is "observed" (always flagged for review) or "confirmed" (a second source agrees). */
    static final class Rule {
        final String id, type, trust, note; final int from, to;
        Rule(JSONObject o) {
            id = o.optString("id"); type = o.optString("type"); trust = o.optString("trust", "observed"); note = o.optString("note");
            from = o.optInt("from"); to = o.optInt("to");
        }
    }

    /** The model code of a label and how sure the reader is. */
    static final class Reading {
        final String model; final boolean uncertain; final String note;
        Reading(String model, boolean uncertain, String note) { this.model = model; this.uncertain = uncertain; this.note = note; }
    }

    static BrandProfile parse(String json) throws JSONException { return new BrandProfile(new JSONObject(json)); }

    private BrandProfile(JSONObject o) throws JSONException {
        id = o.getString("id"); name = o.optString("name", id); status = o.optString("status", "draft");
        JSONObject evidence = o.optJSONObject("evidence");
        if (evidence != null) {
            JSONArray w = evidence.optJSONArray("words"), s = evidence.optJSONArray("codeShapes");
            for (int i = 0; w != null && i < w.length(); i++) words.add(Pattern.compile("\\b" + Pattern.quote(w.getString(i)) + "\\b", Pattern.CASE_INSENSITIVE));
            for (int i = 0; s != null && i < s.length(); i++) shapes.add(Pattern.compile(s.getString(i)));
        }
        model = o.optJSONObject("model") == null ? new JSONObject() : o.getJSONObject("model");
        JSONArray r = o.optJSONArray("imeiRules");
        for (int i = 0; r != null && i < r.length(); i++) rules.add(new Rule(r.getJSONObject(i)));
    }

    boolean active() { return "active".equals(status); }

    /** True when the label's own text shows this brand (a word or a code shape). A brand without any evidence never matches. */
    boolean hasEvidence(String labelText) {
        if (labelText == null) return false;
        for (Pattern p : words) if (p.matcher(labelText).find()) return true;
        for (Pattern p : shapes) if (p.matcher(labelText).find()) return true;
        return false;
    }

    Rule rule(String type) { for (Rule r : rules) if (r.type.equals(type)) return r; return null; }

    String note(String key) { JSONObject n = model.optJSONObject("notes"); return n == null ? "" : n.optString(key, ""); }

    String prefix() { return model.optString("prefix", ""); }

    // ---- model grammar ------------------------------------------------------------------------------------------------------------------

    private boolean hasGrammar() { return model.has("core") && model.has("visible"); }
    private Pattern core() { return Pattern.compile(model.optString("core")); }

    /** A letter the reader gives for a digit (from the profile's repair table), or the character itself. */
    private char digitFor(char c) {
        JSONObject map = model.optJSONObject("repairs");
        String mapped = map == null ? "" : map.optString(String.valueOf(c), "");
        return mapped.length() == 1 ? mapped.charAt(0) : c;
    }

    /** The code with confusable letters in the digit positions turned into digits, or "" when it still does not fit the code shape. */
    String repaired(String code) {
        if (!hasGrammar()) return "";
        JSONArray positions = model.optJSONArray("digitPositions");
        Set<Integer> digitAt = new HashSet<>();
        for (int i = 0; positions != null && i < positions.length(); i++) digitAt.add(positions.optInt(i));
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < code.length(); i++) out.append(digitAt.contains(i) ? digitFor(code.charAt(i)) : code.charAt(i));
        String result = out.toString();
        return code.length() == out.length() && core().matcher(result).matches() ? result : "";
    }

    private String fill(String template, String... pairs) {
        String out = template.replace("{prefix}", prefix());
        for (int i = 0; i + 1 < pairs.length; i += 2) out = out.replace("{" + pairs[i] + "}", pairs[i + 1]);
        return out;
    }

    /** Reads the model code from a label's text. Clean reads are certain; repaired or disagreeing reads are kept but marked uncertain. Never invents a code. */
    Reading readModel(String text) {
        if (!hasGrammar()) return new Reading("", true, "");
        Pattern exactShape = core();
        Pattern labelledPattern = model.has("labelled") ? Pattern.compile(model.optString("labelled"), Pattern.CASE_INSENSITIVE) : null;
        Pattern visiblePattern = Pattern.compile(model.optString("visible"), Pattern.CASE_INSENSITIVE);
        String labelledCode = "";
        if (labelledPattern != null) { Matcher m = labelledPattern.matcher(text); if (m.find()) labelledCode = m.group(1).toUpperCase(Locale.US); }
        Set<String> exact = new LinkedHashSet<>(), repairedCodes = new LinkedHashSet<>();
        Matcher visible = visiblePattern.matcher(text);
        while (visible.find()) {
            String code = visible.group(1).toUpperCase(Locale.US);
            if (exactShape.matcher(code).matches()) exact.add(code);
            else { String fixed = repaired(code); if (!fixed.isEmpty()) repairedCodes.add(fixed); }
        }
        if (!labelledCode.isEmpty()) {
            if (exactShape.matcher(labelledCode).matches()) exact.add(labelledCode);
            else { String fixed = repaired(labelledCode); if (!fixed.isEmpty()) repairedCodes.add(fixed); }
        }
        String p = prefix();
        if (exact.size() == 1) {
            String code = exact.iterator().next();
            for (String other : repairedCodes) if (!other.equals(code)) return new Reading(p + code, true, fill(note("disagree"), "code", code, "other", other));
            return new Reading(p + code, false, "");
        }
        if (exact.size() > 1) {
            String first = exact.contains(labelledCode) ? labelledCode : exact.iterator().next();
            return new Reading(p + first, true, fill(note("different"), "codes", String.join(", ", exact)));
        }
        if (repairedCodes.size() == 1) {
            String code = repairedCodes.iterator().next();
            return new Reading(p + code, true, fill(note("repaired"), "code", code));
        }
        if (repairedCodes.size() > 1) return new Reading(p + repairedCodes.iterator().next(), true, fill(note("repairedMany")));
        if (!labelledCode.isEmpty() || visiblePattern.matcher(text).find()) return new Reading("", true, fill(note("unclear")));
        return new Reading("", true, "");
    }

    /** True when a typed model code has this brand's code shape. A brand without a shape accepts nothing as "verified" (free text, to be checked). */
    boolean looksLikeCode(String typed) {
        if (typed == null || !model.has("editShape")) return false;
        return Pattern.compile(model.optString("editShape"), Pattern.CASE_INSENSITIVE).matcher(typed).find();
    }

    // ---- IMEI rules ------------------------------------------------------------------------------------------------------------------------

    /**
     * The "shared digits" rule: among decoded barcodes, the one that is THIS device's IMEI 1 when the rule applies: checksum-valid, not the anchor
     * (IMEI 2) itself, the digits from..to equal the anchor's, the digits before `from` different. Exactly one such barcode, or "".
     * Never computed from the anchor: the number is the barcode's own. The caller decides whether the rule may run (brand evidence, trust level).
     */
    static String sharedDigitsCounterpart(Rule rule, String anchor, Iterable<String> barcodes) {
        if (rule == null || !ImeiSource.luhn(anchor)) return "";
        Set<String> found = new HashSet<>();
        for (String value : barcodes) {
            if (!ImeiSource.luhn(value) || value.equals(anchor)) continue;
            if (value.substring(rule.from, rule.to).equals(anchor.substring(rule.from, rule.to)) && !value.substring(0, rule.from).equals(anchor.substring(0, rule.from))) found.add(value);
        }
        return found.size() == 1 ? found.iterator().next() : "";
    }

    Iterator<Rule> rules() { return rules.iterator(); }
}
