import {planImeiCrops,type OcrLine,type PixelFrame} from './scan-layout.ts';

export type DeviceAnchor={key:string;kind:1|2|3;value:string;box:OcrLine['bbox']};
export function deviceAnchors(lines:OcrLine[],width:number,height:number,frame?:PixelFrame):DeviceAnchor[] {
  const found:DeviceAnchor[]=[];
  for(const line of lines){
    const box=line.bbox;
    if(!box||![box.x0,box.y0,box.x1,box.y1].every(Number.isFinite)||box.x1<=box.x0||box.y1<=box.y0)continue;
    const labels=[...line.text.toUpperCase().matchAll(/\bIM[E3][I1!|L]\s*(0?[12])\s*[:#.-]?\s*([0-9][0-9 -]{8,})|\b(?:S\s*[/I|]\s*N|SERIAL(?:\s+NUMBER)?)\s*[:#.-]?\s*([A-Z0-9]{5,25})/g)];
    if(!labels.length){const bare=[...line.text.toUpperCase().matchAll(/\bIM[E3][I1!|L]\s*(0?[12])\b/g)];if(bare.length===1&&!found.some(a=>a.kind===Number(bare[0][1])&&Math.abs(a.box.x0-box.x0)<8&&Math.abs(a.box.y0-box.y0)<8))found.push({key:`label-${found.length+1}`,kind:Number(bare[0][1]) as 1|2,value:'',box:{...box}});}
    for(const match of labels){
      const kind=(match[3]?3:Number(match[1])) as 1|2|3;
      const value=match[3]||match[2].replace(/\D/g,'');
      if(kind!==3&&value.length!==15)continue;
      // A single OCR line containing two labels is spatially ambiguous; do not
      // manufacture sub-line positions. It remains one region for manual review.
      if(labels.length>1)continue;
      const duplicate=found.some(old=>old.kind===kind&&old.value===value&&Math.abs(old.box.x0-box.x0)<Math.max(8,(box.x1-box.x0)*.15)&&Math.abs(old.box.y0-box.y0)<Math.max(8,(box.y1-box.y0)*.6));
      if(!duplicate)found.push({key:`label-${found.length+1}`,kind,value,box:{...box}});
    }
  }
  const selected:DeviceAnchor[]=[];
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
    const distance=Math.hypot(dx/width,dy/height);
    return distance<.13;
  };
  for(const kind of [1,2,3])for(const anchor of found.filter(a=>a.kind===kind)){
    // IMEI 2 and S/N next to IMEI 1 belong to the same device. Repeated S/N
    // tear-off strips with the same value do not make additional products.
    if(selected.some(other=>(other.kind<anchor.kind&&near(anchor,other))||(other.kind===3&&anchor.kind===3&&other.value===anchor.value)||(!!anchor.value&&other.kind===anchor.kind&&other.value===anchor.value&&component(anchor)>0&&component(anchor)===component(other))))continue;
    selected.push(anchor);
  }
  return selected;
}
export function planDeviceCrops(anchors:DeviceAnchor[],lines:OcrLine[],width:number,height:number,frame?:PixelFrame){
  return planImeiCrops(anchors.map(a=>a.key),lines,width,height,frame,anchors);
}
