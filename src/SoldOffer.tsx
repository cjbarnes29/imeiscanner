// After phones were sent: "Mark them as Sold?" Shows exactly what will change, then lets the person undo it.
import { createPortal } from 'react-dom';
import { useBackLayer } from './back-layer';

export type SoldGroup = { model: string; colour: string; owner: string; count: number; ids: string[]; /** colours to pick from when the phone has none */ options: string[] };

export function SoldOffer({ count, groups, done, noOwner, onMark, onColour, onUndo, onClose, onNever }: {
  count: number; groups: SoldGroup[]; done: boolean; noOwner: number;
  onMark: () => void; onColour: (ids: string[], colour: string) => void; onUndo: () => void; onClose: () => void; onNever: () => void;
}) {
  useBackLayer(true, onClose, 'sold-offer');
  return createPortal(<div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal retail-card rep-sheet rep-modal sold-offer" role="dialog" aria-modal="true" aria-label="Mark sent phones as Sold">
      {done ? <>
        <h3>{count} phone{count === 1 ? '' : 's'} marked Sold</h3>
        <p className="settings-help">The report stock went down and Sold went up, and each owner's Sold in Targets went up today.</p>
        <div className="share-toolbar"><button type="button" className="subtle-btn" onClick={onUndo}>Undo</button><button type="button" className="primary" onClick={onClose}>Done</button></div>
      </> : <>
        <h3>You sent {count} phone{count === 1 ? '' : 's'}. Mark them as Sold?</h3>
        <ul className="retail-list sold-groups">{groups.map(g => <li key={g.model + g.owner + g.colour}>
          <strong>{g.model}</strong>
          <span>{g.colour} × {g.count}</span>
          <small>Owner: {g.owner}</small>
          {g.colour === 'No colour' && <div className="sold-colour"><small>No colour is set, so no colour can come off the report. Pick the colour:</small>
            <div className="rep-sugg">{g.options.map(c => <button key={c} type="button" className="chip-btn" onClick={() => onColour(g.ids, c)}>{c}</button>)}{!g.options.length && <small>Set the colour in Phones first.</small>}</div></div>}
        </li>)}</ul>
        <p className="settings-help">Report: stock goes down and Sold goes up for these models and colours. Targets: each owner's Sold goes up today. You can undo it.{noOwner > 0 && ` ${noOwner} phone${noOwner === 1 ? ' has' : 's have'} no owner, so no target will change for ${noOwner === 1 ? 'it' : 'them'}.`}</p>
        <div className="share-toolbar"><button type="button" className="primary" onClick={onMark}>Mark as Sold</button><button type="button" className="subtle-btn" onClick={onClose}>Not now</button></div>
        <button type="button" className="subtle-btn" onClick={onNever}>Don't ask again</button>
      </>}
    </section>
  </div>, document.body);
}
