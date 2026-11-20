import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, money } from '../api';
import { LogoOrName } from '../auth';

const whole = (n?: number) => (n === undefined || n === null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
const COLS: Record<string, [string, (e: any) => string, boolean?]> = {
  state: ['State', (e) => e.state ?? ''],
  plan: ['Plan', (e) => e.plan],
  deduction: ['Pre-tax deduction per check', (e) => money(e.deductionPerCheck), true],
  employeeSavings: ['Employee savings per month', (e) => money(e.employeeMonthlySavings), true],
  employerSavings: ['Employer savings per year', (e) => money(e.employerAnnualSavings), true],
};

/** The client-facing proposal page (docs/DESIGN.md). Used for the public link and for the preview inside the builder. */
export function ReportView({ r, preview }: { r: any; preview?: boolean }) {
  const updated = new Date(r.generatedAt).toLocaleString();
  return (
    <div className={`fg-report ${preview ? 'preview' : ''}`}>
      {!preview && <div className="fg-rule" aria-hidden="true"><span /><span /><span /><span /></div>}
      <header className="fg-report-top">
        <LogoOrName small presenter={r.presentedBy} />
        <div className="row noprint" style={{ alignItems: 'center' }}>
          <button onClick={() => window.print()}>Download PDF</button>
          <a className="fg-btn fg-btn-primary" href="#get-started" style={{ textDecoration: 'none' }}>Get started</a>
        </div>
      </header>

      <div className="fg-head" id="overview">
        <p className="fg-eyebrow">Presented by {r.presentedBy} · {r.subtitle}</p>
        <h1 className="fg-title">{r.title}</h1>
        <p className="fg-takeaway">
          <b>{r.eligible}</b> of {r.company}'s <b>{r.employeesReviewed}</b> employees qualify. Together they save the company about <b>{whole(r.employerAnnualSavings)}</b> a year in payroll taxes{r.showValuation && r.ebitdaMultiple ? <>, worth about <b>{whole(r.valuationIncrease)}</b> in business value</> : null}.
        </p>
        {r.intro && <p className="fg-takeaway" style={{ marginTop: 12 }}>{r.intro}</p>}
      </div>

      <div className="kpis">
        <div className="kpi"><div className="l">Employer annual savings</div><div className="v">{whole(r.employerAnnualSavings)}</div><div className="s"><b>{money(r.perPeriodSavings)}</b> every {r.payFrequency.label.toLowerCase()} pay period</div></div>
        {r.showValuation && <div className="kpi"><div className="l">Valuation increase</div><div className="v">{whole(r.valuationIncrease)}</div><div className="s">at a <b>{r.ebitdaMultiple}x</b> EBITDA multiple</div></div>}
        <div className="kpi"><div className="l">Eligible employees</div><div className="v">{r.eligible}</div><div className="s">of <b>{r.employeesReviewed}</b> reviewed{r.eligiblePartTime ? <>, {r.eligiblePartTime} on the part-time plan</> : null}</div></div>
        <div className="kpi"><div className="l">Pay frequency</div><div className="v">{r.payFrequency.label}</div><div className="s"><b>{r.payFrequency.periodsPerYear}</b> pay periods per year</div></div>
      </div>
      <p className="fg-note">{r.company} · Last updated {updated}{r.sourceFile ? <> · Source: {r.sourceFile}</> : null}{r.participationRate < 1 ? <> · Assumes {Math.round(r.participationRate * 100)}% of eligible employees enroll</> : null}</p>

      <section className="fg-report-section">
        <h2>Implementation</h2>
        <div className="fg-cards fg-steps">
          {r.steps.map((s: any, i: number) => (
            <div key={i} className="fg-card"><div className="fg-step-n">{i + 1}</div><h3>{s.title}</h3><p className="fg-note" style={{ margin: 0 }}>{s.text}</p></div>
          ))}
        </div>
      </section>

      {r.showEmployees !== 'none' && (
        <section className="fg-report-section">
          <h2>Employee eligibility</h2>
          <div className="fg-card">
            <h3>{r.eligible} eligible employees</h3>
            <p className="fg-note">{r.eligibleFull} on the full plan{r.eligiblePartTime ? ` and ${r.eligiblePartTime} on the part-time plan` : ''}. Each pays for a {r.benefitPackage ?? 'preventative care'} benefit with a pre-tax deduction, so both their taxes and the company's go down.</p>
            {r.showEmployees === 'list' && r.employees.length > 0 ? (
              <div className="fg-tablebox tall"><table>
                <thead><tr><th>Employee</th>{r.employeeColumns.map((c: string) => <th key={c} className={COLS[c]?.[2] ? 'num' : ''}>{COLS[c]?.[0]}</th>)}</tr></thead>
                <tbody>{r.employees.map((e: any, i: number) => <tr key={i}><td><b>{e.name}</b></td>{r.employeeColumns.map((c: string) => <td key={c} className={COLS[c]?.[2] ? 'num' : ''}>{COLS[c]?.[1](e)}</td>)}</tr>)}
                  {r.employeeColumns.includes('employerSavings') && <tr className="fg-all"><td>Total</td>{r.employeeColumns.map((c: string) => <td key={c} className="num">{c === 'employerSavings' ? money(r.employees.reduce((a: number, e: any) => a + e.employerAnnualSavings, 0)) : ''}</td>)}</tr>}
                </tbody>
              </table></div>
            ) : (
              <div className="fg-tablebox"><table><tbody>{Object.entries(r.byStatus as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{v}</td></tr>)}</tbody></table></div>
            )}
          </div>
        </section>
      )}

      {r.companies?.length > 0 && (
        <section className="fg-report-section">
          <h2>By company</h2>
          <div className="fg-card"><div className="fg-tablebox"><table>
            <thead><tr><th>Company</th><th className="num">Employees</th><th className="num">Eligible</th><th className="num">Employer savings per year</th></tr></thead>
            <tbody>{r.companies.map((c: any) => <tr key={c.company}><td><b>{c.company}</b></td><td className="num">{c.employees}</td><td className="num">{c.eligible}</td><td className="num">{money(c.employerAnnualSavings)}</td></tr>)}</tbody>
          </table></div></div>
        </section>
      )}

      <section className="fg-report-section fg-cards">
        <div className="fg-card">
          <h3>Total employer annual savings</h3>
          <div className="fg-num">{whole(r.employerAnnualSavings)}</div>
          <p className="fg-note" style={{ marginBottom: 0 }}>The total annual payroll tax savings across all eligible employees for {r.company}, equal to <b>{money(r.perPeriodSavings)}</b> every {r.payFrequency.label.toLowerCase()} pay period.</p>
        </div>
        {r.showValuation && (
          <div className="fg-card">
            <h3>Valuation impact</h3>
            <div className="fg-num">{whole(r.valuationIncrease)}</div>
            <p className="fg-note" style={{ marginBottom: 0 }}>Based on a <b>{r.ebitdaMultiple}x</b> EBITDA multiple, this is the potential increase in business value from the added annual earnings.</p>
          </div>
        )}
      </section>

      <section className="fg-report-section" id="get-started">
        <div className="kpis" style={{ gridTemplateColumns: '1fr' }}>
          <div className="kpi fg-cta">
            <h2 style={{ margin: 0 }}>{r.ctaHeading}</h2>
            <p className="s" style={{ fontSize: '1.0625rem', margin: '8px 0 16px' }}>{r.ctaText}</p>
            {r.ctaUrl ? <a className="fg-btn fg-cta-btn" href={r.ctaUrl} target="_blank" rel="noreferrer">{r.ctaLabel}</a> : <a className="fg-btn fg-cta-btn" href={`mailto:${r.contactEmail}?subject=${encodeURIComponent(`${r.company}: next steps`)}`}>{r.ctaLabel}</a>}
          </div>
        </div>
      </section>

      <section className="fg-report-section">
        <h3>Disclaimer</h3>
        <p className="fg-note">{r.disclaimer}</p>
      </section>

      <footer className="fg-report-foot">
        <div><b>{r.presentedBy}</b><div className="muted small">{r.address}</div></div>
        <div className="small"><a href={`mailto:${r.contactEmail}`}>{r.contactEmail}</a><div className="muted">Prepared for {r.company} · © {new Date(r.generatedAt).getFullYear()} {r.presentedBy}</div></div>
      </footer>
    </div>
  );
}

/** Public link: /r/:slug (no sign-in). */
export default function PublicReport() {
  const { slug } = useParams();
  const [r, setR] = useState<any>();
  const [err, setErr] = useState('');
  useEffect(() => { api(`/public/reports/${slug}`).then((x) => { setR(x); document.title = x.title; }).catch((e) => setErr(e.message)); }, [slug]);
  if (err) return <div className="fg-login"><div className="fg-login-card"><LogoOrName presenter="First Gen Financial" /><h1>Link not available</h1><p className="muted">{err}</p></div></div>;
  if (!r) return <div className="fg-login"><span className="muted">Loading…</span></div>;
  return <ReportView r={r} />;
}
