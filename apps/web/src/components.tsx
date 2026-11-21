import { useEffect, useState } from 'react';
import { api, money, pct } from './api';

import type { ReactNode } from 'react';

export const Badge = ({ s }: { s: string }) => <span className={`badge b-${s}`}>{s}</span>;

/** Page header block (docs/DESIGN.md §6): eyebrow, title, a takeaway sentence with bold numbers, optional actions. */
export function PageHead({ eyebrow, title, children, actions }: { eyebrow: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="fg-head">
      <p className="fg-eyebrow">{eyebrow}</p>
      <h1 className="fg-title">{title}</h1>
      {children && <p className="fg-takeaway">{children}</p>}
      {actions && <div className="fg-head-actions">{actions}</div>}
    </div>
  );
}

/** Stat tile; the first tile in a .kpis row is drawn as the navy hero. */
export const Tile = ({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) => (
  <div className="kpi"><div className="l">{label}</div><div className="v">{value ?? '—'}</div>{sub && <div className="s">{sub}</div>}</div>
);

let refCache: any;
export function useReference() {
  const [ref, setRef] = useState<any>(refCache);
  useEffect(() => { if (!refCache) api('/reference').then((r) => { refCache = r; setRef(r); }); }, []);
  return ref;
}

/** Searchable multi-select of local jurisdictions within a state. */
export function LocalPicker({ state, value, onChange }: { state: string; value: string[]; onChange: (v: string[]) => void }) {
  const [opts, setOpts] = useState<any[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => { if (state) api(`/jurisdictions?state=${state}`).then((r) => setOpts(r.filter((j: any) => !['state', 'district', 'territory', 'federal'].includes(j.type)))); }, [state]);
  const shown = opts.filter((o) => !value.includes(o.code) && (o.name.toLowerCase().includes(q.toLowerCase()) || o.code.toLowerCase().includes(q.toLowerCase()))).slice(0, 8);
  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 4 }}>
        {value.map((c) => <span key={c} className="badge b-projected">{c} <a href="#" onClick={(e) => { e.preventDefault(); onChange(value.filter((x) => x !== c)); }}>x</a></span>)}
      </div>
      {opts.length > 0 && <input placeholder={`Add ${state} local (city, county, PSD, school district)...`} value={q} onChange={(e) => setQ(e.target.value)} />}
      {q && shown.map((o) => <div key={o.code} className="small"><a href="#" onClick={(e) => { e.preventDefault(); onChange([...value, o.code]); setQ(''); }}>{o.name}</a> <span className="muted">{o.code} - {o.type}</span></div>)}
    </div>
  );
}

export function StateSelect({ value, onChange, allowEmpty }: { value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  const ref = useReference();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">-</option>}
      {(ref?.states ?? []).map((s: any) => <option key={s.code} value={s.code}>{s.code} - {s.name}</option>)}
    </select>
  );
}

/** One paycheck result: earnings, taxes with status, deductions, net, audit trail. */
export function PayStub({ r, title }: { r: any; title?: string }) {
  return (
    <div className="panel">
      {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
      <div className="kpis">
        <div className="kpi"><div className="l">Gross pay</div><div className="v">{money(r.grossPay)}</div></div>
        <div className="kpi"><div className="l">Employee taxes</div><div className="v">{money(r.employeeTaxes)}</div></div>
        <div className="kpi"><div className="l">Deductions</div><div className="v">{money(r.deductions.filter((d: any) => !d.employerPaid).reduce((a: number, d: any) => a + d.amount, 0))}</div></div>
        <div className="kpi"><div className="l">Net pay</div><div className="v">{money(r.netPay)}</div></div>
        <div className="kpi"><div className="l">Employer taxes</div><div className="v">{money(r.employerTaxes)}</div></div>
        <div className="kpi"><div className="l">Total employer cost</div><div className="v">{money(r.employerCost)}</div></div>
      </div>
      {r.warnings.map((w: string, i: number) => <div key={i} className="warn">{w}</div>)}
      <div className="grid2">
        <div>
          <h3>Earnings</h3>
          <table><tbody>{r.earnings.map((e: any, i: number) => <tr key={i}><td>{e.name}{!e.cash && <span className="muted small"> (non-cash)</span>}{e.supplemental && <span className="muted small"> supplemental</span>}</td><td className="num">{money(e.amount)}</td></tr>)}</tbody></table>
          <h3>Deductions</h3>
          <table><tbody>{r.deductions.map((d: any, i: number) => <tr key={i}><td>{d.name} <span className="muted small">{d.employerPaid ? 'employer' : d.preTax ? 'pre-tax' : 'after-tax'}</span>{d.notes?.length ? <div className="muted small">{d.notes.join('; ')}</div> : null}</td><td className="num">{money(d.amount)}</td></tr>)}</tbody></table>
        </div>
        <div>
          <h3>Taxes</h3>
          <table>
            <thead><tr><th>Tax</th><th>Payer</th><th className="num">Taxable</th><th className="num">Amount</th><th>Data</th></tr></thead>
            <tbody>
              {r.taxes.map((t: any, i: number) => (
                <tr key={i}>
                  <td>{t.name}<div className="muted small">{t.jurisdiction} {t.kind}{t.rate ? ` - ${pct(t.rate)}` : ''}</div>
                    <details><summary>how</summary><pre className="audit">{t.explanation.join('\n')}{'\nRule: ' + t.ruleId + '\nSources: ' + t.sources.join(', ')}</pre></details></td>
                  <td>{t.payer === 'employee' ? 'EE' : 'ER'}</td>
                  <td className="num">{money(t.taxableWages)}</td>
                  <td className="num">{money(t.amount)}</td>
                  <td><Badge s={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <details><summary>Full audit trail</summary><pre className="audit">{r.audit.map((a: any) => `[${a.step}] ${a.detail}`).join('\n')}</pre></details>
    </div>
  );
}
