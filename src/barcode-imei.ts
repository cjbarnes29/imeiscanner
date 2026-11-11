import type {OcrLine} from './scan-layout';
export type PositionedBarcode={rawValue:string;boundingBox?:{x:number;y:number;width:number;height:number}};
function valid(value:string){if(!/^\d{15}$/.test(value))return false;let sum=0;for(let i=0;i<15;i++){let n=Number(value[14-i]);if(i%2){n*=2;if(n>9)n-=9;}sum+=n;}return sum%10===0;}
/** Pair each "IMEI 1/2" OCR label with the one valid barcode printed directly above it. */
export function labelledBarcodeLines(codes:PositionedBarcode[],lines:OcrLine[]):OcrLine[] {
  const matches:{type:string;code:number;label:OcrLine['bbox'];offset:number}[]=[];
  for(const line of lines){
    // "IMEI 1", "IMEI 2", or a bare "IMEI:" (OCR often drops the 1; treated as IMEI 1).
    const labels=[...line.text.matchAll(/\bIM[E3][I1!|L]\s*(?:(0?[12])\b|(?=\s*[:#;]))/gi)];
    if(labels.length!==1)continue;
    const b=line.bbox,h=b.y1-b.y0;
    // Where the label text itself starts (OCR lines can begin with other text).
    const labelX=b.x0+(b.x1-b.x0)*(labels[0].index??0)/Math.max(1,line.text.length);
    // Digits OCR read after the label, even partly: they must agree with the barcode.
    const readDigits=line.text.slice((labels[0].index??0)+labels[0][0].length).replace(/\D/g,'');
    const nearby=codes.map((code,index)=>({code,index})).filter(({code})=>{
      const r=code.boundingBox;if(!r||!valid(code.rawValue))return false;
      // 1-D decoders report the scan line (a box ~1px tall), not the bars. IMEI
      // barcodes are roughly 5x wider than tall, so estimate the real bottom edge.
      const barHeight=Math.max(r.height,r.width*.2),bottom=r.height>=r.width*.2?r.y+r.height:r.y+barHeight/2;
      const gap=b.y0-bottom,center=(b.x0+b.x1)/2;
      // Labels are printed left-aligned under their own barcode. A label starting
      // far to the right (an IMEI 2 under a strip's single IMEI 1 barcode) is not its owner.
      const aligned=labelX>=r.x-r.width*.12&&labelX<=r.x+r.width*.3;
      const agrees=readDigits.length<6||commonRun(readDigits,code.rawValue)>=6;
      return aligned&&agrees&&gap>=-h&&gap<=Math.max(h*3,barHeight*.6)&&center>=r.x-r.width*.15&&center<=r.x+r.width*1.15;
    });
    if(nearby.length===1)matches.push({type:String(Number(labels[0][1]||1)),code:nearby[0].index,label:b,offset:Math.abs(labelX-codes[nearby[0].index].boundingBox!.x)});
  }
  // Two labels may sit under one wide barcode (IMEI 1 and IMEI 2 side by side).
  // Labels are printed left-aligned under their own barcode, so the label that
  // starts at the barcode's left edge wins when it is clearly closer; otherwise
  // the barcode is ambiguous and ignored.
  const owner=(m:typeof matches[number])=>{
    const rivals=matches.filter(other=>other.code===m.code).sort((a,b)=>a.offset-b.offset);
    return rivals.length===1||(rivals[0]===m&&m.offset<rivals[1].offset*.5);
  };
  // The anchor sits exactly on the printed label text, like an OCR line. A box
  // stretched over the barcode samples different sticker areas and could make
  // one device look like two.
  return matches.filter(owner).map(m=>({text:`IMEI ${m.type}: ${codes[m.code].rawValue}`,bbox:{...m.label}}));
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
 * serials are letters+digits (e.g. R58M20ABCDE); OCR often swaps 8/B, 0/O.
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

function luhnDigit(first14:string){let sum=0;for(let i=0;i<14;i++){let n=Number(first14[13-i]);if(i%2===0){n*=2;if(n>9)n-=9;}sum+=n;}return String((10-sum%10)%10);}
/**
 * IMEI 2 on Samsung dual-SIM labels. Samsung prints IMEI 1 and IMEI 2 with the
 * same 6-digit serial block (digits 9-14), e.g. 35000011 085661 6 and
 * 35000012 085661 4. Each 15-digit IMEI 2 reading is checked against that:
 * a reading that already matches is used; a reading at most 2 digits away from
 * "its own first 8 digits + IMEI 1's serial block + check digit" is corrected to
 * that value. No reading close enough means no IMEI 2 (left blank), never a guess.
 */
export function samsungImei2(imei1:string,text:string):string{
  if(!valid(imei1))return '';
  const block=imei1.slice(8,14);
  // OCR variants of the label seen on real labels: "IMEI 2", "IME| 2", "IME\ 2", "IME) 2", "MEI 2".
  const readings=[...text.matchAll(/(?:\bI?M[E3][I1!|L\\)]?|\bIM[E3])\s*0?2\s*[:;#.,-]?\s*((?:\d[\s-]?){15})(?![\s-]?\d)/gi)].map(m=>m[1].replace(/\D/g,'')).filter(v=>v.length===15&&v!==imei1);
  // Exact readings first: a Luhn-valid reading that already shares IMEI 1's serial
  // block is taken as read. Corrections are only for when no reading is exact, so a
  // misread digit can never "fix" a correct number into a wrong one.
  const exact=new Map<string,number>();
  for(const reading of readings)if(valid(reading)&&reading.slice(8,14)===block&&reading.slice(0,8)!==imei1.slice(0,8))exact.set(reading,(exact.get(reading)||0)+1);
  const exactRanked=[...exact].sort((a,b)=>b[1]-a[1]);
  if(exactRanked.length)return exactRanked.length<2||exactRanked[0][1]>exactRanked[1][1]?exactRanked[0][0]:'';
  const votes=new Map<string,number>();
  for(const reading of readings){
    const candidate=reading.slice(0,8)+block;const full=candidate+luhnDigit(candidate);
    let diff=0;for(let i=0;i<15;i++)if(reading[i]!==full[i])diff++;
    // The correction only rebuilds the serial block (digits 9-14) and the check digit.
    // If the block already matched, the misread is in the first 8 digits, which this
    // cannot fix: rebuilding the check digit would turn a misread into a valid-looking
    // wrong number. Only accept corrections where the block itself was misread.
    const blockMisread=reading.slice(8,14)!==block;
    if(blockMisread&&diff<=2&&full.slice(0,8)!==imei1.slice(0,8))votes.set(full,(votes.get(full)||0)+1);
  }
  const ranked=[...votes].sort((a,b)=>b[1]-a[1]);
  return ranked.length&&(ranked.length<2||ranked[0][1]>ranked[1][1])?ranked[0][0]:'';
}

/**
 * IMEI 2 for one device's text: its barcode, then a reading that shares IMEI 1's
 * serial block (exact or block-corrected), then a single plain Luhn-valid OCR
 * reading. On Samsung labels a reading with a different serial block is a misread
 * and is dropped. Returns '' rather than guess.
 */
export function pickImei2(imei:string,text:string):string{
  const samsung=/\bS\s*M\s*[-–—]?\s*[A-Z]\d{3}/i.test(text);
  const sameBlock=(value:string)=>!samsung||!imei||value.slice(8,14)===imei.slice(8,14);
  const fromBarcode=barcodeImei(text,2);
  if(fromBarcode&&fromBarcode!==imei&&sameBlock(fromBarcode))return fromBarcode;
  if(imei){const reconciled=samsungImei2(imei,text);if(reconciled)return reconciled;}
  const readings=[...new Set([...text.matchAll(/\bIM[E3][I1!|L]\s*0?2\s*[:#-]?\s*((?:\d[\s-]*){15})(?![\s-]*\d)/gi)].map(m=>m[1].replace(/\D/g,'')).filter(valid))].filter(value=>value!==imei&&sameBlock(value));
  return readings.length===1?readings[0]:'';
}

/**
 * How label-like a text is: IMEI/serial/model words and long numbers. 0 means
 * nothing readable. Used to tell whether a photo was read upright.
 */
export function labelTextScore(text:string):number{
  const t=text.toUpperCase();
  const count=(pattern:RegExp)=>(t.match(pattern)||[]).length;
  return count(/\bIM[E3][I1!|L]/g)+count(/\bS\s*[\/|I]\s*N\b|\bSERIAL\b/g)+count(/\bMODEL\b|\bSM\s*-\s*[A-Z]\d{3}/g)+2*count(/(?<!\d)(?:\d[ -]?){14}\d(?![ -]?\d)/g);
}
/** Other ways a photo may have been taken: upside down, sideways either way, mirrored (front camera). */
export const ORIENTATIONS:{angle:number;flop?:boolean}[]=[{angle:180},{angle:90},{angle:270},{angle:0,flop:true}];
