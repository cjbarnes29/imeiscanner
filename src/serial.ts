export function extractSerial(text: string): string {
  const candidates = [...text.toUpperCase().matchAll(/\b(?:S\s*[/|I]\s*N|SERIAL(?:\s+NUMBER)?)\s*[:#.-]?\s*([A-Z0-9]{5,25})\b/g)].map(m => m[1]);
  const unique = [...new Set(candidates.filter(v => !/^(MODEL|IMEI|SERIAL|NUMBER)$/.test(v)))];
  return unique.length === 1 ? unique[0] : '';
}

// Locate the largest connected pale label/box, rather than OCRing a busy background.
export function serialLabelRegion(frame: {data:ArrayLike<number>;width:number;height:number}) {
  const {width,height,data} = frame, scale = Math.max(1, Math.ceil(Math.max(width,height)/400));
  const w=Math.ceil(width/scale),h=Math.ceil(height/scale),mask=new Uint8Array(w*h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) { const p=(Math.min(height-1,y*scale)*width+Math.min(width-1,x*scale))*4;const r=data[p],g=data[p+1],b=data[p+2];mask[y*w+x]=Math.min(r,g,b)>145 && Math.max(r,g,b)-Math.min(r,g,b)<55 ? 1:0; }
  let best:{x:number;y:number;width:number;height:number;count:number}|undefined;
  for(let p=0;p<mask.length;p++) {
    if(!mask[p]) continue; mask[p]=0; const q=[p];let left=w,right=0,top=h,bottom=0;
    for(let i=0;i<q.length;i++){const n=q[i],x=n%w,y=Math.floor(n/w);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      for(const v of [x>0?n-1:-1,x<w-1?n+1:-1,y>0?n-w:-1,y<h-1?n+w:-1]) if(v>=0&&mask[v]) {mask[v]=0;q.push(v);}}
    if(q.length>w*h*.04&&(!best||q.length>best.count))best={x:left*scale,y:top*scale,width:(right-left+1)*scale,height:(bottom-top+1)*scale,count:q.length};
  }
  if(!best)return {x:0,y:0,width,height};
  const margin=Math.round(Math.max(width,height)*.025),x=Math.max(0,best.x-margin),y=Math.max(0,best.y-margin);
  return {x,y,width:Math.min(width-x,best.width+margin*2),height:Math.min(height-y,best.height+margin*2)};
}

export function serialReading(text: string) {
 const values = [...text.toUpperCase().matchAll(/\b(?:S\s*[/|I]\s*N|SERIAL(?:\s+NUMBER)?)\s*[:#.-]?\s*([A-Z0-9]{5,25})\b/g)].map(m=>m[1]).filter(v=>! /^(MODEL|IMEI|SERIAL|NUMBER)$/.test(v));
 return {serial:values[0] || '',serialNeedsReview:new Set(values).size>1 || values.some(value=>value.length<8)};
}
