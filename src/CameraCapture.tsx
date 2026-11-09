import { useEffect, useRef, useState } from 'react';

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
  function currentPhoto() {return photo ? new File([photo],`camera-imei1-${crypto.randomUUID()}.jpg`,{type:'image/jpeg'}) : undefined;}
  function finish() {
    const current=currentPhoto(), batch=current?[...photos,current]:photos;
    if(!batch.length||submitted.current)return;
    submitted.current=true;onCapture(batch);onClose();
  }
  function close() {if((photos.length||photo)&&!window.confirm('Discard these unscanned camera photos? Choose Cancel to keep taking photos or scan them.'))return;onClose();}
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(() => {
    let cancelled = false;
    let current: MediaStream | undefined;
    setReady(false);setError('');setHasTorch(false);setTorch(false);setZoomMax(1);
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera access requires HTTPS and a supported browser. Photo upload is still available.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(async media => {
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
  async function capture() {
    if(capturing) return;
    setCapturing(true);
    for(let n=timer;n>0;n--){setCountdown(n);await new Promise(resolve=>setTimeout(resolve,1000));if(!alive.current)return;}
    setCountdown(0);
    const source = video.current;
    if (!source?.videoWidth) {setCapturing(false);return;}
    const canvas = document.createElement('canvas'); canvas.width = source.videoWidth; canvas.height = source.videoHeight;
    canvas.getContext('2d')?.drawImage(source, 0, 0);
    const Detector = (window as any).BarcodeDetector;
    if (Detector) {
      try { const codes = await new Detector().detect(canvas); setBarcodeStatus(codes.length ? `${codes.length} barcode(s) detected. The printed IMEI 1 label is still required to identify the correct number.` : 'No barcode detected. Reading the printed label instead.'); }
      catch { setBarcodeStatus('Barcode reading is unavailable. Reading the printed label instead.'); }
    } else setBarcodeStatus('This browser does not provide barcode detection. Reading the printed label instead.');
    canvas.toBlob(blob => { if(!alive.current)return;setCapturing(false);if (blob) setPhoto(blob); else setError('Capture failed. Please try again.'); }, 'image/jpeg', 0.94);
  }
  return <div className="modal-backdrop"><div className="modal camera-modal" role="dialog" aria-modal="true" aria-label="Camera scanner">
    <div className="modal-head"><h2>Scan with camera</h2><button className="subtle-btn" onClick={close}>Close</button></div>
    <p>Capture → Take another → Scan all. Keep one complete device label in each photo. Up to 50 photos per camera batch.</p>
    {error && <p role="alert">{error}</p>}
    {barcodeStatus && <p role="status">{barcodeStatus}</p>}
    <div className="review-photo-stage"><video ref={video} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', display: photo ? 'none' : 'block' }} />{preview && <img className="preview" src={preview} alt="Captured label" />}</div>
    {photos.length>0&&<div className="camera-batch" aria-label="Saved camera photos">{photos.map((file,index)=><div key={file.name}><CameraThumbnail file={file}/><button onClick={()=>setPhotos(old=>old.filter(item=>item!==file))} aria-label={`Remove camera photo ${index+1}`}>× {index+1}</button></div>)}</div>}
    <p role="status">{photos.length} kept{photo?' + 1 current photo':''} · Not scanned yet</p>
    {!photo && <div className="camera-options"><button className="subtle-btn" disabled={capturing} onClick={()=>setFacing(facing==='environment'?'user':'environment')}>Switch camera</button><label>Timer <select disabled={capturing} value={timer} onChange={e=>setTimer(Number(e.target.value))}><option value={0}>Off</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option></select></label>{zoomMax>1&&<label>Zoom {zoom.toFixed(1)}× <input aria-label="Camera zoom" type="range" min={1} max={zoomMax} step={0.1} value={zoom} onChange={async e=>{const value=Number(e.target.value);try{await stream.current?.getVideoTracks()[0].applyConstraints({advanced:[{zoom:value} as MediaTrackConstraintSet]});setZoom(value);}catch{setError('Zoom is unavailable. Move closer to the label.');}}}/></label>}</div>}
    {countdown>0&&<div className="camera-countdown" role="status">{countdown}</div>}
    <div className="review-fixed-actions">
      {photo ? <><button className="subtle-btn" onClick={() => setPhoto(undefined)}>Retake</button><button className="subtle-btn" disabled={photos.length>=49} onClick={()=>{const file=currentPhoto();if(file)setPhotos(old=>[...old,file]);setPhoto(undefined);setBarcodeStatus('');}}>Take another</button><button className="primary" onClick={finish}>Scan all ({photos.length+1})</button></> : <><button className="primary camera-shutter" disabled={!ready || capturing || photos.length>=50} onClick={capture}>{capturing?'Capturing…':'● Capture'}</button>{photos.length>0&&<button className="primary" disabled={capturing} onClick={finish}>Scan all ({photos.length})</button>}</>}
      {hasTorch && !photo && <button className="subtle-btn" onClick={async () => { try { await stream.current?.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { setError('Flashlight is unavailable on this camera.'); } }}>{torch ? 'Flashlight off' : 'Flashlight on'}</button>}
    </div>
  </div></div>;
}
