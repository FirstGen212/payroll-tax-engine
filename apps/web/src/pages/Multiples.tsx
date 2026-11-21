import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useCan } from '../auth';
import { PageHead } from '../components';

export interface MultipleRow { id: string; industry: string; ownership: 'private' | 'public'; sizeBand: string; multiple: number; seedMultiple: number | null; basis: 'published' | 'derived' | 'custom'; source: string; sourceUrl: string | null; asOf: string | null; method: string | null; updatedAt?: string; updatedBy?: string }
export interface MultiplesData { industries: { key: string; label: string }[]; sizes: { key: string; label: string; short: string }[]; rows: MultipleRow[] }

/** The row a proposal uses: the industry at that size, or the industry average (public figures are not split by size). */
export function pickMultiple(rows: MultipleRow[], industry?: string, ownership: string = 'private', sizeBand?: string): MultipleRow | undefined {
  if (!industry) return undefined;
  const mine = rows.filter((r) => r.industry === industry && r.ownership === ownership);
  return (ownership === 'private' ? mine.find((r) => r.sizeBand === (sizeBand || 'all')) : undefined) ?? mine.find((r) => r.sizeBand === 'all');
}

export const BASIS_WORD: Record<string, string> = { published: 'Published figure', derived: 'Calculated from published figures', custom: "First Gen's own figure" };
const x = (n: number) => `${n.toFixed(1)}x`;

export default function Multiples() {
  const [data, setData] = useState<MultiplesData>();
  const [sel, setSel] = useState<string>();
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState('');
  const can = useCan();
  const mayEdit = can('rules.edit');
  useEffect(() => { api('/multiples').then(setData); }, []);
  const byId = useMemo(() => new Map((data?.rows ?? []).map((r) => [r.id, r])), [data]);
  if (!data) return <p className="muted">Loading…</p>;
  const row = sel ? byId.get(sel) : undefined;
  const edited = data.rows.filter((r) => r.basis === 'custom').length;
  const privAll = data.rows.filter((r) => r.ownership === 'private' && r.sizeBand === 'all').map((r) => r.multiple);
  const open = (r?: MultipleRow) => { if (!r) return; setSel(r.id); setValue(String(r.multiple)); setMsg(''); };
  const put = (r: MultipleRow) => setData({ ...data, rows: data.rows.map((o) => (o.id === r.id ? r : o)) });
  const save = async () => {
    const n = Number(value);
    if (!(n > 0 && n <= 100)) { setMsg('Enter a multiple between 0 and 100.'); return; }
    try { put(await api(`/multiples/${encodeURIComponent(sel!)}`, { method: 'PUT', json: { multiple: n } })); setMsg('Saved. Proposals pick it up the next time they are recalculated.'); } catch (e: any) { setMsg(e.message); }
  };
  const reset = async () => { try { const r = await api(`/multiples/${encodeURIComponent(sel!)}/reset`, { method: 'POST', json: {} }); put(r); setValue(String(r.multiple)); setMsg('Back to the sourced figure.'); } catch (e: any) { setMsg(e.message); } };
  const cell = (industry: string, ownership: 'private' | 'public', size: string) => {
    const r = byId.get(`${industry}|${ownership}|${size}`);
    if (!r) return <td className="num muted">n/a</td>;
    return (
      <td className="num">
        <button type="button" className={`fg-cell${sel === r.id ? ' on' : ''}`} onClick={() => open(r)} aria-label={`${x(r.multiple)}, ${BASIS_WORD[r.basis]}. Show details`}>
          {x(r.multiple)}{r.basis === 'custom' && <span className="fg-subline">edited</span>}
        </button>
      </td>
    );
  };
  const label = (k: string) => data.industries.find((i) => i.key === k)?.label ?? k;
  const sizes = data.sizes.filter((s) => s.key !== 'all');
  return (
    <>
      <PageHead eyebrow="Valuation multiples" title="Typical EBITDA multiples by industry and size">
        <b>{data.industries.length}</b> industries. Private companies average between <b>{x(Math.min(...privAll))}</b> and <b>{x(Math.max(...privAll))}</b> across sizes, and <b>{edited}</b> {edited === 1 ? 'figure has' : 'figures have'} been edited by First Gen. A proposal picks its multiple from this table by industry, ownership and company size.
      </PageHead>
      <div className="panel">
        <p className="muted small" style={{ marginTop: 0 }}>
          Private figures are GF Data averages of enterprise value to adjusted EBITDA on private-equity deals. The industry average column is published as is. GF Data does not publish industry by size, so each size column is calculated: the all-industry average for that size, scaled by how the industry compares with all deals. Public figures are NYU Stern industry averages for listed companies with positive EBITDA, and are not split by size. Company size means the value of the whole business. Select a figure to see its source{mayEdit ? ' or change it' : ''}.
        </p>
        <div className="fg-tablebox tall fg-multiples">
          <table>
            <thead>
              <tr><th rowSpan={2}>Industry</th><th className="num" rowSpan={2}>Private, any size<br /><span className="fg-subline">published</span></th><th colSpan={sizes.length} style={{ textAlign: 'center' }}>Private, by company value (calculated)</th><th className="num" rowSpan={2}>Public<br /><span className="fg-subline">published</span></th></tr>
              <tr>{sizes.map((s) => <th key={s.key} className="num">{s.short}</th>)}</tr>
            </thead>
            <tbody>
              {data.industries.map((i) => (
                <tr key={i.key}><td>{i.label}</td>{cell(i.key, 'private', 'all')}{sizes.map((s) => <Fragment key={s.key}>{cell(i.key, 'private', s.key)}</Fragment>)}{cell(i.key, 'public', 'all')}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {row && (
        <div className="panel" aria-live="polite">
          <h3 style={{ marginTop: 0 }}>{label(row.industry)}: {row.ownership} companies, {row.sizeBand === 'all' ? 'any size' : `${data.sizes.find((s) => s.key === row.sizeBand)?.short} in value`}</h3>
          <p><b>{x(row.multiple)}</b> <span className={`badge ${row.basis === 'published' ? 'b-published' : row.basis === 'custom' ? 'b-warn' : 'b-neutral'}`}>{BASIS_WORD[row.basis]}</span></p>
          <p className="small">{row.method} {row.basis === 'custom' && row.seedMultiple !== null && <>The sourced figure is <b>{x(row.seedMultiple)}</b>.{row.updatedBy ? ` Changed by ${row.updatedBy}.` : ''}</>}</p>
          <p className="muted small">Source: {row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">{row.source}</a> : row.source}{row.asOf ? `, data to ${row.asOf}` : ''}.</p>
          {mayEdit && (
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <label>Multiple (x)<input style={{ width: 100 }} type="number" step="0.1" min="0" value={value} onChange={(e) => setValue(e.target.value)} /></label>
              <button className="primary" onClick={save} disabled={Number(value) === row.multiple}>Save as our figure</button>
              {row.basis === 'custom' && <button onClick={reset}>Back to the sourced figure</button>}
            </div>
          )}
          {msg && <p className="muted small" style={{ marginBottom: 0 }}>{msg}</p>}
        </div>
      )}
    </>
  );
}
