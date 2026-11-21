import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, PageHead } from '../components';

const example = `[
  {
    "label": "Sample check 1",
    "input": { "checkDate": "2027-01-15", "payFrequency": "biweekly",
      "employer": { "id": "x", "name": "Client" },
      "employee": { "id": "e1", "federalW4": { "version": "2020+", "filingStatus": "single" }, "residence": { "state": "NY" }, "work": [{ "state": "NY", "percent": 1 }], "stateW4": { "NY": {} } },
      "earnings": [{ "code": "REG", "amount": 2000 }] },
    "actualTaxes": { "US.FIT": 160.00, "US.SS_EE": 124.00, "US.MED_EE": 29.00, "NY.SIT": 85.11 }
  }
]`;

export default function Vendors() {
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState('adp');
  const [text, setText] = useState(example);
  const [result, setResult] = useState<any>();
  const [msg, setMsg] = useState('');
  const load = () => api('/vendor-profiles').then(setRows);
  useEffect(() => { load(); }, []);
  const upload = async () => { setMsg(''); try { const r = await api(`/vendor-profiles/${sel}/samples`, { json: JSON.parse(text) }); setMsg(`Added ${r.added} sample(s).`); } catch (e: any) { setMsg(e.message); } };
  const learn = async () => { setMsg(''); const r = await api(`/vendor-profiles/${sel}/learn`, { method: 'POST', json: {} }); if (r.error) setMsg(r.error); else { setResult(r); load(); } };
  return (
    <>
      <PageHead eyebrow="Vendor profiles" title="How each provider calculates"><b>{rows.length}</b> provider profiles. Upload sample paychecks to learn a provider's conventions, then calculate like that provider.</PageHead>
      <div className="panel">
        <p className="muted small">Each provider follows the same tax law but differs in conventions such as rounding, supplemental method, FICA true-ups and deduction order. Upload sample paychecks from a provider, then learn its profile. Pay runs and the calculator can then calculate like that provider.</p>
        <table><thead><tr><th>Provider</th><th>Status</th><th>Samples</th><th>Conventions</th><th>Notes</th></tr></thead>
          <tbody>{rows.map((v) => <tr key={v.id}><td>{v.name}</td><td><Badge s={v.status} /></td><td>{v.sample_count}</td><td className="small">{Object.entries(v.conventions).map(([k, x]) => `${k}: ${x}`).join('; ')}</td><td className="small muted">{v.notes}</td></tr>)}</tbody></table>
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Teach a profile from sample paychecks</h3>
        <div className="row"><label>Provider<select value={sel} onChange={(e) => setSel(e.target.value)}>{rows.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label></div>
        <label style={{ marginTop: 8 }}>Sample paychecks (JSON: engine input + the provider's actual tax amounts)<textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} /></label>
        <div className="row" style={{ marginTop: 8 }}><button onClick={upload}>Upload samples</button><button className="primary" onClick={learn}>Learn profile</button><span className="muted">{msg}</span></div>
      </div>
      {result && <div className="panel">
        <h3 style={{ marginTop: 0 }}>Learned {result.vendorId}: exact match {(result.exactMatchRate * 100).toFixed(1)}%, residual ${result.totalError} ({result.evaluated} convention combinations tested)</h3>
        <table><thead><tr><th>Convention</th><th>Best</th><th>Evidence (lowest error per option)</th></tr></thead>
          <tbody>{Object.entries(result.evidence).map(([k, v]: any) => <tr key={k}><td>{k}</td><td>{String(result.best[k])}</td><td className="small">{Object.entries(v).map(([o, e]) => `${o}: $${e}`).join('  |  ')}</td></tr>)}</tbody></table>
        {result.residuals.length > 0 && <><h3>Lines no convention explains (check setup, rates or data)</h3>
          <table><thead><tr><th>Check</th><th>Tax</th><th className="num">Provider</th><th className="num">Engine</th><th className="num">Diff</th></tr></thead>
            <tbody>{result.residuals.map((x: any, i: number) => <tr key={i}><td>{x.label}</td><td>{x.key}</td><td className="num">{x.expected}</td><td className="num">{x.computed}</td><td className="num">{x.diff}</td></tr>)}</tbody></table></>}
      </div>}
    </>
  );
}
