export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data as T;
}

export const money = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const pct = (n: number | null | undefined, digits = 3) => (n === null || n === undefined ? '' : `${(n * 100).toFixed(digits)}%`);
