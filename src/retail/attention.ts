import {calculatedDatedReport,compareDatedReport} from './dated-reports';
import {planFingerprint,pendingReleases} from './planning';
import {availabilityAt,availabilityLabel,scheduleFingerprint} from './availability';
import {reconcile} from './reconcile';
import {reportItems} from './stockreport';
import {accessoryIssues,accessoryKey} from './accessory-report';
import {segLabel} from './segments';
import {dateKey,monthOf,type RetailState} from './types';
import type {RetailRecord} from './ui-helpers';
export type AttentionItem={id:string;text:string;action:'scan'|'records'|'report'|'accessories'|'plan'|'shifts'|'assistant'|'targets'|'dated'|'diagnostics';date?:string;filter?:string;info?:boolean};
/** Shared read-only checks. No local model, sale, target change or external message is executed. */
export function attentionItems(state:RetailState,records:RetailRecord[],people:{id:string;name:string}[],today:string,counts:{scanning:number;needsReview:number}):AttentionItem[]{
  const items:AttentionItem[]=[];const add=(id:string,text:string,action:AttentionItem['action'],filter?:string,info=false)=>items.push({id,text,action,filter,info});
  if(counts.scanning)add('scanning',`${counts.scanning} photos processing in background`,'scan',undefined,true);
  if(counts.needsReview)add('review',`${counts.needsReview} phone records need review`,'records','Review');
  const duplicates=records.filter(r=>r.duplicate).length;if(duplicates)add('duplicates',`${duplicates} duplicate phone records need checking`,'records','Duplicates');
  if(state.pendingUploadIds?.length)add('uploads',`${state.pendingUploadIds.length} uploads need Store / Use now / Plan`,'scan');
  const pending=pendingReleases(state).length;if(pending)add('pending-report',`${pending} released IMEIs awaiting reporting`,'report');
  if(state.report){const check=reconcile(state,state.report,records).summary;if(check.differ+check.unknown)add('report',`${check.differ+check.unknown} phone report lines differ or are unknown`,'report');const low=reportItems(state.report).filter(r=>r.stock>0&&r.stock<=state.settings.lowStock);if(low.length)add('low-stock',`${low.length} phone report models have low stock`,'report');}
  for(const [date,draft] of Object.entries(state.reportDrafts||{})){if(date<today||date>dateKey(new Date(new Date(today+'T12:00:00').getTime()+7*86400000)))continue;const report=draft.mode==='auto'?calculatedDatedReport(state,records,date,today):draft.report,check=compareDatedReport(state,records,report,date,today);if(!check.match)items.push({id:'draft-'+date,text:`Report draft ${date}: ${check.differences.length} mismatches to review`,action:'dated',date});}
  if(state.accessoryReport){const issues=accessoryIssues(state.accessoryReport);if(issues.length)add('osr',`${issues.length} tablet/accessory OSR issues: ${issues[0]}`,'accessories');const differs=reportItems(state.accessoryReport).filter(r=>state.accessoryStock?.[accessoryKey(r.name)]&&state.accessoryStock[accessoryKey(r.name)].quantity!==r.stock);if(differs.length)add('accessory-stock',`${differs.length} OSR balances differ from saved accessory stock`,'accessories');}
  const fp=planFingerprint(state,records);
  for(const plan of state.releasePlans||[]){const scheduled=plan.entries.filter(e=>e.status==='scheduled'),due=scheduled.filter(e=>e.date<=today&&e.recordIds.length),person=people.find(p=>p.id===plan.request.personId)?.name||'Unknown person';if(scheduled.length&&plan.fingerprint!==fp)add('stale-'+plan.id,`${person}: stock or targets changed; review the approved plan`,'plan');if(due.length)add('due-'+plan.id,`${person}: ${due.reduce((n,e)=>n+e.recordIds.length,0)} IMEIs due for approval${availabilityAt(state,plan.request.personId,today)!=='working'?' · '+availabilityLabel(state,plan.request.personId,today):''}`,'plan');const shortage=scheduled.reduce((n,e)=>n+Math.max(0,e.required-e.recordIds.length),0);if(shortage)add('short-'+plan.id,`${person}: ${shortage} additional eligible phones needed for the saved plan`,'plan');}
  const pendingAssistant=state.assistantRequests?.filter(r=>r.status==='pending').length||0;if(pendingAssistant)add('assistant',`${pendingAssistant} assistant requests awaiting review`,'assistant');
  const files=state.assistantFiles||[],reading=files.filter(f=>['queued','reading'].includes(f.status)).length,failed=files.filter(f=>f.status==='failed').length;if(reading)add('reading',`${reading} assistant files reading locally`,'assistant',undefined,true);if(failed)add('files',`${failed} assistant files need attention`,'assistant');
  const roster=state.rosterDrafts?.filter(d=>d.status==='pending').length||0;if(roster)add('rosters',`${roster} shift calendar updates awaiting approval`,'shifts');
  const codes=state.shiftCodes?.filter(c=>c.needsReview).length||0;if(codes)add('codes',`${codes} shift codes need review before automatic giving`,'shifts');
  if(people.length){const end=dateKey(new Date(new Date(today+'T12:00:00').getTime()+6*86400000)),review=state.scheduleReview;if(!review||review.through<end||review.fingerprint!==scheduleFingerprint(state))add('schedule','Check the upcoming seven days of shift availability','shifts');}
  const targets=state.targets[monthOf(today)]||{};if(people.length&&!Object.keys(targets).length)add('targets','Monthly promoter targets are not set','targets');
  for(const [segment,total]of Object.entries(state.storeTargets?.[monthOf(today)]||{})){const sum=Object.values(targets).reduce((n,t)=>n+(t.lines.find(l=>l.segment===segment)?.target||0),0);if(sum!==total)add('balance-'+segment,`${segLabel(state,segment)}: store target ${total}, promoter total ${sum}. Review the balance`,'targets');}
  return items;
}
