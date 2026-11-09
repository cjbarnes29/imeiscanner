import { extractSerial, serialLabelRegion, serialReading } from '../src/serial.ts';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import { planImeiCrops } from '../src/scan-layout.ts';

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
  for (const type of firstOnly ? [1] : [1, 2]) {
    const valid = labelledNumbers(text, type).filter(luhnValid);
    if (valid.length === 1) return valid[0];
  }
  return '';
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
      let regions = [];
      if (imeis.length > 1) {
        const { data, info: frameInfo } = await sharp(color).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        regions = planImeiCrops(imeis, lines, frameInfo.width, frameInfo.height, { data, width: frameInfo.width, height: frameInfo.height });
      }
      const splitFailed = imeis.length > 1 && regions.length !== imeis.length;
      const sourcePictureId = `PIC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const selections = !splitFailed && regions.length ? regions : [null];
      const results = [];
      for (const region of selections) {
        const photo = region ? await sharp(color).extract({ left: Math.max(0, Math.floor(region.x)), top: Math.max(0, Math.floor(region.y)), width: Math.min(colorSize.width - Math.floor(region.x), Math.ceil(region.width)), height: Math.min(colorSize.height - Math.floor(region.y), Math.ceil(region.height)) }).jpeg({ quality: 85 }).toBuffer() : color;
        let cropRaw = region ? (await worker.recognize(photo)).data.text || '' : raw;
        let imei = splitFailed ? '' : preferredImei(cropRaw, filename.startsWith('camera-imei1-'));
        if (region && !imei && mode !== 'fast') {
          const improved = await sharp(photo).grayscale().linear(1.5, -40).jpeg().toBuffer();
          cropRaw += `\n${(await worker.recognize(improved)).data.text || ''}`;
          imei = preferredImei(cropRaw, filename.startsWith('camera-imei1-'));
        }
        if (!imei && !extractSerial(cropRaw)) {
          const {data,info}=await sharp(photo).ensureAlpha().raw().toBuffer({resolveWithObject:true});const box=serialLabelRegion({data,width:info.width,height:info.height});
          await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
          for(const angle of [6,0,-6]) { const focus=await sharp(photo).extract({left:box.x,top:box.y,width:box.width,height:box.height}).resize({width:2200,height:2200,fit:'inside'}).rotate(angle,{background:'white'}).grayscale().normalise().sharpen().toBuffer();const text=(await worker.recognize(focus)).data.text||'';if(serialReading(text).serial){cropRaw=text;break;} }
        }
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
          cropNeedsReview: splitFailed || !!region?.needsReview,
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
