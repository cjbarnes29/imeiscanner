import { calculatedDatedReport } from './dated-reports';
import { includeReleased, pendingReleases } from './planning';
import { syncScans, withBaseline } from './reportsync';
import { buildReport } from './stockreport';
import { itemFor } from './catalog';
import { withAudit } from './data';
import type { DeliveryPacket, DeliverySetting, RetailState } from './types';
import type { RetailRecord } from './ui-helpers';
export const defaultDelivery = (): DeliverySetting => ({ enabled:false,destination:'mobile',phone:'',includeReport:true,includeImeis:true,reportMode:'all',quantities:{} });
export const cleanPhone = (phone: string) => phone.replace(/[+()\s-]/g,'');
export const validPhone = (phone: string) => /^[1-9]\d{7,14}$/.test(cleanPhone(phone));
export const deliveryFingerprint = (state:RetailState,records:RetailRecord[]) => JSON.stringify([state.recordMeta,state.report?.entries,records.map(r=>[r.id,r.model,r.imei,r.personId])]);
/** Called only after explicit sale approval. Preparation is distinct from external sending/delivery. */
export function prepareDelivery(state:RetailState,records:RetailRecord[],releaseIds:string[],personId:string,today:string,name:string):{state:RetailState;packet?:DeliveryPacket} {
  const setting=state.deliverySettings?.[personId];if(!setting?.enabled)return{state};
  if(setting.destination==='mobile'&&!validPhone(setting.phone))throw new Error('Review the saved international WhatsApp number before preparing delivery.');
  const previous=state.deliveryPackets?.find(p=>p.releaseIds.length===releaseIds.length&&p.releaseIds.every(id=>releaseIds.includes(id)));
  if(previous)return{state,packet:previous};
  const events=(state.releases||[]).filter(e=>releaseIds.includes(e.id)&&e.status==='released'&&e.personId===personId),ids=events.flatMap(e=>e.recordIds);
  if(!ids.length)return{state};let next=state;const included:string[]=[];
  if(setting.includeReport){
    if(!next.report){const report=calculatedDatedReport({...next,releases:[]},records,today,today);next={...next,report:withBaseline(next,report,records)};}
    else next={...next,report:syncScans(next,next.report,records).report};
    const eligible=pendingReleases(next).filter(p=>ids.includes(p.id)),segments=[...new Set(eligible.map(p=>p.event.segment))];
    for(const segment of segments){const rows=eligible.filter(p=>p.event.segment===segment);const count=setting.reportMode==='all'?rows.length:Math.min(rows.length,Math.max(0,Math.floor(setting.quantities[segment]||0)));included.push(...rows.slice(0,count).map(p=>p.id));}
    next=includeReleased(next,included);
  }
  const lines=[`RetailLens · ${today}`,`For ${name}`,`${ids.length} released as sold · ${included.length} included in this report · ${ids.length-included.length} left awaiting reporting`];
  if(setting.includeReport&&next.report)lines.push('',buildReport(next.report,{date:new Date(`${today}T12:00:00`)}));
  if(setting.includeImeis)lines.push('','Released IMEIs',...ids.map(id=>{const r=records.find(r=>r.id===id);return r?`${itemFor(next,r.model)?.name||r.model} · ${r.imei}`:`Record ${id}`;}));
  const packet:DeliveryPacket={id:crypto.randomUUID(),at:new Date().toISOString(),personId,phone:cleanPhone(setting.phone),destination:setting.destination,releaseIds:[...releaseIds],recordIds:ids,reportIds:included,text:lines.join('\n'),fingerprint:deliveryFingerprint(next,records),status:'prepared'};
  next=withAudit({...next,deliveryPackets:[...(next.deliveryPackets||[]),packet]},'delivery prepared',`${name}: ${ids.length} released IMEIs, ${included.length} included in report. WhatsApp sending is not confirmed.`);
  return{state:next,packet};
}
