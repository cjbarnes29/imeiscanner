import { localDay } from './types';
import { luhnValid } from '../imei-validate';
import type { RetailRecord } from './ui-helpers';
export function dailyUploads(records: RetailRecord[], date: string, personId = 'all') {
  const rows = records.filter(r => localDay(r.createdAt) === date && (personId === 'all' || r.personId === personId));
  const unique = (list: RetailRecord[]) => new Set(list.filter(r => !r.duplicate && luhnValid(r.imei)).map(r => r.imei)).size;
  return { rows, quantity: unique(rows), duplicates: rows.filter(r => r.duplicate).length, review: rows.filter(r => r.needsReview || !luhnValid(r.imei)).length, people: [...new Set(rows.map(r => r.personId))].map(id => ({ personId: id, rows: rows.filter(r => r.personId === id), quantity: unique(rows.filter(r => r.personId === id)), models: [...new Set(rows.filter(r => r.personId === id).map(r => r.model))].map(model => ({ model, rows: rows.filter(r => r.personId === id && r.model === model), quantity: unique(rows.filter(r => r.personId === id && r.model === model)) })) })) };
}
