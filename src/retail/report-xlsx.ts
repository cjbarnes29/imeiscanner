/**
 * The app report as an Excel file (.xlsx): a Summary sheet and one sheet per table (segments, people, outlook, sales, stock), with a header row, widths,
 * real numbers (percent columns are real percentages) and frozen headings. Uses the `exceljs` package the app already loads for other files, only when
 * the person asks for this file. No IMEIs, serials or photos are written.
 */
import type { ReportModel, ReportTable } from './report-model';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GREEN = 'FF1F5F4B';

/** Excel sheet names: at most 31 characters, none of \ / ? * [ ] : */
const sheetName = (title: string) => title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';

export async function reportXlsx(model: ReportModel): Promise<Blob> {
  const ExcelJS = await import('exceljs');
  const Workbook = (ExcelJS as unknown as { Workbook?: typeof ExcelJS.Workbook; default?: { Workbook: typeof ExcelJS.Workbook } }).Workbook || (ExcelJS as unknown as { default: { Workbook: typeof ExcelJS.Workbook } }).default.Workbook;
  const book = new Workbook();
  book.creator = 'AI LENS'; book.created = new Date(); book.title = model.title;

  const summary = book.addWorksheet('Summary');
  summary.columns = [{ width: 34 }, { width: 22 }, { width: 60 }];
  summary.addRow([model.title]).font = { bold: true, size: 16 };
  summary.addRow([`For: ${model.who}`, `Made ${model.generatedOn}`]);
  summary.addRow([]);
  const head = summary.addRow(['Measure', 'Value']);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; });
  for (const kpi of model.kpis) summary.addRow([kpi.label, kpi.value]);
  summary.addRow([]);
  summary.addRow(['Highlights']).font = { bold: true };
  for (const line of model.highlights) { const row = summary.addRow([line]); summary.mergeCells(row.number, 1, row.number, 3); row.alignment = { wrapText: true, vertical: 'top' }; row.height = Math.max(18, Math.ceil(line.length / 90) * 16); }

  const add = (table: ReportTable) => {
    const sheet = book.addWorksheet(sheetName(table.title));
    const header = sheet.addRow(table.head);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }; });
    if (!table.rows.length) sheet.addRow(['Nothing to show.']);
    for (const row of table.rows) sheet.addRow(row.map(cell => (cell === '' ? null : cell)));
    table.head.forEach((_, i) => {
      const column = sheet.getColumn(i + 1);
      const longest = Math.max(table.head[i].length, ...table.rows.map(r => String(r[i] ?? '').length));
      column.width = Math.min(60, Math.max(10, longest + 2));
      if (table.fmt[i] === 'pct') column.numFmt = '0%'; else if (table.fmt[i] === 'int') column.numFmt = '0';
      if (table.fmt[i] !== 'text') column.alignment = { horizontal: 'right' };
    });
    header.eachCell(cell => { cell.numFmt = '@'; cell.alignment = { vertical: 'middle', wrapText: true, horizontal: 'left' }; });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    if (table.rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: table.head.length } };
    if (table.note) { sheet.addRow([]); sheet.addRow([table.note]).font = { italic: true, color: { argb: 'FF6B7280' } }; }
  };
  for (const table of [model.segments, model.people, model.outlook, model.sales, model.stock]) add(table);

  const buffer = await book.xlsx.writeBuffer();
  return new Blob([buffer as ArrayBuffer], { type: XLSX_TYPE });
}
