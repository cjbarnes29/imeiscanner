import { barcodeImei, imeiReadingsDisagree, pickImei2, labelledBarcodeImeis, labelledBarcodeLines, resolveImeisFromBarcodes, resolveSerialFromBarcodes, type PositionedBarcode } from './barcode-imei';
import { readDataUrlBarcodes, readImageBarcodes } from './barcode-reader';
import { useBackLayer } from './back-layer';
import { deviceAnchors, planDeviceCrops } from './device-labels';
import { buildSharePackage, shareNumberText, type ShareMode } from './share-package';
import { extractSerial, serialLabelRegion, serialReading, unindexedImeis } from './serial';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  UploadCloud, ScanLine, Download, Search, Trash2,
  CheckCircle2, AlertTriangle, Copy, Smartphone, Image as ImageIcon,
  X, LoaderCircle, ExternalLink, RefreshCw, Eye,
  CloudUpload
} from 'lucide-react';
import { createWorker, PSM } from 'tesseract.js';
import { exportModel, planImeiCrops, type CropRegion, type OcrLine } from './scan-layout';
import { loadInventory, saveInventory, saveOriginalSource } from './record-store';
import { CameraCapture } from './CameraCapture';
import { SamsungCatalog, catalogModel } from './SamsungCatalog';

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

type PersonGroup = { id: string; label: string; name: string };
type LaptopRecord = Omit<RecordItem, 'dataUrl'> & { imageName: string; photoIndex: number };
type AndroidRecord = Omit<RecordItem, 'dataUrl'> & { imageName: string };
type AndroidBridge = {
  choosePhotos(personId: string): void;
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
};
const androidBridge = (window as Window & { AndroidScanner?: AndroidBridge }).AndroidScanner;
const NATIVE_IMPORTED_STORE = 'imei-lens-native-imported-v1';
function readNativeImportedIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(NATIVE_IMPORTED_STORE) || '[]') as string[]); }
  catch { return new Set(); }
}

const STORE = 'imei-lens-records-v1';
const PEOPLE_STORE = 'imei-lens-people-v1';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

const digits = (s: string) => s.replace(/\D/g, '');

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

function markDuplicateRecords(rows: RecordItem[]) {
  const latest = rows.reduce<RecordItem | undefined>((current, row) =>
    row.uploadBatchId && (!current || row.createdAt > current.createdAt) ? row : current, undefined);
  const batchId = latest?.uploadBatchId;
  const counts = new Map<string, number>();
  for (const row of rows) if (batchId && row.uploadBatchId === batchId && /^\d{15}$/.test(row.imei)) counts.set(row.imei, (counts.get(row.imei) || 0) + 1);
  return rows.map(row => {
    const duplicate = !!batchId && row.uploadBatchId === batchId && /^\d{15}$/.test(row.imei) && (counts.get(row.imei) || 0) > 1;
    return row.duplicate === duplicate ? row : { ...row, duplicate };
  });
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

function extractImei1(text: string) {
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    if (/imei\s*1|imei1/i.test(lines[i])) {
      const near = [lines[i], lines[i + 1] || ''].join(' ');
      const match = near.match(/(?:\d[\s-]*){15,17}/);

      if (match) {
        const d = digits(match[0]);
        if (d.length === 15) return d;
      }
    }
  }

  const labelled = text.match(
    /IMEI[\s:#-]*(?:1|01)[^\d]{0,18}((?:\d[\s-]*){15,17})/i
  );

  if (labelled) {
    const d = digits(labelled[1]);
    if (d.length === 15) return d;
  }

  const candidates = [
    ...text.matchAll(/(?:\d[\s-]*){15,17}/g)
  ]
    .map(m => digits(m[0]))
    .filter(d => d.length === 15);

  const unique = [...new Set(candidates)];

  return unique.length === 1 ? unique[0] : '';
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
  return person ? `${person.label}${person.name ? ` — ${person.name}` : ''}` : 'Person 1';
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
    result.set(region.imei, canvas.toDataURL('image/jpeg', 0.9));
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

function createScanImages(file: File, maxDimension: number): Promise<{ color: HTMLCanvasElement; enhanced: HTMLCanvasElement }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(image.naturalWidth, image.naturalHeight);
      const colorScale = Math.min(1, maxDimension / longest);
      const enhancedScale = Math.min(3, maxDimension / longest);
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

async function readCropImei(worker: Awaited<ReturnType<typeof createWorker>>, cropDataUrl: string, mode: 'fast' | 'standard' | 'detailed' = 'detailed') {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
  const firstRead=await worker.recognize(cropDataUrl);
  let cropLines=ocrLines(firstRead.data);
  let raw=firstRead.data.text || '';
  let first = extractImei1s(raw);
  if (mode !== 'fast' && (first.length !== 1 || !luhnValid(first[0]))) {
    const enhanced = await createOcrImage(new File([dataUrlBlob(cropDataUrl)], 'crop.jpg', { type: 'image/jpeg' }));
    const enhancedText = (await worker.recognize(enhanced)).data.text || '';
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
        person?.label || 'Person 1',
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
        person: layout === 'person_photo' ? personTitle(record, people) : people.find(person => person.id === record.personId)?.label || 'Person 1',
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
      addModelSheet(`${person.label}${person.name ? ` - ${person.name}` : ''}`, personRows);
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
        new TableCell({ children: [new Paragraph({ text: people.find(person => person.id === record.personId)?.label || 'Person 1' })] }),
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
  function goToPanel(id: string) { setCollapsedPanels(old => old.filter(key => key !== id)); requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'})); }

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
  const [scanMode, setScanMode] = useState<'fast' | 'standard' | 'detailed'>('standard');
  const [laptopUrl, setLaptopUrl] = useState(() => hostedScanner ? window.location.origin : localStorage.getItem('imei-lens-laptop-url') || (window.location.hostname === 'cjbarnes29.github.io' ? 'http://127.0.0.1:8787' : window.location.origin));
  const [laptopKey, setLaptopKey] = useState(() => localStorage.getItem('imei-lens-laptop-key') || '');
  const [laptopJobId, setLaptopJobId] = useState(() => localStorage.getItem('imei-lens-laptop-job') || '');
  const [laptopUploading, setLaptopUploading] = useState(false);
  const [laptopMessage, setLaptopMessage] = useState('');
  const [laptopJob, setLaptopJob] = useState<{ status: string; count: number; completed: number; resultCount: number; failed: number } | null>(null);
  const [phoneAddresses, setPhoneAddresses] = useState<string[]>([]);
  const [androidJob, setAndroidJob] = useState<{ status: string; count: number; completed: number; failed: number; error?: string } | null>(null);
  const importedAndroidIds = useRef(readNativeImportedIds());
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
  const [manualImei, setManualImei] = useState('');
  const [manualSerial, setManualSerial] = useState('');
  const [manualImei2, setManualImei2] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [manualCrop, setManualCrop] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [reviewSource, setReviewSource] = useState('');
  const [cropEditorOpen, setCropEditorOpen] = useState(false);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropDraftPreview, setCropDraftPreview] = useState('');
  const [adjustingCrop, setAdjustingCrop] = useState(false);
  const [rotatingPhoto, setRotatingPhoto] = useState(false);
  const [reviewCountInput, setReviewCountInput] = useState(2);
  const [reviewSplit, setReviewSplit] = useState<{ recordId: string; target: number; crops: Array<{ cropDataUrl: string; imei: string; model: string; raw: string }> } | null>(null);
  const guidedCropWorker = useRef<Awaited<ReturnType<typeof createWorker>> | null>(null);
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
  const cropStart = useRef<{ x: number; y: number; edge?: string; initial?: typeof manualCrop } | null>(null);
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
      try {
        const job = JSON.parse(androidBridge.status()) as { id: string; status: string; count: number; completed: number; failed: number; error?: string; records?: AndroidRecord[] };
        if (cancelled) return;
        setAndroidJob({ status: job.status, count: job.count, completed: job.completed, failed: job.failed, error: job.error });
        const scanned = job.records || [];
        const counts = new Map<string, number>();
        for (const item of scanned) counts.set(item.sourcePictureId || '', (counts.get(item.sourcePictureId || '') || 0) + 1);
        const pending = scanned.filter(item => !importedAndroidIds.current.has(item.id)).slice(0, 6);
        const added: RecordItem[] = [];
        for (const item of pending) {
          const dataUrl = androidBridge.image(item.id);
          if (!dataUrl) continue;
          const { imageName, ...row } = item;
          added.push({ ...row, uploadBatchId: row.uploadBatchId || job.id, dataUrl, cropDataUrl: (counts.get(item.sourcePictureId || '') || 0) > 1 ? dataUrl : undefined });
          importedAndroidIds.current.add(item.id);
        }
        if (added.length) {
          try { localStorage.setItem(NATIVE_IMPORTED_STORE, JSON.stringify([...importedAndroidIds.current])); }
          catch (error) { console.error('Unable to save imported Android IDs', error); }
        }
        if (added.length && !cancelled) setRecords(old => {
          const ids = new Set(old.map(row => row.id));
          const seenImeis = new Set(old.filter(row => row.uploadBatchId === job.id).map(row => row.imei).filter(imei => /^\d{15}$/.test(imei)));
          let number = old.reduce((highest, row) => Math.max(highest, row.number), 2) + 1;
          const unique = added.filter(row => {
            if (ids.has(row.id)) return false;
            ids.add(row.id);
            if (/^\d{15}$/.test(row.imei)) {
              if (seenImeis.has(row.imei)) return false;
              seenImeis.add(row.imei);
            }
            row.number = number++;
            return true;
          });
          return unique.length ? markDuplicateRecords([...old, ...unique]) : old;
        });
      } catch (error) { console.error('Unable to read Android scan', error); }
      finally { importingAndroid.current = false; }
    }
    void refreshAndroid();
    const timer = window.setInterval(() => void refreshAndroid(), 2500);
    window.addEventListener('android-scan-updated', refreshAndroid);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('android-scan-updated', refreshAndroid); };
  }, [inventoryLoaded]);

  useEffect(() => {
    setDeleteReviewConfirm(false);
    setManualCrop({ x: 0, y: 0, width: 100, height: 100 });
    if (reviewModalRef.current) reviewModalRef.current.scrollTop = 0;
    setCropZoom(1);
    setReviewSplit(null);
    setManualImei(selected?.imei || '');
    setManualSerial(selected ? recordSerial(selected) : '');
    setManualImei2(selected ? recordImeiPair(selected).imei2 : '');
    setManualModel(selected ? exportModel(selected.model) : '');
    setReviewSource(selected?.originalDataUrl || selected?.dataUrl || '');
    setCropEditorOpen(cropRequestedId.current === selected?.id);
    cropRequestedId.current = null;
    if (selected && androidBridge?.sourceImage && !selected.originalDataUrl) {
      const original = androidBridge.sourceImage(selected.id);
      if (original) setReviewSource(original);
    }
  }, [selected?.id]);

  function cropPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) };
  }

  function drawCrop(event: ReactPointerEvent<HTMLDivElement>) {
    if (!cropStart.current) return;
    const point = cropPoint(event), start = cropStart.current;
    if (start.edge && start.initial) {
      const right = start.initial.x + start.initial.width;
      const bottom = start.initial.y + start.initial.height;
      const left = start.edge.includes('w') ? Math.min(point.x, right - 1) : start.initial.x;
      const top = start.edge.includes('n') ? Math.min(point.y, bottom - 1) : start.initial.y;
      const newRight = start.edge.includes('e') ? Math.max(point.x, left + 1) : right;
      const newBottom = start.edge.includes('s') ? Math.max(point.y, top + 1) : bottom;
      setManualCrop({ x: left, y: top, width: newRight - left, height: newBottom - top });
      return;
    }
    setManualCrop({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
  }

  function openCropReview(record: RecordItem) {
    cropRequestedId.current = record.id;
    openReview(record);
    setCropEditorOpen(true);
  }

  function closeCropEditor() {
    if (adjustingCrop) return;
    setCropEditorOpen(false);
    if (reviewSplit) {
      setReviewSplit(null);
      if (guidedCropWorker.current) { void guidedCropWorker.current.terminate(); guidedCropWorker.current = null; }
    }
  }

  function closePhotoReview() {
    if (adjustingCrop || rotatingPhoto) return;
    closeCropEditor();
    setSelected(null);
  }

  // Back button / swipe-back closes the top popup instead of leaving the app.
  useBackLayer(!!selected, closePhotoReview, 'review');
  useBackLayer(cropEditorOpen, closeCropEditor, 'crop');
  useBackLayer(shareIds.length > 0, () => { if (!sharing) setShareIds([]); }, 'share');

  useEffect(() => {
    if (!cropEditorOpen || !selected || manualCrop.width < 1 || manualCrop.height < 1 || manualCrop.width >= 100 && manualCrop.height >= 100) {
      setCropDraftPreview('');
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void createCroppedPhotos(reviewSource || selected.originalDataUrl || selected.dataUrl,
        [{ imei: 'preview', ...manualCrop }], 100, 100)
        .then(photos => { if (!cancelled) setCropDraftPreview(photos.get('preview') || ''); })
        .catch(() => { if (!cancelled) setCropDraftPreview(''); });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [cropEditorOpen, selected?.id, reviewSource, manualCrop.x, manualCrop.y, manualCrop.width, manualCrop.height]);

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

  const visible = records.filter(r =>
    (filter === 'All' ||
      (filter === 'Duplicates' ? r.duplicate :
        filter === 'Review' ? reviewStatus(r).includes('Needs review') :
          r.model === filter)) &&
    (`${r.name} ${r.model} ${r.imei}`)
      .toLowerCase()
      .includes(query.toLowerCase()) &&
    (personFilter === 'All' || r.personId === personFilter)
  );
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(recordPage, pageCount);
  const pageRows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
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
      if (!direction || reviewIndex < 0 || adjustingCrop || rotatingPhoto || reviewSplit) return;
      if (manualModel !== exportModel(selected!.model) || manualImei !== selected!.imei) { setToast('Save changes before moving to another record.'); return; }
      const next = reviewRecords[reviewIndex + direction];
      if (next) { event.preventDefault(); setSelected(next); }
    }
    document.addEventListener('keydown', handleReviewKeys);
    return () => document.removeEventListener('keydown', handleReviewKeys);
  }, [selected, reviewIndex, reviewRecords, adjustingCrop, rotatingPhoto, reviewSplit, manualModel, manualImei]);
  function openReview(record: RecordItem) {
    setReviewIds(visible.map(item => item.id));
    setSelected(record);
  }
  function deleteRecord(record: RecordItem, fromReview = false, confirmed = false) {
    if (!confirmed && !window.confirm(`Delete record #${record.number} and its saved picture?`)) return;
    const next = fromReview ? reviewRecords[reviewIndex + 1] || reviewRecords[reviewIndex - 1] : null;
    setRecords(old => markDuplicateRecords(old.filter(item => item.id !== record.id)));
    setSelectedIds(old => old.filter(id => id !== record.id));
    setReviewIds(old => old.filter(id => id !== record.id));
    if (fromReview) { closeCropEditor(); setSelected(next || null); }
    setToast(`Record #${record.number} deleted.`);
  }
  const allVisibleSelected = visible.length > 0 &&
    visible.every(r => selectedIdSet.has(r.id));
  function addPersonGroup() {
    const next = personGroups.length + 1;
    const person = {
      id: `person-${newId()}`,
      label: `Person ${next}`,
      name: ''
    };
    setPersonGroups(old => [...old, person]);
    setActivePersonId(person.id);
    setPersonFilter(person.id);
  }

  function renamePerson(id: string, name: string) {
    setPersonGroups(old => old.map(person => person.id === id ? { ...person, name } : person));
  }

  function assignPerson(recordId: string, personId: string) {
    setRecords(old => old.map(record => record.id === recordId ? { ...record, personId } : record));
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

    const accepted = Array.from(list).filter(f =>
      f.type.startsWith('image/')
    );

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

    try {
      const scanFiles = await uniqueUploadPhotos(inputFiles);
      if (stopScanRequested.current) { if(capturedFiles)setFiles(old=>[...old,...capturedFiles]);setToast('Scan stopped. Photos remain in the queue.'); return; }
      const skippedPhotos = inputFiles.length - scanFiles.length;
      const uploadBatchId = newId();
      worker = await createWorker('eng');

      let newRows: RecordItem[] = [];
      let addedCount = 0;
      let needsReviewCount = 0;
      let failedFiles = 0;
      let skippedImeis = 0;
      let skippedSerials = 0;
      const seenSerials = new Set<string>();
      const seenImeis = new Set<string>();
      let processedFiles = 0;
      let nextNumber = records.reduce((max, record) => Math.max(max, record.number), 2) + 1;

      for (let i = 0; i < scanFiles.length; i++) {
        if (stopScanRequested.current) break;
        const file = scanFiles[i];
        const beforeCount = newRows.length;
        const fileImeis = new Set<string>();
        const fileSerials = new Set<string>();

        setProgress(
          `Scanning ${i + 1} of ${scanFiles.length}: ${file.name}`
        );
        try {

        const { color, enhanced: ocrImage } = await createScanImages(file, scanMode === 'fast' ? 1600 : scanMode === 'detailed' ? 3000 : 2400);
        const dataUrl = color.toDataURL('image/jpeg', 0.9);
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          user_defined_dpi: '300'
        });

        const enhancedResult = await worker.recognize(ocrImage);
        let raw = enhancedResult.data.text || '';
        let imeis = extractImei1s(raw);
        let lines = scaleOcrLines(ocrLines(enhancedResult.data), ocrImage, color);
        const sourceWidth = color.width;
        const sourceHeight = color.height;

        if (scanMode === 'detailed' || (scanMode === 'standard' && (imeis.length === 0 || (imeis.length === 1 && !luhnValid(imeis[0]))))) {
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
        const mostlyWhite = looksMostlyWhite(color);
        const codesInside = (region?: { x: number; y: number; width: number; height: number }) => fullPhotoCodes.filter(code => { const b = code.boundingBox; if (!b) return false; if (!region) return true; const cx = b.x + b.width / 2, cy = b.y + b.height / 2; return cx >= region.x && cx <= region.x + region.width && cy >= region.y && cy <= region.y + region.height; }).map(code => code.rawValue);
        let anchors=deviceAnchors(lines,sourceWidth,sourceHeight);
        const multiText=hasMultipleDeviceText(raw);
        const frame=color.getContext('2d')?.getImageData(0,0,sourceWidth,sourceHeight);
        if(frame)anchors=deviceAnchors(lines,sourceWidth,sourceHeight,frame);
        const regions=planDeviceCrops(anchors,lines,sourceWidth,sourceHeight,frame);
        let croppedPhotos=new Map<string,string>();
        if(regions.length>1){try{croppedPhotos=await createCroppedPhotos(color,regions,sourceWidth,sourceHeight);}catch(error){console.error('Unable to split labels',error);}}
        const cropNeedsReview=(anchors.length>1&&regions.length<2)||(regions.length>1&&croppedPhotos.size!==regions.length)||(regions.length<2&&multiText);
        const cropKeys=croppedPhotos.size?[...croppedPhotos.keys()]:[''];

        const pictureId = `PIC-${newId().slice(0, 8).toUpperCase()}`;
        for (const detectedImei of cropNeedsReview ? [''] : cropKeys) {
        const region = regions.find(item => item.imei === detectedImei);
        const cropDataUrl = croppedPhotos.get(detectedImei);
        const cropResult = cropDataUrl ? await readCropImei(worker, cropDataUrl, scanMode) : { raw, imei: extractPreferredImei(raw), lines };
        let cropRaw = await cameraBarcodeText(cropDataUrl || dataUrl, cropResult.raw, cropResult.lines, codesInside(cropDataUrl ? region : undefined));
        if (scanMode !== 'fast' && !cropNeedsReview) cropRaw = await refineCropText(worker, cropDataUrl || dataUrl, cropRaw, cropResult.lines);
        if (!cropNeedsReview && !extractPreferredImei(cropRaw) && !extractSerial(cropRaw)) { const serialRaw = await readSerialPhoto(worker, cropDataUrl || dataUrl); if (serialRaw) cropRaw = serialRaw; }
        // Possibly several devices but only one IMEI 1 was read: keep it (the
        // record still asks "1 device or N?"). Several different IMEI 1s stay blank.
        const readableImei1s = [...new Set([barcodeImei(cropRaw, 1), ...extractImei1s(cropRaw).filter(luhnValid)].filter(Boolean))];
        const imei = cropNeedsReview ? (readableImei1s.length === 1 ? readableImei1s[0] : '') : extractPreferredImei(cropRaw);
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
        const regionText = region && cropDataUrl ? lines.filter(line => {
          const x = (line.bbox.x0 + line.bbox.x1) / 2;
          const y = (line.bbox.y0 + line.bbox.y1) / 2;
          return x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
        }).map(line => line.text).join('\n') : raw;
        const model = identifyModel(cropRaw, file.name, mostlyWhite);
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
          cropNeedsReview: cropNeedsReview || (!!region?.needsReview && barcodeImei(cropRaw, 1) !== imei) || imeiReadingsDisagree(cropRaw, imei),
          imei2: recordImeiPair({ imei, raw: cropRaw } as RecordItem).imei2,
          ...(cropNeedsReview ? (() => { const found = extractImei1s(raw).filter(luhnValid); return { deviceCount: Math.max(2, anchors.length, found.length), deviceImeis: found }; })() : {}),
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
          await saveOriginalSource(pictureId, file);
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
        }
        setCompletedFiles(i + 1);
        processedFiles = i + 1;
        if (i % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
      }

      await worker.terminate();
      worker = null;

      addedCount += newRows.length;
      needsReviewCount += newRows.filter(row => row.status !== 'Valid' || row.cropNeedsReview).length;
      if (newRows.length) setRecords(old => markDuplicateRecords([...old, ...newRows]));
      if (!capturedFiles) setFiles(stopScanRequested.current ? scanFiles.slice(processedFiles) : []);
      else if (failedFiles) setFiles(old => [...old, ...capturedFiles]);
      else if (stopScanRequested.current) setFiles(old => [...old, ...scanFiles.slice(processedFiles)]);

      const reviewMessage = needsReviewCount
        ? ` ${needsReviewCount} need review; open a record to see the OCR text.`
        : '';

      setToast(`${stopScanRequested.current ? 'Scan stopped.' : 'Finished scanning'} ${addedCount} record(s) in ${Math.round((performance.now() - startedAt) / 1000)} seconds.${skippedPhotos ? ` Removed ${skippedPhotos} repeated photo(s).` : ''}${skippedImeis ? ` Removed ${skippedImeis} repeated IMEI row(s).` : ''}${skippedSerials ? ` Removed ${skippedSerials} repeated serial row(s).` : ''}${reviewMessage}${failedFiles ? ` ${failedFiles} file(s) could not be read.` : ''}`);
    } catch (e) {
      console.error(e);
      if(capturedFiles)setFiles(old=>[...old,...capturedFiles]);
      setToast('Scanning failed. Captured photos stay in the upload queue for retry. Check your connection for OCR resources, or try Phone camera and a clearer label.');
    } finally {
      if (worker) await worker.terminate();

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

  function saveReviewFields(advance = false) {
    if (!selected || adjustingCrop || rotatingPhoto || reviewSplit) return;
    if (manualImei && !/^\d{15}$/.test(manualImei)) { setToast('Enter all 15 IMEI digits or leave it empty.'); return; }
    if (manualImei2 && !/^\d{15}$/.test(manualImei2)) { setToast('Enter all 15 IMEI 2 digits or leave it empty.'); return; }
    const imeiChanged = manualImei !== selected.imei;
    const latestBatch = records.filter(r => r.uploadBatchId).reduce<RecordItem | undefined>((current, row) => !current || row.createdAt > current.createdAt ? row : current, undefined)?.uploadBatchId;
    const duplicate = !!manualImei && !!latestBatch && selected.uploadBatchId === latestBatch && records.some(r => r.id !== selected.id && r.uploadBatchId === latestBatch && r.imei === manualImei);
    const patch: Partial<RecordItem> = { imei2: manualImei2, serial: manualSerial.trim(), serialNeedsReview: false, model: manualModel.trim() || 'Unknown unit — review', imei: manualImei, duplicate, status: manualImei ? (luhnValid(manualImei) ? 'Valid' : 'Invalid') : 'Review', ...(imeiChanged && manualImei ? { cropNeedsReview: false } : {}) };
    updateRow(selected.id, patch);
    if (advance && reviewIndex >= 0 && reviewIndex < reviewRecords.length - 1) {
      setSelected(reviewRecords[reviewIndex + 1]);
      document.getElementById('manual-model')?.focus();
    } else {
      setSelected({ ...selected, ...patch });
      setManualModel(exportModel(patch.model || ''));
    }
    setToast(duplicate ? 'Saved. Duplicate IMEI flagged; both pictures are kept.' : patch.status === 'Invalid' ? 'Saved. The IMEI checksum needs review.' : 'Saved.');
  }

  async function applyManualCrop(addAnother = false) {
    if (!selected || adjustingCrop) return;
    const { x, y, width, height } = manualCrop;
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100 || y + height > 100) {
      setToast('Crop values must fit within the picture.');
      return;
    }
    setAdjustingCrop(true);
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      const source = reviewSource || selected.originalDataUrl || selected.dataUrl;
      const photos = await createCroppedPhotos(source, [{ imei: 'manual', x, y, width, height }], 100, 100);
      const cropDataUrl = photos.get('manual')!;
      let raw = '', imei = '';let barcodeLines:OcrLine[]=[];
      try {
        worker = await createWorker('eng');
        ({ raw, imei, lines:barcodeLines } = await readCropImei(worker, cropDataUrl));
        raw = await cameraBarcodeText(cropDataUrl, raw, barcodeLines); imei = cameraImei(raw);
      } catch (error) { console.warn('Crop saved without automatic text reading', error); }
      const patch: Partial<RecordItem> = { dataUrl: source, originalDataUrl: source, cropDataUrl, imei, raw, ...serialReading(raw), cropNeedsReview: !imei && !serialReading(raw).serial, status: imei ? (luhnValid(imei) ? 'Valid' : 'Invalid') : 'Review' };
      if (addAnother) {
        const sourcePictureId = selected.sourcePictureId || `PIC-${newId().slice(0, 8).toUpperCase()}`;
        const added: RecordItem = { ...selected, ...patch, id: newId(), pictureId: `PIC-${newId().slice(0, 8).toUpperCase()}`, sourcePictureId, number: Math.max(2, ...records.map(r => r.number)) + 1, duplicate: false, createdAt: new Date().toISOString() };
        setRecords(old => markDuplicateRecords([...old.map(r => r.id === selected.id ? { ...r, sourcePictureId } : r), added]));
        setReviewIds(old => { const index = old.indexOf(selected.id); return index < 0 ? [...old, added.id] : [...old.slice(0, index + 1), added.id, ...old.slice(index + 1)]; });
        setSelected(added);
        setCropEditorOpen(false);
        setToast(imei ? 'Another crop added as a new record.' : 'Another crop added. Its IMEI needs review.');
      } else {
        updateRow(selected.id, patch);
      setSelected({ ...selected, ...patch });
      setManualImei(imei);
      setCropEditorOpen(false);
        setToast(imei ? 'Crop saved. Draw another box and choose Add another crop if needed.' : 'Crop saved. Its IMEI needs review.');
      }
    } catch (error) {
      console.error(error);
      setToast('Could not adjust the crop. Please try again.');
    } finally {
      if (worker) await worker.terminate();
      setAdjustingCrop(false);
    }
  }

  async function rotateSelectedPhoto(direction: 'left' | 'right') {
    if (!selected || rotatingPhoto || adjustingCrop) return;
    setRotatingPhoto(true);
    try {
      const [dataUrl, cropDataUrl] = await Promise.all([
        rotatePhoto(reviewSource || selected.dataUrl, direction),
        selected.cropDataUrl ? rotatePhoto(selected.cropDataUrl, direction) : Promise.resolve(undefined)
      ]);
      const patch = { dataUrl, cropDataUrl, originalDataUrl: dataUrl };
      setRecords(old => old.map(r => r.id === selected.id ? { ...r, ...patch } : r));
      setSelected({ ...selected, ...patch });
      setReviewSource(dataUrl);
      setReviewSplit(null);
      setManualCrop({ x: 0, y: 0, width: 100, height: 100 });
      setToast('Photo rotated. Adjust the crop and read the IMEI again if needed.');
    } catch (error) {
      console.error(error);
      setToast('Could not rotate the photo. Please try again.');
    } finally { setRotatingPhoto(false); }
  }

  async function saveReviewCrop() {
    if (!selected || !reviewSplit || reviewSplit.recordId !== selected.id || adjustingCrop) return;
    const { x, y, width, height } = manualCrop;
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100.001 || y + height > 100.001) {
      setToast('Draw a box inside the photo first.');
      return;
    }
    if (width >= 99.99 && height >= 99.99) {
      setToast('Draw a box around one label before saving.');
      return;
    }
    setAdjustingCrop(true);
    try {
      const source = reviewSource || selected.originalDataUrl || selected.dataUrl;
      const photos = await createCroppedPhotos(source, [{ imei: 'manual', x, y, width, height }], 100, 100);
      const cropDataUrl = photos.get('manual')!;
      let raw = '', imei = '';let barcodeLines:OcrLine[]=[];
      try {
        if (!guidedCropWorker.current) guidedCropWorker.current = await createWorker('eng');
        ({ raw, imei, lines:barcodeLines } = await readCropImei(guidedCropWorker.current, cropDataUrl));
        raw = await cameraBarcodeText(cropDataUrl, raw, barcodeLines); imei = cameraImei(raw);
      } catch (error) { console.warn('Crop saved without automatic text reading', error); }
      const crops = [...reviewSplit.crops, { cropDataUrl, imei, model: manualModel.trim() || selected.model, raw }];
      setReviewSplit({ ...reviewSplit, crops });
      setManualCrop({ x: 0, y: 0, width: 100, height: 100 });
      setToast(crops.length < reviewSplit.target ? `Crop ${crops.length} saved. Select the next label.` : 'All crops saved. Check their IMEI and model, then finish.');
    } catch (error) {
      console.error(error);
      setToast('Could not read this crop. Please try again.');
    } finally {
      if (reviewSplit.crops.length + 1 >= reviewSplit.target && guidedCropWorker.current) { await guidedCropWorker.current.terminate(); guidedCropWorker.current = null; }
      setAdjustingCrop(false);
    }
  }

  /** Answer to "1 device or N?": keep one record and use the first readable IMEI 1. */
  function confirmSingleDevice() {
    if (!selected) return;
    const imei = selected.imei || selected.deviceImeis?.[0] || '';
    updateRow(selected.id, { cropNeedsReview: false, deviceCount: undefined, deviceImeis: undefined, imei, status: imei ? (luhnValid(imei) ? 'Valid' : 'Invalid') : 'Review' });
    setManualImei(imei);
    setToast(imei ? 'Kept as one device.' : 'Kept as one device. Enter the IMEI or serial.');
  }

  function finishReviewSplit() {
    if (!selected || !reviewSplit || reviewSplit.crops.length !== reviewSplit.target) return;
    if (reviewSplit.crops.some(crop => crop.imei && !/^\d{15}$/.test(crop.imei))) {
      setToast('Enter all 15 IMEI digits, or leave the field empty for review.');
      return;
    }
    const source = reviewSource || selected.originalDataUrl || selected.dataUrl;
    const sourcePictureId = selected.sourcePictureId || `PIC-${newId().slice(0, 8).toUpperCase()}`;
    const nextNumber = Math.max(2, ...records.map(r => r.number)) + 1;
    const replacements: RecordItem[] = reviewSplit.crops.map((crop, index) => ({
      ...selected, id: newId(), pictureId: `PIC-${newId().slice(0, 8).toUpperCase()}`,
      sourcePictureId, number: index === 0 ? selected.number : nextNumber + index - 1,
      dataUrl: source, originalDataUrl: source, cropDataUrl: crop.cropDataUrl,
      ...serialReading(crop.raw), imei: crop.imei, model: crop.model.trim() || 'Unknown unit — review', raw: crop.raw,
      cropNeedsReview: !crop.imei && !serialReading(crop.raw).serial, status: crop.imei ? (luhnValid(crop.imei) ? 'Valid' : 'Invalid') : 'Review',
      duplicate: false, createdAt: new Date().toISOString(), deviceCount: undefined, deviceImeis: undefined
    }));
    setRecords(old => markDuplicateRecords(old.flatMap(r => r.id === selected.id ? replacements : [r])));
    setSelectedIds(old => old.filter(id => id !== selected.id));
    setReviewSplit(null);
    setCropEditorOpen(false);
    setSelected(null);
    setToast(`${replacements.length} cropped records saved. The original record was replaced.`);
  }

  function requestGoogleToken(onToken: (token: string) => void) {
    if (!CLIENT_ID) {
      setToast('Google Sheets and Drive links need Google setup. Turn off Drive links to export locally.');
      return;
    }

    const w = window as any;
    if (!w.google?.accounts?.oauth2) {
      setToast('Google authorization is not available. Check the Google setup and refresh.');
      return;
    }

    const client = w.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
      callback: async (resp: any) => {
        if (resp.access_token) {
          onToken(resp.access_token);
        } else {
          setToast('Google authorization was not completed.');
        }
      }
    });

    client.requestAccessToken();
  }

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
    const rows = (selectedRows.length ? selectedRows : visible).slice(0, 500);
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
        const list = rows.map((row, index) => { const pair = recordImeiPair(row), serial = recordSerial(row); return `${index + 1}. ${[pair.imei1 && `IMEI 1 ${pair.imei1}`, pair.imei2 && `IMEI 2 ${pair.imei2}`, serial && `S/N ${serial}`].filter(Boolean).join('  ') || 'No number detected'}`; }).join('\r\n');
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
  const SHARE_BATCH=10;
  const shareBatches=Array.from({length:Math.ceil(shareRows.length/SHARE_BATCH)},(_,i)=>shareRows.slice(i*SHARE_BATCH,(i+1)*SHARE_BATCH));
  /** One message with every number, numbered in the same order as the pictures. */
  const bulkShareText=shareRows.map((row,index)=>{
    const serial=recordSerial(row),line=shareMode==='imei_serial'?[row.imei,serial&&`S/N ${serial}`].filter(Boolean).join('  '):row.imei||(serial?`S/N ${serial}`:'');
    return `${index+1}. ${line||'No number detected'}`;
  }).join('\n');
  function bulkPictureFiles(batch:RecordItem[]){
    return buildSharePackage(batch.map(row=>({number:row.number,pictureId:row.pictureId,model:'',imei:row.imei,serial:recordSerial(row),photo:recordPhoto(row)})),shareMode).entries.map((entry,index)=>new File([entry.file],`${shareRows.indexOf(batch[index])+1}.jpg`,{type:entry.file.type}));
  }
  function nativeShareBulk(kind:'pictures'|'text',batchIndex=0){
    if(sharing)return;
    try{
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
    try{for(const file of bulkPictureFiles(batch)){saveDirectFile(file,file.name);await new Promise(resolve=>setTimeout(resolve,400));}setShareStatus(`${batch.length} picture(s) downloaded. Attach them in your chat.`);}
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
    if (!selectedRows.length || !window.confirm(`Delete ${selectedRows.length} selected record(s)? This removes their saved photos and IMEIs from this browser.`)) return;
    const ids = new Set(selectedRows.map(record => record.id));
    setRecords(old => {
      const remaining = old.filter(record => !ids.has(record.id));
      return markDuplicateRecords(remaining);
    });
    setSelectedIds([]);
    setSelectedOnly(false);
    setSelected(null);
    setToast('Selected records deleted.');
  }

  return (
    <div className="app">
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
          <span className="local-pill">
            <span /> {storageWarning ? 'Some records not saved' : 'Stored on this device'}
          </span>
        </div>
      </header>

      {cameraOpen && <CameraCapture onClose={() => setCameraOpen(false)} onCapture={batch => void scan(batch)} />}
      <main className={collapsedPanels.length ? 'compact-page' : ''}>
        <nav className="quick-navigation" aria-label="Quick navigation"><button onClick={() => setCollapsedPanels(collapsedPanels.length === 3 ? [] : ['upload','export','records'])}>{collapsedPanels.length === 3 ? 'Expand all' : 'Minimize all'}</button><button onClick={() => goToPanel('upload')}>Upload</button><button onClick={() => goToPanel('export')}>Export</button><button onClick={() => goToPanel('records')}>Records</button><button disabled={busy || !inventoryLoaded} onClick={() => setCameraOpen(true)}>📷 Camera</button></nav>
        {storageWarning && <div className="storage-warning" role="alert">{storageWarning}</div>}
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

        <section className="stats">
          <div className="stat">
            <span>SCANNED RECORDS</span>
            <strong>{records.length}</strong>
            <small><ImageIcon size={13} /> Saved locally</small>
          </div>

          <div className="stat">
            <span>VALID IMEI</span>
            <strong className="green">{validCount}</strong>
            <small><CheckCircle2 size={13} /> Luhn checksum passed</small>
          </div>

          <div className="stat">
            <span>NEEDS REVIEW</span>
            <strong className="amber">{reviewCount}</strong>
            <small><AlertTriangle size={13} /> Check photo or IMEI</small>
          </div>

          <div className="stat">
            <span>MODELS</span>
            <strong>{models.filter(([model]) => !!exportModel(model)).length}</strong>
            <small><Smartphone size={13} /> Identified model groups</small>
          </div>
        </section>

        <section className="workspace">
          <div id="upload" className={`panel upload-panel ${collapsedPanels.includes('upload') ? 'is-collapsed' : ''}`}><button className="panel-toggle" aria-expanded={!collapsedPanels.includes('upload')} onClick={() => togglePanel('upload')}>{collapsedPanels.includes('upload') ? '▸' : '▾'} Upload photos {collapsedPanels.includes('upload') ? '— expand' : '— minimize'}</button>
            <div className="section-head">
              <div>
                <div className="eyebrow">STEP 01</div>
                <h2>Upload photos</h2>
              </div>
              <span className="tag">BULK UPLOAD</span>
            </div>

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

            {androidBridge && <p className="micro">The browser upload below runs only while this screen is open. Use the button above for background scans.</p>}

            <SamsungCatalog />
            <button className="subtle-btn" disabled={busy || !inventoryLoaded} onClick={() => setCameraOpen(true)}>Scan with camera</button>

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
            <p className="scan-mode-note">
              {scanMode === 'fast' ? 'One OCR pass per photo. Review missed or unclear IMEIs manually.' :
                scanMode === 'standard' ? 'Runs another pass only when the first result needs it.' :
                  'Checks every photo twice and retries unclear crops. Best for photos with several labels.'}
            </p>

            <button
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
                  {androidBridge ? `Quick scan ${files.length || 0} photo(s) while open` : useBackgroundByDefault ? `Scan ${files.length || 0} photo(s) in background` : `Extract IMEI from ${files.length || 0} photo(s)`}
                </>
              )}
            </button>

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
          </div>

          <div id="export" className={`panel export-panel ${collapsedPanels.includes('export') ? 'is-collapsed' : ''}`}><button className="panel-toggle" aria-expanded={!collapsedPanels.includes('export')} onClick={() => togglePanel('export')}>{collapsedPanels.includes('export') ? '▸' : '▾'} Export inventory {collapsedPanels.includes('export') ? '— expand' : '— minimize'}</button>
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
                    <span><strong>#{record.number} · {record.imei || 'No IMEI'}</strong><small>{exportModel(record.model) || 'Unknown model'} · {record.pictureId}</small></span>
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
                  <button key={record.id} className="subtle-btn" onClick={() => saveDirectFile(dataUrlBlob(recordPhoto(record)), photoFilename(record).replace(/^#/, 'photo-'))}>
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
        </section>

        <section id="records" className={`results panel ${collapsedPanels.includes('records') ? 'is-collapsed' : ''}`}><button className="panel-toggle" aria-expanded={!collapsedPanels.includes('records')} onClick={() => togglePanel('records')}>{collapsedPanels.includes('records') ? '▸' : '▾'} Scanned records {collapsedPanels.includes('records') ? '— expand' : '— minimize'}</button>
          <div className="results-top">
            <div>
              <div className="eyebrow">STEP 03</div>
              <h2>
                Scanned records <span className="count">{records.length}</span>
              </h2>
            </div>

            <div className="result-actions">
              <select className="model-filter" aria-label="Filter scanned records by model" value={filter} onChange={event => setFilter(event.target.value)}>
                <option value="All">All models</option>
                {models.map(([model]) => <option key={model} value={model}>{model}</option>)}
                <option value="Review">Needs review</option>
              </select>
              <label className="search">
                <Search size={15} />
                <input
                  aria-label="Search IMEI or model"
                  placeholder="Search IMEI or model…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </label>

              <button
                className="subtle-btn"
                onClick={() => {
                  setFiles([]);
                  inputRef.current?.click();
                }}
              >
                <RefreshCw size={15} /> Add more
              </button>
              <button className="subtle-btn view-toggle" aria-pressed={simpleView} onClick={() => setSimpleView(old => !old)}>
                {simpleView ? 'Detailed view' : 'Simple view'}
              </button>
            </div>
          </div>

          {!simpleView && <div className="filters">
            <button
              className={filter === 'All' ? 'active' : ''}
              onClick={() => setFilter('All')}
            >
              All devices <b>{records.length}</b>
            </button>

            {models.map(([m, n]) => (
              <button
                key={m}
                className={filter === m ? 'active' : ''}
                onClick={() => setFilter(m)}
              >
                {m} <b>{n}</b>
              </button>
            ))}

            <button
              className={filter === 'Review' ? 'active' : ''}
              onClick={() => setFilter('Review')}
            >
              Needs review
            </button>

          </div>}

          <div className="people-controls">
            <div className="people-setup">
              <strong>Group IMEIs by person</strong>
              <label>
                New scans go to
                <select value={activePersonId} onChange={e => setActivePersonId(e.target.value)}>
                  {personGroups.map(person => (
                    <option key={person.id} value={person.id}>{person.label}</option>
                  ))}
                </select>
              </label>
              <input
                aria-label="Name for selected person group"
                placeholder="Add name for this person"
                value={personGroups.find(person => person.id === activePersonId)?.name || ''}
                onChange={e => renamePerson(activePersonId, e.target.value)}
              />
              <button className="subtle-btn" onClick={addPersonGroup}>+ Add person</button>
              <button className="subtle-btn" disabled={!visible.length} onClick={toggleVisibleSelection}>
                {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
              </button>
              <button className="subtle-btn" disabled={!selectedRows.length} onClick={()=>{openSharing(selectedRows.map(row=>row.id));}}>Share selected ({selectedRows.length})</button>
              <button className="primary share-all-btn bulk-download-btn" disabled={!visible.length || bulkBusy} onClick={bulkDownloadPictures}><Download size={16} /> {bulkBusy ? 'Saving pictures…' : `Download all pictures (${Math.min(selectedRows.length || visible.length, 500)})`}</button>
              <button className="primary share-all-btn" disabled={!visible.length} onClick={()=>openSharing(visible.slice(0,200).map(row=>row.id))}>Share all ({Math.min(visible.length,200)}) — pictures + numbers</button>
              <button className="subtle-btn delete-selected" disabled={!selectedRows.length} onClick={deleteSelected}>
                <Trash2 size={14} /> Delete selected ({selectedRows.length})
              </button>
            </div>
            <div className="person-filters">
              <button
                className={personFilter === 'All' ? 'active' : ''}
                onClick={() => setPersonFilter('All')}
              >All people</button>
              {personGroups.map(person => (
                <button
                  key={person.id}
                  className={personFilter === person.id ? 'active' : ''}
                  onClick={() => setPersonFilter(person.id)}
                >
                  {person.label}{person.name ? ` · ${person.name}` : ''}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <div><ScanLine size={28} /></div>
              <strong>
                {records.length
                  ? 'No matching records'
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
              {pageRows.map(record => <article className="simple-record" key={record.id}>
                <input className="selection-check" type="checkbox" aria-label={`Select photo #${record.number}`} checked={selectedIdSet.has(record.id)} onChange={() => toggleSelected(record.id)} />
                <button className="simple-record-photo" onClick={() => openReview(record)} aria-label={`View photo #${record.number}`}><img src={recordPhoto(record)} alt="" /></button>
                <div className="simple-record-info">
                  <label>Model <input aria-label={`Model for record ${record.number}`} value={exportModel(record.model)} onChange={e => updateRow(record.id, { model: e.target.value })} /></label>
                  <button className="subtle-btn" disabled={!exportModel(record.model)} onClick={() => void copyText(exportModel(record.model)).then(ok => setToast(ok ? 'Model copied.' : 'Copy failed.'))}>Copy model</button>
                  <label>IMEI <input aria-label={`IMEI for record ${record.number}`} inputMode="numeric" value={record.imei} onChange={e => { const imei = digits(e.target.value).slice(0, 15); updateRow(record.id, { imei, status: imei ? luhnValid(imei) ? 'Valid' : 'Invalid' : 'Review' }); }} /></label>
                  <button className="subtle-btn" disabled={!record.imei} onClick={() => void copyText(record.imei).then(ok => setToast(ok ? 'IMEI copied.' : 'Copy failed.'))}>Copy IMEI</button>
                  <label>Serial number <input aria-label={`Serial number for record ${record.number}`} value={recordSerial(record)} onChange={e => updateRow(record.id, { serial: e.target.value, serialNeedsReview: false })} /></label>
                  <button className="subtle-btn" disabled={!recordSerial(record)} onClick={() => void copyText(recordSerial(record)).then(ok => setToast(ok ? 'Serial number copied.' : 'Copy failed.'))}>Copy serial</button>
                  {reviewStatus(record) !== 'Valid' && <small>{reviewStatus(record)}</small>}
                </div>
                <div className="simple-record-actions">
                  <button className="subtle-btn" onClick={() => openReview(record)}>View</button>
                  <button className="subtle-btn" onClick={() => saveDirectFile(dataUrlBlob(recordPhoto(record)), photoFilename(record))}>Download photo</button>
                  <button className="subtle-btn" onClick={() => void copyText(`Model: ${exportModel(record.model)}\nIMEI: ${record.imei}\nSerial number: ${recordSerial(record)}`).then(ok => setToast(ok ? 'Record copied.' : 'Copy failed.'))}>Copy all</button>
                  <button className="subtle-btn" onClick={() => shareRecord(record)}>Share photo + number</button><button className="subtle-btn" onClick={() => openCropReview(record)}>Edit</button>
                  <button className="subtle-btn danger" onClick={() => deleteRecord(record)}>Delete</button>
                </div>
              </article>)}
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
                          aria-label={`Assign record #${r.number} to a person`}
                          value={r.personId}
                          onChange={e => assignPerson(r.id, e.target.value)}
                        >
                          {personGroups.map(person => (
                            <option key={person.id} value={person.id}>
                              {person.label}{person.name ? ` — ${person.name}` : ''}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td data-label="Model">
                        <input
                          className="inline-edit model-edit"
                          aria-label={`Model for record ${r.number}`}
                          value={r.model}
                          onChange={e =>
                            updateRow(r.id, { model: e.target.value })
                          }
                        />
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

                            if (imei.length === 15 && r.uploadBatchId && records.some(other => other.id !== r.id && other.uploadBatchId === r.uploadBatchId && other.imei === imei)) setToast('Matching IMEI in this upload flagged. Both pictures are kept.');

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
                            saveDirectFile(dataUrlBlob(recordPhoto(r)), photoFilename(r));
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
        </section>

        <footer>
          <span>IMEI LENS <i>•</i> Browser-based OCR</span>
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
            className={`modal ${cropEditorOpen ? 'crop-mode' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <div className="eyebrow">IMAGE REVIEW</div>
                <h2>{selected.name}</h2>
              </div>

              <div className="review-header-actions">
                <button className="iconbtn danger" aria-label="Delete this record" title="Delete this record" disabled={adjustingCrop || rotatingPhoto || !!reviewSplit} onClick={() => setDeleteReviewConfirm(true)}><Trash2 size={18} /></button>
                <button className="iconbtn" aria-label="Close photo review" onClick={closePhotoReview}><X /></button>
              </div>
            </div>

            {deleteReviewConfirm && <div className="review-delete-confirm" role="alertdialog" aria-label="Confirm record deletion">
              <strong>Delete record #{selected.number} and its picture?</strong>
              <div><button className="subtle-btn" onClick={() => setDeleteReviewConfirm(false)}>Cancel</button><button className="subtle-btn danger" onClick={() => deleteRecord(selected, true, true)}>Delete record</button></div>
            </div>}

            {!cropEditorOpen && <div className="review-photo-stage"><img className="preview" src={recordPhoto(selected)} alt="Selected record photo" /></div>}

            {!cropEditorOpen && reviewIndex >= 0 && <div className="review-navigation" aria-label="Navigate scanned records">
              <button className="subtle-btn" disabled={reviewIndex === 0 || adjustingCrop || rotatingPhoto || !!reviewSplit || manualModel !== exportModel(selected.model) || manualImei !== selected.imei} onClick={() => setSelected(reviewRecords[reviewIndex - 1])}>← Previous</button>
              <span>{reviewIndex + 1} of {reviewRecords.length}</span>
              <button className="subtle-btn" disabled={reviewIndex === reviewRecords.length - 1 || adjustingCrop || rotatingPhoto || !!reviewSplit || manualModel !== exportModel(selected.model) || manualImei !== selected.imei} onClick={() => setSelected(reviewRecords[reviewIndex + 1])}>Next →</button>
            </div>}

            {!cropEditorOpen && <div className="review-fixed-actions">
              <button className="subtle-btn" disabled={!selected.imei} onClick={() => void copyText(selected.imei).then(copied => setToast(copied ? 'IMEI copied.' : 'Could not copy IMEI.'))}><Copy size={16} /> Copy IMEI</button>
              <button className="primary" onClick={() => saveDirectFile(dataUrlBlob(recordPhoto(selected)), photoFilename(selected))}><Download size={16} /> Download photo</button>
              <button className="subtle-btn" onClick={() => setCropEditorOpen(true)}>Edit photo</button>
            </div>}

            {!cropEditorOpen && <div className="crop-actions" aria-label="Rotate photo">
              <button className="subtle-btn" disabled={rotatingPhoto || adjustingCrop || !!reviewSplit} onClick={() => void rotateSelectedPhoto('left')}>↶ Rotate left</button>
              <button className="subtle-btn" disabled={rotatingPhoto || adjustingCrop || !!reviewSplit} onClick={() => void rotateSelectedPhoto('right')}>↷ Rotate right</button>
            </div>}

            {!cropEditorOpen && <div className="manual-imei-entry">
              <label className="review-model" htmlFor="manual-model">Device model</label>
              <input id="manual-model" value={manualModel} onChange={event => setManualModel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); document.getElementById('manual-imei')?.focus(); } }} />
              <label htmlFor="manual-serial">Serial number (S/N)</label><input id="manual-serial" value={manualSerial} onChange={event => setManualSerial(event.target.value)} />
              <label htmlFor="manual-imei">IMEI 1</label>
              <input id="manual-imei" inputMode="numeric" maxLength={15} value={manualImei} onChange={event => setManualImei(digits(event.target.value).slice(0, 15))} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); saveReviewFields(true); } }} />
              <label htmlFor="manual-imei2">IMEI 2 <small>(dual-SIM, optional)</small></label>
              <input id="manual-imei2" inputMode="numeric" maxLength={15} value={manualImei2} onChange={event => setManualImei2(digits(event.target.value).slice(0, 15))} />
              <button className="primary" disabled={adjustingCrop || rotatingPhoto || !!reviewSplit} onClick={() => saveReviewFields()}>Save</button>
              <small>Enter moves to the next field, then saves and opens the next record. Use arrow keys to navigate when not typing.</small>
              {(manualModel !== exportModel(selected.model) || manualImei !== selected.imei) && <small>Save changes before moving to another record.</small>}
            </div>}

            <div className="modal-meta">
              <span>Picture ID: {selected.pictureId}</span>
              <button className="subtle-btn" onClick={() => shareRecord(selected)}>Share photo + number</button><p>Choose Samsung Promoter if it appears in your phone’s share menu. Otherwise copy the number and download the photo, then attach them in Sales Registration. Sharing does not confirm a sales submission. <a href="https://play.google.com/store/apps/details?id=com.samsung.promoter" target="_blank" rel="noreferrer">Samsung Promoter app details</a></p>
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

            {selected.cropDataUrl && (
              <details>
                <summary>View full original photo</summary>
                <img className="preview" src={reviewSource || selected.dataUrl} alt="Full original photo" />
              </details>
            )}

            {selected.cropNeedsReview && (selected.deviceCount || 0) > 1 && !cropEditorOpen && !reviewSplit && <div className="review-split-prompt device-question" role="group" aria-label="How many devices are in this photo">
              <strong>Is this 1 device or {selected.deviceCount}?</strong>
              <p>The scanner found {selected.deviceCount} possible devices{selected.deviceImeis?.length ? ` (IMEI 1: ${selected.deviceImeis.join(', ')})` : ''} but no clear gap between them, so it did not cut the photo.</p>
              <div className="review-split-start">
                <button className="subtle-btn" disabled={adjustingCrop} onClick={confirmSingleDevice}>1 device</button>
                <button className="primary" disabled={adjustingCrop} onClick={() => { setReviewCountInput(selected.deviceCount || 2); setCropEditorOpen(true); }}>{selected.deviceCount} devices — crop each</button>
              </div>
            </div>}
            {cropEditorOpen && !reviewSplit && <div className="review-split-prompt">
              <label htmlFor="review-crop-count">How many IMEI labels do you see in this photo?</label>
              <p>Choose a number, then draw one box per picture. Review the cropped photos before replacing the original record.</p>
              <div className="review-split-start"><input id="review-crop-count" type="number" inputMode="numeric" min="1" max="20" value={reviewCountInput} onChange={event => setReviewCountInput(Number(event.target.value))} />
                <button className="primary" disabled={adjustingCrop} onClick={() => {
                  if (!Number.isInteger(reviewCountInput) || reviewCountInput < 1 || reviewCountInput > 20) { setToast('Enter a number from 1 to 20.'); return; }
                  setReviewSplit({ recordId: selected.id, target: reviewCountInput, crops: [] });
                  setManualCrop({ x: 0, y: 0, width: 100, height: 100 });
                }}>Start cropping</button></div>
            </div>}
            <details id="crop-editor-panel" className="crop-workspace" open={cropEditorOpen}>
              <summary onClick={event => { if (cropEditorOpen) event.preventDefault(); else setCropEditorOpen(true); }}>Adjust crop</summary>
              <button className="subtle-btn crop-back" onClick={closeCropEditor}>← Back to record</button>
              <p>{reviewSplit ? reviewSplit.crops.length === reviewSplit.target ? 'Review each saved picture and its IMEI and model, then save the set.' : `Crop ${reviewSplit.crops.length + 1} of ${reviewSplit.target}: drag around the whole sticker or box face, including the IMEI and barcode.` : 'Drag around the whole sticker or box face, including the IMEI and barcode. Save this crop, or add another.'}</p>
              {selected.cropDataUrl && <div className="crop-saved-preview"><strong>Saved crop for this record</strong><img src={selected.cropDataUrl} alt="Saved crop for this record" /></div>}
              {(!reviewSplit || reviewSplit.crops.length < reviewSplit.target) && <><div className="crop-zoom-controls"><button className="subtle-btn" onClick={() => setCropZoom(old => Math.max(1, old - 0.5))} disabled={cropZoom <= 1}>− Zoom</button><span>{Math.round(cropZoom * 100)}%</span><button className="subtle-btn" onClick={() => setCropZoom(old => Math.min(3, old + 0.5))} disabled={cropZoom >= 3}>+ Zoom</button><button className="subtle-btn" disabled={rotatingPhoto || adjustingCrop || !!reviewSplit} onClick={() => void rotateSelectedPhoto('left')}>↶ Rotate</button><button className="subtle-btn" disabled={rotatingPhoto || adjustingCrop || !!reviewSplit} onClick={() => void rotateSelectedPhoto('right')}>↷ Rotate</button></div>
              <div className="crop-viewport"><div className="crop-editor" style={{ maxWidth: cropZoom > 1 ? 'none' : '100%' }} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const point = cropPoint(event); const edge = (event.target as HTMLElement).dataset.edge; cropStart.current = { ...point, edge, initial: { ...manualCrop } }; if (!edge) drawCrop(event); }} onPointerMove={drawCrop} onPointerUp={event => { drawCrop(event); cropStart.current = null; }} onPointerCancel={() => { cropStart.current = null; }}>
                <img src={reviewSource || selected.dataUrl} alt="Original photo: drag to select the whole sticker or box" draggable={false} style={{ maxHeight: `${cropZoom * 44}dvh`, maxWidth: cropZoom > 1 ? 'none' : '100%' }} />
                <div className="crop-selection" style={{ left: `${manualCrop.x}%`, top: `${manualCrop.y}%`, width: `${manualCrop.width}%`, height: `${manualCrop.height}%` }}>{(['nw', 'ne', 'sw', 'se'] as const).map(edge => <span key={edge} data-edge={edge} className={`crop-handle ${edge}`} />)}</div>
              </div></div>
              {cropDraftPreview && <div className="crop-draft-preview"><strong>Selected picture</strong><img src={cropDraftPreview} alt="Preview of selected crop" /></div>}
              <button className="subtle-btn" onClick={() => setManualCrop({ x: 0, y: 0, width: 100, height: 100 })}>Reset selection</button>
              <details><summary>Fine-tune selection</summary><div className="manual-crop-controls">
                {(['x', 'y', 'width', 'height'] as const).map(key => (
                  <label key={key}>{key} (%)<input type="number" min="0" max="100" value={Math.round(manualCrop[key] * 10) / 10} onChange={event => setManualCrop(old => ({ ...old, [key]: Number(event.target.value) }))} /></label>
                ))}
              </div></details>
              </>}
              {reviewSplit && reviewSplit.crops.length > 0 && <div className="review-crop-list">{reviewSplit.crops.map((crop, index) => <div key={index} className="saved-crop-card"><img src={crop.cropDataUrl} alt={`Saved crop ${index + 1}`} /><strong>Crop {index + 1}</strong><label>IMEI<input inputMode="numeric" maxLength={15} value={crop.imei} onChange={event => { const imei = digits(event.target.value).slice(0, 15); setReviewSplit(old => old ? { ...old, crops: old.crops.map((item, cropIndex) => cropIndex === index ? { ...item, imei } : item) } : old); }} /></label><label>Device model<input value={crop.model} onChange={event => { const model = event.target.value; setReviewSplit(old => old ? { ...old, crops: old.crops.map((item, cropIndex) => cropIndex === index ? { ...item, model } : item) } : old); }} /></label><small>{crop.imei ? luhnValid(crop.imei) ? 'Ready' : 'Check IMEI' : 'Needs review'}</small></div>)}</div>}
              <div className="crop-actions crop-sticky-actions">
                {reviewSplit ? <><button className="primary" disabled={adjustingCrop} onClick={() => reviewSplit.crops.length === reviewSplit.target ? finishReviewSplit() : void saveReviewCrop()}>{adjustingCrop ? 'Reading crop…' : reviewSplit.crops.length === reviewSplit.target ? `Save ${reviewSplit.target} pictures` : `Save crop ${reviewSplit.crops.length + 1} of ${reviewSplit.target}`}</button><button className="subtle-btn" disabled={adjustingCrop} onClick={closeCropEditor}>Cancel</button></> : <><button className="primary" disabled={adjustingCrop} onClick={() => void applyManualCrop(false)}>{adjustingCrop ? 'Reading crop…' : selected.cropDataUrl ? 'Save crop' : 'Save first crop'}</button>
                {selected.cropDataUrl && <button className="subtle-btn" disabled={adjustingCrop} onClick={() => void applyManualCrop(true)}>Add another crop</button>}</>}
                {!reviewSplit && <button className="subtle-btn" onClick={closeCropEditor}>Cancel</button>}
              </div>
            </details>

            <details>
              <summary>Raw OCR text</summary>
              <pre>{selected.raw || 'No text recognized.'}</pre>
            </details>
          </div>
        </div>
      )}

      {shareIds.length>0&&<div className="modal-backdrop share-backdrop"><section className="modal share-modal" role="dialog" aria-modal="true" aria-label="Share selected records">
       <div className="modal-head"><h2>{shareIds.length>1?`Share ${shareIds.length} records`:"Share record"}</h2><button className="subtle-btn" disabled={sharing} onClick={()=>setShareIds([])}>Close sharing</button></div>
       <label>Include <select aria-label="Sharing option" disabled={sharing} value={shareMode} onChange={e=>{setShareMode(e.target.value as ShareMode);setShareStep('picture');setShareIndex(0);setShareStatus('');}}><option value="imei">Picture + IMEI (or serial if no IMEI)</option><option value="imei_serial">Picture + IMEI + Serial Number</option></select></label>
       {bulkShare?<div className="share-bulk">
        <p><strong>{shareRows.length} records.</strong> Step 1: share the pictures, {SHARE_BATCH} at a time, to the same chat. Step 2: share the numbers as one separate message. Pictures and numbers use the same 1, 2, 3 order.</p>
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
      {toast && (
        <div className="toast">
          <AlertTriangle size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
