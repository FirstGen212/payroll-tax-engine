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
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}
