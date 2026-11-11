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

export type Allocation = { personId: string; count: number };
export type AllocationPlan<T> = {
  records: T[];
  /** How many phones each person ends up with from this set (UNASSIGNED included). */
  given: Record<string, number>;
  /** Phones that changed owner. */
  moved: string[];
  /** Phones left where they were because the destination already holds the same IMEI. */
  blocked: string[];
  /** People who had phones from this set before and have none left in the whole list. */
  emptiedSources: string[];
};

/**
 * Hand a set of phones (for example every phone of one model) out in amounts: "3 to Carlou, 4 to Raseen,
 * 2 to Khurram". Whatever is not given to someone becomes UNASSIGNED. A person keeps the phones they
 * already have first, so unchanged amounts change nothing. A phone is never moved onto a person who
 * already holds the same IMEI.
 */
export function planAllocation<T extends Owned>(records: T[], ids: Iterable<string>, allocations: Allocation[]): AllocationPlan<T> {
  const wanted = new Set(ids);
  const ordered = records.filter(record => wanted.has(record.id));
  const owner = new Map(ordered.map(record => [record.id, record.personId]));
  const left = ordered.map(record => record.id);
  const destination = new Map<string, string>();
  const take = (id: string, person: string) => { destination.set(id, person); left.splice(left.indexOf(id), 1); };
  const wants = allocations.filter(item => item.count > 0 && item.personId !== UNASSIGNED);
  for (const { personId, count } of wants) {
    let remaining = Math.floor(count);
    for (const id of [...left]) if (remaining > 0 && owner.get(id) === personId) { take(id, personId); remaining--; }
  }
  for (const { personId, count } of wants) {
    const have = [...destination.values()].filter(value => value === personId).length;
    let remaining = Math.max(0, Math.floor(count) - have);
    for (const id of [...left]) if (remaining > 0) { take(id, personId); remaining--; }
  }
  for (const id of [...left]) take(id, UNASSIGNED);

  let next = records;
  const moved: string[] = [], blocked: string[] = [], emptied = new Set<string>();
  const given: Record<string, number> = {};
  for (const person of new Set(destination.values())) {
    const group = [...destination].filter(([, value]) => value === person).map(([id]) => id);
    const plan = planMove(next, group, person);
    next = plan.records;
    moved.push(...plan.moved); blocked.push(...plan.blocked);
    given[person] = group.length - plan.blocked.length;
    plan.emptiedSources.forEach(id => emptied.add(id));
  }
  const emptiedSources = [...emptied].filter(person => !next.some(record => record.personId === person));
  return { records: next, given, moved, blocked, emptiedSources };
}

export type ReviewHolder = { name: string; count: number; numbers: string[] };
export type ReviewModel = { label: string; holders: ReviewHolder[] };

/** Model by model: "Galaxy A37 5G (6)" then "Carlou × 2" per person, optionally with each phone's numbers underneath. */
export function formatModelReview(models: ReviewModel[], includeNumbers: boolean): string {
  return models.filter(model => model.holders.length).map(model => {
    const total = model.holders.reduce((sum, holder) => sum + holder.count, 0);
    const lines = [`${model.label} (${total})`];
    for (const holder of model.holders) {
      lines.push(`${holder.name} × ${holder.count}`);
      if (includeNumbers) for (const number of holder.numbers) lines.push(`  ${number}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

export type ShareSection = { name: string; items: { label: string; count: number; numbers: string[] }[] };

/** What one person is sent: their name, then each model with its IMEI / serial numbers (plain lines, no numbering). */
export function formatPersonShare(sections: ShareSection[]): string {
  return sections.filter(section => section.items.length).map(section => {
    const total = section.items.reduce((sum, item) => sum + item.count, 0);
    const lines = [`${section.name} (${total})`];
    for (const item of section.items) { lines.push(`${item.label} (${item.count})`); lines.push(...item.numbers); }
    return lines.join('\n');
  }).join('\n\n');
}
