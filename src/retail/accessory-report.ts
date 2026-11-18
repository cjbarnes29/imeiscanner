import { listedSold, parseReport, reportItems } from './stockreport';
import type { RetailState, StockReport } from './types';
import { withAudit } from './data';

export const accessoryKey = (name:string) => name.trim().replace(/\s+/g,' ').toLowerCase();
export function accessoryStockChanges(state:RetailState, report:StockReport) {
  return reportItems(report).map(item=>({name:item.name,key:accessoryKey(item.name),before:state.accessoryStock?.[accessoryKey(item.name)]?.quantity||0,after:item.stock}));
}
/** Approved report balances replace matching model quantities, never add the same snapshot twice. */
export function applyAccessoryStock(state:RetailState, report:StockReport, at=new Date().toISOString()):RetailState {
  if(!reportItems(report).length)throw new Error('No accessory models to update.');
  const changes=accessoryStockChanges(state,report);
  if(new Set(changes.map(c=>c.key)).size!==changes.length)throw new Error('Resolve duplicate accessory model names before applying stock.');
  const stock={...state.accessoryStock};
  for(const row of changes)stock[row.key]={name:row.name,quantity:row.after,updatedAt:at,reportDate:report.dateText};
  return withAudit({...state,accessoryStock:stock},'accessory stock snapshot applied',`${changes.length} model balances set from report dated ${report.dateText||'not specified'}; ${changes.filter(c=>c.before!==c.after).length} changed. Phone stock unchanged.`);
}

export const ACCESSORY_MODELS = ['TAB A9','TAB A9+','TAB A11','TAB A11+','S9FE','S9FE+','S10+','S10 Ultra','S10 FE','S10 FE+','S10 Lite','S11','S11 Ultra','Watch Ultra (2025)','Watch Ultra2','Watch 8','Watch 8 Classic','Watch 7','Watch FE','Fit3','Buds4','Buds4 Pro','Buds Core','Buds3','Buds3 Pro','Buds3 FE','Buds Core + Fit3 Bundle'];
/** Blank editable layout; no actual store, contact or inventory data is bundled. */
export function accessoryTemplate(date: string): StockReport {
  return parseReport(['Daily OSR','Location:','Reported By:','TL:',`Date: ${date}`,'','Model: Sales / Stock',...ACCESSORY_MODELS.map(name=>`${name}: 00/00`),'','Brandwise Daily Total Sellout','Samsung Sold: 00','───'].join('\n'));
}
export function accessoryIssues(report: StockReport): string[] {
  const issues: string[]=[];
  if(!reportItems(report).length)issues.push('No model lines were found.');
  if(report.totalSellout&&report.totalSellout.typed!==listedSold(report))issues.push(`Listed sales ${listedSold(report)} do not match Samsung/total sold ${report.totalSellout.typed}.`);
  const seen=new Set<string>();
  for(const item of reportItems(report)){const key=item.name.trim().toLowerCase();if(seen.has(key))issues.push(`Duplicate model: ${item.name}.`);seen.add(key);}
  return issues;
}
