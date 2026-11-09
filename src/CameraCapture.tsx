import { useEffect, useRef, useState } from 'react';

export function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [photo, setPhoto] = useState<Blob>();
  const [preview, setPreview] = useState('');
  const [torch, setTorch] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [barcodeStatus, setBarcodeStatus] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera access requires HTTPS and a supported browser. Photo upload is still available.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(async media => {
      if (cancelled) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const track = media.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() || {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
      setHasTorch(!!caps.torch);
      if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
      setReady(true);
    }).catch(() => setError('The camera could not open. Allow camera permission, close other camera apps, or use photo upload.'));
    return () => { cancelled = true; stream.current?.getTracks().forEach(track => track.stop()); };
  }, []);
  useEffect(() => { if (!photo) { setPreview(''); return; } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  async function capture() {
    const source = video.current;
    if (!source?.videoWidth) return;
    const canvas = document.createElement('canvas'); canvas.width = source.videoWidth; canvas.height = source.videoHeight;
    canvas.getContext('2d')?.drawImage(source, 0, 0);
    const Detector = (window as any).BarcodeDetector;
    if (Detector) {
      try { const codes = await new Detector().detect(canvas); setBarcodeStatus(codes.length ? `${codes.length} barcode(s) detected. The printed IMEI 1 label is still required to identify the correct number.` : 'No barcode detected. Reading the printed label instead.'); }
      catch { setBarcodeStatus('Barcode reading is unavailable. Reading the printed label instead.'); }
    } else setBarcodeStatus('This browser does not provide barcode detection. Reading the printed label instead.');
    canvas.toBlob(blob => { if (blob) setPhoto(blob); else setError('Capture failed. Please try again.'); }, 'image/jpeg', 0.94);
  }
  return <div className="modal-backdrop"><div className="modal camera-modal" role="dialog" aria-modal="true" aria-label="Camera scanner">
    <div className="modal-head"><h2>Scan with camera</h2><button className="subtle-btn" onClick={onClose}>Close</button></div>
    <p>Frame the complete label, including IMEI 1 and the model. Capture, check the photo, then add it to the scan queue.</p>
    {error && <p role="alert">{error}</p>}
    {barcodeStatus && <p role="status">{barcodeStatus}</p>}
    <div className="review-photo-stage"><video ref={video} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', display: photo ? 'none' : 'block' }} />{preview && <img className="preview" src={preview} alt="Captured label" />}</div>
    <div className="review-fixed-actions">
      {photo ? <><button className="subtle-btn" onClick={() => setPhoto(undefined)}>Rescan</button><button className="primary" onClick={() => { onCapture(new File([photo], `camera-imei1-${Date.now()}.jpg`, { type: 'image/jpeg' })); onClose(); }}>Use photo</button></> : <button className="primary" disabled={!ready} onClick={capture}>Capture</button>}
      {hasTorch && <button className="subtle-btn" onClick={async () => { try { await stream.current?.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); } catch { setError('Flashlight is unavailable on this camera.'); } }}>{torch ? 'Flashlight off' : 'Flashlight on'}</button>}
    </div>
  </div></div>;
}
