export const HOME_KEY='retaillens-home-layout-v1',HOME_EVENT='retaillens-home-layout-change';
export const HOME_SECTIONS=[
  ['assistantReview','Assistant requests & History','.assistant-requests'],['attention','Needs attention','.home-attention'],['plan','Today’s plan & upcoming approved releases','.plan-home'],
  ['automation','Today & coming days automation','.auto-suggestions'],['assistant','Local assistant & automation shortcut','.home-automation'],
  ['shifts','Shift schedule reminder','.schedule-reminder'],['delivery','Prepared reports & WhatsApp','.delivery-packets'],
  ['uploads','Daily upload check','.daily-upload-check'],['accessories','Tablets & accessories stock','.accessory-home-summary'],
  ['people','People filter','.who-chips'],['stats','Summary numbers','.retail-stats'],['priorities','Selling priorities','.home-priorities'],
  ['help','People who need help','.home-needs-help'],['outlook','Month outlook','.fc-card'],['report','Phone report summary','.home-report'],
  ['unassigned','Unassigned phones','.home-unassigned'],['low','Low stock','.home-lowstock'],['checklist','Today’s checklist','.home-checklist'],
  ['recent','Recent uploads by day','.home-recent'],['firstUse','First-time setup guide','.first-use-checklist'],
  ['multi','Multi-product photo notice','.swipe-notice'],
] as const;
export type HomeKey=typeof HOME_SECTIONS[number][0];
export type HomeOptions=Partial<Record<HomeKey,'show'|'hide'>>;
export function readHomeOptions():HomeOptions{try{const data=JSON.parse(localStorage.getItem(HOME_KEY)||'{}');return Object.fromEntries(HOME_SECTIONS.flatMap(([key])=>data?.[key]==='show'||data?.[key]==='hide'?[[key,data[key]]]:[]));}catch{return{};}}
export function saveHomeOptions(value:HomeOptions){try{localStorage.setItem(HOME_KEY,JSON.stringify(value));window.dispatchEvent(new Event(HOME_EVENT));return true;}catch{return false;}}
/** Fixed catalog selectors only; saved data cannot inject CSS. Defaults retain existing Show all behavior. */
export function homeLayoutCSS(options:HomeOptions){return HOME_SECTIONS.flatMap(([key,,selector])=>options[key]?[(key==='multi'?'.app main ':'.app main[data-detail-mode]:not(.simple-mode) .retail-today>')+selector+`{display:${options[key]==='hide'?'none':key==='people'?'flex':key==='stats'?'grid':'block'}!important}`]:[]).join('\n');}
