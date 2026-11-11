import {deviceAnchors,planDeviceCrops} from '../src/device-labels.ts';
import { extractSerial, serialLabelRegion, serialReading, unindexedImeis } from '../src/serial.ts';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import { planImeiCrops } from '../src/scan-layout.ts';
import { barcodeImei, imeiReadingsDisagree, labelledBarcodeLines, resolveImeisFromBarcodes, resolveSerialFromBarcodes } from '../src/barcode-imei.ts';
import { readBarcodes } from 'zxing-wasm/reader';

/** All Code 128 barcodes in the frame with their boxes, for pairing with IMEI labels. */
async function frameBarcodes(frame) {
  try {
    const found = await readBarcodes({ data: new Uint8ClampedArray(frame.data.buffer, frame.data.byteOffset, frame.data.length), width: frame.width, height: frame.height, colorSpace: 'srgb' }, { formats: ['Code128'], maxNumberOfSymbols: 32, tryHarder: true });
    return found.filter(code => code.isValid).map(code => {
      const p = code.position, xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x], ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
      return { rawValue: code.text, boundingBox: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(1, Math.max(...ys) - Math.min(...ys)) } };
    });
  } catch (error) { console.error('Barcode reading failed', error); return []; }
}

/** Barcode values inside one device crop, upscaled so small Code 128 bars decode. */
/** Barcodes on the whole photo at several sizes, boxes in the photo's own pixels. */
async function photoBarcodes(photo, size) {
  const found = new Map();
  for (const longest of [0, 1200, 1600, 2000]) {
    const scale = longest ? longest / Math.max(size.width, size.height) : 1;
    const { data, info } = await sharp(photo).resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const code of await frameBarcodes({ data, width: info.width, height: info.height })) {
      if (found.has(code.rawValue)) continue;
      const b = code.boundingBox;
      found.set(code.rawValue, { rawValue: code.rawValue, boundingBox: { x: b.x / scale, y: b.y / scale, width: b.width / scale, height: b.height / scale } });
    }
  }
  return [...found.values()];
}

async function cropBarcodeValues(photo) {
  // Small bars decode at some sizes and not others: read at two sizes and combine.
  const values = new Set();
  for (const size of [1600, 2600]) {
    const { data, info } = await sharp(photo).resize({ width: size, height: size, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const code of await frameBarcodes({ data, width: info.width, height: info.height })) values.add(code.rawValue);
  }
  return [...values];
}

const digits = value => value.replace(/\D/g, '');
const labelledNumbers = (text, type) => [...new Set([...text.matchAll(new RegExp(`\\bIMEI\\s*(?:${type}|0${type})\\s*[:#-]?\\s*((?:\\d[\\s-]*){15})(?![\\s-]*\\d)`, 'gi'))]
  .map(match => digits(match[1])).filter(value => value.length === 15))];

function luhnValid(value) {
  if (!/^\d{15}$/.test(value)) return false;
  let total = 0;
  for (let i = 0; i < 15; i++) {
    let number = Number(value[14 - i]);
    if (i % 2) { number *= 2; if (number > 9) number -= 9; }
    total += number;
  }
  return total % 10 === 0;
}

function preferredImei(text, firstOnly = false) {
  // A barcode-confirmed number is exact; it beats any OCR reading.
  if (barcodeImei(text, 1)) return barcodeImei(text, 1);
  const first = labelledNumbers(text, 1).filter(luhnValid);
  if (first.length === 1) return first[0];
  // A bare "IMEI: …" (Apple/Pixel style, or OCR dropped the 1) ranks above IMEI 2.
  const plain = unindexedImeis(text).filter(luhnValid);
  if (plain.length === 1) return plain[0];
  if (firstOnly) return '';
  if (barcodeImei(text, 2)) return barcodeImei(text, 2);
  const second = labelledNumbers(text, 2).filter(luhnValid);
  return second.length === 1 ? second[0] : '';
}

function modelFrom(text, filename) {
  const labelledCode = text.match(/\bmodel\s*[:：-]?\s*S\s*M\s*[-–—]?\s*([A-Z0-9]{5})/i);
  const codes = [...new Set([...text.matchAll(/\bS\s*M\s*[-–—]\s*([A-Z0-9]{5})/gi)].map(match => match[1].toUpperCase()))];
  const labelled = labelledCode?.[1].toUpperCase();
  const exact = codes.filter(code => /^[A-Z][0-9]{3}[A-Z0-9]$/.test(code));
  const code = labelled && exact.includes(labelled) ? labelled : exact.length === 1 ? exact[0] : labelled || codes[0];
  if (code) return `SM-${code}`;
  const value = `${text} ${filename}`.toLowerCase().replace(/[_-]/g, ' ');
  const patterns = [
    [/galaxy\s*s26|sm\s*s94|sm\s*s93/, 'Samsung Galaxy S26 series'],
    [/galaxy\s*s25\s*ultra|sm\s*s938/, 'Samsung Galaxy S25 Ultra'],
    [/galaxy\s*s25\s*\+|galaxy\s*s25\s*plus|sm\s*s936/, 'Samsung Galaxy S25+'],
    [/galaxy\s*s25|sm\s*s931/, 'Samsung Galaxy S25'],
    [/galaxy\s*s24\s*ultra|sm\s*s928/, 'Samsung Galaxy S24 Ultra'],
    [/galaxy\s*s24|sm\s*s921/, 'Samsung Galaxy S24'],
    [/galaxy\s*s23|sm\s*s911/, 'Samsung Galaxy S23'],
    [/galaxy\s*a56|sm\s*a566/, 'Samsung Galaxy A56'],
    [/galaxy\s*a55|sm\s*a556/, 'Samsung Galaxy A55'],
    [/galaxy\s*a36|sm\s*a366/, 'Samsung Galaxy A36'],
    [/galaxy\s*z\s*fold\s*7|sm\s*f966/, 'Samsung Galaxy Z Fold7'],
    [/galaxy\s*z\s*flip\s*7|sm\s*f766/, 'Samsung Galaxy Z Flip7'],
    [/iphone\s*17\s*pro\s*max/, 'Apple iPhone 17 Pro Max'],
    [/iphone\s*17\s*pro/, 'Apple iPhone 17 Pro'],
    [/iphone\s*17/, 'Apple iPhone 17'],
    [/iphone\s*16\s*pro\s*max/, 'Apple iPhone 16 Pro Max'],
    [/iphone\s*16\s*pro/, 'Apple iPhone 16 Pro'],
    [/pixel\s*9/, 'Google Pixel 9']
  ];
  return patterns.find(([pattern]) => pattern.test(value))?.[1] || 'Unknown unit — review';
}

function ocrLines(data) {
  return data.lines?.length ? data.lines : (data.blocks || []).flatMap(block =>
    (block.paragraphs || []).flatMap(paragraph => paragraph.lines || []));
}

function scaledLines(lines, from, to) {
  const scaleX = to.width / from.width, scaleY = to.height / from.height;
  return lines.map(line => ({ text: line.text, bbox: {
    x0: line.bbox.x0 * scaleX, x1: line.bbox.x1 * scaleX,
    y0: line.bbox.y0 * scaleY, y1: line.bbox.y1 * scaleY
  } }));
}

export async function createScanner() {
  const worker = await createWorker('eng');
  return {
    async scan(input, filename, mode = 'standard') {
      const max = mode === 'fast' ? 1600 : mode === 'detailed' ? 3000 : 2400;
      const color = await sharp(input).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
      const info = await sharp(color).metadata();
      const colorSize = { width: info.width, height: info.height };
      const enhanced = await sharp(color).grayscale().linear(1.45, -40).jpeg({ quality: 88 }).toBuffer();
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300' });
      const first = (await worker.recognize(enhanced)).data;
      let raw = first.text || '';
      let imeis = labelledNumbers(raw, 1);
      let lines = scaledLines(ocrLines(first), colorSize, colorSize);
      if (mode === 'detailed' || (mode === 'standard' && (imeis.length === 0 || (imeis.length === 1 && !luhnValid(imeis[0]))))) {
        const second = (await worker.recognize(color)).data;
        const secondImeis = labelledNumbers(second.text || '', 1);
        if (secondImeis.length > imeis.length || (!imeis.length && second.text)) {
          raw = second.text || '';
          imeis = secondImeis;
          lines = ocrLines(second);
        }
      }
      const {data:frameData,info:frameInfo}=await sharp(color).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      const frame={data:frameData,width:frameInfo.width,height:frameInfo.height};
      // Same as the browser camera path: barcodes under IMEI labels anchor each device.
      const fullPhotoCodes=await photoBarcodes(color,colorSize);
      // Small S/N bars often decode on the whole photo but not in a crop.
      const codesInside=region=>fullPhotoCodes.filter(code=>{if(!region)return true;const b=code.boundingBox,cx=b.x+b.width/2,cy=b.y+b.height/2;return cx>=region.x&&cx<=region.x+region.width&&cy>=region.y&&cy<=region.y+region.height;}).map(code=>code.rawValue);
      const barcodeLines=labelledBarcodeLines(fullPhotoCodes,lines);
      if(barcodeLines.length){lines=[...lines,...barcodeLines];raw+='\n'+barcodeLines.map(line=>line.text).join('\n');imeis=labelledNumbers(raw,1);}
      const anchors=deviceAnchors(lines,colorSize.width,colorSize.height,frame);
      const regions=planDeviceCrops(anchors,lines,colorSize.width,colorSize.height,frame);
      const splitFailed=(anchors.length>1&&regions.length<2)||(anchors.length<2&&regions.length<2&&imeis.length>1);
      const sourcePictureId = `PIC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const selections = !splitFailed && regions.length ? regions : [null];
      const results = [];
      for (const region of selections) {
        const photo = region ? await sharp(color).extract({ left: Math.max(0, Math.floor(region.x)), top: Math.max(0, Math.floor(region.y)), width: Math.min(colorSize.width - Math.floor(region.x), Math.ceil(region.width)), height: Math.min(colorSize.height - Math.floor(region.y), Math.ceil(region.height)) }).jpeg({ quality: 85 }).toBuffer() : color;
        let cropRaw = region ? (await worker.recognize(photo)).data.text || '' : raw;
        { const cropCodes = [...new Set([...await cropBarcodeValues(photo), ...codesInside(region)])]; const fromBarcodes = [resolveImeisFromBarcodes(cropCodes, cropRaw), resolveSerialFromBarcodes(cropCodes, cropRaw)].filter(Boolean).join('\n'); if (fromBarcodes) cropRaw = `${fromBarcodes}\n${cropRaw}`; }
        let imei = splitFailed ? '' : preferredImei(cropRaw);
        if (region && !labelledNumbers(cropRaw,1).some(luhnValid) && mode !== 'fast') {
          const improved = await sharp(photo).resize({width:2600,height:2600,fit:'inside'}).grayscale().normalise().sharpen().jpeg({quality:96}).toBuffer();
          cropRaw += `\n${(await worker.recognize(improved)).data.text || ''}`;
          await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
          cropRaw += `\n${(await worker.recognize(improved)).data.text || ''}`;
          await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
          imei = preferredImei(cropRaw);
        }
        if (!imei && !extractSerial(cropRaw)) {
          const {data,info}=await sharp(photo).ensureAlpha().raw().toBuffer({resolveWithObject:true});const box=serialLabelRegion({data,width:info.width,height:info.height});
          await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
          for(const angle of [6,0,-6]) { const focus=await sharp(photo).extract({left:box.x,top:box.y,width:box.width,height:box.height}).resize({width:2200,height:2200,fit:'inside'}).rotate(angle,{background:'white'}).grayscale().normalise().sharpen().toBuffer();const text=(await worker.recognize(focus)).data.text||'';if(serialReading(text).serial){cropRaw=text;break;} }
        }
        imei=splitFailed?'':preferredImei(cropRaw);
        await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
        results.push({
          id: crypto.randomUUID(),
          pictureId: `PIC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          sourcePictureId,
          name: filename,
          model: modelFrom(cropRaw, filename),
          imei,
          ...serialReading(cropRaw),
          status: imei ? 'Valid' : 'Review',
          cropNeedsReview: splitFailed || !!region?.needsReview || imeiReadingsDisagree(cropRaw, imei),
          imei2: (() => { const second = barcodeImei(cropRaw, 2) || [...new Set(labelledNumbers(cropRaw, 2).filter(luhnValid))].join(); return /^\d{15}$/.test(second) ? second : ''; })(),
          ...(splitFailed ? (() => { const found = labelledNumbers(raw, 1).filter(luhnValid); return { deviceCount: Math.max(2, anchors.length, found.length), deviceImeis: found }; })() : {}),
          raw: cropRaw,
          createdAt: new Date().toISOString(),
          photo
        });
      }
      return results;
    },
    async close() { await worker.terminate(); }
  };
}
