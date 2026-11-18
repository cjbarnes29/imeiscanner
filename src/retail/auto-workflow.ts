import { draftPlan } from './planning';
import { dateKey,daysInMonth,monthOf,type PlanRequest,type RetailState } from './types';
import type {RetailRecord} from './ui-helpers';
import {realStock} from './inventory';
import {calendarDates,workingDates} from './availability';
import {shiftCodes} from './shift-codes';
import {recommendFor,allocView} from './autogive';
import {applyAllocation} from './allocation';
export const WORKFLOW_KEY='retaillens-auto-workflow-v1',WORKFLOW_EVENT='retaillens-workflow-change';
/** Assistant = you approve every step. Copilot = you approve a whole task once. Autopilot = allowed kinds apply by themselves, always undoable and logged. */
export const AUTOPILOT_CLASSES:[string,string][]=[['stock','Store, hold or make phones available'],['give','Give phones to people'],['report','Edit report numbers'],['calendar','Unavailable dates and leave'],['routine','Daily routines'],['settings','App settings'],['targets','Target splits'],['accessory','Accessory stock'],['add-stock','Add manual phones']];
export const AUTOPILOT_DEFAULT_ALLOW=['stock','give','report','calendar','routine'];
export type WorkflowOptions={assistantMode:'assistant'|'copilot'|'autopilot';autopilotAllow:string[];autopilotDailyCap:number;enabled:boolean;assistantSuggestions:boolean;assistantIconMode:'summary'|'workspace';assistantChecks:boolean;hideSuggestions:boolean;suggestionChips:boolean;leaveSuggestions:boolean;routineLearning:boolean;routineMode:'off'|'suggest'|'prepare';targetLinkMode:'manual'|'linked';afterUpload:'ask'|'store'|'available';giving:'existing'|'suggest'|'auto';goalPercent:number;days:number;reserve:number;reportPercent:number;prepareAfterApproval:boolean;destination:'group'|'mobile';phone:string};
export const DEFAULT_WORKFLOW:WorkflowOptions={assistantMode:'assistant',autopilotAllow:AUTOPILOT_DEFAULT_ALLOW,autopilotDailyCap:20,enabled:true,assistantSuggestions:true,assistantIconMode:'summary',assistantChecks:true,hideSuggestions:false,suggestionChips:true,leaveSuggestions:true,routineLearning:true,routineMode:'suggest',targetLinkMode:'manual',afterUpload:'ask',giving:'existing',goalPercent:70,days:7,reserve:0,reportPercent:100,prepareAfterApproval:false,destination:'group',phone:''};
const integer=(v:unknown,min:number,max:number,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,Math.floor(v))):fallback;
export function readWorkflowOptions():WorkflowOptions{try{const v=JSON.parse(localStorage.getItem(WORKFLOW_KEY)||'{}');return{assistantMode:v.assistantMode==='copilot'||v.assistantMode==='autopilot'?v.assistantMode:'assistant',autopilotAllow:Array.isArray(v.autopilotAllow)?v.autopilotAllow.filter((k:unknown)=>AUTOPILOT_CLASSES.some(([c])=>c===k)):[...AUTOPILOT_DEFAULT_ALLOW],autopilotDailyCap:integer(v.autopilotDailyCap,1,200,20),enabled:v.enabled!==false,assistantSuggestions:v.assistantSuggestions!==false,assistantIconMode:v.assistantIconMode==='workspace'?'workspace':'summary',assistantChecks:v.assistantChecks!==false,hideSuggestions:v.hideSuggestions===true,suggestionChips:v.suggestionChips!==false,leaveSuggestions:v.leaveSuggestions!==false,routineLearning:v.routineLearning!==false,routineMode:v.routineMode==='prepare'?'prepare':v.routineMode==='off'?'off':'suggest',targetLinkMode:v.targetLinkMode==='linked'?'linked':'manual',afterUpload:['store','available'].includes(v.afterUpload)?v.afterUpload:'ask',giving:['suggest','auto'].includes(v.giving)?v.giving:'existing',goalPercent:integer(v.goalPercent,1,120,70),days:integer(v.days,1,31,7),reserve:integer(v.reserve,0,100000,0),reportPercent:integer(v.reportPercent,0,100,100),prepareAfterApproval:v.prepareAfterApproval===true,destination:v.destination==='mobile'?'mobile':'group',phone:typeof v.phone==='string'?v.phone.replace(/[^\d+() -]/g,'').slice(0,30):''};}catch{return{...DEFAULT_WORKFLOW};}}
/** One place decides whether a kind of suggestion may be shown. The master switch hides every kind; warnings and approvals are never suggestions. */
export type SuggestionKind='chips'|'next'|'routine'|'home'|'leave';
export const showSuggestions=(o:WorkflowOptions,kind:SuggestionKind)=>!o.hideSuggestions&&(kind==='chips'?o.suggestionChips:kind==='next'?o.assistantSuggestions:kind==='routine'?o.routineLearning:kind==='home'?o.enabled:o.leaveSuggestions);
export function saveWorkflowOptions(value:WorkflowOptions){try{localStorage.setItem(WORKFLOW_KEY,JSON.stringify(value));window.dispatchEvent(new Event(WORKFLOW_EVENT));return true;}catch{return false;}}
export function automaticSuggestion(state:RetailState,records:RetailRecord[],personId:string,today:string,options:WorkflowOptions){
  const end=`${monthOf(today)}-${daysInMonth(monthOf(today))}`,until=dateKey(new Date(new Date(`${today}T12:00:00`).getTime()+(options.days-1)*86400000));
  const request:PlanRequest={personId,segments:(state.targets[monthOf(today)]?.[personId]?.lines||[]).filter(l=>l.target>0).map(l=>l.segment),method:options.days>1?'spread':'goal',value:options.goalPercent,date:today,until:until>end?end:until,reserve:options.reserve,skipDays:[],priority:'lowest',milestones:[],quantityMode:'calculated'};
  const draft=draftPlan(state,records,request),releases=draft.entries.reduce((n,e)=>n+e.recordIds.length,0),shortage=draft.entries.reduce((n,e)=>n+Math.max(0,e.required-e.recordIds.length),0);
  const report=draft.entries.reduce((n,e)=>n+Math.floor(e.recordIds.length*options.reportPercent/100),0);
  return{request,draft,releases,report,shortage,blockedAvailability:!workingDates(state,personId,request.date,request.until).length,remainingStored:realStock(state,records).filter(r=>r.personId===personId&&state.recordMeta[r.id]?.status==='held').length-releases};
}
/** Sequential shared stock budget: a proposed IMEI can appear for only one person. */
export function* automaticSuggestions(state:RetailState,records:RetailRecord[],people:{id:string;name:string}[],today:string,options:WorkflowOptions){
  let remaining=records;const approved=new Set((state.releasePlans||[]).filter(p=>p.entries.some(e=>e.status==='scheduled')).map(p=>p.request.personId));
  for(const person of people){if(approved.has(person.id)||!state.targets[monthOf(today)]?.[person.id])continue;const result=automaticSuggestion(state,remaining,person.id,today,options),used=new Set(result.draft.entries.flatMap(e=>e.recordIds));remaining=remaining.filter(r=>!used.has(r.id));yield{personId:person.id,result};}
}
let suggested:PlanRequest|null=null;
export const setSuggestedPlan=(request:PlanRequest)=>{suggested=request;};
export const takeSuggestedPlan=()=>{const value=suggested;suggested=null;return value;};
/** Forecast only: ownership changes are simulated on copies, using known stock and daily limits. */
export function upcomingGiving(state:RetailState,records:RetailRecord[],people:{id:string;name:string}[],today:string,days:number){
  const end=`${monthOf(today)}-${daysInMonth(monthOf(today))}`,until=dateKey(new Date(new Date(`${today}T12:00:00`).getTime()+(Math.min(31,Math.max(1,days))-1)*86400000));
  let virtual=records.map(r=>({...r}));const rows:{date:string;personId:string;segment:string;quantity:number;recordIds:string[]}[]=[];
  for(const date of calendarDates(today,until>end?end:until)){
    const projected=date===today?state:{...state,shiftCodes:shiftCodes(state).map(code=>({...code,periods:[]})),workSchedules:Object.fromEntries(Object.entries(state.workSchedules||{}).map(([id,s])=>[id,{...s,windows:s.windows?.map(w=>({...w,startTime:undefined,endTime:undefined}))}]))};
    const recommendation=recommendFor(projected,monthOf(date),date,people,virtual);
    for(const p of recommendation.proposals)rows.push({date,personId:p.personId,segment:p.segment,quantity:p.recordIds.length,recordIds:[...p.recordIds]});
    const applied=applyAllocation(allocView(projected,monthOf(date),virtual),recommendation.proposals,new Set(recommendation.proposals.map(p=>p.id)),'recommended',monthOf(date),`${date}T12:00:00.000Z`);
    const owners=new Map(applied.moved.map(id=>[id,applied.records.find(r=>r.id===id)!.personId]));virtual=virtual.map(r=>owners.has(r.id)?{...r,personId:owners.get(r.id)!}:r);
  }
  return rows;
}

/** Calendar read model only. Approved reservations replace fresh proposals for that person. */
export function automationCalendar(state:RetailState,records:RetailRecord[],people:{id:string;name:string}[],today:string,options:WorkflowOptions){
  type Row={id:string;date:string;personId:string;segment:string;recordIds:string[];kind:'giving'|'release';status:'proposed'|'approved'|'completed';reportQuantity:number};
  const rows:Row[]=[],reserved=new Set<string>();
  for(const plan of state.releasePlans||[])for(const entry of plan.entries){
    if(entry.status!=='scheduled')continue;
    reserved.add(plan.request.personId);
    rows.push({id:entry.id,date:entry.date,personId:plan.request.personId,segment:entry.segment,recordIds:[...entry.recordIds],kind:'release',status:'approved',reportQuantity:Math.floor(entry.recordIds.length*options.reportPercent/100)});
  }
  for(const event of state.releases||[])if(event.status==='released')rows.push({id:event.id,date:event.date,personId:event.personId,segment:event.segment,recordIds:[...event.recordIds],kind:'release',status:'completed',reportQuantity:event.reportedIds.length});
  if(options.enabled){
    for(const {personId,result} of automaticSuggestions(state,records,people.filter(p=>!reserved.has(p.id)),today,options))for(const entry of result.draft.entries)if(entry.recordIds.length)rows.push({id:`proposed-${personId}-${entry.date}-${entry.segment}`,date:entry.date,personId,segment:entry.segment,recordIds:entry.recordIds,kind:'release',status:'proposed',reportQuantity:Math.floor(entry.recordIds.length*options.reportPercent/100)});
    for(const [i,row] of upcomingGiving(state,records,people,today,options.days).entries())rows.push({...row,id:'giving-'+i,kind:'giving',status:'proposed',reportQuantity:0});
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.personId.localeCompare(b.personId));
}
