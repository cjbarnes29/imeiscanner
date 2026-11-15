# Collecting verified label samples for a new brand (Apple first)

A brand profile is activated only from **what real labels show**. `profiles/apple.json` is a **draft** (inactive, no evidence words, no model grammar, no rules). Nothing about Apple labels is assumed in the code.

## What is needed: 20 varied samples per brand
Varied means: different models and storage sizes, both box sides if two labels exist, new and refurbished boxes, sharp and slightly blurry, with and without plastic glare, single and several boxes in one photo, one cut-off example. At least **20 labels**, of which at least 10 sharp ones for the evidence.

## How to provide them (no phone automation, nothing leaves your machine)
1. Photograph the labels with the phone as usual, or take the photos you already have. Keep them out of Git (`test-photos/` is ignored).
2. Scan them in **IMEI Lens Test**. The scanner already records, per label, the brand decision (`generic` + "brand unclear" while Apple is a draft).
3. For each photo write one line in a private, git-ignored `test-photos/apple-truth.json`: `{ "<file>.jpg": { "labels": N, "imei1": ["…15 digits…"], "model": "<the code printed on the label>" } }`. Real numbers stay in that file only.
4. Send me the **masked** list (first 8 + last 4 digits) and which words/codes you can see on each label (for example the words printed next to the IMEI lines, the model or regulatory code format). Do not send photos unless you decide to.

## What I do with them (each step verified before the next)
1. From the 20 labels, list the words and code shapes that appear on **every** Apple label and on no Samsung label; those become `evidence`. Anything seen on fewer than 20 stays out.
2. Write the model grammar from the observed code formats; add only the OCR repairs that real misreads showed.
3. IMEI lines: record how the labels name them (for example "IMEI/MEID", "IMEI2"); **no relationship between IMEI 1 and IMEI 2 is assumed** (the Samsung shared-digit rule is not reused unless the labels show it, and then as its own rule, trust "observed", always flagged).
4. Add `brands/conformance/apple.json` (synthetic examples from the observed formats), run the cross-brand test (every brand's rules on every other brand's labels must change nothing), then the real-photo truth check: exact IMEI 1 counts, zero wrong, zero silent losses.
5. Only then set `"status": "active"`. Samsung accuracy (19/21 real set, 12/12 labelled) must be identical before and after.

## Status
Apple: draft, **0 of 20** samples collected. The same process applies to Google Pixel, Xiaomi, OPPO and vivo.
