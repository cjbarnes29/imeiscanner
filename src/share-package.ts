export type ShareRecord={number:number;pictureId:string;model:string;imei:string;serial:string;photo:string};
export type ShareMode='imei'|'imei_serial';
/** Plain text sent as its own message after the picture. IMEI mode falls back to the serial so serial-only units still get a number. */
export function shareNumberText(row:Pick<ShareRecord,'imei'|'serial'>,mode:ShareMode){return (mode==='imei_serial'?[row.imei,row.serial]:[row.imei||row.serial]).filter(Boolean).join('\n');}
export function buildSharePackage(rows:ShareRecord[],mode:ShareMode='imei'){
 if(!rows.length)throw new Error('Select at least one record.');
 return {entries:rows.map(row=>{
  const match=row.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/);if(!match)throw new Error('A selected picture is unavailable. Review that record first.');
  const data=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
  return {file:new File([data],match[1]==='image/jpeg'?'image.jpg':match[1]==='image/png'?'image.png':'image.webp',{type:match[1]}),text:shareNumberText(row,mode)};
 })};
}
