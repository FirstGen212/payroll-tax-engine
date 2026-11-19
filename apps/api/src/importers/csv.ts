/** Minimal RFC 4180 CSV parser (quoted fields, embedded commas/newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (ch === '"') q = false;
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export const pctNum = (v: string | undefined) => {
  if (!v) return 0;
  const n = Number(v.replace(/[%\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Pick the first present column among aliases (case-insensitive). */
export function col(row: Record<string, string>, ...aliases: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const a of aliases) {
    const k = keys.find((x) => x.toLowerCase() === a.toLowerCase());
    if (k) return row[k];
  }
  return undefined;
}
