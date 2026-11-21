export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? 'POST' : 'GET'),
    headers: { ...(init?.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth:required'));
  if (res.status === 403) window.dispatchEvent(new CustomEvent('auth:forbidden', { detail: data.error ?? 'You do not have permission to do this.' }));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const money = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const pct = (n: number | null | undefined, digits = 3) => (n === null || n === undefined ? '' : `${(n * 100).toFixed(digits)}%`);

/** Save a file the API builds (the proposal workbook) to the person's computer. */
export async function downloadFile(path: string, name: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`/api${path}`, init);
  if (res.status === 401) window.dispatchEvent(new Event('auth:required'));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The file could not be built.');
  saveBlob(await res.blob(), name);
}

/** Hand a file to the browser's download. The address is freed a minute later: freeing it at once can cancel the download. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * One CSV cell. Text that starts with = + - @ or a tab is a formula to Excel, so a name like "=HYPERLINK(...)" in a
 * client's file could run when the CSV is opened: such text gets a leading apostrophe. Numbers are left as they are.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let t = String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r']/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** A CSV file from rows of cells (with a byte-order mark so Excel reads accents correctly). */
export const csvFile = (rows: unknown[][]) => new Blob(['\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
