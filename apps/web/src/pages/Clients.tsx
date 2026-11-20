import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHead, StateSelect, useReference } from '../components';

export default function Clients() {
  const [clients, setClients] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', fein: '', homeState: 'NY', payFrequency: 'biweekly', currentVendor: '', futaExempt: false });
  const [err, setErr] = useState('');
  const ref = useReference();
  const load = () => api('/clients').then(setClients);
  useEffect(() => { load(); }, []);
  const create = async () => {
    setErr('');
    try { await api('/clients', { json: { ...form, currentVendor: form.currentVendor || undefined } }); setForm({ ...form, name: '', fein: '' }); load(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <>
      <PageHead eyebrow="Clients" title="Employers on file">
        <b>{clients.length}</b> {clients.length === 1 ? 'client' : 'clients'} with <b>{clients.reduce((a, c) => a + Number(c.employees ?? 0), 0)}</b> employees set up for actual, mock and proposal payroll.
      </PageHead>
      <div className="panel">
        <h3>Clients</h3>
        <div className="fg-tablebox"><table>
          <thead><tr><th>Client</th><th>FEIN</th><th>Home state</th><th>Frequency</th><th>Current provider</th><th className="num">Employees</th></tr></thead>
          <tbody>
            {clients.map((c) => <tr key={c.id}><td><Link to={`/clients/${c.id}`}>{c.name}</Link></td><td>{c.fein}</td><td>{c.home_state}</td><td>{c.pay_frequency}</td><td>{c.current_vendor}</td><td className="num">{c.employees}</td></tr>)}
            {!clients.length && <tr><td colSpan={6} className="muted">No clients yet. Add one below.</td></tr>}
          </tbody>
        </table></div>
      </div>
      <div className="panel">
        <h3>Add a client</h3>
        <div className="row">
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>FEIN<input value={form.fein} onChange={(e) => setForm({ ...form, fein: e.target.value })} /></label>
          <label>Home state<StateSelect value={form.homeState} onChange={(v) => setForm({ ...form, homeState: v })} /></label>
          <label>Pay frequency<select value={form.payFrequency} onChange={(e) => setForm({ ...form, payFrequency: e.target.value })}>{['weekly', 'biweekly', 'semimonthly', 'monthly'].map((f) => <option key={f}>{f}</option>)}</select></label>
          <label>Current provider<select value={form.currentVendor} onChange={(e) => setForm({ ...form, currentVendor: e.target.value })}><option value="">-</option>{(ref?.vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={form.futaExempt} onChange={(e) => setForm({ ...form, futaExempt: e.target.checked })} />FUTA-exempt (501(c)(3)/government)</label>
          <button className="primary" disabled={!form.name} onClick={create}>Add client</button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>
    </>
  );
}
