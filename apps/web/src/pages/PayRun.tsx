import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, money } from '../api';
import { PayStub, useReference } from '../components';
import { EarningRows } from '../forms';

export default function PayRun() {
  const { id } = useParams();
  const nav = useNavigate();
  const ref = useReference();
  const [client, setClient] = useState<any>();
  const [emps, setEmps] = useState<any[]>([]);
  const [lines, setLines] = useState<Record<string, any[]>>({});
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [opts, setOpts] = useState({ checkDate: '2027-01-15', runType: 'mock', vendorProfileId: '', label: '' });
  const [preview, setPreview] = useState<any>();
  const [err, setErr] = useState('');
  useEffect(() => {
    api(`/clients/${id}`).then((c) => { setClient(c); setOpts((o) => ({ ...o, vendorProfileId: c.current_vendor ?? '' })); });
    api(`/clients/${id}/employees`).then((rows) => {
      setEmps(rows);
      const l: Record<string, any[]> = {}; const inc: Record<string, boolean> = {};
      for (const e of rows) {
        inc[e.id] = e.active;
        l[e.id] = e.pay_type === 'salary' ? [{ code: 'SALARY', amount: Number(e.pay_rate) }] : [{ code: 'REG', hours: Number(e.standard_hours), rate: Number(e.pay_rate), amount: Math.round(Number(e.standard_hours) * Number(e.pay_rate) * 100) / 100 }];
      }
      setLines(l); setInclude(inc);
    });
  }, [id]);
  const body = (save: boolean) => ({ ...opts, vendorProfileId: opts.vendorProfileId || undefined, label: opts.label || undefined, save, lines: emps.filter((e) => include[e.id]).map((e) => ({ employeeId: e.id, earnings: lines[e.id] })) });
  const run = async (save: boolean) => {
    setErr('');
    try {
      const r = await api(`/clients/${id}/payruns`, { json: body(save) });
      if (save && r.id) nav(`/payruns/${r.id}`); else setPreview(r);
    } catch (e: any) { setErr(e.message); }
  };
  if (!client) return null;
  return (
    <>
      <h2>Pay run - {client.name}</h2>
      <div className="panel">
        <div className="row">
          <label>Check date<input type="date" value={opts.checkDate} onChange={(e) => setOpts({ ...opts, checkDate: e.target.value })} /></label>
          <label>Run type<select value={opts.runType} onChange={(e) => setOpts({ ...opts, runType: e.target.value })}><option value="mock">Mock payroll (simulation)</option><option value="proposal">Proposal / eligibility</option><option value="actual">Actual payroll (updates YTD)</option></select></label>
          <label>Calculate like<select value={opts.vendorProfileId} onChange={(e) => setOpts({ ...opts, vendorProfileId: e.target.value })}><option value="">By the book (IRS)</option>{(ref?.vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name} ({v.status})</option>)}</select></label>
          <label>Label<input value={opts.label} onChange={(e) => setOpts({ ...opts, label: e.target.value })} /></label>
        </div>
      </div>
      {emps.map((e) => (
        <div key={e.id} className="panel">
          <label className="check"><input type="checkbox" checked={!!include[e.id]} onChange={(ev) => setInclude({ ...include, [e.id]: ev.target.checked })} /><strong>{e.last_name}, {e.first_name}</strong> <span className="muted small">{e.residence_state} - {e.federal_w4.filingStatus}</span></label>
          {include[e.id] && <EarningRows rows={lines[e.id] ?? []} onChange={(r) => setLines({ ...lines, [e.id]: r })} />}
        </div>
      ))}
      {err && <div className="err">{err}</div>}
      <div className="row"><button onClick={() => run(false)}>Preview</button><button className="primary" onClick={() => run(true)}>Calculate and save run</button></div>
      {preview && <>
        <h3>Preview totals</h3>
        <div className="kpis">{[['Gross', preview.totals.gross], ['Employee taxes', preview.totals.employeeTaxes], ['Deductions', preview.totals.deductions], ['Net', preview.totals.net], ['Employer taxes', preview.totals.employerTaxes], ['Employer cost', preview.totals.employerCost]].map(([l, v]) => <div key={l} className="kpi"><div className="l">{l}</div><div className="v">{money(v)}</div></div>)}</div>
        {preview.results.map((r: any, i: number) => <PayStub key={i} r={r} title={emps.find((e) => e.id === r.employeeId)?.first_name + ' ' + emps.find((e) => e.id === r.employeeId)?.last_name} />)}
      </>}
    </>
  );
}
