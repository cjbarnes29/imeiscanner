// RetailLens > Targets > Edit all: every person's target and sold count for every segment on one screen (a table that scrolls sideways, the person's
// name stays in view). Typing saves at once. Levels and the highest level of a line stay in the segment screen ("More"). The arithmetic is in
// src/retail/targets.ts and pace.ts (unit-tested); this file only shows it.
import { segLabel } from './retail/segments';
import { effectiveLevel, isCapped, needAt, setTargetLine } from './retail/targets';
import { finishAt, finishText } from './retail/pace';
import { monthOf, type Level, type Month, type Segment, type TargetLine } from './retail/types';
import { num, type RetailCtx } from './retail/ui-helpers';

/** A typed or pasted number: only the digits count. */
const typed = (value: string) => num(value.replace(/[^\d]/g, ''));

export function TargetGrid({ ctx, month, level, days, segs, onOpen, onClose }: { ctx: RetailCtx; month: Month; level: Level; days: number; segs: Segment[]; onOpen: (segment: Segment) => void; onClose: () => void }) {
  const { state, people, today } = ctx;
  const lineOf = (pid: string, segment: Segment): TargetLine => state.targets[month]?.[pid]?.lines.find(l => l.segment === segment) || { segment, target: 0, achieved: 0 };
  const set = (pid: string, segment: Segment, patch: Partial<TargetLine>) => ctx.change(setTargetLine(state, month, pid, segment, patch), '');
  const source = people.find(p => p.id === state.settings.myPersonId) || people[0];

  /** One column: the target of one person copied to everyone else. Only the target number; sold and levels stay each person's own. */
  const copyColumn = (segment: Segment) => {
    if (!source || people.length < 2) return;
    const value = lineOf(source.id, segment).target;
    let next = state;
    for (const p of people) if (p.id !== source.id) next = setTargetLine(next, month, p.id, segment, { target: value });
    ctx.change(next, 'copy target');
    ctx.notify(`${segLabel(state, segment)}: target ${value} copied from ${source.name} to ${people.length - 1} ${people.length === 2 ? 'person' : 'people'}. Sold was not changed.`);
  };

  const colTotals = segs.map(segment => people.reduce((a, p) => { const l = lineOf(p.id, segment); return { target: a.target + l.target, sold: a.sold + l.achieved }; }, { target: 0, sold: 0 }));

  return <section className="retail-card tg-grid-card">
    <div className="tg-head"><button type="button" className="subtle-btn" onClick={onClose}>← All segments</button><h3>Edit all</h3></div>
    <p className="settings-help">{days} day{days === 1 ? '' : 's'} left · {monthOf(today) === month ? `the line under each box shows ${level}%` : `month ${month}`}. Type each person’s target (T) and sold (S) for every segment. It saves as you type. Tap Levels to set the pieces for each level or the highest level.</p>
    {!people.length && <p className="settings-help">Add people in the People tab first.</p>}
    {people.length > 0 && <div className="tg-grid-scroll" role="region" aria-label="All targets and sold counts" tabIndex={0}>
      <table className="tg-grid">
        <thead><tr><th scope="col">Person</th>{segs.map((segment, k) => <th scope="col" key={segment}>{segLabel(state, segment)}
          {people.length > 1 && <button type="button" className="link-btn" aria-label={`Copy the target of ${source?.name} in ${segLabel(state, segment)} to everyone`} disabled={!source || lineOf(source.id, segment).target <= 0} onClick={() => copyColumn(segment)}>Copy to all</button>}
          <small>{colTotals[k].sold}/{colTotals[k].target}</small></th>)}<th scope="col">Total</th></tr></thead>
        <tbody>{people.map(p => {
          const total = segs.reduce((a, s) => { const l = lineOf(p.id, s); return { target: a.target + l.target, sold: a.sold + l.achieved }; }, { target: 0, sold: 0 });
          return <tr key={p.id}><th scope="row">{p.name}</th>
            {segs.map(segment => {
              const l = lineOf(p.id, segment);
              const used = l.target > 0 || l.achieved > 0;
              const capped = isCapped(l, level), custom = !!l.levels || l.cap !== undefined;
              const fin = !used ? '' : l.target <= 0 ? '' : capped ? `top is ${l.cap}%` : finishText(effectiveLevel(l, level), finishAt(needAt(l, level, days).remaining, l.achieved, month, today));
              return <td key={segment}><div className="tg-cell">
                <label><span>T</span><input aria-label={`Target of ${p.name} in ${segLabel(state, segment)}`} inputMode="numeric" value={l.target} onChange={e => set(p.id, segment, { target: typed(e.target.value) })} onFocus={e => e.currentTarget.select()} /></label>
                <label><span>S</span><input aria-label={`Sold of ${p.name} in ${segLabel(state, segment)}`} inputMode="numeric" value={l.achieved} onChange={e => set(p.id, segment, { achieved: typed(e.target.value) })} onFocus={e => e.currentTarget.select()} /></label>
                {fin && <small className="tg-cell-fin">{fin}</small>}
                <button type="button" className="link-btn" aria-label={`Levels of ${p.name} in ${segLabel(state, segment)}`} onClick={() => onOpen(segment)}>{custom ? 'Levels •' : 'Levels'}</button>
              </div></td>;
            })}
            <td className="tg-total"><b>{total.sold}</b>/{total.target}</td></tr>;
        })}</tbody>
        <tfoot><tr><th scope="row">All</th>{colTotals.map((t, k) => <td key={segs[k]} className="tg-total"><b>{t.sold}</b>/{t.target}</td>)}<td className="tg-total"><b>{colTotals.reduce((a, t) => a + t.sold, 0)}</b>/{colTotals.reduce((a, t) => a + t.target, 0)}</td></tr></tfoot>
      </table>
    </div>}
  </section>;
}
