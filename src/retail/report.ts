/**
 * WhatsApp reports. The person pastes (or shares) a report they already send; the app learns its LAYOUT from it (title line, section headings and
 * their order, bullet and separator style, whether lines show abbreviation / storage / colour, where the quantity sits) and then writes the next
 * report in exactly that layout from the app's own data: confirmed sales (sellout), stock, colour quantities, totals, activations, SC+, competitor
 * sales and shifts. Lines it does not understand are kept word for word, so nothing the person wrote is lost.
 * The layout is learned, not assumed: with no example, a plain default layout is used.
 */
import { fullCatalog } from './catalog';
import { stockRows, type StockRow } from './inventory';
import { liveSales } from './sales';
import { dateKey, isDateKey, type CatalogItem, type DateKey, type RetailState, type ReportSection, type ReportTemplate } from './types';

const SECTION_WORDS: [ReportSection['key'], RegExp][] = [
  ['scplus', /\bsc\s*\+|samsung\s*care/i], ['activations', /activation/i], ['competitor', /competi|other\s*brand|market\s*sales/i],
  ['shifts', /\bshift|attendance|\bduty|roster/i], ['stock', /\bstock|inventory|closing|balance/i], ['total', /^\W*total\b/i], ['sellout', /sell\s*-?\s*out|\bsales?\b|\bsold\b/i]
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const strip = (line: string) => line.replace(/[*_~`]/g, '').trim();
const two = (n: number) => String(n).padStart(2, '0');

export function formatDate(date: DateKey, format: ReportTemplate['dateFormat']): string {
  const [y, m, d] = date.split('-');
  return format === 'DD-MM-YYYY' ? `${d}-${m}-${y}` : format === 'YYYY-MM-DD' ? date : format === 'D MMM YYYY' ? `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` : `${d}/${m}/${y}`;
}

/** A date written in the text, and the way it was written. */
export function findDate(text: string): { date: DateKey; format: ReportTemplate['dateFormat']; text: string } | undefined {
  const named = text.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+(20\d{2})\b/i);
  if (named) return { date: `${named[3]}-${two(MONTHS.findIndex(m => m.toLowerCase() === named[2].toLowerCase().slice(0, 3)) + 1)}-${two(Number(named[1]))}`, format: 'D MMM YYYY', text: named[0] };
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso && isDateKey(iso[0])) return { date: iso[0], format: 'YYYY-MM-DD', text: iso[0] };
  const num = text.match(/\b(\d{1,2})([/-])(\d{1,2})\2(\d{2}|\d{4})\b/);
  if (num) {
    const year = num[4].length === 2 ? `20${num[4]}` : num[4];
    const key = `${year}-${two(Number(num[3]))}-${two(Number(num[1]))}`;
    if (isDateKey(key)) return { date: key, format: num[2] === '-' ? 'DD-MM-YYYY' : 'DD/MM/YYYY', text: num[0] };
  }
  return undefined;
}

export type ReportItem = { label: string; item?: CatalogItem; ram: string; storage: string; color: string; qty: number; raw: string };
export type ParsedSection = { key: ReportSection['key']; heading: string; bullet: string; sep: string; qtyBefore: boolean; items: ReportItem[]; value?: number; verbatim: string[]; inline?: string };
export type ParsedReport = { date?: DateKey; template: ReportTemplate; sections: ParsedSection[]; warnings: string[] };

/** A catalog model, memory and colour from a report line such as "A17 5G 4/128 Black". Nothing is invented: unknown parts stay empty. */
export function matchItemText(state: Pick<RetailState, 'catalog'>, text: string): { item?: CatalogItem; ram: string; storage: string; color: string; label: string } {
  let rest = strip(text).replace(/\bsamsung\b/i, '').replace(/\bgalaxy\b/i, '').replace(/\s+/g, ' ').trim();
  let ram = '', storage = '';
  const pair = rest.match(/\b(\d{1,2})\s*(?:gb)?\s*[/+|]\s*(\d{1,4})\s*(gb|tb)?\b/i);
  if (pair) { ram = `${pair[1]}GB`; storage = `${pair[2]}${pair[3] ? pair[3].toUpperCase() : Number(pair[2]) <= 4 ? 'TB' : 'GB'}`; rest = rest.replace(pair[0], ' ').replace(/\s+/g, ' ').trim(); }
  else { const single = rest.match(/\b(\d{2,4})\s*(gb|tb)\b/i); if (single) { storage = `${single[1]}${single[2].toUpperCase()}`; rest = rest.replace(single[0], ' ').replace(/\s+/g, ' ').trim(); } }
  const lower = rest.toLowerCase();
  let best: CatalogItem | undefined, bestLength = 0;
  for (const item of fullCatalog(state)) {
    for (const name of [item.abbreviation, item.name.replace(/^galaxy\s+/i, '')]) {
      const n = name.toLowerCase();
      if (n && n.length > bestLength && (lower === n || lower.startsWith(n + ' '))) { best = item; bestLength = n.length; }
    }
  }
  const color = best ? rest.slice(bestLength).replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return { item: best, ram, storage, color, label: best ? best.abbreviation : rest };
}

function sectionKey(line: string): ReportSection['key'] | undefined {
  const text = strip(line).replace(/[:\-–=]+\s*\d*\s*$/, '').trim();
  if (!text || text.length > 40) return undefined;
  for (const [key, pattern] of SECTION_WORDS) if (pattern.test(text)) return key;
  return undefined;
}

/** "A17 5G 4/128 Black - 2" -> item with qty 2, and how the line was put together. */
function parseItemLine(state: Pick<RetailState, 'catalog'>, line: string): { item: ReportItem; bullet: string; sep: string; qtyBefore: boolean } | undefined {
  const bullet = line.match(/^\s*([-•*·▪▫◦>]|\d{1,2}[.)])\s+/)?.[0] ?? '';
  const body = line.slice(bullet.length).trim();
  const tail = body.match(/^(.*?)(\s*(?:[-–:=]|x|×)\s*|\s+\(?)(\d{1,4})\)?\s*$/i);
  const head = body.match(/^(\d{1,4})(\s*(?:x|×|[-–:=])\s*)(.+)$/i);
  let text: string, qty: number, sep: string, qtyBefore = false;
  if (head && !/^\d{1,4}\s*(gb|tb|\/)/i.test(body)) { qty = Number(head[1]); sep = head[2]; text = head[3]; qtyBefore = true; }
  else if (tail && tail[1].trim()) { text = tail[1]; qty = Number(tail[3]); sep = tail[2].trim() ? tail[2] : ' '; }
  else return undefined;
  const found = matchItemText(state, text);
  return { item: { label: found.label, item: found.item, ram: found.ram, storage: found.storage, color: found.color, qty, raw: line }, bullet, sep, qtyBefore };
}

/** Reads a report and learns its layout. Unknown lines are kept as they were. */
export function parseReport(state: Pick<RetailState, 'catalog'>, text: string): ParsedReport {
  const lines = text.replace(/\r/g, '').split('\n');
  const warnings: string[] = [];
  const first = lines.findIndex(l => l.trim());
  const titleLine = first >= 0 ? lines[first] : '';
  const dateInfo = findDate(text);
  const title = dateInfo ? titleLine.replace(dateInfo.text, '{date}') : titleLine;
  const sections: ParsedSection[] = [];
  let current: ParsedSection | undefined;
  let sawBullet = false;
  const BULLET = /^\s*([-•*·▪▫◦>]|\d{1,2}[.)])\s+/;
  for (const raw of lines.slice(first + 1)) {
    if (!raw.trim()) { if (current) current.verbatim.push(''); continue; }
    const key = sectionKey(raw);
    const listText = (key === 'shifts' || key === 'competitor') && !BULLET.test(raw) ? raw.match(/^(.*?:)\s*(\S.*)$/) : null;
    if (key && listText && /[A-Za-z]/.test(listText[2]) && !/^\s*[-•*]/.test(raw)) {
      current = { key, heading: raw, bullet: '', sep: ' - ', qtyBefore: false, items: [], verbatim: [], inline: listText[1] };
      sections.push(current); sawBullet = false; continue;
    }
    const inline = raw.match(/^(.*?)[:\-–=]\s*(\d{1,5})\s*$/);
    if (key && (!parseItemLine(state, raw) || inline)) {
      current = { key, heading: inline && ['activations', 'scplus', 'total'].includes(key) ? raw.replace(/(\d{1,5})\s*$/, '{n}') : raw, bullet: '', sep: ': ', qtyBefore: false, items: [], verbatim: [] };
      if (inline && ['activations', 'scplus', 'total', 'sellout', 'stock'].includes(key) && !/^\s*[-•*]/.test(raw)) current.value = Number(inline[2]);
      sections.push(current); sawBullet = false; continue;
    }
    if (dateInfo && raw.includes(dateInfo.text) && !current) continue;
    // Any line after a one-line section ("Activations: 3", "Total: 9") belongs to no section: it is a note or a sign-off and is kept as written, as its own block
    if (current && ['activations', 'scplus', 'total'].includes(current.key)) current = undefined;
    // a line without a bullet after a bulleted list is not part of the list (a sign-off, a note): it starts a section of its own and is kept as written
    if (current && ['sellout', 'stock', 'competitor', 'shifts'].includes(current.key) && sawBullet && !BULLET.test(raw)) current = undefined;
    if (!current) { current = { key: 'other', heading: '', bullet: '', sep: ': ', qtyBefore: false, items: [], verbatim: [] }; sections.push(current); sawBullet = false; }
    if (BULLET.test(raw)) { sawBullet = true; if (!current.bullet) current.bullet = raw.match(BULLET)![0]; }
    if (['sellout', 'stock', 'competitor'].includes(current.key)) {
      const parsed = parseItemLine(state, raw);
      if (parsed) { current.items.push(parsed.item); current.bullet = parsed.bullet; current.sep = parsed.sep; current.qtyBefore = parsed.qtyBefore; continue; }
      warnings.push(`Kept as written (not understood): ${raw.trim().slice(0, 60)}`);
    }
    current.verbatim.push(raw);
  }
  while (sections.length && sections[sections.length - 1].verbatim.length && !sections[sections.length - 1].verbatim[sections[sections.length - 1].verbatim.length - 1].trim() && !sections[sections.length - 1].items.length && !sections[sections.length - 1].heading) sections.pop();
  const template: ReportTemplate = {
    title: title || '*Daily Report {date}*', dateFormat: dateInfo?.format || 'DD/MM/YYYY',
    sections: sections.map(s => ({
      key: s.key, heading: s.heading, bullet: s.bullet, sep: s.sep, qtyBefore: s.qtyBefore, useAbbreviation: s.items.every(i => !i.item || i.label === i.item.abbreviation),
      showColor: s.items.some(i => !!i.color), showStorage: s.items.some(i => !!i.storage), verbatim: s.items.length ? [] : s.verbatim, inline: s.inline
    }))
  };
  if (!sections.some(s => s.key === 'sellout')) warnings.push('No sellout section was found in this report.');
  return { date: dateInfo?.date, template, sections, warnings };
}

export const DEFAULT_TEMPLATE: ReportTemplate = {
  title: '*Daily Report {date}*', dateFormat: 'DD/MM/YYYY',
  sections: [
    { key: 'sellout', heading: '*Sellout*', bullet: '- ', sep: ' - ', qtyBefore: false, useAbbreviation: true, showColor: true, showStorage: true },
    { key: 'total', heading: 'Total sellout: {n}', bullet: '', sep: ': ', qtyBefore: false, useAbbreviation: true, showColor: false, showStorage: false },
    { key: 'stock', heading: '*Stock*', bullet: '- ', sep: ' - ', qtyBefore: false, useAbbreviation: true, showColor: true, showStorage: true },
    { key: 'activations', heading: 'Activations: {n}', bullet: '', sep: ': ', qtyBefore: false, useAbbreviation: true, showColor: false, showStorage: false },
    { key: 'scplus', heading: 'SC+: {n}', bullet: '', sep: ': ', qtyBefore: false, useAbbreviation: true, showColor: false, showStorage: false },
    { key: 'competitor', heading: '*Competitor*', bullet: '- ', sep: ' - ', qtyBefore: false, useAbbreviation: true, showColor: false, showStorage: false },
    { key: 'shifts', heading: '*Shifts*', bullet: '- ', sep: ': ', qtyBefore: false, useAbbreviation: true, showColor: false, showStorage: false }
  ]
};

type Row = { label: string; ram: string; storage: string; color: string; qty: number };
const memory = (row: Row) => (row.ram && row.storage ? `${row.ram.replace(/GB/i, '')}/${row.storage.replace(/GB/i, '')}` : row.storage || '');

function rowsFromSales(state: RetailState, date: DateKey, personId: string): Row[] {
  const rows = new Map<string, Row>();
  for (const sale of liveSales(state).filter(s => s.date === date && (!personId || s.personId === personId))) {
    const found = matchItemText(state, sale.modelName);
    const key = `${sale.model}|${sale.storage}|${sale.color}`;
    const row = rows.get(key) || { label: found.item?.abbreviation || sale.modelName, ram: sale.ram, storage: sale.storage, color: sale.color, qty: 0 };
    row.qty++; rows.set(key, row);
  }
  return [...rows.values()];
}
const rowsFromStock = (rows: StockRow[]): Row[] => rows.filter(r => r.qty > 0).map(r => ({ label: r.abbreviation, ram: r.ram, storage: r.storage, color: r.color, qty: r.qty }));

function line(section: ReportTemplate['sections'][number], row: Row): string {
  const label = [row.label, section.showStorage ? memory(row) : '', section.showColor ? row.color : ''].filter(Boolean).join(' ');
  return section.qtyBefore ? `${section.bullet}${row.qty}${section.sep}${label}` : `${section.bullet}${label}${section.sep}${row.qty}`;
}

export type ReportInput = { date: DateKey; personId?: string; promoter?: string };

/** Writes the report for a date in the given layout from the app's data (sales of that day, today's stock, the day log). */
export function buildReport(state: RetailState, records: Parameters<typeof stockRows>[1], template: ReportTemplate = state.template || DEFAULT_TEMPLATE, input: ReportInput = { date: dateKey() }): string {
  const day = state.days[input.date];
  const sellout = rowsFromSales(state, input.date, input.personId || '');
  const stock = rowsFromStock(stockRows(state, records, input.date));
  const out: string[] = [template.title.replace('{date}', formatDate(input.date, template.dateFormat))];
  for (const section of template.sections) {
    const n = (value: number) => section.heading.replace('{n}', String(value));
    switch (section.key) {
      case 'sellout': out.push(section.heading.replace('{n}', String(sellout.reduce((s, r) => s + r.qty, 0))), ...sellout.map(r => line(section, r))); break;
      case 'stock': out.push(section.heading.replace('{n}', String(stock.reduce((s, r) => s + r.qty, 0))), ...stock.map(r => line(section, r))); break;
      case 'total': out.push(n(sellout.reduce((s, r) => s + r.qty, 0))); break;
      case 'activations': out.push(n(day?.activations || 0)); break;
      case 'scplus': out.push(n(day?.scPlus || 0)); break;
      case 'competitor': if (section.inline) { out.push(`${section.inline} ${(day?.competitor || []).map(c => `${[c.brand, c.model].filter(Boolean).join(' ')} - ${c.qty}`).join(', ')}`.trim()); break; } out.push(section.heading.replace('{n}', String((day?.competitor || []).reduce((s, c) => s + c.qty, 0))), ...(day?.competitor || []).map(c => line(section, { label: [c.brand, c.model].filter(Boolean).join(' '), ram: '', storage: '', color: '', qty: c.qty }))); break;
      case 'shifts': if (section.inline) { out.push(`${section.inline} ${(day?.shifts || []).map(x => `${x.person} (${x.shift})`).join(', ')}`.trim()); break; } out.push(section.heading, ...(day?.shifts || []).map(s => `${section.bullet}${s.person}${section.sep}${s.shift}`)); break;
      default: out.push(...(section.verbatim || [])); if (section.heading) out.splice(out.length - (section.verbatim || []).length, 0, section.heading);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Learns the layout from a pasted report and writes today's report in it. `learned` is the template to keep in the settings. */
export function updateReport(state: RetailState, records: Parameters<typeof stockRows>[1], sample: string, input: ReportInput): { text: string; learned: ReportTemplate; warnings: string[] } {
  const parsed = parseReport(state, sample);
  return { text: buildReport(state, records, parsed.template, input), learned: parsed.template, warnings: parsed.warnings };
}
