import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, money } from '../api';
import { PageHead, PayStub } from '../components';

export default function PayRunView() {
  const { runId } = useParams();
  const [run, setRun] = useState<any>();
  useEffect(() => { api(`/payruns/${runId}`).then(setRun); }, [runId]);
  if (!run) return null;
  const t = run.totals;
  const csv = () => {
    const keys = [...new Set(run.statements.flatMap((s: any) => s.result.taxes.map((x: any) => `${x.jurisdiction}.${x.kind}`)))] as string[];
    const rows = [['Employee', 'Gross', ...keys, 'Net'].join(','), ...run.statements.map((s: any) => [`${s.last_name} ${s.first_name}`, s.gross, ...keys.map((k) => s.result.taxes.filter((x: any) => `${x.jurisdiction}.${x.kind}` === k).reduce((a: number, x: any) => a + x.amount, 0)), s.net].join(','))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })); a.download = `payrun-${String(run.check_date).slice(0, 10)}.csv`; a.click();
  };
  return (
    <>
      <PageHead eyebrow={<><Link to={`/clients/${run.client_id}`}>Client</Link> / Pay run</>} title={`Pay run ${String(run.check_date).slice(0, 10)}`}>
        A <b>{run.run_type}</b> run for <b>{t.employees}</b> employees, calculated like <b>{run.vendor_profile_id ?? 'IRS by the book'}</b>: gross <b>{money(t.gross)}</b>, employer cost <b>{money(t.employerCost)}</b>.
      </PageHead>
      <div className="kpis">{[['Employees', t.employees], ['Gross', money(t.gross)], ['Employee taxes', money(t.employeeTaxes)], ['Net', money(t.net)], ['Employer taxes', money(t.employerTaxes)], ['Employer cost', money(t.employerCost)]].map(([l, v]) => <div key={l} className="kpi"><div className="l">{l}</div><div className="v">{v}</div></div>)}</div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>Tax liability summary</h3><button className="small" onClick={csv}>Download register CSV</button></div>
        <table><thead><tr><th>Tax</th><th>Payer</th><th className="num">Taxable wages</th><th className="num">Amount</th></tr></thead>
          <tbody>{Object.entries(t.byTax).sort(([a]: any, [b]: any) => (a.startsWith('US.') ? 0 : 1) - (b.startsWith('US.') ? 0 : 1) || a.localeCompare(b)).map(([k, v]: any) => <tr key={k}><td>{v.name}<div className="muted small">{k}</div></td><td>{v.payer === 'employee' ? 'EE' : 'ER'}</td><td className="num">{money(v.wages)}</td><td className="num">{money(v.amount)}</td></tr>)}</tbody></table>
      </div>
      {run.statements.map((s: any) => <PayStub key={s.id} r={s.result} title={`${s.first_name} ${s.last_name}`} />)}
    </>
  );
}
