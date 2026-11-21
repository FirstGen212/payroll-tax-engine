import { useEffect, useMemo, useState } from 'react';
import { api, pct } from '../api';
import { Badge, PageHead, StateSelect, useReference } from '../components';

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
  const ref = useReference();
  useEffect(() => { api('/coverage').then(setCov); }, []);
  useEffect(() => {
    // One request for the whole state; a slower earlier answer never replaces a newer one.
    let current = true;
    api(`/rules?state=${encodeURIComponent(state)}&date=${date}${status ? `&status=${status}` : ''}`).then((rows) => { if (current) setRules(rows); }).catch(() => { if (current) setRules([]); });
    return () => { current = false; };
  }, [state, date, status]);
  const perState = useMemo(() => {
    const m: Record<string, any> = {};
    for (const r of cov?.byState ?? []) {
      m[r.state] ??= { jurisdictions: 0, rules: 0, verified: 0, confirmed: 0, unverified: 0, projected: 0, placeholder: 0 };
      for (const k of ['jurisdictions', 'rules', 'verified', 'confirmed', 'unverified', 'projected', 'placeholder']) m[r.state][k] += Number(r[k]);
    }
    return m;
  }, [cov]);
  return (
    <>
      <PageHead eyebrow="Tax database" title="Rules by state and status">
        {cov ? <><b>{Object.values(cov.totals).reduce((a: number, n: any) => a + Number(n), 0)}</b> tax rules, of which <b>{(cov.totals.published ?? 0) + (cov.totals.draft ?? 0)}</b> match an agency publication or draft, <b>{cov.totals.confirmed ?? 0}</b> match a recognized compilation and <b>{cov.totals.unverified ?? 0}</b> still need checking against a source.</> : 'Loading coverage…'}
      </PageHead>
      {cov && <div className="kpis">{['published', 'confirmed', 'draft', 'projected', 'unverified', 'placeholder'].map((s) => <div key={s} className="kpi"><div className="l"><Badge s={s} /></div><div className="v">{cov.totals[s] ?? 0}</div></div>)}</div>}
      <div className="panel">
        <p className="muted small">Status meanings: <b>published</b> matches a final agency document that was read directly; <b>confirmed</b> matches a recognized compilation that cites the agency (the federal payroll center's state bulletins, EY, Mercer), but the agency document itself was not read; <b>draft</b> matches an agency draft (IRS draft Pub 15-T 2027); <b>projected</b> is carried forward or estimated because the agency has not published the year; <b>unverified</b> was entered from research and must be checked against the cited agency source before live payroll; <b>placeholder</b> is structure only.</p>
        <details><summary>Coverage by state / territory</summary>
          <table><thead><tr><th>State</th><th className="num">Jurisdictions</th><th className="num">Rules</th><th className="num">Published/draft</th><th className="num">Confirmed</th><th className="num">Unverified</th><th className="num">Projected</th><th className="num">Placeholder</th></tr></thead>
            <tbody>{Object.entries(perState).map(([s, v]: any) => <tr key={s}><td><a href="#" onClick={(e) => { e.preventDefault(); setState(s); }}>{s}</a></td><td className="num">{v.jurisdictions}</td><td className="num">{v.rules}</td><td className="num">{v.verified}</td><td className="num">{v.confirmed}</td><td className="num">{v.unverified}</td><td className="num">{v.projected}</td><td className="num">{v.placeholder}</td></tr>)}</tbody></table>
        </details>
      </div>
      <div className="panel">
        <div className="row">
          <label>State / territory<StateSelect value={state} onChange={setState} /></label>
          <label>Effective on<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['published', 'confirmed', 'draft', 'projected', 'unverified', 'placeholder'].map((s) => <option key={s}>{s}</option>)}</select></label>
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
      <Section125Panel state={state} data={ref?.section125} sources={ref?.sources} />
    </>
  );
}

const BENEFIT_WORDS: Record<string, string> = { health: 'health premiums', fsa: 'FSAs', dependent_care: 'dependent care', hsa: 'HSAs' };
const BASIS_WORDS: Record<string, string> = { SIT: 'State income tax', LOCAL: 'Local tax', SDI: 'Disability and leave', SUI: 'Unemployment' };

/** Section 125 treatment for the selected state and its cities, from the audit table in tax-data. */
function Section125Panel({ state, data, sources }: { state: string; data?: { rules: any[]; open: string[] }; sources?: any[] }) {
  if (!data) return null;
  const rows = data.rules.filter((r) => r.jurisdiction === state || r.jurisdiction.startsWith(`${state}-`));
  const src = new Map((sources ?? []).map((s: any) => [s.id, s]));
  const taxed = data.rules.filter((r) => !r.reduces && r.status !== 'unverified');
  return (
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Section 125 and state and local taxes</h3>
      <p className="small">A pre-tax Section 125 deduction always lowers federal income tax, Social Security, Medicare and FUTA wages. Whether it also lowers state and local taxes depends on the place. Taxes that keep it in wages: <b>{[...new Set(taxed.map((r) => r.tax))].join('; ')}</b>.</p>
      {rows.length === 0 ? <p className="muted small">No Section 125 row for {state}: it has no wage-based income tax, so only federal taxes and any state programs are affected.</p> : (
        <table>
          <thead><tr><th>Tax</th><th>Covers</th><th>Section 125 lowers wages?</th><th>Status</th><th>Source and what it says</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td>{r.tax}<div className="muted small">{BASIS_WORDS[r.basis] ?? r.basis}</div></td>
              <td className="small">{(r.benefits ?? Object.keys(BENEFIT_WORDS)).map((b: string) => BENEFIT_WORDS[b]).join(', ')}</td>
              <td><span className={`fg-pill ${r.reduces ? 'fg-ok' : 'fg-warn'}`}>{r.reduces ? 'Yes' : 'No, stays taxable'}</span></td>
              <td><Badge s={r.status} /></td>
              <td className="small">{r.sources.map((id: string) => { const s: any = src.get(id); return s ? <div key={id}><a href={s.url} target="_blank" rel="noreferrer">{s.agency}: {s.title}</a></div> : <div key={id}>{id}</div>; })}<div className="muted">{r.notes}</div></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <details><summary>Still open ({data.open.length})</summary><ul className="small">{data.open.map((o, i) => <li key={i}>{o}</li>)}</ul></details>
    </div>
  );
}
