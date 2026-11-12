/** What one batch can hold. Matches the Android app (ScanStore.MAX_PHOTOS). */
export const MAX_PHOTOS_PER_BATCH = 1000;

type SpeedBridge = { speedInfo?: () => string };

/** Memory of this phone in GB: from the Android app when available, else the browser's estimate (rounded down to a power of two by the browser). */
export function deviceRamGb(): number {
  try {
    const bridge = (window as Window & { AndroidScanner?: SpeedBridge }).AndroidScanner;
    const info = bridge?.speedInfo ? JSON.parse(bridge.speedInfo()) as { ramGb?: number } : null;
    if (info?.ramGb) return info.ramGb;
  } catch { /* fall through to the browser estimate */ }
  return (navigator as Navigator & { deviceMemory?: number }).deviceMemory || 4;
}

/**
 * How many pictures can sit inside one Excel or Word file before a phone is likely to run out of memory.
 * This is an estimate from the phone's memory, not a measured limit.
 */
export function embedPhotoLimit(): number {
  return Math.max(100, Math.min(600, Math.round(deviceRamGb() * 40)));
}
