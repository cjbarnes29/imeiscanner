import { APP_COMMIT, APP_VERSION } from './version';
const LOG='retaillens-diagnostics-v1', SESSION='retaillens-session-v1';
export type Diagnostic={at:string;code:string;type?:string;source?:string;line?:number};
const allowedType=(value:unknown)=>typeof value==='string'&&/^(?:[A-Za-z]{1,40}(?:Error|Exception)|Error|AbortError)$/.test(value)?value:'Error';
/** Never retains exception messages, record values, URLs, photos, contacts or filenames. */
export function safeDiagnostic(code:string,error?:unknown,line?:number):Diagnostic {
  const type=error&&typeof error==='object'&&'name' in error?allowedType(error.name):undefined;
  return {at:new Date().toISOString(),code:/^[a-z0-9-]{1,60}$/.test(code)?code:'app-error',type,line:typeof line==='number'?Math.max(0,Math.floor(line)):undefined};
}
export function readDiagnostics():Diagnostic[]{try{const value=JSON.parse(localStorage.getItem(LOG)||'[]');return Array.isArray(value)?value.slice(-80).map(v=>({...safeDiagnostic(v.code,{name:v.type},v.line),at:typeof v.at==='string'?v.at:''})):[];}catch{return[];}}
export function recordDiagnostic(code:string,error?:unknown,line?:number){try{localStorage.setItem(LOG,JSON.stringify([...readDiagnostics(),safeDiagnostic(code,error,line)].slice(-80)));window.dispatchEvent(new Event('retaillens-diagnostics'));}catch{/* failure logging must not break the app */}}
let initialized=false;
export let interruptedSession=false;
export function installDiagnostics(){
  if(initialized)return;initialized=true;
  try{const old=JSON.parse(localStorage.getItem(SESSION)||'null');interruptedSession=!!old?.active;if(interruptedSession)recordDiagnostic('previous-session-unclosed');localStorage.setItem(SESSION,JSON.stringify({active:true,at:new Date().toISOString()}));}catch{}
  window.addEventListener('error',event=>recordDiagnostic('uncaught-web-error',event.error,event.lineno));
  window.addEventListener('unhandledrejection',event=>recordDiagnostic('unhandled-promise',event.reason));
  window.addEventListener('pagehide',()=>{try{localStorage.setItem(SESSION,JSON.stringify({active:false,at:new Date().toISOString()}));}catch{}});
  window.addEventListener('pageshow',()=>{try{localStorage.setItem(SESSION,JSON.stringify({active:true,at:new Date().toISOString()}));}catch{}});
}
export function diagnosticReport(health:unknown,storage:unknown,counts:unknown){
  const h=(health&&typeof health==='object'?health:{}) as Record<string,unknown>;
  const numeric=(value:unknown)=>value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key,n])=>['quota','usage','records','pendingUploads','plans','remaining','completed','count','freeBytes'].includes(key)&&typeof n==='number'&&Number.isFinite(n))):{};
  const flags=Object.fromEntries(Object.entries(h).filter(([key,v])=>['active','canResume','notifications','batterySaver','batteryUnrestricted'].includes(key)&&typeof v==='boolean'));
  const crash=h.lastCrash&&typeof h.lastCrash==='object'?h.lastCrash as Record<string,unknown>:null;
  const safeHealth={...numeric(h),...flags,status:typeof h.status==='string'&&/^(idle|queued|processing|stopped|completed|error|failed)$/.test(h.status)?h.status:'unknown',checkError:h.checkError?allowedType(h.checkError):undefined,lastCrash:crash?{at:typeof crash.at==='number'?crash.at:0,type:allowedType(crash.type),frames:Array.isArray(crash.frames)?crash.frames.filter(f=>typeof f==='string'&&/^[A-Za-z_$][\w.$<>]*:\d+$/.test(f)).slice(0,12):[]}:undefined};
  return {format:'RetailLens diagnostic v1',version:APP_VERSION,commit:APP_COMMIT,generatedAt:new Date().toISOString(),previousSessionUnclosed:interruptedSession,events:readDiagnostics(),health:safeHealth,storage:numeric(storage),counts:numeric(counts),privacy:'Local technical events and aggregate counts only. No IMEIs, photos, names, contacts, report text or original files. Not a data backup.'};
}
