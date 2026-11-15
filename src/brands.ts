import samsung from '../brands/profiles/samsung.json';
import generic from '../brands/profiles/generic.json';
import apple from '../brands/profiles/apple.json';
import { looksLikeModelCode, modelNote, type BrandProfile } from './brand-engine';

/** All profiles. Adding a brand = a new JSON file in brands/profiles plus one import here (and its conformance file). */
export const PROFILES: BrandProfile[] = [samsung, generic, apple];

type BrandRecord = { brand?: string; model?: string };

/** The profile of a record. Records saved before brands existed have no `brand`: an SM- model means Samsung, anything else is generic. */
export function brandOf(record: BrandRecord): BrandProfile {
  const byId = (id: string) => PROFILES.find(p => p.id === id) as BrandProfile;
  if (record.brand) return PROFILES.find(p => p.id === record.brand) || byId('generic');
  return /^SM-/i.test(record.model || '') ? byId('samsung') : byId('generic');
}

/** A typed model is accepted without a review mark when it has the brand's code shape; a generic record accepts any typed text (the person confirmed it). */
export function typedModelOk(record: BrandRecord, typed: string): boolean {
  const profile = brandOf(record);
  return profile.id === 'generic' ? typed.trim().length > 0 : looksLikeModelCode(profile, typed);
}

export const typedModelNote = (record: BrandRecord, typed: string): string => typedModelOk(record, typed) ? '' : modelNote(brandOf(record), 'editShape');
