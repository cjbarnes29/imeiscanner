import {AutomaticAttention} from './AutomaticAttention';
import { useEffect, useState } from 'react';
import { dailyUploads } from './retail/daily-uploads';
import {automationCalendar,automaticSuggestion,setSuggestedPlan} from './retail/auto-workflow';
import {useWorkflowOptions} from './AutoWorkflow';
import { itemFor } from './retail/catalog';
import { calendarDates, scheduleFingerprint } from './retail/availability';
import { dateKey } from './retail/types';
import { segLabel } from './retail/segments';
import { type RetailCtx, who } from './retail/ui-helpers';

export function HomeAttention(ctx:RetailCtx){return <AutomaticAttention {...ctx}/>;}

export function QuickUploadCheck(ctx: RetailCtx) {
  const [date, setDate] = useState(ctx.today);
  const data = dailyUploads(ctx.records, date);
  return <details className="retail-card daily-upload-check"><summary><strong>Daily upload check</strong><small> · {data.quantity} IMEIs / {data.rows.length} records</small></summary><label className="plan-swap">Upload date<input aria-label="Daily upload date" type="date" value={date} onChange={e => setDate(e.target.value)} /></label><p className="settings-help">Grouped by current assigned person. Upload date is the record’s creation date; uploads are separate from sales, Stored releases and shift schedules.</p><p>{data.quantity} unique valid IMEIs · {data.duplicates} duplicate records · {data.review} need review.</p>{data.people.map(p => <section className="plan-preview-row" key={p.personId}><div className="plan-top"><strong>{who(ctx,p.personId)}</strong><span>{p.quantity} IMEIs / {p.rows.length} records</span></div>{p.models.map(model => <details key={model.model}><summary>{itemFor(ctx.state,model.model)?.name || model.model || 'Unknown model'} · {model.quantity}</summary><ul className="plan-imeis">{model.rows.map(r => <li key={r.id}>{r.imei || 'No IMEI'}{r.duplicate ? ' · Duplicate' : ''}{r.needsReview ? ' · Review' : ''}</li>)}</ul></details>)}<button className="plan-link" onClick={() => ctx.openUploads ? ctx.openUploads(date,p.personId) : ctx.openRecords(`day:${date}`)}>Open these phones →</button></section>)}{!data.rows.length && <p className="settings-help">No phone records uploaded on this date.</p>}</details>;
}
export function CalendarIMEIActivity({ ctx, date, person = 'all' }: { ctx: RetailCtx; date: string; person?: string }) {
  const options=useWorkflowOptions(),[scope,setScope]=useState<'day'|'general'>('day');
  useEffect(()=>setScope('day'),[date]);
  const rows=automationCalendar(ctx.state,ctx.records,ctx.people,ctx.today,options).filter(r=>(scope==='day'?r.date===date:r.status!=='completed')&&(person==='all'||r.personId===person));
  const uploads=dailyUploads(ctx.records,date,person);
  return <section className="retail-card imei-calendar-activity"><h3>{scope==='day'?`IMEI activity · ${date}`:'General · all planned days'}</h3><div className="give-tabs two" aria-label="Planned activity view"><button className={scope==='day'?'on':''} onClick={()=>setScope('day')}>This day</button><button className={scope==='general'?'on':''} onClick={()=>setScope('general')}>General · all planned days</button></div><p className="settings-help">Giving, Stored releases and report/share quantities. Shift schedules are separate. Proposed quantities can change with stock and availability; approved plans reserve actual IMEIs.</p><div className="plan-metrics"><div><strong>{rows.filter(r=>r.status==='approved').reduce((n,r)=>n+r.recordIds.length,0)}</strong><small>approved releases</small></div><div><strong>{rows.filter(r=>r.status==='proposed').reduce((n,r)=>n+r.recordIds.length,0)}</strong><small>proposed</small></div><div><strong>{scope==='day'?uploads.quantity:new Set(rows.map(r=>r.date)).size}</strong><small>{scope==='day'?'uploaded on selected date':'planned dates'}</small></div></div>{rows.map(row=>{
    const models=new Map<string,number>();for(const id of row.recordIds){const r=ctx.records.find(r=>r.id===id),name=r?itemFor(ctx.state,r.model)?.name||r.model||'Unknown model':'Phone unavailable';models.set(name,(models.get(name)||0)+1);}
    return <article className="plan-preview-row" key={row.id}><strong>{scope==='general'?`${row.date} · `:''}{who(ctx,row.personId)} · {row.status} {row.kind==='giving'?'giving':'release'} · {row.recordIds.length}</strong><p>{segLabel(ctx.state,row.segment)} · {Array.from(models,([name,n])=>`${name} × ${n}`).join(' · ')}</p>{row.kind==='release'&&<small>{row.reportQuantity} {row.status==='completed'?'already reported':'suggested for report/share · editable before preparation'}</small>}<details><summary>View selected IMEIs</summary><ul className="plan-imeis">{row.recordIds.map(id=><li key={id}>{ctx.records.find(r=>r.id===id)?.imei||'Phone unavailable'}</li>)}</ul></details><button className="plan-link" onClick={()=>{if(row.kind==='giving'){ctx.openPeople?.();return;}if(row.status!=='completed'){const approved=(ctx.state.releasePlans||[]).find(p=>p.entries.some(e=>e.id===row.id));const request=approved?.request||automaticSuggestion(ctx.state,ctx.records,row.personId,ctx.today,options).request;setSuggestedPlan({...request,date:request.date<ctx.today?ctx.today:request.date});}ctx.openPlan?.();}}>{row.kind==='giving'?'Review giving & limits':'Review / edit release plan'} →</button>{row.status==='approved'&&<button className="plan-link" onClick={()=>ctx.sharePhones?.(row.recordIds)}>Share reserved phones</button>}</article>;
  })}{!rows.length&&<p className="settings-help">No planned giving or Stored releases for this date.</p>}{scope==='day'&&uploads.people.map(p=><details key={p.personId}><summary>Uploaded · {who(ctx,p.personId)} · {p.quantity} IMEIs</summary>{p.models.map(m=><p key={m.model}>{itemFor(ctx.state,m.model)?.name||m.model} · {m.quantity}<br/><small>{m.rows.map(r=>r.imei||'No IMEI').join(', ')}</small></p>)}</details>)}</section>;
}

export function ScheduleReminder(ctx: RetailCtx) {
  const end = new Date(`${ctx.today}T12:00:00`); end.setDate(end.getDate()+6); const through=dateKey(end);
  const pending = ctx.state.rosterDrafts?.filter(d => d.status === 'pending').length || 0;
  const reviewed = !pending && !!ctx.state.scheduleReview && (!ctx.state.scheduleReview.from || ctx.state.scheduleReview.from <= ctx.today) && ctx.state.scheduleReview.through >= through && ctx.state.scheduleReview.fingerprint === scheduleFingerprint(ctx.state);
  const days=calendarDates(ctx.today,through);
  return <aside className={`retail-card schedule-reminder ${reviewed?'reviewed':'needs-review'}`} role="status"><div className="plan-top"><strong>{pending?`${pending} shift update${pending===1?'':'s'} awaiting approval`:reviewed?'✓ Shift schedule reviewed':'Check upcoming shift schedule'}</strong><button className="plan-link" onClick={ctx.openAvailability}>Open shifts →</button></div><p className="settings-help">{reviewed?`Reviewed through ${ctx.state.scheduleReview!.through}.`:`Review ${days[0]} to ${through}. Calendar or code edits reset this reminder.`} Shift availability and IMEI release plans are separate.</p></aside>;
}
