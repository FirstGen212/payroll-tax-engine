import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, money, pct } from '../api';
import { Badge, LocalPicker, StateSelect } from '../components';

export default function ClientDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState('employees');
  const [client, setClient] = useState<any>();
  const load = () => api(`/clients/${id}`).then(setClient);
  useEffect(() => { load(); }, [id]);
  if (!client) return null;
  return (
    <>
      <h2>{client.name} <span className="muted small">{client.fein} - {client.home_state} - {client.pay_frequency}</span></h2>
      <div className="tabs">
        {[['employees', 'Employees'], ['locations', 'Work locations'], ['taxes', 'Tax setup and toggles'], ['runs', 'Pay runs']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'employees' && <Employees clientId={id!} />}
      {tab === 'locations' && <Locations client={client} reload={load} />}
      {tab === 'taxes' && <TaxSetup clientId={id!} />}
      {tab === 'runs' && <Runs clientId={id!} />}
    </>
  );
}

function Employees({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api(`/clients/${clientId}/employees`).then(setRows); }, [clientId]);
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="muted">{rows.length} employees</span>
        <span className="row"><Link to={`/clients/${clientId}/employees/new`}><button>Add employee</button></Link><Link to={`/clients/${clientId}/payrun`}><button className="primary">Start pay run</button></Link></span>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Pay</th><th>Residence</th><th>W-4</th><th>FICA</th></tr></thead>
        <tbody>{rows.map((e) => (
          <tr key={e.id}><td><Link to={`/employees/${e.id}`}>{e.last_name}, {e.first_name}</Link></td><td>{e.pay_type} {money(e.pay_rate)}</td><td>{e.residence_state} {e.residence_locals.join(', ')}</td><td>{e.federal_w4.version} {e.federal_w4.filingStatus}</td><td>{e.ss_covered ? 'SS+Med' : 'Medicare only'}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Locations({ client, reload }: { client: any; reload: () => void }) {
  const [f, setF] = useState({ label: '', state: client.home_state ?? 'NY', localCodes: [] as string[], address: '' });
  const add = async () => { await api(`/clients/${client.id}/locations`, { json: f }); setF({ ...f, label: '', localCodes: [], address: '' }); reload(); };
  return (
    <div className="panel">
      <table><thead><tr><th>Location</th><th>State</th><th>Local jurisdictions</th><th>Address</th></tr></thead>
        <tbody>{client.locations.map((l: any) => <tr key={l.id}><td>{l.label}</td><td>{l.state}</td><td>{l.local_codes.join(', ')}</td><td>{l.address}</td></tr>)}</tbody></table>
      <h3>Add work location</h3>
      <div className="row">
        <label>Label<input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
        <label>State<StateSelect value={f.state} onChange={(v) => setF({ ...f, state: v, localCodes: [] })} /></label>
        <label style={{ minWidth: 320 }}>Locals<LocalPicker state={f.state} value={f.localCodes} onChange={(v) => setF({ ...f, localCodes: v })} /></label>
        <label>Address<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
        <button className="primary" disabled={!f.label} onClick={add}>Add</button>
      </div>
    </div>
  );
}

function TaxSetup({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [dirty, setDirty] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState('');
  const load = () => api(`/clients/${clientId}/applicable-taxes`).then(setRows);
  useEffect(() => { load(); }, [clientId]);
  const set = (key: string, patch: any) => setDirty({ ...dirty, [key]: { ...(dirty[key] ?? {}), ...patch } });
  const save = async () => {
    const body = Object.entries(dirty).map(([taxKey, v]: any) => {
      const row = rows.find((r) => r.key === taxKey);
      return { taxKey, enabled: v.enabled ?? row?.enabled, rate: v.rate !== undefined ? (v.rate === '' ? null : Number(v.rate) / 100) : row?.rate, accountNumber: v.accountNumber ?? row?.accountNumber };
    });
    await api(`/clients/${clientId}/tax-settings`, { method: 'PUT', json: body });
    setDirty({}); setSaved('Saved.'); load();
  };
  return (
    <div className="panel">
      <p className="muted small">Every tax that can apply to this client's work locations and employee residences. Switch taxes on or off, enter assigned SUI and program rates, and account numbers. Add work locations and employees first so their jurisdictions appear here.</p>
      <table>
        <thead><tr><th>On</th><th>Tax</th><th>Payer</th><th>Default rate</th><th>Client rate %</th><th>Account #</th><th>Data</th></tr></thead>
        <tbody>{rows.map((r) => {
          const d = dirty[r.key] ?? {};
          return (
            <tr key={r.ruleId}>
              <td><input type="checkbox" checked={d.enabled ?? r.enabled} onChange={(e) => set(r.key, { enabled: e.target.checked })} /></td>
              <td>{r.name}<div className="muted small">{r.key}{r.optional ? ' - optional, off by default' : ''}</div></td>
              <td>{r.payer === 'employee' ? 'EE' : 'ER'}</td>
              <td>{pct(r.defaultRate)}</td>
              <td>{r.rateOverridable ? <input style={{ width: 90 }} value={d.rate ?? (r.rate != null ? (r.rate * 100).toFixed(4) : '')} onChange={(e) => set(r.key, { rate: e.target.value })} /> : <span className="muted small">fixed</span>}</td>
              <td><input style={{ width: 130 }} value={d.accountNumber ?? r.accountNumber ?? ''} onChange={(e) => set(r.key, { accountNumber: e.target.value })} /></td>
              <td><Badge s={r.status} /></td>
            </tr>
          );
        })}</tbody>
      </table>
      <div className="row" style={{ marginTop: 12 }}><button className="primary" disabled={!Object.keys(dirty).length} onClick={save}>Save tax setup</button><span className="muted">{saved}</span></div>
    </div>
  );
}

function Runs({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api(`/clients/${clientId}/payruns`).then(setRows); }, [clientId]);
  return (
    <div className="panel">
      <table><thead><tr><th>Check date</th><th>Type</th><th>Vendor profile</th><th>Label</th><th className="num">Gross</th><th className="num">Net</th><th className="num">Employer cost</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td><Link to={`/payruns/${r.id}`}>{String(r.check_date).slice(0, 10)}</Link></td><td>{r.run_type}</td><td>{r.vendor_profile_id ?? 'generic'}</td><td>{r.label}</td><td className="num">{money(r.totals?.gross)}</td><td className="num">{money(r.totals?.net)}</td><td className="num">{money(r.totals?.employerCost)}</td></tr>)}</tbody></table>
    </div>
  );
}
