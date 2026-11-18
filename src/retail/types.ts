/**
 * RetailLens data model. IMEI Lens stays the scanning engine (records, photos, people); everything here is kept apart from the scan records, under its
 * own "retail:" keys, and refers to records only by id / IMEI. Nothing in this folder touches a picture or changes a scan record.
 */
/** A segment id. The built-in ones below are only the starting list: the person makes their own (Fold 1, Fold 2…) in Retail > Segments. */
export type Segment = string;
/** The segments a new install starts with ('other' = not classified yet: it is shown for review and counts toward no target). */
export const SEGMENTS: Segment[] = ['flagship1', 'flagship2', 'flagship3', 'mid', 'low', 'tablet', 'wearable'];
export const SEGMENT_LABEL: Record<Segment, string> = {
  flagship1: 'Flagship 1', flagship2: 'Flagship 2', flagship3: 'Flagship 3', mid: 'Mid', low: 'Low', tablet: 'Tablet', wearable: 'Wearables', other: 'Unclassified'
};
export const isSegment = (value: unknown): value is Segment => typeof value === 'string' && value.length > 0 && value.length <= 40;
/** A segment the person made or renamed (the starting ones keep their built-in name unless renamed). */
export type SegmentDef = { id: Segment; name: string };

/** The levels of a target the person can look at: how many pieces are needed to reach each one. */
export type Level = 70 | 80 | 90 | 100 | 110 | 120;
export const LEVELS: Level[] = [70, 80, 90, 100, 110, 120];

/** 'YYYY-MM' and 'YYYY-MM-DD' in the phone's own time (a sale made at 23:50 belongs to that day). */
export type Month = string;
export type DateKey = string;
const two = (n: number) => String(n).padStart(2, '0');
export const dateKey = (date: Date = new Date()): DateKey => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
export const monthOf = (key: DateKey | Date): Month => (typeof key === 'string' ? key : dateKey(key)).slice(0, 7);
/** The phone's local day of a stored time (records keep UTC times; an upload at 23:50 belongs to that day, not the next UTC day). '' when it is not a time. */
export const localDay = (iso?: string): DateKey => { const d = new Date(iso || ''); return Number.isNaN(d.getTime()) ? '' : dateKey(d); };
export const isDateKey = (value: unknown): value is DateKey => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`), [year, month, day] = value.split('-').map(Number);
  return !Number.isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() + 1 === month && d.getDate() === day;
};
export const isMonth = (value: unknown): value is Month => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
/** Days in a month and days left in it counting today (never below 1 while the month is running, 0 after it ended). */
export function daysInMonth(month: Month): number { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); }
export function daysLeft(month: Month, today: DateKey): number {
  if (monthOf(today) < month) return daysInMonth(month);
  if (monthOf(today) > month) return 0;
  return daysInMonth(month) - Number(today.slice(8, 10)) + 1;
}

export type Variant = { sku: string; ram: string; storage: string; colors: string[] };
export type CatalogItem = {
  /** Four-character model code shared by every region and colour: "A176" for SM-A176B. */
  code: string;
  name: string;
  /** Short name used in WhatsApp reports: "A17 5G". */
  abbreviation: string;
  segment: Segment;
  /** A model can move to another segment for one month (Samsung changes them): month -> segment. */
  monthly: Record<Month, Segment>;
  variants: Variant[];
  /** Made or changed by the person (kept), as opposed to the built-in list. */
  custom: boolean;
};

/** `status`: a phone the person marked as no longer in stock ('sold' / 'given'). Without it a scanned phone counts as in stock. */
export type RecordMeta = { segment?: Segment; ram?: string; storage?: string; color?: string; status?: 'sold' | 'given' | 'held' };

/** A confirmed sale. A sale is attributed to the person who owned the phone when it was confirmed; see sales.ts for the rules. */
export type Sale = {
  id: string; recordId: string; imei: string; model: string; modelName: string; ram: string; storage: string; color: string;
  segment: Segment; personId: string; date: DateKey; month: Month;
  submitted: boolean; submittedAt?: string;
  /** 'owner' = confirmed by the owner of the phone; 'approved' = attributed to someone else after an explicit approval (with a reason). */
  attributedBy: 'owner' | 'approved'; reason?: string;
  voided?: boolean; voidedAt?: string; createdAt: string;
};

/** `achieved` is the person's own sold count; `levels` = the pieces needed IN TOTAL at each level, typed from the Promoter screen (blank = target x level, rounded up). */
export type TargetLine = { segment: Segment; target: number; achieved: number; levels?: Partial<Record<Level, number>>; /** The highest level this line counts (some segments stop at 100 %): asking for more shows this level instead. Missing = no limit. */ cap?: Level };
export type PersonTarget = { personId: string; month: Month; lines: TargetLine[]; source: 'screenshot' | 'manual'; importedAt: string; note?: string };

export type IncentiveRates = { perUnit: Record<Segment, number>; multiplier: { 70: number; 100: number; 120: number }; currency: string };

export type AllocationItem = { recordId: string; imei: string; segment: Segment; from: string; to: string };
/** What one person may be given a day: at least `min` (when there are phones), at most `max` (blank = no limit); `off` = leave this person out of suggestions and automatic gives. */
export type GiveLimit = { min?: number; max?: number; off?: boolean };
export type AllocationEvent = { id: string; at: string; month: Month; source: 'recommended' | 'manual' | 'auto'; items: AllocationItem[]; status: 'applied' | 'undone'; undoneAt?: string; note?: string };

export type DayLog = {
  activations: number; scPlus: number;
  competitor: { brand: string; model: string; qty: number }[];
  shifts: { person: string; shift: string }[];
  checklist: Record<string, boolean>;
  custom: { id: string; text: string; done: boolean }[];
};

export type StockAdjust = { id: string; at: string; date: DateKey; code: string; name: string; storage: string; color: string; delta: number; note: string };

export type ReportSection = { key: 'sellout' | 'stock' | 'activations' | 'scplus' | 'competitor' | 'shifts' | 'total' | 'other'; heading: string; lines: string[] };
export type ReportTemplate = {
  /** The title line with {date} where the date goes, e.g. "*Daily Report {date}*". */
  title: string; dateFormat: 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'D MMM YYYY' | 'YYYY-MM-DD';
  sections: { key: ReportSection['key']; heading: string; bullet: string; sep: string; useAbbreviation: boolean; showColor: boolean; showStorage: boolean; qtyBefore: boolean; verbatim?: string[]; inline?: string }[];
  promoter?: string;
};

export type Audit = { at: string; what: string; detail: string };

/** One colour or storage count of a report line: "Vlt" with 2. count null = the number could not be read ("0p"). */
export type ReportPart = { label: string; count: number | null; raw: string };
/** A model line of the pasted report ("A07 64GB : 04/15") with the line under it ("(02,00,13) Vlt,Grn,Blk"). */
export type ReportItem = {
  t: 'item'; id: string; name: string; sold: number; stock: number; soldWidth: number; stockWidth: number;
  kind: 'colour' | 'storage' | 'none'; parts: ReportPart[]; sep: string; line1: string; line2: string;
  /** The person looked at this line and says it is settled, even if it still differs from the scanned phones. A new pasted report starts without it. */
  checked?: boolean;
  /** Made by the app from scanned phones (the model was not in the report), and how many scanned phones were added to this line since the report was pasted (negative = taken out). */
  auto?: boolean; scanAdded?: number;
};
/** Anything else in the report (header, ---- lines, totals, other brands, shifts) is kept as typed. */
export type ReportText = { t: 'text'; text: string };
export type StockReport = {
  /** Identifies this report period so undo never subtracts from a newer day's report. */
  releaseRevision?: string;
  entries: (ReportItem | ReportText)[];
  /** The "Total Sellout" the report states, and whether the person said it includes phones that are not in the list (extra = the difference). */
  totalSellout?: { typed: number; acknowledged: boolean; extra: number };
  savedAt: string;
  dateText?: string;
  /** The scanned phones in stock when the report was pasted (model | storage | colour -> count): phones scanned after that are added to the report. */
  scanBase?: Record<string, number>;
};

/** What the person typed or taught for one model: its colour names, and what a report abbreviation means (key = letters of the abbreviation, lower case). */
export type ModelColours = { names: string[]; aliases: Record<string, string> };

/** A phone that was marked Sold and already counted in the targets and the report (see soldsync.ts). */
export type SoldEntry = { personId: string; segment: Segment; month: Month; code: string; storage: string; /** the day it was counted (missing = counted before days were kept) */ date?: string };

export type PlanMethod = 'goal' | 'points' | 'spread' | 'milestones' | 'stored' | 'quantity';
export type PlanRequest = { personId: string; segments: Segment[]; method: PlanMethod; value: number; date: DateKey; until: DateKey; reserve: number; dailyLimit?: number; skipDays: number[]; priority: 'lowest' | 'nearest'; milestones: { date: DateKey; percent: number }[]; quantityMode?: 'calculated' | 'manual'; manualDaily?: Record<DateKey, Record<Segment, number>>; skipDates?: DateKey[]; goalUnits?: Record<Segment, number>; coverageBase?: Record<Segment, number>; goalBaseTargets?: Record<Segment, number> };
export type ReleasePlan = { id: string; createdAt: string; calculatedFor?: DateKey; request: PlanRequest; fingerprint: string; entries: { id: string; date: DateKey; segment: Segment; recordIds: string[]; required: number; before: number; target: number; goal: number; status: 'scheduled' | 'released' | 'cancelled'; releaseId?: string }[] };
export type ReleaseEvent = { id: string; at: string; date: DateKey; personId: string; segment: Segment; recordIds: string[]; reportedIds: string[]; reportLinks?: Record<string, string>; details: Record<string, SoldEntry>; status: 'released' | 'undone'; undoneAt?: string };
export type AvailabilityWindow = { id: string; start: DateKey; end: DateKey; available: boolean; startTime?: string; endTime?: string; source?: string; code?: string };
export type ShiftCode = { code: string; name: string; available: boolean; periods: { start: string; end: string }[]; needsReview?: boolean };
export type RosterEntry = { id: string; personId: string; personText: string; start: string; end: string; available: boolean | null; startTime: string; endTime: string; code: string; source: string };
export type RosterDraft = { id: string; sourceId?: string; sourceName: string; month: string; order: 'DMY' | 'MDY'; entries: RosterEntry[]; codes: ShiftCode[]; warnings: string[]; targetMode: 'manual' | 'linked'; requireSchedule: boolean; status: 'pending' | 'applied' | 'rejected'; at: string };
export type DeliverySetting = { enabled: boolean; destination: 'mobile' | 'group'; phone: string; includeReport: boolean; includeImeis: boolean; reportMode: 'all' | 'quantity'; quantities: Record<Segment,number> };
export type DeliveryPacket = { id: string; at: string; personId: string; phone: string; destination: 'mobile' | 'group'; releaseIds: string[]; recordIds: string[]; reportIds: string[]; text: string; fingerprint?: string; status: 'prepared' | 'opened' | 'sent-by-user' | 'not-sent' };
export type WorkSchedule = { requireSchedule?: boolean; windows?: AvailabilityWindow[]; targetMode?: 'manual' | 'linked'; calculationDays?: Record<Month, number>; offDivisor?: Record<Month, number>; leaveDivisor?: Record<Month, number>; offWeekdays: number[]; offDates: DateKey[]; annualLeave: { id: string; start: DateKey; end: DateKey }[] };
export type LeaveTransfer = { id: string; personId: string; start: DateKey; end: DateKey; createdAt: string; status: 'active' | 'cancelled' | 'draft'; adjustmentsApplied?: boolean; targetSnapshots?: Record<string, Record<Segment, { target: number; levels?: TargetLine['levels']; appliedLevels?: TargetLine['levels'] }>>; monthDays?: number; leaveDays?: number; divisor?: number; segments: { segment: Segment; total: number; shares: { personId: string; units: number }[] }[] };

export type RetailState = {
  version: 1;
  /** Additive v2 workflow fields; absent on older backups. Scanner records and photos stay untouched. */
  planningVersion?: 1;
  releasePlans?: ReleasePlan[];
  releases?: ReleaseEvent[];
  pendingUploadIds?: string[];
  localAI?: { enabled: boolean };
  reportDrafts?: Record<DateKey, { report: StockReport; updatedAt: string; mode: 'auto' | 'manual' }>;
  storeTargets?: Record<Month, Record<Segment, number>>;
  workSchedules?: Record<string, WorkSchedule>;
  shiftCodes?: ShiftCode[];
  scheduleReview?: { from?: DateKey; through: DateKey; at: string; fingerprint: string };
  rosterSources?: { id: string; name: string; type: string; bytes: number; at: string }[];
  rosterDrafts?: RosterDraft[];
  finalReportDraft?: { text: string; baseText: string; at: string };
  /** Accessories/tablets/wearables OSR is manual and isolated from phone IMEI stock. */
  accessoryReport?: StockReport;
  accessoryStock?: Record<string, { name: string; quantity: number; updatedAt: string; reportDate?: string }>;
  accessoryFinalDraft?: { text: string; baseText: string; at: string };
  deliverySettings?: Record<string,DeliverySetting>;
  deliveryPackets?: DeliveryPacket[];
  leaveTransfers?: LeaveTransfer[];
  catalog: CatalogItem[];
  /** The sales already counted (record id -> who, which segment, which month, which model): a phone is never counted twice, and taking it back undoes it. */
  soldLedger?: Record<string, SoldEntry>;
  /** What a report abbreviation means for every model (key = letters of the abbreviation, lower case): taught once, used everywhere. A model's own entry wins. */
  colourAliases?: Record<string, string>;
  /** Colours of each model, by model code. */
  colours?: Record<string, ModelColours>;
  /** The person's own segments (Fold 1, Fold 2…). Missing = the starting list. */
  segments?: SegmentDef[];
  /** Who a Promoter screenshot or pasted text is for: the name or ID printed on it (lower case) -> person id. Learned when a person confirms an import. */
  targetAliases?: Record<string, string>;
  /** What the report calls a model: normalised report name -> catalog model code. Learned when a line is saved ("remember"). */
  aliases: Record<string, string>;
  /** The last saved pasted report (stock and sold of the store). The one before it is in the Undo snapshots. */
  report?: StockReport;
  /** Verified corrections to remember: model code -> segment (a person changed it, so the app learns it). */
  corrections: Record<string, Segment>;
  recordMeta: Record<string, RecordMeta>;
  sales: Sale[];
  targets: Record<Month, Record<string, PersonTarget>>;
  rates: IncentiveRates;
  allocations: AllocationEvent[];
  /** 'auto' = phones that need an owner are given by themselves (each give is in the history and can be undone). Missing = suggestions only. */
  giveMode?: 'suggest' | 'auto';
  /** Per person: minimum and maximum phones a day, and whether the person is left out. */
  giveLimits?: Record<string, GiveLimit>;
  days: Record<DateKey, DayLog>;
  stockAdjust: StockAdjust[];
  template?: ReportTemplate;
  settings: { myPersonId: string; myThreshold: 70 | 100 | 120; lowStock: number; reportAuthor: string };
  /** Closed months, kept for history: the targets, sales count and incentives as they were. */
  history: Record<Month, { closedAt: string; targets: Record<string, PersonTarget>; sales: number; byPerson: Record<string, number> }>;
  audit: Audit[];
};
