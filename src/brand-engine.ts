/**
 * Brand profiles on the web side. The profiles themselves are DATA (brands/profiles/<id>.json), shared with the Android scanner; this file only
 * evaluates them and names no brand. It is pure (no JSON import) so the conformance test can run it against the shared files.
 */
export type BrandProfile = {
  id: string; name: string; status: string;
  evidence?: { words?: string[]; codeShapes?: string[] };
  model?: { prefix?: string; editShape?: string; notes?: Record<string, string> };
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the label's own text shows the brand (a whole word, any case, or a code shape as written). A profile without evidence never matches. */
export function hasEvidence(profile: BrandProfile, text: string): boolean {
  const e = profile.evidence;
  if (!e || !text) return false;
  if ((e.words || []).some(word => new RegExp(`\\b${escape(word)}\\b`, 'i').test(text))) return true;
  return (e.codeShapes || []).some(shape => new RegExp(shape).test(text));
}

/** The brand decision: exactly one active (non-generic) brand with evidence, else the generic profile and "unclear". */
export function detectBrand(profiles: BrandProfile[], text: string): { brand: BrandProfile; unclear: boolean } {
  const hits = profiles.filter(p => p.status === 'active' && p.id !== 'generic' && hasEvidence(p, text));
  const generic = profiles.find(p => p.id === 'generic');
  if (hits.length === 1) return { brand: hits[0], unclear: false };
  if (!generic) throw new Error('No generic brand profile');
  return { brand: generic, unclear: true };
}

/** True when a typed model code has the brand's code shape. A profile without a shape never "verifies" a code. */
export function looksLikeModelCode(profile: BrandProfile, typed: string): boolean {
  const shape = profile.model?.editShape;
  return !!shape && new RegExp(shape, 'i').test(typed);
}

export const modelNote = (profile: BrandProfile, key: string): string => profile.model?.notes?.[key] || '';
