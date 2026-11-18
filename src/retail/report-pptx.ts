/**
 * The app report as a PowerPoint file (.pptx). Written by hand with `jszip` (already used by the app) so no presentation library is added: a title
 * slide, the key numbers with the highlights, a bar chart of targets by segment, what to push and what to leave, people, and sales and stock. Slides
 * are 16:9, plain shapes and text only (no pictures, no IMEIs). Layout is computed here, so long lists continue on a new slide instead of overflowing.
 */
import { ADVICE_TITLE, type ReportModel } from './report-model';
import type { Advice } from './forecast';

export const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const IN = 914400;
const W = 12192000, H = 6858000;
const e = (inches: number) => Math.round(inches * IN);
const GREEN = '1F5F4B', MINT = '7FD6B0', INK = '1F2937', MUTED = '6B7280', TRACK = 'E5E7EB', AMBER = 'F2C879', RED = 'E07A7A', CARD = 'F3F6F9';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Text safe for XML: control characters dropped, the five special characters escaped. */
export const xmlText = (value: unknown): string => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text);

type Para = { text: string; size: number; bold?: boolean; color?: string; align?: 'l' | 'ctr' | 'r' };
class Slide {
  private shapes: string[] = [];
  private next = 1;
  constructor(public background = 'FFFFFF') {}
  private id() { return ++this.next; }
  text(x: number, y: number, w: number, h: number, paras: Para[], anchor: 't' | 'ctr' = 't') {
    const body = paras.map(p => `<a:p><a:pPr algn="${p.align || 'l'}"/><a:r><a:rPr lang="en-US" sz="${Math.round(p.size * 100)}" b="${p.bold ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${p.color || INK}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${xmlText(p.text)}</a:t></a:r></a:p>`).join('');
    const id = this.id();
    this.shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${e(x)}" y="${e(y)}"/><a:ext cx="${e(w)}" cy="${e(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="45720" tIns="22860" rIns="45720" bIns="22860" rtlCol="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`);
  }
  rect(x: number, y: number, w: number, h: number, fill: string, round = false) {
    const id = this.id();
    this.shapes.push(`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${e(x)}" y="${e(y)}"/><a:ext cx="${Math.max(1, e(w))}" cy="${Math.max(1, e(h))}"/></a:xfrm><a:prstGeom prst="${round ? 'roundRect' : 'rect'}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`);
  }
  xml(): string {
    return `${XML}<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${this.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${this.shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }
}

const header = (s: Slide, title: string, sub = '') => {
  s.rect(0, 0, 13.333, 0.12, GREEN);
  s.text(0.5, 0.3, 12.3, 0.8, [{ text: title, size: 30, bold: true, color: INK }]);
  if (sub) s.text(0.5, 1.05, 12.3, 0.4, [{ text: sub, size: 14, color: MUTED }]);
};
const footer = (s: Slide, model: ReportModel, n: number, total: number) => s.text(0.5, 7.05, 12.3, 0.3, [{ text: `${model.title} · ${model.who} · ${model.generatedOn}    ${n} / ${total}`, size: 10, color: MUTED }]);

/** The slides, as builders so the page count is known before the footers are written. */
export function reportSlides(model: ReportModel): Slide[] {
  const slides: Slide[] = [];
  // 1. title
  const title = new Slide(GREEN);
  title.text(0.8, 2.3, 11.7, 1.4, [{ text: model.title, size: 44, bold: true, color: 'FFFFFF' }], 'ctr');
  title.text(0.8, 3.8, 11.7, 0.9, [{ text: `${model.who} · made ${model.generatedOn}`, size: 20, color: MINT }]);
  title.text(0.8, 6.6, 11.7, 0.4, [{ text: 'Made from the numbers in AI LENS. Check against the label before you share.', size: 12, color: 'C9D5E3' }]);
  slides.push(title);

  // 2. the key numbers and highlights
  const overview = new Slide();
  header(overview, 'The month in numbers', `${model.monthName}${model.daysLeft ? ` · ${model.daysLeft} day${model.daysLeft === 1 ? '' : 's'} left` : ''}`);
  model.kpis.forEach((kpi, i) => {
    const x = 0.5 + (i % 4) * 3.1, y = 1.65 + Math.floor(i / 4) * 1.55;
    overview.rect(x, y, 2.9, 1.35, CARD, true);
    overview.text(x + 0.1, y + 0.1, 2.7, 0.75, [{ text: kpi.value, size: 32, bold: true, color: GREEN, align: 'ctr' }], 'ctr');
    overview.text(x + 0.1, y + 0.85, 2.7, 0.4, [{ text: kpi.label, size: 13, color: MUTED, align: 'ctr' }]);
  });
  overview.text(0.5, 4.85, 12.3, 2.1, model.highlights.slice(0, 4).map(h => ({ text: '• ' + cut(h, 120), size: 13 })));
  slides.push(overview);

  // 3. targets by segment as bars (scale 0-120%, a line marks 100%)
  const rows = model.segments.rows;
  for (let start = 0; start < Math.max(rows.length, 1); start += 7) {
    const s = new Slide();
    header(s, 'Targets by segment', rows.length > 7 ? `Segments ${start + 1}–${Math.min(rows.length, start + 7)} of ${rows.length}` : 'Bars run to 120%; the dark line is 100%');
    if (!rows.length) s.text(0.5, 2, 12.3, 1, [{ text: `No targets are set for ${model.monthName}.`, size: 20, color: MUTED }]);
    rows.slice(start, start + 7).forEach((row, i) => {
      const y = 1.7 + i * 0.74, pct = Number(row[3]) || 0;
      s.text(0.5, y, 3.0, 0.5, [{ text: String(row[0]), size: 16, bold: true }], 'ctr');
      s.rect(3.6, y + 0.1, 6.6, 0.32, TRACK);
      s.rect(3.6, y + 0.1, 6.6 * Math.min(pct, 1.2) / 1.2, 0.32, pct >= 1 ? GREEN : pct >= 0.7 ? AMBER : RED);
      s.rect(3.6 + 6.6 / 1.2 - 0.015, y + 0.04, 0.03, 0.44, INK);
      s.text(10.35, y, 2.5, 0.5, [{ text: `${row[2]} of ${row[1]} · ${Math.round(pct * 100)}%`, size: 14 }], 'ctr');
    });
    slides.push(s);
  }

  // 4. what to push and what to leave
  const advice = new Slide();
  header(advice, 'What to push, what to leave', model.outlook.note || '');
  const columns: Advice[][] = [['push'], ['keep'], ['far', 'stop']];
  columns.forEach((group, i) => {
    const x = 0.5 + i * 4.15;
    advice.rect(x, 1.65, 3.95, 5.1, CARD, true);
    const paras: Para[] = [];
    for (const g of group) {
      paras.push({ text: ADVICE_TITLE[g], size: 15, bold: true, color: g === 'push' ? GREEN : g === 'far' ? 'B45309' : INK });
      const room = group.length > 1 ? 3 : 6, lines = model.groups[g].slice(0, room);
      if (!lines.length) paras.push({ text: 'Nothing here.', size: 12, color: MUTED });
      for (const line of lines) paras.push({ text: '• ' + cut(line, 70), size: 12 });
      if (model.groups[g].length > room) paras.push({ text: `…and ${model.groups[g].length - room} more`, size: 11, color: MUTED });
      paras.push({ text: ' ', size: 8 });
    }
    advice.text(x + 0.15, 1.75, 3.65, 4.9, paras);
  });
  slides.push(advice);

  // 5. people
  const people = model.people.rows;
  for (let start = 0; start < Math.max(people.length, 1); start += 8) {
    const s = new Slide();
    header(s, 'People', people.length > 8 ? `${start + 1}–${Math.min(people.length, start + 8)} of ${people.length}` : 'Sold of target, with the month-end estimate when there is one');
    if (!people.length) s.text(0.5, 2, 12.3, 1, [{ text: 'No people yet.', size: 20, color: MUTED }]);
    people.slice(start, start + 8).forEach((row, i) => {
      const y = 1.65 + i * 0.64, pct = Number(row[3]) || 0;
      s.text(0.5, y, 2.8, 0.5, [{ text: cut(String(row[0]), 22), size: 16, bold: true }], 'ctr');
      s.rect(3.4, y + 0.1, 4.2, 0.3, TRACK);
      s.rect(3.4, y + 0.1, 4.2 * Math.min(pct, 1.2) / 1.2, 0.3, pct >= 1 ? GREEN : pct >= 0.7 ? AMBER : RED);
      s.text(7.7, y, 2.2, 0.5, [{ text: `${row[2]} of ${row[1]} · ${Math.round(pct * 100)}%`, size: 13 }], 'ctr');
      s.text(9.95, y, 3.0, 0.5, [{ text: row[5] === '' ? '' : `ends near ${Math.round(Number(row[5]) * 100)}%`, size: 12, color: MUTED }], 'ctr');
    });
    slides.push(s);
  }

  // 6. sales and stock
  const last = new Slide();
  header(last, 'Sales and stock', 'Counts only; no IMEI numbers in this report');
  last.rect(0.5, 1.65, 6.0, 5.1, CARD, true); last.rect(6.8, 1.65, 6.0, 5.1, CARD, true);
  const sales = model.sales.rows.slice(0, 9), stock = model.stock.rows.slice(0, 9);
  last.text(0.65, 1.75, 5.7, 4.9, [{ text: 'Sales this month', size: 15, bold: true, color: GREEN }, ...(sales.length ? sales.map(r => ({ text: `• ${cut(String(r[0]), 18)} · ${r[1]}: ${r[2]}`, size: 12 })) : [{ text: 'No sales recorded this month.', size: 12, color: MUTED }]), ...(model.sales.rows.length > 9 ? [{ text: `…and ${model.sales.rows.length - 9} more rows`, size: 11, color: MUTED }] : [])]);
  last.text(6.95, 1.75, 5.7, 4.9, [{ text: 'Most stock', size: 15, bold: true, color: GREEN }, ...(stock.length ? stock.map(r => ({ text: `• ${cut(String(r[0]), 24)} ${r[1]} ${r[2]}: ${r[4]}`.replace(/\s+:/, ':'), size: 12 })) : [{ text: 'No stock listed.', size: 12, color: MUTED }]), ...(model.stock.rows.length > 9 ? [{ text: `…and ${model.stock.rows.length - 9} more models`, size: 11, color: MUTED }] : [])]);
  slides.push(last);
  slides.forEach((s, i) => { if (i > 0) footer(s, model, i + 1, slides.length); });
  return slides;
}

/** The whole file. */
export async function reportPptx(model: ReportModel): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const slides = reportSlides(model);
  const zip = new JSZip();
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (inner: string) => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
  const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  const ct = (part: string, type: string) => `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}"/>`;

  zip.file('[Content_Types].xml', `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${ct('/ppt/presentation.xml', 'presentationml.presentation.main+xml')}${ct('/ppt/slideMasters/slideMaster1.xml', 'presentationml.slideMaster+xml')}${ct('/ppt/slideLayouts/slideLayout1.xml', 'presentationml.slideLayout+xml')}${ct('/ppt/theme/theme1.xml', 'theme+xml')}${ct('/ppt/presProps.xml', 'presentationml.presProps+xml')}${ct('/ppt/viewProps.xml', 'presentationml.viewProps+xml')}${ct('/ppt/tableStyles.xml', 'presentationml.tableStyles+xml')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${ct('/docProps/app.xml', 'extended-properties+xml')}${slides.map((_, i) => ct(`/ppt/slides/slide${i + 1}.xml`, 'presentationml.slide+xml')).join('')}</Types>`);
  zip.file('_rels/.rels', rels(`${rel('rId1', 'officeDocument', 'ppt/presentation.xml')}<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>${rel('rId3', 'extended-properties', 'docProps/app.xml')}`));
  zip.file('docProps/core.xml', `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(model.title)}</dc:title><dc:creator>AI LENS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  zip.file('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>AI LENS</Application><Slides>${slides.length}</Slides></Properties>`);
  zip.file('ppt/presentation.xml', `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', rels(`${rel('rId1', 'slideMaster', 'slideMasters/slideMaster1.xml')}${slides.map((_, i) => rel(`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`)).join('')}${rel(`rId${slides.length + 2}`, 'theme', 'theme/theme1.xml')}${rel(`rId${slides.length + 3}`, 'presProps', 'presProps.xml')}${rel(`rId${slides.length + 4}`, 'viewProps', 'viewProps.xml')}${rel(`rId${slides.length + 5}`, 'tableStyles', 'tableStyles.xml')}`));
  zip.file('ppt/presProps.xml', `${XML}<p:presentationPr ${NS}/>`);
  zip.file('ppt/viewProps.xml', `${XML}<p:viewPr ${NS}><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
  zip.file('ppt/tableStyles.xml', `${XML}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  zip.file('ppt/slideMasters/slideMaster1.xml', `${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${group}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`);
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels(`${rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')}${rel('rId2', 'theme', '../theme/theme1.xml')}`));
  zip.file('ppt/slideLayouts/slideLayout1.xml', `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels(rel('rId1', 'slideMaster', '../slideMasters/slideMaster1.xml')));
  zip.file('ppt/theme/theme1.xml', `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="AI LENS"><a:themeElements><a:clrScheme name="AI LENS"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${INK}"/></a:dk2><a:lt2><a:srgbClr val="${CARD}"/></a:lt2><a:accent1><a:srgbClr val="${GREEN}"/></a:accent1><a:accent2><a:srgbClr val="${MINT}"/></a:accent2><a:accent3><a:srgbClr val="${AMBER}"/></a:accent3><a:accent4><a:srgbClr val="5B8DEF"/></a:accent4><a:accent5><a:srgbClr val="${RED}"/></a:accent5><a:accent6><a:srgbClr val="9FB3C8"/></a:accent6><a:hlink><a:srgbClr val="${GREEN}"/></a:hlink><a:folHlink><a:srgbClr val="5B8DEF"/></a:folHlink></a:clrScheme><a:fontScheme name="AI LENS"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="AI LENS"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`);
  slides.forEach((slide, i) => {
    zip.file(`ppt/slides/slide${i + 1}.xml`, slide.xml());
    zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels(rel('rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml')));
  });
  return new Blob([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) as unknown as BlobPart], { type: PPTX_TYPE });
}
