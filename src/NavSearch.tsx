// The search bar for getting around (magnifier in the header). Type a word and tap the screen, tool or setting you want; with nothing typed it shows the
// places you used last and the most useful ones. Nothing here changes data: it only opens things. If nothing matches, it offers to ask the assistant instead.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { NAV_ITEMS, questionItems, searchNav, startItems, type NavItem } from './retail/nav-search';

const RECENT_KEY = 'retaillens-nav-recent-v1';
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 6) : []; } catch { return []; } };
const remember = (id: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter(x => x !== id)].slice(0, 6))); } catch { /* the place is simply not remembered */ } };

export function NavSearch({ open, onClose, onGo, savedQuestions }: { open: boolean; onClose: () => void; onGo: (item: NavItem) => void; savedQuestions: string[] }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQuery(''); const t = window.setTimeout(() => input.current?.focus(), 60); return () => window.clearTimeout(t); } }, [open]);
  const all = useMemo(() => [...NAV_ITEMS, ...questionItems(savedQuestions)], [savedQuestions]);
  const typed = query.trim();
  const results = useMemo(() => (typed ? searchNav(query, all) : startItems(readRecent(), all)), [query, typed, all, open]);
  if (!open) return null;
  const go = (item: NavItem) => { if (!item.id.startsWith('question-') && !item.id.startsWith('ask-')) remember(item.id); onGo(item); };
  const askInstead: NavItem = { id: 'ask-typed', title: `Ask the assistant: “${typed}”`, hint: 'Nothing matched a screen', words: [], target: { kind: 'assistant', prompt: typed } };
  return <div className="nav-search-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="nav-search" role="dialog" aria-modal="true" aria-label="Search">
      <div className="nav-search-bar">
        <Search size={18} aria-hidden="true" />
        <input ref={input} type="search" aria-label="Search screens, settings and tools" placeholder="Search screens, settings, tools…" value={query} autoComplete="off" enterKeyHint="go"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter') { const first = results[0] || (typed ? askInstead : undefined); if (first) go(first); } }} />
        <button type="button" className="nav-search-close" aria-label="Close search" onClick={onClose}><X size={18} /></button>
      </div>
      <p className="settings-help" role="status">{typed ? (results.length ? `${results.length} found. Tap one to open it.` : `Nothing matches “${typed}”.`) : 'Recent and popular places'}</p>
      <ul className="nav-search-results" role="listbox" aria-label="Search results">
        {results.map(item => <li key={item.id}><button type="button" role="option" aria-selected="false" onClick={() => go(item)}><strong>{item.title}</strong><small>{item.hint}</small></button></li>)}
        {typed && !results.length && <li><button type="button" role="option" aria-selected="false" onClick={() => go(askInstead)}><strong>{askInstead.title}</strong><small>{askInstead.hint}</small></button></li>}
      </ul>
    </section>
  </div>;
}
