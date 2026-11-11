import type {CropRegion,OcrLine,PixelFrame} from './scan-layout';

/** Find wide, sloped dark gaps between pale product-box faces, not equal cuts. */
export function productBands(frame:PixelFrame,lines:OcrLine[]):CropRegion[] {
 const {width:w,height:h,data}=frame;
 if(h<w*.8||w<80||h<100)return [];
 const gray=(x:number,y:number)=>{const p=(Math.max(0,Math.min(h-1,Math.round(y)))*w+Math.max(0,Math.min(w-1,Math.round(x))))*4;return(data[p]+data[p+1]+data[p+2])/3;};
 const left=w*.105,right=w*.905,mid=(left+right)/2,xStep=Math.max(1,w/140),yStep=Math.max(1,Math.round(h/420));
 const candidates:{y:number;slope:number;score:number}[]=[];
 for(let y=h*.06;y<h*.96;y+=yStep)for(const slope of [-.12,-.08,-.04,0,.04,.08,.12]){
   let count=0,hits=0,strength=0;
   for(let x=left;x<right;x+=xStep){const yy=y+slope*(x-mid);const before=(gray(x,yy-w*.0083)+gray(x,yy-w*.0146))/2,after=(gray(x,yy+w*.0083)+gray(x,yy+w*.0146))/2,delta=(before+after)/2-gray(x,yy);if(delta>18&&before>110&&after>110)hits++;strength+=Math.max(0,delta);count++;}
   if(hits/count>.52&&strength/count>45)candidates.push({y,slope,score:strength/count});
 }
 const seams:typeof candidates=[];
 for(const candidate of candidates.sort((a,b)=>b.score-a.score))if(seams.every(s=>Math.abs(s.y-candidate.y)>h*.11))seams.push(candidate);
 seams.sort((a,b)=>a.y-b.y);
 if(!seams.length||seams.length>15)return [];
 const pale=(y:number)=>{let n=0,hit=0;for(let x=left;x<right;x+=xStep){const p=(Math.round(y)*w+Math.round(x))*4;const rgb=[data[p],data[p+1],data[p+2]];if(Math.min(...rgb)>135&&Math.max(...rgb)-Math.min(...rgb)<80)hit++;n++;}return hit/n;};
 let top=0,bottom=h-1;
 while(top<h&&pale(top)<.58)top++;
 while(bottom>top&&pale(bottom)<.58)bottom--;
 top=Math.max(0,top-h*.025);bottom=Math.min(h,bottom+h*.025);
 if(seams.some(s=>s.y-top<h*.1||bottom-s.y<h*.1))return [];
 const evidence=(from:number,to:number)=>lines.some(line=>line.bbox.y0>=from&&line.bbox.y1<=to&&/\b(?:model|SM\s*[-–—]|IM[E3][I1!|L]\s*[12]?|S\s*[/I|]\s*N|SN|SERIAL)\b/i.test(line.text));
 const result:CropRegion[]=[];
 for(let i=0;i<=seams.length;i++){
   const previous=seams[i-1],next=seams[i];
   const y0=i?previous.y-Math.abs(previous.slope)*(right-left)/2:top;
   const y1=next?next.y+Math.abs(next.slope)*(right-left)/2:bottom;
   const core0=i?previous.y+Math.abs(previous.slope)*(right-left)/2:top;
   const core1=next?next.y-Math.abs(next.slope)*(right-left)/2:bottom;
   if(core1-core0<h*.11||!evidence(core0,core1))return [];
   result.push({imei:`product-${i+1}`,x:0,y:Math.max(0,Math.floor(y0)),width:w,height:Math.min(h,Math.ceil(y1))-Math.max(0,Math.floor(y0)),needsReview:false});
 }
 return result;
}
