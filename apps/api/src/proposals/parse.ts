/** Parse uploaded .xlsx / .csv files into sheets of header-keyed rows. */
import ExcelJS from 'exceljs';

export interface ParsedSheet { name: string; headers: string[]; rows: Record<string, unknown>[] }

function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as any;
    if ('result' in o) return o.result instanceof Date ? o.result.toISOString().slice(0, 10) : o.result ?? null; // formula with cached result
    if ('formula' in o || 'sharedFormula' in o) return null; // formula with no cached value
    if ('richText' in o) return o.richText.map((t: any) => t.text).join('');
    if ('text' in o) return o.text;
    if ('error' in o) return null;
  }
  return v;
}

function headerRowIndex(grid: unknown[][]): number {
  // first row (within the top 15) with at least 3 text cells
  for (let i = 0; i < Math.min(grid.length, 15); i++) if (grid[i].filter((c) => typeof c === 'string' && c.trim()).length >= 3) return i;
  return 0;
}

function toSheet(name: string, grid: unknown[][]): ParsedSheet {
  const h = headerRowIndex(grid);
  const seen = new Map<string, number>();
  const headers = (grid[h] ?? []).map((c, i) => {
    let s = c === null || c === undefined || String(c).trim() === '' ? `Column ${i + 1}` : String(c).trim();
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    if (n) s = `${s} (${n + 1})`;
    return s;
  });
  const rows = grid.slice(h + 1)
    .filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((hd, i) => [hd, r[i] ?? null])));
  return { name, headers, rows };
}

export function parseCsv(text: string): unknown[][] {
  const out: unknown[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); out.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out.map((r) => r.map((c) => (c === '' ? null : c)));
}

export async function parseWorkbook(fileName: string, data: Buffer): Promise<ParsedSheet[]> {
  if (/\.(csv|txt)$/i.test(fileName)) return [toSheet(fileName.replace(/\.[^.]+$/, ''), parseCsv(data.toString('utf8')))];
  if (!/\.xlsx$|\.xlsm$/i.test(fileName)) throw Object.assign(new Error('Upload an .xlsx or .csv file (save .xls files as .xlsx first).'), { statusCode: 400 });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as any);
  const sheets: ParsedSheet[] = [];
  wb.eachSheet((ws) => {
    const grid: unknown[][] = [];
    const width = ws.columnCount;
    ws.eachRow({ includeEmpty: true }, (r, n) => {
      const vals: unknown[] = [];
      for (let c = 1; c <= width; c++) vals.push(cellValue(r.getCell(c).value));
      grid[n - 1] = vals;
    });
    for (let i = 0; i < grid.length; i++) grid[i] ??= [];
    if (grid.length) sheets.push(toSheet(ws.name, grid));
  });
  return sheets;
}
