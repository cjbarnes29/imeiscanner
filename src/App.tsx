import { ORIENTATIONS, labelTextScore, barcodeImei, imeiReadingsDisagree, pickImei2, labelledBarcodeImeis, labelledBarcodeLines, resolveImeisFromBarcodes, resolveSerialFromBarcodes, type PositionedBarcode } from './barcode-imei';
import { readDataUrlBarcodes, readImageBarcodes } from './barcode-reader';
import { scoreConfidence } from './confidence';
import { learnCorrection, readLearned, refineModel, writeLearned } from './learning';
import { countModelLabels, gridTileRects, medianLineHeight, mergeOcrLines, needsOrientationCheck, shouldTurn, skewOfCanvas, straightenCanvas, straightenDataUrl, tileRects, unlevelBox } from './multi-detect';
import { useBackLayer } from './back-layer';
import { DeferredInput } from './DeferredInput';
import { phoneInfo, modelCode4, type CatalogEntry } from './phone-names';
import { SAMSUNG_MODELS } from './samsung-models';
import { planMove, planUnassign, planDeletePerson, planAllocation, formatModelReview, formatPersonShare, nextPersonNumber, isPersonView, UNASSIGNED, UNASSIGNED_FILTER } from './people';
import { loadSamsungCatalog, readCatalogEntries } from './SamsungCatalog';
import { deviceAnchors, planDeviceCrops } from './device-labels';
import { labelSeeds, seedCrops, seedPlan } from './seed-layout';
import { mergeQueue, readQueue, writeQueue, type QueueItem } from './crop-queue';
import { buildSharePackage, shareNumberText, type ShareMode } from './share-package';
import { extractSerial, serialLabelRegion, serialReading, unindexedImeis } from './serial';
import { CropStudio, type StudioPlan } from './CropStudio';
import { clampBox, sortReadingOrder, type Box } from './crop-boxes';
import { clearDraft, draftSummary, readDraft, writeDraft, type CropDraft } from './crop-draft';
import { imeiReadings, judgeImei, pairedImei2, repeatedAcrossBoxes, type Judgement } from './imei-validate';
import { canvasStats, planPasses, renderVariant } from './ocr-preprocess';
import { retryLowConfidence } from './ocr-retry';

import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import {
  UploadCloud, ScanLine, Download, Search, Trash2,
  CheckCircle2, AlertTriangle, Copy, Smartphone, Image as ImageIcon,
  X, LoaderCircle, Eye,
  CloudUpload, Camera, Pencil, Share2, Settings, ZoomIn
} from 'lucide-react';
import { createWorker, PSM } from 'tesseract.js';
import { exportModel, type CropRegion, type OcrLine } from './scan-layout';
import { loadInventory, saveInventory, saveOriginalSource } from './record-store';
import { catalogModel } from './SamsungCatalog';
import { CameraCapture } from './CameraCapture';
import { ModelPicker } from './ModelPicker';
import { SettingsPanel } from './SettingsPanel';
import { embedPhotoLimit } from './capacity';
import './text-size';
import { hasSeenWhatsNew, markWhatsNewSeen, TutorialsDialog, WhatsNewDialog } from './Guide';
import { cleanName, normalizeCode, readCustomModels, writeCustomModels, type CustomModels } from './custom-models';

type RecordItem = {
  id: string;
  pictureId: string;
  sourcePictureId?: string;
  uploadBatchId?: string;
  number: number;
  personId: string;
  name: string;
  dataUrl: string;
  originalDataUrl?: string;
  cropDataUrl?: string;
  cropNeedsReview?: boolean;
  /** Where the label text is in the photo (fractions of its size). The review screen opens zoomed on it. */
  focus?: { x: number; y: number; w: number; h: number };
  model: string;
  imei: string;
  /** Second IMEI on dual-SIM labels. Undefined on records saved before this field existed. */
  imei2?: string;
  serial?: string;
  serialNeedsReview?: boolean;
  /** Set when the scanner suspects several devices but could not split them safely. */
  deviceCount?: number;
  deviceImeis?: string[];
  status: 'Valid' | 'Invalid' | 'Review';
  duplicate: boolean;
  createdAt: string;
  raw: string;
};

/** A name made from a code we could not match to a real model, e.g. "Galaxy Z999". */
const isGenericName = (name: string) => /^Galaxy [A-Z]\d{3}$/.test(name) || name === 'Unknown phone';
type PersonGroup = { id: string; label: string; name: string };
/** People are shown by name only; the "Person 3" label is just an internal id and is never displayed. */
const personName = (person: PersonGroup) => (person.name || '').trim() || 'Unnamed';
type LaptopRecord = Omit<RecordItem, 'dataUrl'> & { imageName: string; photoIndex: number };
type AndroidRecord = Omit<RecordItem, 'dataUrl'> & { imageName: string; siblings?: number };
type AndroidBridge = {
  choosePhotos(personId: string): void;
  /** APK 1.22+: scan speed and products per photo for the background scanner. Optional so older APKs keep working. */
  setScanOptions?(speed: string, expected: number): void;
  status(): string;
  image(id: string): string;
  sourceImage(id: string): string;
  stop(): void;
  beginFile(filename: string): string;
  appendFile(token: string, base64: string): boolean;
  finishFile(token: string, filename: string, mimeType: string): boolean;
  abortFile(token: string): void;
  // Folder export (APK 1.5+). Optional so older installed APKs keep working.
  beginFolder?(folderName: string): string;
  appendFolderFile?(token: string, filename: string, base64: string): boolean;
  finishFolder?(token: string): boolean;
  abortFolder?(token: string): void;
  // Android share menu (APK 1.7+): send the staged files through Bluetooth, Quick Share, WhatsApp and so on.
  shareFolder?(token: string, title: string): boolean;
  shareFolderText?(token: string, title: string, text: string): boolean;
  // APK 1.11+: which ways of sending this phone has, and sending straight to Bluetooth.
  sendCapabilities?(): string;
  // APK 1.13+: one remembered save folder, written to without asking.
  saveFolderInfo?(): string;
  chooseSaveFolder?(): void;
  forgetSaveFolder?(): void;
  commitStaged?(token: string, subfolder: string, clean: boolean): boolean;
  shareFolderBluetooth?(token: string, title: string): boolean;
  // APK 1.10+: read the scan in slices (big scans) and share long text through the share menu.
  statusFrom?(from: number): string;
  shareText?(title: string, text: string): boolean;
  setActivePerson?(personId: string): void;
  // Delete every saved scan result and cropped photo kept by the Android app (APK 1.8+).
  resetScans?(): boolean;
};
const androidBridge = (window as Window & { AndroidScanner?: AndroidBridge }).AndroidScanner;
/** Cuts the label area out of a photo for the review preview. Resolves to '' if it cannot be done. */
function cropToFocus(dataUrl: string, focus: { x: number; y: number; w: number; h: number }): Promise<string> {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => {
      try {
        const sx = Math.round(focus.x * image.naturalWidth), sy = Math.round(focus.y * image.naturalHeight);
        const sw = Math.max(1, Math.round(focus.w * image.naturalWidth)), sh = Math.max(1, Math.round(focus.h * image.naturalHeight));
        const scale = Math.min(1, 1600 / Math.max(sw, sh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale));
        canvas.getContext('2d')!.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch { resolve(''); }
    };
    image.onerror = () => resolve('');
    image.src = dataUrl;
  });
}
const NATIVE_IMPORTED_STORE ='imei-lens-native-imported-v1';
function readNativeImportedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(NATIVE_IMPORTED_STORE) || '[]') as string[]); }
  catch { return new Set(); }
}

const STORE = 'imei-lens-records-v1';
const PEOPLE_STORE = 'imei-lens-people-v1';

const digits = (s: string) => s.replace(/\D/g, '');

const IMAGE_NAME = /\.(jpe?g|png|webp|heic|heif|avif|bmp|gif|tiff?)$/i;
/** Phones sometimes hand over photos with a blank type, so the file name counts too. */
const isImageFile = (file: File) => file.type.startsWith('image/') || ((!file.type || file.type === 'application/octet-stream') && IMAGE_NAME.test(file.name));
function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return true; } catch { /* Use the text-selection fallback. */ }
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.focus();
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  return copied;
}

/** A record is a duplicate when another record anywhere in the list (any batch) has the same 15-digit IMEI. */
function markDuplicateRecords(rows: RecordItem[]) {
  const counts = new Map<string, number>();
  for (const row of rows) if (/^\d{15}$/.test(row.imei)) counts.set(row.imei, (counts.get(row.imei) || 0) + 1);
  return rows.map(row => {
    const duplicate = /^\d{15}$/.test(row.imei) && (counts.get(row.imei) || 0) > 1;
    return row.duplicate === duplicate ? row : { ...row, duplicate };
  });
}
/** True when another record (any scan, any person) already has this 15-digit IMEI. Same rule as the Duplicate flag. */
function imeiTakenElsewhere(imei: string, id: string, rows: { id: string; imei: string }[]) {
  return /^\d{15}$/.test(imei) && rows.some(row => row.id !== id && row.imei === imei);
}
/** Which records to delete so that every IMEI is kept once: the most complete copy stays (serial, known model, no review needed, saved crop, then the earliest). */
function duplicateRemovalIds(rows: RecordItem[]): string[] {
  const groups = new Map<string, RecordItem[]>();
  for (const row of rows) if (/^\d{15}$/.test(row.imei)) groups.set(row.imei, [...(groups.get(row.imei) || []), row]);
  const score = (row: RecordItem) => (recordSerial(row) ? 4 : 0) + (isGenericName(row.model) || /unknown/i.test(row.model) ? 0 : 3) + (row.status === "Valid" ? 2 : 0) + (row.cropDataUrl ? 1 : 0);
  const remove: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep = [...group].sort((x, y) => score(y) - score(x) || (x.createdAt < y.createdAt ? -1 : 1))[0];
    for (const row of group) if (row !== keep) remove.push(row.id);
  }
  return remove;
}

async function photoFingerprint(file: Blob) {
  const bytes = await file.arrayBuffer();
  if (crypto.subtle?.digest) {
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // SubtleCrypto is unavailable on an HTTP phone-to-laptop connection.
  let first = 2166136261, second = 2246822519;
  for (const byte of new Uint8Array(bytes)) {
    first = Math.imul(first ^ byte, 16777619);
    second = Math.imul(second ^ byte, 3266489917);
  }
  return `${file.size}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

async function uniqueUploadPhotos(files: File[]) {
  const seen = new Set<string>();
  const unique: File[] = [];
  for (const file of files) {
    const hash = await photoFingerprint(file);
    if (!seen.has(hash)) { seen.add(hash); unique.push(file); }
  }
  return unique;
}

/** How sure the app is about a record (0-100) and why. */
function recordConfidence(row: RecordItem) {
  const pair = recordImeiPair(row);
  return scoreConfidence({
    imei: row.imei, luhnOk: luhnValid(row.imei), barcodeConfirmed: !!row.imei && barcodeImei(row.raw || '', 1) === row.imei,
    imei2Valid: /^\d{15}$/.test(pair.imei2 || '') && luhnValid(pair.imei2 || ''),
    serial: recordSerial(row), serialNeedsReview: row.serialNeedsReview, model: row.model,
    catalogMatched: !!catalogModel(row.raw || ''), duplicate: row.duplicate, cropNeedsReview: row.cropNeedsReview
  });
}

function reviewStatus(row: RecordItem) {
  const serialOnly = !row.imei && !!recordSerial(row);
  const needsReview = row.cropNeedsReview || row.serialNeedsReview || (!serialOnly && row.status !== 'Valid');
  return row.duplicate ? needsReview ? 'Duplicate IMEI · Needs review' : 'Duplicate IMEI' : needsReview ? 'Needs review' : serialOnly ? 'Serial only' : 'Valid';
}

function luhnValid(value: string) {
  if (!/^\d{15}$/.test(value)) return false;

  let sum = 0;

  for (let i = 0; i < 15; i++) {
    let n = Number(value[14 - i]);

    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }

    sum += n;
  }

  return sum % 10 === 0;
}

function extractImei1s(text: string) {
  const labelled = [...text.matchAll(/\bIM[E3][I1!|l]\s*(?:1|01)\s*[:#-]?\s*((?:\d[\s-]*){15})(?![\s-]*\d)/gi)]
    .map(match => digits(match[1]));
  return [...new Set(labelled)];
}

function recordSerial(record: RecordItem) {
  return record.serial ?? extractSerial(record.raw);
}

function cameraImei(text: string) {
  return extractPreferredImei(text);
}

/**
 * Add barcode-confirmed numbers to one device's OCR text. Used for every photo
 * (camera and upload) in every browser. A bare barcode cannot say IMEI 1 versus
 * IMEI 2, so it only counts when the label's OCR text points at it.
 */
async function cameraBarcodeText(photo: string, raw: string, lines:OcrLine[] = [], fromFullPhoto: string[] = []) {
  try {
    const positioned: PositionedBarcode[] = await readDataUrlBarcodes(photo);
    // Barcodes found on the whole photo inside this device's area count too:
    // small S/N bars often decode at full size but not in the cropped picture.
    const values = [...new Set([...positioned.map(code => code.rawValue), ...fromFullPhoto])];
    return [resolveImeisFromBarcodes(values, raw), resolveSerialFromBarcodes(values, raw), raw, labelledBarcodeImeis(positioned, lines)].filter(Boolean).join('\n');
  } catch { return raw; }
}

/** Camera frames: barcodes under "IMEI 1/2" labels give each device a positioned anchor even when OCR misreads the digits. */
async function frameBarcodes(canvas: HTMLCanvasElement): Promise<PositionedBarcode[]> {
  // Small S/N bars only decode at some sizes on compressed photos: sweep several.
  try { return await readImageBarcodes(canvas, canvas.width, canvas.height, [0, 1200, 1400, 1600, 2000, 2600]); } catch { return []; }
}

/**
 * Reads a photo again in overlapping, enlarged tiles. Used when the whole-photo read finds fewer products than
 * the person said are in the photo: small labels at the edges are read at a useful size this way.
 */
async function tiledRead(worker: Awaited<ReturnType<typeof createWorker>>, color: HTMLCanvasElement, products: number, source?: HTMLCanvasElement): Promise<{ lines: OcrLine[]; codes: PositionedBarcode[] }> {
  let lines: OcrLine[] = [];
  const codes: PositionedBarcode[] = [];
  // `source` is the same photo at full resolution (when the working copy was shrunk): tiles are cut from it and the
  // results are mapped back onto `color`, so small labels are read at their real size, not an enlarged blur.
  const from = source || color, ratio = from.width / color.width;
  const tiles = products > 0 ? tileRects(from.width, from.height, products) : gridTileRects(from.width, from.height);
  for (const tile of tiles) {
    await yieldToUi();
    const scale = Math.min(2.5, 1800 / Math.max(tile.width, tile.height));
    const width = Math.max(1, Math.round(tile.width * scale)), height = Math.max(1, Math.round(tile.height * scale));
    const plain = document.createElement('canvas'); plain.width = width; plain.height = height;
    const context = plain.getContext('2d')!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(from, tile.x, tile.y, tile.width, tile.height, 0, 0, width, height);
    const enhanced = document.createElement('canvas'); enhanced.width = width; enhanced.height = height;
    const ec = enhanced.getContext('2d')!; ec.filter = 'grayscale(1) contrast(1.45)'; ec.drawImage(plain, 0, 0);
    try {
      const read = ocrLines((await worker.recognize(enhanced)).data).map(line => ({ ...line, bbox: { x0: (tile.x + line.bbox.x0 / scale) / ratio, x1: (tile.x + line.bbox.x1 / scale) / ratio, y0: (tile.y + line.bbox.y0 / scale) / ratio, y1: (tile.y + line.bbox.y1 / scale) / ratio } }));
      lines = mergeOcrLines(lines, read);
    } catch (error) { console.warn('A tile could not be read', error); }
    for (const code of await readImageBarcodes(plain, width, height, [0, 1600])) {
      if (!code.boundingBox || codes.some(known => known.rawValue === code.rawValue)) continue;
      codes.push({ rawValue: code.rawValue, boundingBox: { x: (tile.x + code.boundingBox.x / scale) / ratio, y: (tile.y + code.boundingBox.y / scale) / ratio, width: code.boundingBox.width / scale / ratio, height: code.boundingBox.height / scale / ratio } });
    }
  }
  return { lines, codes };
}

/**
 * The one "look closer" stage for every image source (camera, uploads, Crop Studio's Auto-detect). The first whole-photo read is
 * weakest on the photos that matter (many small labels), so its own product count cannot be trusted to decide whether to read
 * again. The count therefore also comes from the IMEI barcodes (two per label), the Model lines, the user's setting and the
 * size of the text. When the photo may hold more products than anchors were found, it is read again tile by tile from a
 * full-resolution copy. Returns the merged lines/barcodes, the product count used, and the full-resolution canvas if made.
 */
async function lookCloser(input: { worker: Awaited<ReturnType<typeof createWorker>>; file: File; color: HTMLCanvasElement; lines: OcrLine[]; codes: PositionedBarcode[]; raw: string; expectedProducts: number; fast: boolean; progress?: (text: string) => void }): Promise<{ lines: OcrLine[]; codes: PositionedBarcode[]; raw: string; targetProducts: number; fullRes?: HTMLCanvasElement }> {
  const { worker, file, color, expectedProducts, fast } = input;
  let { lines, codes, raw } = input;
  const width = color.width, height = color.height;
  const known = deviceAnchors(lines, width, height, color.getContext('2d')?.getImageData(0, 0, width, height)).length;
  const smallLabels = medianLineHeight(lines) > 0 && medianLineHeight(lines) < 18 && Math.max(width, height) >= 1000;
  const validNumbers = new Set<string>([...codes.map(code => code.rawValue.replace(/\D/g, '')), ...(raw.replace(/[\s-]/g, '').match(/\d{15}/g) || [])].filter(value => value.length === 15 && luhnValid(value)));
  const numberHint = Math.ceil(validNumbers.size / 2);
  const targetProducts = Math.min(12, expectedProducts || Math.max(countModelLabels(lines), numberHint, smallLabels ? known : 0));
  if (fast || !((targetProducts > 1 || smallLabels) && (known < Math.max(2, targetProducts) || smallLabels))) return { lines, codes, raw, targetProducts };
  input.progress?.(`Looking closer${targetProducts > 1 ? ` for ${targetProducts} products` : ''}: ${file.name}`);
  const before = lines.length;
  // Full-resolution copy: the working copy may have been shrunk, and shrinking is what makes small labels unreadable.
  let fullRes: HTMLCanvasElement | undefined;
  try { const probe = await createScanImages(file, 4800, true); if (probe.color.width > color.width * 1.15) fullRes = probe.color; } catch { /* use the working copy */ }
  const more = await tiledRead(worker, color, fullRes || smallLabels ? 0 : targetProducts, fullRes);
  lines = mergeOcrLines(lines, more.lines);
  for (const code of more.codes) if (!codes.some(old => old.rawValue === code.rawValue)) codes = [...codes, code];
  lines = mergeOcrLines(lines, labelledBarcodeLines(codes, lines));
  if (lines.length > before) raw += '\n' + lines.slice(before).map(line => line.text).join('\n');
  return { lines, codes, raw, targetProducts, fullRes };
}
function extractPreferredImei(text: string) {
  // A barcode-confirmed number is exact; it beats any OCR reading.
  const fromBarcode = barcodeImei(text, 1);
  if (fromBarcode) return fromBarcode;
  const first = extractImei1s(text).filter(luhnValid);
  if (first.length === 1) return first[0];
  if (first.length > 1) return '';
  // A bare "IMEI: …" (Apple/Pixel style, or OCR dropped the 1) ranks above IMEI 2.
  const plain = unindexedImeis(text).filter(luhnValid);
  if (plain.length === 1) return plain[0];
  if (plain.length > 1) return '';
  const secondFromBarcode = barcodeImei(text, 2);
  if (secondFromBarcode) return secondFromBarcode;
  const second = [...text.matchAll(/\bIM[E3][I1!|l]\s*(?:2|02)\s*[:#-]?\s*((?:\d[\s-]*){15})(?![\s-]*\d)/gi)].map(match => digits(match[1])).filter(luhnValid);
  const unique = [...new Set(second)];
  return unique.length === 1 ? unique[0] : '';
}

function hasMultipleDeviceText(raw:string) {
  const second=[...new Set([...raw.matchAll(/\bIMEI\s*2\s*[:#-]?\s*((?:\d[ -]*){15})/gi)].map(m=>m[1].replace(/\D/g,'')))];
  return extractImei1s(raw).length>1 || second.length>1 || (!extractPreferredImei(raw) && !extractSerial(raw) && !!serialReading(raw).serial);
}

function identifyModel(text: string, filename: string, mostlyWhite = false) {
  const verified = catalogModel(text);
  if (verified) return verified;
  const labelledCode = text.match(/\bmodel\s*[:：-]?\s*S\s*M\s*[-–—]?\s*([A-Z0-9]{5})/i);
  const codes = [...new Set([...text.matchAll(/\bS\s*M\s*[-–—]\s*([A-Z0-9]{5})/gi)].map(match => match[1].toUpperCase()))];
  const labelled = labelledCode?.[1].toUpperCase();
  const exact = codes.filter(code => /^[A-Z][0-9]{3}[A-Z0-9]$/.test(code));
  const code = labelled && exact.includes(labelled) ? labelled : exact.length === 1 ? exact[0] : labelled || codes[0];
  if (code) return `SM-${code}`;
  const s = (text + ' ' + filename)
    .toLowerCase()
    .replace(/[_-]/g, ' ');

  const patterns: [RegExp, string][] = [
    [/galaxy\s*s26|sm s94|sm s93/, 'Samsung Galaxy S26 series'],
    [/galaxy\s*s25\s*ultra|sm\s*s938/, 'Samsung Galaxy S25 Ultra'],
    [/galaxy\s*s25\s*\+|galaxy\s*s25\s*plus|sm\s*s936/, 'Samsung Galaxy S25+'],
    [/galaxy\s*s25|sm\s*s931/, 'Samsung Galaxy S25'],
    [/galaxy\s*s24\s*ultra|sm\s*s928/, 'Samsung Galaxy S24 Ultra'],
    [/galaxy\s*s24\s*\+|galaxy\s*s24\s*plus|sm\s*s926/, 'Samsung Galaxy S24+'],
    [/galaxy\s*s24|sm\s*s921/, 'Samsung Galaxy S24'],
    [/galaxy\s*s23\s*ultra|sm\s*s918/, 'Samsung Galaxy S23 Ultra'],
    [/galaxy\s*s23|sm\s*s911/, 'Samsung Galaxy S23'],
    [/galaxy\s*a56|sm\s*a566/, 'Samsung Galaxy A56'],
    [/galaxy\s*a55|sm\s*a556/, 'Samsung Galaxy A55'],
    [/galaxy\s*a36|sm\s*a366/, 'Samsung Galaxy A36'],
    [/galaxy\s*a35|sm\s*a356/, 'Samsung Galaxy A35'],
    [/galaxy\s*a\d{2}/, 'Samsung Galaxy A series'],
    [/galaxy\s*z\s*fold\s*7|sm\s*f966/, 'Samsung Galaxy Z Fold7'],
    [/galaxy\s*z\s*fold\s*6|sm\s*f956/, 'Samsung Galaxy Z Fold6'],
    [/galaxy\s*z\s*flip\s*7|sm\s*f766/, 'Samsung Galaxy Z Flip7'],
    [/galaxy\s*z\s*flip\s*6|sm\s*f741/, 'Samsung Galaxy Z Flip6'],
    [/iphone\s*17\s*pro\s*max/, 'Apple iPhone 17 Pro Max'],
    [/iphone\s*17\s*pro/, 'Apple iPhone 17 Pro'],
    [/iphone\s*17/, 'Apple iPhone 17'],
    [/iphone\s*16\s*pro\s*max/, 'Apple iPhone 16 Pro Max'],
    [/iphone\s*16\s*pro/, 'Apple iPhone 16 Pro'],
    [/iphone\s*16/, 'Apple iPhone 16'],
    [/iphone\s*15/, 'Apple iPhone 15'],
    [/pixel\s*9/, 'Google Pixel 9'],
    [/sm\s*s?2[0-9]{3}|galaxy\s*s\s*2[0-9]{3}/, 'Samsung Galaxy S20 series'],
    [/sm\s*s?9[0-9]{2}|galaxy\s*s\s*9[0-9]{2}/, 'Samsung Galaxy S9 series']
  ];

  for (const [re, name] of patterns) {
    if (re.test(s)) return name;
  }

  return mostlyWhite ? 'Series — review' : 'Unknown unit — review';
}

function looksMostlyWhite(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) return false;

  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));
  let bright = 0;
  let samples = 0;

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const index = (y * width + x) * 4;
      const lightness = (data[index] + data[index + 1] + data[index + 2]) / 3;
      samples++;
      if (lightness >= 225) bright++;
    }
  }

  return samples > 0 && bright / samples >= 0.62;
}

function readRecords(): RecordItem[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORE) || '[]') as Partial<RecordItem>[];
    return stored.map((row, index) => ({
      ...row,
      number: Number.isInteger(row.number) && row.number! >= 3 ? row.number! : index + 3,
      pictureId: row.pictureId || `PIC-${row.id || index + 1}`,
      personId: row.personId || 'person-1'
    } as RecordItem));
  } catch {
    return [];
  }
}

function readPeople(): PersonGroup[] {
  try {
    const people = JSON.parse(localStorage.getItem(PEOPLE_STORE) || '[]') as PersonGroup[];
    return people.length ? people : [{ id: 'person-1', label: 'Person 1', name: '' }];
  } catch {
    return [{ id: 'person-1', label: 'Person 1', name: '' }];
  }
}

function personTitle(record: RecordItem, people: PersonGroup[]) {
  const person = people.find(item => item.id === record.personId);
  return person ? (person.name || '').trim() || 'Unnamed' : 'Unassigned';
}

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (androidBridge) {
    const token = androidBridge.beginFile(filename);
    if (!token) throw new Error('Finish or cancel the current save before starting another.');
    try {
      for (let offset = 0; offset < blob.size; offset += 64 * 1024) {
        const chunk = await blobDataUrl(blob.slice(offset, offset + 64 * 1024));
        if (!androidBridge.appendFile(token, chunk.split(',')[1] || '')) throw new Error('Could not transfer the file to Android.');
      }
      if (!androidBridge.finishFile(token, filename, blob.type || 'application/octet-stream')) throw new Error('Could not open the Android save screen.');
    } catch (error) {
      androidBridge.abortFile(token);
      throw error;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const WA_PROGRESS_KEY = 'imei-lens-wa-progress-v1';
/** Which pictures were already sent to WhatsApp, per person, so a long send can continue where it stopped. */
function readWaProgress(sectionId: string): string[] {
  try { const all = JSON.parse(localStorage.getItem(WA_PROGRESS_KEY) || '{}') as Record<string, string[]>; return Array.isArray(all[sectionId]) ? all[sectionId] : []; }
  catch { return []; }
}
function writeWaProgress(sectionId: string, ids: string[]) {
  try {
    const all = JSON.parse(localStorage.getItem(WA_PROGRESS_KEY) || '{}') as Record<string, string[]>;
    if (ids.length) all[sectionId] = ids; else delete all[sectionId];
    localStorage.setItem(WA_PROGRESS_KEY, JSON.stringify(all));
  } catch { /* progress is a convenience: ignore a full storage */ }
}
/** Draws the photo at a readable size with a little extra contrast and sharpness. No text is ever written on it. */
function drawReadable(image: HTMLImageElement, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale)), height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingQuality = 'high';
  context.filter = 'contrast(1.12) brightness(1.04)';
  context.drawImage(image, 0, 0, width, height);
  context.filter = 'none';
  // Gentle sharpen (unsharp mask) so small label print stays crisp after shrinking.
  const data = context.getImageData(0, 0, width, height), src = data.data, out = new Uint8ClampedArray(src);
  const amount = 0.6, row = width * 4;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * row + x * 4;
    for (let c = 0; c < 3; c++) {
      const blur = (src[i + c - 4] + src[i + c + 4] + src[i + c - row] + src[i + c + row]) / 4;
      out[i + c] = src[i + c] + (src[i + c] - blur) * amount;
    }
  }
  data.data.set(out); context.putImageData(data, 0, 0);
  return canvas;
}
/** The photo as a clear JPEG with no text on it. */
function readablePhoto(dataUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try { drawReadable(image, 1600).toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare a picture.')), 'image/jpeg', 0.9); }
      catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error('A picture could not be opened.'));
    image.src = dataUrl;
  });
}

const ONE_BY_ONE_KEY = 'imei-lens-onebyone-v1';
type OneByOneState = { index: number; done: string[] };
/** Where the one-by-one screen stopped for a person, and which pictures were already downloaded. */
function readOneByOne(sectionId: string): OneByOneState {
  try {
    const all = JSON.parse(localStorage.getItem(ONE_BY_ONE_KEY) || '{}') as Record<string, OneByOneState>;
    const saved = all[sectionId];
    return saved && Array.isArray(saved.done) ? { index: Number(saved.index) || 0, done: saved.done } : { index: 0, done: [] };
  } catch { return { index: 0, done: [] }; }
}
function writeOneByOne(sectionId: string, state: OneByOneState) {
  try {
    const all = JSON.parse(localStorage.getItem(ONE_BY_ONE_KEY) || '{}') as Record<string, OneByOneState>;
    if (state.done.length || state.index) all[sectionId] = state; else delete all[sectionId];
    localStorage.setItem(ONE_BY_ONE_KEY, JSON.stringify(all));
  } catch { /* progress is a convenience */ }
}

/** The photo as base64 JPEG, smaller and clearer, with no text on it. */
function readablePhotoBase64(dataUrl: string, maxEdge = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try { resolve(drawReadable(image, maxEdge).toDataURL('image/jpeg', 0.9).split(',')[1] || ''); }
      catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error('A picture could not be opened.'));
    image.src = dataUrl;
  });
}
const base64ToBytes = (base64: string) => Uint8Array.from(atob(base64), character => character.charCodeAt(0));
const textToBase64 = (text: string) => { let binary = ''; for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte); return btoa(binary); };

function dataUrlBlob(dataUrl: string) {
  const [head, body] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function compactPhoto(dataUrl: string): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/**
 * The original photo is kept for manual cropping later. A raw phone photo is 3-5 MB and is
 * most of what the app stores, so keep it at up to 3200 px (scans only ever use 2400 px)
 * as a high-quality JPEG. Anything that cannot be re-encoded is kept exactly as it is.
 */
async function shrinkOriginal(file: File): Promise<Blob> {
  if (file.size < 1.2 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const smaller = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    return smaller && smaller.size < file.size * 0.9 ? smaller : file;
  } catch { return file; }
}

function recordPhoto(record: RecordItem) {
  return record.cropDataUrl || record.dataUrl;
}

function createPhotoGalleryHtml(rows: RecordItem[], people: PersonGroup[]) {
  const photoItems = rows.map(record => {
    const name = photoFilename(record).replace(/^#/, 'photo-');
    return `<article class="card"><div class="preview"><img src="${htmlEscape(recordPhoto(record))}" alt="Photo for record ${record.number}"></div><div class="card-body"><span class="record">RECORD #${record.number} · ${htmlEscape(record.pictureId)}</span><h2>${htmlEscape(record.model)}</h2><div class="details"><span>IMEI</span><strong>${htmlEscape(record.imei || 'Not detected')}</strong><span>S/N</span><strong>${htmlEscape(recordSerial(record) || 'Not detected')}</strong><span>PERSON</span><strong>${htmlEscape(personTitle(record, people))}</strong><span>STATUS</span><strong>${htmlEscape(reviewStatus(record))}</strong></div><div class="actions"><button class="view" type="button" data-imei="${htmlEscape(record.imei)}" onclick="copyImei(this)" ${record.imei ? '' : 'disabled'}>Copy IMEI</button><button class="view" type="button" data-imei="${htmlEscape(recordSerial(record))}" onclick="copyImei(this)" ${recordSerial(record) ? '' : 'disabled'}>Copy S/N</button><button class="view" type="button" onclick="viewPhoto(this)">View photo</button><button class="download" type="button" data-filename="${htmlEscape(name)}" onclick="savePhoto(this)">Download photo</button></div></div></article>`;
  });
  const galleryHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IMEI Lens — Photo library</title><style>*{box-sizing:border-box}body{margin:0;background:#0b1220;color:#e7eef7;font-family:system-ui,-apple-system,sans-serif}header{border-bottom:1px solid #27394d;background:#101d2d;padding:22px max(20px,calc((100vw - 1080px)/2))}.brand{font-weight:800;letter-spacing:.14em;font-size:13px}.brand span{color:#62dcb5}main{max-width:1120px;margin:auto;padding:34px 20px 48px}.eyebrow{font-size:10px;letter-spacing:.18em;color:#62dcb5;font-weight:800}h1{font-size:clamp(28px,5vw,42px);margin:10px 0}main>p{color:#a0b1c5;line-height:1.6;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(275px,1fr));gap:16px}.card{background:#111e2e;border:1px solid #2a3b50;border-radius:14px;overflow:hidden}.preview{display:block;height:205px;background:#091321;text-align:center;padding:12px}.preview img{width:100%;height:100%;object-fit:contain}.card-body{padding:17px}.record{font-size:10px;letter-spacing:.12em;color:#60d9b1;font-weight:800}h2{font-size:16px;margin:8px 0 15px}.details{display:grid;grid-template-columns:65px 1fr;gap:8px;font-size:12px;align-items:start}.details span{color:#8498af;font-size:10px;letter-spacing:.08em}.details strong{overflow-wrap:anywhere;font-weight:600}.actions{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}.actions button{cursor:pointer;border:0;flex:1;text-align:center;padding:11px 12px;border-radius:8px;font-size:12px;font-weight:750;text-decoration:none}.view{color:#d8e7f4;border:1px solid #3b5067;background:#1a2a3e}.download{background:#5bd5ad;color:#08251d}.foot{color:#8092a9;font-size:11px;margin-top:24px;line-height:1.5}@media(max-width:480px){main{padding:25px 15px}.grid{grid-template-columns:1fr}.preview{height:230px}.actions button{cursor:pointer;border:0;min-width:130px}}dialog{max-width:95vw;max-height:95vh;border:1px solid #3b5067;border-radius:12px;background:#101d2d;color:white}dialog::backdrop{background:#000c}dialog img{display:block;max-width:85vw;max-height:75vh;object-fit:contain}dialog button{margin:12px 0 0;padding:10px 18px;border:0;border-radius:8px;cursor:pointer}.grid{display:flex;flex-direction:column;gap:8px}.card{border-radius:10px}.card .preview{display:none}.card-body{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:18px;row-gap:4px;align-items:center;padding:12px 16px}.card-body .record,.card-body h2,.card-body .details{grid-column:1}.card-body h2{margin:0;font-size:15px}.card-body .details{grid-template-columns:48px minmax(0,1fr);gap:4px;font-size:12px}.card-body .actions{grid-column:2;grid-row:1 / 4;margin:0;justify-content:flex-end}.card-body .actions button{flex:none;min-width:100px;padding:10px}.card-body .actions button:disabled{opacity:.4;cursor:not-allowed}@media(max-width:700px){.card-body{display:block}.card-body h2{margin:4px 0 8px}.card-body .actions{margin-top:12px;justify-content:flex-start}.card-body .actions button{flex:1;min-width:95px;padding:10px 6px}}dialog{position:fixed;inset:0;margin:auto;padding:48px 16px 16px}dialog .dialog-close{position:absolute;right:8px;top:3px;margin:0;width:40px;height:40px;padding:0;background:transparent;color:#fff;font-size:30px;line-height:1}</style></head><body><header><div class="brand"><span>▣</span> IMEI LENS</div></header><main><div class="eyebrow">OFFLINE PHOTO LIBRARY</div><h1>Device list</h1><p>${rows.length} record(s) · Copy an IMEI, view a picture, or download a photo.</p><section class="grid">${photoItems.join('')}</section><p class="foot">Photos are embedded in this page. Original files are also available separately.</p></main><dialog id="viewer" onclick="closePhotoOnBackdrop(event)"><button type="button" class="dialog-close" aria-label="Close photo" onclick="document.getElementById('viewer').close()">×</button><img alt="Full-size photo"><button type="button" onclick="document.getElementById('viewer').close()">Close</button></dialog><script>async function copyImei(button){var value=button.dataset.imei;if(!value)return;var copied=false;if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(value);copied=true}catch(error){}}if(!copied){var field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.focus();field.select();field.setSelectionRange(0,value.length);try{copied=document.execCommand('copy')}catch(error){}field.remove()}button.textContent=copied?'Copied!':'Copy failed — try again'}function closePhotoOnBackdrop(event){var dialog=event.currentTarget;var rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))dialog.close()}function viewPhoto(button){var dialog=document.getElementById('viewer');dialog.querySelector('img').src=button.closest('article').querySelector('img').src;dialog.showModal()}function savePhoto(button){var link=document.createElement('a');link.href=button.closest('article').querySelector('img').src;link.download=button.dataset.filename;document.body.appendChild(link);link.click();link.remove()}</script></body></html>`;
  return makeStableGalleryHtml(galleryHtml);
}

function makeStableGalleryHtml(html: string) {
  const css = `
dialog#viewer{width:min(900px,calc(100vw - 20px));height:min(680px,calc(100dvh - 20px));max-width:none;max-height:none;overflow:hidden;padding:50px 16px 16px}
dialog#viewer[open]{display:flex;flex-direction:column}
dialog#viewer .viewer-stage{flex:1;min-height:0;width:100%;display:grid;place-items:center;background:#091321;border-radius:9px;overflow:hidden}
dialog#viewer .viewer-stage img{width:100%;height:100%;max-width:none;max-height:none;object-fit:contain}
dialog#viewer>button:not(.dialog-close){display:none}
dialog#viewer .viewer-toolbar{flex:none;min-height:54px;display:grid;grid-template-columns:70px 1fr 70px repeat(3,110px);align-items:center;gap:6px}
dialog#viewer .viewer-toolbar button{margin:0;min-width:0;height:44px;padding:6px;border:1px solid #3b5067;border-radius:8px;background:#1a2a3e;color:#e7eef7;font-weight:700}
dialog#viewer .viewer-toolbar button:disabled{opacity:.4;cursor:not-allowed}
dialog#viewer .viewer-counter{text-align:center;color:#b8cadd;font-size:12px}
@media(max-width:700px){dialog#viewer{padding:50px 10px 10px}dialog#viewer .viewer-toolbar{min-height:100px;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:44px 44px}dialog#viewer .viewer-counter{grid-column:2;grid-row:1}dialog#viewer .viewer-toolbar button{font-size:11px}dialog#viewer .viewer-prev{grid-column:1;grid-row:1}dialog#viewer .viewer-next{grid-column:3;grid-row:1}}
`;
  const script = `<script>(function(){
var dialog=document.getElementById('viewer'),image=dialog.querySelector('img'),cards=Array.from(document.querySelectorAll('article.card'));
var stage=document.createElement('div');stage.className='viewer-stage';image.before(stage);stage.appendChild(image);
var toolbar=document.createElement('div');toolbar.className='viewer-toolbar';
toolbar.innerHTML='<button class="viewer-prev" type="button">Previous</button><span class="viewer-counter"></span><button class="viewer-next" type="button">Next</button><button class="viewer-copy" type="button">Copy IMEI</button><button class="viewer-download" type="button">Download</button><button class="viewer-close" type="button">Close</button>';
dialog.appendChild(toolbar);
var previous=toolbar.querySelector('.viewer-prev'),next=toolbar.querySelector('.viewer-next'),counter=toolbar.querySelector('.viewer-counter'),copy=toolbar.querySelector('.viewer-copy'),download=toolbar.querySelector('.viewer-download');var current=-1;
function show(index){current=index;var card=cards[index];image.src=card.querySelector('img').src;image.alt='Photo '+(index+1);counter.textContent=(index+1)+' of '+cards.length;previous.disabled=index===0;next.disabled=index===cards.length-1;copy.disabled=!card.querySelector('[data-imei]').dataset.imei;copy.textContent='Copy IMEI';}
window.viewPhoto=function(button){show(cards.indexOf(button.closest('article')));dialog.showModal()};
window.savePhoto=function(button){try{var source=button.closest('article').querySelector('img').src;var parts=source.split(',');var mime=(parts[0].match(/data:([^;]+)/)||[])[1]||'image/jpeg';var binary=atob(parts[1]);var bytes=new Uint8Array(binary.length);for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);var url=URL.createObjectURL(new Blob([bytes],{type:mime}));var link=document.createElement('a');link.href=url;link.download=button.dataset.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(function(){URL.revokeObjectURL(url)},60000)}catch(error){alert('Could not download this photo: '+(error&&error.message||error))}};
previous.onclick=function(){if(current>0)show(current-1)};next.onclick=function(){if(current<cards.length-1)show(current+1)};
copy.onclick=async function(){var source=cards[current].querySelector('[data-imei]');await copyImei(source);copy.textContent=source.textContent};
download.onclick=function(){savePhoto(cards[current].querySelector('[data-filename]'))};toolbar.querySelector('.viewer-close').onclick=function(){dialog.close()};
document.addEventListener('keydown',function(event){if(!dialog.open)return;if(event.key==='ArrowLeft'&&current>0)show(current-1);if(event.key==='ArrowRight'&&current<cards.length-1)show(current+1)});
})();</script>`;
  return html.replace('</style>', css + '</style>').replace('</body>', script + '</body>');
}

function ocrLines(page: Awaited<ReturnType<Awaited<ReturnType<typeof createWorker>>['recognize']>>['data']): OcrLine[] {
  return page.lines?.length ? page.lines : (page.blocks || []).flatMap(block =>
    (block.paragraphs || []).flatMap(paragraph => paragraph.lines || [])
  );
}

async function createCroppedPhotos(image: HTMLCanvasElement | string, regions: CropRegion[], width: number, height: number) {
  const source = typeof image === 'string' ? new Image() : image;
  if (typeof image === 'string') { const photo = source as HTMLImageElement; photo.src = image; await photo.decode(); }
  const imageWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const imageHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const scaleX = imageWidth / width;
  const scaleY = imageHeight / height;
  const result = new Map<string, string>();
  for (const region of regions) {
    const canvas = document.createElement('canvas');
    const x = Math.round(region.x * scaleX);
    const y = Math.round(region.y * scaleY);
    canvas.width = Math.max(1, Math.min(imageWidth - x, Math.round(region.width * scaleX)));
    canvas.height = Math.max(1, Math.min(imageHeight - y, Math.round(region.height * scaleY)));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the separated photos.');
    context.drawImage(source, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    const cut = canvas.toDataURL('image/jpeg', 0.9);
    // Tilted label? Level it so the text reads straight (and the second read is more accurate).
    result.set(region.imei, (await straightenDataUrl(cut)).dataUrl);
    await yieldToUi();
  }
  return result;
}

async function rotatePhoto(dataUrl: string, direction: 'left' | 'right') {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalHeight;
  canvas.height = image.naturalWidth;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not rotate this picture.');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(direction === 'right' ? Math.PI / 2 : -Math.PI / 2);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas.toDataURL('image/jpeg', 0.95);
}

function createOcrImage(file: File, maxDimension = 2400): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);

      const scale = Math.min(3, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Could not prepare this image for text recognition.'));
        return;
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.filter = 'grayscale(1) contrast(1.45)';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image format could not be opened by the browser.'));
    };

    image.src = url;
  });
}

function createScanImages(file: File, maxDimension: number, colorOnly = false): Promise<{ color: HTMLCanvasElement; enhanced: HTMLCanvasElement }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(image.naturalWidth, image.naturalHeight);
      const colorScale = Math.min(1, maxDimension / longest);
      const enhancedScale = colorOnly ? 0.001 : Math.min(3, maxDimension / longest);
      const color = document.createElement('canvas');
      color.width = Math.max(1, Math.round(image.naturalWidth * colorScale));
      color.height = Math.max(1, Math.round(image.naturalHeight * colorScale));
      const enhanced = document.createElement('canvas');
      enhanced.width = Math.max(1, Math.round(image.naturalWidth * enhancedScale));
      enhanced.height = Math.max(1, Math.round(image.naturalHeight * enhancedScale));
      const colorContext = color.getContext('2d');
      const enhancedContext = enhanced.getContext('2d');
      if (!colorContext || !enhancedContext) { reject(new Error('Could not prepare this photo.')); return; }
      colorContext.drawImage(image, 0, 0, color.width, color.height);
      enhancedContext.filter = 'grayscale(1) contrast(1.45)';
      enhancedContext.drawImage(image, 0, 0, enhanced.width, enhanced.height);
      resolve({ color, enhanced });
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image format could not be opened.')); };
    image.src = url;
  });
}

function scaleOcrLines(lines: OcrLine[], from: HTMLCanvasElement, to: HTMLCanvasElement): OcrLine[] {
  const x = to.width / from.width, y = to.height / from.height;
  return lines.map(line => ({ ...line, bbox: {
    x0: line.bbox.x0 * x, x1: line.bbox.x1 * x,
    y0: line.bbox.y0 * y, y1: line.bbox.y1 * y
  } }));
}

async function readSerialPhoto(worker: Awaited<ReturnType<typeof createWorker>>, photo: string, onLines?: (lines:OcrLine[])=>void) {
  const image = new Image(); image.src=photo; await image.decode();
  const canvas=document.createElement('canvas'); canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
  const region=serialLabelRegion(ctx.getImageData(0,0,canvas.width,canvas.height));
  await worker.setParameters({tessedit_pageseg_mode: PSM.SINGLE_BLOCK});
  for(const angle of [6,0,-6]) {
    const target=document.createElement('canvas'); const scale=Math.min(3,2200/Math.max(region.width,region.height));
    target.width=Math.ceil(region.width*scale*1.2);target.height=Math.ceil(region.height*scale*1.2);
    const c=target.getContext('2d')!;c.fillStyle='white';c.fillRect(0,0,target.width,target.height);c.translate(target.width/2,target.height/2);c.rotate(angle*Math.PI/180);
    c.filter='grayscale(1) contrast(1.15)';c.drawImage(canvas,region.x,region.y,region.width,region.height,-region.width*scale/2,-region.height*scale/2,region.width*scale,region.height*scale);
    const result=await worker.recognize(target);const raw=result.data.text || '';
    if(extractPreferredImei(raw)||serialReading(raw).serial) {
      if(onLines){const radians=angle*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
        onLines(ocrLines(result.data).map(line=>{const points=[[line.bbox.x0,line.bbox.y0],[line.bbox.x1,line.bbox.y0],[line.bbox.x0,line.bbox.y1],[line.bbox.x1,line.bbox.y1]].map(([x,y])=>{const dx=x-target.width/2,dy=y-target.height/2;return {x:region.x+region.width/2+(dx*cos+dy*sin)/scale,y:region.y+region.height/2+(-dx*sin+dy*cos)/scale};});return {text:line.text,bbox:{x0:Math.max(0,Math.min(...points.map(p=>p.x))),y0:Math.max(0,Math.min(...points.map(p=>p.y))),x1:Math.min(canvas.width,Math.max(...points.map(p=>p.x))),y1:Math.min(canvas.height,Math.max(...points.map(p=>p.y)))}};}));
      }
 await worker.setParameters({tessedit_pageseg_mode: PSM.SPARSE_TEXT}); return raw; }
  }
  await worker.setParameters({tessedit_pageseg_mode: PSM.SPARSE_TEXT});
  return '';
}

/** White-on-black text reads far better inverted: flip a canvas to dark-on-light grayscale. */
function invertCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height), data = image.data;
  let low = 255, high = 0;
  for (let i = 0; i < data.length; i += 4) { const gray = 255 - (data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114); data[i] = data[i + 1] = data[i + 2] = gray; if (gray < low) low = gray; if (gray > high) high = gray; }
  const span = Math.max(1, high - low);
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = (data[i] - low) * 255 / span;
  context.putImageData(image, 0, 0);
  return canvas;
}

/** Share of clearly bright pixels in a canvas: low means dark labels with light text. */
function brightShare(source: HTMLCanvasElement): number {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, 64, 64);
  const data = context.getImageData(0, 0, 64, 64).data; let bright = 0;
  for (let i = 0; i < data.length; i += 4) if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 170) bright++;
  return bright / (data.length / 4);
}

/** True when a picture is mostly dark (a dark label with light text). */
async function isDarkPicture(source: string): Promise<boolean> {
  const image = new Image(); image.src = source; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 48;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, 48, 48);
  const data = context.getImageData(0, 0, 48, 48).data; let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  return sum / (data.length / 4) < 115;
}

async function pictureCanvas(source: string): Promise<HTMLCanvasElement> {
  const image = new Image(); image.src = source; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return canvas;
}

async function readCropImei(worker: Awaited<ReturnType<typeof createWorker>>, cropDataUrl: string, mode: 'fast' | 'standard' | 'detailed' = 'detailed') {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
  // A dark crop is read inverted from the start; reading it normally first wastes passes.
  const dark = mode !== 'fast' && await isDarkPicture(cropDataUrl);
  const firstRead=await worker.recognize(dark ? invertCanvas(await pictureCanvas(cropDataUrl)) : cropDataUrl);
  let cropLines=ocrLines(firstRead.data);
  let raw=firstRead.data.text || '';
  let first = extractImei1s(raw);
  if (mode !== 'fast' && (first.length !== 1 || !luhnValid(first[0]))) {
    const enhanced = dark ? invertCanvas(await pictureCanvas(cropDataUrl)) : await createOcrImage(new File([dataUrlBlob(cropDataUrl)], 'crop.jpg', { type: 'image/jpeg' }));
    const enhancedText = dark ? '' : (await worker.recognize(enhanced)).data.text || '';
    if (enhancedText) raw += `\n${enhancedText}`;
    first = extractImei1s(raw);
    if (mode === 'detailed' && (first.length !== 1 || !luhnValid(first[0]))) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const blockText = (await worker.recognize(enhanced)).data.text || '';
      if (blockText) raw += `\n${blockText}`;
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    }
  }
  if (!extractPreferredImei(raw) && !extractSerial(raw)) { const serialRaw = await readSerialPhoto(worker, cropDataUrl,focusedLines=>{cropLines=focusedLines;}); if (serialRaw) raw = serialRaw; }
  return { raw, imei: extractPreferredImei(raw), lines:cropLines };
}

/**
 * Second-chance reads for one device's picture, only for what is still missing:
 * - IMEI 2: printed just right of IMEI 1 on the same strip. Re-read a tight box to
 *   the right of each IMEI line at 2x; pickImei2 checks it against IMEI 1's serial block.
 * - Serial: Samsung prints S/N at the top-left of the label; read just that corner,
 *   where barcodes do not drown out the short line.
 */
async function refineCropText(worker: Awaited<ReturnType<typeof createWorker>>, photo: string, raw: string, lines: OcrLine[]) {
  try {
    const imei = extractPreferredImei(raw);
    const needImei2 = !!imei && !pickImei2(imei, raw), needSerial = !extractSerial(raw);
    if (!needImei2 && !needSerial) return raw;
    const image = new Image(); image.src = photo; await image.decode();
    const W = image.naturalWidth, H = image.naturalHeight;
    const cut = (left: number, top: number, width: number, height: number, scale: number) => {
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d')!; context.imageSmoothingQuality = 'high'; context.filter = 'grayscale(1) contrast(1.4)';
      context.drawImage(image, left, top, width, height, 0, 0, canvas.width, canvas.height); return canvas;
    };
    if (needImei2) {
      const strip = lines.filter(line => line.bbox && /IM[E3][I1!|L]/i.test(line.text) && line.text.replace(/\D/g, '').length >= 6).slice(0, 4);
      for (const line of strip) {
        const h = Math.max(8, line.bbox.y1 - line.bbox.y0), w = line.bbox.x1 - line.bbox.x0;
        const left = Math.min(W - 1, Math.round(line.bbox.x1 + h * .4)), top = Math.max(0, Math.round(line.bbox.y0 - h * 1.3));
        const width = Math.min(W - left, Math.round(w * 1.35)), height = Math.min(H - top, Math.round(h * 2.6));
        if (width < 20 || height < 8) continue;
        const canvas = cut(left, top, width, height, 2);
        for (const mode of [PSM.SINGLE_BLOCK, PSM.SPARSE_TEXT]) {
          await worker.setParameters({ tessedit_pageseg_mode: mode });
          raw += `\n${(await worker.recognize(canvas)).data.text || ''}`;
        }
        if (pickImei2(imei, raw)) break;
      }
    }
    if (needSerial) {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const cornerText = (await worker.recognize(cut(0, 0, Math.round(W * .6), Math.round(H * .6), 1))).data.text || '';
      if (extractSerial(cornerText)) raw = `${cornerText}\n${raw}`;
    }
  } catch (error) { console.warn('Refine pass failed', error); }
  finally { await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }); }
  return raw;
}

/** Records that may hold several devices or nothing readable: candidates for bulk cropping. */
const needsCropping = (record: RecordItem) => !!record.cropNeedsReview || (!record.imei && !recordSerial(record));
type DrawnBox = Box;
type SplitCrop = {
  cropDataUrl: string; imei: string; model: string; raw: string;
  /** 0-100, how sure the reading is. */
  confidence?: number; reason?: string;
  /** Other numbers worth a "did you mean". */
  suggestions?: string[];
  /** The OCR reading a checksum repair started from. */
  fixedFrom?: string;
  /** True when a person should look at this one. */
  review?: boolean;
};
type BulkItem = { id: string; name: string; source: string; deviceCount?: number; model: string; single?: boolean };
type CropGroup = { id: string; name: string; source: string; crops: SplitCrop[] };

/**
 * Text-reading worker using the engine and language data served by this app itself
 * (public/ocr), not a CDN: no download on the first scan, and it works offline.
 */
const OCR_BASE = new URL('ocr', document.baseURI).href;
/** Let the page repaint and answer taps between heavy steps (canvas work, barcode decoding and picture treatments run on the page's own thread). */
const yieldToUi = () => new Promise<void>(resolve => { const done = () => resolve(); const timer = window.setTimeout(done, 60); requestAnimationFrame(() => { window.clearTimeout(timer); window.setTimeout(done, 0); }); });
const newOcrWorker = () => createWorker('eng', 1, { workerPath: `${OCR_BASE}/worker.min.js`, corePath: OCR_BASE, langPath: OCR_BASE });

/**
 * Auto option: find how many devices a photo holds and where their labels sit,
 * using the same label grouping as scanning. Boxes are in % of the photo.
 * devices counts what was seen even when boxes could not be placed.
 */
async function autoDetectBoxes(worker: Awaited<ReturnType<typeof createWorker>>, source: string): Promise<{ boxes: DrawnBox[]; devices: number }> {
  const original = new File([dataUrlBlob(source)], 'auto.jpg', { type: 'image/jpeg' });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
  // One pass over a picture (optionally levelled first). Boxes come back in % of the picture it was given.
  const look = async (file: File) => {
    const { color, enhanced } = await createScanImages(file, 2400);
    let lines = scaleOcrLines(ocrLines((await worker.recognize(enhanced)).data), enhanced, color);
    const W = color.width, H = color.height;
    const codes = await frameBarcodes(color);
    lines = [...lines, ...labelledBarcodeLines(codes, lines)];
    // The same "look closer" stage as the scan (tiles from a full-resolution copy when labels are small or more are expected).
    lines = (await lookCloser({ worker, file, color, lines, codes, raw: lines.map(line => line.text).join('\n'), expectedProducts: 0, fast: false })).lines;
    const frame = color.getContext('2d')?.getImageData(0, 0, W, H);
    const anchors = deviceAnchors(lines, W, H, frame);
    let regions = anchors.length >= 2 ? planDeviceCrops(anchors, lines, W, H, frame) : [];
    const seeds = labelSeeds(lines, W);
    if (seeds.length >= 2 && regions.length < seeds.length) { const byText = seedCrops(lines, seeds, W, H, frame); if (byText.length === seeds.length) regions = byText; }
    return { color, devices: Math.max(anchors.length, seeds.length), boxes: regions.map(region => clampBox({ x: region.x / W * 100, y: region.y / H * 100, width: region.width / W * 100, height: region.height / H * 100 })) };
  };
  const first = await look(original);
  if (first.boxes.length >= 2) return { boxes: sortReadingOrder(first.boxes), devices: first.devices };
  // Labels may be hidden by a tilted photo: level a copy and map any boxes back onto the photo.
  // The strict ink threshold ignores a dark background that would hide the tilt of the text.
  try {
    for (const ink of [0.78, 0.5]) {
      const skew = skewOfCanvas(first.color, ink);
      if (Math.abs(skew.angle) < 2.5 || skew.gain < 1.08) continue;
      const blob = await new Promise<Blob | null>(resolve => straightenCanvas(first.color, skew.angle).toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) continue;
      const levelled = await look(new File([blob], 'level.jpg', { type: 'image/jpeg' }));
      if (levelled.boxes.length >= 2) {
        const boxes = levelled.boxes.map(box => clampBox(unlevelBox(box, skew.angle, first.color.width, first.color.height)));
        return { boxes: sortReadingOrder(boxes), devices: levelled.devices };
      }
    }
  } catch (error) { console.warn('Could not level the photo for detection', error); }
  return { boxes: sortReadingOrder(first.boxes), devices: first.devices };
}

/**
 * A label that gave no usable IMEI is read again with other image treatments (sharper, evener light,
 * inverted, enlarged...), a few at a time, until the readings agree. Returns the extra text and the verdict.
 */
async function rereadIfUncertain(worker: Awaited<ReturnType<typeof createWorker>>, photo: string, raw: string, knownTacs: ReadonlySet<string>) {
  const verdict = (text: string) => judgeImei({ readings: imeiReadings(text), barcode: barcodeImei(text, 1), knownTacs });
  if (extractPreferredImei(raw)) return { raw, judgement: verdict(raw) };
  const source = await pictureCanvas(photo);
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
  const result = await retryLowConfidence<HTMLCanvasElement>({
    text: raw, knownTacs, plan: planPasses(canvasStats(source)), maxPasses: 4,
    prepare: variant => renderVariant(source, variant),
    read: async canvas => (await worker.recognize(canvas)).data.text || ''
  });
  return { raw: result.text, judgement: result.judgement };
}

/** Cut every drawn box and read each one (barcodes, OCR, second reads, extra passes when unsure). */
async function readBoxCrops(worker: Awaited<ReturnType<typeof createWorker>> | null, source: string, boxes: DrawnBox[], modelFor: (raw: string, boxCount: number) => string, onProgress?: (index: number) => void, knownTacs: ReadonlySet<string> = new Set()): Promise<SplitCrop[]> {
  const photos = await createCroppedPhotos(source, boxes.map((box, index) => ({ imei: `box-${index}`, ...box })), 100, 100);
  const crops: SplitCrop[] = [];
  for (let index = 0; index < boxes.length; index++) {
    const cropDataUrl = photos.get(`box-${index}`)!;
    let raw = '', imei = '';
    let judgement: Judgement | null = null;
    onProgress?.(index + 1);
    try {
      if (worker) {
        let lines: OcrLine[] = [];
        ({ raw, lines } = await readCropImei(worker, cropDataUrl));
        await yieldToUi();
        raw = await cameraBarcodeText(cropDataUrl, raw, lines);
        await yieldToUi();
        raw = await refineCropText(worker, cropDataUrl, raw, lines);
        await yieldToUi();
        ({ raw, judgement } = await rereadIfUncertain(worker, cropDataUrl, raw, knownTacs));
        imei = cameraImei(raw);
        // Votes across passes or a checksum repair fill in only when the normal rules found nothing.
        if (!imei && judgement.imei) imei = judgement.imei;
      }
    } catch (error) { console.warn('Crop kept without automatic text reading', error); }
    const fixed = judgement?.method === 'repair' && judgement.imei === imei;
    crops.push({
      cropDataUrl, imei, model: modelFor(raw, boxes.length), raw,
      confidence: imei ? Math.max(judgement?.confidence ?? 0, luhnValid(imei) ? 70 : 20) : judgement?.confidence ?? 0,
      reason: judgement?.reason, suggestions: judgement?.alternatives.filter(value => value !== imei).slice(0, 3),
      fixedFrom: fixed ? judgement?.repairedFrom : undefined,
      review: !imei || !luhnValid(imei) || fixed || !!(judgement?.needsReview && !extractPreferredImei(raw))
    });
  }
  // The same number read for two boxes of one photo: a box sits on the wrong label, or two boxes cover one label.
  const repeated = repeatedAcrossBoxes(crops.map(crop => crop.imei));
  crops.forEach((crop, index) => { if (repeated.has(index)) { crop.review = true; crop.reason = 'The same IMEI was read in two boxes'; } });
  return crops;
}

/**
 * The model of one crop. It comes from that crop's own text. The old record's model is only inherited
 * when the photo was a single product cropped once, so a multi-product photo never copies one model onto every label.
 */
function modelForCrop(entry: BulkItem, raw: string, boxCount: number) {
  const own = identifyModel(raw, '');
  if (exportModel(own)) return own;
  return boxCount === 1 && entry.single ? exportModel(entry.model) || own : own;
}

/**
 * Records that replace `original` once it is cut into crops. The original photo is not kept:
 * each crop is its own picture (stored once) with the IMEI, serial and model read from it, and the person
 * of the original. A single crop of a single product keeps the original's numbers where the crop shows none.
 * The first crop keeps the original's number. The crops form a new picture group, so the original photo's
 * stored copy is released as soon as nothing refers to it.
 */
function splitRecords(original: RecordItem, crops: SplitCrop[], firstNumber: number): RecordItem[] {
  const sourcePictureId = `PIC-${newId().slice(0, 8).toUpperCase()}`;
  const inherit = crops.length === 1 && !((original.deviceCount || 0) > 1);
  return crops.map((crop, index) => {
    const read = serialReading(crop.raw);
    const imei = crop.imei || (inherit ? original.imei : '');
    const pair = recordImeiPair({ imei, raw: crop.raw } as RecordItem);
    const serial = !read.serial && inherit && original.serial ? { serial: original.serial, serialNeedsReview: original.serialNeedsReview } : read;
    return {
      ...original, id: newId(), pictureId: `PIC-${newId().slice(0, 8).toUpperCase()}`,
      sourcePictureId, number: index === 0 ? original.number : firstNumber + index - 1,
      dataUrl: crop.cropDataUrl, cropDataUrl: crop.cropDataUrl, originalDataUrl: undefined, focus: undefined,
      ...serial, imei, imei2: pairedImei2(imei, pair.imei2, crop.model) || (inherit ? original.imei2 : undefined),
      model: crop.model.trim() || 'Unknown unit — review', raw: crop.raw,
      cropNeedsReview: !!crop.review || (!imei && !serial.serial), status: imei ? (luhnValid(imei) ? 'Valid' : 'Invalid') : 'Review',
      duplicate: false, createdAt: new Date().toISOString(), deviceCount: undefined, deviceImeis: undefined
    } as RecordItem;
  });
}

/** Step 2 of cropping: every crop with its reading, to check before the original photo is replaced. */
function CropResults({ groups, setGroups, busy, onBack, onApply }: { groups: CropGroup[]; setGroups: (groups: CropGroup[]) => void; busy: boolean; onBack: () => void; onApply: () => void }) {
  const total = groups.reduce((sum, group) => sum + group.crops.length, 0);
  const uncertain = groups.reduce((sum, group) => sum + group.crops.filter(crop => crop.review).length, 0);
  const edit = (groupId: string, index: number, patch: Partial<SplitCrop>) => setGroups(groups.map(group => group.id !== groupId ? group : { ...group, crops: group.crops.map((crop, i) => i === index ? { ...crop, ...patch } : crop) }));
  const badFormat = groups.some(group => group.crops.some(crop => crop.imei && !/^\d{15}$/.test(crop.imei)));
  useBackLayer(true, () => { if (!busy) onBack(); }, 'crop-results');
  return <div className="modal-backdrop studio-backdrop"><section className="modal studio results-studio" role="dialog" aria-modal="true" aria-label="Check the cropped pictures">
    <header className="studio-head">
      <div className="studio-title"><strong>Check {total} picture{total === 1 ? '' : 's'}</strong><span>{uncertain ? `${uncertain} need a look` : 'All read with confidence'}</span></div>
      <button className="iconbtn" aria-label="Back to the boxes" disabled={busy} onClick={onBack}><X size={18} /></button>
    </header>
    <div className="results-scroll">
      {groups.map(group => <div key={group.id} className="results-group">
        <p className="results-photo"><img src={group.source} alt="" /><span><strong>{group.name}</strong><small>{group.crops.length} picture{group.crops.length === 1 ? '' : 's'} from this photo</small></span></p>
        <div className="review-crop-list">{group.crops.map((crop, index) => <div key={index} className={`saved-crop-card${crop.review ? ' needs-look' : ''}`}>
          <img src={crop.cropDataUrl} alt={`Picture ${index + 1}`} />
          <strong>Picture {index + 1} <small className={crop.review ? 'amber' : 'green'}>{crop.review ? '⚠ check' : '✓ ready'}{crop.confidence !== undefined ? ` · ${crop.confidence}%` : ''}</small></strong>
          <label>IMEI 1<input inputMode="numeric" maxLength={15} value={crop.imei} onChange={event => { const imei = digits(event.target.value).slice(0, 15); edit(group.id, index, { imei, review: imei.length === 15 && luhnValid(imei) ? false : crop.review, suggestions: crop.suggestions }); }} /></label>
          {crop.fixedFrom && <p className="autofix-note">One digit was fixed using the checksum (the label read …{crop.fixedFrom.slice(-6)}). Compare with the label.</p>}
          {!crop.imei && !!crop.suggestions?.length && <div className="suggest-row">Did you mean{crop.suggestions.map(value => <button key={value} type="button" onClick={() => edit(group.id, index, { imei: value })}>{value}</button>)}</div>}
          <label>Model<input value={crop.model} onChange={event => edit(group.id, index, { model: event.target.value })} /></label>
          <small>{crop.imei ? (luhnValid(crop.imei) ? (crop.reason || 'Checksum valid') : 'Checksum failed — check the digits') : (crop.reason || 'No IMEI read — enter it or leave empty to review later')}</small>
        </div>)}</div>
      </div>)}
    </div>
    {badFormat && <p role="status" className="studio-message">Enter all 15 IMEI digits, or empty the field to review it later.</p>}
    <footer className="studio-actions">
      <button className="primary" disabled={busy || badFormat} onClick={onApply}>Replace original{groups.length === 1 ? '' : 's'} with {total} picture{total === 1 ? '' : 's'}</button>
      <button className="subtle-btn" disabled={busy} onClick={onBack}>← Back to the boxes</button>
    </footer>
    <p className="studio-hint">The original photo is deleted for good. Each picture keeps its own IMEI, serial, model and person.</p>
  </section></div>;
}

/**
 * Cropping from start to finish, for one photo (from the review window) or many (bulk crop):
 * draw the boxes in the Crop Studio, read the crops, check them, replace the originals.
 */
function CropFlow({ items, initialPlans, startIndex, knownTacs, onApply, onClose, onLater, onQueue }: {
  items: BulkItem[]; initialPlans?: Record<string, Box[]>; startIndex?: number; knownTacs: ReadonlySet<string>; onQueue?: (entries: StudioPlan[]) => void;
  onApply: (groups: CropGroup[]) => void; onClose: () => void; onLater: (boxes: number, photos: number) => void;
}) {
  const [stage, setStage] = useState<'draw' | 'results'>('draw');
  const [plans, setPlans] = useState<Record<string, Box[]>>(initialPlans || {});
  const [groups, setGroups] = useState<CropGroup[]>([]);
  const [progress, setProgress] = useState('');
  const [notice, setNotice] = useState('');
  // The reader (about 10 MB of engine and language data) is started as soon as the editor opens, while you draw the boxes,
  // so Save all does not start with a long 'Preparing…'. One shared start-up, whoever asks first.
  const workerRef = useRef<Promise<Awaited<ReturnType<typeof createWorker>>> | null>(null);
  useEffect(() => { workerRef.current ||= newOcrWorker(); workerRef.current.catch(() => { workerRef.current = null; }); return () => { void workerRef.current?.then(w => w.terminate()).catch(() => undefined); workerRef.current = null; }; }, []);
  const worker = () => (workerRef.current ||= newOcrWorker());
  const asDraft = (list: StudioPlan[]) => list.map(plan => ({ recordId: plan.id, boxes: plan.boxes }));
  const discard = () => { clearDraft(localStorage); onClose(); };

  async function process(list: StudioPlan[]) {
    const planned = list.filter(plan => plan.boxes.length);
    setPlans(Object.fromEntries(list.map(plan => [plan.id, plan.boxes]))); setNotice('');
    const out: CropGroup[] = [];
    try {
      setProgress('Starting the reader (the first time takes longer)…');
      const w = await worker().catch(() => null);
      for (const [position, plan] of planned.entries()) {
        const entry = items.find(item => item.id === plan.id)!;
        const crops = await readBoxCrops(w, entry.source, plan.boxes, (raw, count) => modelForCrop(entry, raw, count),
          box => setProgress(`Photo ${position + 1} of ${planned.length} · reading label ${box} of ${plan.boxes.length}…`), knownTacs);
        out.push({ id: entry.id, name: entry.name, source: entry.source, crops });
      }
      setGroups(out); setStage('results');
    } catch (error) { console.error(error); setNotice('Could not read every photo. Nothing was changed. Try again.'); }
    finally { setProgress(''); }
  }

  if (stage === 'results') return <CropResults groups={groups} setGroups={setGroups} busy={false} onBack={() => setStage('draw')} onApply={() => { clearDraft(localStorage); onApply(groups); }} />;
  return <CropStudio items={items} initialPlans={plans} startIndex={startIndex} progress={progress} notice={notice}
    title={items.length > 1 ? 'Bulk crop' : 'Crop photo'}
    detect={async source => ({ ...(await autoDetectBoxes(await worker(), source)) })}
    onSaveAll={list => void process(list)} onQueue={onQueue}
    onAutosave={(list, index) => { writeDraft(localStorage, asDraft(list), index); }}
    onSaveLater={(list, index) => { writeDraft(localStorage, asDraft(list), index); onLater(list.reduce((sum, plan) => sum + plan.boxes.length, 0), list.filter(plan => plan.boxes.length).length); }}
    onClose={onClose} onDiscard={discard} />;
}

/** A copy of the photo turned (or mirrored) so label text reads upright. */
async function turnFile(file: File, turn: { angle: number; flop?: boolean }): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const sideways = turn.angle % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = sideways ? bitmap.height : bitmap.width; canvas.height = sideways ? bitmap.width : bitmap.height;
  const context = canvas.getContext('2d')!;
  context.translate(canvas.width / 2, canvas.height / 2); context.rotate(turn.angle * Math.PI / 180); if (turn.flop) context.scale(-1, 1);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2); bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not turn the photo')), 'image/jpeg', 0.95));
  return new File([blob], file.name, { type: 'image/jpeg' });
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]!));
}

function recordsCsv(
  rows: RecordItem[],
  photoLinks = new Map<string, string>(),
  people = readPeople(),
  compact = false,
  layout?: ReportLayout
) {
  if (layout) {
    const rich = layout === 'person_photo', minimal = layout === 'imei_photo';
    const values = [
      ['IMEI 1', 'IMEI 2', 'Serial', ...(minimal ? [] : ['Model', 'Review status']), ...(rich ? ['Assigned person', 'Download photo'] : [])],
      ...rows.map(r => { const { imei1, imei2 } = recordImeiPair(r); return [imei1, imei2, recordSerial(r) || '', ...(minimal ? [] : [exportModel(r.model), reviewStatus(r)]), ...(rich ? [personTitle(r, people), photoLinks.has(r.id) ? `=HYPERLINK("${photoLinks.get(r.id)}","Download photo")` : ''] : [])]; })
    ];
    return '\uFEFF' + values.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  if (compact) {
    const values = [
      ['Model', 'IMEI', 'Serial number', 'Review status', 'Duplicate', 'Download photo'],
      ...rows.map(r => [exportModel(r.model), r.imei, recordSerial(r), reviewStatus(r), r.duplicate ? 'Yes' : 'No',
        photoLinks.has(r.id) ? `=HYPERLINK("${photoLinks.get(r.id)}","Download image")` : ''])
    ];
    return '\uFEFF' + values.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  const values = [
    ['No.', 'Picture ID', 'Person', 'Person name', 'Image filename', 'Model', 'IMEI', 'Serial number', 'Review status', 'Validation', 'Duplicate', 'Scanned at', 'Download photo'],
    ...rows.map(r => {
      const person = people.find(item => item.id === r.personId);
      return [
        `#${r.number}`,
        r.pictureId,
        personTitle(r, people),
        person?.name || '',
        r.name,
        exportModel(r.model),
        r.imei,
        recordSerial(r),
        reviewStatus(r),
        r.status,
        r.duplicate ? 'Yes' : 'No',
        r.createdAt,
        photoLinks.has(r.id)
          ? `=HYPERLINK("${photoLinks.get(r.id)}","Download image")`
          : ''
      ];
    })
  ];

  return '\uFEFF' + values.map(row => row.map(csvCell).join(',')).join('\r\n');
}

/** Picture file name: just the record number, e.g. 3.jpg. */
/** Download name in picture order with the IMEI (or serial): 003-352099001761028.jpg. Sorting the files by name keeps the order. */
function orderedPhotoName(r: RecordItem, position?: number) {
  const ext = (r.cropDataUrl ? 'jpg' : r.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const pair = recordImeiPair(r), serial = recordSerial(r);
  const id = (pair.imei1 || serial || 'phone').replace(/[^A-Za-z0-9]/g, '');
  return `${String(position ?? r.number).padStart(3, '0')}-${id}.${ext}`;
}

function photoFilename(r: RecordItem) {
  const ext = (r.cropDataUrl ? 'jpg' : r.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `${r.number}.${ext}`;
}

async function workbookImage(r: RecordItem, maxSize = 1200) {
  const image = new Image();
  image.src = recordPhoto(r);
  await image.decode();

  // Keep the sticker text readable when the picture is enlarged in Excel.
  // The visible worksheet thumbnail is smaller; this is its stored resolution.
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Could not prepare a photo for the workbook.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return { dataUrl: canvas.toDataURL('image/jpeg', 0.86), width: canvas.width, height: canvas.height };
}

async function createInventoryWorkbook(
  rows: RecordItem[],
  photoLinks = new Map<string, string>(),
  includePhotos = true,
  people = readPeople(),
  folderLink = '',
  compact = false,
  layout?: ReportLayout
) {
  includePhotos = layout ? layout === 'person_photo' : includePhotos && !compact;
  const ExcelJS = await import('exceljs');
  const Workbook = ExcelJS.Workbook || ExcelJS.default?.Workbook;
  if (!Workbook) throw new Error('The Excel exporter could not load. Please reload the app and retry.');
  const workbook = new Workbook();
  workbook.creator = 'IMEI Lens';
  workbook.created = new Date();

  const sheets = new Set<string>();
  const uniqueSheetName = (label: string) => {
    const base = label.replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Unknown';
    let name = base;
    let suffix = 2;

    while (sheets.has(name.toLowerCase())) {
      const tail = ` ${suffix++}`;
      name = `${base.slice(0, 31 - tail.length)}${tail}`;
    }

    sheets.add(name.toLowerCase());
    return name;
  };

  const imageIds = new Map<string, { id: number; width: number; height: number }>();
  if (includePhotos) {
    for (const row of rows) {
      try {
        const imageData = await workbookImage(row);
        imageIds.set(row.id, { id: workbook.addImage({
          base64: imageData.dataUrl,
          extension: 'jpeg'
        }), width: imageData.width, height: imageData.height });
      } catch (error) {
        throw new Error(`Photo ${row.pictureId} could not be embedded in Excel. ${error instanceof Error ? error.message : ''}`.trim());
      }
    }
  }

  const addModelSheet = (title: string, sheetRows: RecordItem[]) => {
    const sheet = workbook.addWorksheet(uniqueSheetName(title));
    const allColumns = [
      { header: 'No.', key: 'number', width: 9 },
      { header: 'Picture ID', key: 'pictureId', width: 18 },
      { header: 'Person', key: 'person', width: 16 },
      { header: 'Person name', key: 'personName', width: 22 },
      ...(includePhotos ? [{ header: 'Photo', key: 'photo', width: 38 }] : []),
      { header: 'Image filename', key: 'filename', width: 36 },
      { header: 'Model', key: 'model', width: 28 },
      { header: 'IMEI', key: 'imei', width: 20 },
      { header: 'IMEI 1', key: 'imei1', width: 20 },
      { header: 'IMEI 2', key: 'imei2', width: 20 },
      { header: 'Serial', key: 'serial', width: 22 },
      { header: 'Review status', key: 'reviewStatus', width: 18 },
      { header: 'Validation', key: 'validation', width: 14 },
      { header: 'Duplicate', key: 'duplicate', width: 12 },
      { header: 'Scanned at', key: 'scannedAt', width: 24 },
      ...(photoLinks.size ? [{ header: 'Download photo', key: 'download', width: 20 }] : []),
      ...(folderLink ? [{ header: 'Photo folder', key: 'folder', width: 22 }] : [])
    ];
    const columns = layout
      ? (layout === 'imei_photo'
        ? ['imei1', 'imei2', 'serial'].map(key => allColumns.find(column => column.key === key)!)
        : layout === 'simple'
        ? ['imei1', 'imei2', 'serial', 'model', 'reviewStatus'].map(key => allColumns.find(column => column.key === key)!)
        : ['imei1', 'imei2', 'serial', 'photo', 'model', 'person', 'reviewStatus', 'download'].map(key => allColumns.find(column => column.key === key)!).filter(Boolean))
      : compact
      ? allColumns.filter(column => ['model', 'imei', 'serial', 'reviewStatus', 'duplicate', 'download', 'folder'].includes(column.key))
      : allColumns;
    sheet.columns = columns;
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = `A1:${String.fromCharCode(64 + columns.length)}1`;
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF183B43' }
    };

    for (const record of sheetRows) {
      const row = sheet.addRow({
        number: `#${record.number}`,
        pictureId: record.pictureId,
        person: layout === 'person_photo' ? personTitle(record, people) : personTitle(record, people),
        personName: people.find(person => person.id === record.personId)?.name || '',
        ...(includePhotos ? { photo: '' } : {}),
        filename: record.name,
        model: exportModel(record.model),
        imei: record.imei,
        ...recordImeiPair(record),
        serial: recordSerial(record) || '',
        reviewStatus: reviewStatus(record),
        validation: record.status,
        duplicate: record.duplicate ? 'Yes' : 'No',
        scannedAt: record.createdAt,
        ...(photoLinks.size ? { download: '' } : {}),
        ...(folderLink ? { folder: '' } : {})
      });
      row.height = includePhotos ? 150 : 24;
      row.alignment = { vertical: 'middle', wrapText: true };
      const image = imageIds.get(record.id);
      const photoLink = photoLinks.get(record.id);

      if (photoLink) {
        row.getCell(columns.findIndex(column => column.key === 'download') + 1).value = { text: 'Open photo', hyperlink: photoLink };
      }
      const folderColumn = columns.findIndex(column => column.key === 'folder');
      if (folderLink && folderColumn >= 0) {
        row.getCell(folderColumn + 1).value = { text: 'Choose photos / download all', hyperlink: folderLink };
      }

      if (includePhotos && image) {
        const photoColumn = columns.findIndex(column => column.key === 'photo');
        const cellWidth = 270, cellHeight = 200;
        const scale = Math.min((cellWidth - 16) / image.width, (cellHeight - 16) / image.height);
        const displayWidth = Math.max(1, Math.round(image.width * scale));
        const displayHeight = Math.max(1, Math.round(image.height * scale));
        sheet.addImage(image.id, {
          tl: {
            col: photoColumn + (cellWidth - displayWidth) / (2 * cellWidth),
            row: row.number - 1 + (cellHeight - displayHeight) / (2 * cellHeight)
          },
          ext: { width: displayWidth, height: displayHeight },
          editAs: 'oneCell',
          ...(photoLink ? {
            hyperlinks: {
              hyperlink: photoLink,
              tooltip: `Open or download ${photoFilename(record)}`
            }
          } : {})
        });
      }
    }
  };

  addModelSheet('All IMEIs', rows);
  const byModel = new Map<string, RecordItem[]>();
  for (const row of rows) {
    byModel.set(row.model, [...(byModel.get(row.model) || []), row]);
  }
  // The IMEI + picture layout is one sheet only: no per-model or per-person tabs.
  if (layout !== 'imei_photo') for (const [model, modelRows] of byModel) addModelSheet(model, modelRows);

  for (const person of layout === 'simple' || layout === 'imei_photo' ? [] : people) {
    const personRows = rows.filter(record => record.personId === person.id);
    if (personRows.length) {
      addModelSheet((person.name || '').trim() || 'Unnamed', personRows);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

type ExportFile = { name: string; blob: Blob };
type ReportLayout = 'imei_photo' | 'simple' | 'person_photo';

/**
 * IMEI 1 and IMEI 2 for export. Only one IMEI is stored per record, so IMEI 2
 * comes from the record's scanned text (one Luhn-valid labelled value only).
 * When the stored IMEI is itself that IMEI 2 (no IMEI 1 was readable), it is
 * reported as IMEI 2 and IMEI 1 stays blank rather than mislabelled.
 */
function recordImeiPair(record: RecordItem) {
  // Stored (scanned or edited) IMEI 2 wins; older records derive it from their OCR text.
  let imei2 = record.imei2;
  if (imei2 === undefined) {
    const seconds = [...new Set([...(record.raw || '').matchAll(/\bIM[E3][I1!|l]\s*(?:2|02)\s*[:#-]?\s*((?:\d[\s-]*){15})(?![\s-]*\d)/gi)].map(match => digits(match[1])).filter(luhnValid))];
    // The stored IMEI may itself be the label's IMEI 2 (no IMEI 1 was readable).
    imei2 = seconds.length === 1 && seconds[0] === record.imei ? seconds[0] : pickImei2(record.imei, record.raw || '') || (!record.imei && seconds.length === 1 ? seconds[0] : '');
  }
  return { imei1: record.imei === imei2 ? '' : record.imei, imei2 };
}

/**
 * Minimal Excel export: one sheet with IMEI, the picture, and a "Download picture"
 * link. Excel cannot hand out an embedded picture as a file, so the picture files
 * are saved in the same folder as the workbook and each link opens its own copy.
 * Returns the workbook first, then one file per picture (flat: no sub-folders).
 */
/**
 * Excel on phones (Android and iOS) only opens web links; links to files on the
 * phone fail in Chrome. When the app runs from a website, each "Download picture"
 * link opens this app at #picture=<id>, which shows that picture from the records
 * saved in this browser with Download and Share buttons. Inside the Android app
 * (not a website) the link falls back to the picture file beside the workbook.
 */
function pictureWebLink(record: RecordItem) {
  if (androidBridge || typeof location === 'undefined' || !/^https?:$/.test(location.protocol) || /^(localhost|127\.)/.test(location.hostname)) return '';
  return `${location.origin}${location.pathname}#picture=${encodeURIComponent(record.pictureId)}`;
}

async function createImeiPhotoFiles(rows: RecordItem[], webLinks = true): Promise<ExportFile[]> {
  const ExcelJS = await import('exceljs');
  const Workbook = ExcelJS.Workbook || ExcelJS.default?.Workbook;
  if (!Workbook) throw new Error('The Excel exporter could not load. Please reload the app and retry.');
  const workbook = new Workbook();
  workbook.creator = 'IMEI Lens';
  const sheet = workbook.addWorksheet('IMEIs');
  sheet.columns = [
    { header: 'IMEI 1', key: 'imei1', width: 20 },
    { header: 'IMEI 2', key: 'imei2', width: 20 },
    { header: 'Serial', key: 'serial', width: 18 },
    { header: 'Picture', key: 'picture', width: 38 },
    { header: 'Download', key: 'download', width: 20 }
  ];
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183B43' } };
  const pictures: ExportFile[] = [];
  const used = new Set<string>();
  for (const [index, record] of rows.entries()) {
    // No '#', spaces or slashes: Excel treats '#' in a link as a jump inside the workbook.
    // Plain numbers, matching the row order: 1.jpg, 2.jpg, ...
    const name = `${index + 1}.jpg`;
    used.add(name);
    pictures.push({ name, blob: dataUrlBlob(recordPhoto(record)) });
    // Blank cells when a number was not detected.
    const { imei1, imei2 } = recordImeiPair(record);
    const row = sheet.addRow({ imei1, imei2, serial: recordSerial(record) || '', picture: '', download: '' });
    row.height = 150;
    row.alignment = { vertical: 'middle', wrapText: true };
    const webLink = webLinks ? pictureWebLink(record) : '';
    row.getCell(5).value = { text: 'Download picture', hyperlink: webLink || name, tooltip: webLink ? 'Opens the scanner in your browser with this picture and a Download button' : `Open or save ${name}` };
    row.getCell(5).font = { color: { argb: 'FF0563C1' }, underline: true, bold: true };
    const image = await workbookImage(record);
    const id = workbook.addImage({ base64: image.dataUrl, extension: 'jpeg' });
    const cellWidth = 270, cellHeight = 200;
    const scale = Math.min((cellWidth - 16) / image.width, (cellHeight - 16) / image.height);
    const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
    sheet.addImage(id, {
      tl: { col: 3 + (cellWidth - width) / (2 * cellWidth), row: row.number - 1 + (cellHeight - height) / (2 * cellHeight) },
      ext: { width, height }, editAs: 'oneCell',
      hyperlinks: { hyperlink: name, tooltip: `Open or save ${name}` }
    });
  }
  const xlsx = new Blob([await workbook.xlsx.writeBuffer() as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return [{ name: 'imei-pictures.xlsx', blob: xlsx }, ...pictures];
}

function exportFolderName() {
  const now = new Date(), pad = (n: number) => String(n).padStart(2, '0');
  return `IMEI pictures ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

/**
 * Save the workbook and pictures as plain files in one folder (no ZIP).
 * Android app: native folder picker. Chrome/Edge desktop: browser folder picker.
 * Other browsers cannot create folders, so every file downloads into the same
 * Downloads folder, which keeps the Excel links working.
 * Returns where the files went, for the status message.
 */
async function saveFilesToFolder(files: ExportFile[], folderName: string, parent?: Promise<any>): Promise<'android' | 'android-each' | 'picked' | 'downloads'> {
  if (androidBridge && !androidBridge.beginFolder) {
    // Older installed APK: no folder support, so save file by file in the same place.
    for (const file of files) {
      await downloadBlob(file.blob, file.name);
      await new Promise<void>(resolve => { const done = () => { window.removeEventListener('android-export-result', done); resolve(); }; window.addEventListener('android-export-result', done); });
    }
    return 'android-each';
  }
  if (androidBridge?.beginFolder) {
    const token = androidBridge.beginFolder(folderName);
    if (!token) throw new Error('Finish or cancel the current save before starting another.');
    try {
      for (const file of files) for (let offset = 0; offset < file.blob.size || offset === 0; offset += 64 * 1024) {
        const chunk = (await blobDataUrl(file.blob.slice(offset, offset + 64 * 1024))).split(',')[1] || '';
        if (!androidBridge.appendFolderFile!(token, file.name, chunk)) throw new Error(`Could not prepare ${file.name}.`);
        if (file.blob.size === 0) break;
      }
      if (!androidBridge.finishFolder!(token)) throw new Error('Could not open the folder picker.');
      return 'android';
    } catch (error) { androidBridge.abortFolder?.(token); throw error; }
  }
  const root = parent ? await parent.catch((error: unknown) => { if ((error as DOMException)?.name === 'AbortError') throw new Error('Folder choice cancelled. Nothing was saved.'); return undefined; }) : undefined;
  if (root) {
    const folder = await root.getDirectoryHandle(folderName, { create: true });
    for (const file of files) {
      const writable = await (await folder.getFileHandle(file.name, { create: true })).createWritable();
      await writable.write(file.blob);
      await writable.close();
    }
    return 'picked';
  }
  for (const file of files) {
    const url = URL.createObjectURL(file.blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  return 'downloads';
}

async function uploadPhotoToDrive(record: RecordItem, token: string, folderId: string) {
  const photo = dataUrlBlob(recordPhoto(record));
  const boundary = `imei-photo-${newId()}`;
  const metadata = JSON.stringify({
    name: photoFilename(record),
    mimeType: photo.type || 'image/jpeg',
    parents: [folderId]
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    metadata,
    `\r\n--${boundary}\r\nContent-Type: ${photo.type || 'image/jpeg'}\r\n\r\n`,
    photo,
    `\r\n--${boundary}--`
  ]);
  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  if (!response.ok) throw new Error(await response.text());
  const uploaded = await response.json();
  return (uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`) as string;
}

async function createPhotoFolder(token: string) {
  const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `IMEI Lens photos ${new Date().toISOString().slice(0, 10)}`, mimeType: 'application/vnd.google-apps.folder' })
  });
  if (!response.ok) throw new Error(await response.text());
  const folder = await response.json();
  return { id: folder.id as string, link: (folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`) as string };
}

async function createWordReport(
  records: RecordItem[],
  includePhotos: boolean,
  photoLinks = new Map<string, string>(),
  people = readPeople(),
  layout?: ReportLayout
) {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    Table, TableRow, TableCell, ImageRun, WidthType
  } = await import('docx');
  const children: any[] = [
    new Paragraph({
      text: `IMEI Lens inventory — ${new Date().toLocaleDateString()}`,
      heading: HeadingLevel.TITLE
    })
  ];
  const groups = new Map<string, RecordItem[]>();
  for (const record of records) {
    const group = layout === 'imei_photo' ? 'Devices' : layout === 'simple' ? record.model : `${record.model} / ${personTitle(record, people)}`;
    groups.set(group, [...(groups.get(group) || []), record]);
  }

  for (const [group, modelRecords] of groups) {
    children.push(new Paragraph({ text: group, heading: HeadingLevel.HEADING_1 }));
    const headerLabels = layout === 'imei_photo' ? ['IMEI 1', 'IMEI 2', 'Serial', 'Picture'] : layout === 'simple' ? ['IMEI 1', 'IMEI 2', 'Serial', 'Model', 'Review status'] : layout === 'person_photo' ? ['IMEI 1', 'IMEI 2', 'Serial', 'Model', 'Review status', 'Assigned person', 'Photo'] : includePhotos
      ? ['No.', 'Person', 'Name', 'Photo', 'Image filename', 'IMEI', 'Validation']
      : ['No.', 'Person', 'Name', 'Image filename', 'IMEI', 'Validation'];
    const tableRows = [
      new TableRow({
        tableHeader: true,
        children: headerLabels.map(label => new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })]
        }))
      })
    ];

    for (const record of modelRecords) {
      if (layout) {
        const { imei1, imei2 } = recordImeiPair(record);
        const cells = [imei1, imei2, recordSerial(record) || ''].map(text => new TableCell({ children: [new Paragraph({ text })] }));
        if (layout !== 'imei_photo') cells.push(
          new TableCell({ children: [new Paragraph({ text: record.model })] }),
          new TableCell({ children: [new Paragraph({ text: reviewStatus(record) })] })
        );
        if (layout === 'person_photo' || layout === 'imei_photo') {
          if (layout === 'person_photo') cells.push(new TableCell({ children: [new Paragraph({ text: personTitle(record, people) })] }));
          const photo = new Uint8Array(await dataUrlBlob((await workbookImage(record, 320)).dataUrl).arrayBuffer());
          const link = photoLinks.get(record.id);
          cells.push(new TableCell({ children: [new Paragraph({ children: [new ImageRun({ data: photo, type: 'jpg', transformation: { width: 90, height: 64 }, ...(link ? { link } : {}) })] })] }));
        }
        tableRows.push(new TableRow({ children: cells }));
        continue;
      }
      const cells = [
        new TableCell({ children: [new Paragraph({ text: `#${record.number}` })] }),
        new TableCell({ children: [new Paragraph({ text: personTitle(record, people) })] }),
        new TableCell({ children: [new Paragraph({ text: people.find(person => person.id === record.personId)?.name || '' })] })
      ];

      if (includePhotos) {
        const photo = new Uint8Array(await dataUrlBlob((await workbookImage(record, 320)).dataUrl).arrayBuffer());
        const link = photoLinks.get(record.id);
        cells.push(new TableCell({
          children: [new Paragraph({
            children: [new ImageRun({
              data: photo,
              type: 'jpg',
              transformation: { width: 90, height: 64 },
              ...(link ? { link } : {})
            })]
          })]
        }));
      }

      cells.push(
        new TableCell({ children: [new Paragraph({ text: photoFilename(record) })] }),
        new TableCell({ children: [new Paragraph({ text: record.imei || 'Not detected' })] }),
        new TableCell({ children: [new Paragraph({ text: record.status })] })
      );
      tableRows.push(new TableRow({ children: cells }));
    }

    children.push(new Table({
      rows: tableRows,
      width: { size: 100, type: WidthType.PERCENTAGE }
    }));
    children.push(new Paragraph({ text: '' }));
  }

  return Packer.toBlob(new Document({ sections: [{ children }] }));
}

function safeFileName(s: string) {
  return s
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 70) || 'unreadable_imei';
}

export default function App() {
  const [collapsedPanels, setCollapsedPanels] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('imei-collapsed-panels') || '[]'); } catch { return []; } });
  useEffect(() => { localStorage.setItem('imei-collapsed-panels', JSON.stringify(collapsedPanels)); }, [collapsedPanels]);
  function togglePanel(id: string) { setCollapsedPanels(old => old.includes(id) ? old.filter(key => key !== id) : [...old, id]); }
  /** Stat cards and tabs: open a tab (and optionally a filter), then scroll to the records. */
  function jumpTo(tab: 'records' | 'models' | 'share' | 'unknown', nextFilter?: string, nextPerson = 'All') {
    setMainView('results');
    setRecordsTab(tab);
    if (nextFilter) { setFilter(nextFilter); setQuery(''); setPersonFilter(nextPerson); setRecordPage(1); }
    setCollapsedPanels(old => old.filter(key => key !== 'records'));
    requestAnimationFrame(() => document.getElementById('records')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  const hostedScanner = import.meta.env.VITE_HOSTED_SCANNER === 'true' || window.location.hostname.endsWith('.onrender.com');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  // Excel "Download picture" links open the app at #picture=<id>.
  const readLinkedPicture = () => new URLSearchParams(location.hash.slice(1)).get('picture');
  const [linkedPictureId, setLinkedPictureId] = useState<string | null>(readLinkedPicture);
  useEffect(() => { const onHash = () => setLinkedPictureId(readLinkedPicture()); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  function closeLinkedPicture() { history.replaceState(null, '', location.pathname + location.search); setLinkedPictureId(null); }
  const [recordPage, setRecordPage] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [shareIds,setShareIds]=useState<string[]>([]);
  const [shareStatus,setShareStatus]=useState('');
  const [shareMode,setShareMode]=useState<ShareMode>('imei');
  const [shareIndex,setShareIndex]=useState(0);
  const [shareStep,setShareStep]=useState<'picture'|'text'>('picture');
  // Several records share in batches (many pictures per message) unless switched to one-by-one.
  const [shareOneByOne,setShareOneByOne]=useState(false);
  const [copiedKeys,setCopiedKeys]=useState<string[]>([]);
  /** Copy one value and tick it, so you can work down the list one record at a time. */
  function copyValue(key:string,value:string){void copyText(value).then(ok=>{if(ok)setCopiedKeys(old=>old.includes(key)?old:[...old,key]);setShareStatus(ok?`Copied ${value}`:'Copy failed. Select and copy the value manually.');});}
  const [sharing,setSharing]=useState(false);
  const [queueDisplayCount, setQueueDisplayCount] = useState(30);
  const [photoDisplayCount, setPhotoDisplayCount] = useState(40);
  const [busy, setBusy] = useState(false);
  const [stoppingScan, setStoppingScan] = useState(false);
  const [progress, setProgress] = useState('');
  const [completedFiles, setCompletedFiles] = useState(0);
  const [expectedProducts, setExpectedProducts] = useState(() => { try { const n = Number(localStorage.getItem('imei-lens-expected-products')); return Number.isInteger(n) && n >= 0 && n <= 12 ? n : 0; } catch { return 0; } });
  const [scanMode, setScanMode] = useState<'fast' | 'standard' | 'detailed'>(() => { try { const v = localStorage.getItem('imei-lens-scan-speed'); return v === 'fast' || v === 'detailed' ? v : 'standard'; } catch { return 'standard'; } });
  // Camera scans use these in the page; Choose photos and scan uses them in the phone's own scanner (same two settings).
  useEffect(() => {
    try { localStorage.setItem('imei-lens-expected-products', String(expectedProducts)); localStorage.setItem('imei-lens-scan-speed', scanMode); } catch { /* storage full or blocked */ }
    androidBridge?.setScanOptions?.(scanMode, expectedProducts);
  }, [scanMode, expectedProducts]);
  const [laptopUrl, setLaptopUrl] = useState(() => hostedScanner ? window.location.origin : localStorage.getItem('imei-lens-laptop-url') || (window.location.hostname === 'cjbarnes29.github.io' ? 'http://127.0.0.1:8787' : window.location.origin));
  const [laptopKey, setLaptopKey] = useState(() => localStorage.getItem('imei-lens-laptop-key') || '');
  const [laptopJobId, setLaptopJobId] = useState(() => localStorage.getItem('imei-lens-laptop-job') || '');
  const [laptopUploading, setLaptopUploading] = useState(false);
  const [laptopMessage, setLaptopMessage] = useState('');
  const [laptopJob, setLaptopJob] = useState<{ status: string; count: number; completed: number; resultCount: number; failed: number } | null>(null);
  const [phoneAddresses, setPhoneAddresses] = useState<string[]>([]);
  const [androidJob, setAndroidJob] = useState<{ status: string; count: number; completed: number; failed: number; error?: string } | null>(null);
  const importedAndroidIds = useRef(readNativeImportedIds());
  /** How many of the Android app's saved records this page has already gone through. */
  const androidCursor = useRef(0);
  const importingAndroid = useRef(false);
  const phoneOnLaptopNetwork = window.matchMedia('(pointer: coarse)').matches && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(window.location.hostname);
  const useBackgroundByDefault = hostedScanner || phoneOnLaptopNetwork;
  const scannerLocation = hostedScanner ? 'online server' : 'laptop';
  const importingLaptop = useRef(false);
  const laptopUploadController = useRef<AbortController | null>(null);
  const laptopUploadJobId = useRef('');
  const stopScanRequested = useRef(false);
  const [filter, setFilter] = useState('All');
  const [simpleView, setSimpleView] = useState(() => localStorage.getItem('imei-lens-simple-view') === 'true');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [personGroups, setPersonGroups] = useState<PersonGroup[]>(readPeople);
  const [activePersonId, setActivePersonId] = useState('person-1');
  const [personFilter, setPersonFilter] = useState('All');
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [deleteReviewConfirm, setDeleteReviewConfirm] = useState(false);
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [manualImei, setManualImeiState] = useState('');
  const [manualSerial, setManualSerialState] = useState('');
  const [manualImei2, setManualImei2State] = useState('');
  /** The newest typed values, updated at once. The state above follows at low priority so typing never waits for the page to redraw. */
  const liveFields = useRef({ model: '', imei: '', imei2: '', serial: '' });
  const setManualImei = (value: string) => { liveFields.current.imei = value; setManualImeiState(value); };
  const setManualSerial = (value: string) => { liveFields.current.serial = value; setManualSerialState(value); };
  const setManualImei2 = (value: string) => { liveFields.current.imei2 = value; setManualImei2State(value); };
  const typeField = (key: 'imei' | 'imei2' | 'serial' | 'model', apply: (value: string) => void) => (value: string) => {
    liveFields.current[key] = value;
    startTransition(() => apply(value));
  };
  /** What you typed for pictures you moved past without saving. Decided at the end: save all or discard. */
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, { model: string; imei: string; imei2: string; serial: string }>>({});
  const draftsRef = useRef<Record<string, { model: string; imei: string; imei2: string; serial: string }>>({});
  const [finishOpen, setFinishOpen] = useState(false);
  /** A warning that must be seen: shown as a pop-up with OK instead of a small message. */
  const [warning, setWarning] = useState('');
  const [manualModel, setManualModelState] = useState('');
  const setManualModel = (value: string) => { liveFields.current.model = value; setManualModelState(value); };
  const [reviewSource, setReviewSource] = useState('');
  const [photoExpanded, setPhotoExpanded] = useState(false);
  const [focusPreview, setFocusPreview] = useState('');
  const [showFullPhoto, setShowFullPhoto] = useState(false);
  const [cropEditorOpen, setCropEditorOpen] = useState(false);
  const [rotatingPhoto, setRotatingPhoto] = useState(false);
  const [bulkCropOpen, setBulkCropOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditModel, setBulkEditModel] = useState('');
  const [bulkEditPerson, setBulkEditPerson] = useState('');
  const [bulkEditChecked, setBulkEditChecked] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState('');
  const [deletePersonId, setDeletePersonId] = useState('');
  const [peopleOpen, setPeopleOpen] = useState(true);
  /** The tab under Scanned records (Detailed mode): the list, giving models out, or sharing. */
  const [recordsTab, setRecordsTab] = useState<'records' | 'models' | 'share' | 'unknown'>('records');
  /** Detailed mode shows one section at a time, chosen from the bar at the bottom of the screen. */
  const [mainView, setMainView] = useState<'scan' | 'results' | 'export'>('results');
  const activeView: 'scan' | 'records' | 'models' | 'share' | 'unknown' | 'export' = mainView !== 'results' ? mainView : recordsTab;
  function openView(view: 'scan' | 'records' | 'models' | 'share' | 'unknown' | 'export') {
    if (view === 'scan' || view === 'export') setMainView(view); else { setMainView('results'); setRecordsTab(view); }
    window.scrollTo({ top: 0 });
  }
  const wasBusy = useRef(false);
  const startCount = useRef(0);
  // First open with nothing saved starts on Scan; a finished scan that added phones shows them.
  useEffect(() => { if (inventoryLoaded && !records.length) setMainView('scan'); }, [inventoryLoaded]);
  useEffect(() => {
    if (busy && !wasBusy.current) startCount.current = records.length;
    if (!busy && wasBusy.current && records.length > startCount.current && !simpleView) { setMainView('results'); setRecordsTab('records'); window.scrollTo({ top: 0 }); }
    wasBusy.current = busy;
  }, [busy]);
  // The old minimize buttons are gone in Detailed mode, so nothing may stay collapsed.
  useEffect(() => { if (!simpleView && collapsedPanels.length) setCollapsedPanels([]); }, [simpleView]);
  /** Unconfirmed amounts: model -> person -> how many. Only models you changed appear here. */
  const [giveDraft, setGiveDraft] = useState<Record<string, Record<string, number>>>({});
  const [personUndo, setPersonUndo] = useState<{ people: PersonGroup[]; records: RecordItem[]; text: string; activePersonId: string } | null>(null);
  useEffect(() => { if (!personUndo) return; const timer = setTimeout(() => setPersonUndo(null), 12000); return () => clearTimeout(timer); }, [personUndo]);
  // People whose phones were all moved away (so their empty view can say "All IMEIs moved."); kept across reloads.
  const [emptiedPeople, setEmptiedPeople] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('imei-lens-emptied-people') || '[]'); } catch { return []; } });
  useEffect(() => { try { localStorage.setItem('imei-lens-emptied-people', JSON.stringify(emptiedPeople)); } catch { /* storage full: the message just falls back */ } }, [emptiedPeople]);
  // Permanent delete waits for an in-app confirmation.
  const [welcome, setWelcome] = useState<'' | 'new' | 'tutorials'>(() => hasSeenWhatsNew() ? '' : 'new');
  const closeWelcome = () => { markWhatsNewSeen(); setWelcome(''); };
  const [confirmDupes, setConfirmDupes] = useState<string[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; fromReview: boolean } | null>(null);
  const [personDraft, setPersonDraft] = useState('');
  // Samsung catalog (bundled, refreshed in the background): turns model codes into phone names.
  const [catalogEntries, setCatalogEntries] = useState<CatalogEntry[]>(() => readCatalogEntries());
  const [customModels, setCustomModels] = useState<CustomModels>(readCustomModels);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useBackLayer(settingsOpen, () => setSettingsOpen(false), 'settings');
  useEffect(() => { void loadSamsungCatalog().then(() => setCatalogEntries(readCatalogEntries())).catch(() => {}); }, []);
  // A phone whose model code was not readable borrows the name of another scanned phone with the
  // same first 8 IMEI digits (that part identifies the model).
  const knownByTac = useMemo(() => {
    const known = new Map<string, ReturnType<typeof phoneInfo>>();
    for (const record of records) { const info = phoneInfo(record.model, catalogEntries, customModels), tac = (record.imei || '').slice(0, 8); if (tac.length === 8 && !!modelCode4(record.model) && info.series !== 'Unknown phones' && !isGenericName(info.name) && !known.has(tac)) known.set(tac, info); }
    return known;
  }, [records, catalogEntries, customModels]);
  /** First 8 IMEI digits of phones already scanned with a known model: lets a one-digit checksum repair be accepted safely. */
  const knownTacs = useMemo(() => new Set(knownByTac.keys()), [knownByTac]);
  // Unfinished crop work ("Save for later"). Only the boxes are kept.
  const [pendingDraft, setPendingDraft] = useState<CropDraft | null>(null);
  const [bulkDraft, setBulkDraft] = useState<CropDraft | null>(null);
  const refreshDraft = (rows: RecordItem[] = records) => setPendingDraft(readDraft(localStorage, new Set(rows.map(row => row.id))));
  useEffect(() => { if (inventoryLoaded) refreshDraft(); }, [inventoryLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const infoOf = (record: RecordItem) => { const own = phoneInfo(record.model, catalogEntries, customModels); if (modelCode4(record.model)) return own; return knownByTac.get((record.imei || '').slice(0, 8)) || own; };
  const cropRequestedId = useRef<string | null>(null);
  const [toast, setToast] = useState('');
  const [showTop, setShowTop] = useState(false);
  useEffect(() => { const onScroll = () => setShowTop(window.scrollY > 700); onScroll(); window.addEventListener('scroll', onScroll, { passive: true }); return () => window.removeEventListener('scroll', onScroll); }, []);
  const [storageWarning, setStorageWarning] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [googleProgress, setGoogleProgress] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('');
  const [photoDownloads, setPhotoDownloads] = useState<RecordItem[]>([]);
  const [saveToFolder, setSaveToFolder] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [imeiFilter, setImeiFilter] = useState<'all' | 'with' | 'without'>('all');
  const [exportExcludedIds, setExportExcludedIds] = useState<string[]>([]);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [exportSearch, setExportSearch] = useState('');
  const [exportPreviewLimit, setExportPreviewLimit] = useState(30);
  const [reportLayout, setReportLayout] = useState<ReportLayout>('imei_photo');
  const includePhotos = reportLayout === 'person_photo';
  const compactExport = false;
  const [exportFormat, setExportFormat] = useState<'excel' | 'word' | 'sheets' | 'csv'>('excel');

  const inputRef = useRef<HTMLInputElement>(null);
  const reviewModalRef = useRef<HTMLDivElement | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!androidBridge) return;
    const report = (event: Event) => {
      const { status, filename } = (event as CustomEvent<{ status: string; filename: string }>).detail;
      const message = status === 'saved' ? `${filename} saved to your phone.`
        : status === 'cancelled' ? 'Save cancelled. No file was downloaded.'
        : `Could not save ${filename}. Choose a different folder and try again.`;
      setDownloadStatus(message);
      setToast(message);
    };
    window.addEventListener('android-export-result', report);
    return () => window.removeEventListener('android-export-result', report);
  }, []);

  useEffect(() => {
    if (!androidBridge) return;
    const shared = (event: Event) => {
      const count = (event as CustomEvent<{ count: number }>).detail?.count || 0;
      setMainView('scan');
      setToast(`Scanning ${count} shared photo${count === 1 ? '' : 's'}. Results appear in Records.`);
    };
    window.addEventListener('android-shared', shared);
    return () => window.removeEventListener('android-shared', shared);
  }, []);
  useEffect(() => { androidBridge?.setActivePerson?.(activePersonId); }, [activePersonId]);
  useEffect(() => {
    if (!androidBridge) return;
    const saved = (event: Event) => { const detail = (event as CustomEvent<{ ok: boolean; error?: string }>).detail; if (detail && !detail.ok) setToast(detail.error || 'Could not save.'); };
    window.addEventListener('android-saved', saved);
    return () => window.removeEventListener('android-saved', saved);
  }, []);

  useEffect(() => { localStorage.setItem('imei-lens-laptop-url', laptopUrl); }, [laptopUrl]);
  useEffect(() => {
    if (!['127.0.0.1', 'localhost'].includes(window.location.hostname)) return;
    void fetch('/api/health').then(response => response.ok ? response.json() : null)
      .then(data => setPhoneAddresses(data?.phoneAddresses || []))
      .catch(() => {});
  }, []);
  useEffect(() => { localStorage.setItem('imei-lens-laptop-key', laptopKey); }, [laptopKey]);
  useEffect(() => {
    if (laptopJobId) localStorage.setItem('imei-lens-laptop-job', laptopJobId);
    else localStorage.removeItem('imei-lens-laptop-job');
  }, [laptopJobId]);

  useEffect(() => {
    let mounted = true;
    loadInventory<RecordItem>()
      .then(saved => {
        if (mounted) {
          setRecords(markDuplicateRecords(saved === undefined ? readRecords() : saved));
          setInventoryLoaded(true);
        }
      })
      .catch(error => {
        console.error('Unable to open device storage', error);
        if (mounted) {
          setRecords(markDuplicateRecords(readRecords()));
          setInventoryLoaded(true);
          setStorageWarning('Large batch storage is unavailable in this browser. Export your records before closing this page.');
        }
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!androidBridge || !inventoryLoaded) return;
    for (const row of records) importedAndroidIds.current.add(row.id);
    let cancelled = false;
    async function refreshAndroid() {
      if (!androidBridge || importingAndroid.current || cancelled) return;
      importingAndroid.current = true;
      let more = false;
      try {
        const sliced = !!androidBridge.statusFrom;
        const job = JSON.parse(sliced ? androidBridge.statusFrom!(androidCursor.current) : androidBridge.status()) as { id: string; status: string; count: number; completed: number; failed: number; error?: string; records?: AndroidRecord[]; recordsFrom?: number; recordsTotal?: number };
        if (cancelled) return;
        setAndroidJob({ status: job.status, count: job.count, completed: job.completed, failed: job.failed, error: job.error });
        // The app's list was cleared (reset): start reading from the beginning again.
        if (sliced && (job.recordsTotal ?? 0) < androidCursor.current) { androidCursor.current = 0; more = true; return; }
        const scanned = job.records || [];
        const counts = new Map<string, number>();
        for (const item of scanned) counts.set(item.sourcePictureId || '', (counts.get(item.sourcePictureId || '') || 0) + 1);
        const wanted = scanned.filter(item => !importedAndroidIds.current.has(item.id));
        const pending = wanted.slice(0, 12);
        const added: RecordItem[] = [];
        for (const item of pending) {
          importedAndroidIds.current.add(item.id);
          const dataUrl = androidBridge.image(item.id);
          if (!dataUrl) continue;
          const { imageName, siblings, ...row } = item;
          added.push({ ...row, uploadBatchId: row.uploadBatchId || job.id, dataUrl, cropDataUrl: (siblings || counts.get(item.sourcePictureId || '') || 0) > 1 ? dataUrl : undefined });
        }
        if (sliced) {
          let advance = 0;
          while (advance < scanned.length && importedAndroidIds.current.has(scanned[advance].id)) advance++;
          androidCursor.current = (job.recordsFrom ?? 0) + advance;
          more = androidCursor.current < (job.recordsTotal ?? 0);
        } else more = wanted.length > pending.length;
        if (added.length) {
          try { localStorage.setItem(NATIVE_IMPORTED_STORE, JSON.stringify([...importedAndroidIds.current])); }
          catch (error) { console.error('Unable to save imported Android IDs', error); }
        }
        if (added.length && !cancelled) setRecords(old => {
          const ids = new Set(old.map(row => row.id));
          const seenImeis = new Set(old.filter(row => row.uploadBatchId === job.id).map(row => row.imei).filter(imei => /^\d{15}$/.test(imei)));
          let number = old.reduce((highest, row) => Math.max(highest, row.number), 2) + 1;
          // Background (native) scans get the same model learning as browser scans: corrections and repeated references.
          const learned = readLearned(), knownModels = old.map(row => row.model);
          const unique = added.filter(row => {
            if (ids.has(row.id)) return false;
            ids.add(row.id);
            if (/^\d{15}$/.test(row.imei)) {
              if (seenImeis.has(row.imei)) return false;
              seenImeis.add(row.imei);
            }
            row.number = number++;
            row.model = refineModel(row.model, knownModels, learned).model;
            knownModels.push(row.model);
            return true;
          });
          return unique.length ? markDuplicateRecords([...old, ...unique]) : old;
        });
      } catch (error) { console.error('Unable to read Android scan', error); }
      finally {
        importingAndroid.current = false;
        if (more && !cancelled) window.setTimeout(() => void refreshAndroid(), 60);
      }
    }
    void refreshAndroid();
    const timer = window.setInterval(() => void refreshAndroid(), 2500);
    window.addEventListener('android-scan-updated', refreshAndroid);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('android-scan-updated', refreshAndroid); };
  }, [inventoryLoaded]);

  useEffect(() => {
    setDeleteReviewConfirm(false);
    if (reviewModalRef.current) reviewModalRef.current.scrollTop = 0;
    const draft = selected ? draftsRef.current[selected.id] : undefined;
    setManualImei(draft ? draft.imei : selected?.imei || '');
    setManualSerial(draft ? draft.serial : selected ? recordSerial(selected) : '');
    setManualImei2(draft ? draft.imei2 : selected ? recordImeiPair(selected).imei2 : '');
    setManualModel(draft ? draft.model : selected ? exportModel(selected.model) : '');
    setReviewSource(selected?.originalDataUrl || selected?.dataUrl || '');
    setPhotoExpanded(false);
    setCropEditorOpen(cropRequestedId.current === selected?.id);
    cropRequestedId.current = null;
    // The phone decodes the full original (a few seconds on big photos) and the page waits for the answer.
    // Let the review screen draw first, and skip it entirely when you move on quickly.
    let current = true;
    let timer = 0;
    if (selected && androidBridge?.sourceImage && !selected.originalDataUrl) {
      const id = selected.id;
      timer = window.setTimeout(() => {
        if (!current) return;
        const original = androidBridge.sourceImage!(id);
        if (original && current) setReviewSource(original);
      }, 350);
    }
    return () => { current = false; window.clearTimeout(timer); };
  }, [selected?.id]);

  useBackLayer(photoExpanded, () => setPhotoExpanded(false), 'photo-lightbox');
  // Models for the picker: a new list each render would make it rebuild its catalog list on every keystroke.
  const scannedModelList = useMemo(() => records.map(row => row.model), [records]);

  // Open the review zoomed in on the label when the scanner found where it is.
  useEffect(() => {
    setFocusPreview(''); setShowFullPhoto(false);
    if (!selected?.focus || selected.cropDataUrl) return;
    let current = true;
    void cropToFocus(selected.dataUrl, selected.focus).then(url => { if (current) setFocusPreview(url); });
    return () => { current = false; };
  }, [selected?.id, selected?.dataUrl, selected?.focus, selected?.cropDataUrl]);

  function openCropReview(record: RecordItem) {
    cropRequestedId.current = record.id;
    openReview(record);
    setCropEditorOpen(true);
  }

  function closeCropEditor() {
    setCropEditorOpen(false);
  }

  function closePhotoReviewNow() {
    closeCropEditor();
    setSelected(null);
  }
  function closePhotoReview() {
    if (rotatingPhoto) return;
    finishReview();
  }

  // Back button / swipe-back closes the top popup instead of leaving the app.
  useBackLayer(!!selected, closePhotoReview, 'review');
  useBackLayer(finishOpen, () => setFinishOpen(false), 'finish-review');
  useBackLayer(!!warning, () => setWarning(''), 'warning');
  useBackLayer(bulkEditOpen, () => setBulkEditOpen(false), 'bulk-edit');
  useBackLayer(!!confirmDupes, () => setConfirmDupes(null), 'confirm-dupes');
  useBackLayer(!!confirmDelete, () => setConfirmDelete(null), 'confirm-delete');
  useBackLayer(!!deletePersonId, () => setDeletePersonId(''), 'confirm-delete-person');
  useBackLayer(shareIds.length > 0, () => { if (!sharing) setShareIds([]); }, 'share');

  useEffect(() => {
    try { localStorage.setItem(PEOPLE_STORE, JSON.stringify(personGroups)); }
    catch (error) { console.error('Unable to save people locally', error); }
  }, [personGroups]);
  useEffect(() => { localStorage.setItem('imei-lens-simple-view', String(simpleView)); }, [simpleView]);

  useEffect(() => {
    if (!inventoryLoaded) return;
    const timer = window.setTimeout(() => {
      saveChain.current = saveChain.current.catch(() => {}).then(async () => {
        try {
          await saveInventory(records);
          localStorage.removeItem(STORE);
          setStorageWarning('');
        } catch (error) {
          console.error('Unable to save records locally', error);
          setStorageWarning('Some records could not be saved on this device. Export your records before refreshing.');
        }
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [records, inventoryLoaded]);

  useEffect(() => {
    if (!toast) return;

    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const validCount = records.filter(r => r.status === 'Valid').length;
  const reviewCount = records.filter(r => reviewStatus(r).includes('Needs review')).length;

  const models = useMemo(() => {
    const m = new Map<string, number>();

    records.forEach(r => {
      m.set(r.model, (m.get(r.model) || 0) + 1);
    });

    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [records]);

  /** One group per phone model: the same model code with different endings (SM-A376B, SM-A376B/DS) is one model. */
  const modelKeyOf = (r: RecordItem) => { const info = infoOf(r); if (info.series === 'Unknown phones') return exportModel(r.model) ? r.model.trim() : 'unknown'; return isGenericName(info.name) ? (modelCode4(r.model) || info.name) : info.name; };
  const modelGroups = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; code: string; ids: string[]; byPerson: Record<string, number> }>();
    for (const record of records) {
      const key = modelKeyOf(record);
      let group = groups.get(key);
      if (!group) {
        const info = infoOf(record), known = info.series !== 'Unknown phones' && !isGenericName(info.name);
        group = { key, label: known ? info.name : key === 'unknown' ? 'Unknown model' : modelCode4(record.model) ? `SM-${modelCode4(record.model)} (not recognised)` : key, code: '', ids: [], byPerson: {} };
        groups.set(key, group);
      }
      if (!group.code && modelCode4(record.model)) group.code = `SM-${modelCode4(record.model)}`;
      group.ids.push(record.id);
      group.byPerson[record.personId] = (group.byPerson[record.personId] || 0) + 1;
    }
    return [...groups.values()].sort((a, b) => (a.key === 'unknown' ? 1 : 0) - (b.key === 'unknown' ? 1 : 0) || b.ids.length - a.ids.length || a.label.localeCompare(b.label));
  }, [records, catalogEntries, customModels, knownByTac]);

  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewNumbers, setOverviewNumbers] = useState(false);
  useBackLayer(overviewOpen, () => setOverviewOpen(false), 'overview');
  // Final review is model based: for each model, which people get how many. Filters: one person, or text.
  const [reviewPerson, setReviewPerson] = useState('');
  const [reviewQuery, setReviewQuery] = useState('');
  const review = useMemo(() => {
    const names = new Map(personGroups.map(person => [person.id, personName(person)]));
    const order = [...personGroups.map(person => person.id), UNASSIGNED_FILTER];
    const models = new Map<string, { key: string; label: string; holders: Map<string, { id: string; name: string; count: number; numbers: string[]; ids: string[] }> }>();
    for (const row of records) {
      const key = modelKeyOf(row), holderId = names.has(row.personId) ? row.personId : UNASSIGNED_FILTER;
      const model = models.get(key) || { key, label: modelGroups.find(group => group.key === key)?.label || 'Unknown model', holders: new Map() };
      const holder = model.holders.get(holderId) || { id: holderId, name: names.get(holderId) || 'Unassigned', count: 0, numbers: [], ids: [] };
      const pair = recordImeiPair(row), serial = recordSerial(row);
      holder.count++; holder.ids.push(row.id);
      holder.numbers.push([pair.imei1 || (serial ? '' : '—'), pair.imei2 && `IMEI 2 ${pair.imei2}`, serial && `S/N ${serial}`].filter(Boolean).join('  '));
      model.holders.set(holderId, holder); models.set(key, model);
    }
    return [...models.values()]
      .map(model => ({ ...model, total: [...model.holders.values()].reduce((sum, holder) => sum + holder.count, 0), holders: [...model.holders.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) }))
      .sort((a, b) => (a.key === 'unknown' ? 1 : 0) - (b.key === 'unknown' ? 1 : 0) || b.total - a.total || a.label.localeCompare(b.label));
  }, [records, personGroups, modelGroups]);
  const reviewShown = useMemo(() => {
    const needle = reviewQuery.trim().toLowerCase();
    return review
      .map(model => ({ ...model, holders: model.holders.filter(holder => !reviewPerson || holder.id === reviewPerson) }))
      .filter(model => model.holders.length && (!needle || `${model.label} ${model.holders.map(holder => holder.name).join(' ')}`.toLowerCase().includes(needle)))
      .map(model => ({ ...model, total: model.holders.reduce((sum, holder) => sum + holder.count, 0) }));
  }, [review, reviewPerson, reviewQuery]);
  const reviewText = (models: typeof reviewShown) => formatModelReview(models.map(model => ({ label: model.label, holders: model.holders })), overviewNumbers);
  /** For each person (and Unassigned): the models they already have, with counts. */
  const personModels = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number; numbers: string[]; ids: string[] }[]>();
    for (const model of review) for (const holder of model.holders) {
      const list = map.get(holder.id) || [];
      list.push({ key: model.key, label: model.label, count: holder.count, numbers: holder.numbers, ids: holder.ids });
      map.set(holder.id, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return map;
  }, [review]);
  /** Amounts you are editing in the Give models tab: what the draft says, else what the person holds now. */
  const [focusedModel, setFocusedModel] = useState('');
  /** A model tag was tapped: open the Give models tab, show every person, scroll to that model and highlight it. */
  function focusModel(key: string) {
    setMainView('results');
    setRecordsTab('models');
    setReviewPerson('');
    setCollapsedPanels(old => old.filter(panel => panel !== 'records'));
    setFocusedModel(key);
    const scroll = () => document.querySelector<HTMLElement>(`[data-model-key="${CSS.escape(key)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requestAnimationFrame(() => requestAnimationFrame(scroll));
    setTimeout(() => setFocusedModel(old => old === key ? '' : old), 3000);
  }
  const giveValue = (group: { key: string; byPerson: Record<string, number> }, personId: string) => giveDraft[group.key]?.[personId] ?? (group.byPerson[personId] || 0);
  const giveRest = (group: { key: string; ids: string[]; byPerson: Record<string, number> }) => group.ids.length - personGroups.reduce((sum, person) => sum + giveValue(group, person.id), 0);
  function giveSet(group: { key: string; ids: string[]; byPerson: Record<string, number> }, personId: string, wanted: number) {
    const now = giveValue(group, personId), value = Math.max(0, Math.min(Math.floor(wanted) || 0, now + giveRest(group)));
    setGiveDraft(old => ({ ...old, [group.key]: { ...Object.fromEntries(personGroups.map(person => [person.id, giveValue(group, person.id)])), [personId]: value } }));
  }
  function giveAll(group: { key: string; ids: string[]; byPerson: Record<string, number> }, personId: string) {
    setGiveDraft(old => ({ ...old, [group.key]: Object.fromEntries(personGroups.map(person => [person.id, person.id === personId ? group.ids.length : 0])) }));
  }
  const giveChanged = modelGroups.filter(group => giveDraft[group.key] && personGroups.some(person => giveValue(group, person.id) !== (group.byPerson[person.id] || 0)));
  /** Confirm: apply every edited model, then open the Share tab. */
  function confirmGive() {
    if (!giveChanged.length) return;
    let next = records;
    for (const group of giveChanged) next = planAllocation(next, group.ids, personGroups.map(person => ({ personId: person.id, count: giveValue(group, person.id) }))).records;
    setRecords(next);
    setSelectedIds([]);
    setEmptiedPeople(old => old.filter(id => next.some(row => row.personId === id)));
    setGiveDraft({});
    setMainView('results');
    setRecordsTab('share');
    setToast(`Changes confirmed for ${giveChanged.length} model${giveChanged.length === 1 ? '' : 's'}. Share the lists below.`);
  }
  /** WhatsApp opens with the text ready; you choose the chat. Very long texts go through the share menu instead. */
  function openWhatsApp(text: string) {
    if (!text) return;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    if (url.length > 7000) { void shareOrCopyText(text, 'The list'); return; }
    window.open(url, '_blank', 'noopener');
  }
  const [shareSerial, setShareSerial] = useState(false);
  /** A person with more than 10 phones is sent in groups of 10: one tap (one share menu) per group. */
  const [waSend, setWaSend] = useState<{ id: string; name: string; rows: RecordItem[] } | null>(null);
  /** Records already sent to WhatsApp for this person (remembered between visits). */
  const [waSent, setWaSent] = useState<string[]>([]);
  /** A send that was just opened: which pictures it carried, and how many the user says arrived. */
  const [waAttempt, setWaAttempt] = useState<{ ids: string[]; arrived: number; channel: 'whatsapp' | 'bluetooth' } | null>(null);
  /** What this phone can send with (from the Android app): WhatsApp installed, Bluetooth present and on. */
  const [waCaps, setWaCaps] = useState<{ whatsapp?: boolean; bluetooth?: boolean; bluetoothOn?: boolean } | null>(null);
  /** A reason WhatsApp did not work, so Bluetooth is offered instead. */
  const [waProblem, setWaProblem] = useState('');
  const [waPreferBluetooth, setWaPreferBluetooth] = useState(false);
  /** Add one caption with every IMEI / serial to the picture send (shown by WhatsApp once). */
  const [waCaption, setWaCaption] = useState(true);
  /** The one-by-one screen for a person: look at each phone, copy its numbers, download its picture. */
  const [oneByOne, setOneByOne] = useState<{ id: string; name: string; rows: RecordItem[] } | null>(null);
  const [obState, setObState] = useState<OneByOneState>({ index: 0, done: [] });
  useBackLayer(!!oneByOne, () => setOneByOne(null), 'one-by-one');
  const [waBusy, setWaBusy] = useState('');
  useBackLayer(!!waSend, () => setWaSend(null), 'whatsapp-groups');
  /** The text sent for one person: each phone's IMEI (and IMEI 2) on its own line; serial numbers only if ticked. */
  const sharePayload = (section: { name: string; items: { label: string; count: number; ids: string[] }[] }) => ({
    name: section.name,
    items: section.items.map(item => ({
      label: item.label,
      count: item.count,
      numbers: item.ids.flatMap(id => {
        const row = records.find(candidate => candidate.id === id);
        if (!row) return [];
        const pair = recordImeiPair(row), serial = recordSerial(row);
        const lines = [pair.imei1, pair.imei2].filter(Boolean);
        if (serial && (shareSerial || !lines.length)) lines.push(`S/N ${serial}`);
        return lines.length ? lines : ['No number detected'];
      }),
    })),
  });
  const WHATSAPP_NOTICE = 30;
  /** IMEI and serial numbers only, one per line, in the same order as the pictures. */
  function waNumbersText(rows: RecordItem[]) {
    return rows.flatMap(row => {
      const pair = recordImeiPair(row), serial = recordSerial(row);
      const lines = [pair.imei1, pair.imei2].filter(Boolean);
      if (serial && (shareSerial || !lines.length)) lines.push(`S/N ${serial}`);
      return lines.length ? lines : ['No number detected'];
    }).join('\n');
  }
  /** IMEI / serial lines written on one picture: "#3 of 40", then IMEI 1, IMEI 2 and the serial when asked for. */
  function pictureLines(row: RecordItem, position: number, total: number, forceSerial = false) {
    const pair = recordImeiPair(row), serial = recordSerial(row);
    const lines = [pair.imei1 && `IMEI 1: ${pair.imei1}`, pair.imei2 && `IMEI 2: ${pair.imei2}`, serial && (shareSerial || forceSerial || !pair.imei1) && `S/N: ${serial}`].filter(Boolean) as string[];
    if (!lines.length) lines.push('No number detected');
    lines[0] = `#${position} of ${total}  ${lines[0]}`;
    return lines;
  }
  /** Send every picture that is not sent yet in one share. Nothing is marked as sent until you say how many arrived. */
  async function sendWhatsAppPictures(channel: 'whatsapp' | 'bluetooth' = 'whatsapp') {
    if (!waSend || waBusy) return;
    const pending = waSend.rows.filter(row => !waSent.includes(row.id));
    if (!pending.length) return;
    const viaBluetooth = channel === 'bluetooth';
    try {
      const items: { name: string; base64: string; mime: string }[] = [];
      const numbers: string[] = [];
      const captions: string[] = [];
      for (let index = 0; index < pending.length; index++) {
        const row = pending[index];
        setWaBusy(`Preparing ${index + 1} of ${pending.length}…`);
        const position = waSend.rows.indexOf(row) + 1;
        const lines = pictureLines(row, position, waSend.rows.length, viaBluetooth);
        const source = recordPhoto(row);
        // Pictures carry no text; the numbers go in the caption (and numbers.txt for Bluetooth).
        const base64 = await readablePhotoBase64(source);
        items.push({ name: `${String(position).padStart(3, '0')}.jpg`, base64, mime: 'image/jpeg' });
        numbers.push(lines.join('  '));
        captions.push(captionLine(row, position));
        if (index % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0)); // let the screen update
      }
      // Bluetooth also carries a plain file with every IMEI and serial.
      if (viaBluetooth) items.push({ name: 'numbers.txt', base64: textToBase64(numbers.join('\n')), mime: 'text/plain' });
      // One caption for the whole send: every IMEI / serial once, in the same order as the pictures.
      const caption = !viaBluetooth && waCaption ? captions.join('\n') : '';
      if (androidBridge?.shareFolderText) {
        await androidShareBase64(items, waSend.name, caption, viaBluetooth, (done, total) => setWaBusy(`Sending ${done} of ${total}…`));
      } else {
        const files = items.map(item => new File([base64ToBytes(item.base64)], item.name, { type: item.mime }));
        const shareData: ShareData = caption ? { files, text: caption } : { files };
        if (typeof navigator.share === 'function' && navigator.canShare?.(shareData)) await navigator.share(shareData);
        else {
          files.forEach((file, index) => setTimeout(() => saveDirectFile(file, file.name), 300 + index * 400));
          setToast('This browser cannot send pictures directly. The pictures are being saved; send them from your files.');
        }
      }
      setWaBusy('');
      setWaAttempt({ ids: pending.map(row => row.id), arrived: viaBluetooth || pending.length <= WHATSAPP_NOTICE ? pending.length : WHATSAPP_NOTICE, channel });
    } catch (error) {
      setWaBusy('');
      if ((error as DOMException)?.name !== 'AbortError') {
        const message = error instanceof Error ? error.message : 'Could not open the share menu.';
        setToast(message);
        if (!viaBluetooth) { setWaProblem(message); setWarning(`${message} Use "Send by Bluetooth" instead: it sends the pictures, the IMEI and the serial.`); }
        else setWarning(message);
      }
    }
  }
  /** The user says how many pictures reached WhatsApp; the app remembers where it stopped. */
  function confirmWhatsAppArrived() {
    if (!waSend || !waAttempt) return;
    const next = [...new Set([...waSent, ...waAttempt.ids.slice(0, waAttempt.arrived)])];
    setWaSent(next);
    writeWaProgress(waSend.id, next);
    const short = waAttempt.arrived < waAttempt.ids.length;
    if (short && waAttempt.channel === 'whatsapp') {
      const message = `WhatsApp took only ${waAttempt.arrived} of ${waAttempt.ids.length} pictures.`;
      setWaProblem(message);
      setWarning(`${message} Send the rest by Bluetooth instead, or continue in WhatsApp.`);
    } else setWaProblem('');
    setWaAttempt(null);
    setToast(waAttempt.arrived ? `Saved: ${waAttempt.arrived} picture${waAttempt.arrived === 1 ? '' : 's'} sent. The app remembers where you stopped.` : 'Nothing saved as sent. You can send them again.');
  }
  /** One line per phone for the caption: "#3  IMEI 1  IMEI 2  S/N …". */
  function captionLine(row: RecordItem, position: number) {
    const pair = recordImeiPair(row), serial = recordSerial(row);
    const parts = [pair.imei1, pair.imei2, serial && (shareSerial || !pair.imei1) ? `S/N ${serial}` : ''].filter(Boolean);
    return `#${position}  ${parts.length ? parts.join('  ') : 'No number detected'}`;
  }

  const saveFolderSet = () => { try { return !!(JSON.parse(androidBridge?.saveFolderInfo?.() || '{}') as { set?: boolean }).set; } catch { return false; } };
  const canSaveSilently = () => !!(androidBridge?.commitStaged && androidBridge.saveFolderInfo && androidBridge.beginFolder && androidBridge.appendFolderFile);
  const reportFolderName = (name: string) => `IMEI-${name || 'phones'}`.replace(/[\\/:*?"<>|]/g, '_');
  /** Ask for the save folder once. After that the app remembers it and never asks again. */
  function ensureSaveFolder(): Promise<boolean> {
    if (saveFolderSet()) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = (event: Event) => { window.removeEventListener('android-save-folder', done); resolve(!!(event as CustomEvent<{ set: boolean }>).detail?.set); };
      window.addEventListener('android-save-folder', done);
      setToast('Choose a folder to save into, once. The app remembers it and will not ask again. Pick or create a folder such as Documents/IMEI.');
      androidBridge?.chooseSaveFolder?.();
    });
  }
  /** Wait until the app has finished copying the staged files into the saved folder. */
  function waitForSaved(): Promise<{ ok: boolean; count: number; where: string; error: string }> {
    return new Promise(resolve => {
      const finish = (event: Event) => { window.clearTimeout(timer); window.removeEventListener('android-saved', finish); resolve((event as CustomEvent<{ ok: boolean; count: number; where: string; error: string }>).detail); };
      const timer = window.setTimeout(() => { window.removeEventListener('android-saved', finish); resolve({ ok: false, count: 0, where: '', error: 'Saving took too long.' }); }, 10 * 60 * 1000);
      window.addEventListener('android-saved', finish);
    });
  }
  /** Stage base64 pieces under a token (1 MB each). */
  function stageBase64(token: string, fileName: string, base64: string) {
    const PIECE = 1048576;
    for (let offset = 0; offset < base64.length || offset === 0; offset += PIECE) {
      if (!androidBridge!.appendFolderFile!(token, fileName, base64.slice(offset, offset + PIECE))) throw new Error(`Could not prepare ${fileName}.`);
      if (!base64.length) break;
    }
  }
  /** Save pictures and numbers.txt into the remembered folder without asking; a repeat save replaces the earlier files. */
  async function saveToMyselfSilent(name: string, rows: RecordItem[], allRows: RecordItem[]): Promise<boolean> {
    const bridge = androidBridge!;
    if (!(await ensureSaveFolder())) { setToast('No folder was chosen. Nothing was saved.'); return false; }
    const token = bridge.beginFolder!('imei-save');
    if (!token) { setToast('The phone is still busy. Try again in a moment.'); return false; }
    try {
      const total = allRows.length;
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const position = allRows.indexOf(row) + 1 || index + 1;
        const base64 = await readablePhotoBase64(recordPhoto(row));
        stageBase64(token, `${String(position).padStart(3, '0')}-${recordImeiPair(row).imei1 || recordSerial(row) || 'phone'}.jpg`, base64);
        setToast(`Preparing ${index + 1} of ${rows.length}…`);
        if (index % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
      }
      // numbers.txt always lists every phone, even when only the rest was saved now.
      stageBase64(token, 'numbers.txt', textToBase64(allRows.map((row, index) => pictureLines(row, index + 1, total, true).join('  ')).join('\n')));
      const finished = waitForSaved();
      // A full save replaces the earlier pictures; saving only the rest keeps the ones already there.
      if (!bridge.commitStaged!(token, reportFolderName(name), rows.length === allRows.length)) throw new Error('Could not save. Choose the folder again in Settings.');
      const result = await finished;
      setToast(result.ok ? `Saved ${result.count} files to ${result.where}. Saving again replaces them.` : result.error || 'Could not save.');
      return result.ok;
    } catch (error) {
      bridge.abortFolder?.(token);
      setToast(error instanceof Error ? error.message : 'Could not save the report.');
      return false;
    }
  }

  /** Save a copy to this phone: a folder with every picture (IMEI / serial written on it) and a numbers.txt. */
  async function saveToMyself(name: string, rows: RecordItem[], allRows: RecordItem[] = rows): Promise<boolean> {
    if (!rows.length) return false;
    if (canSaveSilently()) return saveToMyselfSilent(name, rows, allRows);
    const bridge = androidBridge;
    const useFolder = !!(bridge?.beginFolder && bridge.appendFolderFile && bridge.finishFolder);
    const folderName = `IMEI-${name || 'phones'}-${new Date().toISOString().slice(0, 10)}`.replace(/[\\/:*?"<>|]/g, '_');
    const total = allRows.length, numbers: string[] = [];
    let token = '';
    const append = async (file: File) => {
      for (let offset = 0; offset < file.size || offset === 0; offset += 64 * 1024) {
        const chunk = (await blobDataUrl(file.slice(offset, offset + 64 * 1024))).split(',')[1] || '';
        if (!bridge!.appendFolderFile!(token, file.name, chunk)) throw new Error(`Could not prepare ${file.name}.`);
        if (file.size === 0) break;
      }
    };
    try {
      if (useFolder) { token = bridge!.beginFolder!(folderName); if (!token) throw new Error('Finish or cancel the current save before saving again.'); }
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const position = allRows.indexOf(row) + 1 || index + 1;
        const lines = pictureLines(row, position, total, true);
        const blob = await readablePhoto(recordPhoto(row));
        const file = new File([blob], `${String(position).padStart(3, '0')}-${recordImeiPair(row).imei1 || recordSerial(row) || 'phone'}.jpg`, { type: 'image/jpeg' });
        numbers.push(lines.join('  '));
        if (useFolder) await append(file); else { saveDirectFile(file, file.name); await new Promise(resolve => setTimeout(resolve, 350)); }
        if (index % 10 === 0) setToast(`Preparing ${index + 1} of ${total}…`);
      }
      const list = new File([numbers.join('\n')], 'numbers.txt', { type: 'text/plain' });
      if (useFolder) { await append(list); if (!bridge!.finishFolder!(token)) throw new Error('Could not open the folder picker.'); setToast('Choose a folder and tap Save. A new folder is created with the pictures and numbers.txt.'); }
      else { saveDirectFile(list, list.name); setToast(`Saved ${total} picture${total === 1 ? '' : 's'} and numbers.txt to your downloads.`); }
      return true;
    } catch (error) {
      if (useFolder && token) bridge!.abortFolder?.(token);
      setToast(error instanceof Error ? error.message : 'Could not save the report.');
      return false;
    }
  }
  const rowsOfSection = (id: string) => idsOfSection(id).map(rowId => records.find(row => row.id === rowId)).filter((row): row is RecordItem => !!row);

  function startOneByOne(section: { id: string; name: string }) {
    const rows = rowsOfSection(section.id);
    if (!rows.length) return;
    const saved = readOneByOne(section.id);
    setObState({ done: saved.done, index: Math.max(0, Math.min(saved.index, rows.length - 1)) });
    setOneByOne({ id: section.id, name: section.name, rows });
  }
  function obSet(next: OneByOneState) {
    setObState(next);
    if (oneByOne) writeOneByOne(oneByOne.id, next);
  }
  /** Download this picture, remember it, and show the next phone. */
  async function obDownloadNext() {
    if (!oneByOne) return;
    const row = oneByOne.rows[obState.index];
    if (!row) return;
    // Copy first, while the tap is still fresh, so the phone allows it.
    const imei = recordImeiPair(row).imei1;
    const copiedPromise = imei ? copyText(imei) : Promise.resolve(false);
    if (canSaveSilently()) {
      if (!(await ensureSaveFolder())) { setToast('No folder was chosen. Nothing was saved.'); return; }
      const token = androidBridge!.beginFolder!('imei-one');
      if (!token) { setToast('The phone is still busy. Try again in a moment.'); return; }
      try {
        stageBase64(token, orderedPhotoName(row, obState.index + 1), recordPhoto(row).split(',')[1] || '');
        if (!androidBridge!.commitStaged!(token, reportFolderName(oneByOne.name), false)) throw new Error('Could not save. Choose the folder again in Settings.');
      } catch (error) {
        androidBridge!.abortFolder?.(token);
        setToast(error instanceof Error ? error.message : 'Could not save the picture.');
        return;
      }
    } else saveDirectFile(dataUrlBlob(recordPhoto(row)), orderedPhotoName(row, obState.index + 1));
    obSet({ done: [...new Set([...obState.done, row.id])], index: Math.min(oneByOne.rows.length - 1, obState.index + 1) });
    setToast((await copiedPromise) ? `Picture saved and IMEI ${imei} copied.` : imei ? 'Picture saved. Could not copy the IMEI.' : 'Picture saved. No IMEI to copy.');
  }
  async function obSaveRemaining() {
    if (!oneByOne) return;
    const remaining = oneByOne.rows.filter(row => !obState.done.includes(row.id));
    if (!remaining.length) return;
    if (await saveToMyself(oneByOne.name, remaining, oneByOne.rows)) obSet({ done: oneByOne.rows.map(row => row.id), index: obState.index });
  }

  function resetWhatsAppProgress() {
    if (!waSend) return;
    setWaSent([]); setWaAttempt(null);
    writeWaProgress(waSend.id, []);
    setToast('Started over. Nothing is marked as sent.');
  }
  /** Android app: all pictures go through the phone's share sheet in a single send (optionally with one text). */
  /** Android app: stage base64 pictures in large pieces (fast), then open the share menu once. */
  async function androidShareBase64(items: { name: string; base64: string }[], title: string, text: string, bluetooth: boolean, onProgress?: (done: number, total: number) => void) {
    const bridge = androidBridge;
    if (!bridge?.beginFolder || !bridge.appendFolderFile || !bridge.shareFolderText) throw new Error('Sharing is not available in this app version.');
    const token = bridge.beginFolder('imei-share');
    if (!token) throw new Error('The phone is still busy with a save. Wait a moment and try again.');
    const PIECE = 1048576; // a multiple of 4, so every piece is valid base64
    try {
      for (let index = 0; index < items.length; index++) {
        const { name, base64 } = items[index];
        for (let offset = 0; offset < base64.length || offset === 0; offset += PIECE) {
          if (!bridge.appendFolderFile(token, name, base64.slice(offset, offset + PIECE))) throw new Error(`Could not prepare ${name}.`);
          if (!base64.length) break;
        }
        onProgress?.(index + 1, items.length);
        if (index % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
      }
      const opened = bluetooth && bridge.shareFolderBluetooth ? bridge.shareFolderBluetooth(token, title) : bridge.shareFolderText(token, title, text);
      if (!opened) throw new Error('Could not open the share menu.');
    } catch (error) { bridge.abortFolder?.(token); throw error; }
  }
  async function androidShareFiles(files: File[], title: string, text: string, bluetooth = false) {
    const bridge = androidBridge;
    if (!bridge?.beginFolder || !bridge.shareFolderText) return false;
    const token = bridge.beginFolder('imei-share');
    if (!token) throw new Error('Finish or cancel the current save before sharing.');
    try {
      for (const file of files) for (let offset = 0; offset < file.size || offset === 0; offset += 64 * 1024) {
        const chunk = (await blobDataUrl(file.slice(offset, offset + 64 * 1024))).split(',')[1] || '';
        if (!bridge.appendFolderFile!(token, file.name, chunk)) throw new Error(`Could not prepare ${file.name}.`);
        if (file.size === 0) break;
      }
      const opened = bluetooth && bridge.shareFolderBluetooth ? bridge.shareFolderBluetooth(token, title) : bridge.shareFolderText(token, title, text);
      if (!opened) throw new Error('Could not open the share menu.');
      return true;
    } catch (error) { bridge.abortFolder?.(token); throw error; }
  }
  /** The WhatsApp button on a person: up to 10 phones go at once, more are offered in groups. */
  function startWhatsApp(section: { id: string; name: string }, preferBluetooth = false) {
    const rows = idsOfSection(section.id).map(id => records.find(row => row.id === id)).filter((row): row is RecordItem => !!row);
    if (!rows.length) return;
    setWaSent(readWaProgress(section.id));
    setWaAttempt(null);
    setWaBusy('');
    setWaProblem('');
    setWaPreferBluetooth(preferBluetooth);
    let caps: { whatsapp?: boolean; bluetooth?: boolean; bluetoothOn?: boolean } | null = null;
    try { caps = androidBridge?.sendCapabilities ? JSON.parse(androidBridge.sendCapabilities()) : null; } catch { caps = null; }
    setWaCaps(caps);
    if (caps?.whatsapp === false && !preferBluetooth) setWarning('WhatsApp is not installed on this phone. Use "Send by Bluetooth": it sends the pictures, the IMEI and the serial.');
    setWaSend({ id: section.id, name: section.name, rows });
  }
  const shareSections = [
    ...personGroups.map(person => ({ id: person.id, name: personName(person), items: personModels.get(person.id) || [] })),
    { id: UNASSIGNED_FILTER, name: 'Unassigned', items: personModels.get(UNASSIGNED_FILTER) || [] },
  ].filter(section => section.items.length);
  const idsOfSection = (id: string) => records.filter(row => id === UNASSIGNED_FILTER ? !personGroups.some(person => person.id === row.personId) : row.personId === id).map(row => row.id);

  const peoplePanel = (
            <details className="people-panel" open={peopleOpen} onToggle={event => setPeopleOpen((event.currentTarget as HTMLDetailsElement).open)}>
              <summary>People <b>{personGroups.length}</b></summary>
              <ul className="people-list">
                {personGroups.map(person => <li key={person.id}>
                  {editingPersonId === person.id
                    ? <>
                      <input autoFocus aria-label="Person name" value={personDraft} placeholder="Type a name" maxLength={60} onChange={event => setPersonDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { renamePerson(person.id, personDraft.trim()); setEditingPersonId(''); } if (event.key === 'Escape') setEditingPersonId(''); }} />
                      <button className="primary" onClick={() => { renamePerson(person.id, personDraft.trim()); setEditingPersonId(''); }}>Save name</button>
                      <button className="subtle-btn" onClick={() => setEditingPersonId('')}>Cancel</button>
                    </>
                    : <>
                      <span className="person-name"><strong>{personName(person)}</strong><small>{(personModels.get(person.id) || []).reduce((sum, item) => sum + item.count, 0)} phone{(personModels.get(person.id) || []).reduce((sum, item) => sum + item.count, 0) === 1 ? '' : 's'}</small></span>
                      <button className="subtle-btn" aria-label={`Rename ${personName(person)}`} onClick={() => { setEditingPersonId(person.id); setPersonDraft(person.name); }}><Pencil size={14} /> Rename</button>
                      <button className="subtle-btn danger" aria-label={`Delete ${personName(person)}`} disabled={personGroups.length < 2} title={personGroups.length < 2 ? 'Keep at least one person' : undefined} onClick={() => setDeletePersonId(person.id)}><Trash2 size={14} /> Delete</button>
                      <div className="person-models" aria-label={`Models ${personName(person)} has`}>
                        {(personModels.get(person.id) || []).length ? (personModels.get(person.id) || []).map(item => <button type="button" key={item.key} className="model-tag" title="Show these phones" onClick={() => jumpTo('records', item.key, person.id)}>{item.label} <b>× {item.count}</b></button>) : <em>No models yet</em>}
                      </div>
                    </>}
                </li>)}
                {(personModels.get(UNASSIGNED_FILTER) || []).length > 0 && <li className="people-unassigned">
                  <span className="person-name"><strong>Unassigned</strong><small>{(personModels.get(UNASSIGNED_FILTER) || []).reduce((sum, item) => sum + item.count, 0)} phones</small></span>
                  <div className="person-models" aria-label="Models that are unassigned">{(personModels.get(UNASSIGNED_FILTER) || []).map(item => <button type="button" key={item.key} className="model-tag" title="Show these phones" onClick={() => jumpTo('records', item.key, UNASSIGNED_FILTER)}>{item.label} <b>× {item.count}</b></button>)}</div>
                </li>}
              </ul>
              <button className="subtle-btn" onClick={addPersonGroup}>+ Add person</button>
            </details>
  );
  /** Models panel: when a person is chosen, only the models that person holds. */
  const panelGroups = modelGroups.filter(group => !reviewPerson || (reviewPerson === UNASSIGNED_FILTER ? group.ids.length - personGroups.reduce((sum, person) => sum + (group.byPerson[person.id] || 0), 0) > 0 : (group.byPerson[reviewPerson] || 0) > 0));
  const modelsTab = (
    <div className="give-tab">
      {peoplePanel}
      <label className="models-filter">Show models of
        <select aria-label="Show models of a person" value={reviewPerson} onChange={event => setReviewPerson(event.target.value)}>
          <option value="">Everyone</option>
          {personGroups.map(person => <option key={person.id} value={person.id}>{personName(person)}</option>)}
          <option value={UNASSIGNED_FILTER}>Unassigned</option>
        </select>
      </label>
      <p className="settings-help">Tap − or + to change how many of each model a person gets. Phones nobody gets stay Unassigned. Then press Confirm.</p>
      <ul className="models-list">
        {panelGroups.length === 0 && <li><em>{modelGroups.length ? 'That person holds no models yet.' : 'Scan some phones first and their models appear here.'}</em></li>}
        {panelGroups.map(group => <li key={group.key} className={`give-card${focusedModel === group.key ? ' focused' : ''}`} data-model-key={group.key}>
          <div className="give-head"><strong>{group.label}</strong><small>{group.code ? `${group.code} · ` : ''}{group.ids.length} phone{group.ids.length === 1 ? '' : 's'}</small></div>
          <ul className="split-list">
            {personGroups.map(person => <li key={person.id}>
              <span>{personName(person)}</span>
              <button type="button" className="subtle-btn" aria-label={`One less ${group.label} for ${personName(person)}`} disabled={giveValue(group, person.id) <= 0} onClick={() => giveSet(group, person.id, giveValue(group, person.id) - 1)}>−</button>
              <input type="number" inputMode="numeric" min={0} max={group.ids.length} aria-label={`How many ${group.label} for ${personName(person)}`} value={giveValue(group, person.id)} onChange={event => giveSet(group, person.id, Number(event.target.value))} />
              <button type="button" className="subtle-btn" aria-label={`One more ${group.label} for ${personName(person)}`} disabled={giveRest(group) <= 0} onClick={() => giveSet(group, person.id, giveValue(group, person.id) + 1)}>+</button>
            </li>)}
            <li className="split-rest"><span>Unassigned (the rest)</span><b>{giveRest(group)}</b></li>
          </ul>
          <label className="move-to">Give all to
            <select aria-label={`Give all ${group.label} to`} value="" onChange={event => { if (event.target.value) giveAll(group, event.target.value); }}>
              <option value="">Choose person</option>
              {personGroups.map(person => <option key={person.id} value={person.id}>{personName(person)}</option>)}
            </select>
          </label>
        </li>)}
      </ul>
      <div className="confirm-bar" role="group" aria-label="Confirm changes">
        <span>{giveChanged.length ? `${giveChanged.length} model${giveChanged.length === 1 ? '' : 's'} changed` : 'No changes yet'}</span>
        <button className="primary" disabled={!giveChanged.length} onClick={confirmGive}>Confirm changes</button>
        <button className="subtle-btn" disabled={!giveChanged.length} onClick={() => setGiveDraft({})}>Reset</button>
      </div>
    </div>
  );
  /** Models the app could not name: they need a name typed once so every phone of that model reads correctly. */
  const unknownGroups = modelGroups.filter(group => group.key === 'unknown' || group.label.endsWith('(not recognised)'));
  const [unknownDrafts, setUnknownDrafts] = useState<Record<string, string>>({});
  const [unknownCodes, setUnknownCodes] = useState<Record<string, string>>({});
  /** Every model name the app knows: built-in list, downloaded catalog and your own names. */
  const knownModels = useMemo(() => {
    const map = new Map<string, string>();
    for (const [code, name] of Object.entries(SAMSUNG_MODELS)) map.set(code, name);
    for (const entry of catalogEntries) { const code = modelCode4(entry.modelCode); if (code && entry.name) map.set(code, entry.name); }
    for (const [code, name] of Object.entries(customModels)) map.set(code, name);
    return map;
  }, [catalogEntries, customModels]);
  /** Likely answers for an unknown code: a known code one character away (the scanner may have misread it), then nearby models. */
  function suggestionsFor(code: string) {
    if (code.length !== 4) return [] as { code: string; name: string; kind: 'fix' | 'near' }[];
    const fixes: { code: string; name: string; kind: 'fix' | 'near' }[] = [];
    for (const [known, name] of knownModels) {
      if (known === code) continue;
      let different = 0;
      for (let index = 0; index < 4; index++) if (known[index] !== code[index]) different++;
      if (different === 1) fixes.push({ code: known, name, kind: 'fix' });
    }
    const number = Number(code.slice(1));
    const near = [...knownModels].filter(([known]) => known !== code && known[0] === code[0] && !fixes.some(item => item.code === known))
      .map(([known, name]) => ({ code: known, name, kind: 'near' as const, gap: Math.abs(Number(known.slice(1)) - number) }))
      .filter(item => Number.isFinite(item.gap) && item.gap <= 20).sort((a, b) => a.gap - b.gap);
    return [...fixes.slice(0, 2), ...near.slice(0, 3)].slice(0, 4);
  }
  function saveUnknownName(group: { key: string; code: string }) {
    const code = normalizeCode(group.code), label = cleanName(unknownDrafts[group.key] || '');
    if (!code || !label) { setToast('Type the name for this model first.'); return; }
    const next = { ...customModels, [code]: label };
    if (!writeCustomModels(next)) { setToast('Could not save. Device storage is full.'); return; }
    setCustomModels(next);
    setUnknownDrafts(old => { const { [group.key]: _done, ...rest } = old; return rest; });
    setToast(`Saved SM-${code}: ${label}.`);
  }
  function fixGroupCode(group: { key: string; code: string }, typed: string) {
    const from = modelCode4(group.code), to = normalizeCode(typed);
    if (!from || !to || from === to) { setToast('Type a model code such as SM-S954.'); return; }
    const count = changeModelCode(from, to);
    setUnknownCodes(old => { const { [group.key]: _done, ...rest } = old; return rest; });
    setToast(count ? `Changed SM-${from} to SM-${to} on ${count} phone${count === 1 ? '' : 's'}.` : 'No phones changed.');
  }
  function setGroupModel(ids: string[], model: string) {
    const wanted = new Set(ids);
    setRecords(old => old.map(row => wanted.has(row.id) ? { ...row, model } : row));
    setToast(`Model set on ${ids.length} phone${ids.length === 1 ? '' : 's'}.`);
  }
  const unknownTab = (
    <div className="give-tab unknown-tab">
      <p className="settings-help">{unknownGroups.length ? 'These models have no name yet. The phones are listed under each one: tap a phone to open it. Type the name once, or pick a suggestion, and every phone of that model is updated.' : 'Every scanned model has a name. Nothing to fill in.'}</p>
      <ul className="models-list">
        {unknownGroups.map(group => {
          const phones = group.ids.map(id => records.find(row => row.id === id)).filter((row): row is RecordItem => !!row);
          const code = modelCode4(group.code);
          const suggestions = code ? suggestionsFor(code) : [];
          return <li key={group.key} className="give-card">
            <div className="give-head"><strong>{group.code || 'No model code read'}</strong><small>{phones.length} phone{phones.length === 1 ? '' : 's'}</small></div>
            <ul className="unknown-phones" aria-label={`Phones with ${group.code || 'no model code'}`}>
              {phones.slice(0, 6).map(row => <li key={row.id}><button type="button" className="unknown-phone" onClick={() => openReview(row)}>
                <img src={recordPhoto(row)} alt="" />
                <span><b>{recordImeiPair(row).imei1 || recordSerial(row) || 'No number read'}</b><small>{row.name}</small></span>
              </button></li>)}
            </ul>
            {phones.length > 6 && <button type="button" className="subtle-btn" onClick={() => jumpTo('records', group.key)}>Show all {phones.length} phones</button>}
            {group.code
              ? <div className="unknown-fill">
                <input aria-label={`Name for ${group.code}`} value={unknownDrafts[group.key] || ''} maxLength={80} placeholder="Name, for example Galaxy A27" onChange={event => setUnknownDrafts(old => ({ ...old, [group.key]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') saveUnknownName(group); }} />
                <button type="button" className="primary" disabled={!cleanName(unknownDrafts[group.key] || '')} onClick={() => saveUnknownName(group)}>Save name</button>
              </div>
              : <p className="settings-help">The model could not be read from these photos. Open a phone, or pick the model for all of them below.</p>}
            {suggestions.length > 0 && <div className="unknown-suggest" role="group" aria-label="Suggestions">
              <small>Suggestions</small>
              <div>{suggestions.map(item => item.kind === 'fix'
                ? <button key={item.code} type="button" className="chip-btn" title="The scanner may have misread the code. Use this code for these phones." onClick={() => fixGroupCode(group, `SM-${item.code}`)}>Misread? Use SM-{item.code} · {item.name}</button>
                : <button key={item.code} type="button" className="chip-btn" title="Fill the name with a similar model" onClick={() => setUnknownDrafts(old => ({ ...old, [group.key]: item.name }))}>{item.name} (SM-{item.code})</button>)}</div>
            </div>}
            <details className="review-details"><summary>More options for these phones</summary>
              <div className="unknown-options">
                {group.code && <label>Fix the model code
                  <span className="unknown-fill"><input aria-label="Correct model code" value={unknownCodes[group.key] || ''} maxLength={24} autoCapitalize="characters" placeholder={group.code} onChange={event => setUnknownCodes(old => ({ ...old, [group.key]: event.target.value }))} />
                    <button type="button" className="subtle-btn" disabled={!normalizeCode(unknownCodes[group.key] || '')} onClick={() => fixGroupCode(group, unknownCodes[group.key] || '')}>Change code</button></span>
                </label>}
                <label>Pick the model for all {phones.length} phones
                  <ModelPicker value="" onChange={model => setGroupModel(group.ids, model)} customModels={customModels} catalogEntries={catalogEntries} scannedModels={records.map(row => row.model)} onAddModel={(newCode, name) => { const next = { ...customModels, [newCode]: name }; if (!writeCustomModels(next)) return false; setCustomModels(next); return true; }} />
                </label>
                <label>Move these phones to
                  <select aria-label="Move these phones to a person" value="" onChange={event => { if (event.target.value) moveRecords(group.ids, ownerOf(event.target.value)); }}>
                    <option value="">Choose person</option>
                    {personGroups.map(person => <option key={person.id} value={person.id}>{personName(person)}</option>)}
                    <option value="unassigned">Unassigned</option>
                  </select>
                </label>
              </div>
            </details>
          </li>;
        })}
      </ul>
      <div className="unknown-more">
        <strong>More you can do</strong>
        <button type="button" className="subtle-btn" onClick={() => setSettingsOpen(true)}>Add many names at once (Settings)</button>
        <button type="button" className="subtle-btn" onClick={() => jumpTo('records', 'Review')}>Show phones that need review</button>
      </div>
    </div>
  );
  const shareTab = (
    <div className="share-tab">
      {shareSections.length === 0 ? <p>No phones yet.</p> : <>
        <p className="settings-help">WhatsApp: one send with all of a person's pictures and one caption listing every IMEI and serial. Bluetooth / nearby opens your phone's share menu with the pictures and a plain numbers file.</p>
        <div className="share-toolbar">
          <button className="primary whatsapp-btn" onClick={() => openWhatsApp(formatPersonShare(shareSections.map(sharePayload)))}>WhatsApp text — everyone</button>
          <button className="subtle-btn" onClick={() => void copyText(formatPersonShare(shareSections.map(sharePayload))).then(ok => setToast(ok ? 'List copied.' : 'Copy failed.'))}>Copy all</button>
          <button className="subtle-btn" onClick={() => setOverviewOpen(true)}>Review by model</button>
          <label className="settings-check"><input type="checkbox" checked={shareSerial} onChange={event => setShareSerial(event.target.checked)} /> Include serial numbers</label>
        </div>
        <ul className="overview-list">
          {shareSections.map(section => <li key={section.id}>
            <h3>{section.name} <b>{section.items.reduce((sum, item) => sum + item.count, 0)}</b></h3>
            <ul>{section.items.map(item => <li key={item.key}><button type="button" className="link-btn" title="Open this model to change how many" onClick={() => focusModel(item.key)}>{item.label}</button> <b>× {item.count}</b></li>)}</ul>
            <div className="share-toolbar">
              <button className="primary whatsapp-btn" aria-label={`WhatsApp ${section.name}: pictures and IMEI`} onClick={() => startWhatsApp(section)}>WhatsApp · pictures + IMEI</button>
              <button className="subtle-btn" aria-label={`Text only for ${section.name}`} onClick={() => openWhatsApp(formatPersonShare([sharePayload(section)]))}>Text only</button>
              <button className="subtle-btn" aria-label={`Bluetooth or nearby share for ${section.name}`} onClick={() => startWhatsApp(section, true)}>Bluetooth / nearby</button>
              <button className="subtle-btn" aria-label={`One by one for ${section.name}`} onClick={() => startOneByOne(section)}>One by one</button>
              <button className="subtle-btn" aria-label={`Save ${section.name} to my phone`} onClick={() => void saveToMyself(section.name, rowsOfSection(section.id))}>Save to my phone</button>
              <button className="subtle-btn" aria-label={`Copy ${section.name}`} onClick={() => void copyText(formatPersonShare([sharePayload(section)])).then(ok => setToast(ok ? `${section.name}'s list copied.` : 'Copy failed.'))}>Copy</button>
            </div>
          </li>)}
        </ul>
      </>}
    </div>
  );
  async function shareOrCopyText(text: string, what: string) {
    if (!text) return;
    if (androidBridge?.shareText) { androidBridge.shareText(what, text); setToast(`${what} sent to the share menu. Choose WhatsApp.`); return; }
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ text }); setToast(`${what} sent to the share menu.`); return; }
      catch (error) { if ((error as DOMException)?.name === 'AbortError') return; }
    }
    setToast((await copyText(text)) ? `${what} copied. Paste it into your chat.` : 'Could not share or copy the list.');
  }

  const visible = records.filter(r =>
    (filter === 'All' ||
      (filter === 'Duplicates' ? r.duplicate :
        filter === 'Review' ? reviewStatus(r).includes('Needs review') :
          filter === 'Valid' ? r.status === 'Valid' :
          (infoOf(r).series === filter || modelKeyOf(r) === filter))) &&
    (`${r.name} ${r.model} ${infoOf(r).name} ${r.imei} ${recordSerial(r)}`)
      .toLowerCase()
      .includes(query.toLowerCase()) &&
    (personFilter === 'All' || (personFilter === UNASSIGNED_FILTER ? r.personId === UNASSIGNED : r.personId === personFilter))
  );
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(recordPage, pageCount);
  const pageRows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  // The phones on this page, grouped under their series heading.
  const pageGroups = (() => {
    const groups = new Map<string, RecordItem[]>();
    for (const row of pageRows) { const series = infoOf(row).series; groups.set(series, [...(groups.get(series) || []), row]); }
    return [...groups.entries()].sort((a, b) => /^Unknown/.test(a[0]) ? 1 : /^Unknown/.test(b[0]) ? -1 : b[0].localeCompare(a[0], undefined, { numeric: true }));
  })();
  useEffect(() => { setRecordPage(1); }, [filter, query, personFilter]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = records.filter(r => selectedIdSet.has(r.id));
  const exportExcludedSet = useMemo(() => new Set(exportExcludedIds), [exportExcludedIds]);
  const exportCandidates = (selectedOnly ? selectedRows : records).filter(record =>
    imeiFilter === 'all' || (imeiFilter === 'with' ? !!record.imei : !record.imei)
  );
  const exportRows = exportCandidates.filter(record => !exportExcludedSet.has(record.id));
  const searchedExportRows = exportCandidates.filter(record =>
    `${record.number} ${record.pictureId} ${record.imei} ${record.model} ${personTitle(record, personGroups)}`
      .toLowerCase().includes(exportSearch.trim().toLowerCase())
  );
  const recordById = useMemo(() => new Map(records.map(record => [record.id, record])), [records]);
  const reviewRecords = reviewIds.map(id => recordById.get(id)).filter((record): record is RecordItem => !!record);
  const reviewIndex = selected ? reviewRecords.findIndex(record => record.id === selected.id) : -1;
  useEffect(() => {
    if (!selected) return;
    function handleReviewKeys(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName || '')) return;
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
      if (!direction || reviewIndex < 0 || rotatingPhoto) return;
      event.preventDefault();
      goReview(direction > 0 ? 1 : -1);
    }
    document.addEventListener('keydown', handleReviewKeys);
    return () => document.removeEventListener('keydown', handleReviewKeys);
  }, [selected, reviewIndex, reviewRecords, rotatingPhoto, manualModel, manualImei]);
  function openReview(record: RecordItem) {
    setReviewIds(visible.map(item => item.id));
    setSelected(record);
  }
  /** Delete the extra copies of repeated IMEIs. One copy of each stays; Undo brings the rest back for a few seconds. */
  function removeDuplicates(ids: string[]) {
    const set = new Set(ids);
    setPersonUndo({ people: personGroups, records, text: `${ids.length} duplicate${ids.length === 1 ? '' : 's'} deleted. One copy of each IMEI was kept.`, activePersonId });
    setRecords(old => markDuplicateRecords(old.filter(item => !set.has(item.id))));
    setSelectedIds(old => old.filter(id => !set.has(id)));
    setReviewIds(old => old.filter(id => !set.has(id)));
    if (selected && set.has(selected.id)) setSelected(null);
    if (filter === 'Duplicates') setFilter('All');
  }
  /** Permanently remove phones (only reached after the confirmation, or from the review window's own confirmation). */
  function removeRecords(ids: string[], fromReview = false) {
    const set = new Set(ids);
    const next = fromReview ? reviewRecords[reviewIndex + 1] || reviewRecords[reviewIndex - 1] : null;
    setRecords(old => markDuplicateRecords(old.filter(item => !set.has(item.id))));
    setSelectedIds(old => old.filter(id => !set.has(id)));
    setReviewIds(old => old.filter(id => !set.has(id)));
    setSelectedOnly(false);
    if (fromReview) { closeCropEditor(); setSelected(next && !set.has(next.id) ? next : null); }
    else if (selected && set.has(selected.id)) setSelected(null);
    setToast(`${ids.length} IMEI record${ids.length === 1 ? '' : 's'} deleted permanently.`);
  }

  /**
   * Delete. Under one person it only takes the phones off that person: they stay under Everyone as
   * unassigned. Under Everyone (or Unassigned) it removes them permanently, after a confirmation.
   */
  function requestDelete(rows: RecordItem[], fromReview = false) {
    if (!rows.length) return;
    if (isPersonView(personFilter)) {
      const next = fromReview ? reviewRecords[reviewIndex + 1] || reviewRecords[reviewIndex - 1] : null;
      const plan = planUnassign(records, rows.map(row => row.id), personFilter);
      if (!plan.moved.length) { setToast('Nothing to remove from this person.'); return; }
      setRecords(plan.records);
      setSelectedIds(old => old.filter(id => !plan.moved.includes(id)));
      setEmptiedPeople(old => old.filter(id => id !== personFilter));
      if (fromReview) { closeCropEditor(); setSelected(next && !plan.moved.includes(next.id) ? next : null); }
      setToast(`${plan.moved.length} IMEI${plan.moved.length === 1 ? '' : 's'} moved to Everyone as unassigned.`);
      return;
    }
    setConfirmDelete({ ids: rows.map(row => row.id), fromReview });
  }

  function deleteRecord(record: RecordItem, fromReview = false, confirmed = false) {
    if (confirmed && !isPersonView(personFilter)) { removeRecords([record.id], fromReview); return; }
    requestDelete([record], fromReview);
  }
  const allVisibleSelected = visible.length > 0 &&
    visible.every(r => selectedIdSet.has(r.id));
  /** Clears the upload queue, progress, search, filters and selection so a new batch can start. Saved records are not touched. */
  /** Reset: delete every scanned record and photo on this device, including the Android app's saved scans. */
  const [resetOpen, setResetOpen] = useState(false);
  useBackLayer(resetOpen, () => setResetOpen(false), 'reset');
  function resetEverything() {
    if (androidBridge?.resetScans && !androidBridge.resetScans()) { setToast('Could not clear the scans saved by the app. Nothing was deleted.'); setResetOpen(false); return; }
    importedAndroidIds.current.clear();
    androidCursor.current = 0;
    try { localStorage.removeItem(NATIVE_IMPORTED_STORE); } catch { /* nothing stored */ }
    setRecords([]); setFiles([]); setProgress(''); setCompletedFiles(0); setLaptopMessage('');
    setQuery(''); setFilter('All'); setPersonFilter('All'); setSelectedIds([]); setSelectedOnly(false); setRecordPage(1);
    setSelected(null); setAndroidJob(null); setGiveDraft({});
    setResetOpen(false);
    setToast('All scanned records and photos were deleted.');
  }

  function resetForNewEntries() {
    if (busy || laptopUploading) { setToast('Stop the current scan first, then reset.'); return; }
    setFiles([]); setProgress(''); setCompletedFiles(0); setLaptopMessage('');
    setQuery(''); setFilter('All'); setPersonFilter('All'); setSelectedIds([]); setSelectedOnly(false); setRecordPage(1);
    setToast('Ready for new entries. Your saved records were not changed.');
  }

  /** Fix a model code that was read wrongly: every phone with the old code gets the new one (the rest of the text is kept). */
  function changeModelCode(from: string, to: string) {
    const count = records.filter(row => modelCode4(row.model) === from).length;
    if (!count) return 0;
    setRecords(old => old.map(row => modelCode4(row.model) === from ? { ...row, model: row.model.replace(/(SM\s*-?\s*)[A-Z]\d{3}/i, `$1${to}`) } : row));
    return count;
  }

  function addPersonGroup() {
    const next = nextPersonNumber(personGroups.map(item => item.label));
    const person = {
      id: `person-${newId()}`,
      label: `Person ${next}`,
      name: ''
    };
    setPersonGroups(old => [...old, person]);
    setActivePersonId(person.id);
    // Keep showing everyone, and open the name box so the new person can be named right away.
    setEditingPersonId(person.id);
    setPersonDraft('');
    setPeopleOpen(true);
    if (!simpleView) { setMainView('results'); setRecordsTab('models'); }
  }

  /** The phones a bulk action applies to: the ticked ones, or everything shown when none are ticked. */
  const bulkTargets = () => (selectedRows.length ? selectedRows : visible);
  const bulkCropRows = () => selectedRows.length ? selectedRows : records.some(needsCropping) ? records.filter(needsCropping) : visible;
  const bulkCropLabel = selectedRows.length ? `${selectedRows.length} ticked` : records.some(needsCropping) ? `${records.filter(needsCropping).length} need cropping` : `all ${visible.length} shown`;

  /** Send all the numbers as one message (share sheet, or copied when sharing is unavailable). */
  async function sendNumbers() {
    const rows = bulkTargets();
    if (!rows.length) return;
    const text = rows.map((row, index) => { const pair = recordImeiPair(row), serial = recordSerial(row); return `${[pair.imei1 || (serial ? '' : '—'), pair.imei2 && `IMEI 2 ${pair.imei2}`, serial && `S/N ${serial}`].filter(Boolean).join('  ')}`; }).join('\n');
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ text }); setToast('Numbers sent to the share menu.'); return; }
      catch (error) { if ((error as DOMException)?.name === 'AbortError') return; }
    }
    setToast((await copyText(text)) ? `${rows.length} numbers copied. Paste them into your chat.` : 'Could not share or copy the numbers.');
  }

  /** Apply the Bulk edit form to every target phone. */
  function applyBulkEdit() {
    const ids = bulkTargets().map(row => row.id);
    if (!ids.length) return;
    const set = new Set(ids), model = bulkEditModel.trim();
    if (!model && !bulkEditPerson && !bulkEditChecked) { setToast('Choose something to change first.'); return; }
    const edited = records.map(record => !set.has(record.id) ? record : {
      ...record,
      ...(model ? { model } : {}),
      ...(bulkEditChecked ? { cropNeedsReview: false, serialNeedsReview: false, deviceCount: undefined, deviceImeis: undefined } : {})
    });
    if (bulkEditPerson) moveRecords(ids, ownerOf(bulkEditPerson), edited);
    else { setRecords(markDuplicateRecords(edited)); setToast(`Updated ${ids.length} phone${ids.length === 1 ? '' : 's'}.`); }
    setBulkEditOpen(false); setBulkEditModel(''); setBulkEditPerson(''); setBulkEditChecked(false);
  }

  const simpleChooseRef = useRef<HTMLInputElement>(null);
  /** Open the in-app camera (it also offers the phone's own camera app as "Phone camera"). */
  function openNativeCamera() {
    if (busy || !inventoryLoaded) return;
    setCameraOpen(true);
  }

  /** Select value "unassigned" means no person (an empty string cannot be a select option next to the placeholder). */
  function ownerOf(value: string) { return value === 'unassigned' ? UNASSIGNED : value; }
  function personNameOf(id: string) { const person = personGroups.find(item => item.id === id); return id === UNASSIGNED ? 'Unassigned' : person ? personName(person) : 'that person'; }

  /**
   * Move phones to a person (or to Unassigned). The previous owner loses them automatically,
   * Everyone keeps listing each phone once, and a phone is never moved when the destination
   * already holds the same IMEI (so a move cannot create a duplicate).
   */
  function moveRecords(ids: string[], destination: string, base: RecordItem[] = records) {
    const plan = planMove(base, ids, destination);
    setRecords(plan.records);
    setSelectedIds(old => old.filter(id => !plan.moved.includes(id)));
    setEmptiedPeople(old => [...old.filter(id => id !== destination), ...plan.emptiedSources.filter(id => !old.includes(id))]);
    const to = personNameOf(destination), parts: string[] = [];
    if (plan.moved.length) parts.push(`Moved ${plan.moved.length} IMEI${plan.moved.length === 1 ? '' : 's'} to ${to}.`);
    if (plan.blocked.length) parts.push(`${plan.blocked.length} stayed where ${plan.blocked.length === 1 ? 'it is' : 'they are'} because ${to} already has the same IMEI.`);
    if (!plan.moved.length && !plan.blocked.length) parts.push(plan.alreadyThere.length ? `Already under ${to}.` : 'Nothing to move.');
    if (plan.emptiedSources.length) parts.push('All IMEIs moved.');
    setToast(parts.join(' '));
    return plan;
  }

  function moveSelected(value: string) {
    if (!selectedIds.length) return;
    moveRecords(selectedIds, ownerOf(value));
  }

  /** One-tap export: the ticked phones, or every phone when none are ticked. Excel + pictures. */
  function exportSimple() {
    const rows = selectedRows.length ? selectedRows : records;
    if (!rows.length) { setToast('There are no phones to export.'); return; }
    setPhotoDownloads([]);
    if (!androidBridge?.beginFolder) {
      // The browser folder picker must open straight from the tap, before any await.
      const picker = (window as any).showDirectoryPicker;
      let folderChoice: Promise<any> | undefined;
      try { folderChoice = typeof picker === 'function' ? picker.call(window, { mode: 'readwrite', id: 'imei-pictures' }) : undefined; } catch { folderChoice = undefined; }
      void performExport(rows, undefined, folderChoice);
      return;
    }
    void performExport(rows);
  }

  /** Delete a person. Keeping their phones (moved to Unassigned) can be undone; deleting the phones too cannot. */
  function deletePerson(id: string, deletePhones: boolean) {
    const person = personGroups.find(item => item.id === id);
    if (!person || personGroups.length < 2) { setDeletePersonId(''); return; }
    const title = personName(person);
    const plan = planDeletePerson(records, id, deletePhones);
    const remaining = personGroups.filter(item => item.id !== id);
    setPersonUndo(deletePhones ? null : { people: personGroups, records, text: `${title} deleted.`, activePersonId });
    if (deletePhones) removeRecords(plan.affected);
    else { setRecords(plan.records); setSelectedIds(old => old.filter(item => !plan.affected.includes(item))); }
    setPersonGroups(remaining);
    if (activePersonId === id) setActivePersonId(remaining[0].id);
    if (personFilter === id) setPersonFilter('All');
    if (editingPersonId === id) setEditingPersonId('');
    setEmptiedPeople(old => old.filter(item => item !== id));
    setDeletePersonId('');
    const phones = plan.affected.length;
    setToast(deletePhones
      ? `${title} and ${phones} phone${phones === 1 ? '' : 's'} deleted.`
      : `${title} deleted.${phones ? ` ${phones} phone${phones === 1 ? '' : 's'} moved to Unassigned.` : ''}`);
  }
  function undoDeletePerson() {
    if (!personUndo) return;
    setPersonGroups(personUndo.people);
    setRecords(personUndo.records);
    setActivePersonId(personUndo.activePersonId);
    setPersonUndo(null);
    setToast('Person restored.');
  }

  function renamePerson(id: string, name: string) {
    setPersonGroups(old => old.map(person => person.id === id ? { ...person, name } : person));
  }

  function assignPerson(recordId: string, value: string) {
    return moveRecords([recordId], ownerOf(value));
  }

  function toggleSelected(id: string) {
    setSelectedIds(old => old.includes(id)
      ? old.filter(item => item !== id)
      : [...old, id]
    );
  }

  function toggleVisibleSelection() {
    const visibleIds = visible.map(r => r.id);
    setSelectedIds(old => allVisibleSelected
      ? old.filter(id => !visibleIds.includes(id))
      : [...new Set([...old, ...visibleIds])]
    );
  }

  function addFiles(list: FileList | null) {
    if (!list) return;

    const accepted = Array.from(list).filter(isImageFile);

    setFiles(old => [...old, ...accepted]);

    if (accepted.length !== list.length) {
      setToast('Only image files were added.');
    }
  }

  async function laptopRequest(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${laptopKey.trim()}`);
    const response = await fetch(`${laptopUrl.trim().replace(/\/$/, '')}${path}`, { ...options, headers });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Laptop scanner returned ${response.status}.`);
    }
    return response;
  }

  async function startLaptopScan() {
    if (!files.length || busy || laptopUploading || laptopJobId) return;
    if (!laptopKey.trim()) { setLaptopMessage(hostedScanner ? 'Enter the scanner access code you set in your hosting account.' : 'Enter the access code from server-data/access-code.txt on your laptop.'); return; }
    if (files.length > 500) { setLaptopMessage('Choose up to 500 photos per background scan.'); return; }
    setLaptopUploading(true);
    setLaptopMessage('Connecting to the laptop scanner…');
    const controller = new AbortController();
    laptopUploadController.current = controller;
    laptopUploadJobId.current = '';
    try {
      const uploadFiles = await uniqueUploadPhotos(files);
      if (controller.signal.aborted) throw new DOMException('Upload stopped', 'AbortError');
      const skipped = files.length - uploadFiles.length;
      const created = await laptopRequest('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: uploadFiles.length, mode: scanMode, personId: activePersonId }), signal: controller.signal
      });
      const { job } = await created.json();
      laptopUploadJobId.current = job.id;
      for (let index = 0; index < uploadFiles.length; index++) {
        if (controller.signal.aborted) throw new DOMException('Upload stopped', 'AbortError');
        setLaptopMessage(`Uploading ${index + 1} of ${uploadFiles.length}: ${uploadFiles[index].name}. Keep this page open until upload finishes.`);
        await laptopRequest(`/api/jobs/${job.id}/photos/${index}`, {
          method: 'PUT', headers: { 'Content-Type': uploadFiles[index].type, 'X-File-Name': encodeURIComponent(uploadFiles[index].name) },
          body: uploadFiles[index], signal: controller.signal
        });
      }
      if (controller.signal.aborted) throw new DOMException('Upload stopped', 'AbortError');
      await laptopRequest(`/api/jobs/${job.id}/start`, { method: 'POST', signal: controller.signal });
      setLaptopJobId(job.id);
      setLaptopJob({ status: 'queued', count: uploadFiles.length, completed: 0, resultCount: 0, failed: 0 });
      setLaptopMessage(`Upload finished.${skipped ? ` Skipped ${skipped} repeated photo(s).` : ''} You can close the app now; the ${scannerLocation} will keep scanning.`);
      setFiles([]);
    } catch (error) {
      if (controller.signal.aborted) {
        if (laptopUploadJobId.current) {
          try { await laptopRequest(`/api/jobs/${laptopUploadJobId.current}/stop`, { method: 'POST' }); }
          catch (stopError) { console.error('Could not stop incomplete upload', stopError); }
        }
        setLaptopMessage('Upload stopped. Photos remain in the queue.');
      } else {
        console.error('Laptop scan upload failed', error);
        setLaptopMessage(error instanceof Error ? `Laptop scan could not start: ${error.message}` : 'Laptop scan could not start.');
      }
    } finally { laptopUploadController.current = null; laptopUploadJobId.current = ''; setLaptopUploading(false); }
  }

  function stopCurrentUpload() {
    if (laptopUploading) { laptopUploadController.current?.abort(); setLaptopMessage('Stopping upload…'); }
    if (busy) { stopScanRequested.current = true; setStoppingScan(true); setProgress('Stopping after the current photo…'); }
  }

  async function stopLaptopScan() {
    if (!laptopJobId) return;
    setLaptopMessage('Stopping the background scan…');
    try {
      const response = await laptopRequest(`/api/jobs/${laptopJobId}/stop`, { method: 'POST' });
      const { job } = await response.json();
      setLaptopJob(job);
      setLaptopMessage('Scan stopped. Finished photos will still appear in Scanned records.');
    } catch (error) {
      setLaptopMessage(error instanceof Error ? `Could not stop the scan: ${error.message}` : 'Could not stop the scan.');
    }
  }

  useEffect(() => {
    if (!laptopJobId || !laptopKey.trim() || !inventoryLoaded) return;
    let cancelled = false;
    async function poll() {
      if (importingLaptop.current || cancelled) return;
      try {
        const response = await laptopRequest(`/api/jobs/${laptopJobId}`);
        const { job } = await response.json();
        if (cancelled) return;
        setLaptopJob(job);
        if (job.status !== 'completed' && job.status !== 'stopped') return;
        importingLaptop.current = true;
        setLaptopMessage(`Scan finished. Importing ${job.resultCount} record(s) into this browser…`);
        const results = await laptopRequest(`/api/jobs/${laptopJobId}/records`);
        const { records: scanned } = await results.json() as { records: LaptopRecord[] };
        const imported: RecordItem[] = [];
        const sourceCounts = new Map<string, number>();
        for (const item of scanned) sourceCounts.set(item.sourcePictureId || '', (sourceCounts.get(item.sourcePictureId || '') || 0) + 1);
        for (const item of scanned) {
          if (cancelled) return;
          const photoResponse = await laptopRequest(`/api/jobs/${laptopJobId}/images/${item.imageName}`);
          const photo = await blobDataUrl(await photoResponse.blob());
          const { imageName, photoIndex, ...record } = item;
          imported.push({ ...record, uploadBatchId: job.id, dataUrl: photo, cropDataUrl: (sourceCounts.get(item.sourcePictureId || '') || 0) > 1 ? photo : undefined });
          if (imported.length % 20 === 0) setLaptopMessage(`Importing ${imported.length} of ${scanned.length} completed records…`);
        }
        if (cancelled) return;
        setRecords(old => {
          const seenIds = new Set(old.map(row => row.id));
          const seenImeis = new Set(old.filter(row => row.uploadBatchId === job.id).map(row => row.imei).filter(imei => /^\d{15}$/.test(imei)));
          let nextNumber = old.reduce((highest, row) => Math.max(highest, row.number), 2) + 1;
          const added = imported.filter(row => {
            if (seenIds.has(row.id)) return false;
            seenIds.add(row.id);
            if (/^\d{15}$/.test(row.imei)) {
              if (seenImeis.has(row.imei)) return false;
              seenImeis.add(row.imei);
            }
            row.number = nextNumber++;
            return true;
          });
          return added.length ? markDuplicateRecords([...old, ...added]) : old;
        });
        setLaptopMessage(`${job.status === 'stopped' ? 'Scan stopped.' : 'Scan finished.'} Imported ${imported.length} record(s). ${job.failed ? `${job.failed} photo(s) could not be read.` : ''}`);
        setLaptopJobId('');
      } catch (error) {
        if (!cancelled) setLaptopMessage(error instanceof Error ? `Waiting for laptop scanner: ${error.message}` : 'Waiting for laptop scanner to reconnect.');
      } finally { importingLaptop.current = false; }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [laptopJobId, laptopKey, laptopUrl, inventoryLoaded]);

  async function scan(capturedFiles?: File[]) {
    const inputFiles = capturedFiles || files;
    if (!inputFiles.length || busy || !inventoryLoaded) return;

    setBusy(true);
    stopScanRequested.current = false;
    setStoppingScan(false);
    setCompletedFiles(0);
    const startedAt = performance.now();

    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    // A second reading worker lets the crops of one photo be read in parallel.
    let helper: Awaited<ReturnType<typeof createWorker>> | null = null;

    try {
      const scanFiles = await uniqueUploadPhotos(inputFiles);
      if (stopScanRequested.current) { if(capturedFiles)setFiles(old=>[...old,...capturedFiles]);setToast('Scan stopped. Photos remain in the queue.'); return; }
      const skippedPhotos = inputFiles.length - scanFiles.length;
      const uploadBatchId = newId();
      worker = await newOcrWorker();

      let newRows: RecordItem[] = [];
      let addedCount = 0;
      let needsReviewCount = 0;
      let failedFiles = 0;
      let lastFailure = '';
      let skippedImeis = 0;
      let shortPhotos = 0;
      let skippedSerials = 0;
      const seenSerials = new Set<string>();
      const seenImeis = new Set<string>();
      let processedFiles = 0;
      let nextNumber = records.reduce((max, record) => Math.max(max, record.number), 2) + 1;

      for (let i = 0; i < scanFiles.length; i++) {
        if (stopScanRequested.current) break;
        let file = scanFiles[i];
        const beforeCount = newRows.length;
        const fileImeis = new Set<string>();
        const fileSerials = new Set<string>();

        setProgress(
          `Scanning ${i + 1} of ${scanFiles.length}: ${file.name}`
        );
        try {

        const scanSize = scanMode === 'fast' ? 1600 : scanMode === 'detailed' ? 3000 : 2400;
        let { color, enhanced: ocrImage } = await createScanImages(file, scanSize);
        let dataUrl = color.toDataURL('image/jpeg', 0.9);
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          user_defined_dpi: '300'
        });

        // A photo with very few bright pixels is probably dark labels with light text: start
        // with the inverted picture. If that reads nothing label-like, fall back to the normal one.
        let enhancedResult: Awaited<ReturnType<typeof worker.recognize>> | undefined;
        let triedInverted = false, invertedRead = false;
        if (scanMode !== 'fast' && brightShare(color) < 0.18) {
          triedInverted = true;
          const flipped = invertCanvas(ocrImage);
          const flippedResult = await worker.recognize(flipped);
          if (labelTextScore(flippedResult.data.text || '') >= 2) { enhancedResult = flippedResult; ocrImage = flipped; invertedRead = true; }
        }
        enhancedResult ||= await worker.recognize(ocrImage);
        // Light text on a dark label reads as noise. If the first read found little, read the
        // inverted picture and keep it when it is clearly better (this replaces a wasted pass).
        if (scanMode !== 'fast' && !triedInverted && labelTextScore(enhancedResult.data.text || '') < 2) {
          const flipped = invertCanvas(ocrImage);
          const flippedResult = await worker.recognize(flipped);
          if (labelTextScore(flippedResult.data.text || '') > labelTextScore(enhancedResult.data.text || '')) { enhancedResult = flippedResult; ocrImage = flipped; invertedRead = true; }
        }
        // Nothing label-like read: the photo may be upside down, sideways or mirrored. Read a
        // smaller copy each way and, if one clearly reads as a label, scan that copy instead.
        const currentScore = labelTextScore(enhancedResult.data.text || '');
        if (scanMode !== 'fast' && needsOrientationCheck(currentScore)) {
          setProgress(`Checking photo orientation: ${file.name}`);
          let best: { score: number; file?: File } = { score: 0 };
          for (const turn of ORIENTATIONS) {
            const turned = await turnFile(file, turn);
            const probe = await createScanImages(turned, 1200);
            const score = labelTextScore((await worker.recognize(probe.enhanced)).data.text || '');
            if (score > best.score) best = { score, file: turned };
            if (score >= 4) break;
          }
          if (best.file && shouldTurn(currentScore, best.score)) {
            file = best.file;
            ({ color, enhanced: ocrImage } = await createScanImages(file, scanSize));
            dataUrl = color.toDataURL('image/jpeg', 0.9);
            enhancedResult = await worker.recognize(ocrImage);
          }
        }
        // A tilted photo makes the products hard to separate: level the whole picture first (about 2.5° or more).
        if (scanMode !== 'fast' && !invertedRead) {
          try {
            const tilt = skewOfCanvas(color);
            if (Math.abs(tilt.angle) >= 2.5 && tilt.gain >= 1.08) {
              const levelled = straightenCanvas(color, tilt.angle);
              const blob = await new Promise<Blob | null>(resolve => levelled.toBlob(resolve, 'image/jpeg', 0.92));
              if (blob) {
                file = new File([blob], file.name, { type: 'image/jpeg' });
                ({ color, enhanced: ocrImage } = await createScanImages(file, scanSize));
                dataUrl = color.toDataURL('image/jpeg', 0.9);
                enhancedResult = await worker.recognize(ocrImage);
              }
            }
          } catch (error) { console.warn('Could not level the photo', error); }
        }
        let raw = enhancedResult.data.text || '';
        let imeis = extractImei1s(raw);
        let lines = scaleOcrLines(ocrLines(enhancedResult.data), ocrImage, color);
        const sourceWidth = color.width;
        const sourceHeight = color.height;

        if (!invertedRead && (scanMode === 'detailed' || (scanMode === 'standard' && (imeis.length === 0 || (imeis.length === 1 && !luhnValid(imeis[0])))))) {
          const originalResult = await worker.recognize(color);
          const originalText = originalResult.data.text || '';
          const originalImeis = extractImei1s(originalText);
          if (originalImeis.length > imeis.length || (!imeis.length && originalText)) {
            raw = originalText;
            imeis = originalImeis;
            lines = ocrLines(originalResult.data);
          }
        }

        // Focus and deskew only when the first passes cannot identify a device.
        // Re-OCR the returned text on the original coordinates for split planning.
        if(!extractPreferredImei(raw)&&!extractSerial(raw)&&scanMode!=='fast'){
          const focused=await readSerialPhoto(worker,dataUrl,focusedLines=>{lines=focusedLines;});
          if(focused){raw += '\n'+focused;}
        }
        let fullPhotoCodes: PositionedBarcode[] = [];
        {
          fullPhotoCodes = await frameBarcodes(color);
          const barcodeLines = labelledBarcodeLines(fullPhotoCodes, lines);
          if (barcodeLines.length) { lines = [...lines, ...barcodeLines]; raw += '\n' + barcodeLines.map(line => line.text).join('\n'); }
        }
        // Fewer products found than there are (the user's number, the Model lines, the IMEI barcodes, or small labels): look closer.
        const closer = await lookCloser({ worker, file, color, lines, codes: fullPhotoCodes, raw, expectedProducts, fast: scanMode === 'fast', progress: setProgress });
        lines = closer.lines; fullPhotoCodes = closer.codes; raw = closer.raw; imeis = extractImei1s(raw);
        const fullRes = closer.fullRes, targetProducts = closer.targetProducts;        const mostlyWhite = looksMostlyWhite(color);
        const codesInside = (region?: { x: number; y: number; width: number; height: number }) => fullPhotoCodes.filter(code => { const b = code.boundingBox; if (!b) return false; if (!region) return true; const cx = b.x + b.width / 2, cy = b.y + b.height / 2; return cx >= region.x && cx <= region.x + region.width && cy >= region.y && cy <= region.y + region.height; }).map(code => code.rawValue);
        let anchors=deviceAnchors(lines,sourceWidth,sourceHeight);
        const multiText=hasMultipleDeviceText(raw);
        const frame=color.getContext('2d')?.getImageData(0,0,sourceWidth,sourceHeight);
        if(frame)anchors=deviceAnchors(lines,sourceWidth,sourceHeight,frame);
        let regions=planDeviceCrops(anchors,lines,sourceWidth,sourceHeight,frame);
        // The seam planner needs every box edge to be visible and one stacking direction. Grids, glare or unread IMEIs defeat it:
        // then cut by the label lines themselves (one "Model : SM-…" line per product), column by column.
        const seeds=labelSeeds(lines,sourceWidth);
        if(seeds.length>=2&&regions.length<seeds.length){const byText=seedCrops(lines,seeds,sourceWidth,sourceHeight,frame);if(byText.length===seeds.length)regions=byText;}
        if(localStorage.getItem('imei-lens-debug'))(window as unknown as {__dbg?: unknown}).__dbg={seeds:seeds.map(s=>[Math.round(s.x0),Math.round(s.y0),s.kind]),anchors:anchors.length,regions:regions.length,lines:lines.length,targetProducts,sourceWidth,sourceHeight,why:seedPlan(lines,seeds,sourceWidth,sourceHeight,frame).why};
        let croppedPhotos=new Map<string,string>();
        // Crops come from the full-resolution copy when there is one: a label cut from a shrunken copy reads worse.
        if(regions.length>1){try{croppedPhotos=await createCroppedPhotos(fullRes||color,regions,sourceWidth,sourceHeight);}catch(error){console.error('Unable to split labels',error);}}
        // Fewer products separated than the count says (the user's number, the Model lines or the IMEI barcodes): never save quietly.
        const shortHere = targetProducts > 1 && regions.length > 1 && regions.length < targetProducts;
        if (shortHere) shortPhotos++;
        const cropNeedsReview=(anchors.length>1&&regions.length<2)||(regions.length>1&&croppedPhotos.size!==regions.length)||(regions.length<2&&(multiText||targetProducts>1));
        const cropKeys=croppedPhotos.size?[...croppedPhotos.keys()]:[''];

        const pictureId = `PIC-${newId().slice(0, 8).toUpperCase()}`;
        // Read every device's crop. Two or more crops are read in parallel on two workers.
        const cropOrder = cropNeedsReview ? [''] : cropKeys;
        const readCrop = async (detectedImei: string, w: NonNullable<typeof worker>) => {
          const region = regions.find(item => item.imei === detectedImei);
          const cropDataUrl = croppedPhotos.get(detectedImei);
          const cropResult = cropDataUrl ? await readCropImei(w, cropDataUrl, scanMode) : { raw, imei: extractPreferredImei(raw), lines };
          let text = await cameraBarcodeText(cropDataUrl || dataUrl, cropResult.raw, cropResult.lines, codesInside(cropDataUrl ? region : undefined));
          if (scanMode !== 'fast' && !cropNeedsReview) text = await refineCropText(w, cropDataUrl || dataUrl, text, cropResult.lines);
          if (!cropNeedsReview && !extractPreferredImei(text) && !extractSerial(text)) { const serialRaw = await readSerialPhoto(w, cropDataUrl || dataUrl); if (serialRaw) text = serialRaw; }
          // Still no usable IMEI (blurry, tilted, dark, tiny print): try other image treatments before giving up.
          if (scanMode !== 'fast' && !cropNeedsReview && cropDataUrl && !extractPreferredImei(text)) {
            try { text = (await rereadIfUncertain(w, cropDataUrl, text, knownTacs)).raw; } catch (error) { console.warn('Extra reading passes skipped', error); }
          }
          return text;
        };
        const cropTexts = new Map<string, string>();
        if (cropOrder.length > 1 && scanMode !== 'fast' && (navigator.hardwareConcurrency || 2) >= 4 && !helper) { try { helper = await newOcrWorker(); } catch (error) { console.warn('Parallel reading unavailable', error); } }
        const readers = [worker, helper].filter((w): w is NonNullable<typeof worker> => !!w);
        await Promise.all(readers.map(async (w, slot) => { for (let k = slot; k < cropOrder.length; k += readers.length) cropTexts.set(cropOrder[k], await readCrop(cropOrder[k], w)); }));
        for (const detectedImei of cropOrder) {
        const region = regions.find(item => item.imei === detectedImei);
        const cropDataUrl = croppedPhotos.get(detectedImei);
        let cropRaw = cropTexts.get(detectedImei) || '';
        // Possibly several devices but only one IMEI 1 was read: keep it (the
        // record still asks "1 device or N?"). Several different IMEI 1s stay blank.
        const readableImei1s = [...new Set([barcodeImei(cropRaw, 1), ...extractImei1s(cropRaw).filter(luhnValid)].filter(Boolean))];
        let imei = cropNeedsReview ? (readableImei1s.length === 1 ? readableImei1s[0] : '') : extractPreferredImei(cropRaw);
        // Several passes may agree where no single pass was clean; a checksum repair is kept but flagged for a look.
        let repairedImei = false;
        if (!imei && !cropNeedsReview) { const verdict = judgeImei({ readings: imeiReadings(cropRaw), barcode: barcodeImei(cropRaw, 1), knownTacs }); if (verdict.imei) { imei = verdict.imei; repairedImei = verdict.method === 'repair'; } }
        if (/^\d{15}$/.test(imei)) {
          if (seenImeis.has(imei) || (file.name.startsWith('camera-') && records.some(record => record.imei === imei))) { skippedImeis++; continue; }
          seenImeis.add(imei);
          fileImeis.add(imei);
        }
        const serialChoice=serialReading(cropRaw);
        if(file.name.startsWith('camera-')&&!imei&&!cropNeedsReview&&serialChoice.serial&&!serialChoice.serialNeedsReview){
          if(seenSerials.has(serialChoice.serial)||records.some(row=>!row.imei&&recordSerial(row)===serialChoice.serial)){skippedSerials++;continue;}
          seenSerials.add(serialChoice.serial);fileSerials.add(serialChoice.serial);
        }
        const model = refineModel(identifyModel(cropRaw, file.name, mostlyWhite), [...records, ...newRows].map(row => row.model), readLearned()).model;
        newRows.push({
          id: newId(),
          pictureId: `PIC-${newId().slice(0, 8).toUpperCase()}`,
          sourcePictureId: pictureId,
          uploadBatchId,
          number: nextNumber++,
          personId: activePersonId,
          name: file.name,
          dataUrl,
          cropDataUrl,
          // Flag OCR that disagrees with itself about this IMEI, even if Luhn passes.
          // A crop whose IMEI is barcode-confirmed is trusted even if a box edge was unclear.
          cropNeedsReview: cropNeedsReview || repairedImei || shortHere || (!!region?.needsReview && barcodeImei(cropRaw, 1) !== imei) || imeiReadingsDisagree(cropRaw, imei) || (!!imei && unindexedImeis(cropRaw).some(other => luhnValid(other) && other !== imei)),
          imei2: pairedImei2(imei, recordImeiPair({ imei, raw: cropRaw } as RecordItem).imei2, model),
          ...(cropNeedsReview ? (() => { const found = extractImei1s(raw).filter(luhnValid); return { deviceCount: Math.max(2, anchors.length, found.length, targetProducts), deviceImeis: found }; })() : {}),
          model,
          ...serialReading(cropRaw),
          imei,
          status: imei
            ? (luhnValid(imei) ? 'Valid' : 'Invalid')
            : 'Review',
          duplicate: false,
          createdAt: new Date().toISOString(),
          raw: cropRaw
        });
        }
        const sourceRows = newRows.filter(row => row.sourcePictureId === pictureId);
        if (sourceRows.length) {
          const storedPhoto = await compactPhoto(dataUrl);
          for (const record of sourceRows) record.dataUrl = storedPhoto;
          await saveOriginalSource(pictureId, await shrinkOriginal(file));
        }
        if ((i + 1) % 20 === 0) {
          const completed = newRows;
          newRows = [];
          addedCount += completed.length;
          needsReviewCount += completed.filter(row => reviewStatus(row).includes('Needs review')).length;
          setRecords(old => markDuplicateRecords([...old, ...completed]));
        }
        } catch (error) {
          if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'UnknownError')) throw error;
          console.error(`Could not scan ${file.name}`, error);
          newRows = newRows.slice(0, beforeCount);
          for (const imei of fileImeis) seenImeis.delete(imei);
          for (const serial of fileSerials) seenSerials.delete(serial);
          failedFiles++;
          lastFailure = error instanceof Error ? error.message : String(error);
        }
        setCompletedFiles(i + 1);
        processedFiles = i + 1;
        if (i % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
      }

      await worker.terminate();
      worker = null;
      if (helper) { await helper.terminate(); helper = null; }

      addedCount += newRows.length;
      needsReviewCount += newRows.filter(row => row.status !== 'Valid' || row.cropNeedsReview).length;
      if (newRows.length) setRecords(old => markDuplicateRecords([...old, ...newRows]));
      if (!capturedFiles) setFiles(stopScanRequested.current ? scanFiles.slice(processedFiles) : []);
      else if (failedFiles) setFiles(old => [...old, ...capturedFiles]);
      else if (stopScanRequested.current) setFiles(old => [...old, ...scanFiles.slice(processedFiles)]);

      // Models the catalog does not know: ask to confirm their names (kept as your own models, even after catalog updates).
      const unknownModels = new Set(newRows.filter(row => infoOf(row).series === 'Unknown phones').map(row => modelCode4(row.model) || row.model)).size;
      const reviewMessage = (needsReviewCount
        ? ` ${needsReviewCount} need review; open a record to see the OCR text.`
        : '') + (unknownModels ? ` ${unknownModels} model${unknownModels === 1 ? ' is' : 's are'} not in the catalog: confirm the name in the Unknown tab.` : '');

      setToast(`${failedFiles ? `${failedFiles} photo(s) could not be read${lastFailure ? ` (${lastFailure.slice(0, 120)})` : ''}. ` : ''}${stopScanRequested.current ? 'Scan stopped.' : 'Finished scanning'} ${addedCount} record(s) in ${Math.round((performance.now() - startedAt) / 1000)} seconds.${skippedPhotos ? ` Removed ${skippedPhotos} repeated photo(s).` : ''}${shortPhotos ? ` ${shortPhotos} photo(s) showed fewer products than expected: check them or retake closer.` : ''}${skippedImeis ? ` Removed ${skippedImeis} repeated IMEI row(s).` : ''}${skippedSerials ? ` Removed ${skippedSerials} repeated serial row(s).` : ''}${reviewMessage}${failedFiles ? ` ${failedFiles} file(s) could not be read.` : ''}`);
    } catch (e) {
      console.error(e);
      if(capturedFiles)setFiles(old=>[...old,...capturedFiles]);
      setToast('Scanning failed. Captured photos stay in the upload queue for retry. Check your connection for OCR resources, or try Phone camera and a clearer label.');
    } finally {
      if (worker) await worker.terminate();
      if (helper) await helper.terminate();

      setBusy(false);
      setStoppingScan(false);
      setProgress('');
    }
  }

  function updateRow(id: string, patch: Partial<RecordItem>) {
    setRecords(old => {
      const changed = old.map(r =>
        r.id === id ? { ...r, ...patch } : r
      );

      return markDuplicateRecords(changed);
    });
  }

  type ReviewFields = { model: string; imei: string; imei2: string; serial: string };
  const currentFields = (): ReviewFields => ({ ...liveFields.current });
  const fieldsDiffer = (record: RecordItem, fields: ReviewFields) => fields.model !== exportModel(record.model) || fields.imei !== record.imei || fields.imei2 !== recordImeiPair(record).imei2 || fields.serial !== recordSerial(record);
  function setDrafts(next: Record<string, ReviewFields>) { draftsRef.current = next; setReviewDrafts(next); }
  /** Keep what was typed for this picture so you can move on and decide at the end. */
  function stashDraft() {
    if (!selected) return draftsRef.current;
    const next = { ...draftsRef.current };
    if (fieldsDiffer(selected, currentFields())) next[selected.id] = currentFields(); else delete next[selected.id];
    setDrafts(next);
    return next;
  }
  function goReview(direction: 1 | -1) {
    if (reviewIndex < 0 || rotatingPhoto) return;
    stashDraft();
    const next = reviewRecords[reviewIndex + direction];
    if (next) setSelected(next);
  }
  /** After the last picture, or when closing: ask what to do with unsaved changes. */
  function finishReview() {
    if (rotatingPhoto) return;
    if (Object.keys(stashDraft()).length) setFinishOpen(true); else closePhotoReviewNow();
  }
  function buildReviewPatch(record: RecordItem, fields: ReviewFields): { patch: Partial<RecordItem> } | { error: string } {
    if (fields.imei && !/^\d{15}$/.test(fields.imei)) return { error: 'Enter all 15 IMEI digits or leave it empty.' };
    if (fields.imei2 && !/^\d{15}$/.test(fields.imei2)) return { error: 'Enter all 15 IMEI 2 digits or leave it empty.' };
    const imeiChanged = fields.imei !== record.imei;
    const duplicate = imeiTakenElsewhere(fields.imei, record.id, records);
    return { patch: { imei2: fields.imei2, serial: fields.serial.trim(), serialNeedsReview: false, model: fields.model.trim() || 'Unknown unit — review', imei: fields.imei, duplicate, status: fields.imei ? (luhnValid(fields.imei) ? 'Valid' : 'Invalid') : 'Review', ...(imeiChanged && fields.imei ? { cropNeedsReview: false } : {}) } };
  }
  function saveReviewFields(advance = false) {
    if (!selected || rotatingPhoto) return;
    const built = buildReviewPatch(selected, currentFields());
    if ('error' in built) { setWarning(built.error); return; }
    const { patch } = built;
    if (patch.model && patch.model !== selected.model) writeLearned(learnCorrection(readLearned(), selected.model, patch.model));
    updateRow(selected.id, patch);
    const { [selected.id]: _saved, ...rest } = draftsRef.current;
    setDrafts(rest);
    if (advance && reviewIndex >= 0 && reviewIndex < reviewRecords.length - 1) {
      setSelected(reviewRecords[reviewIndex + 1]);
      document.getElementById('manual-model')?.focus();
    } else {
      setSelected({ ...selected, ...patch });
      setManualModel(exportModel(patch.model || ''));
    }
    if (patch.duplicate) setWarning('This IMEI is already in your records. It was saved and flagged as a duplicate; both pictures are kept. Use Remove duplicates to keep one.');
    else if (patch.status === 'Invalid') setWarning('Saved, but the IMEI checksum is not valid. Check the digits against the label.');
    else setToast('Saved.');
  }
  function saveAllDrafts() {
    const patches: Record<string, Partial<RecordItem>> = {};
    for (const [id, fields] of Object.entries(draftsRef.current)) {
      const record = records.find(row => row.id === id);
      if (!record) continue;
      const built = buildReviewPatch(record, fields);
      if ('error' in built) { setFinishOpen(false); setSelected(record); setWarning(`${record.name}: ${built.error}`); return; }
      patches[id] = built.patch;
    }
    setRecords(old => markDuplicateRecords(old.map(row => patches[row.id] ? { ...row, ...patches[row.id] } : row)));
    setDrafts({}); setFinishOpen(false); closePhotoReviewNow();
    const count = Object.keys(patches).length;
    setToast(`Saved ${count} picture${count === 1 ? '' : 's'}.`);
  }
  function discardAllDrafts() {
    setDrafts({}); setFinishOpen(false); closePhotoReviewNow();
    setToast('Changes discarded.');
  }
  const pendingChanges = Object.keys(reviewDrafts).filter(id => id !== selected?.id).length + (selected && fieldsDiffer(selected, currentFields()) ? 1 : 0);

  /** Level the picture (and its crop) when the text runs at a slant. */
  async function straightenSelectedPhoto() {
    if (!selected || rotatingPhoto) return;
    setRotatingPhoto(true);
    try {
      const [whole, crop] = await Promise.all([
        straightenDataUrl(reviewSource || selected.dataUrl, 0.95),
        selected.cropDataUrl ? straightenDataUrl(selected.cropDataUrl, 0.95) : Promise.resolve(undefined)
      ]);
      if (!whole.angle && !crop?.angle) { setToast('This picture already looks level.'); return; }
      const patch = { dataUrl: whole.dataUrl, cropDataUrl: crop?.dataUrl, originalDataUrl: whole.dataUrl, focus: undefined };
      setRecords(old => old.map(r => r.id === selected.id ? { ...r, ...patch } : r));
      setSelected({ ...selected, ...patch });
      setReviewSource(whole.dataUrl);
      setToast(`Straightened by about ${Math.abs(Math.round(crop?.angle || whole.angle))}°.`);
    } catch (error) {
      console.error(error);
      setToast('Could not straighten the photo.');
    } finally { setRotatingPhoto(false); }
  }
  async function rotateSelectedPhoto(direction: 'left' | 'right') {
    if (!selected || rotatingPhoto) return;
    setRotatingPhoto(true);
    try {
      const [dataUrl, cropDataUrl] = await Promise.all([
        rotatePhoto(reviewSource || selected.dataUrl, direction),
        selected.cropDataUrl ? rotatePhoto(selected.cropDataUrl, direction) : Promise.resolve(undefined)
      ]);
      const patch = { dataUrl, cropDataUrl, originalDataUrl: dataUrl, focus: undefined };
      setRecords(old => old.map(r => r.id === selected.id ? { ...r, ...patch } : r));
      setSelected({ ...selected, ...patch });
      setReviewSource(dataUrl);
      setToast('Photo rotated. Adjust the crop and read the IMEI again if needed.');
    } catch (error) {
      console.error(error);
      setToast('Could not rotate the photo. Please try again.');
    } finally { setRotatingPhoto(false); }
  }

  /** Answer to "1 device or N?": keep one record and use the first readable IMEI 1. */
  function confirmSingleDevice() {
    if (!selected) return;
    const imei = selected.imei || selected.deviceImeis?.[0] || '';
    updateRow(selected.id, { cropNeedsReview: false, deviceCount: undefined, deviceImeis: undefined, imei, status: imei ? (luhnValid(imei) ? 'Valid' : 'Invalid') : 'Review' });
    setManualImei(imei);
    setToast(imei ? 'Kept as one device.' : 'Kept as one device. Enter the IMEI or serial.');
  }

  /**
   * Photos the phone's own scanner could not separate (several products, one record) get the full web detection: the same
   * look-closer tiles, label-line segmentation and per-crop reading as camera shots. The original record is replaced only
   * when at least two crops were made and read; every crop that is not certain is flagged for review.
   */
  const autoSplitBusy = useRef(false);
  async function autoSplitRecords(targets: RecordItem[], announce = true): Promise<number> {
    if (autoSplitBusy.current || !targets.length) return 0;
    autoSplitBusy.current = true;
    let w: Awaited<ReturnType<typeof createWorker>> | null = null;
    const groups: CropGroup[] = [];
    try {
      w = await newOcrWorker();
      for (const [position, record] of targets.entries()) {
        if (announce) setToast(`Looking closer at photo ${position + 1} of ${targets.length}…`);
        const source = record.originalDataUrl || (androidBridge?.sourceImage ? androidBridge.sourceImage(record.id) : '') || record.dataUrl;
        if (!source) continue;
        try {
          const found = await autoDetectBoxes(w, source);
          if (found.boxes.length < 2) continue;
          const item: BulkItem = { id: record.id, name: record.name, source, deviceCount: record.deviceCount, model: record.model, single: false };
          const crops = await readBoxCrops(w, source, found.boxes, (raw, count) => modelForCrop(item, raw, count), undefined, knownTacs);
          if (crops.length >= 2) groups.push({ id: record.id, name: record.name, source, crops });
        } catch (error) { console.error(`Could not split ${record.name}`, error); }
      }
      if (groups.length) applyCropGroups(groups, false);
      else if (announce) setToast('Could not separate the products automatically. Open the photo and crop each one.');
      return groups.length;
    } finally { autoSplitBusy.current = false; if (w) await w.terminate(); }
  }
  const autoSplitTried = useRef<Set<string>>(new Set());
  // Background (phone) scans: photos it flagged as several products in one record get the web pipeline once, automatically.
  useEffect(() => {
    if (!androidBridge || androidJob?.status !== 'completed' || busy) return;
    const targets = records.filter(r => r.cropNeedsReview && (r.deviceCount || 0) > 1 && !autoSplitTried.current.has(r.id));
    if (!targets.length) return;
    for (const r of targets) autoSplitTried.current.add(r.id);
    void autoSplitRecords(targets.slice(0, 20));
  }, [androidJob?.status, records, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * Replace the cropped photos' records with one record per crop. The original photo is released
   * (its stored copy goes when nothing refers to it any more) and the crops keep the person of the original.
   */
  function applyCropGroups(groups: CropGroup[], fromReview: boolean, quiet = false) {
    let top = Math.max(2, ...records.map(r => r.number));
    const made = new Map<string, RecordItem[]>();
    const next = records.flatMap(r => {
      const done = groups.find(group => group.id === r.id);
      if (!done) return [r];
      const rows = splitRecords(r, done.crops, top + 1);
      top += rows.length - 1; made.set(r.id, rows);
      return rows;
    });
    const marked = markDuplicateRecords(next);
    setRecords(marked);
    setSelectedIds(old => old.filter(id => !made.has(id)));
    const count = [...made.values()].reduce((sum, rows) => sum + rows.length, 0);
    const unsure = marked.filter(row => [...made.values()].some(rows => rows.some(made_ => made_.id === row.id)) && reviewStatus(row).includes('Needs review')).length;
    if (fromReview) {
      setReviewIds(old => old.flatMap(id => made.has(id) ? made.get(id)!.map(row => row.id) : [id]));
      const firstId = [...made.values()][0]?.[0]?.id;
      setSelected(marked.find(row => row.id === firstId) || null);
    }
    if (quiet) refreshDraft(marked); else { setCropEditorOpen(false); setBulkCropOpen(false); setBulkDraft(null); refreshDraft(marked); }
    if (!quiet) setToast(`${count} picture${count === 1 ? '' : 's'} saved from ${made.size} photo${made.size === 1 ? '' : 's'}; the original${made.size === 1 ? '' : 's'} replaced.${unsure ? ` ${unsure} need${unsure === 1 ? 's' : ''} a look.` : ''}`);
  }
  function finishCropFlow() { setCropEditorOpen(false); setBulkCropOpen(false); setBulkDraft(null); bulkRowsRef.current = null; refreshDraft(); }

  // ---- Background crop queue -------------------------------------------------------------------------------------------
  // Photos are cut and read one at a time while the app stays usable. Each original is replaced only after its crops were
  // read; crops that are not certain are flagged. The queue is kept on the phone (record ids and boxes only) and offered for
  // resuming after the app was closed.
  const bulkRowsRef = useRef<RecordItem[] | null>(null);
  const [cropQueue, setCropQueue] = useState<QueueItem[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [queueStats, setQueueStats] = useState({ total: 0, done: 0, failed: 0, startedAt: 0, resumed: false });
  const queueBusy = useRef(false);
  const queueWorker = useRef<Promise<Awaited<ReturnType<typeof createWorker>>> | null>(null);
  const applyRef = useRef(applyCropGroups);
  applyRef.current = applyCropGroups;
  const changeQueue = (next: QueueItem[]) => { setCropQueue(next); writeQueue(localStorage, next); };
  function enqueueCrops(entries: StudioPlan[]) {
    const items = entries.map(entry => ({ recordId: entry.id, boxes: entry.boxes, auto: !entry.boxes.length }));
    clearDraft(localStorage); setPendingDraft(null);
    setQueueStats(old => ({ total: old.total + items.length, done: old.done, failed: old.failed, startedAt: old.startedAt || Date.now(), resumed: false }));
    setQueuePaused(false);
    changeQueue(mergeQueue(cropQueue, items));
    setToast(`${items.length} photo${items.length === 1 ? '' : 's'} added to the background queue.`);
  }
  // After a restart: offer to continue what was waiting.
  useEffect(() => {
    if (!inventoryLoaded) return;
    const waiting = readQueue(localStorage, new Set(records.map(row => row.id)));
    if (waiting.length) { setCropQueue(waiting); setQueuePaused(true); setQueueStats({ total: waiting.length, done: 0, failed: 0, startedAt: Date.now(), resumed: true }); }
  }, [inventoryLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (queuePaused || queueBusy.current || !cropQueue.length || !inventoryLoaded) return;
    const item = cropQueue[0];
    queueBusy.current = true;
    void (async () => {
      let failed = false;
      try {
        const record = records.find(row => row.id === item.recordId);
        if (!record) throw new Error('photo is gone');
        const source = record.originalDataUrl || (androidBridge?.sourceImage ? androidBridge.sourceImage(record.id) : '') || record.dataUrl;
        const w = await (queueWorker.current ||= newOcrWorker());
        let boxes = item.boxes;
        if (item.auto || !boxes.length) boxes = (await autoDetectBoxes(w, source)).boxes;
        if (!boxes.length) throw new Error('no label found');
        const entry: BulkItem = { id: record.id, name: record.name, source, deviceCount: record.deviceCount, model: record.model, single: boxes.length === 1 };
        const crops = await readBoxCrops(w, source, boxes, (raw, count) => modelForCrop(entry, raw, count), undefined, knownTacs);
        applyRef.current([{ id: record.id, name: record.name, source, crops }], false, true);
      } catch (error) { console.warn('Queued photo could not be cut', error); failed = true; }
      finally {
        queueBusy.current = false;
        setQueueStats(old => ({ ...old, done: old.done + (failed ? 0 : 1), failed: old.failed + (failed ? 1 : 0) }));
        setCropQueue(old => { const rest = old.filter(entry => entry.recordId !== item.recordId); writeQueue(localStorage, rest); return rest; });
      }
    })();
  }, [cropQueue, queuePaused, inventoryLoaded]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing left to read: release the reader's memory.
  useEffect(() => {
    if (cropQueue.length || queueBusy.current || !queueWorker.current) return;
    const old = queueWorker.current; queueWorker.current = null;
    void old.then(w => w.terminate()).catch(() => undefined);
  }, [cropQueue.length, queueStats.done, queueStats.failed]);
  useEffect(() => { if (!bulkCropOpen && !bulkDraft) bulkRowsRef.current = null; }, [bulkCropOpen, bulkDraft]);
  const queueFlagged = records.filter(row => row.cropNeedsReview && queueStats.startedAt && Date.parse(row.createdAt) >= queueStats.startedAt);
  const queueActive = cropQueue.length > 0;
  const queueFinished = !queueActive && queueStats.total > 0 && queueStats.done + queueStats.failed >= queueStats.total;
  function reviewQueueResults() { const ids = queueFlagged.map(row => row.id); if (!ids.length) return; setReviewIds(ids); setSelected(queueFlagged[0]); }
  function dismissQueue() { setQueueStats({ total: 0, done: 0, failed: 0, startedAt: 0, resumed: false }); }
  function cropFlowLater(boxes: number, photos: number) { finishCropFlow(); setToast(`Saved for later: ${boxes} box${boxes === 1 ? '' : 'es'} on ${photos} photo${photos === 1 ? '' : 's'}. Resume from the banner at the top.`); }
  const cropItem = (r: RecordItem): BulkItem => ({ id: r.id, name: r.name, source: r.originalDataUrl || r.dataUrl, deviceCount: r.deviceCount, model: r.model, single: !((r.deviceCount || 0) > 1) });

  async function performExport(rows: RecordItem[], token?: string, folderChoice?: Promise<any>) {
    if (!rows.length) {
      setToast(selectedOnly ? 'Select at least one scanned record first.' : 'There are no records to export.');
      return;
    }

    setSyncing(true);

    try {
      const photoLinks = new Map<string, string>();
      let folderLink = '';
      if (reportLayout === 'person_photo' && token) {
        setGoogleProgress('Creating a private photo folder…');
        const folder = await createPhotoFolder(token);
        folderLink = folder.link;
        for (let index = 0; index < rows.length; index++) {
          const record = rows[index];
          setGoogleProgress(`Saving private photo ${index + 1} of ${rows.length} to Drive…`);
          photoLinks.set(record.id, await uploadPhotoToDrive(record, token, folder.id));
        }
      }

      if (exportFormat === 'excel' && reportLayout === 'imei_photo') {
        setGoogleProgress('Building Excel with pictures…');
        const files = await createImeiPhotoFiles(rows);
        const folderName = exportFolderName();
        setGoogleProgress('Saving the Excel file and pictures…');
        const where = await saveFilesToFolder(files, folderName, folderChoice);
        const message = where === 'android-each' ? `Saved imei-pictures.xlsx and ${rows.length} picture(s) one by one. Update the Android app to save them as one folder in a single step.`
          : where === 'android' ? `Choose where to create the folder "${folderName}". The Excel file and ${rows.length} picture(s) will be saved inside it.`
          : where === 'picked' ? `Saved folder "${folderName}" with imei-pictures.xlsx and ${rows.length} picture(s). Open the Excel file and click Download picture on any row.`
          : `Downloaded imei-pictures.xlsx and ${rows.length} picture(s) into your Downloads folder. Keep them together, open the Excel file and click Download picture on any row.`;
        setDownloadStatus(message);
        setToast(where === 'android' ? 'Choose a folder to save into.' : `Excel + ${rows.length} picture(s) saved.`);
      } else if (exportFormat === 'excel') {
        setGoogleProgress('Building the Excel workbook…');
        const file = await createInventoryWorkbook(rows, photoLinks, includePhotos, personGroups, folderLink, compactExport, reportLayout);
        await downloadBlob(file, selectedOnly ? 'imei-scanner-selected.xlsx' : 'imei-scanner-export.xlsx');
        setDownloadStatus(androidBridge ? 'Choose a folder and tap Save to finish the Excel export.' : `Excel downloaded with ${rows.length} record(s)${includePhotos ? ' and embedded photos' : ''}.`);
        setToast(androidBridge ? 'Choose where to save the Excel file.' : `Excel downloaded with ${rows.length} record(s)${includePhotos ? ' and embedded photos' : ''}.`);
      } else if (exportFormat === 'word') {
        setGoogleProgress('Building the Word document…');
        const file = await createWordReport(rows, includePhotos, photoLinks, personGroups, reportLayout);
        await downloadBlob(file, selectedOnly ? 'imei-scanner-selected.docx' : 'imei-scanner-export.docx');
        setDownloadStatus(androidBridge ? 'Choose a folder and tap Save to finish the Word export.' : `Word document downloaded with ${rows.length} record(s).`);
        setToast(androidBridge ? 'Choose where to save the Word file.' : `Word document downloaded with ${rows.length} record(s).`);
      } else if (exportFormat === 'csv') {
        const file = new Blob(
          [recordsCsv(rows, photoLinks, personGroups, compactExport, reportLayout)],
          { type: 'text/csv;charset=utf-8' }
        );
        await downloadBlob(file, selectedOnly ? 'imei-scanner-selected.csv' : 'imei-scanner-export.csv');
        setDownloadStatus(androidBridge ? 'Choose a folder and tap Save to finish the CSV export.' : `CSV downloaded with ${rows.length} record(s).`);
        setToast(androidBridge ? 'Choose where to save the CSV file.' : `CSV downloaded with ${rows.length} record(s).`);
      } else {
        if (!token) throw new Error('Google authorization is required for Sheets export.');
        setGoogleProgress('Building the model and person tabs…');
        const workbook = await createInventoryWorkbook(rows, photoLinks, includePhotos, personGroups, folderLink, compactExport, reportLayout);
        const boundary = `imei-lens-${newId()}`;
        const metadata = JSON.stringify({
          name: `IMEI Scanner - ${new Date().toISOString().slice(0, 10)}`,
          mimeType: 'application/vnd.google-apps.spreadsheet'
        });
        const body = new Blob([
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
          metadata,
          `\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
          workbook,
          `\r\n--${boundary}--`
        ]);

        setGoogleProgress('Creating the Google Sheet…');
        const create = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/related; boundary=${boundary}`
            },
            body
          }
        );

        if (!create.ok) throw new Error(await create.text());
        const file = await create.json();
        const sheetUrl = file.webViewLink ||
          `https://docs.google.com/spreadsheets/d/${file.id}/edit`;
        window.open(sheetUrl, '_blank', 'noopener,noreferrer');
        setToast('Google Sheet created with model and person tabs.');
      }
    } catch (e) {
      console.error(e);
      const reason = e instanceof Error ? e.message : 'Unknown error';
      const message = `Could not export ${exportFormat.toUpperCase()}: ${reason}`;
      setDownloadStatus(message);
      setToast(message);
    } finally {
      setSyncing(false);
      setGoogleProgress('');
    }
  }

  async function exportPhotoPackage(rows: RecordItem[], folderChoice?: Promise<any>, folderFailed = false) {
    setSyncing(true);
    setGoogleProgress('Preparing spreadsheet and photos…');
    try {
      const parent = folderChoice ? await folderChoice : null;
      const folder = parent ? await parent.getDirectoryHandle(`IMEI-Lens-${Date.now()}`, { create: true }) : null;
      const photosFolder = folder ? await folder.getDirectoryHandle('photos', { create: true }) : null;
      const links = new Map<string, string>();
      for (const record of rows) {
        const name = photoFilename(record).replace(/^#/, 'photo-');
        const path = `photos/${name}`;
        if (photosFolder) {
          const photoFile = await photosFolder.getFileHandle(name, { create: true });
          const writer = await photoFile.createWritable();
          await writer.write(dataUrlBlob(recordPhoto(record)));
          await writer.close();
          links.set(record.id, path);
        }
      }


      let reportName: string;
      let report: Blob;
      if (exportFormat === 'word') {
        reportName = 'imei-records.docx';
        report = await createWordReport(rows, true, links, personGroups, reportLayout);
      } else if (exportFormat === 'csv') {
        reportName = 'imei-records.csv';
        report = new Blob([recordsCsv(rows, links, personGroups, false, reportLayout)], { type: 'text/csv;charset=utf-8' });
      } else {
        reportName = 'imei-records.xlsx';
        report = await createInventoryWorkbook(rows, links, true, personGroups, '', false, reportLayout);
      }

      if (folder) {
        for (const [name, content] of [[reportName, report], ['open-photos.html', new Blob([createPhotoGalleryHtml(rows, personGroups)], { type: 'text/html;charset=utf-8' })]] as [string, Blob][]) {
          const file = await folder.getFileHandle(name, { create: true });
          const writer = await file.createWritable();
          await writer.write(content);
          await writer.close();
        }
        setPhotoDownloads([]);
        setDownloadStatus('Saved the report and photos in a new folder. Open open-photos.html to view the pictures. Excel links depend on your spreadsheet app.');
      } else {
        await downloadBlob(report, reportName);
        setPhotoDownloads(rows);
        setDownloadStatus(androidBridge ? 'Choose a folder and tap Save to finish the report. Photo buttons appear below.' : folderFailed
          ? 'The browser could not use that folder. The report was downloaded; use the buttons below for each photo.'
          : 'Report downloaded. Use the photo buttons below to download each picture.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setDownloadStatus('Folder selection cancelled.');
        return;
      }
      console.error(error);
      if (folderChoice) {
        await exportPhotoPackage(rows, undefined, true);
        return;
      }
      const message = `Could not prepare the report: ${error instanceof Error ? error.message : 'Unknown error'}`;
      setDownloadStatus(message);
      setToast(message);
    } finally {
      setSyncing(false);
      setGoogleProgress('');
    }
  }

  /**
   * Bulk picture download: every selected record (or every visible one when none
   * is ticked) saved as numbered files <n>_<IMEI>.jpg in one folder, plus numbers.txt
   * with the same numbering. No ZIP. Call straight from a tap: the browser folder
   * picker must open before any await.
   */
  function bulkDownloadPictures() {
    const rows = selectedRows.length ? selectedRows : visible;
    if (!rows.length || bulkBusy) return;
    const picker = !androidBridge?.beginFolder ? (window as any).showDirectoryPicker : undefined;
    let folderChoice: Promise<any> | undefined;
    try { folderChoice = typeof picker === 'function' ? picker.call(window, { mode: 'readwrite', id: 'imei-pictures' }) : undefined; } catch { folderChoice = undefined; }
    setBulkBusy(true);
    void (async () => {
      try {
        const files: ExportFile[] = rows.map((row, index) => {
          const blob = dataUrlBlob(recordPhoto(row));
          const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
          return { name: `${index + 1}.${extension}`, blob };
        });
        const list = rows.map((row, index) => { const pair = recordImeiPair(row), serial = recordSerial(row); return `${[pair.imei1 && `IMEI 1 ${pair.imei1}`, pair.imei2 && `IMEI 2 ${pair.imei2}`, serial && `S/N ${serial}`].filter(Boolean).join('  ') || 'No number detected'}`; }).join('\r\n');
        files.push({ name: 'numbers.txt', blob: new Blob([list + '\r\n'], { type: 'text/plain;charset=utf-8' }) });
        const folderName = exportFolderName();
        const where = await saveFilesToFolder(files, folderName, folderChoice);
        setToast(where === 'android' ? 'Choose a folder to save into.' : where === 'picked' ? `Saved ${rows.length} pictures in folder "${folderName}".` : `Downloading ${rows.length} pictures into your Downloads folder. Allow multiple downloads if asked.`);
        setDownloadStatus(where === 'android' ? `Choose where to create the folder "${folderName}" with ${rows.length} numbered pictures and numbers.txt.` : where === 'picked' ? `Saved folder "${folderName}": ${rows.length} numbered pictures plus numbers.txt.` : `${rows.length} numbered pictures and numbers.txt downloaded into Downloads. Files are named 1.jpg, 2.jpg and so on.`);
      } catch (error) {
        setToast(error instanceof Error ? error.message : 'Could not download the pictures.');
      } finally { setBulkBusy(false); }
    })();
  }

  function exportChosen() {
    const rows = exportRows;
    if (!rows.length) {
      setDownloadStatus('No records are included. Change the filter or check records in the preview.');
      return;
    }
    setPhotoDownloads([]);

    if (reportLayout === 'person_photo' && exportFormat !== 'excel') {
      const picker = saveToFolder ? (window as any).showDirectoryPicker : undefined;
      let folderChoice: Promise<any> | undefined;
      try { folderChoice = picker ? picker.call(window, { mode: 'readwrite' }) : undefined; }
      catch { folderChoice = undefined; }
      setPhotoDownloads([]);
      void exportPhotoPackage(rows, folderChoice);
      return;
    }
    if (exportFormat === 'excel' && reportLayout === 'imei_photo' && !androidBridge?.beginFolder) {
      // The folder picker must open directly from the tap, before any await.
      const picker = (window as any).showDirectoryPicker;
      let folderChoice: Promise<any> | undefined;
      try { folderChoice = typeof picker === 'function' ? picker.call(window, { mode: 'readwrite', id: 'imei-pictures' }) : undefined; }
      catch { folderChoice = undefined; }
      void performExport(rows, undefined, folderChoice);
      return;
    }
    if (exportFormat === 'sheets') {
      setSyncing(true);
      void createInventoryWorkbook(rows, new Map(), includePhotos, personGroups, '', compactExport, reportLayout)
        .then(async file => {
          await downloadBlob(file, 'imei-records-for-google-sheets.xlsx');
          setDownloadStatus(androidBridge ? 'Choose a folder and tap Save. Then import the Excel file into Google Sheets.' : 'Excel file downloaded. In Google Sheets, choose File → Import → Upload.');
        })
        .catch(error => { console.error(error); setDownloadStatus(`Could not create the Google Sheets file: ${error instanceof Error ? error.message : 'Unknown error'}`); })
        .finally(() => setSyncing(false));
      return;
    }
    void performExport(rows);
  }

  // null = no picture link open; undefined = link opened but this browser has no such record.
  const linkedPicture: RecordItem | null | undefined = linkedPictureId === null || !inventoryLoaded ? null : records.find(row => row.pictureId === linkedPictureId);
  const shareRows=records.filter(row=>shareIds.includes(row.id));
  const currentShareRow=shareRows[Math.min(shareIndex,Math.max(0,shareRows.length-1))];
  const currentShareText=currentShareRow?shareNumberText({imei:currentShareRow.imei,serial:recordSerial(currentShareRow)},shareMode):'';
  function openSharing(ids:string[]){setShareIds(ids);setShareIndex(0);setShareStep('picture');setShareStatus('');setShareOneByOne(false);}
  const bulkShare=shareRows.length>1&&!shareOneByOne;
  const SHARE_BATCH=100000;
  const shareBatches=Array.from({length:Math.ceil(shareRows.length/SHARE_BATCH)},(_,i)=>shareRows.slice(i*SHARE_BATCH,(i+1)*SHARE_BATCH));
  /** One message with every number, numbered in the same order as the pictures. */
  const bulkShareText=shareRows.map((row,index)=>{
    const serial=recordSerial(row),line=shareMode==='imei_serial'?[row.imei,serial&&`S/N ${serial}`].filter(Boolean).join('  '):row.imei||(serial?`S/N ${serial}`:'');
    return `${line||'No number detected'}`;
  }).join('\n');
  function bulkPictureFiles(batch:RecordItem[]){
    return buildSharePackage(batch.map(row=>({number:row.number,pictureId:row.pictureId,model:'',imei:row.imei,serial:recordSerial(row),photo:recordPhoto(row)})),shareMode).entries.map((entry,index)=>new File([entry.file],`${shareRows.indexOf(batch[index])+1}.jpg`,{type:entry.file.type}));
  }
  function nativeShareBulk(kind:'pictures'|'text',batchIndex=0){
    if(sharing)return;
    try{
      if(androidBridge?.shareFolderText){
        if(kind==='text'){openWhatsApp(bulkShareText);return;}
        setSharing(true);
        const named=bulkPictureFiles(shareBatches[batchIndex]).map((file,index)=>new File([file],`${String(batchIndex*SHARE_BATCH+index+1).padStart(3,'0')}.jpg`,{type:file.type}));
        void androidShareFiles(named,'Phones','').then(()=>setShareStatus('Choose WhatsApp and the chat. Then share the numbers once (Step 2). Delivery is not confirmed.')).catch(error=>setShareStatus(error instanceof Error?error.message:'Could not open the share menu.')).finally(()=>setSharing(false));
        return;
      }
      let data:ShareData;
      if(kind==='pictures'){
        data={files:bulkPictureFiles(shareBatches[batchIndex])};
        if(!navigator.canShare?.(data)){setShareStatus('This browser cannot share several pictures at once. Use Download these pictures, then attach them in your chat.');return;}
      }else data={text:bulkShareText};
      if(!navigator.share){setShareStatus('Sharing is unavailable in this browser. Use Download or Copy.');return;}
      setSharing(true);
      void navigator.share(data).then(()=>setShareStatus(kind==='pictures'?`Pictures ${batchIndex*SHARE_BATCH+1}-${batchIndex*SHARE_BATCH+shareBatches[batchIndex].length} sent to the share menu. Check your chat, then share the next group or the numbers.`:'Numbers sent to the share menu. Check your chat.')).catch(error=>setShareStatus(error?.name==='AbortError'?'Share menu cancelled. Nothing is marked as sent.':'Could not open sharing. Use Download or Copy.')).finally(()=>setSharing(false));
    }catch(error){setShareStatus(error instanceof Error?error.message:'Could not prepare sharing.');}
  }
  async function downloadBulkPictures(batch:RecordItem[]){
    try{for(let start=0;start<batch.length;start+=SHARE_BATCH){for(const file of bulkPictureFiles(batch.slice(start,start+SHARE_BATCH))){saveDirectFile(file,file.name);await new Promise(resolve=>setTimeout(resolve,400));}}setShareStatus(`${batch.length} picture(s) downloaded. Attach them in your chat.`);}
    catch(error){setShareStatus(error instanceof Error?error.message:'Could not download the pictures.');}
  }
  function shareRecord(record:RecordItem){openSharing([record.id]);}
  function nativeShareStep(kind:'picture'|'text'){
    if(sharing||!currentShareRow)return;
    try{
      let data:ShareData;
      if(kind==='picture'){
        const {entries}=buildSharePackage([{number:currentShareRow.number,pictureId:currentShareRow.pictureId,model:'',imei:currentShareRow.imei,serial:recordSerial(currentShareRow),photo:recordPhoto(currentShareRow)}],shareMode);
        data={files:[entries[0].file]};
        if(!navigator.canShare?.(data)){setShareStatus('Picture sharing is unavailable in this browser. Download the picture, attach it in your chat, then continue to text.');return;}
      }else{if(!currentShareText)return;data={text:currentShareText};}
      if(!navigator.share){setShareStatus('Sharing is unavailable. Use Download picture and Copy text.');return;}
      setSharing(true);
      void navigator.share(data).then(()=>setShareStatus('Returned from the share menu. Check the same conversation before continuing; delivery is not confirmed.')).catch(error=>setShareStatus(error?.name==='AbortError'?'Share menu cancelled. Nothing is marked as sent.':'Could not open sharing. Use Download picture or Copy text.')).finally(()=>setSharing(false));
    }catch(error){setShareStatus(error instanceof Error?error.message:'Could not prepare sharing.');}
  }

  function saveDirectFile(blob: Blob, filename: string) {
    void downloadBlob(blob, filename).catch(error => {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Could not save this file.';
      setDownloadStatus(message);
      setToast(message);
    });
  }

  function deleteSelected() {
    requestDelete(selectedRows);
  }

  return (
    <div className={`app${!simpleView ? ' has-bottom-nav' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <div className="brandmark">
            <ScanLine size={22} />
          </div>
          <div>
            <strong>IMEI LENS</strong>
            <span>PHOTO SCANNER</span>
          </div>
        </div>

        <div className="top-actions">
          <div className="mode-toggle" role="group" aria-label="Interface mode">
            <button aria-pressed={simpleView} onClick={() => setSimpleView(true)}>Simple</button>
            <button aria-pressed={!simpleView} onClick={() => setSimpleView(false)}>Detailed</button>
          </div>
          <button type="button" className="settings-btn reset-all-btn" aria-label="Reset: delete all scanned IMEIs" title="Reset: delete all scanned IMEIs" onClick={() => setResetOpen(true)}><Trash2 size={18} /></button>
          <button type="button" className="settings-btn" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}><Settings size={18} /></button>
          <span className="local-pill">
            <span /> {storageWarning ? 'Some records not saved' : 'Stored on this device'}
          </span>
        </div>
      </header>

      {settingsOpen && <SettingsPanel onChangeCode={changeModelCode} scannedModels={records.map(row => row.model)} catalogEntries={catalogEntries} customModels={customModels} onModelsChange={setCustomModels} onCatalogChange={() => setCatalogEntries(readCatalogEntries())} onDownload={(blob, filename) => saveDirectFile(blob, filename)} onClose={() => setSettingsOpen(false)} />}
      {finishOpen && <div className="modal-backdrop finish-backdrop"><section className="modal finish-modal" role="alertdialog" aria-modal="true" aria-label="Save or discard changes">
        <h2>Save your changes?</h2>
        <p>You changed {Object.keys(reviewDrafts).length} picture{Object.keys(reviewDrafts).length === 1 ? '' : 's'} and did not save {Object.keys(reviewDrafts).length === 1 ? 'it' : 'them'} yet. Save everything, discard it, or go back and keep editing.</p>
        <div className="finish-actions">
          <button type="button" className="primary" onClick={saveAllDrafts}>Save all ({Object.keys(reviewDrafts).length})</button>
          <button type="button" className="subtle-btn danger" onClick={discardAllDrafts}>Discard changes</button>
          <button type="button" className="subtle-btn" autoFocus onClick={() => setFinishOpen(false)}>Keep editing</button>
        </div>
      </section></div>}
      {warning && <div className="modal-backdrop warning-backdrop"><section className="modal warning-popup" role="alertdialog" aria-modal="true" aria-label="Warning">
        <h2>Check this</h2>
        <p>{warning}</p>
        <button type="button" className="primary" autoFocus onClick={() => setWarning('')}>OK</button>
      </section></div>}
      {resetOpen && <div className="modal-backdrop"><section className="modal reset-modal" role="alertdialog" aria-modal="true" aria-label="Reset all scanned IMEIs">
        <h2>Delete all scanned IMEIs?</h2>
        <p>{records.length ? <>This permanently deletes {records.length} scanned record{records.length === 1 ? '' : 's'} and their photos from this device.</> : <>There are no scanned records on this screen. This also clears any scan results and photos the app still has saved.</>} Your people, model names and settings are kept. This cannot be undone, so export first if you still need them.</p>
        <div className="reset-actions">
          <button type="button" className="subtle-btn" autoFocus onClick={() => setResetOpen(false)}>Cancel</button>
          <button type="button" className="subtle-btn danger" onClick={resetEverything}>Delete everything</button>
        </div>
      </section></div>}
      {cameraOpen && <CameraCapture expectedProducts={expectedProducts} onClose={() => setCameraOpen(false)} onCapture={batch => void scan(batch)} />}
      <main className={`${collapsedPanels.length ? 'compact-page' : ''}${!simpleView ? ' nav-mode' : ''}`}>
        {(queueActive || queueFinished) && <div className="draft-banner queue-banner" role="status">
          {queueActive
            ? <span><strong>{queuePaused ? (queueStats.resumed ? 'Photos waiting from last time.' : 'Cropping paused.') : 'Cropping in the background.'}</strong> {queueStats.done + queueStats.failed} of {queueStats.total} done{queueStats.failed ? ` · ${queueStats.failed} left as they are (no separate products found)` : ''}. Each original is replaced after its crops are read.</span>
            : <span><strong>Background cropping finished.</strong> {queueStats.done} photo{queueStats.done === 1 ? '' : 's'} cut{queueStats.failed ? `, ${queueStats.failed} left as they are (no separate products found)` : ''}{queueFlagged.length ? ` · ${queueFlagged.length} to check` : ''}.</span>}
          <div>
            {queueActive && <button className="primary" onClick={() => setQueuePaused(value => !value)}>{queuePaused ? (queueStats.resumed ? 'Resume' : 'Continue') : 'Pause'}</button>}
            {queueActive && <button className="subtle-btn" onClick={() => { changeQueue([]); setQueuePaused(false); dismissQueue(); setToast('Background cropping cancelled. Photos already cut stay cut.'); }}>{queueStats.resumed ? 'Discard' : 'Cancel'}</button>}
            {queueFinished && !!queueFlagged.length && <button className="primary" onClick={reviewQueueResults}>Review {queueFlagged.length}</button>}
            {queueFinished && <button className="subtle-btn" onClick={dismissQueue}>Dismiss</button>}
          </div>
        </div>}
        {pendingDraft && !cropEditorOpen && !bulkCropOpen && !bulkDraft && (() => { const { photos, boxes } = draftSummary(pendingDraft); return <div className="draft-banner" role="status">
          <span><strong>Unfinished crop saved.</strong> {boxes} box{boxes === 1 ? '' : 'es'} on {photos} photo{photos === 1 ? '' : 's'} (saved {new Date(pendingDraft.savedAt).toLocaleString()}).</span>
          <div><button className="primary" onClick={() => setBulkDraft(pendingDraft)}>Resume</button><button className="subtle-btn" onClick={() => { clearDraft(localStorage); setPendingDraft(null); setToast('Saved crop boxes discarded.'); }}>Discard</button></div>
        </div>; })()}
        {storageWarning && <div className="storage-warning" role="alert">{storageWarning}</div>}
{!simpleView && mainView === 'scan' && (<>
        <section className="hero">
          <div>
            <div className="eyebrow">DEVICE INVENTORY TOOL</div>
            <h1>
              Turn phone photos into
              <br />
              <em>organized IMEI records.</em>
            </h1>
            <p>
              Upload device labels or box photos. Extract IMEI,
              identify models, review results and export your inventory.
            </p>
          </div>

          <div className="hero-icon">
            <Smartphone size={58} />
            <ScanLine size={30} />
          </div>
        </section>
</>)}

{!simpleView && mainView === 'results' && recordsTab === 'records' && (<>
        <section className="stats">
          <button type="button" className="stat stat-button" aria-label="Show all scanned records" onClick={() => jumpTo('records', 'All')}>
            <span>SCANNED RECORDS</span>
            <strong>{records.length}</strong>
            <small><ImageIcon size={13} /> Saved locally</small>
          </button>

          <button type="button" className="stat stat-button" aria-label="Show records with a valid IMEI" onClick={() => jumpTo('records', 'Valid')}>
            <span>VALID IMEI</span>
            <strong className="green">{validCount}</strong>
            <small><CheckCircle2 size={13} /> Luhn checksum passed</small>
          </button>

          <button type="button" className="stat stat-button" aria-label="Show records that need review" onClick={() => jumpTo('records', 'Review')}>
            <span>NEEDS REVIEW</span>
            <strong className="amber">{reviewCount}</strong>
            <small><AlertTriangle size={13} /> Check photo or IMEI</small>
          </button>

          <button type="button" className="stat stat-button" aria-label="Open the models tab" onClick={() => jumpTo('models')}>
            <span>MODELS</span>
            <strong>{models.filter(([model]) => !!exportModel(model)).length}</strong>
            <small><Smartphone size={13} /> Identified model groups</small>
          </button>
        </section>
</>)}

        <section className="workspace">
          <div id="upload" hidden={!simpleView && mainView !== 'scan'} className={`panel upload-panel ${collapsedPanels.includes('upload') ? 'is-collapsed' : ''}`}><button className="panel-toggle" aria-expanded={!collapsedPanels.includes('upload')} onClick={() => togglePanel('upload')}>{collapsedPanels.includes('upload') ? '▸' : '▾'} Upload photos {collapsedPanels.includes('upload') ? '— expand' : '— minimize'}</button>
            <div className="section-head">
              <div>
                <div className="eyebrow">STEP 01</div>
                <h2>Upload photos</h2>
              </div>
              <span className="tag">BULK UPLOAD</span>
            </div>

{!simpleView && (<>
            {androidBridge && <div className="android-scan">
              <strong>Scan on this phone in the background</strong>
              <p>Choose photos here. Android keeps scanning with a progress notification when you minimize or close this screen. Your photos and results stay on this phone.</p>
              <button type="button" className="primary" disabled={androidJob?.status === 'queued' || androidJob?.status === 'processing'} onClick={() => androidBridge.choosePhotos(activePersonId)}>
                <ScanLine size={17} /> Choose photos and scan
              </button>
              {androidJob && androidJob.status !== 'idle' && <div className="android-progress" role="status">
                {androidJob.completed} of {androidJob.count} photos scanned · {androidJob.status}{androidJob.failed ? ` · ${androidJob.failed} failed` : ''}
              </div>}
              {androidJob && (androidJob.status === 'queued' || androidJob.status === 'processing') && <button type="button" className="subtle-btn laptop-stop" onClick={() => androidBridge.stop()}>Stop scan</button>}
              {androidJob?.error && <p>{androidJob.error}</p>}
            </div>}

</>)}
{!simpleView && (<>
            <button className="subtle-btn" disabled={busy || !inventoryLoaded} onClick={openNativeCamera}>Scan with camera</button>

            {!androidBridge && <>
            <div
              className="dropzone"
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={e => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />

              <div className="upload-icon">
                <UploadCloud size={27} />
              </div>

              <strong>
                Drop photos here or <a>browse files</a>
              </strong>

              <span>JPG, PNG, WEBP, HEIC supported where browser decoding allows</span>
              <span className="micro">
                Multiple images · OCR runs in your browser
              </span>
            </div>
            </>}

            {files.length > 0 && (
              <div className="queue">
                <div className="queue-head">
                  <strong>{files.length} photo(s) ready</strong>
                  <button className="textbtn" onClick={() => setFiles([])}>
                    Clear queue
                  </button>
                </div>

                <div className="filelist">
                  {files.slice(0, queueDisplayCount).map((f, i) => (
                    <div className="fileitem" key={`${f.name}-${i}`}>
                      <ImageIcon size={15} />
                      <span>{f.name}</span>
                      <small>{(f.size / 1024 / 1024).toFixed(1)} MB</small>
                      <button
                        aria-label={`Remove ${f.name} from upload queue`}
                        onClick={() =>
                          setFiles(old => old.filter((_, j) => j !== i))
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {files.length > queueDisplayCount && <button className="textbtn" onClick={() => setQueueDisplayCount(count => count + 30)}>Show {Math.min(30, files.length - queueDisplayCount)} more photos</button>}
              </div>
            )}

            <label className="export-format-picker">
              <span>Scan speed</span>
              <select value={scanMode} disabled={busy} onChange={event => setScanMode(event.target.value as typeof scanMode)}>
                <option value="fast">Fast · large batches</option>
                <option value="standard">Standard · recommended</option>
                <option value="detailed">Detailed · multiple boxes or difficult labels</option>
              </select>
            </label>
            <label className="export-format-picker">
              <span>Products in each photo</span>
              <select value={expectedProducts} disabled={busy} onChange={event => setExpectedProducts(Number(event.target.value))}>
                <option value={0}>Auto · find them myself</option>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map(count => <option key={count} value={count}>{count} product{count === 1 ? '' : 's'}</option>)}
              </select>
            </label>
            {expectedProducts > 1 && <p className="scan-mode-note">If fewer than {expectedProducts} are found the first time, the app reads the photo again in enlarged pieces to find the rest, then straightens each crop. Photos that still cannot be split are marked for review.</p>}
            {androidBridge && <p className="scan-mode-note">{androidBridge.setScanOptions ? <>Both settings apply to <b>Scan with camera</b> and to <b>Choose photos and scan</b> (which keeps going in the background).</> : <>This installed app is older: the settings apply to <b>Scan with camera</b> only. Install the newest APK to use them for <b>Choose photos and scan</b> too.</>}</p>}
            <p className="scan-mode-note">
              {scanMode === 'fast' ? 'One OCR pass per photo. Review missed or unclear IMEIs manually.' :
                scanMode === 'standard' ? 'Runs another pass only when the first result needs it.' :
                  'Checks every photo twice and retries unclear crops. Best for photos with several labels.'}
            </p>

            {(!androidBridge || files.length > 0) && <button
              className="primary scan-button"
              disabled={!files.length || busy || laptopUploading || (useBackgroundByDefault && !!laptopJobId) || !inventoryLoaded}
              onClick={() => useBackgroundByDefault ? void startLaptopScan() : void scan()}
            >
              {busy || laptopUploading ? (
                <>
                  <LoaderCircle className="spin" size={17} />
                  {laptopUploading ? `Uploading photos to ${scannerLocation}…` : 'Scanning photos…'}
                </>
              ) : (
                <>
                  <ScanLine size={17} />
                  {useBackgroundByDefault ? `Scan ${files.length || 0} photo(s) in background` : `Extract IMEI from ${files.length || 0} photo(s)`}
                </>
              )}
            </button>}

</>)}
            {simpleView && <div className="simple-scan-buttons">
              <button type="button" className="primary big" disabled={busy || !inventoryLoaded} onClick={openNativeCamera}><Camera size={22} /> Take photo</button>
              <button type="button" className="primary big alt" disabled={busy || !inventoryLoaded || androidJob?.status === 'queued' || androidJob?.status === 'processing'} onClick={() => androidBridge ? androidBridge.choosePhotos(activePersonId) : simpleChooseRef.current?.click()}><UploadCloud size={22} /> Choose photos</button>
              {androidBridge && androidJob && androidJob.status !== 'idle' && <p className="android-progress" role="status">{androidJob.completed} of {androidJob.count} photos scanned · {androidJob.status}{androidJob.failed ? ` · ${androidJob.failed} failed` : ''}</p>}
              <input ref={simpleChooseRef} type="file" accept="image/*" multiple hidden onChange={event => { const chosen = Array.from(event.target.files || []), picked = chosen.filter(isImageFile); event.target.value = ''; if (chosen.length && picked.length < chosen.length) setToast(picked.length ? `${chosen.length - picked.length} file(s) were not photos and were skipped.` : 'Those files are not photos. Choose JPG, PNG, WEBP or HEIC pictures.'); if (picked.length) void scan(picked); }} />
            </div>}
            <button type="button" className="subtle-btn reset-entries" disabled={busy || laptopUploading} onClick={resetForNewEntries} title="Clears the upload queue, search, filters and selection so you can start new entries. Saved records are not deleted.">↺ Reset for new entries</button>
            {(busy || laptopUploading) && <button type="button" className="subtle-btn stop-upload-button" disabled={stoppingScan} onClick={stopCurrentUpload}>
              <X size={16} /> {laptopUploading ? 'Stop uploading' : stoppingScan ? 'Stopping after this photo…' : 'Stop scanning'}
            </button>}

            {busy && (
              <div className="progress">
                <div className="progressbar">
                  <i style={{ width: `${files.length ? completedFiles / files.length * 100 : 0}%` }} />
                </div>
                <span>{progress}</span>
              </div>
            )}

{!simpleView && (<>
            {!androidBridge && <details className="laptop-scan" open={useBackgroundByDefault}>
              <summary>{hostedScanner ? 'Keep scanning after closing the browser' : 'Advanced: scan on your laptop (needs the laptop scanner app)'}</summary>
              <p>{hostedScanner ? 'Wait for Upload finished; then you may minimize or close the phone app. The online scanner continues until completion or you press Stop. Reopen this address to see the results.' : 'On a phone, use the laptop address below while both devices are on the same private Wi-Fi. Wait for Upload finished; then you may minimize or close the phone app. Your laptop keeps scanning until completion or you press Stop. Reopen this same address on the phone to see the results.'}</p>
              {phoneAddresses.length > 0 && <div className="phone-addresses">Phone address on this Wi-Fi: {phoneAddresses.map(address => <span key={address}><a href={address}>{address}</a><button type="button" className="subtle-btn" onClick={() => void copyText(address).then(copied => setLaptopMessage(copied ? 'Phone address copied. Open it on your phone using the same Wi-Fi.' : 'Could not copy the phone address.'))}>Copy</button></span>)}</div>}
              {!hostedScanner && <label>Laptop scanner address
                <input type="url" value={laptopUrl} onChange={event => setLaptopUrl(event.target.value)} placeholder="http://127.0.0.1:8787" />
              </label>}
              <label>{hostedScanner ? 'Scanner access code' : 'Access code from server-data/access-code.txt'}
                <input type="password" value={laptopKey} onChange={event => setLaptopKey(event.target.value)} autoComplete="off" />
              </label>
              <button type="button" className="subtle-btn laptop-start" disabled={!files.length || busy || laptopUploading || !!laptopJobId || !inventoryLoaded} onClick={startLaptopScan}>
                {laptopUploading ? <LoaderCircle className="spin" size={16} /> : <CloudUpload size={16} />}
                {laptopUploading ? `Uploading to ${scannerLocation}…` : `Scan ${files.length} photo${files.length === 1 ? '' : 's'} on ${scannerLocation}`}
              </button>
              {laptopJobId && laptopJob && !['completed', 'stopped'].includes(laptopJob.status) && <button type="button" className="subtle-btn laptop-stop" onClick={() => void stopLaptopScan()}>Stop background scan</button>}
              {laptopJob && <div className="laptop-progress">Background scan: {laptopJob.completed} of {laptopJob.count} photos · {laptopJob.resultCount} record(s) · {laptopJob.status}</div>}
              {laptopMessage && <div className="laptop-progress" role="status">{laptopMessage}</div>}
            </details>}

            <div className="privacy-note">
              <CheckCircle2 size={15} />
              {androidBridge ? 'Android background scans and photos stay on this phone.' : hostedScanner ? 'Background scans and photos are saved on your online scanner.' : 'Browser scans stay in this browser. Background scans are saved on your laptop.'}
            </div>
</>)}
          </div>

{!simpleView && (<>
          <div id="export" hidden={!simpleView && mainView !== 'export'} className={`panel export-panel ${collapsedPanels.includes('export') ? 'is-collapsed' : ''}`}><button className="panel-toggle" aria-expanded={!collapsedPanels.includes('export')} onClick={() => togglePanel('export')}>{collapsedPanels.includes('export') ? '▸' : '▾'} Export inventory {collapsedPanels.includes('export') ? '— expand' : '— minimize'}</button>
            <div className="section-head">
              <div>
                <div className="eyebrow">STEP 02</div>
                <h2>Export inventory</h2>
              </div>
            <span className="tag">EXPORT OPTIONS</span>
            </div>

            <p className="muted">
              Choose the records and format to download. Import the Excel file into Google Sheets if needed.
            </p>

            <label className="auto-download-toggle">
              <input
                type="checkbox"
                checked={selectedOnly}
                disabled={!selectedRows.length && !selectedOnly}
                onChange={e => { setSelectedOnly(e.target.checked); setExportExcludedIds([]); setDownloadStatus(''); }}
              />
              <span>
                <b>Export selected records only ({selectedRows.length})</b>
                <small>Choose rows in Scanned records below.</small>
              </span>
            </label>

            <label className="export-format-picker">
              <span>Information to include</span>
              <select value={reportLayout} onChange={e => { setReportLayout(e.target.value as typeof reportLayout); setDownloadStatus(''); }}>
                <option value="imei_photo">IMEI + picture with download button (Excel)</option>
                <option value="simple">IMEI and model only</option>
                <option value="person_photo">IMEI, model, person and photos</option>
              </select>
            </label>
            {reportLayout === 'person_photo' && records.length > embedPhotoLimit() && <div className="wa-warning" role="note"><strong>{records.length} photos inside one file is a lot for this phone.</strong><p>Up to about {embedPhotoLimit()} fit comfortably (estimate from this phone's memory). For more, choose "IMEI and model only", or "IMEI + picture with download button" to save the pictures in a folder.</p></div>}
            {reportLayout === 'imei_photo' && (
              <div className="download-status">{exportFormat === 'excel'
                ? (androidBridge?.beginFolder || typeof (window as any).showDirectoryPicker === 'function'
                  ? 'Choose a folder: a new folder is created inside it with the Excel file (IMEI 1, IMEI 2, Serial, picture, Download picture button) and every picture. No ZIP.'
                  : 'The Excel file (IMEI 1, IMEI 2, Serial, picture, Download picture button) and every picture download into your Downloads folder together. Allow multiple downloads if the browser asks. No ZIP.')
                : exportFormat === 'word' ? 'Word: IMEI 1, IMEI 2, Serial and the picture. Download picture buttons are Excel only.' : 'IMEI 1, IMEI 2 and Serial only. Pictures with download buttons are Excel only.'}</div>
            )}
            {reportLayout === 'person_photo' && (
              <>
                <div className="download-status">{exportFormat === 'excel'
                  ? 'The Excel file includes each matching photo beside its IMEI. On desktop Excel, right-click a picture and choose Save as Picture. Excel on phones may not offer that action; for an individual file, open the record in Scanned records and tap Download photo.'
                  : 'Download the report and then use the photo buttons below to save each image. Google Sheets cannot open links to local photos.'}</div>
                {exportFormat !== 'excel' && typeof (window as any).showDirectoryPicker === 'function' && (
                  <label className="auto-download-toggle">
                    <input type="checkbox" checked={saveToFolder} onChange={e => setSaveToFolder(e.target.checked)} />
                    <span><b>Save report and photos to a folder</b><small>Choose an ordinary folder, such as one you created inside Documents.</small></span>
                  </label>
                )}
              </>
            )}

            <label className="export-format-picker">
              <span>Records to export</span>
              <select value={imeiFilter} onChange={e => { setImeiFilter(e.target.value as typeof imeiFilter); setDownloadStatus(''); }}>
                <option value="all">All records ({selectedOnly ? selectedRows.length : records.length})</option>
                <option value="with">Only records with IMEI</option>
                <option value="without">Only records without IMEI</option>
              </select>
            </label>

            <div className="export-preview">
              <button
                type="button"
                className="export-preview-toggle"
                aria-expanded={exportPreviewOpen}
                aria-controls="export-record-list"
                onClick={() => setExportPreviewOpen(open => !open)}
              >
                <span>{exportRows.length} of {exportCandidates.length} matching records included</span>
                <span>{exportPreviewOpen ? 'Hide list ▴' : 'Choose records ▾'}</span>
              </button>
              {exportPreviewOpen && <div id="export-record-list" className="export-preview-content">
                <input
                  className="export-preview-search"
                  aria-label="Find a record to include in export"
                  placeholder="Find IMEI, model, picture ID, or person"
                  value={exportSearch}
                  onChange={event => { setExportSearch(event.target.value); setExportPreviewLimit(30); }}
                />
                <div className="export-preview-actions">
                  <button type="button" disabled={!searchedExportRows.length} onClick={() => {
                    const ids = new Set(searchedExportRows.map(record => record.id));
                    setExportExcludedIds(old => old.filter(id => !ids.has(id)));
                  }}>Include all matches</button>
                  <button type="button" disabled={!searchedExportRows.length} onClick={() => {
                    setExportExcludedIds(old => [...new Set([...old, ...searchedExportRows.map(record => record.id)])]);
                  }}>Exclude all matches</button>
                </div>
                {searchedExportRows.length ? <div className="export-preview-list">
                  {searchedExportRows.slice(0, exportPreviewLimit).map(record => <label key={record.id} className="export-preview-row">
                    <input
                      type="checkbox"
                      checked={!exportExcludedSet.has(record.id)}
                      onChange={event => setExportExcludedIds(old => event.target.checked
                        ? old.filter(id => id !== record.id)
                        : [...old, record.id])}
                    />
                    <span><strong>#{record.number} · {record.imei || 'No IMEI'}</strong><small>{infoOf(record).series !== 'Unknown phones' ? `${infoOf(record).name} · ${exportModel(record.model)}` : exportModel(record.model) || 'Unknown model'} · {record.pictureId}</small></span>
                  </label>)}
                  {searchedExportRows.length > exportPreviewLimit && <button type="button" className="textbtn" onClick={() => setExportPreviewLimit(count => count + 30)}>Show more records</button>}
                </div> : <p className="export-preview-empty">No matching records. Try another search or filter.</p>}
              </div>}
            </div>

            <label className="export-format-picker">
              <span>Export format</span>
              <select
                value={exportFormat}
                onChange={e => setExportFormat(e.target.value as typeof exportFormat)}
              >
                <option value="excel">Excel workbook (.xlsx)</option>
                <option value="word">Word document (.docx)</option>
                <option value="sheets">Google Sheets</option>
                <option value="csv">CSV (.csv)</option>
              </select>
            </label>
            {exportFormat === 'sheets' && (
              <div className="download-status">Download the Excel file and import it into Google Sheets. Local photo links work only in spreadsheet apps that support links to extracted files.</div>
            )}

            <button
              className="primary export-button"
              disabled={syncing || !exportRows.length}
              onClick={exportChosen}
            >
              {syncing ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
              {syncing ? googleProgress || 'Preparing export…' : `Export ${exportRows.length} record${exportRows.length === 1 ? '' : 's'}`}
            </button>
            {downloadStatus && <div className="download-status" role="status">{downloadStatus}</div>}
            {photoDownloads.length > 0 && (
              <div className="photo-download-list">
                <strong>Download photos individually</strong>
                <button className="subtle-btn" onClick={() => {
                  try { saveDirectFile(new Blob([createPhotoGalleryHtml(photoDownloads, personGroups)], { type: 'text/html;charset=utf-8' }), 'open-photos.html'); }
                  catch (error) { setDownloadStatus(`Could not create the photo gallery: ${error instanceof Error ? error.message : 'Unknown error'}`); }
                }}>
                  <Download size={15} /> Download photo gallery HTML
                </button>
                {photoDownloads.slice(0, photoDisplayCount).map(record => (
                  <button key={record.id} className="subtle-btn" onClick={() => saveDirectFile(dataUrlBlob(recordPhoto(record)), orderedPhotoName(record))}>
                    <Download size={15} /> Photo #{record.number} · {record.imei || 'No IMEI'}
                  </button>
                ))}
                {photoDownloads.length > photoDisplayCount && <button className="subtle-btn" onClick={() => setPhotoDisplayCount(count => count + 40)}>Show more photo downloads</button>}
              </div>
            )}

            <div className="google-note">
              <CloudUpload size={15} />
              <span>
                Scanning never downloads files. Excel, Word and CSV can be exported locally.
                Google Sheets files can be imported from the downloaded Excel file.
              </span>
            </div>
          </div>
</>)}
        </section>

        <section id="records" hidden={!simpleView && mainView !== 'results'} className={`results panel ${collapsedPanels.includes('records') ? 'is-collapsed' : ''}`}><button className="panel-toggle" aria-expanded={!collapsedPanels.includes('records')} onClick={() => togglePanel('records')}>{collapsedPanels.includes('records') ? '▸' : '▾'} Scanned records {collapsedPanels.includes('records') ? '— expand' : '— minimize'}</button>
          <div className="results-top">
            <div>
              <div className="eyebrow">STEP 03</div>
              <h2>
                Scanned records <span className="count">{records.length}</span>
              </h2>
            </div>

            <div className="result-actions">
              {(simpleView || recordsTab === 'records') && (
              <label className="search">
                <Search size={15} />
                <input
                  aria-label="Search IMEI or model"
                  placeholder="Search IMEI or model…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </label>
              )}

            </div>
          </div>

          {!simpleView && recordsTab === 'records' && <div className="filters filters-compact">
            <label className="filter-select">Model
              <select aria-label="Filter by model" value={filter === 'All' || modelGroups.some(group => group.key === filter) ? filter : 'All'} onChange={event => setFilter(event.target.value)}>
                <option value="All">All devices ({records.length})</option>
                {modelGroups.map(group => <option key={group.key} value={group.key}>{group.label} ({group.ids.length})</option>)}
              </select>
            </label>
            <div className="filter-chips" role="group" aria-label="Status filter">
              <button className={filter !== 'Review' && filter !== 'Valid' && filter !== 'Duplicates' ? 'active' : ''} onClick={() => setFilter('All')}>All</button>
              <button className={filter === 'Review' ? 'active' : ''} onClick={() => setFilter('Review')}>Needs review</button>
              <button className={filter === 'Valid' ? 'active' : ''} onClick={() => setFilter('Valid')}>Valid IMEI <b>{validCount}</b></button>
              {records.some(r => r.duplicate) && <button className={filter === 'Duplicates' ? 'active' : ''} onClick={() => setFilter('Duplicates')}>Duplicates <b>{records.filter(r => r.duplicate).length}</b></button>}
              {records.some(r => r.duplicate) && <button className="danger" onClick={() => setConfirmDupes(duplicateRemovalIds(records))}>Remove duplicates</button>}
            </div>
          </div>}

          {!simpleView && recordsTab === 'models' && modelsTab}
          {!simpleView && recordsTab === 'unknown' && unknownTab}
          {!simpleView && recordsTab === 'share' && shareTab}

          <div className="records-tab-body" hidden={!simpleView && recordsTab !== 'records'}>
          <div className="people-controls">
            {simpleView && peoplePanel}
            <div className="people-setup">
              <strong>Group IMEIs by person</strong>
{!simpleView && (<>
              <label>
                New scans go to
                <select value={activePersonId} onChange={e => setActivePersonId(e.target.value)}>
                  {personGroups.map(person => (
                    <option key={person.id} value={person.id}>{personName(person)}</option>
                  ))}
                </select>
              </label>
</>)}
              <div className="action-bar" role="group" aria-label="Actions for selected phones">
              <button className="subtle-btn" disabled={!visible.length} onClick={toggleVisibleSelection}>
                {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
              </button>
              <button className="subtle-btn" disabled={!selectedRows.length} onClick={()=>{openSharing(selectedRows.map(row=>row.id));}}>Share selected ({selectedRows.length})</button>
              {simpleView && <button className="primary share-all-btn" disabled={syncing || !records.length} onClick={exportSimple}>{syncing ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} Export Excel ({selectedRows.length || records.length})</button>}
              {simpleView && records.some(needsCropping) && <button className="subtle-btn share-all-btn" onClick={() => setBulkCropOpen(true)}>Fix photos ({records.filter(needsCropping).length})</button>}
              <button className="subtle-btn delete-selected" disabled={!selectedRows.length} onClick={deleteSelected}>
                <Trash2 size={14} /> Delete selected ({selectedRows.length})
              </button>
              </div>
              <details className="more-actions">
                <summary>More actions</summary>
                <div className="more-actions-body">
                  <button className="subtle-btn" disabled={!visible.length} onClick={() => void sendNumbers()}>Send numbers ({selectedRows.length || visible.length})</button>
                  {!simpleView && <button className="subtle-btn" disabled={!records.length} onClick={() => setBulkCropOpen(true)}>Bulk crop ({bulkCropLabel})</button>}
                  {!simpleView && <button className="subtle-btn" disabled={!visible.length} onClick={() => setBulkEditOpen(true)}>Bulk edit ({selectedRows.length || visible.length})</button>}
                  <label className="move-to">Move selected to
                    <select aria-label="Move selected phones to a person" value="" disabled={!selectedRows.length} onChange={event => { if (event.target.value) moveSelected(event.target.value); }}>
                      <option value="">{selectedRows.length ? `Choose person (${selectedRows.length})` : 'Select phones first'}</option>
                      {personGroups.map(person => <option key={person.id} value={person.id}>{personName(person)}</option>)}
                      <option value="unassigned">Unassigned</option>
                    </select>
                  </label>
                  <button className="subtle-btn bulk-download-btn" disabled={!visible.length || bulkBusy} onClick={bulkDownloadPictures}><Download size={16} /> {bulkBusy ? 'Saving pictures…' : `Download all pictures (${selectedRows.length || visible.length})`}</button>
                  {!simpleView && <button className="subtle-btn" disabled={!visible.length} onClick={()=>openSharing(visible.map(row=>row.id))}>Share all ({visible.length}) — pictures + numbers</button>}
                </div>
              </details>
            </div>
            {personFilter === 'All' && personGroups.length > 0 && <p className="people-hint">Tap a person below to see, move or share their phones.</p>}
            <div className="person-filters">
              <button className={personFilter === 'All' ? 'active' : ''} onClick={() => setPersonFilter('All')}>Everyone <b>{records.length}</b></button>
              {personGroups.map(person => (
                <button key={person.id} className={personFilter === person.id ? 'active' : ''} onClick={() => setPersonFilter(person.id)}>
                  {personName(person)} <b>{records.filter(r => r.personId === person.id).length}</b>
                </button>
              ))}
              {(records.some(r => r.personId === UNASSIGNED) || personFilter === UNASSIGNED_FILTER) && <button className={personFilter === UNASSIGNED_FILTER ? 'active' : ''} onClick={() => setPersonFilter(UNASSIGNED_FILTER)}>Unassigned <b>{records.filter(r => r.personId === UNASSIGNED).length}</b></button>}
            </div>
            {personFilter !== 'All' && <div className="person-actions" role="group" aria-label="This person's IMEIs">
              <strong>{personFilter === UNASSIGNED_FILTER ? 'Unassigned' : personNameOf(personFilter)}: {visible.length} IMEI{visible.length === 1 ? '' : 's'}</strong>
              <span>{isPersonView(personFilter) ? 'Delete here moves phones to Everyone as unassigned.' : 'Delete here removes phones permanently, after you confirm.'}</span>
              <button className="primary" disabled={!visible.length} onClick={() => openSharing(visible.map(row => row.id))}><Share2 size={14} /> Share {personFilter === UNASSIGNED_FILTER ? 'Unassigned' : personNameOf(personFilter)} ({visible.length})</button>
              <label className="move-to">Move all to
                <select aria-label="Move all shown IMEIs to" value="" disabled={!visible.length} onChange={event => { if (event.target.value) moveRecords(visible.map(row => row.id), ownerOf(event.target.value)); }}>
                  <option value="">{visible.length ? `Choose (${visible.length})` : 'Nothing to move'}</option>
                  {personGroups.filter(person => person.id !== personFilter).map(person => <option key={person.id} value={person.id}>{personName(person)}</option>)}
                  {personFilter !== UNASSIGNED_FILTER && <option value="unassigned">Unassigned</option>}
                </select>
              </label>
              <button className="subtle-btn danger" disabled={!visible.length} onClick={() => requestDelete(visible)}><Trash2 size={14} /> Delete all ({visible.length})</button>
            </div>}
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <div><ScanLine size={28} /></div>
              <strong>
                {records.length
                  ? (personFilter !== 'All' && !query && filter === 'All'
                    ? (isPersonView(personFilter) && emptiedPeople.includes(personFilter) ? 'All IMEIs moved.' : personFilter === UNASSIGNED_FILTER ? 'No unassigned IMEIs.' : 'No IMEIs for this person yet.')
                    : 'No matching records')
                  : 'Your scanned devices will appear here'}
              </strong>
              <span>
                {records.length
                  ? 'Try a different search or filter.'
                  : 'Upload phone label photos to begin extracting IMEI.'}
              </span>
            </div>
          ) : simpleView ? (
            <div className="simple-record-list">
              {pageGroups.map(([series, rows]) => <div key={series} className="series-group">
                <h3>{series} <span>{rows.length}</span></h3>
                {rows.map(record => { const info = infoOf(record), pair = recordImeiPair(record), serial = recordSerial(record); return <article className="simple-record" key={record.id}>
                  <input className="selection-check" type="checkbox" aria-label={`Select ${info.name}`} checked={selectedIdSet.has(record.id)} onChange={() => toggleSelected(record.id)} />
                  <button className="simple-record-photo" onClick={() => openReview(record)} aria-label={`Open photo of ${info.name}`}><img src={recordPhoto(record)} alt="" /></button>
                  <div className="simple-record-info">
                    <strong className="phone-name">{info.name}</strong>
                    <div className="value-row"><span>IMEI</span><b>{pair.imei1 || '—'}</b><button className="subtle-btn" disabled={!pair.imei1} onClick={() => void copyText(pair.imei1).then(ok => setToast(ok ? 'IMEI copied.' : 'Copy failed.'))}>Copy</button></div>
                    {pair.imei2 && <div className="value-row"><span>IMEI 2</span><b>{pair.imei2}</b><button className="subtle-btn" onClick={() => void copyText(pair.imei2).then(ok => setToast(ok ? 'IMEI 2 copied.' : 'Copy failed.'))}>Copy</button></div>}
                    <div className="value-row"><span>Serial</span><b>{serial || '—'}</b><button className="subtle-btn" disabled={!serial} onClick={() => void copyText(serial).then(ok => setToast(ok ? 'Serial copied.' : 'Copy failed.'))}>Copy</button></div>
                    {reviewStatus(record) !== 'Valid' && reviewStatus(record) !== 'Serial only' && <button className="check-flag" onClick={() => openReview(record)}>{reviewStatus(record)} — tap to check</button>}
                  </div>
                  <div className="simple-record-actions">
                    <select aria-label={`Move ${info.name} to`} value={record.personId || 'unassigned'} onChange={event => assignPerson(record.id, event.target.value)}>{personGroups.map(person => <option key={person.id} value={person.id}>{personName(person)}</option>)}<option value="unassigned">Unassigned</option></select>
                    <button className="subtle-btn" onClick={() => openReview(record)}>Open</button>
                    <button className="subtle-btn danger" aria-label={`Delete ${info.name}`} onClick={() => deleteRecord(record)}><Trash2 size={16} /></button>
                  </div>
                  <details className="row-more"><summary>More for this phone</summary><div className="row-more-grid">
                    <label>IMEI <input aria-label={`IMEI for ${info.name}`} inputMode="numeric" value={record.imei} onChange={event => { const imei = digits(event.target.value).slice(0, 15); updateRow(record.id, { imei, status: imei ? luhnValid(imei) ? 'Valid' : 'Invalid' : 'Review' }); }} /></label>
                    <label>Serial <input aria-label={`Serial for ${info.name}`} value={serial} onChange={event => updateRow(record.id, { serial: event.target.value, serialNeedsReview: false })} /></label>
                    <label>Model code <input aria-label={`Model code for ${info.name}`} value={exportModel(record.model)} onChange={event => updateRow(record.id, { model: event.target.value })} /></label>
                    <button className="subtle-btn" disabled={!exportModel(record.model)} onClick={() => void copyText(exportModel(record.model)).then(ok => setToast(ok ? 'Model code copied.' : 'Copy failed.'))}>Copy model code</button>
                    <button className="subtle-btn" onClick={() => void copyText(`Model: ${exportModel(record.model)}\nIMEI: ${record.imei}\nSerial number: ${serial}`).then(ok => setToast(ok ? 'Record copied.' : 'Copy failed.'))}>Copy whole record</button>
                    <button className="subtle-btn" onClick={() => saveDirectFile(dataUrlBlob(recordPhoto(record)), orderedPhotoName(record))}>Download photo</button>
                    <button className="subtle-btn" onClick={() => shareRecord(record)}>Share photo + number</button>
                    <button className="subtle-btn" onClick={() => openCropReview(record)}>Edit or crop photo</button>
                  </div></details>
                </article>; })}
              </div>)}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        className="selection-check"
                        type="checkbox"
                        aria-label="Select all visible records"
                        checked={allVisibleSelected}
                        onChange={toggleVisibleSelection}
                      />
                    </th>
                    <th>NO.</th>
                    <th>PICTURE ID</th>
                    <th>PHOTO / FILE</th>
                    <th>PERSON</th>
                    <th>DEVICE MODEL</th>
                    <th>IMEI</th>
                    <th>SERIAL NUMBER</th><th>VALIDATION</th>
                    <th>STATUS</th>
                    <th />
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map(r => (
                    <tr key={r.id}>
                      <td data-label="Select">
                        <input
                          className="selection-check"
                          type="checkbox"
                          aria-label={`Select photo #${r.number}`}
                          checked={selectedIdSet.has(r.id)}
                          onChange={() => toggleSelected(r.id)}
                        />
                      </td>
                      <td data-label="Record">#{r.number}</td>
                      <td data-label="Picture ID">{r.pictureId}{r.sourcePictureId && records.some(item => item.id !== r.id && item.sourcePictureId === r.sourcePictureId) ? ' · Same source photo' : ''}{r.cropNeedsReview ? ' · Crop needs review' : ''}</td>
                      <td data-label="Photo">
                        <div className="photo-edit-cell">
                        <button
                          className="photo-cell"
                          onClick={() => openReview(r)}
                        >
                          <img src={recordPhoto(r)} />
                          <span>{r.name}</span>
                        </button>
                        <button className="subtle-btn edit-photo-action" title="Edit or crop this photo" onClick={() => openCropReview(r)}>Edit photo</button>
                        </div>
                      </td>

                      <td data-label="Person">
                        <select
                          className="inline-edit person-edit"
                          aria-label={`Move record #${r.number} to a person`}
                          value={r.personId || 'unassigned'}
                          onChange={e => assignPerson(r.id, e.target.value)}
                        >
                          {personGroups.map(person => (
                            <option key={person.id} value={person.id}>
                              {personName(person)}
                            </option>
                          ))}
                          <option value="unassigned">Unassigned</option>
                        </select>
                      </td>

                      <td data-label="Model">
                        <input
                          className="inline-edit model-edit"
                          aria-label={`Model for record ${r.number}`}
                          value={r.model}
                          onFocus={e => { e.currentTarget.dataset.before = r.model; }}
                          onChange={e =>
                            updateRow(r.id, { model: e.target.value })
                          }
                          onBlur={e => {
                            // Learn the correction once the edit is finished (never from half-typed codes).
                            const before = e.currentTarget.dataset.before, after = e.currentTarget.value.trim();
                            if (before !== undefined && after && after !== before) writeLearned(learnCorrection(readLearned(), before, after));
                            delete e.currentTarget.dataset.before;
                          }}
                        />
                        {(() => { const info = infoOf(r); return info.series !== 'Unknown phones' && !isGenericName(info.name) ? <small className="model-cell-name"><strong>{info.name}</strong> · {info.series}</small> : <small className="model-cell-name unknown">{modelCode4(r.model) ? `SM-${modelCode4(r.model)} is not recognised. Add its name in Settings.` : 'Model not recognised. Type the code, or add it in Settings.'}</small>; })()}
                      </td>

                      <td data-label="IMEI">
                        <input
                          className="inline-edit imei-edit"
                          aria-label={`IMEI 1 for record ${r.number}`}
                          value={r.imei}
                          placeholder="Not detected"
                          maxLength={15}
                          onChange={e => {
                            const imei = digits(e.target.value).slice(0, 15);

                            if (imeiTakenElsewhere(imei, r.id, records)) setToast('This IMEI is already in your records. Both are flagged as duplicates.');

                            updateRow(r.id, {
                              imei,
                              ...(imei.length === 15 ? { cropNeedsReview: false } : {}),
                              status: imei.length === 15
                                ? (luhnValid(imei) ? 'Valid' : 'Invalid')
                                : 'Review'
                            });
                          }}
                        />

                        <button
                          className="row-action"
                          title="Copy IMEI"
                          onClick={() => void copyText(r.imei).then(copied => setToast(copied ? 'IMEI copied.' : 'Could not copy IMEI.'))}
                        >
                          <Copy size={14} />
                        </button>
                      </td>

                      <td data-label="Serial number"><input aria-label={`Serial number for record ${r.number}`} value={recordSerial(r)} onChange={e => updateRow(r.id, {serial:e.target.value,serialNeedsReview:false})} /></td>
                      <td data-label="Validation">
                        <span className={`status ${(r.cropNeedsReview ? 'Review' : r.status).toLowerCase()}`}>
                          {r.status === 'Valid' && !r.cropNeedsReview
                            ? <CheckCircle2 size={13} />
                            : <AlertTriangle size={13} />}
                          {' '}{reviewStatus(r)}
                        </span>
                      </td>

                      <td data-label="Duplicate">
                        {r.duplicate
                          ? <span className="duplicate"><Copy size={12} /> Duplicate</span>
                          : <span className="unique">Unique</span>}
                      </td>

                      <td data-label="Actions">
                        <button
                          className="row-action"
                          title="Download original photo"
                          onClick={() => {
                            saveDirectFile(dataUrlBlob(recordPhoto(r)), orderedPhotoName(r));
                          }}
                        >
                          <Download size={16} /> Photo
                        </button>

                        <button
                          className="row-action"
                          title="View photo and OCR text"
                          onClick={() => openReview(r)}
                        >
                          <Eye size={16} />
                        </button>

                        <button
                          className="row-action danger"
                          title="Delete record"
                          onClick={() => deleteRecord(r)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {visible.length > pageSize && (
            <nav className="record-pages" aria-label="Scanned records pages">
              <button className="subtle-btn" disabled={currentPage === 1} onClick={() => setRecordPage(currentPage - 1)}>Previous</button>
              <span>Page {currentPage} of {pageCount} · {visible.length} records</span>
              <button className="subtle-btn" disabled={currentPage === pageCount} onClick={() => setRecordPage(currentPage + 1)}>Next</button>
            </nav>
          )}
          </div>
        </section>

        <footer>
          <span>IMEI LENS <i>•</i> Browser-based OCR <i>•</i> by Carlou Joseph Barnes</span>
          <span>
            IMEI extraction is automated; always verify results against the device label.
          </span>
        </footer>
      </main>

      {selected && (
        <div
          className="modal-backdrop"
          onClick={closePhotoReview}
        >
          <div
            ref={reviewModalRef}
            className="modal review-modal"
            role="dialog" aria-modal="true" aria-label="Review record"
            onClick={e => e.stopPropagation()}
          >
            <div className="review-sticky">
            <div className="modal-head">
              <div>
                {(() => { const sure = recordConfidence(selected); return <div className="eyebrow" title={sure.reasons.join('; ')}>IMAGE REVIEW · {sure.score}% sure ({sure.level})</div>; })()}
                <h2>{selected.name}</h2>
              </div>

              <div className="review-header-actions">
                <button className="iconbtn danger" aria-label="Delete this record" title="Delete this record" disabled={rotatingPhoto} onClick={() => isPersonView(personFilter) ? deleteRecord(selected, true) : setDeleteReviewConfirm(true)}><Trash2 size={18} /></button>
                <button className="iconbtn" aria-label="Close photo review" onClick={closePhotoReview}><X /></button>
              </div>
            </div>

            {deleteReviewConfirm && <div className="review-delete-confirm" role="alertdialog" aria-label="Confirm record deletion">
              <strong>Delete record #{selected.number} and its picture?</strong>
              <div><button className="subtle-btn" onClick={() => setDeleteReviewConfirm(false)}>Cancel</button><button className="subtle-btn danger" onClick={() => deleteRecord(selected, true, true)}>Delete record</button></div>
            </div>}


            </div>

            <div className="review-body">
            <div className="review-preview">
              <button type="button" className="review-thumb" aria-label="Enlarge photo" onClick={() => setPhotoExpanded(true)}>
                <img src={focusPreview && !showFullPhoto ? focusPreview : recordPhoto(selected)} alt={focusPreview && !showFullPhoto ? 'Label area of the photo' : 'Selected record photo'} decoding="async" />
                <span className="review-thumb-hint"><ZoomIn size={14} /> Tap to enlarge</span>
              </button>
              <div className="review-preview-side">
                {focusPreview && <button type="button" className="subtle-btn" onClick={() => setShowFullPhoto(value => !value)}>{showFullPhoto ? 'Zoom to label' : 'Show full photo'}</button>}
                <button type="button" className="subtle-btn" onClick={() => setCropEditorOpen(true)}>Crop / edit photo</button>
              </div>
            </div>

            {selected.cropNeedsReview && (selected.deviceCount || 0) > 1 && <div className="review-question" role="group" aria-label="How many devices are in this photo"><div><strong>Is this 1 device or {selected.deviceCount}?</strong><span>The scanner found {selected.deviceCount} possible devices but could not cut the photo.</span></div><div className="review-question-buttons"><button className="subtle-btn" onClick={confirmSingleDevice}>1 device</button><button className="primary" disabled={autoSplitBusy.current} onClick={() => void autoSplitRecords([selected]).then(n => { if (n) setSelected(null); })}>Split automatically</button><button className="subtle-btn" onClick={() => setCropEditorOpen(true)}>Crop each myself</button></div></div>}
            {selected.cropNeedsReview && (selected.deviceCount || 0) <= 1 && <div className="review-question" role="alert"><div><strong>Check the crop</strong><span>The automatic crop may be cut off.</span></div><div className="review-question-buttons"><button className="primary" onClick={() => setCropEditorOpen(true)}>Adjust crop</button></div></div>}

            <div className="manual-imei-entry review-fields">
              <div className="review-field">
                <label className="review-model" htmlFor="manual-model">Device model</label>
                <ModelPicker id="manual-model" value={manualModel} onChange={setManualModel} customModels={customModels} catalogEntries={catalogEntries} scannedModels={scannedModelList} onAddModel={(code, name) => { const next = { ...customModels, [code]: name }; if (!writeCustomModels(next)) return false; setCustomModels(next); return true; }} onEnter={() => document.getElementById('manual-serial')?.focus()} />
                {modelCode4(manualModel) && phoneInfo(manualModel, catalogEntries, customModels).series !== 'Other phones' && <small className="model-meaning">= {phoneInfo(manualModel, catalogEntries, customModels).name}</small>}
              </div>
              <div className="review-field">
                <label htmlFor="manual-serial">Serial number (S/N)</label>
                <DeferredInput id="manual-serial" value={manualSerial} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onValue={typeField('serial', setManualSerialState)} />
              </div>
              <div className="review-field">
                <label htmlFor="manual-imei">IMEI 1</label>
                <DeferredInput id="manual-imei" inputMode="numeric" value={manualImei} clean={text => digits(text).slice(0, 15)} onValue={typeField('imei', setManualImeiState)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); saveReviewFields(true); } }} />
              </div>
              <div className="review-field">
                <label htmlFor="manual-imei2">IMEI 2 <small>(dual-SIM, optional)</small></label>
                <DeferredInput id="manual-imei2" inputMode="numeric" value={manualImei2} clean={text => digits(text).slice(0, 15)} onValue={typeField('imei2', setManualImei2State)} />
              </div>
              <div className="review-field">
                <label htmlFor="review-person">Person</label>
                <select id="review-person" value={selected.personId || 'unassigned'} onChange={event => { const plan = assignPerson(selected.id, event.target.value); if (plan.moved.length) setSelected({ ...selected, personId: ownerOf(event.target.value) }); }}>{personGroups.map(person => <option key={person.id} value={person.id}>{personName(person)}</option>)}<option value="unassigned">Unassigned</option></select>
              </div>
            </div>

            <div className="review-tools" role="group" aria-label="Photo actions">
              <button className="subtle-btn" disabled={!selected.imei} onClick={() => void copyText(selected.imei).then(copied => setToast(copied ? 'IMEI copied.' : 'Could not copy IMEI.'))}><Copy size={16} /> Copy IMEI</button>
              <button className="subtle-btn" onClick={() => saveDirectFile(dataUrlBlob(recordPhoto(selected)), orderedPhotoName(selected))}><Download size={16} /> Photo</button>
              <button className="subtle-btn" aria-label="Rotate left" disabled={rotatingPhoto} onClick={() => void rotateSelectedPhoto('left')}>↶ Left</button>
              <button className="subtle-btn" aria-label="Rotate right" disabled={rotatingPhoto} onClick={() => void rotateSelectedPhoto('right')}>↷ Right</button>
              <button className="subtle-btn" disabled={rotatingPhoto} onClick={() => void straightenSelectedPhoto()}>Straighten</button>
            </div>

            {<details className="review-details"><summary>More details: status, serial, catalog, share</summary>
            <div className="modal-meta">
              <span>Picture ID: {selected.pictureId}</span>
              <button className="subtle-btn" onClick={() => shareRecord(selected)}>Share photo + number</button>
              <span>Catalog: {catalogModel(selected.raw) || 'No confirmed catalog match — verify the model manually'}</span>
              <span>Serial: {recordSerial(selected) || 'Not detected'}</span><span>Status: {reviewStatus(selected)}</span>
              <span>IMEI: {selected.imei || 'Not detected'}</span>
              {selected.sourcePictureId && records.filter(r => r.sourcePictureId === selected.sourcePictureId).length > 1 && (
                <span>Same source photo: {records.filter(r => r.sourcePictureId === selected.sourcePictureId).map(r => `#${r.number} ${r.imei}`).join(' · ')}</span>
              )}
              <span>Validation: {selected.status}</span>
              <span>Duplicate: {selected.duplicate ? 'Yes' : 'No'}</span>
              {selected.cropNeedsReview && <span>Automatic cropping needs review; adjust the crop if needed.</span>}
            </div>
            </details>}

            {selected.cropDataUrl && selected.cropDataUrl !== (reviewSource || selected.dataUrl) && (
              <details>
                <summary>View full original photo</summary>
                <img className="preview" src={reviewSource || selected.dataUrl} alt="Full original photo" />
              </details>
            )}


            <details>
              <summary>Raw OCR text</summary>
              <pre>{selected.raw || 'No text recognized.'}</pre>
            </details>
            </div>

            <div className="review-foot">
              {reviewIndex >= 0 && <div className="review-navigation" aria-label="Navigate scanned records">
                <button className="subtle-btn" disabled={reviewIndex === 0 || rotatingPhoto} onClick={() => goReview(-1)}>← Previous</button>
                <span>{reviewIndex + 1} of {reviewRecords.length}</span>
                {reviewIndex === reviewRecords.length - 1
                  ? <button className="primary" disabled={rotatingPhoto} onClick={finishReview}>Finish ✓</button>
                  : <button className="subtle-btn" disabled={rotatingPhoto} onClick={() => goReview(1)}>Next →</button>}
              </div>}
              <div className="review-save-bar" role="group" aria-label="Save this record">
                <button className="primary" disabled={rotatingPhoto} onClick={() => saveReviewFields()}>Save</button>
                {reviewIndex >= 0 && reviewIndex < reviewRecords.length - 1 && <button className="subtle-btn" disabled={rotatingPhoto} onClick={() => saveReviewFields(true)}>Save &amp; next →</button>}
                <span className="review-save-state" role="status">{pendingChanges ? `${pendingChanges} unsaved` : 'All saved'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {selected && photoExpanded && <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label="Enlarged photo" onClick={() => setPhotoExpanded(false)}>
        <img src={showFullPhoto || !focusPreview ? (reviewSource || recordPhoto(selected)) : focusPreview} alt="Enlarged record photo" />
        <button type="button" className="subtle-btn photo-lightbox-close" onClick={() => setPhotoExpanded(false)}><X size={16} /> Close</button>
      </div>}

      {shareIds.length>0&&<div className="modal-backdrop share-backdrop"><section className="modal share-modal" role="dialog" aria-modal="true" aria-label="Share selected records">
       <div className="modal-head"><h2>{shareIds.length>1?`Share ${shareIds.length} records`:"Share record"}</h2><button className="subtle-btn" disabled={sharing} onClick={()=>setShareIds([])}>Close sharing</button></div>
       <label>Include <select aria-label="Sharing option" disabled={sharing} value={shareMode} onChange={e=>{setShareMode(e.target.value as ShareMode);setShareStep('picture');setShareIndex(0);setShareStatus('');}}><option value="imei">Picture + IMEI (or serial if no IMEI)</option><option value="imei_serial">Picture + IMEI + Serial Number</option></select></label>
       {bulkShare?<div className="share-bulk">
        <p><strong>{shareRows.length} records.</strong> Step 1: share all the pictures to the same chat.{shareRows.length>30&&' WhatsApp may take only about 30 at once. If some are missing, use Download all pictures and attach the rest.'} Step 2: share the numbers as one separate message. Numbers are listed in the same order as the pictures.</p>
        <div className="share-thumbs" aria-label="Pictures to share">{shareRows.slice(0,30).map((row,index)=><img key={row.id} src={recordPhoto(row)} alt={`Picture ${index+1}`}/>)}{shareRows.length>30&&<span>+{shareRows.length-30}</span>}</div>
        <strong>Step 1 · Pictures</strong>
        <div className="share-toolbar">{shareBatches.map((batch,index)=><button key={index} className="primary" disabled={sharing} onClick={()=>nativeShareBulk('pictures',index)}>Share pictures {index*SHARE_BATCH+1}–{index*SHARE_BATCH+batch.length}</button>)}</div>
        <button className="subtle-btn" onClick={()=>void downloadBulkPictures(shareRows)}>Download all {shareRows.length} pictures instead</button>
        <strong>Step 2 · Numbers (one message)</strong>
        <textarea aria-label="All numbers to share" readOnly value={bulkShareText}/>
        <div className="share-toolbar"><button className="primary" disabled={sharing||!bulkShareText} onClick={()=>nativeShareBulk('text')}>Share all numbers</button><button className="subtle-btn" onClick={()=>void copyText(bulkShareText).then(ok=>setShareStatus(ok?'Numbers copied. Paste them as a new message.':'Copy failed. Select and copy the text above.'))}>Copy numbers</button></div>
        <strong>Or copy one by one</strong>
        <p className="copy-hint">Tap a number to copy it. It gets a tick so you know where you are. Picture files are named with the same number: 1.jpg, 2.jpg, 3.jpg…</p>
        <ol className="copy-list">{shareRows.map((row,index)=>{const pair=recordImeiPair(row),serial=recordSerial(row);return <li key={row.id}><img src={recordPhoto(row)} alt={`Picture ${index+1}`}/><span className="copy-num">{index+1}</span><div className="copy-values">
          {pair.imei1&&<button type="button" className={copiedKeys.includes(row.id+'1')?'copied':''} onClick={()=>copyValue(row.id+'1',pair.imei1)}>{copiedKeys.includes(row.id+'1')?'✓ ':''}IMEI 1 · {pair.imei1}</button>}
          {pair.imei2&&<button type="button" className={copiedKeys.includes(row.id+'2')?'copied':''} onClick={()=>copyValue(row.id+'2',pair.imei2)}>{copiedKeys.includes(row.id+'2')?'✓ ':''}IMEI 2 · {pair.imei2}</button>}
          {serial&&<button type="button" className={copiedKeys.includes(row.id+'s')?'copied':''} onClick={()=>copyValue(row.id+'s',serial)}>{copiedKeys.includes(row.id+'s')?'✓ ':''}S/N · {serial}</button>}
          {!pair.imei1&&!pair.imei2&&!serial&&<em>No number detected</em>}</div>
          <button type="button" className="subtle-btn copy-save" aria-label={`Download picture ${index+1}`} onClick={()=>saveDirectFile(dataUrlBlob(recordPhoto(row)),`${index+1}.jpg`)}>↓ Picture</button></li>;})}</ol>
        <button className="textbtn" disabled={sharing} onClick={()=>{setShareOneByOne(true);setShareStep('picture');setShareIndex(0);setShareStatus('');}}>Share one record at a time instead</button>
       </div>:<p>Share each picture first, then its number text. Choose the same conversation in WhatsApp, Messenger or another compatible app for both steps. Browsers cannot force separate chat messages in one share operation.</p>}
       {!bulkShare&&currentShareRow&&<><p>{shareIndex+1} of {shareRows.length} selected</p><img className="share-preview" src={recordPhoto(currentShareRow)} alt="Selected picture"/>
       {shareStep==='picture'?<div className="share-toolbar"><strong>Step 1 · Picture only</strong><button className="primary" disabled={sharing} onClick={()=>nativeShareStep('picture')}>Share picture</button><button className="subtle-btn" onClick={()=>saveDirectFile(dataUrlBlob(recordPhoto(currentShareRow)),'image.jpg')}>Download picture</button><button className="subtle-btn" disabled={sharing} onClick={()=>{setShareStep('text');setShareStatus('');}}>I attached the picture — continue</button></div>:<div className="share-toolbar"><strong>Step 2 · Separate plain-text message</strong><textarea aria-label="Number text to share" readOnly value={currentShareText}/><button className="primary" disabled={sharing||!currentShareText} onClick={()=>nativeShareStep('text')}>Share text</button><button className="subtle-btn" disabled={!currentShareText} onClick={()=>void copyText(currentShareText).then(ok=>setShareStatus(ok?'Text copied. Paste it as a new message after the picture.':'Copy failed. Select and copy the text above.'))}>Copy text</button>{!currentShareText&&<p>No readable number is available. Edit this record or continue without text.</p>}<button className="subtle-btn" disabled={sharing} onClick={()=>{if(shareIndex+1<shareRows.length){setShareIndex(i=>i+1);setShareStep('picture');setShareStatus('');}else{setShareIds([]);}}}>{shareIndex+1<shareRows.length?'Next selected record':'Finish'}</button><button className="subtle-btn" disabled={sharing} onClick={()=>setShareStep('picture')}>Back to picture</button></div>}</>}
       <p role="status">{shareStatus}</p>
      </section></div>}
      {welcome === 'new' && <WhatsNewDialog first onClose={closeWelcome} onTutorials={() => { markWhatsNewSeen(); setWelcome('tutorials'); }} />}
      {welcome === 'tutorials' && <TutorialsDialog onClose={closeWelcome} />}
      {confirmDupes && <div className="modal-backdrop"><section className="modal confirm-delete" role="alertdialog" aria-modal="true" aria-label="Remove duplicates">
        <h2>Remove duplicates?</h2>
        <p>{confirmDupes.length} extra cop{confirmDupes.length === 1 ? 'y' : 'ies'} of repeated IMEIs will be deleted with {confirmDupes.length === 1 ? 'its' : 'their'} picture{confirmDupes.length === 1 ? '' : 's'}. One copy of every IMEI stays: the most complete one (with serial and a known model). You can undo for a few seconds afterwards.</p>
        <div className="share-toolbar"><button className="subtle-btn danger" disabled={!confirmDupes.length} onClick={() => { removeDuplicates(confirmDupes); setConfirmDupes(null); }}>Remove {confirmDupes.length} duplicate{confirmDupes.length === 1 ? '' : 's'}</button><button className="subtle-btn" onClick={() => setConfirmDupes(null)}>Cancel</button></div>
      </section></div>}
      {confirmDelete && <div className="modal-backdrop"><section className="modal confirm-delete" role="alertdialog" aria-modal="true" aria-label="Confirm delete">
        <h2>Delete permanently?</h2>
        <p>{confirmDelete.ids.length} IMEI record{confirmDelete.ids.length === 1 ? '' : 's'} and {confirmDelete.ids.length === 1 ? 'its' : 'their'} saved picture{confirmDelete.ids.length === 1 ? '' : 's'} will be removed from this device. This cannot be undone.</p>
        <div className="share-toolbar"><button className="subtle-btn danger" onClick={() => { removeRecords(confirmDelete.ids, confirmDelete.fromReview); setConfirmDelete(null); }}>Delete permanently</button><button className="subtle-btn" onClick={() => setConfirmDelete(null)}>Cancel</button></div>
      </section></div>}
      {deletePersonId && (() => { const person = personGroups.find(item => item.id === deletePersonId); if (!person) return null; const count = records.filter(row => row.personId === person.id).length, title = personName(person); return <div className="modal-backdrop"><section className="modal confirm-delete" role="alertdialog" aria-modal="true" aria-label={`Delete ${title}`}>
        <h2>Delete {title}?</h2>
        {count === 0 ? <p>{title} has no phones. Only the person is removed.</p> : <p>{title} has <b>{count}</b> phone{count === 1 ? '' : 's'}. What should happen to {count === 1 ? 'it' : 'them'}?</p>}
        <div className="delete-person-choices">
          <button className="primary" onClick={() => deletePerson(person.id, false)}>{count === 0 ? 'Delete person' : `Delete person, keep ${count === 1 ? 'the phone' : 'phones'}`}{count > 0 && <small>Phones move to Unassigned. You can undo this.</small>}</button>
          {count > 0 && <button className="subtle-btn danger" onClick={() => deletePerson(person.id, true)}>{`Delete person and ${count} phone${count === 1 ? '' : 's'}`}<small>Removes the phones and their pictures permanently.</small></button>}
          <button className="subtle-btn" onClick={() => setDeletePersonId('')}>Cancel</button>
        </div>
      </section></div>; })()}
      {overviewOpen && <div className="modal-backdrop"><section className="modal overview-modal" role="dialog" aria-modal="true" aria-label="Final review">
        <div className="modal-head"><h2>Final review</h2><button className="subtle-btn" onClick={() => setOverviewOpen(false)}>Close</button></div>
        {review.length === 0 ? <p>No phones yet.</p> : <>
          <p className="settings-help">Model by model: who gets how many.</p>
          <div className="review-filters">
            <label>Person
              <select aria-label="Filter review by person" value={reviewPerson} onChange={event => setReviewPerson(event.target.value)}>
                <option value="">Everyone</option>
                {personGroups.map(person => <option key={person.id} value={person.id}>{personName(person)}</option>)}
                <option value={UNASSIGNED_FILTER}>Unassigned</option>
              </select>
            </label>
            <label>Model<input aria-label="Filter review by model" placeholder="Search models" value={reviewQuery} onChange={event => setReviewQuery(event.target.value)} /></label>
          </div>
          <label className="settings-check"><input type="checkbox" checked={overviewNumbers} onChange={event => setOverviewNumbers(event.target.checked)} /> Include IMEI / serial numbers</label>
          <p className="settings-help" role="status">{reviewShown.length} model{reviewShown.length === 1 ? '' : 's'} · {reviewShown.reduce((sum, model) => sum + model.total, 0)} phone{reviewShown.reduce((sum, model) => sum + model.total, 0) === 1 ? '' : 's'}{(reviewPerson || reviewQuery) ? ' (filtered)' : ''}</p>
          <div className="share-toolbar">
            <button className="primary" disabled={!reviewShown.length} onClick={() => void shareOrCopyText(reviewText(reviewShown), 'The review')}>Share review</button>
            <button className="subtle-btn" disabled={!reviewShown.length} onClick={() => void copyText(reviewText(reviewShown)).then(ok => setToast(ok ? 'Review copied.' : 'Copy failed.'))}>Copy</button>
            {(reviewPerson || reviewQuery) && <button className="subtle-btn" onClick={() => { setReviewPerson(''); setReviewQuery(''); }}>Clear filters</button>}
          </div>
          {!reviewShown.length && <p><em>Nothing matches these filters.</em></p>}
          <ul className="overview-list">
            {reviewShown.map(model => <li key={model.key}>
              <h3>{model.label} <b>{model.total}</b></h3>
              <ul>{model.holders.map(holder => <li key={holder.id}>{holder.name} <b>× {holder.count}</b></li>)}</ul>
              <div className="share-toolbar">
                <button className="subtle-btn" onClick={() => void shareOrCopyText(reviewText([model]), `${model.label} list`)}>Share list</button>
                <button className="subtle-btn" onClick={() => { setOverviewOpen(false); openSharing(model.holders.flatMap(holder => holder.ids)); }}>Share phones ({model.total})</button>
              </div>
            </li>)}
          </ul>
        </>}
      </section></div>}
      {waSend && (() => {
        const total = waSend.rows.length;
        const sentSet = new Set(waSent);
        const done = waSend.rows.filter(row => sentSet.has(row.id)).length;
        const remaining = total - done;
        const nextPosition = waSend.rows.findIndex(row => !sentSet.has(row.id)) + 1;
        const noWhatsApp = waCaps?.whatsapp === false;
        const bluetoothFirst = waPreferBluetooth || noWhatsApp;
        const problem = noWhatsApp ? 'WhatsApp is not installed on this phone.' : waProblem || (remaining > WHATSAPP_NOTICE ? `WhatsApp may not take all ${remaining} pictures at once.` : '');
        const whatsappButton = <button type="button" className={bluetoothFirst ? 'subtle-btn' : 'primary whatsapp-btn'} disabled={!!waBusy || noWhatsApp} onClick={() => void sendWhatsAppPictures('whatsapp')}>{waBusy || (done === 0 ? `Send all ${total} pictures by WhatsApp` : `WhatsApp · continue with pictures ${nextPosition}–${total}`)}<small>{noWhatsApp ? 'WhatsApp is not installed.' : `One send with all the pictures${waCaption ? ' and one caption listing every IMEI / serial' : ''}.`}</small></button>;
        const bluetoothButton = <button type="button" className={bluetoothFirst || problem ? 'primary' : 'subtle-btn'} disabled={!!waBusy || waCaps?.bluetooth === false} onClick={() => void sendWhatsAppPictures('bluetooth')}>Send {remaining} by Bluetooth{bluetoothFirst ? '' : ' instead'}<small>{waCaps?.bluetooth === false ? 'This phone has no Bluetooth.' : `Pictures with IMEI / serial written on them, plus a numbers.txt file.${waCaps?.bluetoothOn === false ? ' Bluetooth is off: turn it on first.' : ''}`}</small></button>;
        return <div className="modal-backdrop"><section className="modal wa-groups-modal" role="dialog" aria-modal="true" aria-label={`Send ${waSend.name}'s phones`}>
          <div className="modal-head"><h2>Send {waSend.name}</h2><button className="subtle-btn" onClick={() => setWaSend(null)}>Close</button></div>
          <div className="wa-progress" role="status">
            <strong>{done} of {total} pictures sent</strong>
            <div className="wa-bar" aria-hidden="true"><span style={{ width: `${total ? Math.round(done / total * 100) : 0}%` }} /></div>
            <small>{remaining ? `Next to send: picture ${nextPosition} of ${total}` : 'All pictures are sent.'}</small>
          </div>
          <label className="settings-check"><input type="checkbox" checked={waCaption} onChange={event => setWaCaption(event.target.checked)} /> Add one caption with every IMEI / serial</label>
          <label className="settings-check"><input type="checkbox" checked={shareSerial} onChange={event => setShareSerial(event.target.checked)} /> Always include serial numbers</label>
          {!waAttempt && remaining > 0 && problem && <div className="wa-warning" role="alert">
            <strong>{problem}</strong>
            <p>Bluetooth can send the pictures, the IMEI and the serial to another phone instead, with no limit on how many.</p>
          </div>}
          {waAttempt
            ? <div className="wa-confirm" role="group" aria-label="Save how many pictures arrived">
              <strong>{waAttempt.channel === 'bluetooth' ? 'Did they arrive on the other phone?' : 'Did they arrive in WhatsApp?'}</strong>
              <p>{waAttempt.channel === 'bluetooth' ? 'Check the other phone.' : 'Open the chat and check.'} If fewer than {waAttempt.ids.length} arrived, change the number. The app saves it and will continue after the last one that arrived.</p>
              <label>Pictures that arrived <input type="number" inputMode="numeric" min={0} max={waAttempt.ids.length} value={waAttempt.arrived} onChange={event => setWaAttempt({ ...waAttempt, arrived: Math.max(0, Math.min(waAttempt.ids.length, Math.floor(Number(event.target.value)) || 0)) })} /></label>
              <button type="button" className="primary whatsapp-btn" onClick={confirmWhatsAppArrived}>Save · {waAttempt.arrived} of {waAttempt.ids.length} arrived</button>
              <button type="button" className="subtle-btn" onClick={() => setWaAttempt(null)}>They did not send: try again</button>
            </div>
            : remaining > 0
              ? <div className="wa-send-ways">{bluetoothFirst ? <>{bluetoothButton}{whatsappButton}</> : <>{whatsappButton}{bluetoothButton}</>}</div>
              : <p className="settings-help">Everything was sent. Tap Start over to send them again.</p>}
          <details className="review-details"><summary>Send the numbers again as a separate message</summary>
            <div className="delete-person-choices">
              <button type="button" className="primary whatsapp-btn" onClick={() => openWhatsApp(waNumbersText(waSend.rows))}>Send the numbers as one message</button>
              <button type="button" className="subtle-btn" onClick={() => void copyText(waNumbersText(waSend.rows)).then(ok => setToast(ok ? 'Numbers copied.' : 'Copy failed.'))}>Copy the numbers</button>
            </div>
          </details>
          <button type="button" className="subtle-btn" disabled={!done && !waAttempt} onClick={resetWhatsAppProgress}>Start over</button>
        </section></div>;
      })()}
      {oneByOne && (() => {
        const rows = oneByOne.rows;
        const row = rows[obState.index];
        if (!row) return null;
        const pair = recordImeiPair(row), serial = recordSerial(row);
        const doneCount = rows.filter(item => obState.done.includes(item.id)).length;
        const remaining = rows.length - doneCount;
        const last = obState.index === rows.length - 1;
        return <div className="modal-backdrop"><section className="modal onebyone-modal" role="dialog" aria-modal="true" aria-label={`One by one: ${oneByOne.name}`}>
          <div className="modal-head"><h2>One by one · {oneByOne.name}</h2><button className="subtle-btn" onClick={() => setOneByOne(null)}>Close</button></div>
          <div className="wa-progress" role="status">
            <strong>Phone {obState.index + 1} of {rows.length}</strong>
            <div className="wa-bar" aria-hidden="true"><span style={{ width: `${Math.round(doneCount / rows.length * 100)}%` }} /></div>
            <small>{doneCount} downloaded · {remaining} left{obState.done.includes(row.id) ? ' · this one is already downloaded' : ''}</small>
          </div>
          <img className="ob-photo" src={recordPhoto(row)} alt={`Phone ${obState.index + 1}`} />
          <div className="ob-numbers">
            <div><small>IMEI 1</small><b>{pair.imei1 || '—'}</b></div>
            {pair.imei2 && <div><small>IMEI 2</small><b>{pair.imei2}</b></div>}
            {serial && <div><small>S/N</small><b>{serial}</b></div>}
          </div>
          <div className="review-float">
            <div className="review-tools ob-tools">
              <button type="button" className="subtle-btn" disabled={!serial} onClick={() => void copyText(serial).then(ok => setToast(ok ? 'Serial copied.' : 'Could not copy.'))}>Copy S/N</button>
            </div>
            <div className="ob-actions">
              <button type="button" className="primary" onClick={obDownloadNext}><Download size={16} /> {last ? 'Download image + copy IMEI · last one' : 'Download image + copy IMEI & next →'}</button>
              <div className="ob-nav">
                <button type="button" className="subtle-btn" disabled={obState.index === 0} onClick={() => obSet({ ...obState, index: obState.index - 1 })}>← Back</button>
                <button type="button" className="subtle-btn" disabled={last} onClick={() => obSet({ ...obState, index: obState.index + 1 })}>Skip →</button>
              </div>
              <button type="button" className="subtle-btn" disabled={!remaining} onClick={() => void obSaveRemaining()}>Download all {remaining} remaining to a folder</button>
            </div>
          </div>
        </section></div>;
      })()}
      {personUndo && <div className="undo-bar" role="status"><span>{personUndo.text}</span><button className="subtle-btn" onClick={undoDeletePerson}>Undo</button></div>}
      {bulkEditOpen && <div className="modal-backdrop"><section className="modal bulk-edit" role="dialog" aria-modal="true" aria-label="Bulk edit">
        <div className="modal-head"><h2>Bulk edit</h2><button className="subtle-btn" onClick={() => setBulkEditOpen(false)}>Close</button></div>
        <p className="copy-hint">Changes {selectedRows.length ? `${selectedRows.length} ticked phone${selectedRows.length === 1 ? '' : 's'}` : `all ${visible.length} phones shown`}. Leave a field empty to keep it as it is.</p>
        <label>Phone model code<input value={bulkEditModel} placeholder="for example SM-S938B" onChange={event => setBulkEditModel(event.target.value)} /></label>
        <label>Move to person<select value={bulkEditPerson} onChange={event => setBulkEditPerson(event.target.value)}><option value="">Keep as it is</option>{personGroups.map(person => <option key={person.id} value={person.id}>{personName(person)}</option>)}<option value="unassigned">Unassigned</option></select></label>
        <label className="check-row"><input type="checkbox" checked={bulkEditChecked} onChange={event => setBulkEditChecked(event.target.checked)} /> Mark as checked (clears the review flags)</label>
        <div className="share-toolbar"><button className="primary" onClick={applyBulkEdit}>Apply to {selectedRows.length || visible.length}</button><button className="subtle-btn" onClick={() => setBulkEditOpen(false)}>Cancel</button></div>
      </section></div>}
      {cropEditorOpen && selected && <CropFlow key={`review-${selected.id}`} items={[{ ...cropItem(selected), source: reviewSource || selected.originalDataUrl || selected.dataUrl }]} knownTacs={knownTacs}
        onApply={groups => applyCropGroups(groups, true)} onClose={finishCropFlow} onLater={cropFlowLater} onQueue={enqueueCrops} />}
      {(bulkCropOpen || bulkDraft) && !cropEditorOpen && (() => {
        // The list is fixed while the editor is open: queued photos are replaced by their crops in the background, which must not shift the editor under you.
        bulkRowsRef.current ||= bulkDraft ? bulkDraft.items.map(item => records.find(r => r.id === item.recordId)).filter((r): r is RecordItem => !!r) : bulkCropRows();
        const rows = bulkRowsRef.current;
        return <CropFlow key="bulk" items={rows.map(cropItem)} knownTacs={knownTacs}
          initialPlans={bulkDraft ? Object.fromEntries(bulkDraft.items.map(item => [item.recordId, item.boxes])) : undefined} startIndex={bulkDraft?.index}
          onApply={groups => applyCropGroups(groups, false)} onClose={finishCropFlow} onLater={cropFlowLater} onQueue={enqueueCrops} />;
      })()}
      {linkedPicture !== null && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) closeLinkedPicture(); }}><section className="modal linked-picture" role="dialog" aria-modal="true" aria-label="Picture from Excel link">
        <div className="modal-head"><h2>{linkedPicture ? 'Picture' : 'Picture not found'}</h2><button className="subtle-btn" onClick={closeLinkedPicture}>Close</button></div>
        {linkedPicture ? <>
          <img className="share-preview" src={recordPhoto(linkedPicture)} alt={`Picture for ${linkedPicture.imei || recordSerial(linkedPicture) || linkedPicture.pictureId}`} />
          <p>{[recordImeiPair(linkedPicture).imei1 && `IMEI 1: ${recordImeiPair(linkedPicture).imei1}`, recordImeiPair(linkedPicture).imei2 && `IMEI 2: ${recordImeiPair(linkedPicture).imei2}`, recordSerial(linkedPicture) && `Serial: ${recordSerial(linkedPicture)}`].filter(Boolean).join(' · ') || linkedPicture.pictureId}</p>
          <div className="share-toolbar">
            {recordImeiPair(linkedPicture).imei1 && <button className="subtle-btn" onClick={() => void copyText(recordImeiPair(linkedPicture).imei1).then(ok => setToast(ok ? 'IMEI 1 copied.' : 'Copy failed.'))}>Copy IMEI 1</button>}
            {recordImeiPair(linkedPicture).imei2 && <button className="subtle-btn" onClick={() => void copyText(recordImeiPair(linkedPicture).imei2).then(ok => setToast(ok ? 'IMEI 2 copied.' : 'Copy failed.'))}>Copy IMEI 2</button>}
            {recordSerial(linkedPicture) && <button className="subtle-btn" onClick={() => void copyText(recordSerial(linkedPicture)).then(ok => setToast(ok ? 'Serial copied.' : 'Copy failed.'))}>Copy serial</button>}
            <button className="primary" onClick={() => saveDirectFile(dataUrlBlob(recordPhoto(linkedPicture)), `${linkedPicture.number}.jpg`)}><Download size={16} /> Download picture</button>
            {typeof navigator.share === 'function' && <button className="subtle-btn" onClick={() => { const file = new File([dataUrlBlob(recordPhoto(linkedPicture))], 'picture.jpg', { type: 'image/jpeg' }); const data = { files: [file] }; if (navigator.canShare?.(data)) void navigator.share(data).catch(() => {}); else setToast('Sharing pictures is not available in this browser. Use Download picture.'); }}>Share picture</button>}
          </div>
        </> : <p>This picture is saved in the browser that scanned it. Open the Excel link on that phone in the same browser (Chrome) where you scanned, or use the picture file saved next to the Excel file.</p>}
      </section></div>}
      {showTop && !selected && shareIds.length === 0 && !cameraOpen && <button type="button" className="back-to-top" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑ Top</button>}
      {!simpleView && <nav className="bottom-nav" aria-label="Sections">
        {([['scan', 'Scan', ScanLine, 0], ['records', 'Records', ImageIcon, records.length], ['models', 'Give', Smartphone, giveChanged.length], ['unknown', 'Unknown', AlertTriangle, unknownGroups.length], ['share', 'Share', Share2, 0], ['export', 'Export', Download, 0]] as const).map(([key, label, Icon, badge]) =>
          <button key={key} type="button" className={activeView === key ? 'active' : ''} aria-current={activeView === key ? 'page' : undefined} onClick={() => openView(key)}>
            <Icon size={20} /><span>{label}</span>{badge > 0 && <b>{badge > 99 ? '99+' : badge}</b>}
          </button>)}
      </nav>}
      {toast && (
        <div className="toast">
          <AlertTriangle size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
