import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money } from '../api';

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
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Proposal tool</h2>
        <Link to="/proposals/new"><button className="primary">New proposal</button></Link>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Upload a census, underwriting sheet or payroll sample, map its columns, set pricing tiers, and compare every employee's taxes and take-home pay before and after the new pre-tax deduction.</p>
      {err && <div className="err">{err}</div>}
      <div className="panel">
        {!list ? <span className="muted">Loading…</span> : list.length === 0 ? <span className="muted">No proposals yet. Start one with "New proposal".</span> : (
          <table>
            <thead><tr><th>Proposal</th><th>Client / company</th><th>Status</th><th className="num">Employees</th><th className="num">Eligible</th><th className="num">Employer net savings / yr</th><th className="num">Employee gain / yr</th><th>Updated</th><th /></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/proposals/${p.id}`}>{p.name}</Link><div className="muted small">{p.file_name}</div></td>
                <td>{p.client_name ?? p.company ?? ''}</td>
                <td><span className={`badge ${p.status === 'won' ? 'b-published' : p.status === 'lost' ? 'b-placeholder' : 'b-projected'}`}>{p.status}</span></td>
                <td className="num">{p.summary?.employees}</td>
                <td className="num">{p.summary?.eligibleAfterPricing}</td>
                <td className="num">{money(p.summary?.eligible?.employerNetSavings)}</td>
                <td className="num">{money(p.summary?.eligible?.employeeNetGain)}</td>
                <td className="muted small">{new Date(p.updated_at).toLocaleString()}</td>
                <td><button className="small" onClick={() => remove(p.id, p.name)}>Delete</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
