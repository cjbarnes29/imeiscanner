import {PROCESSING_KEY,PROCESSING_EVENT,readProcessingOptions,type ProcessingOptions} from './processing-options';
import {WORKFLOW_KEY,WORKFLOW_EVENT,readWorkflowOptions,type WorkflowOptions} from './retail/auto-workflow';
import {HOME_KEY,HOME_EVENT,HOME_SECTIONS,readHomeOptions,type HomeOptions} from './home-options';
export const ASSISTANT_SETTING_KEYS=[PROCESSING_KEY,WORKFLOW_KEY,HOME_KEY];
export type SettingsSnapshot=Record<string,string|null>;
export type SettingsProposal={processing:Partial<ProcessingOptions>;workflow:Partial<WorkflowOptions>;home:HomeOptions;replaceHome?:boolean;lines:string[];notes:string[]};
export const settingsSnapshot=():SettingsSnapshot=>Object.fromEntries(ASSISTANT_SETTING_KEYS.map(key=>[key,localStorage.getItem(key)]));
export function explainSettings(){const p=readProcessingOptions(),w=readWorkflowOptions(),h=readHomeOptions();return `Current global settings: box detection ${p.autoFindBoxes?'on':'off'}, automatic retries ${p.autoRetry?'on':'off'}, saved-picture checks ${p.autoReview?'on':'off'}, manual edit priority ${p.pauseWhileEditing?'on':'off'}. Upload action: ${w.afterUpload}; giving: ${w.giving}; goal ${w.goalPercent}%, horizon ${w.days} days, report/share ${w.reportPercent}%. Target policy: ${w.targetLinkMode}. AI icon: ${w.assistantIconMode}; Routine learning ${w.routineLearning?'on':'off'}, daily mode ${w.routineMode}. Suggestions ${w.hideSuggestions?'hidden':'shown'}. Home: ${Object.values(h).filter(v=>v==='hide').length} sections hidden, ${Object.values(h).filter(v=>v==='show').length} always shown. These are device-wide settings; they do not confirm sales.`;}
export function interpretSettings(text:string):SettingsProposal|null{
  const q=text.toLowerCase().replace(/auto[- ]detect/g,'automatic detection');
  const relevant=/settings?|options?|configuration|routine learning|routine mode|suggest.*(?:assistant|steps)|assistant.*suggest|automatic detection|auto.?retry|manual mode|automatic mode|auto mode|uploads? automatically|auto.?giv|home.*(?:show|hide)|(?:show|hide).*home|(?:hide|show|turn on|turn off|stop showing).*suggestions?/.test(q);
  if(!relevant)return null;
  const out:SettingsProposal={processing:{},workflow:{},home:{},lines:[],notes:[]};
  if(/(?:don't|do not|never|don’t)\s+(?:disable|stop|turn|enable|use)/.test(q)){out.notes.push('Clarify the desired on/off state; a negated instruction will not be guessed.');return out;}
  const currentP=readProcessingOptions(),currentW=readWorkflowOptions();
  const changeP=(key:keyof ProcessingOptions,value:boolean,label:string)=>{out.processing[key]=value;out.lines.push(`${label}: ${currentP[key]?'on':'off'} → ${value?'on':'off'}`);};
  const changeW=<K extends keyof WorkflowOptions>(key:K,value:WorkflowOptions[K],label:string)=>{Object.assign(out.workflow,{[key]:value});out.lines.push(`${label}: ${currentW[key]} → ${value}`);};
  if(/\b(?:manual|automatic|auto) mode\b/.test(q)){const on=!/manual mode/.test(q);for(const key of ['autoFindBoxes','autoRetry','autoSplit','autoReview'] as const)changeP(key,on,key);changeP('pauseWhileEditing',true,'Manual edit priority');changeP('backgroundSingleCrop',true,'Background crop processing');}
  const suggestionCommand=/(?:hide|stop showing|turn off).*suggestions?/.test(q)?'hide':/(?:show|turn on).*suggestions?/.test(q)&&!/next|steps|routine|chip|leave/.test(q)?'show':'';
  if(suggestionCommand)changeW('hideSuggestions',suggestionCommand==='hide','Hide all suggestions');
  for(const clause of q.split(/[,;\n]|\band\b/)){
    const off=/\b(?:off|disable|stop|never)\b|don't|do not/.test(clause),on=/\b(?:on|enable|start)\b/.test(clause);
    const features:[RegExp,keyof ProcessingOptions,string][]=[[/detect|find.*box/,'autoFindBoxes','Box detection'],[/retr(?:y|ies)/,'autoRetry','Automatic retries'],[/saved.*(?:picture|photo)|unresolved/,'autoReview','Saved-picture checks'],[/multi.product|split.*photo/,'autoSplit','Multi-product checks'],[/preload|warm.*ocr/,'preloadReader','Preload OCR'],[/editing priority|pause.*edit/,'pauseWhileEditing','Manual edit priority'],[/live.*preview/,'livePlanPreview','Live scan plan preview'],[/background.*crop/,'backgroundSingleCrop','Background crop processing']];
    for(const [pattern,key,label] of features)if(pattern.test(clause)&&(on||off)){if(on&&off)out.notes.push(`Clarify whether ${label} should be on or off.`);else changeP(key,on,label);}
    if(/store.*uploads?.*automatically|uploads?.*store.*automatically|automatically.*store.*uploads?/.test(clause))changeW('afterUpload',off?'ask':'store','After upload');
    if(/routine learning/.test(clause)&&(on||off)){changeW('routineLearning',on,'Routine learning');changeW('routineMode',on?'suggest':'off','Daily routine mode');}
    const routineMode=clause.match(/routine mode.*\b(prepare|suggest|off)\b/);if(routineMode)changeW('routineMode',routineMode[1] as WorkflowOptions['routineMode'],'Daily routine mode');
    if(/assistant.*suggest|suggest.*(?:assistant|steps)/.test(clause)&&(on||off))changeW('assistantSuggestions',on,'Assistant next-step suggestions');
    if(/auto.?giv|giving.*automatic/.test(clause)&&(on||off))changeW('giving',off?'suggest':'auto','Giving ownership');
    const report=clause.match(/(?:report|share).*?(\d{1,3})\s*(?:%|percent)/);if(report&&/set|default|settings|options/.test(clause)&&+report[1]<=100)changeW('reportPercent',+report[1],'Default report/share percent');
    const goal=clause.match(/goal.*?(\d{1,3})\s*(?:%|percent)/);if(goal&&/set|default|settings|options/.test(clause)&&+goal[1]>=1&&+goal[1]<=120)changeW('goalPercent',+goal[1],'Default goal percent');
    const days=clause.match(/(?:horizon|upcoming|next)\s+(\d{1,2})\s*days?/);if(days&&/set|default|settings|options/.test(clause)&&+days[1]>=1&&+days[1]<=31)changeW('days',+days[1],'Upcoming days');
    if(/target.*(?:policy|setting)|(?:policy|setting).*target/.test(clause)){if(/manual/.test(clause))changeW('targetLinkMode','manual','Global target policy');else if(/linked|link.*calendar/.test(clause))changeW('targetLinkMode','linked','Global target policy');}
  }
  if(/home/.test(q)&&/only/.test(q)&&/plans?/.test(q)&&/warnings?|attention/.test(q)){out.replaceHome=true;out.home=Object.fromEntries(HOME_SECTIONS.map(([key])=>[key,['assistantReview','attention','plan','automation'].includes(key)?'show':'hide']));out.lines.push('Home: show assistant review, attention, today’s plan and upcoming automation; hide other Home cards. Other tabs remain available.');}
  else if(/home/.test(q)){
    const aliases:Record<string,RegExp>={assistantReview:/assistant.*(?:review|history)|(?:review|history).*assistant/,attention:/warnings?|attention/,plan:/plans?/,automation:/automation|upcoming/,assistant:/assistant|local ai/,shifts:/shift|schedule/,delivery:/whatsapp|prepared/,uploads:/daily upload/,accessories:/accessories|tablet/,people:/people|person filter/,stats:/summary|numbers/,priorities:/priorit/,help:/need help/,outlook:/outlook/,report:/report/,unassigned:/unassigned/,low:/low stock/,checklist:/checklist/,recent:/recent/,firstUse:/first.time|setup/,multi:/multi.product/};
    const hide=/hide|remove/.test(q),show=/show|display/.test(q);if(hide!==show)for(const [key,label] of HOME_SECTIONS)if(aliases[key]?.test(q)){out.home[key]=hide?'hide':'show';out.lines.push(`Home ${label}: ${hide?'hide':'always show'}`);}
  }
  if(!out.lines.length&&!/check|explain|current|what|how/.test(q))out.notes.push('Specify the setting and its value. Examples: “turn off auto-detection”, “store uploads automatically”, “show only plans and warnings on Home”.');
  return out;
}
export function proposedSettings(proposal:SettingsProposal):SettingsSnapshot{const next:SettingsSnapshot={};if(Object.keys(proposal.processing).length)next[PROCESSING_KEY]=JSON.stringify({...readProcessingOptions(),...proposal.processing});if(Object.keys(proposal.workflow).length)next[WORKFLOW_KEY]=JSON.stringify({...readWorkflowOptions(),...proposal.workflow});if(Object.keys(proposal.home).length||proposal.replaceHome)next[HOME_KEY]=JSON.stringify({...(proposal.replaceHome?{}:readHomeOptions()),...proposal.home});return next;}
/** Apply only allowlisted device preferences. Dispatch after every write succeeds. */
export function writeSettingsSnapshot(next:SettingsSnapshot){const before=settingsSnapshot();try{for(const [key,value] of Object.entries(next)){if(!ASSISTANT_SETTING_KEYS.includes(key))throw new Error('Unsupported setting');if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}}catch{for(const [key,value] of Object.entries(before))try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch{/* Surface failure; never claim success. */}throw new Error('Settings could not be saved. Review them in Settings.');}for(const event of [PROCESSING_EVENT,WORKFLOW_EVENT,HOME_EVENT])window.dispatchEvent(new Event(event));}
