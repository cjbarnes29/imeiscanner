
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

type RecordItem = {
  id: string;
  pictureId: string;
  sourcePictureId?: string;
  number: number;
  personId: string;
  name: string;
  dataUrl: string;
  originalDataUrl?: string;
  cropDataUrl?: string;
  cropNeedsReview?: boolean;
  model: string;
  imei: string;
  status: 'Valid' | 'Invalid' | 'Review';
  duplicate: boolean;
  createdAt: string;
  raw: string;
};

type PersonGroup = { id: string; label: string; name: string };
type LaptopRecord = Omit<RecordItem, 'dataUrl'> & { imageName: string; photoIndex: number };

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

function removeDuplicateRecords(rows: RecordItem[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    if (!/^\d{15}$/.test(row.imei)) return true;
    if (seen.has(row.imei)) return false;
    seen.add(row.imei);
    return true;
  }).map(row => ({ ...row, duplicate: false }));
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
  const labelled = [...text.matchAll(/\bIMEI\s*(?:1|01)\s*[:#-]?\s*((?:\d[ -]*){15})(?![ -]*\d)/gi)]
    .map(match => digits(match[1]));
  return [...new Set(labelled)];
}

function extractPreferredImei(text: string) {
  const first = extractImei1s(text);
  if (first.length === 1) return first[0];
  if (first.length > 1) return '';
  const second = [...text.matchAll(/\bIMEI\s*(?:2|02)\s*[:#-]?\s*((?:\d[ -]*){15})(?![ -]*\d)/gi)].map(match => digits(match[1]));
  const unique = [...new Set(second)];
  return unique.length === 1 ? unique[0] : '';
}

function identifyModel(text: string, filename: string, mostlyWhite = false) {
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

function downloadBlob(blob: Blob, filename: string) {
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

async function readCropImei(worker: Awaited<ReturnType<typeof createWorker>>, cropDataUrl: string, mode: 'fast' | 'standard' | 'detailed' = 'detailed') {
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
  let raw = (await worker.recognize(cropDataUrl)).data.text || '';
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
  return { raw, imei: extractPreferredImei(raw) };
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
  layout?: 'simple' | 'person_photo'
) {
  if (layout) {
    const rich = layout === 'person_photo';
    const values = [
      ['IMEI', 'Model', ...(rich ? ['Assigned person', 'Download photo'] : [])],
      ...rows.map(r => [r.imei, exportModel(r.model), ...(rich ? [personTitle(r, people), photoLinks.has(r.id) ? `=HYPERLINK("${photoLinks.get(r.id)}","Download photo")` : ''] : [])])
    ];
    return '\uFEFF' + values.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  if (compact) {
    const values = [
      ['Model', 'IMEI', 'Duplicate', 'Download photo'],
      ...rows.map(r => [exportModel(r.model), r.imei, r.duplicate ? 'Yes' : 'No',
        photoLinks.has(r.id) ? `=HYPERLINK("${photoLinks.get(r.id)}","Download image")` : ''])
    ];
    return '\uFEFF' + values.map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  const values = [
    ['No.', 'Picture ID', 'Person', 'Person name', 'Image filename', 'Model', 'IMEI', 'Validation', 'Duplicate', 'Scanned at', 'Download photo'],
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

function photoFilename(r: RecordItem) {
  const ext = (r.cropDataUrl ? 'jpg' : r.name.split('.').pop() || 'jpg')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') || 'jpg';
  const original = safeFileName(r.name.replace(/\.[^.]+$/, ''));

  return `#${r.number}_${safeFileName(r.imei || 'IMEI_NOT_FOUND')}_${original}.${ext}`;
}

async function workbookImage(r: RecordItem) {
  const image = new Image();
  image.src = recordPhoto(r);
  await image.decode();

  const maxSize = 480;
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Could not prepare a photo for the workbook.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', 0.82);
}

async function createInventoryWorkbook(
  rows: RecordItem[],
  photoLinks = new Map<string, string>(),
  includePhotos = true,
  people = readPeople(),
  folderLink = '',
  compact = false,
  layout?: 'simple' | 'person_photo'
) {
  includePhotos = layout ? layout === 'person_photo' : includePhotos && !compact;
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
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

  const imageIds = new Map<string, number>();
  if (includePhotos) {
    for (const row of rows) {
      const imageData = await workbookImage(row);
      imageIds.set(row.id, workbook.addImage({
        base64: imageData,
        extension: 'jpeg'
      }));
    }
  }

  const addModelSheet = (title: string, sheetRows: RecordItem[]) => {
    const sheet = workbook.addWorksheet(uniqueSheetName(title));
    const allColumns = [
      { header: 'No.', key: 'number', width: 9 },
      { header: 'Picture ID', key: 'pictureId', width: 18 },
      { header: 'Person', key: 'person', width: 16 },
      { header: 'Person name', key: 'personName', width: 22 },
      ...(includePhotos ? [{ header: 'Photo', key: 'photo', width: 20 }] : []),
      { header: 'Image filename', key: 'filename', width: 36 },
      { header: 'Model', key: 'model', width: 28 },
      { header: 'IMEI', key: 'imei', width: 20 },
      { header: 'Validation', key: 'validation', width: 14 },
      { header: 'Duplicate', key: 'duplicate', width: 12 },
      { header: 'Scanned at', key: 'scannedAt', width: 24 },
      ...(photoLinks.size ? [{ header: 'Download photo', key: 'download', width: 20 }] : []),
      ...(folderLink ? [{ header: 'Photo folder', key: 'folder', width: 22 }] : [])
    ];
    const columns = layout
      ? (layout === 'simple'
        ? [allColumns.find(column => column.key === 'imei')!, allColumns.find(column => column.key === 'model')!]
        : ['imei', 'model', 'person', 'photo', 'download'].map(key => allColumns.find(column => column.key === key)!).filter(Boolean))
      : compact
      ? allColumns.filter(column => ['model', 'imei', 'duplicate', 'download', 'folder'].includes(column.key))
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
        validation: record.status,
        duplicate: record.duplicate ? 'Yes' : 'No',
        scannedAt: record.createdAt,
        ...(photoLinks.size ? { download: '' } : {}),
        ...(folderLink ? { folder: '' } : {})
      });
      row.height = includePhotos ? 72 : 24;
      row.alignment = { vertical: 'middle', wrapText: true };
      const imageId = imageIds.get(record.id);
      const photoLink = photoLinks.get(record.id);

      if (photoLink) {
        row.getCell(columns.findIndex(column => column.key === 'download') + 1).value = { text: 'Open photo', hyperlink: photoLink };
      }
      const folderColumn = columns.findIndex(column => column.key === 'folder');
      if (folderLink && folderColumn >= 0) {
        row.getCell(folderColumn + 1).value = { text: 'Choose photos / download all', hyperlink: folderLink };
      }

      if (includePhotos && imageId !== undefined) {
        sheet.addImage(imageId, {
          tl: { col: columns.findIndex(column => column.key === 'photo') + 0.12, row: row.number - 0.92 },
          ext: { width: 112, height: 82 },
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
  for (const [model, modelRows] of byModel) addModelSheet(model, modelRows);

  for (const person of layout === 'simple' ? [] : people) {
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
  layout?: 'simple' | 'person_photo'
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
    const group = layout === 'simple' ? record.model : `${record.model} / ${personTitle(record, people)}`;
    groups.set(group, [...(groups.get(group) || []), record]);
  }

  for (const [group, modelRecords] of groups) {
    children.push(new Paragraph({ text: group, heading: HeadingLevel.HEADING_1 }));
    const headerLabels = layout === 'simple' ? ['IMEI', 'Model'] : layout === 'person_photo' ? ['IMEI', 'Model', 'Assigned person', 'Photo'] : includePhotos
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
        const cells = [
          new TableCell({ children: [new Paragraph({ text: record.imei || 'Not detected' })] }),
          new TableCell({ children: [new Paragraph({ text: record.model })] })
        ];
        if (layout === 'person_photo') {
          cells.push(new TableCell({ children: [new Paragraph({ text: personTitle(record, people) })] }));
          const photo = new Uint8Array(await dataUrlBlob(await workbookImage(record)).arrayBuffer());
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
        const photo = new Uint8Array(await dataUrlBlob(await workbookImage(record)).arrayBuffer());
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
  const hostedScanner = import.meta.env.VITE_HOSTED_SCANNER === 'true' || window.location.hostname.endsWith('.onrender.com');
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [recordPage, setRecordPage] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [queueDisplayCount, setQueueDisplayCount] = useState(30);
  const [photoDisplayCount, setPhotoDisplayCount] = useState(40);
  const [busy, setBusy] = useState(false);
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
  const phoneOnLaptopNetwork = window.matchMedia('(pointer: coarse)').matches && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(window.location.hostname);
  const useBackgroundByDefault = hostedScanner || phoneOnLaptopNetwork;
  const scannerLocation = hostedScanner ? 'online server' : 'laptop';
  const importingLaptop = useRef(false);
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [personGroups, setPersonGroups] = useState<PersonGroup[]>(readPeople);
  const [activePersonId, setActivePersonId] = useState('person-1');
  const [personFilter, setPersonFilter] = useState('All');
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [manualImei, setManualImei] = useState('');
  const [manualModel, setManualModel] = useState('');
  const [manualCrop, setManualCrop] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [adjustingCrop, setAdjustingCrop] = useState(false);
  const [rotatingPhoto, setRotatingPhoto] = useState(false);
  const [reviewCountInput, setReviewCountInput] = useState(2);
  const [reviewSplit, setReviewSplit] = useState<{ recordId: string; target: number; crops: Array<{ cropDataUrl: string; imei: string; raw: string }> } | null>(null);
  const [toast, setToast] = useState('');
  const [storageWarning, setStorageWarning] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [googleProgress, setGoogleProgress] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('');
  const [photoDownloads, setPhotoDownloads] = useState<RecordItem[]>([]);
  const [photoGallery, setPhotoGallery] = useState('');
  const [saveToFolder, setSaveToFolder] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [imeiFilter, setImeiFilter] = useState<'all' | 'with' | 'without'>('all');
  const [exportExcludedIds, setExportExcludedIds] = useState<string[]>([]);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [exportSearch, setExportSearch] = useState('');
  const [exportPreviewLimit, setExportPreviewLimit] = useState(30);
  const [reportLayout, setReportLayout] = useState<'simple' | 'person_photo'>('simple');
  const includePhotos = reportLayout === 'person_photo';
  const compactExport = false;
  const [exportFormat, setExportFormat] = useState<'excel' | 'word' | 'sheets' | 'csv'>('excel');

  const inputRef = useRef<HTMLInputElement>(null);
  const cropStart = useRef<{ x: number; y: number } | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

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
          setRecords(removeDuplicateRecords(saved === undefined ? readRecords() : saved));
          setInventoryLoaded(true);
        }
      })
      .catch(error => {
        console.error('Unable to open device storage', error);
        if (mounted) {
          setRecords(removeDuplicateRecords(readRecords()));
          setInventoryLoaded(true);
          setStorageWarning('Large batch storage is unavailable in this browser. Export your records before closing this page.');
        }
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    setManualCrop({ x: 0, y: 0, width: 100, height: 100 });
    setReviewSplit(null);
    setManualImei(selected?.imei || '');
    setManualModel(selected ? exportModel(selected.model) : '');
  }, [selected?.id]);

  function cropPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y: Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)) };
  }

  function drawCrop(event: ReactPointerEvent<HTMLDivElement>) {
    if (!cropStart.current) return;
    const point = cropPoint(event), start = cropStart.current;
    setManualCrop({ x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
  }

  useEffect(() => {
    try { localStorage.setItem(PEOPLE_STORE, JSON.stringify(personGroups)); }
    catch (error) { console.error('Unable to save people locally', error); }
  }, [personGroups]);

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
  const reviewCount = records.filter(r => r.status !== 'Valid' || r.cropNeedsReview).length;

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
        filter === 'Review' ? r.status !== 'Valid' || r.cropNeedsReview :
          r.model === filter)) &&
    (`${r.name} ${r.model} ${r.imei}`)
      .toLowerCase()
      .includes(query.toLowerCase()) &&
    (personFilter === 'All' || r.personId === personFilter)
  );
  const pageSize = 40;
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
    try {
      const created = await laptopRequest('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: files.length, mode: scanMode, personId: activePersonId })
      });
      const { job } = await created.json();
      for (let index = 0; index < files.length; index++) {
        setLaptopMessage(`Uploading ${index + 1} of ${files.length}: ${files[index].name}. Keep this page open until upload finishes.`);
        await laptopRequest(`/api/jobs/${job.id}/photos/${index}`, {
          method: 'PUT', headers: { 'Content-Type': files[index].type, 'X-File-Name': encodeURIComponent(files[index].name) },
          body: files[index]
        });
      }
      await laptopRequest(`/api/jobs/${job.id}/start`, { method: 'POST' });
      setLaptopJobId(job.id);
      setLaptopJob({ status: 'queued', count: files.length, completed: 0, resultCount: 0, failed: 0 });
      setLaptopMessage(`Upload finished. You can close the app now; the ${scannerLocation} will keep scanning.`);
      setFiles([]);
    } catch (error) {
      console.error('Laptop scan upload failed', error);
      setLaptopMessage(error instanceof Error ? `Laptop scan could not start: ${error.message}` : 'Laptop scan could not start.');
    } finally { setLaptopUploading(false); }
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
          imported.push({ ...record, dataUrl: photo, cropDataUrl: (sourceCounts.get(item.sourcePictureId || '') || 0) > 1 ? photo : undefined });
          if (imported.length % 20 === 0) setLaptopMessage(`Importing ${imported.length} of ${scanned.length} completed records…`);
        }
        if (cancelled) return;
        setRecords(old => {
          const seenIds = new Set(old.map(row => row.id));
          const seenImeis = new Set(old.map(row => row.imei).filter(Boolean));
          let nextNumber = old.reduce((highest, row) => Math.max(highest, row.number), 2) + 1;
          const added = imported.filter(row => {
            if (seenIds.has(row.id) || (row.imei && seenImeis.has(row.imei))) return false;
            seenIds.add(row.id);
            if (row.imei) seenImeis.add(row.imei);
            row.number = nextNumber++;
            return true;
          });
          return added.length ? [...old, ...added] : old;
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

  async function scan() {
    if (!files.length || busy || !inventoryLoaded) return;

    setBusy(true);
    setCompletedFiles(0);
    const startedAt = performance.now();

    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

    try {
      worker = await createWorker('eng');

      let newRows: RecordItem[] = [];
      let addedCount = 0;
      let needsReviewCount = 0;
      let failedFiles = 0;
      const knownImeis = new Set(records.map(record => record.imei).filter(Boolean));
      let nextNumber = records.reduce((max, record) => Math.max(max, record.number), 2) + 1;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const beforeCount = newRows.length;

        setProgress(
          `Scanning ${i + 1} of ${files.length}: ${file.name}`
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

        const mostlyWhite = looksMostlyWhite(color);
        const segmentationContext = color.getContext('2d');
        const frame = imeis.length > 1 && segmentationContext
          ? segmentationContext.getImageData(0, 0, sourceWidth, sourceHeight)
          : undefined;
        const regions = planImeiCrops(imeis, lines, sourceWidth, sourceHeight, frame);
        let croppedPhotos = new Map<string, string>();
        if (regions.length === imeis.length && imeis.length > 1) {
          try {
            croppedPhotos = await createCroppedPhotos(color, regions, sourceWidth, sourceHeight);
          } catch (error) {
            console.error('Unable to split photo', error);
          }
        }
        const cropNeedsReview = imeis.length > 1 && croppedPhotos.size !== imeis.length;

        const pictureId = `PIC-${newId().slice(0, 8).toUpperCase()}`;
        for (const detectedImei of cropNeedsReview ? [''] : imeis.length ? imeis : ['']) {
        const region = regions.find(item => item.imei === detectedImei);
        const cropDataUrl = croppedPhotos.get(detectedImei);
        const cropResult = cropDataUrl ? await readCropImei(worker, cropDataUrl, scanMode) : { raw, imei: extractPreferredImei(raw) };
        const cropRaw = cropResult.raw;
        const imei = cropNeedsReview ? '' : cropResult.imei;
        const regionText = region && cropDataUrl ? lines.filter(line => {
          const x = (line.bbox.x0 + line.bbox.x1) / 2;
          const y = (line.bbox.y0 + line.bbox.y1) / 2;
          return x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
        }).map(line => line.text).join('\n') : raw;
        const model = identifyModel(regionText, file.name, mostlyWhite);
        const duplicate = !!imei && knownImeis.has(imei);

        if (duplicate && /^\d{15}$/.test(imei)) continue;
        if (/^\d{15}$/.test(imei)) knownImeis.add(imei);

        newRows.push({
          id: newId(),
          pictureId: `PIC-${newId().slice(0, 8).toUpperCase()}`,
          sourcePictureId: pictureId,
          number: nextNumber++,
          personId: activePersonId,
          name: file.name,
          dataUrl,
          cropDataUrl,
          cropNeedsReview: cropNeedsReview || !!region?.needsReview,
          model,
          imei,
          status: imei
            ? (luhnValid(imei) ? 'Valid' : 'Invalid')
            : 'Review',
          duplicate,
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
          needsReviewCount += completed.filter(row => row.status !== 'Valid' || row.cropNeedsReview).length;
          setRecords(old => [...old, ...completed]);
        }
        } catch (error) {
          if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'UnknownError')) throw error;
          console.error(`Could not scan ${file.name}`, error);
          newRows = newRows.slice(0, beforeCount);
          failedFiles++;
        }
        setCompletedFiles(i + 1);
        if (i % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
      }

      await worker.terminate();
      worker = null;

      addedCount += newRows.length;
      needsReviewCount += newRows.filter(row => row.status !== 'Valid' || row.cropNeedsReview).length;
      if (newRows.length) setRecords(old => [...old, ...newRows]);
      setFiles([]);

      const reviewMessage = needsReviewCount
        ? ` ${needsReviewCount} need review; open a record to see the OCR text.`
        : '';

      setToast(`Finished scanning ${addedCount} record(s) in ${Math.round((performance.now() - startedAt) / 1000)} seconds. Duplicate IMEIs are skipped.${reviewMessage}${failedFiles ? ` ${failedFiles} file(s) could not be read.` : ''}`);
    } catch (e) {
      console.error(e);
      setToast(
        'Scanning failed. Try a clearer image or smaller batch.'
      );
    } finally {
      if (worker) await worker.terminate();

      setBusy(false);
      setProgress('');
    }
  }

  function updateRow(id: string, patch: Partial<RecordItem>) {
    setRecords(old => {
      if (patch.imei && /^\d{15}$/.test(patch.imei) && old.some(r => r.id !== id && r.imei === patch.imei)) {
        return old.filter(r => r.id !== id);
      }
      const changed = old.map(r =>
        r.id === id ? { ...r, ...patch } : r
      );

      return removeDuplicateRecords(changed);
    });
  }

  function saveReviewFields(advance = false) {
    if (!selected || adjustingCrop || rotatingPhoto || reviewSplit) return;
    if (manualImei && !/^\d{15}$/.test(manualImei)) { setToast('Enter all 15 IMEI digits or leave it empty.'); return; }
    if (manualImei && records.some(r => r.id !== selected.id && r.imei === manualImei)) { setToast('This IMEI already has a record.'); return; }
    const imeiChanged = manualImei !== selected.imei;
    const patch: Partial<RecordItem> = { model: manualModel.trim() || 'Unknown unit — review', imei: manualImei, status: manualImei ? (luhnValid(manualImei) ? 'Valid' : 'Invalid') : 'Review', ...(imeiChanged && manualImei ? { cropNeedsReview: false } : {}) };
    updateRow(selected.id, patch);
    if (advance && reviewIndex >= 0 && reviewIndex < reviewRecords.length - 1) {
      setSelected(reviewRecords[reviewIndex + 1]);
      document.getElementById('manual-model')?.focus();
    } else {
      setSelected({ ...selected, ...patch });
      setManualModel(exportModel(patch.model || ''));
    }
    setToast(patch.status === 'Invalid' ? 'Saved. The IMEI checksum needs review.' : 'Saved.');
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
      const photos = await createCroppedPhotos(selected.dataUrl, [{ imei: 'manual', x, y, width, height }], 100, 100);
      const cropDataUrl = photos.get('manual')!;
      worker = await createWorker('eng');
      const { raw, imei } = await readCropImei(worker, cropDataUrl);
      if (imei && records.some(r => (addAnother || r.id !== selected.id) && r.imei === imei)) {
        setToast('This IMEI already has a record. Draw a crop around a different label.');
        return;
      }
      const patch: Partial<RecordItem> = { cropDataUrl, imei, raw, cropNeedsReview: !imei, status: imei ? (luhnValid(imei) ? 'Valid' : 'Invalid') : 'Review' };
      if (addAnother) {
        const sourcePictureId = selected.sourcePictureId || `PIC-${newId().slice(0, 8).toUpperCase()}`;
        const added: RecordItem = { ...selected, ...patch, id: newId(), pictureId: `PIC-${newId().slice(0, 8).toUpperCase()}`, sourcePictureId, number: Math.max(2, ...records.map(r => r.number)) + 1, duplicate: false, createdAt: new Date().toISOString() };
        setRecords(old => [...old.map(r => r.id === selected.id ? { ...r, sourcePictureId } : r), added]);
        setReviewIds(old => { const index = old.indexOf(selected.id); return index < 0 ? [...old, added.id] : [...old.slice(0, index + 1), added.id, ...old.slice(index + 1)]; });
        setSelected(added);
        setToast(imei ? 'Another crop added as a new record.' : 'Another crop added. Its IMEI needs review.');
      } else {
        updateRow(selected.id, patch);
      setSelected({ ...selected, ...patch });
      setManualImei(imei);
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
        rotatePhoto(selected.dataUrl, direction),
        selected.cropDataUrl ? rotatePhoto(selected.cropDataUrl, direction) : Promise.resolve(undefined)
      ]);
      const patch = { dataUrl, cropDataUrl, originalDataUrl: selected.originalDataUrl || selected.dataUrl };
      setRecords(old => old.map(r => r.id === selected.id ? { ...r, ...patch } : r));
      setSelected({ ...selected, ...patch });
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
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
    try {
      const photos = await createCroppedPhotos(selected.dataUrl, [{ imei: 'manual', x, y, width, height }], 100, 100);
      const cropDataUrl = photos.get('manual')!;
      worker = await createWorker('eng');
      const { raw, imei } = await readCropImei(worker, cropDataUrl);
      if (imei && (records.some(r => r.id !== selected.id && r.imei === imei) || reviewSplit.crops.some(crop => crop.imei === imei))) {
        setToast('This IMEI already has a record. Select a different label.');
        return;
      }
      const crops = [...reviewSplit.crops, { cropDataUrl, imei, raw }];
      if (crops.length < reviewSplit.target) {
        setReviewSplit({ ...reviewSplit, crops });
        setManualCrop({ x: 0, y: 0, width: 100, height: 100 });
        setToast(`Crop ${crops.length} saved. Select the next label.`);
      } else {
        const sourcePictureId = selected.sourcePictureId || `PIC-${newId().slice(0, 8).toUpperCase()}`;
        const nextNumber = Math.max(2, ...records.map(r => r.number)) + 1;
        const replacements: RecordItem[] = crops.map((crop, index) => ({ ...selected, id: newId(), pictureId: `PIC-${newId().slice(0, 8).toUpperCase()}`, sourcePictureId, number: index === 0 ? selected.number : nextNumber + index - 1, cropDataUrl: crop.cropDataUrl, imei: crop.imei, raw: crop.raw, cropNeedsReview: !crop.imei, status: crop.imei ? (luhnValid(crop.imei) ? 'Valid' : 'Invalid') : 'Review', duplicate: false, createdAt: new Date().toISOString() }));
        setRecords(old => old.flatMap(r => r.id === selected.id ? replacements : [r]));
        setSelectedIds(old => old.filter(id => id !== selected.id));
        setReviewSplit(null);
        setSelected(null);
        setToast(`${replacements.length} cropped records created. Review any unreadable IMEIs.`);
      }
    } catch (error) {
      console.error(error);
      setToast('Could not read this crop. Please try again.');
    } finally {
      if (worker) await worker.terminate();
      setAdjustingCrop(false);
    }
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

  async function performExport(rows: RecordItem[], token?: string) {
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

      if (exportFormat === 'excel') {
        setGoogleProgress('Building the Excel workbook…');
        const file = await createInventoryWorkbook(rows, photoLinks, includePhotos, personGroups, folderLink, compactExport, reportLayout);
        downloadBlob(file, selectedOnly ? 'imei-scanner-selected.xlsx' : 'imei-scanner-export.xlsx');
        setDownloadStatus(`Excel download started for ${rows.length} record(s). Check your Downloads folder.`);
        setToast(`Excel downloaded with ${rows.length} record(s).`);
      } else if (exportFormat === 'word') {
        setGoogleProgress('Building the Word document…');
        const file = await createWordReport(rows, includePhotos, photoLinks, personGroups, reportLayout);
        downloadBlob(file, selectedOnly ? 'imei-scanner-selected.docx' : 'imei-scanner-export.docx');
        setDownloadStatus(`Word download started for ${rows.length} record(s). Check your Downloads folder.`);
        setToast(`Word document downloaded with ${rows.length} record(s).`);
      } else if (exportFormat === 'csv') {
        const file = new Blob(
          [recordsCsv(rows, photoLinks, personGroups, compactExport, reportLayout)],
          { type: 'text/csv;charset=utf-8' }
        );
        downloadBlob(file, selectedOnly ? 'imei-scanner-selected.csv' : 'imei-scanner-export.csv');
        setDownloadStatus(`CSV download started for ${rows.length} record(s). Check your Downloads folder.`);
        setToast(`CSV downloaded with ${rows.length} record(s).`);
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
      const message = exportFormat === 'sheets'
        ? 'Google Sheets export failed. Try the Excel download instead.'
        : `Could not create the ${exportFormat.toUpperCase()} file. Try fewer records or another format.`;
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
      const photoItems: string[] = [];
      for (const record of rows) {
        const name = photoFilename(record).replace(/^#/, 'photo-');
        const photo = dataUrlBlob(recordPhoto(record));
        const path = `photos/${name}`;
        if (photosFolder) {
          const photoFile = await photosFolder.getFileHandle(name, { create: true });
          const writer = await photoFile.createWritable();
          await writer.write(photo);
          await writer.close();
          links.set(record.id, path);
        }
        photoItems.push(`<article class="card"><div class="preview"><img src="${htmlEscape(recordPhoto(record))}" alt="Photo for record ${record.number}"></div><div class="card-body"><span class="record">RECORD #${record.number} · ${htmlEscape(record.pictureId)}</span><h2>${htmlEscape(record.model)}</h2><div class="details"><span>IMEI</span><strong>${htmlEscape(record.imei || 'Not detected')}</strong><span>PERSON</span><strong>${htmlEscape(personTitle(record, personGroups))}</strong><span>STATUS</span><strong>${record.cropNeedsReview || record.status !== 'Valid' ? 'Needs review' : 'Valid'}</strong></div><div class="actions"><button class="view" type="button" data-imei="${htmlEscape(record.imei)}" onclick="copyImei(this)" ${record.imei ? '' : 'disabled'}>Copy IMEI</button><button class="view" type="button" onclick="viewPhoto(this)">View photo</button><button class="download" type="button" data-filename="${htmlEscape(name)}" onclick="savePhoto(this)">Download photo</button></div></div></article>`);
      }

      const galleryHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IMEI Lens — Photo library</title><style>*{box-sizing:border-box}body{margin:0;background:#0b1220;color:#e7eef7;font-family:system-ui,-apple-system,sans-serif}header{border-bottom:1px solid #27394d;background:#101d2d;padding:22px max(20px,calc((100vw - 1080px)/2))}.brand{font-weight:800;letter-spacing:.14em;font-size:13px}.brand span{color:#62dcb5}main{max-width:1120px;margin:auto;padding:34px 20px 48px}.eyebrow{font-size:10px;letter-spacing:.18em;color:#62dcb5;font-weight:800}h1{font-size:clamp(28px,5vw,42px);margin:10px 0}main>p{color:#a0b1c5;line-height:1.6;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(275px,1fr));gap:16px}.card{background:#111e2e;border:1px solid #2a3b50;border-radius:14px;overflow:hidden}.preview{display:block;height:205px;background:#091321;text-align:center;padding:12px}.preview img{width:100%;height:100%;object-fit:contain}.card-body{padding:17px}.record{font-size:10px;letter-spacing:.12em;color:#60d9b1;font-weight:800}h2{font-size:16px;margin:8px 0 15px}.details{display:grid;grid-template-columns:65px 1fr;gap:8px;font-size:12px;align-items:start}.details span{color:#8498af;font-size:10px;letter-spacing:.08em}.details strong{overflow-wrap:anywhere;font-weight:600}.actions{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}.actions button{cursor:pointer;border:0;flex:1;text-align:center;padding:11px 12px;border-radius:8px;font-size:12px;font-weight:750;text-decoration:none}.view{color:#d8e7f4;border:1px solid #3b5067;background:#1a2a3e}.download{background:#5bd5ad;color:#08251d}.foot{color:#8092a9;font-size:11px;margin-top:24px;line-height:1.5}@media(max-width:480px){main{padding:25px 15px}.grid{grid-template-columns:1fr}.preview{height:230px}.actions button{cursor:pointer;border:0;min-width:130px}}dialog{max-width:95vw;max-height:95vh;border:1px solid #3b5067;border-radius:12px;background:#101d2d;color:white}dialog::backdrop{background:#000c}dialog img{display:block;max-width:85vw;max-height:75vh;object-fit:contain}dialog button{margin:12px 0 0;padding:10px 18px;border:0;border-radius:8px;cursor:pointer}.grid{display:flex;flex-direction:column;gap:8px}.card{border-radius:10px}.card .preview{display:none}.card-body{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:18px;row-gap:4px;align-items:center;padding:12px 16px}.card-body .record,.card-body h2,.card-body .details{grid-column:1}.card-body h2{margin:0;font-size:15px}.card-body .details{grid-template-columns:48px minmax(0,1fr);gap:4px;font-size:12px}.card-body .actions{grid-column:2;grid-row:1 / 4;margin:0;justify-content:flex-end}.card-body .actions button{flex:none;min-width:100px;padding:10px}.card-body .actions button:disabled{opacity:.4;cursor:not-allowed}@media(max-width:700px){.card-body{display:block}.card-body h2{margin:4px 0 8px}.card-body .actions{margin-top:12px;justify-content:flex-start}.card-body .actions button{flex:1;min-width:95px;padding:10px 6px}}dialog{position:fixed;inset:0;margin:auto;padding:48px 16px 16px}dialog .dialog-close{position:absolute;right:8px;top:3px;margin:0;width:40px;height:40px;padding:0;background:transparent;color:#fff;font-size:30px;line-height:1}</style></head><body><header><div class="brand"><span>▣</span> IMEI LENS</div></header><main><div class="eyebrow">OFFLINE PHOTO LIBRARY</div><h1>Device list</h1><p>${rows.length} record(s) · Copy an IMEI, view a picture, or download a photo.</p><section class="grid">${photoItems.join('')}</section><p class="foot">Photos are embedded in this page. Original files are also available separately.</p></main><dialog id="viewer" onclick="closePhotoOnBackdrop(event)"><button type="button" class="dialog-close" aria-label="Close photo" onclick="document.getElementById('viewer').close()">×</button><img alt="Full-size photo"><button type="button" onclick="document.getElementById('viewer').close()">Close</button></dialog><script>async function copyImei(button){var value=button.dataset.imei;if(!value)return;var copied=false;if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(value);copied=true}catch(error){}}if(!copied){var field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.focus();field.select();field.setSelectionRange(0,value.length);try{copied=document.execCommand('copy')}catch(error){}field.remove()}button.textContent=copied?'Copied!':'Copy failed — try again'}function closePhotoOnBackdrop(event){var dialog=event.currentTarget;var rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))dialog.close()}function viewPhoto(button){var dialog=document.getElementById('viewer');dialog.querySelector('img').src=button.closest('article').querySelector('img').src;dialog.showModal()}function savePhoto(button){var link=document.createElement('a');link.href=button.closest('article').querySelector('img').src;link.download=button.dataset.filename;document.body.appendChild(link);link.click();link.remove()}</script></body></html>`;

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
        for (const [name, content] of [[reportName, report], ['open-photos.html', new Blob([galleryHtml], { type: 'text/html;charset=utf-8' })]] as [string, Blob][]) {
          const file = await folder.getFileHandle(name, { create: true });
          const writer = await file.createWritable();
          await writer.write(content);
          await writer.close();
        }
        setPhotoDownloads([]);
        setPhotoGallery('');
        setDownloadStatus('Saved the report and photos in a new folder. Open open-photos.html to view the pictures. Excel links depend on your spreadsheet app.');
      } else {
        downloadBlob(report, reportName);
        setPhotoDownloads(rows);
        setPhotoGallery(galleryHtml);
        setDownloadStatus(folderFailed
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
      setDownloadStatus('Could not prepare the spreadsheet and photos. Please try again.');
      setToast('Could not prepare the spreadsheet and photos. Try fewer records.');
    } finally {
      setSyncing(false);
      setGoogleProgress('');
    }
  }

  function exportChosen() {
    const rows = exportRows;
    if (!rows.length) {
      setDownloadStatus('No records are included. Change the filter or check records in the preview.');
      return;
    }

    if (reportLayout === 'person_photo') {
      const picker = saveToFolder ? (window as any).showDirectoryPicker : undefined;
      let folderChoice: Promise<any> | undefined;
      try { folderChoice = picker ? picker.call(window, { mode: 'readwrite' }) : undefined; }
      catch { folderChoice = undefined; }
      setPhotoDownloads([]);
      setPhotoGallery('');
      void exportPhotoPackage(rows, folderChoice);
      return;
    }
    if (exportFormat === 'sheets') {
      setSyncing(true);
      void createInventoryWorkbook(rows, new Map(), includePhotos, personGroups, '', compactExport, reportLayout)
        .then(file => {
          downloadBlob(file, 'imei-records-for-google-sheets.xlsx');
          setDownloadStatus('Excel file downloaded. In Google Sheets, choose File → Import → Upload.');
        })
        .catch(error => { console.error(error); setDownloadStatus('Could not create the file. Please try again.'); })
        .finally(() => setSyncing(false));
      return;
    }
    void performExport(rows);
  }

  function deleteSelected() {
    if (!selectedRows.length || !window.confirm(`Delete ${selectedRows.length} selected record(s)? This removes their saved photos and IMEIs from this browser.`)) return;
    const ids = new Set(selectedRows.map(record => record.id));
    setRecords(old => {
      const remaining = old.filter(record => !ids.has(record.id));
      return remaining.map(record => ({ ...record, duplicate: !!record.imei && remaining.some(other => other.id !== record.id && other.imei === record.imei) }));
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

      <main>
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
          <div className="panel upload-panel">
            <div className="section-head">
              <div>
                <div className="eyebrow">STEP 01</div>
                <h2>Upload photos</h2>
              </div>
              <span className="tag">BULK UPLOAD</span>
            </div>

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
                  {useBackgroundByDefault ? `Scan ${files.length || 0} photo(s) in background` : `Extract IMEI from ${files.length || 0} photo(s)`}
                </>
              )}
            </button>

            {busy && (
              <div className="progress">
                <div className="progressbar">
                  <i style={{ width: `${files.length ? completedFiles / files.length * 100 : 0}%` }} />
                </div>
                <span>{progress}</span>
              </div>
            )}

            <details className="laptop-scan" open={useBackgroundByDefault}>
              <summary>Keep scanning after closing the browser</summary>
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
            </details>

            <div className="privacy-note">
              <CheckCircle2 size={15} />
              {hostedScanner ? 'Background scans and photos are saved on your online scanner.' : 'Browser scans stay in this browser. Background scans are saved on your laptop.'}
            </div>
          </div>

          <div className="panel export-panel">
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
                <option value="simple">IMEI and model only</option>
                <option value="person_photo">IMEI, model, person and photo download</option>
              </select>
            </label>
            {reportLayout === 'person_photo' && (
              <>
                <div className="download-status">Download the report and then use the photo buttons below to save each image. Google Sheets cannot open links to local photos.</div>
                {typeof (window as any).showDirectoryPicker === 'function' && (
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
                <button className="subtle-btn" onClick={() => downloadBlob(new Blob([photoGallery], { type: 'text/html;charset=utf-8' }), 'open-photos.html')}>
                  <Download size={15} /> Download photo gallery HTML
                </button>
                {photoDownloads.slice(0, photoDisplayCount).map(record => (
                  <button key={record.id} className="subtle-btn" onClick={() => downloadBlob(dataUrlBlob(recordPhoto(record)), photoFilename(record).replace(/^#/, 'photo-'))}>
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

        <section className="results panel">
          <div className="results-top">
            <div>
              <div className="eyebrow">STEP 03</div>
              <h2>
                Scanned records <span className="count">{records.length}</span>
              </h2>
            </div>

            <div className="result-actions">
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
            </div>
          </div>

          <div className="filters">
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

          </div>

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
                    <th>VALIDATION</th>
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
                        <button
                          className="photo-cell"
                          onClick={() => openReview(r)}
                        >
                          <img src={recordPhoto(r)} />
                          <span>{r.name}</span>
                        </button>
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
                          value={r.model}
                          onChange={e =>
                            updateRow(r.id, { model: e.target.value })
                          }
                        />
                      </td>

                      <td data-label="IMEI">
                        <input
                          className="inline-edit imei-edit"
                          value={r.imei}
                          placeholder="Not detected"
                          maxLength={15}
                          onChange={e => {
                            const imei = digits(e.target.value).slice(0, 15);

                            if (imei.length === 15 && records.some(other => other.id !== r.id && other.imei === imei)) {
                              setToast('Duplicate IMEI removed; the existing record was kept.');
                            }

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

                      <td data-label="Validation">
                        <span className={`status ${(r.cropNeedsReview ? 'Review' : r.status).toLowerCase()}`}>
                          {r.status === 'Valid' && !r.cropNeedsReview
                            ? <CheckCircle2 size={13} />
                            : <AlertTriangle size={13} />}
                          {' '}{r.cropNeedsReview ? 'Needs review' : r.status}
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
                            downloadBlob(dataUrlBlob(recordPhoto(r)), photoFilename(r));
                            setToast('Photo download started.');
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
                          onClick={() =>
                            {
                              setSelectedIds(old => old.filter(id => id !== r.id));
                              setRecords(old => old.filter(x => x.id !== r.id));
                            }
                          }
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
          onClick={() => setSelected(null)}
        >
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <div className="eyebrow">IMAGE REVIEW</div>
                <h2>{selected.name}</h2>
              </div>

              <button
                className="iconbtn"
                aria-label="Close photo review"
                onClick={() => setSelected(null)}
              >
                <X />
              </button>
            </div>

            <img className="preview" src={recordPhoto(selected)} alt="Selected record photo" />

            {reviewIndex >= 0 && <div className="review-navigation" aria-label="Navigate scanned records">
              <button className="subtle-btn" disabled={reviewIndex === 0 || adjustingCrop || rotatingPhoto || !!reviewSplit || manualModel !== exportModel(selected.model) || manualImei !== selected.imei} onClick={() => setSelected(reviewRecords[reviewIndex - 1])}>← Previous</button>
              <span>{reviewIndex + 1} of {reviewRecords.length}</span>
              <button className="subtle-btn" disabled={reviewIndex === reviewRecords.length - 1 || adjustingCrop || rotatingPhoto || !!reviewSplit || manualModel !== exportModel(selected.model) || manualImei !== selected.imei} onClick={() => setSelected(reviewRecords[reviewIndex + 1])}>Next →</button>
            </div>}

            <div className="crop-actions" aria-label="Rotate photo">
              <button className="subtle-btn" disabled={rotatingPhoto || adjustingCrop || !!reviewSplit} onClick={() => void rotateSelectedPhoto('left')}>↶ Rotate left</button>
              <button className="subtle-btn" disabled={rotatingPhoto || adjustingCrop || !!reviewSplit} onClick={() => void rotateSelectedPhoto('right')}>↷ Rotate right</button>
            </div>

            <div className="manual-imei-entry">
              <label className="review-model" htmlFor="manual-model">Device model</label>
              <input id="manual-model" value={manualModel} onChange={event => setManualModel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); document.getElementById('manual-imei')?.focus(); } }} />
              <label htmlFor="manual-imei">IMEI</label>
              <input id="manual-imei" inputMode="numeric" maxLength={15} value={manualImei} onChange={event => setManualImei(digits(event.target.value).slice(0, 15))} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); saveReviewFields(true); } }} />
              <button className="primary" disabled={adjustingCrop || rotatingPhoto || !!reviewSplit} onClick={() => saveReviewFields()}>Save</button>
              <small>Enter moves to the next field, then saves and opens the next record. Use arrow keys to navigate when not typing.</small>
              {(manualModel !== exportModel(selected.model) || manualImei !== selected.imei) && <small>Save changes before moving to another record.</small>}
            </div>

            <div className="modal-meta">
              <span>Picture ID: {selected.pictureId}</span>
              <span>IMEI: {selected.imei || 'Not detected'}</span>
              {selected.sourcePictureId && records.filter(r => r.sourcePictureId === selected.sourcePictureId).length > 1 && (
                <span>Same source photo: {records.filter(r => r.sourcePictureId === selected.sourcePictureId).map(r => `#${r.number} ${r.imei}`).join(' · ')}</span>
              )}
              <span>Validation: {selected.status}</span>
              <span>Duplicate: {selected.duplicate ? 'Yes' : 'No'}</span>
              {selected.cropNeedsReview && <span>Automatic cropping needs review; adjust the crop if needed.</span>}
            </div>

            <button className="primary" onClick={() => {
              downloadBlob(dataUrlBlob(recordPhoto(selected)), photoFilename(selected));
            }}>
              <Download size={16} /> Download {selected.cropDataUrl ? 'separated' : 'original'} photo
            </button>

            {selected.cropDataUrl && (
              <details>
                <summary>View full original photo</summary>
                <img className="preview" src={selected.dataUrl} />
              </details>
            )}

            {(selected.cropNeedsReview || selected.status !== 'Valid') && !reviewSplit && <div className="review-split-prompt">
              <label htmlFor="review-crop-count">How many IMEI labels do you see in this photo?</label>
              <p>Choose a number, then crop each label. The original record is replaced only after all crops are saved.</p>
              <div className="review-split-start"><input id="review-crop-count" type="number" inputMode="numeric" min="1" max="20" value={reviewCountInput} onChange={event => setReviewCountInput(Number(event.target.value))} />
                <button className="primary" disabled={adjustingCrop} onClick={() => {
                  if (!Number.isInteger(reviewCountInput) || reviewCountInput < 1 || reviewCountInput > 20) { setToast('Enter a number from 1 to 20.'); return; }
                  setReviewSplit({ recordId: selected.id, target: reviewCountInput, crops: [] });
                  setManualCrop({ x: 0, y: 0, width: 100, height: 100 });
                }}>Start cropping</button></div>
            </div>}
            <details open={reviewSplit ? true : undefined}>
              <summary>Adjust crop</summary>
              <p>{reviewSplit ? `Crop ${reviewSplit.crops.length + 1} of ${reviewSplit.target}: drag a box around one label and its number.` : 'Drag a box around one IMEI label and its number. Save the first crop, then draw another box and choose Add another crop.'}</p>
              {reviewSplit && reviewSplit.crops.length > 0 && <div className="review-crop-list">{reviewSplit.crops.map((crop, index) => <div key={index}><img src={crop.cropDataUrl} alt={`Saved crop ${index + 1}`} /><span>Crop {index + 1}{crop.imei ? '' : ' · Needs review'}</span></div>)}</div>}
              {selected.cropDataUrl && <div className="crop-saved-preview"><strong>Saved crop for this record</strong><img src={selected.cropDataUrl} alt="Saved crop for this record" /></div>}
              <div className="crop-editor" onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); cropStart.current = cropPoint(event); drawCrop(event); }} onPointerMove={drawCrop} onPointerUp={event => { drawCrop(event); cropStart.current = null; }} onPointerCancel={() => { cropStart.current = null; }}>
                <img src={selected.dataUrl} alt="Original photo: drag to select the IMEI label" draggable={false} />
                <div className="crop-selection" style={{ left: `${manualCrop.x}%`, top: `${manualCrop.y}%`, width: `${manualCrop.width}%`, height: `${manualCrop.height}%` }} />
              </div>
              <button className="subtle-btn" onClick={() => setManualCrop({ x: 0, y: 0, width: 100, height: 100 })}>Reset selection</button>
              <details><summary>Fine-tune selection</summary><div className="manual-crop-controls">
                {(['x', 'y', 'width', 'height'] as const).map(key => (
                  <label key={key}>{key} (%)<input type="number" min="0" max="100" value={Math.round(manualCrop[key] * 10) / 10} onChange={event => setManualCrop(old => ({ ...old, [key]: Number(event.target.value) }))} /></label>
                ))}
              </div></details>
              <div className="crop-actions">
                {reviewSplit ? <><button className="primary" disabled={adjustingCrop} onClick={() => void saveReviewCrop()}>{adjustingCrop ? 'Reading crop…' : reviewSplit.crops.length + 1 === reviewSplit.target ? 'Save crop and finish' : 'Save crop and continue'}</button><button className="subtle-btn" disabled={adjustingCrop} onClick={() => setReviewSplit(null)}>Cancel guided cropping</button></> : <><button className="primary" disabled={adjustingCrop} onClick={() => void applyManualCrop(false)}>{adjustingCrop ? 'Reading crop…' : selected.cropDataUrl ? 'Update this crop' : 'Save first crop'}</button>
                {selected.cropDataUrl && <button className="subtle-btn" disabled={adjustingCrop} onClick={() => void applyManualCrop(true)}>Add another crop</button>}</>}
              </div>
            </details>

            <details>
              <summary>Raw OCR text</summary>
              <pre>{selected.raw || 'No text recognized.'}</pre>
            </details>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast">
          <AlertTriangle size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
