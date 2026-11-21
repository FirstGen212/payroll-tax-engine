/** Parse uploaded .xlsx / .csv files into sheets of header-keyed rows. */
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

export interface ParsedSheet { name: string; headers: string[]; rows: Record<string, unknown>[]; /** true when the sheet had more rows than are read */ truncated?: boolean }

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

/** Limits that keep one awkward spreadsheet from using all the server's memory. */
export const MAX_ROWS_PER_SHEET = 20000;
export const MAX_COLUMNS = 300;

function headerRowIndex(grid: unknown[][]): number {
  // first row (within the top 15) with at least 3 text cells
  for (let i = 0; i < Math.min(grid.length, 15); i++) if (grid[i].filter((c) => typeof c === 'string' && c.trim()).length >= 3) return i;
  return 0;
}

const blank = (c: unknown) => c === null || c === undefined || String(c).trim() === '';

function toSheet(name: string, grid: unknown[][], truncated = false): ParsedSheet {
  const h = headerRowIndex(grid);
  // The header row ends at its last filled cell: a stray cell far to the right must not create thousands of columns.
  const head = (grid[h] ?? []).slice(0, MAX_COLUMNS);
  while (head.length && blank(head[head.length - 1])) head.pop();
  const seen = new Map<string, number>();
  const headers = head.map((c, i) => {
    let s = blank(c) ? `Column ${i + 1}` : String(c).trim();
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    if (n) s = `${s} (${n + 1})`;
    return s;
  });
  const rows = grid.slice(h + 1)
    .filter((r) => headers.some((_, i) => !blank(r[i])))
    .map((r) => Object.fromEntries(headers.map((hd, i) => [hd, r[i] ?? null])));
  return truncated ? { name, headers, rows, truncated } : { name, headers, rows };
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
  if (/\.(csv|txt)$/i.test(fileName)) {
    const grid = parseCsv(data.toString('utf8'));
    const over = grid.length > MAX_ROWS_PER_SHEET + 15;
    return [toSheet(fileName.replace(/\.[^.]+$/, ''), over ? grid.slice(0, MAX_ROWS_PER_SHEET + 15) : grid, over)];
  }
  if (!/\.xlsx$|\.xlsm$/i.test(fileName)) throw Object.assign(new Error('Upload an .xlsx or .csv file (save .xls files as .xlsx first).'), { statusCode: 400 });
  // Read the workbook as a stream, one row at a time, keeping only rows that hold a value. Loading it whole builds an object for
  // every formatted cell, and a sheet formatted down to the last row (common in client files) then needs more memory than the server has.
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([data]) as any, { sharedStrings: 'cache', styles: 'cache', hyperlinks: 'ignore', worksheets: 'emit', entries: 'emit' });
  const sheets: ParsedSheet[] = [];
  for await (const ws of reader) {
    const grid: unknown[][] = [];
    let kept = 0, truncated = false;
    for await (const row of ws) {
      if (truncated) continue; // keep draining the stream so the next sheet can be read
      const src = row.values as unknown[]; // 1-based, sparse
      const vals: unknown[] = [];
      let any = false;
      const width = Math.min(src.length - 1, MAX_COLUMNS);
      for (let c = 1; c <= width; c++) {
        const v = cellValue(src[c]);
        vals.push(v ?? null);
        if (!blank(v)) any = true;
      }
      if (!any) continue;
      // Rows in the top 15 keep their position, because the header row is looked for there.
      if (row.number <= 15) { while (grid.length < row.number - 1) grid.push([]); }
      grid.push(vals);
      if (++kept >= MAX_ROWS_PER_SHEET + 15) truncated = true;
    }
    const name = (ws as any).name ?? `Sheet ${sheets.length + 1}`;
    if (grid.length) sheets.push(toSheet(name, grid, truncated));
  }
  return sheets;
}
