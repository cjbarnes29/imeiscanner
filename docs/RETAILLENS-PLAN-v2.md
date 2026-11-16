# RetailLens plan v2 (BUILT 2026-11-16, not committed)

Approved and built on 2026-11-16. Status: logic (`src/retail/stockreport.ts`, `reconcile.ts`, `segments.ts`, level arithmetic in `targets.ts`), screens (`RetailReport.tsx`, `RetailTargets.tsx`, simplified Gives, Today) and tests are done: `npm test` (includes `scripts/test-retail-v2.mjs`), `scripts/e2e-retail.mjs` (20 checks) and emulator scenario `e2e/scenarios/21-retail-report.mjs` (9 checks) pass. Not yet verified on a real phone or with the user's real report. Nothing committed, pushed or released.
Interface mockup (private page): https://claude.ai/artifact/YHgpKKBwqpwqPPC3mjviaY

## Principle
One pasted WhatsApp report, checked against the phones the user scanned. Nothing changes by itself: the app marks differences, the user decides, the app only suggests.

## Decisions
| Topic | Decision |
|---|---|
| Report line | `Model storage : sold/stock`, next line `(colour counts) colour names`. First number = sold, second = stock; colour counts add up to stock. Bracket counts can also be per storage (S26 lines). |
| Source of truth | Scanned phones (exact model, storage, RAM, colour) are the evidence. Report abbreviations are resolved from them first, the Samsung catalog second. |
| Differences | Neither the report nor the scans change by themselves. Lines are marked (`!` differ, `?` unknown) and the user chooses. |
| Colours | Editable per line, with a check that colours add up to stock. A scanned colour missing from the report is pointed out, not added automatically. |
| Total sellout | Can include phones not in the list. Warn when it differs from the list sum, with a button "Includes phones not listed" to dismiss. |
| Other brands, shifts | Plain text, copied back unchanged. |
| Copy out | Date set to today. "New day" button resets sold to 00, keeps stock. |
| Remembered corrections | A correction or abbreviation is remembered for the next report (default on). |
| Sold per person | The person's own count, set with a stepper (and +1 for sales outside the app). Never read from the report. Pasting a report never changes it. |
| No automation | No Sold button, no automatic stock update, no Stock tab. Old stock data stays in backups. |
| Targets | One tab. Month and person pickers. Level chips 70 80 90 100 110 120 at the top: the tapped level applies to every segment line. One line per segment (Fold 1, Fold 2, Fold 3, Flagship 1...), tap a line for each person: target, sold stepper, pieces needed at the level and per day (days left include today, rounded up to 0.1). The pieces needed at each level are typed once per person and segment (copied from the Promoter screen); not guessed. |
| Segments | The user's own list: add, rename, reorder, delete. Models are assigned by ticking them from the Samsung catalog. A model shows which segment it is already in. Models with no segment are listed until placed. |
| Gives | Suggestions only, one list with a short reason, Approve and Skip. Rule unchanged: user's own target first, then people under 70%, then the rest. |
| Incentive example rates | Removed from the plan. |

## Build order (when approved to start)
1. Read the report format (store level), tolerate typos like `0p`; compare with scanned phones; resolve abbreviations.
2. Review list and line sheet (evidence, colour counts, remembered abbreviations, Save).
3. Segments editor, then Targets lines with level chips.
4. Per-person screen with sold stepper and Edit levels.
5. Simple Gives; remove Stock tab and Sold automation; Copy report and New day.
6. Tests on a synthetic copy of the report (no real names or numbers), browser and emulator, screenshots.
7. Checkpoint zip. Commit and push only when the user says so.

## Open choices (defaults used unless the user says otherwise)
- Colour a scan shows but the report lacks: point out, do not add.
- Segments needed at first start: none preset except the user's own; Fold 1 = Z Fold8 Ultra as an example.
- The Sold stepper is the only way to count a person's sales.

## Known limits
- Real Promoter screenshot and real report formats are only known from the user's sample.
- Not verified on a real phone; emulator was unstable.
