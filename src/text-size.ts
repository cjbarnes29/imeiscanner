/** Text size choice for the whole app, remembered on this phone. */
export const TEXT_SIZE_KEY = 'imei-lens-text-size-v1';
export const TEXT_SIZES = [
  { id: 'small', label: 'Small', scale: 0.9 },
  { id: 'normal', label: 'Normal', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.15 },
  { id: 'xlarge', label: 'Extra large', scale: 1.3 },
] as const;
export type TextSizeId = typeof TEXT_SIZES[number]['id'];

export function readTextSize(): TextSizeId {
  try { const saved = localStorage.getItem(TEXT_SIZE_KEY); if (TEXT_SIZES.some(size => size.id === saved)) return saved as TextSizeId; } catch { /* ignore */ }
  return 'normal';
}
export function applyTextSize(id: TextSizeId) {
  const scale = TEXT_SIZES.find(size => size.id === id)?.scale ?? 1;
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = scale === 1 ? '' : String(scale);
}
export function saveTextSize(id: TextSizeId) {
  try { localStorage.setItem(TEXT_SIZE_KEY, id); } catch { /* ignore */ }
  applyTextSize(id);
}
applyTextSize(readTextSize());
