# brands

## Overview
Brand profiles: the data that tells the scanner how to recognise a phone maker from a label's own text and how to read its model code. The JSON files are the single source of truth read by both the web app (`src/brands.ts`, `src/brand-engine.ts`) and the Android app (as assets), so the two readers cannot drift. The only code here is the one-off generator `make-profiles.mjs`; the data folders contain no source files.

## Interface
- `make-profiles.mjs` - run `node brands/make-profiles.mjs`. Writes `profiles/samsung.json`, `profiles/generic.json` and `profiles/apple.json` from the object literals inside the script (so regex backslashes are escaped correctly). Convenience for the first write only; the JSON may be edited directly afterwards, and re-running the script overwrites those three files.
- `profiles/*.json` (data) - profile shape: `schema`, `id`, `name`, `status` (`active` | `draft`), `evidence` (`words`, `codeShapes`), `model` (`prefix`, regexes, `repairs`, `notes`) and `imeiRules`.
  - `samsung`: active; evidence word `SAMSUNG` and the `SM-xxxxx` code shape; one `shared-digits` IMEI rule (trust `observed`).
  - `generic`: active fallback with no brand rules.
  - `apple`: draft, inactive placeholder.
- `conformance/samsung.json` (data) - shared test cases. The file has 7 keys: `note`, `brand`, `evidence`, `modelReads`, `repairs`, `editShape`, `sameDeviceImei1`. The Java test (`BrandConformanceTest`) checks `evidence`, `modelReads`, `repairs`, `editShape` and `sameDeviceImei1`; the web test (`scripts/test-brand-conformance.mjs`) checks only `evidence` and `editShape`.
- [SAMPLES.md](./SAMPLES.md) - the process for collecting 20 verified label samples before a draft brand may become active.

## Invariants
- A draft profile never takes part in brand detection; a brand is activated only from what real labels show (see `SAMPLES.md`).
- Evidence is matched in the label's own text only (words whole-word and case-insensitive, code shapes case-sensitive).
- No IMEI 1 / IMEI 2 relationship is assumed for a new brand; any such rule must be its own rule with trust `observed`.
- Samsung accuracy must be identical before and after any profile change.
- Profile and conformance data must contain synthetic examples only, never real IMEIs.

## Side Effects
- `make-profiles.mjs` creates `brands/profiles/` if missing and overwrites the three profile files; it prints `wrote samsung, generic, apple`. No network access.
- None at runtime; the profile JSON is read (not written) by the web app, the Android app and `scripts/test-brand-conformance.mjs`.

## Verification
- Run: `node scripts/test-brand-conformance.mjs` (also part of `npm test` from the repository root).
