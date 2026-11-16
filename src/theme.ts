/** The accent colour of the app (Mint, Ocean, Violet, Rose), remembered on this phone. Every green of the stylesheet is a variable; a theme turns them to another hue. */
export const THEME_KEY = 'retaillens-theme-v1';
export const THEMES = [
  { id: 'mint', label: 'Mint', swatch: '#58d7b0' },
  { id: 'ocean', label: 'Ocean', swatch: '#58a8d7' },
  { id: 'violet', label: 'Violet', swatch: '#9a7fe6' },
  { id: 'rose', label: 'Rose', swatch: '#e67fa8' },
] as const;
export type ThemeId = typeof THEMES[number]['id'];

export function readTheme(): ThemeId {
  try { const saved = localStorage.getItem(THEME_KEY); if (THEMES.some(theme => theme.id === saved)) return saved as ThemeId; } catch { /* ignore */ }
  return 'mint';
}
export function applyTheme(id: ThemeId) {
  if (id === 'mint') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', id);
}
export function saveTheme(id: ThemeId) {
  try { localStorage.setItem(THEME_KEY, id); } catch { /* ignore */ }
  applyTheme(id);
}
applyTheme(readTheme());
