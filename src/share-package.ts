export type ShareRecord = {number:number;pictureId:string;model:string;imei:string;serial:string;photo:string};

export function buildSharePackage(rows:ShareRecord[]) {
  if(!rows.length)throw new Error('Select at least one record to share.');
  if(rows.length>50)throw new Error('Share up to 50 photos at a time. Select fewer records.');
  let bytes=0;
  const entries=rows.map(row=>{
    const match=row.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/);
    if(!match)throw new Error(`Photo ${row.pictureId} is unavailable. Download or review that record first.`);
    bytes+=Math.ceil(match[2].length*3/4);
    if(bytes>100*1024*1024)throw new Error('These photos exceed 100 MB. Share fewer records at a time.');
    const binary=atob(match[2]),data=Uint8Array.from(binary,c=>c.charCodeAt(0));
    const safe=(value:string)=>value.replace(/[^a-z0-9_-]/gi,'_');
    const name=`photo-${row.number}_${safe(row.imei||row.serial||'needs-review')}_${safe(row.pictureId)}.${match[1]==='image/jpeg'?'jpg':match[1].split('/')[1]}`;
    const file=new File([data],name,{type:match[1]});
    const text=`Photo #${row.number} · ${name}\nModel: ${row.model||'Not identified'}\nIMEI: ${row.imei||'Not detected'}${row.serial?`\nS/N: ${row.serial}`:''}`;
    return {file,text};
  });
  return {files:entries.map(e=>e.file),text:entries.map(e=>e.text).join('\n\n')};
}
