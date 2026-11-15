import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

/** One record in the fast review list. Words and numbers only; the photo is the label crop. */
export type BulkRow = { id: string; name: string; photo: string; imei: string; serial: string; model: string; note: string; status: string; looksRight: boolean };
type Fields = { imei: string; serial: string };

type Props = {
  rows: BulkRow[];
  /** How many of the shown rows are tick-able at once (valid IMEI, nothing flagged about the number). */
  goodCount: number;
  acceptedCount: number;
  /** Autosave while typing. Never refuses: an unfinished IMEI is kept and flagged by the caller. */
  onSave: (id: string, fields: Fields) => void;
  /** The tick: the person confirms the row. Returns an error text when the row cannot be confirmed yet. */
  onDone: (id: string, fields: Fields) => string | null;
  onFull: (id: string) => void;
  onAccept: () => void;
  onUndoAccept: () => void;
  onClose: () => void;
};

const digitsOnly = (text: string) => text.replace(/\D/g, '').slice(0, 15);

/** The fast list: every record that needs a look, with its label photo and editable IMEI and serial. Edits save as you type. */
export function BulkReview({ rows, goodCount, acceptedCount, onSave, onDone, onFull, onAccept, onUndoAccept, onClose }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Fields>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, number>>({});
  const latest = useRef({ rows, drafts, onSave });
  latest.current = { rows, drafts, onSave };

  function save(id: string) {
    window.clearTimeout(timers.current[id]);
    delete timers.current[id];
    const { rows: now, drafts: ds, onSave: persist } = latest.current;
    const row = now.find(item => item.id === id);
    const draft = ds[id];
    if (row && draft && (draft.imei !== row.imei || draft.serial !== row.serial)) persist(id, draft);
  }
  function edit(row: BulkRow, change: Partial<Fields>) {
    const next: Fields = { ...(drafts[row.id] ?? { imei: row.imei, serial: row.serial }), ...change };
    latest.current.drafts = { ...latest.current.drafts, [row.id]: next };
    setDrafts(old => ({ ...old, [row.id]: next }));
    setErrors(old => { if (!old[row.id]) return old; const { [row.id]: _gone, ...rest } = old; return rest; });
    window.clearTimeout(timers.current[row.id]);
    timers.current[row.id] = window.setTimeout(() => save(row.id), 700);
  }
  // Leaving the list (button, back gesture, or a new scan) saves whatever is still waiting; nothing is dropped.
  useEffect(() => () => { for (const id of Object.keys(timers.current)) save(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function focusNext(from: HTMLElement, field: 'imei' | 'serial') {
    const rowEl = from.closest('.bulk-row');
    if (field === 'imei') { rowEl?.querySelector<HTMLInputElement>('input[data-field="serial"]')?.focus(); return; }
    (rowEl?.nextElementSibling as HTMLElement | null)?.querySelector<HTMLInputElement>('input[data-field="imei"]')?.focus();
  }
  function done(row: BulkRow) {
    const fields: Fields = drafts[row.id] ?? { imei: row.imei, serial: row.serial };
    window.clearTimeout(timers.current[row.id]); delete timers.current[row.id];
    const problem = onDone(row.id, fields);
    if (problem) setErrors(old => ({ ...old, [row.id]: problem }));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal bulk-review" role="dialog" aria-modal="true" aria-label="Review scanned records" onClick={event => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">REVIEW</div>
            <h2>{rows.length ? `${rows.length} left to check` : 'All checked'}</h2>
          </div>
          <button className="iconbtn" aria-label="Close review" onClick={onClose}><X /></button>
        </div>
        {(goodCount > 0 || acceptedCount > 0) && <div className="bulk-accept" role="group" aria-label="Accept records that look right">
          {goodCount > 0 && <button type="button" className="primary" onClick={onAccept}>Accept {goodCount} that look right</button>}
          {acceptedCount > 0 && <span>Accepted {acceptedCount}. <button type="button" className="subtle-btn" onClick={onUndoAccept}>Undo</button></span>}
        </div>}
        <ul className="bulk-list">
          {rows.map(row => {
            const draft = drafts[row.id];
            const imei = draft ? draft.imei : row.imei;
            const serial = draft ? draft.serial : row.serial;
            const unfinished = !!imei && !/^\d{15}$/.test(imei);
            return (
              <li key={row.id} className="bulk-row">
                <button type="button" className="bulk-photo" aria-label={`Open ${row.name} in full`} onClick={() => onFull(row.id)}>
                  <img src={row.photo} alt="" decoding="async" loading="lazy" />
                </button>
                <div className="bulk-fields">
                  <label>IMEI 1
                    <input data-field="imei" inputMode="numeric" value={imei} onChange={event => edit(row, { imei: digitsOnly(event.target.value) })} onBlur={() => save(row.id)}
                      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); focusNext(event.currentTarget, 'imei'); } }} />
                  </label>
                  <label>Serial
                    <input data-field="serial" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={serial} onChange={event => edit(row, { serial: event.target.value })} onBlur={() => save(row.id)}
                      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); save(row.id); focusNext(event.currentTarget, 'serial'); } }} />
                  </label>
                  <div className="bulk-meta">
                    <span className="bulk-model">{row.model}</span>
                    {errors[row.id] ? <span className="bulk-error" role="alert">{errors[row.id]}</span>
                      : unfinished ? <span className="bulk-error">{imei.length} of 15 digits</span>
                      : row.note ? <span className="bulk-note">{row.note}</span> : <span className="bulk-note">{row.status}</span>}
                  </div>
                </div>
                <button type="button" className="bulk-done primary" aria-label={`Mark ${row.name} as checked`} onClick={() => done(row)}><Check size={20} /></button>
              </li>
            );
          })}
        </ul>
        <div className="bulk-foot"><button type="button" className="primary" onClick={onClose}>{rows.length ? 'Close (edits are saved)' : 'Done'}</button></div>
      </section>
    </div>
  );
}
