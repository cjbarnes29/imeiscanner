/** How "Take photo" behaves on the phone, which always uses the phone's own camera app. The default (series) scans each photo while the next one is being taken, so little is left to scan after the last photo. */
export type CameraMode = 'now' | 'series' | 'collect';

export const CAMERA_MODE_KEY = 'imei-camera-mode';

export const CAMERA_MODES: { value: CameraMode; label: string; help: string }[] = [
  { value: 'now', label: 'Scan each photo right away', help: 'Take a photo; it is scanned in the background while you carry on.' },
  { value: 'series', label: 'Keep taking photos, scan each one', help: 'The camera opens again after each photo. Press Back to stop.' },
  { value: 'collect', label: 'Take several, then scan them together', help: 'Photos wait inside the app. Nothing is scanned until you tap Scan now.' },
];

export function normalizeCameraMode(value: unknown): CameraMode {
  return value === 'now' || value === 'collect' ? value : 'series';
}

export type CameraEventDetail = { state?: string; waiting?: number };

const photos = (count: number) => `${count} photo${count === 1 ? '' : 's'}`;

/** One plain sentence for what the camera just did; never silent about a failure. */
export function cameraMessage(detail: CameraEventDetail, mode: CameraMode): string {
  const waiting = Math.max(0, Math.floor(Number(detail.waiting) || 0));
  switch (detail.state) {
    case 'queued': return mode === 'series' ? 'Photo taken and scanning. The camera opens again for the next one; press Back to stop.' : 'Photo taken. Scanning it in the background.';
    case 'waiting': return `${photos(waiting)} waiting. Take another, or tap Scan now.`;
    case 'cancelled': return waiting ? `Camera closed. ${photos(waiting)} still waiting to be scanned.` : 'Camera closed. No photo was taken.';
    case 'kept': return `The camera closed without confirming, but a photo was saved. ${photos(waiting)} waiting to be scanned.`;
    case 'denied': return 'Camera permission was not allowed. Allow Camera for this app in Android settings, or use Choose photos.';
    case 'unavailable': return 'No camera app could be opened on this phone. Use Choose photos instead.';
    default: return 'The photo could not be saved. Try again, or use Choose photos.';
  }
}
