/**
 * A rescan (the automatic retry, or "Scan again") that reads a label the first scan could not read must not leave a pair behind: the old
 * unreadable record and the new one. The Android scanner says, for each new record, which earlier unreadable record it stands for
 * ("replaces", only when that is certain: see ScanLedger.pairWithOld). This plans what the page does with those pairs. Pure: nothing here
 * touches storage, so it is unit-tested.
 *
 *   replace  the earlier record had no IMEI and nothing a person typed in its IMEI field: it is archived (Undo / Restore brings it back) and the
 *            new record takes its place, keeping the person it was given to, its number in the list and a serial a person may have typed;
 *   drop     the earlier record already holds an IMEI (typed or confirmed after the scan): the new row is not added, so nothing a person
 *            wrote is ever overwritten and no second record of the same label appears;
 *   flag     ...and when the rescan read a DIFFERENT IMEI 1 than the one the person kept, that record is marked for a look (never changed).
 */
export type PairRecord = { id: string; imei: string; personId: string; number: number; serial?: string; checked?: boolean;
  /** The number shown is IMEI 2 standing in for the unread IMEI 1 and nobody confirmed it: a new reading of IMEI 1 may replace this record. */
  fallback?: boolean };
export type PairAdded = { id: string; imei: string; replaces?: string };

export type PairPlan = {
  replace: { oldId: string; newId: string; inherit: { personId: string; number: number; serial?: string } }[];
  drop: string[];
  flag: { id: string; note: string }[];
};

export const DIFFERENT_READING_NOTE = 'The rescan read a different IMEI 1. Your number was kept; compare it with the label.';

export function planReplacements(existing: PairRecord[], added: PairAdded[]): PairPlan {
  const plan: PairPlan = { replace: [], drop: [], flag: [] };
  const byId = new Map(existing.map(record => [record.id, record]));
  const used = new Set<string>();
  for (const row of added) {
    const oldId = row.replaces;
    if (!oldId || used.has(oldId)) continue;
    const old = byId.get(oldId);
    if (!old) continue; // the earlier record is gone (deleted or already archived): the new one is simply added
    used.add(oldId);
    if (!old.imei.trim() || (old.fallback && !old.checked)) {
      plan.replace.push({ oldId, newId: row.id, inherit: { personId: old.personId, number: old.number, serial: old.serial?.trim() ? old.serial : undefined } });
      continue;
    }
    plan.drop.push(row.id);
    if (row.imei && row.imei !== old.imei) plan.flag.push({ id: old.id, note: DIFFERENT_READING_NOTE });
  }
  return plan;
}
