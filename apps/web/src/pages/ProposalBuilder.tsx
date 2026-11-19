import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, money } from '../api';
import { StateSelect, useReference } from '../components';

const FIELD_LABELS: Record<string, string> = {
  company: 'Company', employeeId: 'Employee ID', firstName: 'First name', lastName: 'Last name', workState: 'Work state', residenceState: 'Residence state',
  municipality: 'Municipality / local', grossPay: 'Gross pay per period', otherComp: 'Commission / bonus / other', payFrequency: 'Pay frequency', periodsPerYear: 'Pay periods per year',
  employmentType: 'Salary or hourly', hoursPerPeriod: 'Hours per pay period', hourlyRate: 'Hourly rate', federalFilingStatus: 'Federal W-4 filing status',
  dependentAllowances: 'Dependent allowances (pre-2020 W-4)', dependentCredits: 'Dependent credits (W-4 Step 3, $/yr)', additionalFit: 'Additional federal withholding',
  federalTaxPaid: 'Federal tax withheld today? (yes/no)', stateTaxPaid: 'State tax withheld today? (yes/no)', stateFilingStatus: 'State filing status', stateDependents: 'State dependents / allowances',
  additionalSit: 'Additional state withholding', healthMonthly: 'Health contribution / month (pre-tax)', otherPretaxMonthly: 'Other pre-tax / month', retirementMonthly: '401(k) / IRA $ / month',
  retirementPercent: '401(k) % of pay', postTaxMonthly: 'Post-tax deductions / month', proposedDeduction: 'Proposed deduction per employee', tips: 'Tips', pto: 'PTO',
  reimbursements: 'Reimbursements', confidence: 'Data confidence', birthDate: 'Birth date',
};
const REQUIRED = ['grossPay', 'payFrequency', 'workState', 'federalFilingStatus'];

const ELIG_CLASS = (e: string) => (e === 'Eligible' ? 'b-published' : e === 'NEEDS REVIEW' || e === 'No Federal Taxes Paid' ? 'b-unverified' : 'b-placeholder');
const n2 = (v: any) => (v === '' || v === null || v === undefined ? undefined : Number(v));

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export default function ProposalBuilder() {
  const { id } = useParams();
  const nav = useNavigate();
  const ref = useReference();
  const [defaults, setDefaults] = useState<any>();
  const [clients, setClients] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>({ name: '', clientId: '', status: 'draft' });
  const [file, setFile] = useState<{ fileName: string; sheets: any[] }>();
  const [sheetName, setSheetName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<any>();
  const [result, setResult] = useState<any>();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [view, setView] = useState<'results' | 'employees' | 'proposal'>('results');

  useEffect(() => {
    api('/proposals/defaults').then((d) => { setDefaults(d); if (!id) setSettings(structuredClone(d.settings)); });
    api('/clients').then(setClients).catch(() => {});
    if (id) api(`/proposals/${id}`).then((p) => {
      setMeta({ name: p.name, clientId: p.client_id ?? '', status: p.status, company: p.company });
      setHeaders(p.headers); setRows(p.raw_rows); setMapping(p.mapping); setSettings(p.settings); setSheetName(p.sheet_name ?? '');
      setFile({ fileName: p.file_name, sheets: [] });
      setResult({ settings: p.settings, employees: p.results, summary: p.summary, unmatchedMunicipalities: p.summary?.unmatchedMunicipalities ?? [] });
    }).catch((e) => setErr(e.message));
  }, [id]);

  const chooseSheet = (f: { sheets: any[]; fileName?: string }, name: string) => {
    const s = f.sheets.find((x) => x.name === name);
    if (!s) return;
    setSheetName(name); setHeaders(s.headers); setRows(s.rows); setMapping(s.mapping); setResult(undefined);
    const company = s.mapping.company ? s.rows.find((r: any) => r[s.mapping.company])?.[s.mapping.company] : undefined;
    setMeta((m: any) => ({ ...m, company, name: m.name || (company ? `${company} proposal` : f.fileName?.replace(/\.[^.]+$/, '')) }));
  };

  const upload = async (f?: File) => {
    if (!f) return;
    setErr(''); setBusy('Reading file…');
    try {
      const parsed = await api('/proposals/parse', { json: { fileName: f.name, base64: await toBase64(f) } });
      setFile(parsed);
      chooseSheet(parsed, parsed.suggestedSheet);
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const body = () => ({ headers, rows, mapping, settings, name: meta.name || 'Proposal', clientId: meta.clientId || null, company: meta.company ?? null, fileName: file?.fileName ?? null, sheetName, status: meta.status });
  const calculate = async () => {
    setErr(''); setBusy(`Calculating ${rows.length} employees for a full year of checks, before and after…`);
    try { setResult(await api('/proposals/calculate', { json: body() })); setView('results'); } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const save = async () => {
    setErr(''); setBusy('Saving…');
    try {
      const r = await api(id ? `/proposals/${id}` : '/proposals', { method: id ? 'PUT' : 'POST', json: body() });
      setResult(r.result);
      if (!id) nav(`/proposals/${r.id}`, { replace: true });
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const download = async () => {
    setBusy('Building workbook…');
    try {
      const res = await fetch('/api/proposals/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) });
      if (!res.ok) throw new Error((await res.json()).error);
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement('a'), { href: url, download: `${meta.name || 'Proposal'} - Underwriting.xlsx` }).click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const pickClient = (cid: string) => {
    const c = clients.find((x) => x.id === cid);
    setMeta({ ...meta, clientId: cid, name: meta.name || (c ? `${c.name} proposal` : '') });
    if (c) setSettings({ ...settings, employer: { ...settings.employer, name: c.name, homeState: c.home_state ?? undefined, futaExempt: c.futa_exempt }, vendorProfileId: c.current_vendor ?? settings.vendorProfileId });
  };

  const setS = (p: any) => setSettings({ ...settings, ...p });
  const setTier = (i: number, p: any) => setS({ tiers: settings.tiers.map((t: any, j: number) => (i === j ? { ...t, ...p } : t)) });
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const missing = REQUIRED.filter((f) => !mapping[f]);

  if (!defaults || !settings) return <p className="muted">Loading…</p>;
  return (
    <>
      <h2>{id ? meta.name : 'New proposal'}</h2>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>1. Data</h3>
        <div className="row">
          <label>Census, underwriting sheet or payroll sample (.xlsx or .csv)
            <input type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {file?.sheets?.length ? (
            <label>Sheet<select value={sheetName} onChange={(e) => chooseSheet(file, e.target.value)}>{file.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rows.length} rows)</option>)}</select></label>
          ) : file ? <span className="muted small">{file.fileName}{sheetName ? `, sheet ${sheetName}` : ''}</span> : null}
          <label style={{ minWidth: 260 }}>Proposal name<input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></label>
          <label>Client (optional)<select value={meta.clientId} onChange={(e) => pickClient(e.target.value)}><option value="">Prospect (not a client yet)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Status<select value={meta.status} onChange={(e) => setMeta({ ...meta, status: e.target.value })}>{['draft', 'sent', 'won', 'lost'].map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
        {rows.length > 0 && (
          <p className="small" style={{ marginBottom: 0 }}>
            {rows.length} rows · {mappedCount} columns mapped{missing.length ? <span className="err" style={{ marginLeft: 8, padding: '2px 8px' }}>Map these before calculating: {missing.map((m) => FIELD_LABELS[m]).join(', ')}</span> : null}
            {' '}<button className="small" onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide column mapping' : 'Review column mapping'}</button>
          </p>
        )}
        {showMap && rows.length > 0 && (
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Field</th><th>Column in your file</th><th>First rows</th></tr></thead>
            <tbody>{defaults.fields.map((f: string) => (
              <tr key={f}>
                <td>{FIELD_LABELS[f] ?? f}{REQUIRED.includes(f) && <span className="muted"> *</span>}</td>
                <td><select value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}><option value="">(not in file)</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></td>
                <td className="muted small">{mapping[f] ? rows.slice(0, 3).map((r) => String(r[mapping[f]] ?? '')).join(' · ') : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>2. Plan and pricing tiers</h3>
        <p className="muted small" style={{ marginTop: 0 }}>Each employee gets the highest tier whose hours minimum they meet. The deduction is pre-tax (Section 125). The benefit payment returns part of it to the employee each check, tax-free. Fees are your pricing: the employer fee comes out of the employer's savings, and the employee fee comes out of take-home pay.</p>
        <table>
          <thead><tr><th>Tier</th><th>Min hours / week</th><th>Min annual gross</th><th>Pre-tax deduction</th><th>Per</th><th>Benefit payment back %</th><th>Employer fee / employee / month</th><th>Employee fee / month</th><th /></tr></thead>
          <tbody>{settings.tiers.map((t: any, i: number) => (
            <tr key={t.id}>
              <td><input value={t.name} onChange={(e) => setTier(i, { name: e.target.value })} /></td>
              <td><input style={{ width: 80 }} type="number" value={t.minHoursPerWeek} onChange={(e) => setTier(i, { minHoursPerWeek: Number(e.target.value) })} /></td>
              <td><input style={{ width: 100 }} type="number" value={t.minAnnualGross ?? ''} onChange={(e) => setTier(i, { minAnnualGross: n2(e.target.value) })} /></td>
              <td><input style={{ width: 100 }} type="number" step="0.01" value={t.deductionAmount} onChange={(e) => setTier(i, { deductionAmount: Number(e.target.value) })} /></td>
              <td><select value={t.deductionPer} onChange={(e) => setTier(i, { deductionPer: e.target.value })}><option value="check">check</option><option value="month">month</option></select></td>
              <td><input style={{ width: 70 }} type="number" value={Math.round(t.benefitOffsetPercent * 1000) / 10} onChange={(e) => setTier(i, { benefitOffsetPercent: Number(e.target.value) / 100 })} /></td>
              <td><input style={{ width: 90 }} type="number" step="0.01" value={t.employerFeeMonthly} onChange={(e) => setTier(i, { employerFeeMonthly: Number(e.target.value) })} /></td>
              <td><input style={{ width: 90 }} type="number" step="0.01" value={t.employeeFeeMonthly} onChange={(e) => setTier(i, { employeeFeeMonthly: Number(e.target.value) })} /></td>
              <td><button className="small" onClick={() => setS({ tiers: settings.tiers.filter((_: any, j: number) => j !== i) })}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="small" onClick={() => setS({ tiers: [...settings.tiers, { id: `t${Date.now()}`, name: 'New tier', minHoursPerWeek: 0, deductionAmount: 0, deductionPer: 'check', benefitOffsetPercent: 1, employerFeeMonthly: 0, employeeFeeMonthly: 0 }] })}>Add tier</button>
          <label className="check"><input type="checkbox" checked={settings.useRowDeduction} onChange={(e) => setS({ useRowDeduction: e.target.checked })} />Use the file's per-employee deduction amount when present</label>
          <label>That amount is per<select value={settings.rowDeductionPer} onChange={(e) => setS({ rowDeductionPer: e.target.value })}><option value="check">check</option><option value="month">month</option></select></label>
        </div>
        <h3>Eligibility rules</h3>
        <div className="row">
          <label>Plan year<input style={{ width: 90 }} type="number" value={settings.year} onChange={(e) => setS({ year: Number(e.target.value) })} /></label>
          <label>Low income: annual gross at or below<input style={{ width: 120 }} type="number" value={settings.lowIncomeMax} onChange={(e) => setS({ lowIncomeMax: Number(e.target.value) })} /></label>
          <label>Min employee take-home increase / month<input style={{ width: 120 }} type="number" value={settings.minMonthlyEmployeeGain} onChange={(e) => setS({ minMonthlyEmployeeGain: Number(e.target.value) })} /></label>
          <label>Min employer savings / employee / month<input style={{ width: 120 }} type="number" value={settings.minMonthlyEmployerGain} onChange={(e) => setS({ minMonthlyEmployerGain: Number(e.target.value) })} /></label>
          <label>Monthly allotment %<input style={{ width: 80 }} type="number" value={Math.round(settings.allotmentPercent * 1000) / 10} onChange={(e) => setS({ allotmentPercent: Number(e.target.value) / 100 })} /></label>
          <label>Allotment of<select value={settings.allotmentBase} onChange={(e) => setS({ allotmentBase: e.target.value })}><option value="deduction">the monthly deduction</option><option value="employee_tax_savings">the employee's tax savings</option><option value="total_tax_savings">employee + employer tax savings</option></select></label>
          <label className="check"><input type="checkbox" checked={settings.dedupe !== false} onChange={(e) => setS({ dedupe: e.target.checked })} />Count repeated employees once</label>
          <label>Review if data confidence below<input style={{ width: 80 }} type="number" step="0.05" value={settings.reviewMinConfidence} onChange={(e) => setS({ reviewMinConfidence: Number(e.target.value) })} /></label>
        </div>
        <h3>Employer</h3>
        <div className="row">
          <label>Calculate like<select value={settings.vendorProfileId ?? ''} onChange={(e) => setS({ vendorProfileId: e.target.value || undefined })}><option value="">By the book (IRS)</option>{(ref?.vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
          <label>Employer home state<StateSelect allowEmpty value={settings.employer.homeState ?? ''} onChange={(v) => setS({ employer: { ...settings.employer, homeState: v || undefined } })} /></label>
          <label className="check"><input type="checkbox" checked={!!settings.employer.futaExempt} onChange={(e) => setS({ employer: { ...settings.employer, futaExempt: e.target.checked } })} />FUTA exempt (501(c)(3) or government)</label>
          <span className="muted small">SUI uses each state's new-employer rate unless the client has assigned rates.</span>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="primary" disabled={!rows.length || missing.length > 0 || !!busy} onClick={calculate}>Calculate</button>
        <button disabled={!rows.length || missing.length > 0 || !!busy} onClick={save}>{id ? 'Save changes' : 'Save proposal'}</button>
        <button disabled={!rows.length || missing.length > 0 || !!busy} onClick={download}>Download underwriting workbook</button>
        {busy && <span className="muted">{busy}</span>}
      </div>

      {result && <Results result={result} view={view} setView={setView} meta={meta} />}
    </>
  );
}

function Results({ result, view, setView, meta }: { result: any; view: string; setView: (v: any) => void; meta: any }) {
  const s = result.summary;
  const order: string[] = ['Eligible', 'No Federal Taxes Paid', 'NEEDS REVIEW', 'Not Eligible - Insufficient Savings', 'Not Eligible - Insufficient Savings + No Federal Taxes Paid', 'Not Eligible - Low Income', 'Not Eligible - Insufficient Hours', 'Not Eligible - No Gross Compensation'];
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string>();
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: 'name', d: 1 });
  const eligible = result.employees.filter((e: any) => e.eligibility === 'Eligible' && e.annual);
  const agg = (side: 'before' | 'after', k: string) => eligible.reduce((a: number, e: any) => a + (e.annual[side][k] ?? 0), 0);
  const cols: [string, string, (e: any) => any][] = [
    ['name', 'Employee', (e) => e.name], ['state', 'State', (e) => e.row.workState], ['tier', 'Tier', (e) => e.tier], ['hours', 'Hrs / wk', (e) => e.hoursPerWeek],
    ['gross', 'Annual gross', (e) => e.annualGross], ['ded', 'Deduction / check', (e) => e.deductionPerCheck],
    ['eeb', 'EE taxes / mo before', (e) => e.monthly?.employeeTaxBefore], ['eea', 'EE taxes / mo after', (e) => e.monthly?.employeeTaxAfter],
    ['gain', 'Take-home change / mo', (e) => e.monthly?.employeeNetGain], ['er', 'Employer savings / mo', (e) => e.monthly?.employerNetGain], ['allot', 'Allotment / mo', (e) => e.monthly?.allotment],
    ['elig', 'Eligibility', (e) => e.eligibility],
  ];
  const shown = useMemo(() => {
    const getter = cols.find((c) => c[0] === sort.k)![2];
    return result.employees
      .filter((e: any) => (!filter || e.eligibility === filter) && (!search || `${e.name} ${e.row.employeeId ?? ''} ${e.row.company ?? ''}`.toLowerCase().includes(search.toLowerCase())))
      .sort((a: any, b: any) => { const x = getter(a), y = getter(b); return (x === y ? 0 : x === undefined ? 1 : y === undefined ? -1 : x > y ? 1 : -1) * sort.d; });
  }, [result, filter, search, sort]);
  const csv = () => {
    const lines = [cols.map((c) => c[1]).concat(['Reason', 'Flags']).join(','), ...shown.map((e: any) => cols.map((c) => c[2](e) ?? '').concat([e.reasons.join(' '), e.flags.join(' ')]).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: `${meta.name || 'proposal'} employees.csv` }).click();
  };

  return (
    <>
      <div className="tabs noprint">
        {[['results', 'Before and after'], ['employees', `Employees (${s.employees})`], ['proposal', 'Client proposal']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
      </div>

      {view === 'results' && (
        <>
          <div className="kpis">
            {[['Employees', s.employees], ['Eligible before pricing', s.eligibleBeforePricing], ['Eligible after pricing', s.eligibleAfterPricing],
              ['Employer net savings / yr', money(s.eligible.employerNetSavings)], ['Employee take-home gain / yr', money(s.eligible.employeeNetGain)], ['Avg employee gain / mo', money(s.eligible.avgEmployeeMonthlyGain)]].map(([l, v]) => (
              <div key={l} className="kpi"><div className="l">{l}</div><div className="v">{v}</div></div>
            ))}
          </div>
          <div className="grid2">
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Eligibility</h3>
              <table><tbody>{order.filter((k) => s.byEligibility[k]).map((k) => (
                <tr key={k} style={{ cursor: 'pointer' }} onClick={() => { setFilter(k); setView('employees'); }}>
                  <td><span className={`badge ${ELIG_CLASS(k)}`}>{k}</span></td><td className="num">{s.byEligibility[k]}</td><td className="num muted">{Math.round((s.byEligibility[k] / s.employees) * 100)}%</td>
                </tr>
              ))}</tbody></table>
              <p className="muted small">Click a row to see those employees. Tiers among eligible: {Object.entries(s.byTier).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.</p>
            </div>
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Eligible employees, full year</h3>
              <table>
                <thead><tr><th /><th className="num">Before</th><th className="num">After</th><th className="num">Change</th></tr></thead>
                <tbody>{[['Gross pay', 'gross'], ['New pre-tax deduction', 'newDeduction'], ['Federal income tax', 'fit'], ['Social Security and Medicare (employee)', 'fica'], ['State and local taxes', 'stateLocal'], ['Total employee taxes', 'employeeTaxes'], ['Benefit payment back (tax-free)', 'benefitPayment'], ['Employee take-home pay', 'netPay'], ['Employer taxes', 'employerTaxes']].map(([l, k]) => {
                  const b = agg('before', k), a = agg('after', k);
                  return <tr key={k}><td>{l}</td><td className="num">{money(b)}</td><td className="num">{money(a)}</td><td className="num">{money(a - b)}</td></tr>;
                })}
                  <tr><td>Fees (employer / employee)</td><td /><td className="num">{money(s.eligible.employerFees)} / {money(s.eligible.employeeFees)}</td><td /></tr>
                </tbody>
              </table>
            </div>
          </div>
          {s.duplicates?.length > 0 && <div className="warn">{s.duplicates.length} rows repeat an employee already in the file and were counted once (for example {s.duplicates.slice(0, 3).map((d: any) => `${d.name} on row ${d.rowNumber}, first seen on row ${d.duplicateOf}`).join('; ')}). Turn this off under eligibility rules if those are different people.</div>}
          {result.unmatchedMunicipalities?.length > 0 && <div className="warn">Municipalities with no matching local tax jurisdiction (no local tax calculated): {result.unmatchedMunicipalities.join(', ')}</div>}
          <p className="muted small">Each employee is run through every check in plan year {result.settings.year}, with and without the deduction, so Social Security, FUTA and SUI wage bases are applied. Lines that use projected or unverified state data are listed in each employee's flags. {s.dataWarnings} data flags in total.</p>
        </>
      )}

      {view === 'employees' && (
        <div className="panel">
          <div className="row" style={{ marginBottom: 10 }}>
            <label>Search<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, ID or company" /></label>
            <label>Eligibility<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All</option>{order.filter((k) => s.byEligibility[k]).map((k) => <option key={k}>{k}</option>)}</select></label>
            <span className="muted small">{shown.length} shown</span>
            <button className="small" onClick={csv}>Export CSV</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>{cols.map(([k, l]) => <th key={k} className={['name', 'state', 'tier', 'elig'].includes(k) ? '' : 'num'} style={{ cursor: 'pointer' }} onClick={() => setSort({ k, d: sort.k === k ? (-sort.d as 1 | -1) : 1 })}>{l}{sort.k === k ? (sort.d === 1 ? ' ▲' : ' ▼') : ''}</th>)}<th>Flags</th></tr></thead>
              <tbody>{shown.map((e: any) => (
                <Fragment key={e.key}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === e.key ? undefined : e.key)}>
                    <td>{e.name}<div className="muted small">{e.row.company}{e.row.employeeId ? ` · ${e.row.employeeId}` : ''}</div></td>
                    <td>{e.row.workState}</td><td>{e.tier}</td><td className="num">{e.hoursPerWeek}</td><td className="num">{money(e.annualGross)}</td><td className="num">{money(e.deductionPerCheck)}</td>
                    <td className="num">{money(e.monthly?.employeeTaxBefore)}</td><td className="num">{money(e.monthly?.employeeTaxAfter)}</td>
                    <td className="num">{money(e.monthly?.employeeNetGain)}</td><td className="num">{money(e.monthly?.employerNetGain)}</td><td className="num">{money(e.monthly?.allotment)}</td>
                    <td><span className={`badge ${ELIG_CLASS(e.eligibility)}`}>{e.eligibility}</span></td>
                    <td className="num">{e.flags.length || ''}</td>
                  </tr>
                  {open === e.key && (
                    <tr><td colSpan={cols.length + 1} style={{ background: 'var(--bg)' }}>
                      {e.reasons.map((r: string, i: number) => <div key={i}><b>Why:</b> {r}</div>)}
                      {e.check && (
                        <table style={{ maxWidth: 700, margin: '8px 0' }}>
                          <thead><tr><th>First check of the year</th><th className="num">Before</th><th className="num">After</th></tr></thead>
                          <tbody>{[['Gross', 'gross'], ['New deduction', 'newDeduction'], ['Federal income tax', 'fit'], ['Social Security + Medicare', 'fica'], ['State and local', 'stateLocal'], ['Benefit payment back', 'benefitPayment'], ['Take-home', 'netPay'], ['Employer taxes', 'employerTaxes']].map(([l, k]) => <tr key={k}><td>{l}</td><td className="num">{money(e.check.before[k])}</td><td className="num">{money(e.check.after[k])}</td></tr>)}</tbody>
                        </table>
                      )}
                      {e.flags.length > 0 && <ul className="small" style={{ margin: '4px 0' }}>{e.flags.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>}
                    </td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'proposal' && (
        <div className="panel printable">
          <div className="row noprint" style={{ justifyContent: 'flex-end' }}><button onClick={() => window.print()}>Print or save as PDF</button></div>
          <h2 style={{ marginBottom: 4 }}>{meta.company ?? meta.name}: estimated savings with a pre-tax benefit plan</h2>
          <p className="muted" style={{ marginTop: 0 }}>Prepared by First Gen · Plan year {result.settings.year} · Estimates</p>
          <div className="kpis">
            {[['Employees reviewed', s.employees], ['Eligible employees', s.eligibleAfterPricing], ['Estimated employer savings per year', money(s.eligible.employerNetSavings)], ['Estimated added take-home per eligible employee per month', money(s.eligible.avgEmployeeMonthlyGain)]].map(([l, v]) => <div key={l} className="kpi"><div className="l">{l}</div><div className="v">{v}</div></div>)}
          </div>
          <h3>How it works</h3>
          <p>Eligible employees elect a pre-tax benefit through the company's Section 125 plan. Because the deduction comes out before taxes, both the employee's and the employer's payroll taxes go down. The benefit payment returns {Math.round((result.settings.tiers[0]?.benefitOffsetPercent ?? 1) * 100)}% of the deduction on each check, so take-home pay goes up by the tax saved{s.eligible.employeeFees ? ', less the plan fee' : ''}.</p>
          <h3>Estimated annual impact (eligible employees)</h3>
          <table style={{ maxWidth: 640 }}><tbody>
            <tr><td>Employer payroll tax savings</td><td className="num">{money(s.eligible.employerTaxSavings)}</td></tr>
            {s.eligible.employerFees > 0 && <tr><td>Program fees</td><td className="num">−{money(s.eligible.employerFees)}</td></tr>}
            <tr><td><b>Employer net savings</b></td><td className="num"><b>{money(s.eligible.employerNetSavings)}</b></td></tr>
            <tr><td>Employee tax savings</td><td className="num">{money(s.eligible.employeeTaxSavings)}</td></tr>
            <tr><td><b>Employee added take-home pay</b></td><td className="num"><b>{money(s.eligible.employeeNetGain)}</b></td></tr>
          </tbody></table>
          <h3>Who qualifies</h3>
          <table style={{ maxWidth: 640 }}><tbody>{order.filter((k) => s.byEligibility[k]).map((k) => <tr key={k}><td>{k}</td><td className="num">{s.byEligibility[k]}</td></tr>)}</tbody></table>
          <p className="muted small">These figures are estimates based on the payroll data provided and current federal, state and local tax rules. Actual results depend on each employee's elections, pay and withholding. Not tax or legal advice.</p>
        </div>
      )}
    </>
  );
}
