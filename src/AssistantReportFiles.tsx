// Home > Assistant review > "Make a report": the app's own numbers as an Excel file, a PowerPoint file or simple notes. The assistant chat can ask for one
// ("make a PowerPoint report for last month"); it only fills in the choices here, and the report is made when a button is pressed. A finished report can be
// downloaded or sent on WhatsApp. Sending is finished by the person in WhatsApp (choose the chat, press send): this app cannot tell if it was delivered.
// Making a report changes no data. All the content comes from src/retail/report-model.ts; no IMEI numbers or photos are included.
import { useEffect, useMemo, useState } from 'react';
import { buildReport, monthTitle } from './retail/report-model';
import { reportNotes } from './retail/report-notes';
import type { ReportFormat, ReportIntent } from './retail/report-intent';
import { monthOf } from './retail/types';
import { recordDiagnostic } from './diagnostics';
import type { RetailCtx } from './retail/ui-helpers';

export const REPORT_REQUEST_KEY = 'retaillens-report-request-v1';
export const REPORT_REQUEST_EVENT = 'ai-lens-report-request';
const FORMAT_NAME: Record<ReportFormat, string> = { xlsx: 'Excel', pptx: 'PowerPoint', notes: 'Simple notes' };
type Made = { kind: ReportFormat; name: string; caption: string; blob?: Blob; text: string; size: number };

/** The chat asks for a report: the choices are kept for the Home card, which opens and fills itself in. */
export function requestReport(intent: ReportIntent): void {
  try { localStorage.setItem(REPORT_REQUEST_KEY, JSON.stringify({ format: intent.format, month: intent.month, personId: intent.personId, summary: intent.summary })); } catch { /* the choices simply are not carried over */ }
  window.dispatchEvent(new CustomEvent(REPORT_REQUEST_EVENT));
}
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const sizeText = (bytes: number) => (bytes < 1024 ? `${bytes} bytes` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

export function ReportFiles(ctx: RetailCtx) {
  const { state, people, today } = ctx;
  const [month, setMonth] = useState(monthOf(today));
  const [personId, setPersonId] = useState('');
  const [format, setFormat] = useState<ReportFormat>('xlsx');
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [made, setMade] = useState<Made | null>(null);
  const [asked, setAsked] = useState('');
  const [open, setOpen] = useState(false);
  const months = useMemo(() => {
    const set = new Set<string>([monthOf(today)]);
    const [y, m] = monthOf(today).split('-').map(Number);
    const before = new Date(y, m - 2, 1); set.add(`${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, '0')}`);
    for (const key of Object.keys(state.targets)) set.add(key);
    for (const sale of state.sales) set.add(sale.month);
    return [...set].filter(k => /^\d{4}-\d{2}$/.test(k)).sort().reverse().slice(0, 12);
  }, [state.targets, state.sales, today]);

  // a request made in the chat fills in the choices and opens this card
  useEffect(() => {
    const read = () => {
      let raw: string | null = null;
      try { raw = localStorage.getItem(REPORT_REQUEST_KEY); localStorage.removeItem(REPORT_REQUEST_KEY); } catch { return; }
      if (!raw) return;
      try {
        const want = JSON.parse(raw) as { format?: ReportFormat; month?: string; personId?: string; summary?: string };
        if (want.format && ['xlsx', 'pptx', 'notes'].includes(want.format)) setFormat(want.format);
        setMonth(want.month && /^\d{4}-\d{2}$/.test(want.month) ? want.month : monthOf(today));
        setPersonId(want.personId && people.some(p => p.id === want.personId) ? want.personId : '');
        setAsked(want.summary || ''); setOpen(true); setStatus(''); setError(''); setMade(null);
      } catch { /* an unreadable request is ignored: the card still works by hand */ }
    };
    read();
    window.addEventListener(REPORT_REQUEST_EVENT, read);
    return () => window.removeEventListener(REPORT_REQUEST_EVENT, read);
  }, [today, people]);

  const make = async (kind: ReportFormat) => {
    setFormat(kind); setBusy(kind); setError(''); setMade(null); setStatus(`Making the ${FORMAT_NAME[kind].toLowerCase()} report…`);
    try {
      const model = buildReport(state, ctx.records, people, today, { month, personId: personId || undefined });
      const base = `AI-LENS-report-${month}${personId ? '-' + slug(model.who) : ''}`;
      const caption = `${model.title} · ${model.who}`;
      if (kind === 'notes') {
        const text = reportNotes(model);
        setMade({ kind, name: `${base}.txt`, caption, text, size: new Blob([text]).size });
      } else {
        const blob = kind === 'xlsx' ? await (await import('./retail/report-xlsx')).reportXlsx(model) : await (await import('./retail/report-pptx')).reportPptx(model);
        setMade({ kind, name: `${base}.${kind}`, caption, blob, text: '', size: blob.size });
      }
      setStatus(`${FORMAT_NAME[kind]} report is ready. Download it or send it on WhatsApp.`);
    } catch (problem) {
      recordDiagnostic('report-file-failed', problem);
      setStatus(''); setError(`The ${FORMAT_NAME[kind].toLowerCase()} report could not be made. Nothing was changed. Try again, or make simple notes instead.`);
    } finally { setBusy(''); }
  };

  const blobOf = (m: Made) => m.blob || new Blob([m.text], { type: 'text/plain;charset=utf-8' });
  const download = () => {
    if (!made) return;
    ctx.download(blobOf(made), made.name);
    setError(''); setStatus(`Saved as ${made.name}. Look in your downloads or the save screen.`);
  };
  const sendWhatsApp = async () => {
    if (!made) return;
    setError('');
    if (made.kind === 'notes') {
      const text = `${made.caption}\n\n${made.text}`;
      if (ctx.whatsapp) ctx.whatsapp(text); else ctx.share(text);
      setStatus('WhatsApp is opening with the notes ready. Choose the chat and press send there. This app cannot tell whether it was sent.');
      return;
    }
    if (!ctx.shareFile) { download(); setStatus(`This screen cannot open WhatsApp directly, so ${made.name} was saved. Attach it in WhatsApp.`); return; }
    const opened = await ctx.shareFile(made.blob!, made.name, 'AI LENS report', made.caption);
    setStatus(opened
      ? 'The share menu is open. Choose WhatsApp, then the chat, and press send there. This app cannot tell whether it was sent.'
      : `Nothing was sent. If the file was saved, attach ${made.name} in WhatsApp yourself, or press Download.`);
  };

  return <details className="assistant-report-files" open={open} onToggle={e => { if (e.target === e.currentTarget) setOpen(e.currentTarget.open); }}>
    <summary><strong>Make a report</strong> <small>Excel, PowerPoint or simple notes</small></summary>
    <p className="settings-help">Made from the numbers already in the app: targets, sales, stock and the month outlook. Nothing is changed, and no IMEI numbers or photos are included.</p>
    {asked && <p className="settings-help" role="status">Asked in the assistant: {asked}. Press the button to make it.</p>}
    <div className="retail-inline">
      <label>Month<select aria-label="Report month" value={month} onChange={e => { setMonth(e.target.value); setMade(null); }}>{(months.includes(month) ? months : [month, ...months]).map(k => <option key={k} value={k}>{monthTitle(k)}</option>)}</select></label>
      <label>For<select aria-label="Report for" value={personId} onChange={e => { setPersonId(e.target.value); setMade(null); }}><option value="">Everyone</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    </div>
    <div className="share-toolbar">
      {(['xlsx', 'pptx', 'notes'] as ReportFormat[]).map(kind => <button key={kind} type="button" className={format === kind ? 'primary' : 'subtle-btn'} aria-label={`Make ${FORMAT_NAME[kind]} report`} disabled={!!busy} onClick={() => void make(kind)}>{busy === kind ? 'Making…' : kind === 'xlsx' ? 'Excel (.xlsx)' : kind === 'pptx' ? 'PowerPoint (.pptx)' : 'Simple notes'}</button>)}
    </div>
    {status && <p className="settings-help" role="status">{status}</p>}
    {error && <p className="bad" role="alert">{error}</p>}
    {made && <div className="assistant-report-made" role="group" aria-label="Report ready">
      <p><strong>{FORMAT_NAME[made.kind]}</strong> · {made.name} · {sizeText(made.size)}</p>
      {made.kind === 'notes' && <textarea aria-label="Report notes" value={made.text} rows={12} onChange={e => setMade({ ...made, text: e.target.value, size: new Blob([e.target.value]).size })} />}
      <div className="share-toolbar">
        <button type="button" className="primary whatsapp-btn" aria-label="Send report on WhatsApp" onClick={() => void sendWhatsApp()}>Send on WhatsApp</button>
        <button type="button" className="subtle-btn" aria-label="Download report" onClick={download}>{made.kind === 'notes' ? 'Download .txt' : 'Download'}</button>
        {made.kind === 'notes' && <button type="button" className="subtle-btn" onClick={() => ctx.share(made.text)}>Share / copy</button>}
      </div>
      <p className="settings-help">WhatsApp opens with the report ready; you choose the chat and press send. The app cannot see whether it was delivered.</p>
    </div>}
  </details>;
}
