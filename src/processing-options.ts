export const PROCESSING_KEY='retaillens-processing-v1';
export const PROCESSING_EVENT='retaillens-processing-change', EDIT_EVENT='retaillens-edit-activity';
export const PROCESSING_DEFAULTS={autoFindBoxes:true,pauseWhileEditing:true,backgroundSingleCrop:true,preloadReader:false,autoRetry:true,autoSplit:true,autoReview:true,livePlanPreview:true};
export type ProcessingOptions=typeof PROCESSING_DEFAULTS;
export function readProcessingOptions():ProcessingOptions{try{const value=JSON.parse(localStorage.getItem(PROCESSING_KEY)||'{}');return Object.fromEntries(Object.entries(PROCESSING_DEFAULTS).map(([key,defaultValue])=>[key,typeof value?.[key]==='boolean'?value[key]:key==='livePlanPreview'?localStorage.getItem('retaillens-live-plan')!=='off':defaultValue])) as ProcessingOptions;}catch{return {...PROCESSING_DEFAULTS};}}
export function saveProcessingOptions(options:ProcessingOptions){try{localStorage.setItem(PROCESSING_KEY,JSON.stringify(options));window.dispatchEvent(new Event(PROCESSING_EVENT));return true;}catch{return false;}}
const editors=new Set<symbol>();let revision=0;const photoRevisions=new Map<string,number>(),activePhotos=new Map<string,number>();
export const manualEditRevision=(id?:string)=>id?photoRevisions.get(id)||0:revision;
export const isPhotoBeingEdited=(id:string)=>!!activePhotos.get(id);
export const hasManualEditor=()=>editors.size>0;
export const backgroundDeferred=()=>hasManualEditor()&&readProcessingOptions().pauseWhileEditing;
export function beginManualEdit(id=''){const token=Symbol();editors.add(token);revision++;if(id){photoRevisions.set(id,(photoRevisions.get(id)||0)+1);activePhotos.set(id,(activePhotos.get(id)||0)+1);}window.dispatchEvent(new Event(EDIT_EVENT));return()=>{if(!editors.delete(token))return;if(id){const count=(activePhotos.get(id)||1)-1;if(count)activePhotos.set(id,count);else activePhotos.delete(id);}window.dispatchEvent(new Event(EDIT_EVENT));};}
/** Cooperative gate: no polling, no discarded user data; resumes when the last editor closes. */
export function waitForManualIdle(signal?:AbortSignal):Promise<void>{if(signal?.aborted||!backgroundDeferred())return Promise.resolve();return new Promise(resolve=>{const cleanup=()=>{window.removeEventListener(EDIT_EVENT,check);window.removeEventListener(PROCESSING_EVENT,check);signal?.removeEventListener('abort',check);};const check=()=>{if(!signal?.aborted&&backgroundDeferred())return;cleanup();resolve();};window.addEventListener(EDIT_EVENT,check);window.addEventListener(PROCESSING_EVENT,check);signal?.addEventListener('abort',check,{once:true});check();});}
/** Stale auto-detection must never replace drawing, another photo or a rotated source. */
export class ResultGuard{private revision=0;invalidate(){this.revision++;}start(){return ++this.revision;}accept(token:number){return this.revision===token;}}
