import type {OcrLine} from './scan-layout';
export type PositionedBarcode={rawValue:string;boundingBox?:{x:number;y:number;width:number;height:number}};
function valid(value:string){if(!/^\d{15}$/.test(value))return false;let sum=0;for(let i=0;i<15;i++){let n=Number(value[14-i]);if(i%2){n*=2;if(n>9)n-=9;}sum+=n;}return sum%10===0;}
/** Pair each "IMEI 1/2" OCR label with the one valid barcode printed directly above it. */
export function labelledBarcodeLines(codes:PositionedBarcode[],lines:OcrLine[]):OcrLine[] {
  const matches:{type:string;code:number;label:OcrLine['bbox']}[]=[];
  for(const line of lines){
    const labels=[...line.text.matchAll(/\bIM[E3][I1!|L]\s*(0?[12])\b/gi)];
    if(labels.length!==1)continue;
    const b=line.bbox,h=b.y1-b.y0;
    const nearby=codes.map((code,index)=>({code,index})).filter(({code})=>{
      const r=code.boundingBox;if(!r||!valid(code.rawValue))return false;
      const gap=b.y0-(r.y+r.height),center=(b.x0+b.x1)/2;
      return gap>=-h&&gap<=Math.max(h*3,r.height*.6)&&center>=r.x-r.width*.15&&center<=r.x+r.width*1.15;
    });
    if(nearby.length===1)matches.push({type:String(Number(labels[0][1])),code:nearby[0].index,label:b});
  }
  return matches.filter(m=>matches.filter(other=>other.code===m.code).length===1).map(m=>{
    const r=codes[m.code].boundingBox!;
    return {text:`IMEI ${m.type}: ${codes[m.code].rawValue}`,bbox:{x0:Math.min(r.x,m.label.x0),y0:Math.min(r.y,m.label.y0),x1:Math.max(r.x+r.width,m.label.x1),y1:Math.max(r.y+r.height,m.label.y1)}};
  });
}
export function labelledBarcodeImeis(codes:PositionedBarcode[],lines:OcrLine[]) {
  return labelledBarcodeLines(codes,lines).map(line=>line.text).join('\n');
}

function commonRun(a:string,b:string){let best=0;for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){let k=0;while(a[i+k]&&a[i+k]===b[j+k])k++;if(k>best)best=k;}return best;}
/**
 * Inside one device crop: barcodes give exact numbers but not which is IMEI 1.
 * OCR gives the label but often misreads digits. Match each "IMEI 1/2" OCR
 * fragment to the barcode sharing the longest digit run (8+), and emit clean
 * "IMEI n: value" lines. Ambiguous or weak matches emit nothing.
 */
export function resolveImeisFromBarcodes(values:string[],text:string):string {
  const codes=[...new Set(values.filter(valid))];
  if(!codes.length)return '';
  const out:string[]=[];
  for(const type of ['1','2']){
    // "IMEI:" with the 1 dropped by OCR still means IMEI 1, but never "IMEI 2".
    const index=type==='1'?String.raw`(?:0?1|(?!\s*0?2))`:'0?2';
    const fragments=[...text.matchAll(new RegExp(String.raw`\bIM[E3][I1!|L]\s*${index}\s*[:;#.,-]?\s*([\d][\d\s-]{5,22})`,'gi'))].map(m=>m[1].replace(/\D/g,''));
    if(!fragments.length)continue;
    const scored=codes.map(code=>({code,score:Math.max(...fragments.map(f=>commonRun(f,code)))})).sort((a,b)=>b.score-a.score);
    if(scored[0].score>=8&&(scored.length<2||scored[1].score<scored[0].score)&&!out.some(line=>line.endsWith(scored[0].code)))out.push(`IMEI ${type} (barcode): ${scored[0].code}`);
  }
  // One distinct barcode in the crop and OCR saw 6+ of its digits: it is this
  // device's number even if the label was unreadable. Emitted un-indexed so a
  // clearly labelled IMEI 1 still wins.
  if(!out.length&&codes.length===1&&commonRun(text.replace(/\D/g,' ').split(/\s+/).join('|'),codes[0])>=6)out.push(`IMEI: ${codes[0]}`);
  return out.join('\n');
}

// OCR look-alikes, folded together only for comparing OCR text with barcodes.
const fold=(value:string)=>value.toUpperCase().replace(/O/g,'0').replace(/[IL|]/g,'1').replace(/S/g,'5').replace(/B/g,'8').replace(/Z/g,'2').replace(/G/g,'6');
/**
 * Serial from a Code 128 S/N barcode, confirmed by the OCR text. Samsung
 * serials are letters+digits (e.g. R83L810D0MW); OCR often swaps 8/B, 0/O.
 * Returns "S/N (barcode): VALUE" so serial parsing can prefer it, or ''.
 */
export function resolveSerialFromBarcodes(values:string[],text:string):string {
  const codes=[...new Set(values.filter(value=>/^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{8,14}$/.test(value)))];
  if(!codes.length)return '';
  const fragments=[...text.toUpperCase().matchAll(/\b(?:S\s*[/|I1]\s*N|SN|SERIAL(?:\s*(?:NUMBER|NO|NUM))?\.?)\s*[:#.\-;,]?\s*([A-Z0-9]{4,16})/g)].map(m=>fold(m[1]));
  const evidence=fragments.length?fragments:[fold(text.replace(/[^A-Za-z0-9]+/g,'|'))];
  const scored=codes.map(code=>({code,score:Math.max(...evidence.map(f=>commonRun(f,fold(code))))})).sort((a,b)=>b.score-a.score);
  const need=fragments.length?5:7;
  return scored[0].score>=need&&(scored.length<2||scored[1].score<scored[0].score)?`S/N (barcode): ${scored[0].code}`:'';
}

/** The barcode-confirmed IMEI 1 or 2 written by resolveImeisFromBarcodes, if exactly one. */
export function barcodeImei(text:string,type:1|2):string {
  const values=[...new Set([...text.matchAll(new RegExp(String.raw`IMEI ${type} \(barcode\): (\d{15})`,'g'))].map(m=>m[1]))];
  return values.length===1?values[0]:'';
}

/**
 * Guard against OCR misreads that still pass Luhn. Samsung labels print each
 * IMEI several times; if another 15-digit reading differs from the chosen one
 * in only 1-2 digits, OCR disagreed with itself and a person should check.
 * Barcode-confirmed numbers are exact and never flagged.
 */
export function imeiReadingsDisagree(text:string,chosen:string):boolean {
  if(!/^\d{15}$/.test(chosen)||barcodeImei(text,1)===chosen||barcodeImei(text,2)===chosen)return false;
  const readings=[...text.matchAll(/(?<!\d)((?:\d[ -]?){14}\d)(?![ -]?\d)/g)].map(m=>m[1].replace(/\D/g,'')).filter(v=>v.length===15&&v!==chosen);
  return readings.some(v=>{let d=0;for(let i=0;i<15;i++)if(v[i]!==chosen[i])d++;return d<=2;});
}
