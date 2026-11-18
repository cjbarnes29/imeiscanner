/**
 * The search bar for getting around: every screen, tool and setting is one entry with plain words and extra keywords, and a typed word finds it even with a
 * small typo. Pure functions, no React. Where an entry leads is described as data (`target`), and the app carries it out (src/App.tsx runNav), so this file
 * never touches the screen and is easy to test. Nothing found here changes any data: it only opens things.
 */
export type NavView = 'home' | 'scan' | 'records' | 'report' | 'targets' | 'export';
export type NavMore = 'people' | 'gives' | 'plan' | 'segments' | 'catalog' | 'data';
/** After the screen opens: press a button with this text, or open and scroll to a section, once it has appeared. */
export type NavThen = { press?: string; open?: string };
export type NavTarget =
  | { kind: 'view'; view: NavView; then?: NavThen }
  | { kind: 'more'; section: NavMore; then?: NavThen }
  | { kind: 'settings' }
  | { kind: 'assistant'; prompt?: string };
export type NavItem = { id: string; title: string; hint: string; words: string[]; target: NavTarget };

export const NAV_ITEMS: NavItem[] = [
  { id: 'home', title: 'Home', hint: 'Today, the month outlook and assistant review', words: ['today', 'overview', 'dashboard', 'outlook', 'attention', 'review', 'start'], target: { kind: 'view', view: 'home' } },
  { id: 'scan', title: 'Scan', hint: 'Choose photos or use the camera', words: ['upload', 'photos', 'camera', 'imei', 'label', 'new phones', 'add phones'], target: { kind: 'view', view: 'scan' } },
  { id: 'phones', title: 'Phones', hint: 'All scanned phones, search by IMEI or model', words: ['records', 'list', 'imei', 'serial', 'model', 'stored', 'available', 'needs review', 'duplicates', 'unknown'], target: { kind: 'view', view: 'records' } },
  { id: 'report', title: 'Report', hint: 'Paste and check your WhatsApp report', words: ['whatsapp', 'stock', 'dated', 'draft', 'quantities', 'paste'], target: { kind: 'view', view: 'report' } },
  { id: 'targets', title: 'Targets', hint: 'Targets, sold, levels and pace for each person', words: ['sold', 'achievement', 'percent', 'levels', 'pace', 'promoter', 'goal', 'incentive'], target: { kind: 'view', view: 'targets' } },
  { id: 'export', title: 'Export', hint: 'Send or save phones', words: ['send', 'share', 'csv', 'excel', 'whatsapp', 'bluetooth', 'download', 'save', 'photos'], target: { kind: 'view', view: 'export' } },
  { id: 'people', title: 'People', hint: 'Add people and see who owns which phones', words: ['person', 'promoter', 'team', 'staff', 'owner', 'name', 'unnamed'], target: { kind: 'more', section: 'people' } },
  { id: 'gives', title: 'Give and share', hint: 'Suggest or auto give phones, limits per person', words: ['give', 'assign', 'auto give', 'suggest', 'limits', 'minimum', 'maximum', 'per day', 'by model', 'send'], target: { kind: 'more', section: 'gives' } },
  { id: 'plan', title: 'Daily plan', hint: 'Plan releases and reports for the coming days', words: ['release', 'plan', 'schedule', 'calendar', 'stored', 'goal', 'percentage', 'days'], target: { kind: 'more', section: 'plan' } },
  { id: 'segments', title: 'Segments', hint: 'Make segments and tick the models in them', words: ['flagship', 'mid', 'low', 'fold', 'tablet', 'group', 'categories', 'models'], target: { kind: 'more', section: 'segments' } },
  { id: 'catalog', title: 'Catalog', hint: 'Models, colours, memory and names', words: ['model', 'sku', 'colour', 'color', 'storage', 'memory', 'abbreviation', 'names'], target: { kind: 'more', section: 'catalog' } },
  { id: 'backup', title: 'Backup and data', hint: 'Download or restore a backup, go back to an earlier state', words: ['backup', 'restore', 'download', 'history', 'audit', 'undo', 'earlier', 'snapshot', 'month history'], target: { kind: 'more', section: 'data' } },
  { id: 'settings', title: 'Settings', hint: 'Text size, colour, scanning and the assistant', words: ['preferences', 'theme', 'colour', 'color', 'text size', 'processing', 'automatic', 'manual', 'local ai', 'model', 'recovery', 'diagnostics', 'reset'], target: { kind: 'settings' } },
  { id: 'make-report', title: 'Make a report', hint: 'Excel, PowerPoint or simple notes from the app’s numbers', words: ['excel', 'powerpoint', 'pptx', 'xlsx', 'notes', 'summary', 'presentation', 'slides', 'whatsapp', 'download', 'spreadsheet'], target: { kind: 'view', view: 'home', then: { open: '.assistant-report-files' } } },
  { id: 'edit-all', title: 'Edit all targets and sold', hint: 'Every person and segment on one screen', words: ['edit', 'all', 'grid', 'type', 'sold', 'target', 'promoters', 'one screen'], target: { kind: 'view', view: 'targets', then: { press: 'Edit all targets and sold' } } },
  { id: 'import-targets', title: 'Import Promoter screenshot or paste text', hint: 'Read targets from a screenshot or pasted text', words: ['promoter', 'screenshot', 'import', 'paste', 'text', 'ocr', 'targets'], target: { kind: 'view', view: 'targets', then: { press: 'Paste text' } } },
  { id: 'outlook', title: 'Month outlook', hint: 'What to push and what to leave this month', words: ['forecast', 'push', 'pace', 'end of month', 'estimate', 'projected'], target: { kind: 'view', view: 'home' } },
  { id: 'assistant', title: 'Ask the assistant', hint: 'Ask a question or request a task', words: ['ai', 'chat', 'help', 'question', 'ask', 'request', 'assistant'], target: { kind: 'assistant' } }
];

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
/** Edit distance of at most one (a typo): same word, one letter changed, added or missing. */
function nearWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Score one typed word against one entry: a title word it starts is best, then a keyword, then the hint, then a typo of a title or keyword word. 0 = no match. */
function scoreWord(token: string, item: NavItem): number {
  const titleWords = words(item.title), keyWords = item.words.flatMap(words), hintWords = words(item.hint);
  const inHint = hintWords.some(w => w.startsWith(token)) ? 1 : 0; // a word that is also in the one-line description is a stronger match
  if (titleWords.some(w => w === token)) return 6 + inHint;
  if (titleWords.some(w => w.startsWith(token))) return 5 + inHint;
  if (keyWords.some(w => w === token)) return 4 + inHint;
  if (keyWords.some(w => w.startsWith(token))) return 3 + inHint;
  if (hintWords.some(w => w.startsWith(token))) return 2;
  if (token.length >= 4 && [...titleWords, ...keyWords].some(w => nearWord(token, w))) return 1;
  return 0;
}

/** The entries that match every typed word, best first. An empty search finds nothing (the screen shows recent and popular entries instead). */
export function searchNav(query: string, items: NavItem[] = NAV_ITEMS, limit = 8): NavItem[] {
  const tokens = words(query);
  if (!tokens.length) return [];
  const scored = items.map(item => {
    const scores = tokens.map(t => scoreWord(t, item));
    const titleWords = words(item.title);
    const share = titleWords.filter(w => tokens.some(t => w === t || w.startsWith(t) || nearWord(t, w))).length / titleWords.length; // a short title that is fully matched beats a long one that only holds the word
    return { item, score: scores.every(s => s > 0) ? scores.reduce((a, b) => a + b, 0) + (titleWords.join(' ').startsWith(tokens.join(' ')) ? 3 : 0) + share : 0 };
  }).filter(r => r.score > 0);
  return scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title)).slice(0, limit).map(r => r.item);
}

/** What to show before anything is typed: the places used last, then the most useful ones, with no repeats. */
export function startItems(recentIds: string[], items: NavItem[] = NAV_ITEMS, limit = 6): NavItem[] {
  const popular = ['targets', 'make-report', 'backup', 'edit-all', 'gives', 'settings'];
  const out: NavItem[] = [];
  for (const id of [...recentIds, ...popular]) { const item = items.find(i => i.id === id); if (item && !out.includes(item)) out.push(item); }
  return out.slice(0, limit);
}

/** Saved assistant questions as entries: choosing one asks it. */
export function questionItems(questions: string[]): NavItem[] {
  return questions.filter(q => q.trim().length >= 4 && q.length <= 120 && !/\d{15}/.test(q)).slice(-10).map((q, i) => ({ id: `question-${i}`, title: q.trim(), hint: 'Saved question: ask the assistant', words: ['question', 'saved', 'ask'], target: { kind: 'assistant' as const, prompt: q.trim() } }));
}
