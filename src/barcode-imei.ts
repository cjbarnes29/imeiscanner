import type {OcrLine} from './scan-layout';
export type PositionedBarcode={rawValue:string;boundingBox?:{x:number;y:number;width:number;height:number}};
function valid(value:string){if(!/^\d{15}$/.test(value))return false;let sum=0;for(let i=0;i<15;i++){let n=Number(value[14-i]);if(i%2){n*=2;if(n>9)n-=9;}sum+=n;}return sum%10===0;}
export function labelledBarcodeImeis(codes:PositionedBarcode[],lines:OcrLine[]) {
  const matches:{type:string;code:number}[]=[];
  for(const line of lines){
    const labels=[...line.text.matchAll(/\bIM[E3][I1!|L]\s*(0?[12])\b/gi)];
    if(labels.length!==1)continue;
    const b=line.bbox,h=b.y1-b.y0;
    const nearby=codes.map((code,index)=>({code,index})).filter(({code})=>{
      const r=code.boundingBox;if(!r||!valid(code.rawValue))return false;
      const gap=b.y0-(r.y+r.height),center=(b.x0+b.x1)/2;
      return gap>=-h&&gap<=Math.max(h*3,r.height*.6)&&center>=r.x-r.width*.15&&center<=r.x+r.width*1.15;
    });
    if(nearby.length===1)matches.push({type:String(Number(labels[0][1])),code:nearby[0].index});
  }
  return matches.filter(m=>matches.filter(other=>other.code===m.code).length===1).map(m=>`IMEI ${m.type}: ${codes[m.code].rawValue}`).join('\n');
}
