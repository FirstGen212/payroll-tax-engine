import { useEffect, useMemo, useState } from 'react';
import { api, pct } from '../api';
import { Badge, StateSelect } from '../components';

function calcSummary(c: any): string {
  if (!c) return '';
  switch (c.kind) {
    case 'percent': return `${pct(c.rate)}${c.wageBase ? ` to ${c.wageBase === 'SS' ? 'SS wage base' : '$' + Number(c.wageBase).toLocaleString()}` : ''}${c.threshold ? ` over $${c.threshold.toLocaleString()}` : ''}`;
    case 'fixed': return `$${c.amount} per ${c.per}`;
    case 'state_formula': { const b = c.formula.brackets; const first = b.single ?? b.all ?? Object.values(b)[0]; return `${first.length} bracket(s), ${pct(first[0].rate, 2)}-${pct(first[first.length - 1].rate, 2)}${c.formula.form ? `; form ${c.formula.form}` : ''}`; }
    case 'elected_percent': return `Employee elects ${c.allowed.map((x: number) => (x * 100).toFixed(1)).join('/')}%`;
    case 'federal_withholding': return 'Pub 15-T percentage method';
    case 'custom': return `Custom formula: ${c.handler}`;
    case 'none': return c.reason ?? 'No tax';
  }
  return c.kind;
}

export default function Research() {
  const [cov, setCov] = useState<any>();
  const [state, setState] = useState('NY');
  const [date, setDate] = useState('2027-01-01');
  const [rules, setRules] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  useEffect(() => { api('/coverage').then(setCov); }, []);
  useEffect(() => {
    api(`/jurisdictions?state=${state}`).then(async (js) => {
      const all = await Promise.all(js.map((j: any) => api(`/rules?jurisdiction=${encodeURIComponent(j.code)}&date=${date}${status ? `&status=${status}` : ''}`)));
      setRules(all.flat());
    });
  }, [state, date, status]);
  const perState = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of cov?.byState ?? []) {
      m[r.state] ??= { jurisdictions: 0, rules: 0, verified: 0, unverified: 0, projected: 0, placeholder: 0 };
      for (const k of ['jurisdictions', 'rules', 'verified', 'unverified', 'projected', 'placeholder']) m[r.state][k] += Number(r[k]);
    }
    return m;
  }, [cov]);
  return (
    <>
      <h2>Tax research database</h2>
      {cov && <div className="kpis">{['published', 'draft', 'projected', 'unverified', 'placeholder'].map((s) => <div key={s} className="kpi"><div className="l"><Badge s={s} /></div><div className="v">{cov.totals[s] ?? 0}</div></div>)}</div>}
      <div className="panel">
        <p className="muted small">Status meanings: <b>published</b> matches a final agency document; <b>draft</b> matches an agency draft (IRS draft Pub 15-T 2027); <b>projected</b> is carried forward or estimated because the agency has not published the year; <b>unverified</b> was entered from research and must be checked against the cited agency source before live payroll; <b>placeholder</b> is structure only.</p>
        <details><summary>Coverage by state / territory</summary>
          <table><thead><tr><th>State</th><th className="num">Jurisdictions</th><th className="num">Rules</th><th className="num">Published/draft</th><th className="num">Unverified</th><th className="num">Projected</th><th className="num">Placeholder</th></tr></thead>
            <tbody>{Object.entries(perState).map(([s, v]: any) => <tr key={s}><td><a href="#" onClick={(e) => { e.preventDefault(); setState(s); }}>{s}</a></td><td className="num">{v.jurisdictions}</td><td className="num">{v.rules}</td><td className="num">{v.verified}</td><td className="num">{v.unverified}</td><td className="num">{v.projected}</td><td className="num">{v.placeholder}</td></tr>)}</tbody></table>
        </details>
      </div>
      <div className="panel">
        <div className="row">
          <label>State / territory<StateSelect value={state} onChange={setState} /></label>
          <label>Effective on<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['published', 'draft', 'projected', 'unverified', 'placeholder'].map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Jurisdiction</th><th>Tax</th><th>Payer</th><th>Calculation</th><th>Effective</th><th>Status</th><th>Sources / notes</th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id}>
              <td>{r.jurisdiction}</td><td>{r.name}<div className="muted small">{r.kind}</div></td><td>{r.payer === 'employee' ? 'EE' : 'ER'}</td>
              <td>{calcSummary(r.calc)}{r.nonresident_calc && r.nonresident_calc.rate !== r.calc.rate ? <div className="muted small">Nonresident: {calcSummary(r.nonresident_calc)}</div> : null}</td>
              <td className="small">{String(r.effective_from).slice(0, 10)}{r.effective_to ? ` to ${String(r.effective_to).slice(0, 10)}` : ''}</td>
              <td><Badge s={r.status} /></td>
              <td className="small">{r.sources.join(', ')}<div className="muted">{r.notes}</div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  );
}
