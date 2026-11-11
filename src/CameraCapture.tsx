import { useEffect, useRef, useState } from 'react';
import { useBackLayer } from './back-layer';

function CameraThumbnail({file}: {file:File}) {
  const [url,setUrl]=useState('');
  useEffect(()=>{const value=URL.createObjectURL(file);setUrl(value);return()=>URL.revokeObjectURL(value);},[file]);
  return <img src={url} alt={file.name} />;
}

export function CameraCapture({ onCapture, onClose }: { onCapture: (files: File[]) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState<Blob>();
  const [preview, setPreview] = useState('');
  const [torch, setTorch] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [barcodeStatus, setBarcodeStatus] = useState('');
  const [facing,setFacing] = useState('environment');
  const [timer,setTimer] = useState(0);
  const [countdown,setCountdown] = useState(0);
  const [capturing,setCapturing] = useState(false);
  const [zoom,setZoom] = useState(1);
  const [zoomMax,setZoomMax] = useState(1);
  const alive = useRef(true);
  const [photos,setPhotos]=useState<File[]>([]);
  const submitted=useRef(false);
  const phoneCamera=useRef<HTMLInputElement>(null);
  const stopBurst=useRef(false);
  const captureLock=useRef(false);
  const [burst,setBurst]=useState(1);
  const [placement,setPlacement]=useState(()=>localStorage.getItem('imei-camera-placement')||'center');
  useEffect(()=>{localStorage.setItem('imei-camera-placement',placement);},[placement]);
  function currentPhoto() {return photo ? new File([photo],`camera-${crypto.randomUUID()}.jpg`,{type:'image/jpeg'}) : undefined;}
  function finish() {
    const current=currentPhoto(), batch=current?[...photos,current]:photos;
    if(!batch.length||submitted.current)return;
    submitted.current=true;onCapture(batch);onClose();
  }
  function close() {stopBurst.current=true;if((photos.length||photo)&&!window.confirm('Discard these unscanned camera photos? Choose Cancel to keep taking photos or scan them.'))return false;onClose();return true;}
  // Back closes the camera (with the same discard question); cancelling keeps it open and re-arms Back.
  useBackLayer(true, () => { if (!close()) history.pushState({ imeiLayer: 'camera' }, ''); }, 'camera');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;stopBurst.current=true;};},[]);
  useEffect(() => {
    let cancelled = false;
    let current: MediaStream | undefined;
    setReady(false);setError('');setHasTorch(false);setTorch(false);setZoomMax(1);
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera access requires HTTPS and a supported browser. Photo upload is still available.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false }).then(async media => {
      if (cancelled) { media.getTracks().forEach(track => track.stop()); return; }
      current = media; stream.current = media;
      const track = media.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() || {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
      setHasTorch(!!caps.torch);
      const zoomCap = (caps as MediaTrackCapabilities & {zoom?:{min:number;max:number}}).zoom;
      if(zoomCap && zoomCap.min<=1){setZoomMax(zoomCap.max);setZoom(1);}
      if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
      setReady(true);
    }).catch(() => setError('The camera could not open. Allow camera permission, close other camera apps, or use photo upload.'));
    return () => { cancelled = true; current?.getTracks().forEach(track => track.stop()); };
  }, [facing]);
  useEffect(() => { if (!photo) { setPreview(''); return; } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  async function takeExposure():Promise<Blob> {
    const track=stream.current?.getVideoTracks()[0];
    const Still=(window as any).ImageCapture;
    if(Still&&track){try{return await new Still(track).takePhoto();}catch{/* Fall back to a sharp video frame. */}}
    const source=video.current;
    if(!source?.videoWidth)throw new Error('Camera is not ready. Try Phone camera below.');
    const canvas=document.createElement('canvas');canvas.width=source.videoWidth;canvas.height=source.videoHeight;
    const context=canvas.getContext('2d');if(!context)throw new Error('Could not capture a photo.');
    context.drawImage(source,0,0);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Capture failed. Try Phone camera.')),'image/jpeg',.96));
  }
  async function capture() {
    if(captureLock.current)return;captureLock.current=true;setCapturing(true);setError('');stopBurst.current=false;
    try{
      for(let n=timer;n>0;n--){setCountdown(n);await new Promise(resolve=>setTimeout(resolve,1000));if(!alive.current||stopBurst.current)return;}
      setCountdown(0);
      for(let i=0;i<burst;i++){
        if(!alive.current||stopBurst.current||photos.length+i>=50)break;
        const blob=await takeExposure();if(!alive.current)return;
        if(blob.size>20*1024*1024)throw new Error('This photo is too large. Use a lower resolution in Phone camera.');
        if(burst===1)setPhoto(blob);
        else {const file=new File([blob],`camera-${crypto.randomUUID()}.jpg`,{type:blob.type||'image/jpeg'});setPhotos(old=>[...old,file]);setBarcodeStatus(`Burst: ${i+1} of ${burst} saved. Review the thumbnails before scanning.`);}
        if(burst>1)await new Promise(resolve=>setTimeout(resolve,700));
      }
    }catch(error){if(alive.current)setError(error instanceof Error?error.message:'Capture failed. Try Phone camera.');}
    finally{captureLock.current=false;if(alive.current){setCapturing(false);setCountdown(0);}}
  }
  return <div className="modal-backdrop"><div className={`modal camera-modal placement-${placement}`} role="dialog" aria-modal="true" aria-label="Camera scanner">
    <div className="modal-head"><h2>Scan with camera</h2><button className="subtle-btn" onClick={close}>Close</button></div>
    <p>Capture → Take another → Scan all. Several devices can share one photo: keep every label fully in frame with a visible gap between boxes. Up to 50 photos per batch. If the preview is blurry or unavailable, try Phone camera.</p>
    <input ref={phoneCamera} type="file" accept="image/*" capture="environment" hidden onChange={event=>{const file=event.target.files?.[0];if(file){const renamed=new File([file],`camera-${crypto.randomUUID()}.${file.name.split('.').pop()||'jpg'}`,{type:file.type});setPhotos(old=>[...old,renamed]);setBarcodeStatus('Phone camera photo added. Tap Scan all when ready.');}event.target.value='';}}/>
    <div className="camera-setup"><button className="subtle-btn" disabled={capturing||photos.length>=50} onClick={()=>phoneCamera.current?.click()}>Phone camera</button><label>Button position <select aria-label="Camera button position" value={placement} onChange={e=>setPlacement(e.target.value)}><option value="center">Bottom center</option><option value="left">Left hand</option><option value="right">Right hand</option></select></label></div>
    {error && <p role="alert">{error}</p>}
    {barcodeStatus && <p role="status">{barcodeStatus}</p>}
    <div className="review-photo-stage"><video ref={video} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', display: photo ? 'none' : 'block' }} />{preview && <img className="preview" src={preview} alt="Captured label" />}</div>
    {photos.length>0&&<div className="camera-batch" aria-label="Saved camera photos">{photos.map((file,index)=><div key={file.name}><CameraThumbnail file={file}/><button onClick={()=>setPhotos(old=>old.filter(item=>item!==file))} aria-label={`Remove camera photo ${index+1}`}>× {index+1}</button></div>)}</div>}
    <p role="status">{photos.length} kept{photo?' + 1 current photo':''} · Not scanned yet</p>
    {!photo && <div className="camera-options"><button className="subtle-btn" disabled={capturing} onClick={()=>setFacing(facing==='environment'?'user':'environment')}>Switch camera</button><label>Burst <select aria-label="Burst count" disabled={capturing} value={burst} onChange={e=>setBurst(Number(e.target.value))}><option value={1}>Single photo</option><option value={3}>3 photos</option><option value={5}>5 photos</option></select></label><label>Timer <select disabled={capturing} value={timer} onChange={e=>setTimer(Number(e.target.value))}><option value={0}>Off</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option></select></label>{zoomMax>1&&<label>Zoom {zoom.toFixed(1)}× <input aria-label="Camera zoom" type="range" min={1} max={zoomMax} step={0.1} value={zoom} onChange={async e=>{const value=Number(e.target.value);try{await stream.current?.getVideoTracks()[0].applyConstraints({advanced:[{zoom:value} as MediaTrackConstraintSet]});setZoom(value);}catch{setError('Zoom is unavailable. Move closer to the label.');}}}/></label>}</div>}
    {countdown>0&&<div className="camera-countdown" role="status">{countdown}</div>}
    <div className="review-fixed-actions">
      {capturing&&<button className="subtle-btn" onClick={()=>{stopBurst.current=true;setCountdown(0);}}>Stop capture</button>}
      {photo ? <><button className="subtle-btn" onClick={() => setPhoto(undefined)}>Retake</button><button className="subtle-btn" disabled={photos.length>=49} onClick={()=>{const file=currentPhoto();if(file)setPhotos(old=>[...old,file]);setPhoto(undefined);setBarcodeStatus('');}}>Take another</button><button className="primary" onClick={finish}>Scan all ({photos.length+1})</button></> : <><button className="primary camera-shutter" disabled={!ready || capturing || photos.length>=50} onClick={capture}>{capturing?'Capturing…':'● Capture'}</button>{photos.length>0&&<button className="primary" disabled={capturing} onClick={finish}>Scan all ({photos.length})</button>}</>}
      {hasTorch && !photo && <button className="subtle-btn" onClick={async () => { try { await stream.current?.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { setError('Flashlight is unavailable on this camera.'); } }}>{torch ? 'Flashlight off' : 'Flashlight on'}</button>}
    </div>
  </div></div>;
}
