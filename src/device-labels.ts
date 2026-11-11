import {planImeiCrops,type CropRegion,type OcrLine,type PixelFrame} from './scan-layout.ts';
import {productBands} from './product-bands.ts';
import {SERIAL_LABEL} from './serial.ts';

function luhn(value:string){if(!/^\d{15}$/.test(value))return false;let sum=0;for(let i=0;i<15;i++){let n=Number(value[14-i]);if(i%2){n*=2;if(n>9)n-=9;}sum+=n;}return sum%10===0;}
export type DeviceAnchor={key:string;kind:1|2|3;value:string;box:OcrLine['bbox'];approx?:boolean;members?:OcrLine['bbox'][]};
export function deviceAnchors(lines:OcrLine[],width:number,height:number,frame?:PixelFrame):DeviceAnchor[] {
  const found:DeviceAnchor[]=[];
  for(const line of lines){
    const box=line.bbox;
    if(!box||![box.x0,box.y0,box.x1,box.y1].every(Number.isFinite)||box.x1<=box.x0||box.y1<=box.y0)continue;
    const text=line.text.toUpperCase();
    const labels=[...text.matchAll(new RegExp(String.raw`\bIM[E3][I1!|L]\s*(0?[12])\s*[:#.-]?\s*([0-9][0-9 -]{8,})|\b${SERIAL_LABEL}\s*[:#.-]?\s*((?=[A-Z0-9]*\d)[A-Z0-9]{5,25})|\bIM[E3][I1!|L]\s*(?:\/\s*MEID\s*)?[:#][\s.,'"·]*([0-9][0-9 -]{8,})`,'g'))];
    if(!labels.length){const bare=[...line.text.toUpperCase().matchAll(/\bIM[E3][I1!|L]\s*(0?[12])\b/g)];if(bare.length===1&&!found.some(a=>a.kind===Number(bare[0][1])&&Math.abs(a.box.x0-box.x0)<8&&Math.abs(a.box.y0-box.y0)<8))found.push({key:`label-${found.length+1}`,kind:Number(bare[0][1]) as 1|2,value:'',box:{...box}});}
    for(const match of labels){
      const kind=(match[3]?3:match[1]?Number(match[1]):1) as 1|2|3;
      const value=match[3]||(match[2]||match[4]).replace(/\D/g,'');
      if(kind!==3&&value.length!==15)continue;
      // A number that fails the IMEI checksum is a misread: it may mark a label
      // position, but it must never create a separate device on its own.
      const readable=kind===3||luhn(value);
      // One OCR line can hold several labels ("IMEI 1: … IMEI 2: …"). Split the
      // line box by character offset so each label keeps its own horizontal span.
      const split=labels.length>1,total=Math.max(1,text.length),index=labels.indexOf(match);
      const start=match.index??0,end=labels[index+1]?.index??total;
      const anchorBox=split?{...box,x0:box.x0+(box.x1-box.x0)*start/total,x1:box.x0+(box.x1-box.x0)*end/total}:{...box};
      const duplicate=found.some(old=>old.kind===kind&&old.value===value&&Math.abs(old.box.x0-anchorBox.x0)<Math.max(8,(anchorBox.x1-anchorBox.x0)*.15)&&Math.abs(old.box.y0-box.y0)<Math.max(8,(box.y1-box.y0)*.6));
      if(!duplicate)found.push({key:`label-${found.length+1}`,kind,value:readable?value:'',box:anchorBox,...(split?{approx:true}:{})});
    }
  }
  // Identifiers far apart on one large pale sticker still describe one product.
  // Use connected sticker background evidence before treating IMEI 2/S/N as
  // another device. Distinct components override the distance-only fallback.
  const step=Math.max(1,Math.ceil(Math.max(width,height)/320)),w=Math.ceil(width/step),h=Math.ceil(height/step);
  const components=frame?new Int32Array(w*h):undefined;
  if(frame&&components){
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=(Math.min(height-1,y*step)*width+Math.min(width-1,x*step))*4;const rgb=[frame.data[p],frame.data[p+1],frame.data[p+2]];components[y*w+x]=Math.min(...rgb)>135&&Math.max(...rgb)-Math.min(...rgb)<65?-1:0;}
    let label=0;for(let i=0;i<components.length;i++){if(components[i]!==-1)continue;const queue=[i];components[i]=++label;for(let j=0;j<queue.length;j++){const p=queue[j],x=p%w,y=Math.floor(p/w);for(const n of [x?p-1:-1,x<w-1?p+1:-1,y?p-w:-1,y<h-1?p+w:-1])if(n>=0&&components[n]===-1){components[n]=label;queue.push(n);}}if(queue.length<40)for(const p of queue)components[p]=0;}
  }
  const component=(anchor:DeviceAnchor)=>{
    if(!components)return 0;const counts=new Map<number,number>();const b=anchor.box;
    for(const x of [b.x0-8,(b.x0+b.x1)/2,b.x1+8])for(const y of [b.y0-8,(b.y0+b.y1)/2,b.y1+8]){const id=components[Math.max(0,Math.min(h-1,Math.floor(y/step)))*w+Math.max(0,Math.min(w-1,Math.floor(x/step)))];if(id>0)counts.set(id,(counts.get(id)||0)+1);}
    return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||0;
  };
  const near=(a:DeviceAnchor,b:DeviceAnchor)=>{
    const ca=component(a),cb=component(b);if(ca&&cb)return ca===cb;
    const dx=Math.max(0,a.box.x0-b.box.x1,b.box.x0-a.box.x1);
    const dy=Math.max(0,a.box.y0-b.box.y1,b.box.y0-a.box.y1);
    // Scale with the printed text, not the frame: on a close-up a barcode between
    // IMEI 1 and IMEI 2 is several hundred px, in a wide shot it is ~100 px.
    const lineHeight=Math.max(a.box.y1-a.box.y0,b.box.y1-b.box.y0);
    const reach=Math.max(Math.min(width,height)*.05,lineHeight*6);
    return Math.hypot(dx,dy)<reach;
  };
  // Group labels into devices. A device can only have one IMEI 1, one IMEI 2 and
  // one serial, so a second, different value of any of them is another device;
  // repeats of the same number (tear-off strips, OCR + barcode, small misreads)
  // stay in one device. IMEI 2 and S/N go to the nearest device that does not
  // already hold a different value. White boxes stacked together form one big
  // pale area, so value conflicts, not just distance, decide the split.
  const hamming=(a:string,b:string)=>{if(a.length!==b.length)return 99;let d=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])d++;return d;};
  const sameValue=(a:DeviceAnchor,b:DeviceAnchor)=>a.kind===b.kind&&!!a.value&&!!b.value&&(a.value===b.value||hamming(a.value,b.value)<=2||(a.kind===3&&Math.min(a.value.length,b.value.length)>=7&&(a.value.startsWith(b.value)||b.value.startsWith(a.value))));
  const rectGap=(a:DeviceAnchor,b:DeviceAnchor)=>Math.hypot(Math.max(0,a.box.x0-b.box.x1,b.box.x0-a.box.x1),Math.max(0,a.box.y0-b.box.y1,b.box.y0-a.box.y1));
  const sameLine=(x:DeviceAnchor,y:DeviceAnchor)=>!!x.approx&&!!y.approx&&Math.abs(x.box.y0-y.box.y0)<2&&Math.abs(x.box.y1-y.box.y1)<2;
  type Group={members:DeviceAnchor[]};
  const groups:Group[]=[];
  // Devices in one photo are stacked along one direction. A label belongs to the
  // device whose own labels it sits between along that direction (an S/N line is
  // level with its device's IMEI lines), even when a neighbour's tear-off strip is
  // physically closer. With one device, plain distance is used.
  const stackedVertically=()=>{
    const centres=groups.map(g=>{const m=g.members[0].box;return {x:(m.x0+m.x1)/2,y:(m.y0+m.y1)/2};});
    if(centres.length<2)return undefined;
    const spread=(values:number[])=>Math.max(...values)-Math.min(...values);
    return spread(centres.map(c=>c.y))/height>=spread(centres.map(c=>c.x))/width;
  };
  const gap=(anchor:DeviceAnchor,group:Group)=>{
    const direct=Math.min(...group.members.map(m=>rectGap(anchor,m)));
    const vertical=stackedVertically();
    if(vertical===undefined)return direct;
    const lo=Math.min(...group.members.map(m=>vertical?m.box.y0:m.box.x0)),hi=Math.max(...group.members.map(m=>vertical?m.box.y1:m.box.x1));
    const a0=vertical?anchor.box.y0:anchor.box.x0,a1=vertical?anchor.box.y1:anchor.box.x1;
    return Math.max(0,lo-a1,a0-hi)+direct*.001;
  };
  const conflicts=(anchor:DeviceAnchor,group:Group)=>!!anchor.value&&group.members.some(m=>m.kind===anchor.kind&&!!m.value&&!sameValue(m,anchor));
  const joinsByValue=(anchor:DeviceAnchor)=>groups.find(g=>g.members.some(m=>sameValue(m,anchor)||sameLine(anchor,m)));
  // IMEI 1 values: each distinct number is its own device.
  for(const anchor of found.filter(a=>a.kind===1&&a.value)){const g=joinsByValue(anchor);if(g)g.members.push(anchor);else groups.push({members:[anchor]});}
  // IMEI 2 and serial values: closest compatible device first, one value per device.
  for(const kind of [2,3] as const){
    const pending=found.filter(a=>a.kind===kind&&a.value);
    for(const anchor of [...pending]){const g=joinsByValue(anchor);if(g){g.members.push(anchor);pending.splice(pending.indexOf(anchor),1);}}
    const pairs=pending.flatMap(anchor=>groups.filter(g=>near(anchor,g.members.reduce((best,m)=>rectGap(anchor,m)<rectGap(anchor,best)?m:best))&&!conflicts(anchor,g)).map(g=>({anchor,g,d:gap(anchor,g)}))).sort((a,b)=>a.d-b.d);
    const placed=new Set<DeviceAnchor>();
    for(const {anchor,g} of pairs){if(placed.has(anchor)||conflicts(anchor,g))continue;g.members.push(anchor);placed.add(anchor);}
    for(const anchor of pending){if(placed.has(anchor))continue;const g=joinsByValue(anchor);if(g)g.members.push(anchor);else groups.push({members:[anchor]});}
  }
  // Labels whose number was unreadable join the nearest device; alone they still
  // mark a possible device so it is reviewed rather than silently dropped.
  for(const anchor of found.filter(a=>!a.value)){
    const g=groups.filter(g=>g.members.some(m=>near(anchor,m)||sameLine(anchor,m))).sort((a,b)=>gap(anchor,a)-gap(anchor,b))[0];
    // An unreadable IMEI 2 or S/N label never starts a device of its own: every
    // device has an IMEI 1 or a readable number. It joins the nearest device.
    const nearest=anchor.kind!==1?[...groups].sort((a,b)=>gap(anchor,a)-gap(anchor,b))[0]:undefined;
    if(g)g.members.push(anchor);else if(nearest)nearest.members.push(anchor);else groups.push({members:[anchor]});
  }
  // One anchor per device: its IMEI 1 when read, otherwise its first read value.
  return groups.map(g=>({...(g.members.find(m=>m.kind===1&&m.value)||g.members.find(m=>m.value)||g.members[0]),members:g.members.map(m=>m.box)}));
}
/**
 * Fallback cut between label groups. Stacked white boxes often show no dark seam,
 * but every device's labels are known: cut halfway between one device's labels
 * and the next. Each crop keeps all of its own labels and none of a neighbour's.
 * Gives up (returns []) if the groups overlap on both axes.
 */
export function labelGroupCrops(anchors:DeviceAnchor[],width:number,height:number):CropRegion[]{
  if(anchors.length<2)return [];
  const extents=anchors.map(a=>{const boxes=a.members?.length?a.members:[a.box];return {key:a.key,x0:Math.min(...boxes.map(b=>b.x0)),y0:Math.min(...boxes.map(b=>b.y0)),x1:Math.max(...boxes.map(b=>b.x1)),y1:Math.max(...boxes.map(b=>b.y1))};});
  for(const vertical of [true,false]){
    const sorted=[...extents].sort((a,b)=>vertical?a.y0-b.y0:a.x0-b.x0);
    if(!sorted.every((e,i)=>!i||(vertical?e.y0>sorted[i-1].y1:e.x0>sorted[i-1].x1)))continue;
    const extent=vertical?height:width;
    const cuts=sorted.slice(1).map((e,i)=>Math.round(((vertical?sorted[i].y1:sorted[i].x1)+(vertical?e.y0:e.x0))/2));
    return sorted.map((e,i)=>{const from=i?cuts[i-1]:0,to=i<cuts.length?cuts[i]:extent;return vertical?{imei:e.key,x:0,y:from,width,height:to-from,needsReview:false}:{imei:e.key,x:from,y:0,width:to-from,height,needsReview:false};});
  }
  return [];
}
export function planDeviceCrops(anchors:DeviceAnchor[],lines:OcrLine[],width:number,height:number,frame?:PixelFrame){
  const existing=planImeiCrops(anchors.map(a=>a.key),lines,width,height,frame,anchors);
  const bands=frame?productBands(frame,lines):[];
  // Dark-seam bands are a fallback. When labels already show how many devices
  // there are, bands may only be used if they find exactly that many.
  if(anchors.length>=2){
    // More visible boxes than readable labels: a box whose numbers could not be
    // read still gets its own picture (it goes to review) instead of being dropped.
    if(bands.length>anchors.length)return bands;
    if(existing.length===anchors.length)return existing;
    if(bands.length===anchors.length)return bands;
    return labelGroupCrops(anchors,width,height);
  }
  return bands.length>=2&&bands.length>=existing.length?bands:existing;
}
