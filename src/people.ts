// Pure rules for moving and deleting IMEI records between people.
//
// Every record has exactly one owner (personId), so "Everyone" is simply all records and
// can never list the same record twice. UNASSIGNED ('') means no person owns the record;
// it still shows under Everyone.
export const UNASSIGNED = '';
/** Filter value that shows only records with no owner. */
export const UNASSIGNED_FILTER = 'none';

type Owned = { id: string; personId: string; imei?: string };
const validImei = (value?: string) => !!value && /^\d{15}$/.test(value);

export type MovePlan<T> = {
  records: T[];
  /** Records that changed owner. */
  moved: string[];
  /** Records left where they were because the same IMEI already exists under the destination. */
  blocked: string[];
  /** Records that already belonged to the destination. */
  alreadyThere: string[];
  /** People who had records before this move and have none now. */
  emptiedSources: string[];
};

/**
 * Move records to another person (or to UNASSIGNED). The previous owner loses them
 * automatically. A record is never moved when the destination already holds the same
 * IMEI, so a move cannot create a duplicate.
 */
export function planMove<T extends Owned>(records: T[], ids: Iterable<string>, destination: string): MovePlan<T> {
  const wanted = new Set(ids);
  const moved: string[] = [], blocked: string[] = [], alreadyThere: string[] = [];
  const present = new Set<string>();
  for (const record of records) if (record.personId === destination && validImei(record.imei)) present.add(record.imei!);
  for (const record of records) {
    if (!wanted.has(record.id)) continue;
    if (record.personId === destination) { alreadyThere.push(record.id); continue; }
    if (validImei(record.imei) && present.has(record.imei!)) { blocked.push(record.id); continue; }
    if (validImei(record.imei)) present.add(record.imei!);
    moved.push(record.id);
  }
  const movedSet = new Set(moved);
  const next = records.map(record => movedSet.has(record.id) ? { ...record, personId: destination } : record);
  const sources = new Set(records.filter(record => movedSet.has(record.id)).map(record => record.personId));
  const emptiedSources = [...sources].filter(person => person !== UNASSIGNED && !next.some(record => record.personId === person));
  return { records: next, moved, blocked, alreadyThere, emptiedSources };
}

/** "Delete" while viewing one person: the record leaves that person and stays under Everyone as unassigned. */
export function planUnassign<T extends Owned>(records: T[], ids: Iterable<string>, fromPerson: string): { records: T[]; moved: string[] } {
  const wanted = new Set(ids);
  const moved = records.filter(record => wanted.has(record.id) && record.personId === fromPerson && fromPerson !== UNASSIGNED).map(record => record.id);
  const movedSet = new Set(moved);
  return { records: records.map(record => movedSet.has(record.id) ? { ...record, personId: UNASSIGNED } : record), moved };
}

/** What a person view shows: 'All' = Everyone (each record once), UNASSIGNED_FILTER = no owner, else that person. */
export function recordsForFilter<T extends Owned>(records: T[], filter: string): T[] {
  const seen = new Set<string>();
  return records.filter(record => {
    if (seen.has(record.id)) return false;
    seen.add(record.id);
    return filter === 'All' || (filter === UNASSIGNED_FILTER ? record.personId === UNASSIGNED : record.personId === filter);
  });
}

/** True when the current view is one real person (delete there means unassign, not remove). */
export const isPersonView = (filter: string) => filter !== 'All' && filter !== UNASSIGNED_FILTER;

/**
 * Delete a person. Their phones either move to UNASSIGNED (kept, nothing lost) or are removed with them.
 * "affected" lists the phones that belonged to the person.
 */
export function planDeletePerson<T extends Owned>(records: T[], personId: string, deletePhones: boolean): { records: T[]; affected: string[] } {
  const affected = records.filter(record => record.personId === personId).map(record => record.id);
  const set = new Set(affected);
  return { records: deletePhones ? records.filter(record => !set.has(record.id)) : records.map(record => set.has(record.id) ? { ...record, personId: UNASSIGNED } : record), affected };
}

/** Next free "Person N" number, so a deleted person's label is never handed out twice. */
export function nextPersonNumber(labels: string[]): number {
  return labels.reduce((highest, label) => Math.max(highest, Number(label.match(/(\d+)\s*$/)?.[1] || 0)), 0) + 1;
}
