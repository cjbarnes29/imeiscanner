# src/retail

Pure-logic modules for the RetailLens side of the app: stock, sales, targets, segments, colours, stock-report parsing and reconciliation, and backup. The React screens that use them live one level up (`../RetailHub.tsx`, `../RetailHub2.tsx`, `../RetailReport.tsx`, `../RetailTargets.tsx`). Parent index: [../README.md](../README.md).

## Interface

Current planning/calendar/report architecture and verified continuation status: [handoff](../../docs/HANDOFF-RELEASE-PLANNING.md).

`planning.ts` owns reservations and approved sale releases; `availability.ts` and `store-targets.ts` own editable calendars and balanced target adjustments; `availability-import.ts` / `shift-codes.ts` interpret reviewed shift proposals; `daily-uploads.ts` keeps upload counts separate from releases. `dated-reports.ts` handles projected report drafts. `delivery.ts` prepares messages only after sale approval and never claims external delivery. `accessory-report.ts` owns a separate tablet/accessory quantity register updated only by approved absolute report snapshots. All new fields are additive and cleaned on backup restore. Roster originals live under `retail:roster-file:`, never scanner record keys.

Most functions take a `RetailState` and return a new one. They do not mutate their input.

| File | Public symbols |
| --- | --- |
| `types.ts` | Shared types: `RetailState`, `Segment`, `SegmentDef`, `Level`, `Month`, `DateKey`, `CatalogItem`, `Variant`, `RecordMeta`, `Sale`, `TargetLine`, `PersonTarget`, `IncentiveRates`, `AllocationItem`, `AllocationEvent`, `DayLog`, `StockAdjust`, `ReportSection`, `ReportTemplate`, `ReportItem`, `ReportPart`, `ReportText`, `StockReport`, `ModelColours`, `SoldEntry`, `Audit`. Constants and helpers: `SEGMENTS`, `SEGMENT_LABEL`, `LEVELS`, `isSegment`, `dateKey`, `monthOf`, `localDay`, `isDateKey`, `isMonth`, `daysInMonth`, `daysLeft`. |
| `data.ts` | `DEFAULT_RATES`, `emptyDay`, `emptyState`, `cleanState`, `withAudit`, `rollover`, `makeBackup`, `readBackup`, `restoreBackup`; types `LedgerEntry`, `Backup`, `BackupCheck`. |
| `retail-store.ts` | `loadRetail`, `saveRetail`, `listSnapshots`; type `Snapshot`. |
| `catalog.ts` | `guessSegment`, `defaultAbbreviation`, `fullCatalog`, `itemFor`, `segmentOf`, `saveItem`, `resetItem`, `setModelSegment`, `inferVariant`, `setRecordMeta`, `currentMonth`. |
| `segments.ts` | `defaultSegments`, `segmentDefs`, `segmentIds`, `segLabel`, `addSegment`, `renameSegment`, `moveSegment`, `deleteSegment`, `modelsOf`, `assignModels`. |
| `colours.ts` | `canonColour`, `colourScore`, `bestColour`, `modelColourNames`, `resolveColourWhy`, `resolveColour`, `suggestColours`, `teachColourEverywhere`, `addColours`, `teachColour`, `parseColoursText`, `coloursText`, `setModelColours`; type `ColourWhy`. |
| `colour-dictionary.ts` | `COLOUR_DICTIONARY`, `dictionaryExact`, `dictionaryNear`; type `DictColour`. |
| `colourlist.ts` | `reportColourLabels`; type `LabelRow`. |
| `inventory.ts` | `validImei`, `inStock`, `variantOf`, `stockRows`, `colorQuantities`, `stockAlerts`, `adjustStock`; types `StockSource`, `StockRow`, `StockAlert`. |
| `sales.ts` | `liveSales`, `isSold`, `confirmSale`, `voidSale`, `reattribute`, `setSubmitted`, `pendingSubmissions`, `soldByPerson`; types `SaleSource`, `SaleDetails`, `SaleResult`. |
| `soldsync.ts` | `syncSold`, `soldOnDay`. |
| `allocation.ts` | `recommend`, `gap(target, segment, threshold, holding, pending)`, `applyAllocation`, `undoAllocation`; types `AllocRecord`, `Proposal`, `Recommendation`, `ApplyResult`. |
| `targets.ts` | `parseTargetText`, `matchPerson`, `summarizeTarget`, `overallPct`, `emptyTarget`, `needAt`, `putTarget`, `prevMonth`, `suggestedLevels`, `lastMonthLine`, `startFromLastMonth`, `segmentInLine`, `repairNumber`, `repairText`, `monthInText`, `THRESHOLDS`; types `ParsedTargets`, `Threshold`, `LineSummary`, `TargetSummary`. |
| `targetsummary.ts` | `targetSummary`; types `SummaryPerson`, `SummaryRow`. |
| `dashboard.ts` | `pendingBySegment`, `submittedSince`, `todayDashboard`, `overallDashboard`; types `Priority`, `ChecklistItem`, `Dashboard`, `OverallLine`, `Overall`. |
| `report.ts` | The daily-report builder and parser: `formatDate`, `findDate`, `matchItemText`, `parseReport`, `buildReport`, `updateReport`, `DEFAULT_TEMPLATE`; types `ReportItem`, `ParsedSection`, `ParsedReport`, `ReportInput`. |
| `stockreport.ts` | The free-text stock report: `readCount`, `parseReport`, `reportItems`, `listedSold`, `partsSum`, `hasUnreadable`, `formatDateLike`, `itemLines`, `buildReport`, `acknowledgeTotal`, `updateItem`, `startNewDay`. |
| `reportsync.ts` | `scanCounts`, `withBaseline`, `syncScans`. |
| `reconcile.ts` | `reconcile`, `searchModels`, `teachAlias`, `nameKey`, `splitName`, `catalogIndex`, `matchModel`, and the re-exports `bestColour` and `colourScore` from `./colours`; types `IssueKind`, `Issue`, `Status`, `ScannedColour`, `LineResult`, `Reconciliation`. |
| `ui-helpers.ts` | `num`, `who`, `last4`, `updateDay`, `sellDetails`; types `RetailRecord`, `RetailCtx`. |

`report.ts` and `stockreport.ts` both export `parseReport` and `buildReport` (different signatures, different report formats), so import them by file.

## Invariants

- `types.ts` `Segment` is a plain `string`. `isSegment` accepts a non-empty string of 40 characters or fewer, and the defaults come from `SEGMENTS`. Custom segments are allowed.
- `DateKey` is `YYYY-MM-DD` (`isDateKey`) and `Month` is `YYYY-MM` (`isMonth`). `dateKey` uses the local date.
- `inventory.ts` `validImei` accepts only 15 digits (`/^\d{15}$/`). `inStock` counts only records that pass it.
- `sales.ts` `confirmSale` returns `{ ok: false, error: ... }` instead of throwing, and one error is `'no-owner'`. `liveSales` excludes voided sales.
- `data.ts` `readBackup` returns `{ ok: false, error }` for bad input. Valid backups have `app: 'RetailLens'` and `version: 1`.
- `retail-store.ts` keeps the latest 8 snapshots (`KEEP = 8`) under keys prefixed `retail:snapshot:`.
- `colours.ts` `resolveColourWhy` reports the source of a match as `'model' | 'taught' | 'fit' | 'dictionary'`.

## Side Effects

- Only `retail-store.ts` does I/O. It uses IndexedDB database `imei-lens-v2`, table `inventory`, with the state under key `retail:state` and snapshots under `retail:snapshot:`.
- Many functions default to the current time (`new Date()` as a default argument), and tests can pass the time in. Examples: `dateKey`, `withAudit`, `rollover`, `confirmSale`, `voidSale`, `reattribute`, `setSubmitted`, `adjustStock`, `makeBackup`, `restoreBackup`, `applyAllocation`, `undoAllocation`, `parseReport` (in `stockreport.ts`), `emptyTarget`, `currentMonth`. These and others default to the current time. Ids made in `sales.ts`, `allocation.ts`, `inventory.ts` and `reportsync.ts` also use `Date.now()`. `localDay` does not read the clock; it only converts the ISO string it is given.
- Everything else here is synchronous and does no I/O.

## Verification

From the repo root:

```bash
npm run typecheck
npm test            # includes scripts/test-retail.mjs and scripts/test-retail-v2.mjs
```
