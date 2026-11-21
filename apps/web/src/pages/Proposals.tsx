import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, downloadFile, money } from '../api';
import { useAuth, useCan } from '../auth';
import { PageHead } from '../components';

const whole = (n?: number) => (n === undefined || n === null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
export const PROPOSAL_STATUSES: [string, string, string][] = [
  ['draft', 'Draft', 'b-neutral'], ['review', 'In review', 'b-warn'], ['completed', 'Completed', 'b-ok'], ['sent', 'Sent', 'b-primary'], ['won', 'Won', 'b-ok'], ['lost', 'Lost', 'b-bad'],
];
export const StatusPill = ({ s }: { s: string }) => { const x = PROPOSAL_STATUSES.find((p) => p[0] === s); return <span className={`badge ${x?.[2] ?? 'b-neutral'}`}>{x?.[1] ?? s}</span>; };

/** The proposal queue: every saved proposal, to reopen, recalculate, copy or share. */
export default function Proposals() {
  const can = useCan();
  const { user } = useAuth();
  const nav = useNavigate();
  const [list, setList] = useState<any[]>();
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('');
  const [owner, setOwner] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => api('/proposals').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const owners = useMemo(() => [...new Map((list ?? []).filter((p) => p.owner_id).map((p) => [p.owner_id, p.owner_name])).entries()], [list]);
  const shown = (list ?? []).filter((p) => (!status || p.status === status) && (!owner || p.owner_id === owner) && (!search || `${p.name} ${p.company ?? ''} ${p.client_name ?? ''} ${p.file_name ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const count = (s: string) => (list ?? []).filter((p) => p.status === s).length;
  const completed = (list ?? []).filter((p) => ['completed', 'sent', 'won'].includes(p.status));
  const act = async (label: string, fn: () => Promise<any>) => {
    setErr(''); setMsg(''); setBusy(label);
    try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const recalc = (p: any) => act(`Recalculating ${p.name}…`, async () => {
    const before = p.summary?.employerAnnualSavings?.total;
    const r = await api(`/proposals/${p.id}/recalculate`, { method: 'POST' });
    const after = r.result.summary.employerAnnualSavings.total;
    setMsg(`Recalculated ${p.name} with today's tax data: employer savings ${money(before)} → ${money(after)}.`);
    await load();
  });
  const exportFile = (p: any) => act(`Building the Excel file for ${p.name}…`, () => downloadFile(`/proposals/${p.id}/export`, `${p.name} - Employee allotments.xlsx`));
  const duplicate = (p: any) => act('Copying…', async () => { const r = await api(`/proposals/${p.id}/duplicate`, { method: 'POST' }); nav(`/proposals/${r.id}`); });
  const remove = (p: any) => { if (confirm(`Delete proposal "${p.name}"? Its client links stop working.`)) void act('Deleting…', async () => { await api(`/proposals/${p.id}`, { method: 'DELETE' }); await load(); }); };
  const move = (p: any, to: string) => act('', async () => { await api(`/proposals/${p.id}/status`, { json: { status: to } }); await load(); });
  const copyLink = (slug: string) => { void navigator.clipboard?.writeText(`${location.origin}/r/${slug}`)?.catch(() => {}); setMsg('Client link copied.'); };

  return (
    <>
      <PageHead eyebrow="Proposal tool" title="Proposal queue" actions={can('proposals.edit') && <Link to="/proposals/new"><button className="primary">New proposal</button></Link>}>
        {list?.length
          ? <><b>{list.length}</b> {can('proposals.view_all') ? '' : 'of your '}{list.length === 1 ? 'proposal' : 'proposals'} worth <b>{whole(list.reduce((a, p) => a + (p.summary?.employerAnnualSavings?.total ?? 0), 0))}</b> a year in employer savings. <b>{completed.length}</b> {completed.length === 1 ? 'is' : 'are'} completed or further along.</>
          : 'Saved proposals land here. Reopen any of them to change the rules, recalculate, and publish a fresh client link.'}
      </PageHead>
      {err && <div className="err" style={{ marginBottom: 16 }}>{err}</div>}
      {(msg || busy) && <div className="fg-callout" style={{ marginBottom: 16 }}>{busy || msg}</div>}
      <div className="row" style={{ marginBottom: 16, alignItems: 'center' }}>
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={!status ? 'on' : ''} onClick={() => setStatus('')}>All {list?.length ?? ''}</button>
          {PROPOSAL_STATUSES.map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l} {count(k) || ''}</button>)}
        </div>
      </div>
      <div className="panel">
        <div className="row" style={{ marginBottom: 12 }}>
          <label style={{ minWidth: 260 }}>Search<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, company, client or file…" /></label>
          {can('proposals.view_all') && owners.length > 0 && <label>Owner<select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Everyone</option>{owners.map(([id, n]) => <option key={id} value={id}>{id === user?.id ? `${n} (you)` : n}</option>)}</select></label>}
        </div>
        {!list ? <span className="muted">Loading…</span> : shown.length === 0 ? <span className="muted">{list.length ? 'No proposals match.' : 'No proposals yet. Start one with "New proposal".'}</span> : (
          <div className="fg-tablebox"><table>
            <thead><tr><th>Proposal</th><th>Status</th><th className="fg-hide-narrow">Owner</th><th className="num">Eligible</th><th className="num">Employer savings / yr</th><th className="fg-hide-narrow">Client link</th><th>Updated</th><th /></tr></thead>
            <tbody>{shown.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/proposals/${p.id}`}><b>{p.name}</b></Link><div className="muted small">{p.client_name ?? p.company ?? ''}{p.file_name ? ` · ${p.file_name}` : ''}</div>{p.notes && <div className="small">{p.notes}</div>}</td>
                <td>{can('proposals.edit')
                  ? <span className="fg-pill-select" title="Change status"><StatusPill s={p.status} /><span aria-hidden="true" className="muted small"> ▾</span><select aria-label={`Status of ${p.name}`} value={p.status} onChange={(e) => move(p, e.target.value)}>{PROPOSAL_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></span>
                  : <StatusPill s={p.status} />}</td>
                <td className="fg-hide-narrow">{p.owner_name ?? <span className="muted">—</span>}</td>
                <td className="num">{p.summary?.eligibleTotal ?? '—'}{p.summary?.employees ? <span className="muted small"> / {p.summary.employees}</span> : null}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}><b>{whole(p.summary?.employerAnnualSavings?.total)}</b><div className="muted small">{whole(p.summary?.valuationIncrease)} valuation</div></td>
                <td className="fg-hide-narrow" style={{ whiteSpace: 'nowrap' }}>{p.latest_report && <button className="fg-link small" onClick={() => copyLink(p.latest_report.slug)} title={`/r/${p.latest_report.slug}`}>Copy link</button>}{p.latest_report && <div className="muted small">{p.latest_report.views} {p.latest_report.views === 1 ? 'view' : 'views'}</div>}{!p.latest_report && <span className="muted small">Not published</span>}</td>
                <td className="small" style={{ whiteSpace: 'nowrap' }}>{new Date(p.updated_at).toLocaleDateString()}<div className="muted">{p.revisions} versions</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="small" disabled={!!busy} title="Excel file with each employee's status and savings allotment" onClick={() => exportFile(p)}>Export</button>{' '}
                  {can('proposals.edit') && <><button className="small" disabled={!!busy} onClick={() => recalc(p)}>Recalculate</button>{' '}<button className="small" disabled={!!busy} onClick={() => duplicate(p)}>Copy</button>{' '}</>}
                  {can('proposals.delete') && <button className="small" disabled={!!busy} onClick={() => remove(p)}>Delete</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
