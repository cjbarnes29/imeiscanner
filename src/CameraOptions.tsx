import { CAMERA_MODES, type CameraMode } from './camera-mode';

/** Phone camera choices: what happens after each photo, and the photos waiting to be scanned (collect mode). */
export function CameraOptions({ mode, onMode, waiting, onScanNow, onDiscard }: {
  mode: CameraMode;
  onMode: (mode: CameraMode) => void;
  waiting: number;
  onScanNow: () => void;
  onDiscard: () => void;
}) {
  const help = CAMERA_MODES.find(item => item.value === mode)?.help ?? '';
  return <div className="camera-options-native">
    <label>After taking a photo <select aria-label="After taking a photo" value={mode} onChange={event => onMode(event.target.value as CameraMode)}>
      {CAMERA_MODES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    <small>{help} Photos are taken with your phone's own camera and kept only inside this app.</small>
    {waiting > 0 && <div className="camera-waiting" role="status">
      <strong>{waiting} photo{waiting === 1 ? '' : 's'} waiting to be scanned</strong>
      <button type="button" className="primary" onClick={onScanNow}>Scan now</button>
      <button type="button" className="subtle-btn" onClick={onDiscard}>Discard waiting photos</button>
    </div>}
  </div>;
}
