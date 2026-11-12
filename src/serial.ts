// One shared serial-label pattern so OCR parsing, device splitting and the
// server scanner cannot drift apart. Accepts S/N, SN, Serial, Serial No/Number.
// The value must contain a digit so ordinary words after the label are ignored.
export const SERIAL_LABEL = String.raw`(?:S\s*[/|I]\s*N|SN(?=[\s:#.-])|SERIAL(?:\s*(?:NUMBER|NO|NUM))?\.?|SER\.?\s*NO\.?)`;
const SERIAL_VALUE = String.raw`\s*[:#.-]?\s*((?=[A-Z0-9]*\d)[A-Z0-9]{5,25})\b`;
const SERIAL_NOISE = /^(MODEL|IMEI|SERIAL|NUMBER)$/;
/**
 * Samsung serials are 11 characters starting with R and never contain the letter O (they use the digit 0), so an O read from the
 * label is a misread zero. Every serial in the labeled photos agrees. Other brands' serials are left as read.
 */
export const fixSamsungSerial = (value: string) => /^R[0-9A-Z]{10}$/.test(value) ? value.replace(/O/g, '0') : value;
const serialValues = (text: string) => {
  // A serial read from its barcode is exact; it outranks OCR guesses of the same label.
  const barcode = [...new Set([...text.toUpperCase().matchAll(/S\/N \(BARCODE\):\s*([A-Z0-9]{5,25})/g)].map(m => m[1]))];
  if (barcode.length) return barcode;
  return [...text.toUpperCase().matchAll(new RegExp(String.raw`\b${SERIAL_LABEL}${SERIAL_VALUE}`, 'g'))].map(m => m[1]).filter(v => !SERIAL_NOISE.test(v)).map(fixSamsungSerial);
};

/** Digits after a bare "IMEI:" label (no 1/2), e.g. Apple/Pixel style labels. Caller applies Luhn. */
export function unindexedImeis(text: string): string[] {
  const values = [...text.matchAll(/\bIM[E3][I1!|l]\s*(?:\/\s*MEID\s*)?[:#]\s*((?:\d[\s-]*){15})(?![\s-]*\d)/gi)].map(m => m[1].replace(/\D/g, ''));
  return [...new Set(values)];
}

export function extractSerial(text: string): string {
  const unique = [...new Set(serialValues(text))];
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
 const values = serialValues(text);
 return {serial:values[0] || '',serialNeedsReview:new Set(values).size>1 || values.some(value=>value.length<8)};
}
