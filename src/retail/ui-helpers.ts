// Shared by the RetailLens screens: the props every section receives, and small helpers. No React here, so the screens can import it freely.
import { itemFor, segmentOf } from './catalog';
import { emptyDay } from './data';
import { variantOf, type StockSource } from './inventory';
import { monthOf, type DateKey, type DayLog, type PeopleOp, type RetailState, type DeliveryPacket } from './types';

export type RetailRecord = StockSource & { name: string; createdAt?: string; imei2?: string; serial?: string; needsReview?: boolean };
export type RetailCtx = {
  state: RetailState;
  readOnly?: boolean;
  latest?: () => RetailState;
  /** Saves the new state. `why` is kept with the snapshot before it (Undo); '' = a trivial change, no snapshot. */
  change: (next: RetailState, why: string) => void;
  records: RetailRecord[];
  /** Records as they are right now, even in the middle of a multi-step task (`records` is a snapshot of the last screen draw). */
  latestRecords?: () => RetailRecord[];
  people: { id: string; name: string }[];
  today: DateKey;
  /** Sets the owner of phones (an approved Give, or its undo). */
  assign: (changes: { id: string; personId: string }[]) => boolean | void;
  /** The text of an image, read offline on the phone. */
  readImage: (file: File) => Promise<string>;
  counts: { scanning: number; needsReview: number };
  notify: (text: string) => void;
  /** A WhatsApp report shared to the app as text: opens Reports with it filled in. */
  sharedText?: string;
  /** The screen's Show all toggle (summary is the default). */
  expanded?: boolean;
  addPhones?: (rows:{id:string;imei:string;model:string;personId:string}[])=>boolean;
  archivePhones?: (ids:string[])=>boolean;
  /** Adds, renames or removes people (an approved assistant request, or its undo). False = nothing was changed. */
  editPeople?: (ops: PeopleOp[]) => boolean;
  /** The people as they are right now, even in the middle of a multi-step task (`people` is a snapshot of the last screen draw). */
  latestPeople?: () => { id: string; name: string }[];
  openPlan?: () => void;
  openHome?: () => void;
  openAssistant?: () => void;
  openDiagnostics?: () => void;
  openSettings?: () => void;
  openPeople?: () => void;
  openModels?: () => void;
  openTargets?: () => void;
  openScan?: () => void;
  openReport?: () => void;
  openAccessoryReport?: () => void;
  reportCategory?: 'phones' | 'accessories';
  openDatedReport?: (date: string) => void;
  reportDate?: string;
  reportAvailability?: boolean;
  reportIMEICalendar?: boolean;
  openIMEICalendar?: () => void;
  openAvailability?: () => void;
  openUploads?: (date: string, personId: string) => void;
  shareFile?: (blob: Blob, name: string, title: string, text?: string) => Promise<boolean>;
  openDelivery?: (packet: DeliveryPacket) => void;
  sharePhones?: (ids: string[]) => void;
  modelSources?: { code: string; name: string }[];
  saveModelName?: (code: string, name: string) => boolean;
  resetModelName?: (code: string) => boolean;
  openModelSources?: () => void;
  /** Shows these phones in Records (a filter such as `day:2026-11-15`). */
  openRecords: (filter: string) => void;
  download: (blob: Blob, name: string) => void;
  share: (text: string) => void;
  /** Opens WhatsApp with this text ready: the person chooses the chat and presses send. */
  whatsapp?: (text: string) => void;
};

export const num = (value: string) => Math.max(0, Math.floor(Number(value) || 0));
export const who = (ctx: Pick<RetailCtx, 'people'>, id: string) => (id ? ctx.people.find(p => p.id === id)?.name || 'Unnamed' : 'Unassigned');
export const last4 = (imei: string) => `…${imei.slice(-4)}`;
export const timeOf = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
export const updateDay = (state: RetailState, date: DateKey, fn: (day: DayLog) => DayLog): RetailState => ({ ...state, days: { ...state.days, [date]: fn(state.days[date] || emptyDay()) } });

/** What a sale records about a phone: model name, segment this month, memory and colour (from the person's edit or the label). */
export const sellDetails = (ctx: Pick<RetailCtx, 'state' | 'today'>, record: Pick<StockSource, 'id' | 'model' | 'raw'>) => {
  const item = itemFor(ctx.state, record.model), v = variantOf(ctx.state, record);
  return { modelName: item?.name || record.model || 'Unknown model', segment: segmentOf(ctx.state, record.model, monthOf(ctx.today), ctx.state.recordMeta[record.id]), ram: v.ram, storage: v.storage, color: v.color };
};
