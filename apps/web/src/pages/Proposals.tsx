import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../api';
import { PageHead } from '../components';

/** Saved proposals (underwriting runs). */
export default function Proposals() {
  const [list, setList] = useState<any[]>();
  const [err, setErr] = useState('');
  const load = () => api('/proposals').then(setList).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete proposal "${name}"?`)) return;
    await api(`/proposals/${id}`, { method: 'DELETE' });
    load();
  };
  return (
    <>
      <PageHead eyebrow="Proposal tool" title="Proposals" actions={<Link to="/proposals/new"><button className="primary">New proposal</button></Link>}>
        {list?.length ? <><b>{list.length}</b> saved {list.length === 1 ? 'proposal' : 'proposals'} covering <b>{list.reduce((a, p) => a + (p.summary?.eligibleTotal ?? 0), 0)}</b> eligible employees and <b>{money(list.reduce((a, p) => a + (p.summary?.monthlySavings?.total ?? 0), 0))}</b> in monthly savings.</> : 'Upload a census or underwriting sheet to compare every employee\'s taxes before and after the new pre-tax deduction.'}
      </PageHead>
      {err && <div className="err">{err}</div>}
      <div className="panel">
        <h3>Saved proposals</h3>
        {!list ? <span className="muted">Loading…</span> : list.length === 0 ? <span className="muted">No proposals yet. Start one with "New proposal".</span> : (
          <div className="fg-tablebox"><table>
            <thead><tr><th>Proposal</th><th>Client / company</th><th>Status</th><th className="num">Employees</th><th className="num">Eligible</th><th className="num">Monthly savings</th><th className="num">Employer savings / yr</th><th className="num">Valuation increase</th><th>Updated</th><th /></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/proposals/${p.id}`}>{p.name}</Link><div className="muted small">{p.file_name}</div></td>
                <td>{p.client_name ?? p.company ?? ''}</td>
                <td><span className={`badge ${p.status === 'won' ? 'b-ok' : p.status === 'lost' ? 'b-bad' : p.status === 'sent' ? 'b-primary' : 'b-neutral'}`}>{p.status}</span></td>
                <td className="num">{p.summary?.employees}</td>
                <td className="num">{p.summary?.eligibleTotal}</td>
                <td className="num">{money(p.summary?.monthlySavings?.total)}</td>
                <td className="num">{money(p.summary?.employerAnnualSavings?.total)}</td>
                <td className="num">{money(p.summary?.valuationIncrease)}</td>
                <td className="muted small">{new Date(p.updated_at).toLocaleString()}</td>
                <td><button className="small" onClick={() => remove(p.id, p.name)}>Delete</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
