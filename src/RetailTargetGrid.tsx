// AI LENS > Targets > Edit all: every person's target and sold count for every segment on one screen. One card per person, one row per segment with the
// segment's name, so every box says which segment it belongs to (a wide table lost its labels on a phone). Typing saves at once. Levels and the highest
// level of a line stay in the segment screen ("Levels"). The arithmetic is in src/retail/targets.ts and pace.ts (unit-tested); this file only shows it.
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

  /** One segment: the target of one person copied to everyone else. Only the target number; sold and levels stay each person's own. */
  const copyRow = (segment: Segment) => {
    if (!source || people.length < 2) return;
    const value = lineOf(source.id, segment).target;
    let next = state;
    for (const p of people) if (p.id !== source.id) next = setTargetLine(next, month, p.id, segment, { target: value });
    ctx.change(next, 'copy target');
    ctx.notify(`${segLabel(state, segment)}: target ${value} copied from ${source.name} to ${people.length - 1} ${people.length === 2 ? 'person' : 'people'}. Sold was not changed.`);
  };

  const segTotals = segs.map(segment => people.reduce((a, p) => { const l = lineOf(p.id, segment); return { target: a.target + l.target, sold: a.sold + l.achieved }; }, { target: 0, sold: 0 }));

  return <section className="retail-card tg-grid-card">
    <div className="tg-head"><button type="button" className="subtle-btn" onClick={onClose}>← All segments</button><h3>Edit all</h3></div>
    <p className="settings-help">{days} day{days === 1 ? '' : 's'} left · {monthOf(today) === month ? `the grey line under a segment shows ${level}%` : `month ${month}`}. For every person and every segment, type the target and the sold count. It saves as you type. Tap Levels to set the pieces for each level or the highest level.</p>
    {!people.length && <p className="settings-help">Add people in the People tab first.</p>}
    {people.length > 0 && <div className="tg-people-grid">
      {people.map(p => {
        const total = segs.reduce((a, s) => { const l = lineOf(p.id, s); return { target: a.target + l.target, sold: a.sold + l.achieved }; }, { target: 0, sold: 0 });
        return <div key={p.id} className="tg-pcard" role="group" aria-label={`Targets of ${p.name}`}>
          <div className="tg-top"><strong>{p.name}</strong><small>Sold {total.sold} of {total.target}</small></div>
          <div className="tg-colhead" aria-hidden="true"><span>Segment</span><span>Target</span><span>Sold</span></div>
          {segs.map(segment => {
            const l = lineOf(p.id, segment);
            const capped = isCapped(l, level), custom = !!l.levels || l.cap !== undefined;
            const fin = l.target <= 0 ? '' : capped ? `top is ${l.cap}%` : finishText(effectiveLevel(l, level), finishAt(needAt(l, level, days).remaining, l.achieved, month, today));
            const name = segLabel(state, segment);
            return <div key={segment} className="tg-row">
              <div className="tg-rowname"><strong>{name}</strong>
                {fin && <small className="tg-cell-fin">{fin}</small>}
                <span className="tg-row-links"><button type="button" className="link-btn" aria-label={`Levels of ${p.name} in ${name}`} onClick={() => onOpen(segment)}>{custom ? 'Levels •' : 'Levels'}</button>
                  {people.length > 1 && source?.id === p.id && <button type="button" className="link-btn" aria-label={`Copy the target of ${p.name} in ${name} to everyone`} disabled={l.target <= 0} onClick={() => copyRow(segment)}>Copy to all</button>}</span></div>
              <input aria-label={`Target of ${p.name} in ${name}`} inputMode="numeric" value={l.target} onChange={e => set(p.id, segment, { target: typed(e.target.value) })} onFocus={e => e.currentTarget.select()} />
              <input aria-label={`Sold of ${p.name} in ${name}`} inputMode="numeric" value={l.achieved} onChange={e => set(p.id, segment, { achieved: typed(e.target.value) })} onFocus={e => e.currentTarget.select()} />
            </div>;
          })}
        </div>;
      })}
      <div className="tg-pcard tg-allcard" role="group" aria-label="Everyone together">
        <div className="tg-top"><strong>Everyone together</strong><small>Sold of target</small></div>
        {segs.map((segment, k) => <div key={segment} className="tg-row tg-total-row"><div className="tg-rowname"><strong>{segLabel(state, segment)}</strong></div><span className="tg-total" data-total={segLabel(state, segment)}><b>{segTotals[k].sold}</b>/{segTotals[k].target}</span></div>)}
      </div>
    </div>}
  </section>;
}
