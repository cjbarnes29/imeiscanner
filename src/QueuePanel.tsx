// The crop queue at a glance: Pending, Processing, Process later, Needs review, Completed.
// Needs review lists ONLY affected photos: ones that could not be cut or read (with the reason) and finished photos with a crop
// that is not certain. Each has Retry / Quick edit / Approve. Completed can be selected for export in one tap.
import { useState } from 'react';
import { X } from 'lucide-react';
import type { QueueItem, QueueLogEntry } from './crop-queue';
import { useBackLayer } from './back-layer';

type Row = { id: string; name: string; dataUrl: string; cropDataUrl?: string; imei: string; cropNeedsReview?: boolean };
type Tab = 'pending' | 'processing' | 'later' | 'review' | 'completed';
type Props = {
  queue: QueueItem[]; processingId: string; paused: boolean;
  reviewLog: QueueLogEntry[]; completedLog: QueueLogEntry[]; records: Row[]; unqueued: number;
  onClose: () => void; onPause: () => void; onResume: () => void;
  onLater: (id: string) => void; onProcessNow: (id: string) => void; onRetry: (id: string) => void; onRetryAll: () => void; onRemove: (id: string) => void;
  onApprove: (entry: QueueLogEntry) => void; onEdit: (recordIds: string[]) => void; onCropMyself: (id: string) => void;
  onAddAll: () => void; onExportCompleted: () => void;
};
const PAGE = 30;

export function QueuePanel(p: Props) {
  useBackLayer(true, p.onClose, 'queue-panel');
  const pending = p.queue.filter(item => item.status === 'pending' && item.recordId !== p.processingId);
  const later = p.queue.filter(item => item.status === 'later');
  const failed = p.queue.filter(item => item.status === 'failed');
  const processing = p.queue.find(item => item.recordId === p.processingId);
  const reviewCount = failed.length + p.reviewLog.length;
  const [tab, setTab] = useState<Tab>(reviewCount ? 'review' : pending.length || processing ? 'pending' : 'completed');
  const [shown, setShown] = useState(PAGE);
  const byId = new Map(p.records.map(row => [row.id, row]));
  const thumb = (id?: string) => { const row = id ? byId.get(id) : undefined; return row ? <img src={row.cropDataUrl || row.dataUrl} alt="" loading="lazy" decoding="async" /> : <span className="queue-thumb-missing" />; };
  const nameOf = (item: QueueItem) => item.name || byId.get(item.recordId)?.name || 'Photo';
  const tabs: [Tab, string, number][] = [['pending', 'Pending', pending.length], ['processing', 'Processing', processing ? 1 : 0], ['later', 'Process later', later.length], ['review', 'Needs review', reviewCount], ['completed', 'Completed', p.completedLog.length]];
  const flaggedIn = (entry: QueueLogEntry) => entry.recordIds.filter(id => byId.get(id)?.cropNeedsReview);
  const more = (total: number) => total > shown && <button type="button" className="textbtn" onClick={() => setShown(n => n + PAGE)}>Show {Math.min(PAGE, total - shown)} more</button>;

  return <div className="modal-backdrop"><section className="modal queue-panel" role="dialog" aria-modal="true" aria-label="Crop queue">
    <div className="modal-head"><h2>Crop queue</h2><button type="button" className="iconbtn" aria-label="Close" onClick={p.onClose}><X size={18} /></button></div>
    <div className="queue-actions">
      {pending.length + later.length > 0 && (p.paused || !pending.length ? <button type="button" className="primary" onClick={p.onResume}>Resume{later.length ? ` (includes ${later.length} for later)` : ''}</button> : <button type="button" className="subtle-btn" onClick={p.onPause}>Pause</button>)}
      {p.unqueued > 0 && <button type="button" className="subtle-btn" onClick={p.onAddAll}>Queue {p.unqueued} photo{p.unqueued === 1 ? '' : 's'} that need cropping</button>}
    </div>
    <div className="queue-tabs" role="tablist">{tabs.map(([key, label, count]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'on' : ''} onClick={() => { setTab(key); setShown(PAGE); }}>{label} <b>{count}</b></button>)}</div>
    <div className="queue-list">
      {tab === 'pending' && <>{!pending.length && <p className="settings-help">Nothing waiting.</p>}
        {pending.slice(0, shown).map(item => <div key={item.recordId} className="queue-row">{thumb(item.recordId)}<span><strong>{nameOf(item)}</strong><small>{item.auto ? 'Automatic crop' : `${item.boxes.length} box${item.boxes.length === 1 ? '' : 'es'} drawn`}</small></span>
          <div><button type="button" className="subtle-btn" onClick={() => p.onLater(item.recordId)}>Later</button><button type="button" className="subtle-btn" onClick={() => p.onRemove(item.recordId)}>Remove</button></div></div>)}{more(pending.length)}</>}
      {tab === 'processing' && (processing ? <div className="queue-row">{thumb(processing.recordId)}<span><strong>{nameOf(processing)}</strong><small>Being cut and read now{p.paused ? ' (pauses after this photo)' : ''}</small></span></div> : <p className="settings-help">{p.paused ? 'Paused.' : 'Nothing is being read.'}</p>)}
      {tab === 'later' && <>{!later.length && <p className="settings-help">Nothing set aside. "Later" keeps a photo's boxes; Resume includes it again.</p>}
        {later.slice(0, shown).map(item => <div key={item.recordId} className="queue-row">{thumb(item.recordId)}<span><strong>{nameOf(item)}</strong><small>Set aside · {item.auto ? 'automatic crop' : `${item.boxes.length} box${item.boxes.length === 1 ? '' : 'es'}`}</small></span>
          <div><button type="button" className="primary" onClick={() => p.onProcessNow(item.recordId)}>Process now</button><button type="button" className="subtle-btn" onClick={() => p.onRemove(item.recordId)}>Remove</button></div></div>)}{more(later.length)}</>}
      {tab === 'review' && <>{!reviewCount && <p className="settings-help">Nothing needs review.</p>}
        {failed.length > 1 && <button type="button" className="subtle-btn" onClick={p.onRetryAll}>Retry all {failed.length}</button>}
        {failed.slice(0, shown).map(item => <div key={item.recordId} className="queue-row needs-look">{thumb(item.recordId)}<span><strong>{nameOf(item)}</strong><small>{item.error || 'Could not be cut'}{item.attempts > 1 ? ` · tried ${item.attempts} times` : ''}</small></span>
          <div><button type="button" className="primary" onClick={() => p.onRetry(item.recordId)}>Retry</button><button type="button" className="subtle-btn" onClick={() => p.onCropMyself(item.recordId)}>Crop myself</button><button type="button" className="subtle-btn" onClick={() => p.onEdit([item.recordId])}>Quick edit</button></div></div>)}
        {p.reviewLog.slice(0, shown).map(entry => { const flagged = flaggedIn(entry); return <div key={entry.originalId} className="queue-row needs-look">{thumb(flagged[0] || entry.recordIds[0])}<span><strong>{entry.name}</strong><small>{flagged.length} of {entry.recordIds.length} crop{entry.recordIds.length === 1 ? '' : 's'} need a look{entry.note ? ` · ${entry.note}` : ''}</small></span>
          <div><button type="button" className="primary" onClick={() => p.onEdit(flagged.length ? flagged : entry.recordIds)}>Quick edit</button><button type="button" className="subtle-btn" onClick={() => p.onApprove(entry)}>Approve</button></div></div>; })}{more(Math.max(failed.length, p.reviewLog.length))}</>}
      {tab === 'completed' && <>{!p.completedLog.length && <p className="settings-help">No finished photos yet.</p>}
        {p.completedLog.length > 0 && <button type="button" className="primary" onClick={p.onExportCompleted}>Select {p.completedLog.reduce((n, e) => n + e.recordIds.length, 0)} records for export</button>}
        {[...p.completedLog].reverse().slice(0, shown).map(entry => <div key={entry.originalId} className="queue-row">{thumb(entry.recordIds[0])}<span><strong>{entry.name}</strong><small>{entry.recordIds.length} record{entry.recordIds.length === 1 ? '' : 's'}{entry.approved ? ' · approved' : ''}{entry.note ? ` · ${entry.note}` : ''}</small></span>
          <div><button type="button" className="subtle-btn" onClick={() => p.onEdit(entry.recordIds)}>Open</button></div></div>)}{more(p.completedLog.length)}</>}
    </div>
  </section></div>;
}
