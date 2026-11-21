import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, downloadFile, money } from '../api';
import { PageHead, StateSelect, useReference } from '../components';
import { useCan } from '../auth';
import { PROPOSAL_STATUSES, StatusPill } from './Proposals';
import { ReportView } from './Report';
import { BASIS_WORD, pickMultiple, type MultiplesData } from './Multiples';

const FIELD_LABELS: Record<string, string> = {
  company: 'Company Name', employeeId: 'Employee ID', firstName: 'First Name', lastName: 'Last Name', workState: 'Work State', residenceState: 'Residence State',
  municipality: 'Municipality', grossPay: 'Gross Pay (per period or yearly)', otherComp: 'Commission / Bonus / Other', payFrequency: 'Pay Frequency', periodsPerYear: '# Periods',
  employmentType: 'Employment Type', hoursPerPeriod: 'Avg Hours per Period', hourlyRate: 'Hourly Rate', federalFilingStatus: 'Federal W-4 Status',
  dependentAllowances: 'Dependent Allowances (pre-2020 W-4)', dependentCredits: 'Dependent Credits (W-4 Step 3, $/yr)', additionalFit: 'Additional FITWH',
  federalTaxPaid: 'Federal Tax Before (yes/no, compared only)', stateTaxPaid: 'State Tax Before (yes/no, compared only)', stateFilingStatus: 'State Filing Status', stateDependents: 'State Dependents',
  additionalSit: 'Additional SITWH', healthMonthly: 'Group Health / month (pre-tax)', otherPretaxMonthly: 'Other Pre-Tax / month', retirementMonthly: '401(k) / IRA $ / month',
  retirementPercent: '401(k) %', postTaxMonthly: 'Post-Tax / month', proposedDeduction: 'First Gen Deduction Amount', tips: 'Tips', pto: 'PTO',
  reimbursements: 'Reimbursements', confidence: 'Confidence', birthDate: 'Birth Date',
  retirementSystemContribution: 'TRS / retirement system $ per check', socialSecurityPaid: 'Social Security withheld (yes/no or $)',
};

/** Payroll models a proposal can use. Only systems whose rates were read from the agency are offered. */
const PAYROLL_MODELS: [string, string][] = [['', 'Private employer'], ['TX_TRS', 'Texas TRS (school district)']];
const REQUIRED = ['grossPay', 'payFrequency', 'workState', 'federalFilingStatus'];
const ORDER = ['Eligible', 'PT Eligible', 'No Federal Taxes Paid', 'NEEDS REVIEW', 'Not Eligible - Insufficient Savings', 'Not Eligible - Insufficient Savings + No Federal Taxes Paid', 'Not Eligible - Low Income', 'Not Eligible - Insufficient Hours', 'Not Eligible - Insufficient Funds', 'Not Eligible - No Gross Compensation'];
const SHORT = (e: string) => e.replace('Not Eligible - ', '');
const ELIG_CLASS = (e: string) => (e === 'Excluded' ? 'b-neutral' : e === 'Eligible' || e === 'PT Eligible' ? 'b-ok' : e === 'NEEDS REVIEW' || e === 'No Federal Taxes Paid' ? 'b-warn' : 'b-bad');
const pctf = (n?: number) => (n === undefined || n === null ? '' : `${(n * 100).toFixed(1)}%`);
const colLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));

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
  const [file, setFile] = useState<{ fileName?: string; sheets: any[] }>();
  const [sheetName, setSheetName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<any>();
  const [result, setResult] = useState<any>();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [editReq, setEditReq] = useState(false);
  const [view, setView] = useState<'results' | 'proposal'>('results');
  const [tab, setTab] = useState<'results' | 'client' | 'history'>('results');
  const [reportSettings, setReportSettings] = useState<any>();
  const [dirty, setDirty] = useState(false);
  const can = useCan();
  const editable = can('proposals.edit');

  useEffect(() => {
    api('/proposals/defaults').then((d) => {
      setDefaults(d);
      if (!id) { setSettings(structuredClone(d.settings)); api('/report-defaults').then(setReportSettings); return; }
      api(`/proposals/${id}`).then((p) => {
        setMeta({ name: p.name, clientId: p.client_id ?? '', status: p.status, company: p.company, notes: p.notes ?? '', owner: p.owner_name });
        setReportSettings(p.report_settings);
        setHeaders(p.headers); setRows(p.raw_rows); setMapping(p.mapping); setSheetName(p.sheet_name ?? '');
        setFile({ fileName: p.file_name, sheets: [] });
        setSettings({ ...structuredClone(d.settings), ...p.settings, partTime: { ...d.settings.partTime, ...(p.settings.partTime ?? {}) } });
        if (p.summary?.programs) setResult({ settings: p.settings, employees: p.results, summary: p.summary, unmatchedMunicipalities: p.summary?.unmatchedMunicipalities ?? [] });
      }).catch((e) => setErr(e.message));
    });
    api('/clients').then(setClients).catch(() => {});
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

  const body = (s = settings) => ({ headers, rows, mapping, settings: s, name: meta.name || 'Proposal', clientId: meta.clientId || null, company: meta.company ?? null, fileName: file?.fileName ?? null, sheetName, status: meta.status, notes: meta.notes || null, reportSettings });
  const calculate = async (s = settings) => {
    setErr(''); setBusy(`Calculating ${rows.length} rows: a full year of checks for each, with and without the deduction…`);
    try { setResult(await api('/proposals/calculate', { json: body(s) })); setDirty(!!id); } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const save = async () => {
    setErr(''); setBusy('Saving…');
    try {
      const r = await api(id ? `/proposals/${id}` : '/proposals', { method: id ? 'PUT' : 'POST', json: body() });
      setResult(r.result);
      setDirty(false);
      if (!id) nav(`/proposals/${r.id}`, { replace: true });
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const download = async () => {
    setBusy('Building workbook…');
    try {
      // People who can't change proposals get the workbook of the saved numbers; editors get what is on screen.
      const name = `${meta.name || 'Proposal'} - Employee allotments.xlsx`;
      if (editable || !id) await downloadFile('/proposals/export', name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body()) });
      else await downloadFile(`/proposals/${id}/export`, name);
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const pickProgram = (price: number) => {
    const s = { ...settings, allotmentThreshold: price };
    setSettings(s);
    calculate(s);
  };
  const pickClient = (cid: string) => {
    const c = clients.find((x) => x.id === cid);
    setMeta({ ...meta, clientId: cid, name: meta.name || (c ? `${c.name} proposal` : '') });
    if (c) setSettings({
      ...settings, employer: { ...settings.employer, name: c.name, homeState: c.home_state ?? undefined, futaExempt: c.futa_exempt }, vendorProfileId: c.current_vendor ?? settings.vendorProfileId,
      // The client's payroll model and Social Security coverage carry into the proposal.
      retirementSystem: c.retirement_system ?? '',
      publicEmployer: { ...settings.publicEmployer, socialSecurityCovered: c.retirement_system ? !!c.social_security_covered : false },
    });
  };

  if (!defaults || !settings) return <p className="muted">Loading…</p>;
  const setS = (p: any) => setSettings({ ...settings, ...p });
  const setOverride = (key: string, o: any) => {
    const overrides = { ...(settings.overrides ?? {}) };
    const clean = Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined && v !== '' && v !== false && v !== null));
    if (Object.keys(clean).length) overrides[key] = clean; else delete overrides[key];
    const next = { ...settings, overrides };
    setSettings(next);
    void calculate(next);
  };
  const setPT = (p: any) => setS({ partTime: { ...settings.partTime, ...p } });
  const setPub = (p: any) => setS({ publicEmployer: { ...settings.publicEmployer, ...p } });
  // Governments are FUTA-exempt; switching to a public model turns that on (it can still be changed under Calculation).
  const setModel = (code: string) => setS({ retirementSystem: code, ...(code ? { employer: { ...settings.employer, futaExempt: true } } : {}) });
  const rsys = (ref?.retirementSystems ?? []).find((r: any) => r.code === settings.retirementSystem);
  const noSS = !!settings.retirementSystem && !settings.publicEmployer?.socialSecurityCovered;
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const missing = REQUIRED.filter((f) => !mapping[f]);
  const step = result ? 3 : rows.length ? 2 : 1;
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <>
      <div className="noprint">
        <PageHead eyebrow={<><Link to="/proposals">Proposal tool</Link> / {id ? 'Proposal' : 'New proposal'}</>} title={meta.company ?? (meta.name || 'New proposal')}>
          {result
            ? <><b>{result.summary.eligibleTotal}</b> of <b>{result.summary.employees}</b> employees qualify, for <b>{money(result.summary.monthlySavings.total)}</b> a month in allotments and {result.summary.retirement ? <><b>{money(result.summary.employerAnnualSavings.total)}</b> a year in employer savings.</> : <>a <b>{money(result.summary.valuationIncrease)}</b> valuation increase.</>}</>
            : rows.length ? <>Read <b>{rows.length}</b> rows. Check the column mapping, then calculate.</> : 'Upload a census, underwriting sheet or payroll register to compare every employee\'s taxes before and after the First Gen deduction.'}
        </PageHead>
      </div>
      <div className="stepper noprint">{['Import', 'Map', 'Results'].map((l, i) => <span key={l} className={step > i + 1 ? 'done' : step === i + 1 ? 'on' : ''}><b>{step > i + 1 ? '✓' : i + 1}</b>{l}</span>)}</div>
      {err && <div className="err" style={{ marginBottom: 16 }}>{err}</div>}
      {!editable && <div className="fg-callout noprint" style={{ marginBottom: 16 }}>You can look at this proposal but not change it. Ask an admin if you need to edit proposals.</div>}

      <fieldset className="fg-plain" disabled={!editable}>
      <div className="panel noprint">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><h3 style={{ margin: 0 }}>Import source</h3>{file?.fileName && <span className="muted small">{file.fileName}{sheetName ? ` · ${sheetName}` : ''}</span>}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <label>Census, underwriting sheet or payroll register (.xlsx or .csv)<input type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => upload(e.target.files?.[0])} /></label>
          <label style={{ minWidth: 260 }}>Proposal name<input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></label>
          <label>Client (optional)<select value={meta.clientId} onChange={(e) => pickClient(e.target.value)}><option value="">Prospect (not a client yet)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Status<select value={meta.status} onChange={(e) => { setMeta({ ...meta, status: e.target.value }); setDirty(true); }}>{PROPOSAL_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        </div>
        <label style={{ marginTop: 12 }}>Notes for the team (not shown to the client)<input value={meta.notes ?? ''} onChange={(e) => { setMeta({ ...meta, notes: e.target.value }); setDirty(true); }} placeholder="e.g. waiting on October register, owner wants MEC Plus quote" /></label>
        {id && meta.owner && <div className="muted small" style={{ marginTop: 8 }}>Owner: {meta.owner} · <StatusPill s={meta.status} /></div>}
      </div>

      <div className="panel noprint">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="row" style={{ alignItems: 'center', gap: 8 }}><h3 style={{ margin: 0 }}>Payroll model</h3>
            <div className="seg">{PAYROLL_MODELS.map(([k, l]) => <button key={k || 'private'} className={(settings.retirementSystem ?? '') === k ? 'on' : ''} onClick={() => setModel(k)}>{l}</button>)}</div>
          </span>
          <span className="muted small">{settings.retirementSystem
            ? <>{rsys?.name ?? settings.retirementSystem} · member {((rsys?.memberRate ?? 0) * 100).toFixed(2)}% pre-tax · {noSS ? 'Medicare only (no Social Security)' : 'Social Security + Medicare'}</>
            : 'Social Security + Medicare on every employee'}</span>
        </div>
        {settings.retirementSystem && (
          <>
            <div className="row" style={{ marginTop: 12 }}>
              <label className="check"><input type="checkbox" checked={!!settings.publicEmployer?.socialSecurityCovered} onChange={(e) => setPub({ socialSecurityCovered: e.target.checked })} />District pays Social Security (has a Section 218 agreement)</label>
              <label className="check"><input type="checkbox" disabled={!!settings.publicEmployer?.socialSecurityCovered} checked={!!settings.publicEmployer?.detectSocialSecurity} onChange={(e) => setPub({ detectSocialSecurity: e.target.checked })} />Include Social Security for anyone the file shows paying it</label>
              <label className="check"><input type="checkbox" checked={!!settings.publicEmployer?.useFileContribution} onChange={(e) => setPub({ useFileContribution: e.target.checked })} />Use the file's TRS amount when it has one</label>
              <label className="check"><input type="checkbox" checked={!!settings.publicEmployer?.cafeteriaReductionsCovered} onChange={(e) => setPub({ cafeteriaReductionsCovered: e.target.checked })} />TRS counts the First Gen deduction as pay</label>
            </div>
            <div className="fg-callout" style={{ marginBottom: 0 }}>
              <span>
                The {(rsys?.memberRate * 100 || 8.25).toFixed(2)}% member contribution comes out before federal income tax but not before Medicare{settings.publicEmployer?.socialSecurityCovered ? ' and Social Security' : ''}, on pay before any Section 125 deduction.
                {noSS ? ' Most Texas districts do not pay Social Security, so each dollar of the First Gen deduction saves 1.45% Medicare for the district and income tax plus 1.45% Medicare for the employee.' : ' Each dollar of the First Gen deduction saves 7.65% Social Security and Medicare for the district.'}
                {settings.publicEmployer?.cafeteriaReductionsCovered
                  ? ' TRS counts Section 125 salary reductions as pay (34 TAC 25.21), so TRS contributions and pensions do not change, as long as the plan is offered to every TRS member, uses a written salary reduction agreement and has no cash option.'
                  : ' Modeled as if TRS does not count the deduction: TRS contributions, and the pension they build, go down with it.'}
                {' '}Government employers are FUTA-exempt. Rates: {rsys?.rateYear ?? 'TRS'}.
              </span>
            </div>
          </>
        )}
      </div>

      <div className="panel noprint">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="row" style={{ alignItems: 'center', gap: 8 }}><h3 style={{ margin: 0 }}>Eligibility requirements</h3><span className="badge b-neutral">11 rules</span><button className="small" onClick={() => setEditReq(!editReq)}>{editReq ? 'Close' : 'Edit'}</button></span>
          {!editReq && <span className="muted small">{settings.benefitPackages.find((p: any) => p.id === settings.benefitPackageId)?.name} package · allotment ≥ {money(settings.allotmentThreshold)} · low income ≤ {money(settings.lowIncomeMax)} · ≥ {settings.minHoursPerPeriod} hrs/period · review ≥ {money(settings.needsReviewAllotment)} · buffer {Math.round(settings.allotmentBuffer * 100)}% · deduction {money(settings.deductionPerCheck)}/check</span>}
        </div>
        {editReq && (
          <div style={{ marginTop: 12 }}>
            <label>Benefit package (preventative care tier applied to benefit cost)</label>
            <div className="seg" style={{ marginTop: 6 }}>{settings.benefitPackages.map((p: any) => <button key={p.id} className={settings.benefitPackageId === p.id ? 'on' : ''} onClick={() => setS({ benefitPackageId: p.id })}>{p.name} ({money(p.monthlyCost)})</button>)}</div>
            <div className="grid2" style={{ marginTop: 12 }}>
              <label>Monthly allotment threshold: minimum monthly allotment required ($)<input type="number" value={settings.allotmentThreshold} onChange={(e) => setS({ allotmentThreshold: num(e.target.value) })} /></label>
              <label>Low income threshold: annual gross at or below this is low income ($)<input type="number" value={settings.lowIncomeMax} onChange={(e) => setS({ lowIncomeMax: num(e.target.value) })} /></label>
              <label>Minimum hours per period: minimum average hours per pay period<input type="number" value={settings.minHoursPerPeriod} onChange={(e) => setS({ minHoursPerPeriod: num(e.target.value) })} /></label>
              <label>State tax threshold: minimum state tax per check in income-tax states ($, flagged)<input type="number" step="0.01" value={settings.stateTaxThreshold} onChange={(e) => setS({ stateTaxThreshold: num(e.target.value) })} /></label>
              <label>Needs review threshold: allotment at or above this flags NEEDS REVIEW ($)<input type="number" value={settings.needsReviewAllotment} onChange={(e) => setS({ needsReviewAllotment: num(e.target.value) })} /></label>
              <label>Allotment buffer: multiplier on monthly tax savings (0.75 = 75%)<input type="number" step="0.01" value={settings.allotmentBuffer} onChange={(e) => setS({ allotmentBuffer: num(e.target.value) })} /></label>
              <label>First Gen deduction per check (when the file has none) ($)<input type="number" step="0.01" value={settings.deductionPerCheck} onChange={(e) => setS({ deductionPerCheck: num(e.target.value) })} /></label>
              <label>File's First Gen deduction amount is per<select value={settings.useRowDeduction ? settings.rowDeductionPer : 'ignore'} onChange={(e) => setS(e.target.value === 'ignore' ? { useRowDeduction: false } : { useRowDeduction: true, rowDeductionPer: e.target.value })}><option value="check">check</option><option value="month">month</option><option value="ignore">ignore it, use the amount above</option></select></label>
              <label>Employees the engine calculates no federal tax for<select value={settings.noFederalTaxAs} onChange={(e) => setS({ noFederalTaxAs: e.target.value })}><option value="warning">Warning only (still eligible)</option><option value="status">Own status: No Federal Taxes Paid</option></select></label>
              <label>Participation: share of eligible employees expected to enroll (%)<input type="number" min={0} max={100} value={Math.round((settings.participationRate ?? 1) * 100)} onChange={(e) => setS({ participationRate: Math.min(100, Math.max(0, num(e.target.value))) / 100 })} /></label>
              <label>Employer savings<select value={settings.employerSavingsBasis} onChange={(e) => setS({ employerSavingsBasis: e.target.value })}><option value="fica">{noSS ? 'Medicare only (1.45%, no Social Security)' : 'Social Security + Medicare (7.65%)'}</option><option value="all">All employer taxes (adds FUTA, SUI, etc.)</option></select></label>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <label className="check"><input type="checkbox" checked={settings.includeCommission} onChange={(e) => setS({ includeCommission: e.target.checked })} />Include commission/bonus in gross pay</label>
              <label className="check"><input type="checkbox" checked={settings.dedupe} onChange={(e) => setS({ dedupe: e.target.checked })} />Count repeated employees once</label>
            </div>
            <h3>Part-time plan</h3>
            <div className="row">
              <label className="check"><input type="checkbox" checked={settings.partTime.enabled} onChange={(e) => setPT({ enabled: e.target.checked })} />Offer the part-time plan to rows that fail standard eligibility</label>
              <label>PT deduction per check<input style={{ width: 100 }} type="number" value={settings.partTime.deductionPerCheck} onChange={(e) => setPT({ deductionPerCheck: num(e.target.value) })} /></label>
              <label>PT allotment threshold<input style={{ width: 100 }} type="number" value={settings.partTime.allotmentThreshold} onChange={(e) => setPT({ allotmentThreshold: num(e.target.value) })} /></label>
              <label>Trigger: hours/week at or below<input style={{ width: 90 }} type="number" value={settings.partTime.maxHoursPerWeek} onChange={(e) => setPT({ maxHoursPerWeek: num(e.target.value) })} /></label>
              <label>or annual gross below<input style={{ width: 110 }} type="number" value={settings.partTime.maxAnnualGross} onChange={(e) => setPT({ maxAnnualGross: num(e.target.value) })} /></label>
            </div>
            <h3>Calculation</h3>
            <div className="row">
              <label>Plan year<input style={{ width: 90 }} type="number" value={settings.year} onChange={(e) => setS({ year: num(e.target.value) })} /></label>
              <label>Calculate like<select value={settings.vendorProfileId ?? ''} onChange={(e) => setS({ vendorProfileId: e.target.value || undefined })}><option value="">By the book (IRS)</option>{(ref?.vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
              <label>Employer home state<StateSelect allowEmpty value={settings.employer.homeState ?? ''} onChange={(v) => setS({ employer: { ...settings.employer, homeState: v || undefined } })} /></label>
              <label className="check"><input type="checkbox" checked={!!settings.employer.futaExempt} onChange={(e) => setS({ employer: { ...settings.employer, futaExempt: e.target.checked } })} />FUTA exempt</label>
              <button onClick={() => setSettings(structuredClone(defaults.settings))}>Reset to defaults</button>
            </div>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="panel noprint">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Column mapping review</h3>
            <span className="muted small">{mappedCount}/{defaults.fields.length} fields mapped · {rows.length} rows</span>
          </div>
          {file?.sheets?.length ? <label style={{ maxWidth: 300, marginTop: 8 }}>Sheet<select value={sheetName} onChange={(e) => chooseSheet(file, e.target.value)}>{file.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rows.length} rows)</option>)}</select></label> : null}
          {file?.sheets?.find((s) => s.name === sheetName)?.truncated && <div className="err" style={{ marginTop: 8 }}>This sheet has more than 20,000 rows. Only the first 20,000 were read; split the file to run the rest.</div>}
          {missing.length > 0 && <div className="err" style={{ marginTop: 8 }}>Map these before calculating: {missing.map((m) => FIELD_LABELS[m]).join(', ')}</div>}
          <details open={!result} style={{ marginTop: 8 }}>
            <summary>Fields</summary>
            <div className="fg-tablebox tall">
              <table>
                <thead><tr><th>Field</th><th>Mapped column</th><th>Sample values</th></tr></thead>
                <tbody>{defaults.fields.map((f: string) => (
                  <tr key={f}>
                    <td>{mapping[f] ? <span className="fg-ok-text" aria-label="mapped">✓ </span> : <span className="muted">· </span>}{FIELD_LABELS[f] ?? f}{REQUIRED.includes(f) && <span className="muted"> *</span>}</td>
                    <td><select value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value })}><option value="">(not in file)</option>{headers.map((h, i) => <option key={h} value={h}>{colLetter(i)}: {h}</option>)}</select></td>
                    <td className="muted small">{mapping[f] ? rows.slice(0, 3).map((r) => String(r[mapping[f]] ?? '–')).join(' · ') : ''}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            {busy && <span className="muted">{busy}</span>}
            <button className="primary" disabled={missing.length > 0 || !!busy} onClick={() => calculate()}>Calculate</button>
          </div>
        </div>
      )}
      </fieldset>

      {result && (
        <div className="row noprint" style={{ marginBottom: 16, alignItems: 'center' }}>
          <div className="tabs" style={{ marginBottom: 0 }}>
            <button className={tab === 'results' ? 'on' : ''} onClick={() => setTab('results')}>Results</button>
            <button className={tab === 'client' ? 'on' : ''} onClick={() => setTab('client')}>Client page</button>
            {id && <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>History</button>}
          </div>
          {dirty && <span className="badge b-warn">Unsaved changes</span>}
          {editable && <button className="small primary" disabled={!!busy} onClick={save}>{id ? 'Save changes' : 'Save proposal'}</button>}
        </div>
      )}
      {result && tab === 'results' && (
        <Results result={result} settings={settings} setS={setS} view={view} setView={setView} meta={meta} busy={busy} editable={editable}
          onSave={save} onDownload={download} onPickProgram={editable ? pickProgram : () => {}} onOverride={setOverride} saveLabel={id ? 'Save changes' : 'Save proposal'} />
      )}
      {result && tab === 'client' && <ClientPage publicEmployer={!!result?.summary?.retirement} id={id} dirty={dirty} repeats={result.settings.dedupe ? 0 : result.summary.duplicates?.length ?? 0} reportSettings={reportSettings} setReportSettings={(r: any) => { setReportSettings(r); setDirty(true); }} onSave={save} canShare={can('proposals.share')} editable={editable} />}
      {result && tab === 'history' && id && <History id={id} onLoad={(s: any) => { setSettings({ ...settings, ...s }); setTab('results'); void calculate({ ...settings, ...s }); }} editable={editable} />}
    </>
  );
}

function Results({ result, settings, setS, view, setView, meta, busy, onSave, onDownload, onPickProgram, onOverride, editable, saveLabel }: any) {
  const s = result.summary;
  const [filter, setFilter] = useState('');
  const [stateF, setStateF] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string>();
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: 'row', d: 1 });
  const cols: [string, string, (e: any) => any, 'money' | 'pct' | 'text'][] = [
    ['name', 'Name', (e) => e.name, 'text'], ['state', 'State', (e) => e.row.workState, 'text'], ['gross', 'Gross (annual)', (e) => e.annualGross, 'money'],
    ['fg', 'First Gen', (e) => e.perPeriod?.firstGen, 'money'], ['ded', 'Deductions', (e) => e.perPeriod?.deductions || undefined, 'money'], ['net', 'Net (PP)', (e) => e.perPeriod?.net, 'money'],
    ['tb', 'Tax (pre-First Gen)', (e) => e.perPeriod?.taxBefore, 'money'], ['ta', 'Tax (PP)', (e) => e.perPeriod?.taxAfter, 'money'], ['allot', 'Mo. allotment', (e) => e.monthly?.allotment, 'money'],
    ['eff', 'Eff. rate', (e) => e.perPeriod?.effectiveRate, 'pct'], ['elig', 'Eligibility', (e) => e.eligibility, 'text'],
  ];
  const states = useMemo(() => [...new Set(result.employees.map((e: any) => e.row.workState).filter(Boolean))].sort() as string[], [result]);
  const shown = useMemo(() => {
    const getter = sort.k === 'row' ? (e: any) => e.row.rowNumber : cols.find((c) => c[0] === sort.k)![2];
    return result.employees
      .filter((e: any) => (!filter || e.eligibility === filter) && (!stateF || e.row.workState === stateF) && (!search || `${e.name} ${e.row.employeeId ?? ''} ${e.row.company ?? ''}`.toLowerCase().includes(search.toLowerCase())))
      .sort((a: any, b: any) => { const x = getter(a), y = getter(b); return (x === y ? 0 : x === undefined ? 1 : y === undefined ? -1 : x > y ? 1 : -1) * sort.d; });
  }, [result, filter, stateF, search, sort]);
  useEffect(() => setPage(0), [filter, stateF, search, sort]);
  // Valuation: the multiple follows the industry, ownership and size unless the reviewer typed their own.
  const [multiples, setMultiples] = useState<MultiplesData>();
  useEffect(() => { api('/multiples').then(setMultiples).catch(() => undefined); }, []);
  const industries = multiples?.industries ?? [];
  const typical = pickMultiple(multiples?.rows ?? [], settings.industry, settings.ownership ?? 'private', settings.companySize);
  const setValuation = (p: any) => {
    const next = { ...settings, ...p };
    const row = pickMultiple(multiples?.rows ?? [], next.industry, next.ownership ?? 'private', next.companySize);
    setS({ ...p, multipleAuto: true, ...(row ? { ebitdaMultiple: row.multiple } : {}) });
  };
  const pageRows = shown.slice(page * 25, page * 25 + 25);
  const pages = Math.max(1, Math.ceil(shown.length / 25));
  const tot = (f: (e: any) => number | undefined) => shown.reduce((a: number, e: any) => a + (f(e) ?? 0), 0);
  const pt = result.employees.filter((e: any) => e.partTime?.eligible);
  const best = s.programs.reduce((a: any, p: any) => (!a || p.annualMargin > a.annualMargin ? p : a), undefined);
  const dist = s.allotmentDistribution;
  const distTotal = dist.below + dist.near + dist.atOrAbove || 1;
  const csv = () => {
    const lines = [['Row', ...cols.map((c) => c[1]), 'PT allotment', 'Reason', 'Flags', 'Status for the client', 'Why', 'What would change it'].join(','), ...shown.map((e: any) => [e.row.rowNumber, ...cols.map((c) => c[2](e) ?? ''), e.partTime?.allotment ?? '', e.reasons.join(' '), e.flags.join(' '), e.explanation ? [e.explanation.status, e.explanation.headline].filter(Boolean).join(': ') : '', e.explanation?.reason ?? '', (e.explanation?.suggestions ?? []).join(' ')].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: `${meta.name || 'proposal'} results.csv` }).click();
  };

  return (
    <>
      <div className="panel noprint">
        <div className="row" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Results</h3><span className="badge b-neutral">{s.rowsInFile} rows processed</span>
          <button className="small" onClick={csv}>CSV</button>
          <button className="small primary" onClick={onDownload} title="Each employee's status and savings allotment, the summary, and the underwriting sheet">Export to Excel</button>
          <button className="small" onClick={() => setView(view === 'proposal' ? 'results' : 'proposal')}>{view === 'proposal' ? 'Back to results' : 'Printable summary'}</button>
          <button className="small" disabled title="Next step: connect the app to Pipedrive">Send to Pipedrive</button>
          {busy && <span className="muted small">{busy}</span>}
        </div>
        {s.retirement ? <p className="muted small" style={{ margin: '8px 0 0' }}>A public employer has no EBITDA, so this proposal shows no valuation increase. Employer savings use the {s.retirement.name} model: {s.retirement.socialSecurity === 'none' ? 'Medicare only, because the district does not pay Social Security' : 'Social Security where it is paid, plus Medicare'}.</p> : <>
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <label>Industry<select value={industries.some((i) => i.key === settings.industry) ? settings.industry : ''} onChange={(e) => setValuation({ industry: e.target.value })}>
            <option value="">Choose an industry</option>
            {industries.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
          </select></label>
          <div className="seg">{['private', 'public'].map((o) => <button key={o} className={(settings.ownership ?? 'private') === o ? 'on' : ''} onClick={() => setValuation({ ownership: o })}>{o[0].toUpperCase() + o.slice(1)}</button>)}</div>
          <label>Company size<select value={settings.ownership === 'public' ? 'all' : settings.companySize || 'all'} disabled={settings.ownership === 'public'} title={settings.ownership === 'public' ? 'Public company figures are not split by size' : undefined} onChange={(e) => setValuation({ companySize: e.target.value })}>
            {(multiples?.sizes ?? [{ key: 'all', label: 'Any size (industry average)' }]).map((z: any) => <option key={z.key} value={z.key}>{z.label}</option>)}
          </select></label>
          <label>Multiple (x)<input style={{ width: 80 }} type="number" step="0.1" value={settings.ebitdaMultiple} onChange={(e) => setS({ ebitdaMultiple: Number(e.target.value), multipleAuto: false })} /></label>
          <label>Savings / employee<input style={{ width: 120 }} readOnly value={money(s.employerAnnualSavings.perEmployee)} /></label>
          {settings.ebitdaMultiple !== result.settings.ebitdaMultiple && <span className="muted small">Recalculate to apply the new multiple.</span>}
        </div>
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          {typical && settings.multipleAuto !== false && <>Filled in from the multiples table: <b>{typical.multiple.toFixed(1)}x</b> is typical for {settings.ownership ?? 'private'} companies in this industry{typical.sizeBand !== 'all' ? ' at this size' : ''}. {BASIS_WORD[typical.basis]}. </>}
          {typical && settings.multipleAuto === false && <>You typed this multiple. The table has <b>{typical.multiple.toFixed(1)}x</b> for this industry and size. <button className="small" onClick={() => setS({ ebitdaMultiple: typical.multiple, multipleAuto: true })}>Use {typical.multiple.toFixed(1)}x</button> </>}
          {!typical && <>Choose an industry to fill in the typical multiple. Until then the multiple is the one typed here. </>}
          <Link to="/multiples">See the multiples table</Link>
        </p></>}
      </div>

      {view === 'results' && (
        <>
          <div className="panel">
            <h3>Margin strategy analyzer</h3><div className="fg-note">Click a program to see eligibility at that price point. Margin = price − {s.benefitPackage?.name} benefit cost ({money(s.benefitPackage?.monthlyCost)}) per eligible employee per month.</div>
            <div className="fg-tablebox"><table>
              <thead><tr><th>Program</th><th className="num">Eligible</th><th className="num">Monthly revenue</th><th className="num">Benefit cost</th><th className="num">Margin %</th><th className="num">12-month margin</th></tr></thead>
              <tbody>{s.programs.map((p: any) => (
                <tr key={p.price} className={p.price === result.settings.allotmentThreshold ? 'fg-sel' : undefined} style={{ cursor: 'pointer' }} onClick={() => onPickProgram(p.price)}>
                  <td><b>{money(p.price)}</b> {p.price === result.settings.allotmentThreshold && <span className="badge b-primary">Current</span>} {best?.price === p.price && <span className="badge b-green">Best margin</span>}</td>
                  <td className="num">{p.eligible}</td><td className="num">{money(p.monthlyRevenue)}</td><td className="num">{money(p.monthlyBenefitCost)}</td><td className="num">{pctf(p.marginPercent)}</td><td className="num">{money(p.annualMargin)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>

          <div className="kpis">
            <div className="kpi"><div className="l">Eligible employees</div><div className="v">{s.eligibleTotal} <span className="s" style={{ fontSize: '1rem' }}>of {s.employees}</span></div>
              <div className="fg-bar"><span style={{ width: `${(s.eligibleFull / s.employees) * 100}%` }} /><span style={{ width: `${(s.eligiblePartTime / s.employees) * 100}%` }} /></div>
              <div className="fg-legend"><span><i />Full plan <b>{s.eligibleFull}</b></span><span><i className="muted-fill" />Part-time <b>{s.eligiblePartTime}</b></span></div></div>
            <div className="kpi"><div className="l">Monthly allotments</div><div className="v">{money(s.monthlySavings.total)}</div>
              <div className="s">Average <b>{money(s.monthlySavings.average)}</b> · Annual <b>{money(s.monthlySavings.annual)}</b></div><div className="s">{money(s.monthlySavings.full)} full plan + {money(s.monthlySavings.partTime)} part-time</div></div>
            {s.retirement
              ? <div className="kpi"><div className="l">Employer savings a year</div><div className="v">{money(s.employerAnnualSavings.total)}</div>
                  <div className="s">{s.retirement.socialSecurity === 'none' ? 'Medicare only, no Social Security' : s.retirement.socialSecurity === 'some' ? <>Social Security for <b>{s.retirement.socialSecurityEmployees}</b>, Medicare for the rest</> : 'Social Security + Medicare'}</div>
                  {s.retirement.memberAnnual.before > 0 && <div className="s">{s.retirement.memberAnnual.after === s.retirement.memberAnnual.before ? <>TRS contributions unchanged at <b>{money(s.retirement.memberAnnual.before)}</b> a year</> : <>TRS contributions <b>{money(s.retirement.memberAnnual.before)}</b> to <b>{money(s.retirement.memberAnnual.after)}</b> a year</>}</div>}</div>
              : <div className="kpi"><div className="l">Valuation increase</div><div className="v">{money(s.valuationIncrease)}</div>
                  <div className="s"><b>{money(s.employerAnnualSavings.total)}</b> employer savings a year × {result.settings.ebitdaMultiple}x EBITDA</div></div>}
            <div className="kpi"><div className="l">Allotment distribution</div>
              <div className="fg-bar tall"><span className="critical" style={{ width: `${(dist.below / distTotal) * 100}%` }} /><span className="muted-fill" style={{ width: `${(dist.near / distTotal) * 100}%` }} /><span style={{ width: `${(dist.atOrAbove / distTotal) * 100}%` }} /></div>
              <div className="fg-legend"><span><i className="critical" />Under {money(dist.lowEdge)} <b>{dist.below}</b></span><span><i className="muted-fill" />{money(dist.lowEdge)}–{money(dist.highEdge)} <b>{dist.near}</b></span><span><i />{money(dist.highEdge)}+ <b>{dist.atOrAbove}</b></span></div></div>
          </div>
          {s.duplicates?.length > 0 && <div className="warn">{s.duplicates.length} of {s.rowsInFile} rows repeat an employee already in the file (same company, ID and name), for example {s.duplicates.slice(0, 2).map((d: any) => `${d.name} on row ${d.rowNumber}`).join(' and ')}. {result.settings.dedupe ? 'They are counted once.' : 'They are counted as separate rows; turn on "Count repeated employees once" under eligibility requirements to count each person once.'}</div>}
          {result.unmatchedMunicipalities?.length > 0 && <div className="warn">Municipalities with no matching local tax jurisdiction (no local tax calculated): {result.unmatchedMunicipalities.join(', ')}</div>}

          <div className="panel">
            <div className="row" style={{ marginBottom: 10 }}>
              <label style={{ minWidth: 260 }}>Search<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, ID, company…" /></label>
              <label>Status<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All status</option>{ORDER.filter((k) => s.byEligibility[k]).map((k) => <option key={k} value={k}>{SHORT(k)} ({s.byEligibility[k]})</option>)}</select></label>
              <label>State<select value={stateF} onChange={(e) => setStateF(e.target.value)}><option value="">All states</option>{states.map((x) => <option key={x}>{x}</option>)}</select></label>
            </div>
            <div className="fg-tablebox">
              <table>
                <thead><tr><th style={{ width: 18 }} />{cols.map(([k, l, , t]) => <th key={k} className={t === 'text' ? '' : 'num'} style={{ cursor: 'pointer' }} onClick={() => setSort({ k, d: sort.k === k ? (-sort.d as 1 | -1) : 1 })}>{l}{sort.k === k ? (sort.d === 1 ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
                <tbody>{pageRows.map((e: any) => (
                  <Fragment key={e.key}>
                    <tr style={{ cursor: 'pointer' }} className={open === e.key ? 'fg-sel' : undefined} onClick={() => setOpen(open === e.key ? undefined : e.key)}>
                      <td className="muted">{open === e.key ? '▾' : '›'}</td>
                      {cols.map(([k, , f, t]) => {
                        const v = f(e);
                        if (k === 'name') return <td key={k}>{v}{e.flags.some((x: string) => x.startsWith('⚠')) && <> <span className="badge b-warn" title="No federal tax withheld in the file">No fed tax</span></>}</td>;
                        if (k === 'elig') return <td key={k}><span className={`badge ${ELIG_CLASS(v)}`}>{SHORT(v)}</span></td>;
                        return <td key={k} className={t === 'text' ? '' : 'num'} style={k === 'allot' ? { fontWeight: 700 } : undefined}>{t === 'money' ? money(v) : t === 'pct' ? pctf(v) : v}</td>;
                      })}
                    </tr>
                    {open === e.key && (
                      <tr><td colSpan={cols.length + 1} style={{ background: 'var(--fg-tint)' }}>
                        <div className="muted small">Row {e.row.rowNumber} · {e.row.company} · ID {e.row.employeeId} · {e.frequency} · {e.hoursPerPeriod ?? '?'} hrs/period ({e.hoursPerWeek ?? '?'} /wk)</div>
                        {e.reasons.map((r: string, i: number) => <div key={i}><b>Why:</b> {r}</div>)}
                        {e.eligibility === 'Excluded' ? <div style={{ margin: '6px 0' }}><b>What the client sees:</b> nothing. A row that is left out does not appear on the client page or in its counts.</div> : e.explanation && (
                          <div style={{ margin: '6px 0', maxWidth: '58rem' }}>
                            <div><b>What the client sees:</b> {[e.explanation.status, e.explanation.headline].filter(Boolean).join(': ')}. {e.explanation.reason}</div>
                            {e.explanation.suggestions.map((x: string, i: number) => <div key={i}><b>What would change it:</b> {x}</div>)}
                          </div>
                        )}
                        {editable && <OverrideEditor e={e} onChange={(o: any) => onOverride(e.key, o)} busy={!!busy} partTime={result.settings.partTime} />}
                        {e.check && (
                          <table style={{ maxWidth: 760, margin: '8px 0' }}>
                            <thead><tr><th>Per check</th><th className="num">Before</th><th className="num">With First Gen</th><th>Full year</th><th className="num">Before</th><th className="num">With First Gen</th></tr></thead>
                            <tbody>{[['Gross', 'gross'], ['First Gen deduction', 'newDeduction'], ['Other deductions', 'otherDeductions'], ['Federal income tax', 'fit'], ['Social Security + Medicare', 'fica'], ['State and local', 'stateLocal'], ['Employer taxes', 'employerTaxes']].map(([l, k]) => (
                              <tr key={k}><td>{l}</td><td className="num">{money(e.check.before[k])}</td><td className="num">{money(e.check.after[k])}</td><td /><td className="num">{money(e.annual.before[k])}</td><td className="num">{money(e.annual.after[k])}</td></tr>
                            ))}
                              <tr><td>Employee tax savings / month</td><td /><td className="num">{money(e.monthly.employeeTaxSavings)}</td><td>Allotment ({Math.round(result.settings.allotmentBuffer * 100)}%)</td><td /><td className="num">{money(e.monthly.allotment)}</td></tr>
                            </tbody>
                          </table>
                        )}
                        {e.flags.length > 0 && <ul className="small" style={{ margin: '4px 0' }}>{e.flags.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
                  <tr className="fg-all"><td /><td>Totals</td><td /><td className="num">{money(tot((e) => e.annualGross))}</td><td className="num">{money(tot((e) => e.perPeriod?.firstGen))}</td><td className="num">{money(tot((e) => e.perPeriod?.deductions))}</td><td className="num">{money(tot((e) => e.perPeriod?.net))}</td><td className="num">{money(tot((e) => e.perPeriod?.taxBefore))}</td><td className="num">{money(tot((e) => e.perPeriod?.taxAfter))}</td><td className="num">{money(tot((e) => (e.eligibility === 'Eligible' ? e.monthly?.allotment : 0)))}</td><td /><td /></tr>
                </tbody>
              </table>
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8, alignItems: 'center' }}>
              <span className="muted small">Showing {shown.length ? page * 25 + 1 : 0}–{Math.min(shown.length, page * 25 + 25)} of {shown.length}</span>
              <span><button className="small" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button> <span className="small">Page {page + 1} of {pages}</span> <button className="small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button></span>
            </div>
          </div>

          {pt.length > 0 && (
            <div className="panel">
              <h3>Part-time eligible employees <span className="badge b-neutral">{pt.length}</span></h3>
              <div className="fg-note">Rows that fail standard eligibility but qualify under the part-time plan.</div>
              <div className="fg-tablebox">
                <table>
                  <thead><tr><th>#</th><th>Name</th><th>Company</th><th>State</th><th>Pay freq</th><th>Triggers</th><th>Standard result</th><th className="num">As-imported ded</th><th className="num">As-imported allotment</th><th className="num">PT ded</th><th className="num">PT allotment</th><th className="num">Savings Δ</th><th>PT status</th></tr></thead>
                  <tbody>{pt.map((e: any, i: number) => (
                    <tr key={e.key}><td>{i + 1}</td><td>{e.name}</td><td>{e.row.company}</td><td>{e.row.workState}</td><td>{e.frequency}</td>
                      <td>{e.partTime.triggers.map((t: string) => <span key={t} className="badge b-neutral" style={{ marginRight: 4 }}>{t}</span>)}</td>
                      <td className="small">{SHORT(e.standardEligibility)}</td>
                      <td className="num">{money(e.deductionPerCheck ?? e.perPeriod?.firstGen)}</td><td className="num">{money(e.monthly?.allotment ?? 0)}</td><td className="num">{money(e.partTime.deductionPerCheck)}</td><td className="num">{money(e.partTime.allotment)}</td>
                      <td className="num">{money(e.partTime.savingsDelta)}</td><td><span className="badge b-ok">PT Eligible</span></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
          <p className="muted small">Each row is run through every check in plan year {result.settings.year}, with and without the deduction, so Social Security, FUTA and SUI wage bases are applied. Allotment = employee tax savings per month × {Math.round(result.settings.allotmentBuffer * 100)}%. Per-check columns show the first check of the year. Lines that use projected or unverified state data are listed in each employee's flags ({s.dataWarnings} flags in total).</p>
        </>
      )}

      {view === 'proposal' && (
        <div className="panel printable">
          <div className="row noprint" style={{ justifyContent: 'flex-end' }}><button onClick={() => window.print()}>Print or save as PDF</button></div>
          <h2 style={{ marginBottom: 4 }}>{meta.company ?? meta.name}: estimated savings with the First Gen benefit program</h2>
          <p className="muted" style={{ marginTop: 0 }}>Prepared by First Gen · Plan year {result.settings.year} · Estimates</p>
          <div className="kpis">
            {[['Employees reviewed', s.employees], ['Eligible employees', `${s.eligibleTotal}`], ['Estimated employer savings per year', money(s.employerAnnualSavings.total)], ...(s.retirement ? [] : [['Estimated valuation increase', money(s.valuationIncrease)]])].map(([l, v]) => <div key={l} className="kpi"><div className="l">{l}</div><div className="v">{v}</div></div>)}
          </div>
          <h3>How it works</h3>
          <p>Eligible employees enroll in a pre-tax benefit through the company's Section 125 plan, with a {s.benefitPackage?.name} preventative care package. Because the deduction comes out before taxes, both the employee's and the employer's payroll taxes go down. {s.retirement
            ? s.retirement.socialSecurity === 'none'
              ? ` The district does not pay Social Security, so it saves Medicare tax (1.45%) on every dollar deducted. ${s.retirement.cafeteriaReductionsCovered ? `${s.retirement.name} counts the deduction as pay, so TRS contributions and pensions stay the same.` : ''}`
              : ` The district saves Social Security (where it is paid) and Medicare tax on every dollar deducted. ${s.retirement.cafeteriaReductionsCovered ? `${s.retirement.name} counts the deduction as pay, so TRS contributions and pensions stay the same.` : ''}`
            : ' The employer saves Social Security and Medicare tax on every dollar deducted.'}</p>
          <h3>Estimated impact</h3>
          <table style={{ maxWidth: 640 }}><tbody>
            <tr><td>Eligible employees (full plan / part-time plan)</td><td className="num">{s.eligibleFull} / {s.eligiblePartTime}</td></tr>
            <tr><td>Employer payroll tax savings per year</td><td className="num"><b>{money(s.employerAnnualSavings.total)}</b></td></tr>
            <tr><td>Employer savings per enrolled employee per year</td><td className="num">{money(s.employerAnnualSavings.perEmployee)}</td></tr>
            {!s.retirement && <tr><td>Valuation increase at {result.settings.ebitdaMultiple}x EBITDA</td><td className="num"><b>{money(s.valuationIncrease)}</b></td></tr>}
            <tr><td>Employee tax savings per year</td><td className="num">{money(s.employeeAnnualTaxSavings)}</td></tr>
          </tbody></table>
          <h3>Who qualifies</h3>
          <table style={{ maxWidth: 640 }}><tbody>{ORDER.filter((k) => s.byEligibility[k]).map((k) => <tr key={k}><td>{k}</td><td className="num">{s.byEligibility[k]}</td></tr>)}</tbody></table>
          <p className="muted small">These figures are estimates based on the payroll data provided and current federal, state and local tax rules. Actual results depend on each employee's elections, pay and withholding. Not tax or legal advice.</p>
        </div>
      )}
    </>
  );
}

/** Reviewer decision for one row: leave out, force a plan, change the deduction or hours. Recalculates right away. */
function OverrideEditor({ e, onChange, busy, partTime }: any) {
  const [o, setO] = useState<any>(e.override ?? {});
  useEffect(() => setO(e.override ?? {}), [e.key, e.override]);
  const changed = JSON.stringify(o) !== JSON.stringify(e.override ?? {});
  return (
    <div className="fg-callout" style={{ flexDirection: 'column', margin: '10px 0', maxWidth: '58rem' }}>
      <b>Reviewer decision</b>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label>Plan<select value={o.exclude ? 'exclude' : o.status ?? ''} onChange={(x) => setO(x.target.value === 'exclude' ? { ...o, exclude: true, status: undefined } : { ...o, exclude: undefined, status: x.target.value || undefined })}>
          <option value="">Follow the rules</option><option value="Eligible">Full plan (eligible)</option><option value="PT Eligible">Part-time plan ({money(partTime?.deductionPerCheck)}/check)</option><option value="Not Eligible">Not eligible</option><option value="exclude">Leave out of the proposal</option>
        </select></label>
        <label>Deduction per check ($)<input style={{ width: 130 }} type="number" step="0.01" value={o.deductionPerCheck ?? ''} placeholder={String(e.deductionPerCheck ?? e.perPeriod?.firstGen ?? '')} onChange={(x) => setO({ ...o, deductionPerCheck: x.target.value === '' ? undefined : Number(x.target.value) })} /></label>
        <label>Hours per period<input style={{ width: 110 }} type="number" value={o.hoursPerPeriod ?? ''} placeholder={String(e.row.hoursPerPeriod ?? '')} onChange={(x) => setO({ ...o, hoursPerPeriod: x.target.value === '' ? undefined : Number(x.target.value) })} /></label>
        <label style={{ flex: 1, minWidth: 200 }}>Note<input value={o.note ?? ''} onChange={(x) => setO({ ...o, note: x.target.value || undefined })} placeholder="Why (kept with the proposal)" /></label>
        <button className="small primary" disabled={!changed || busy} onClick={() => onChange(o)}>Apply and recalculate</button>
        {e.override && <button className="small" disabled={busy} onClick={() => onChange(undefined)}>Clear</button>}
      </div>
    </div>
  );
}

const REPORT_COLS: [string, string][] = [['state', 'State'], ['plan', 'Plan'], ['deduction', 'Deduction per check'], ['employeeSavings', 'Employee savings per month'], ['employerSavings', 'Employer savings per year']];

/** Edit what the client sees, preview it, and publish fresh links. */
function ClientPage({ id, dirty, repeats, reportSettings: rs, setReportSettings, onSave, canShare, editable, publicEmployer }: any) {
  const [preview, setPreview] = useState<any>();
  const [links, setLinks] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const loadLinks = () => id && api(`/proposals/${id}/reports`).then(setLinks);
  useEffect(() => { void loadLinks(); }, [id]);
  useEffect(() => {
    if (!id || !rs) return;
    const t = setTimeout(() => api(`/proposals/${id}/report-preview`, { json: { reportSettings: rs } }).then(setPreview).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [id, JSON.stringify(rs)]);
  if (!id) return <div className="panel"><h3>Client page</h3><p className="fg-note">Save the proposal first. The client page uses the saved numbers, so what you send matches what is in the queue.</p></div>;
  if (!rs) return <p className="muted">Loading…</p>;
  const set = (p: any) => setReportSettings({ ...rs, ...p });
  const publish = async () => {
    setErr(''); setMsg('');
    try {
      if (dirty) await onSave();
      const r = await api(`/proposals/${id}/reports`, { json: editable ? { reportSettings: rs } : {} });
      const url = `${location.origin}${r.url}`;
      void navigator.clipboard?.writeText(url)?.catch(() => {});
      setMsg(`Published a fresh link and copied it: ${url}`);
      void loadLinks();
    } catch (e: any) { setErr(e.message); }
  };
  const revoke = async (slug: string) => { if (!confirm('Turn this link off? Anyone who opens it will see that it is no longer active.')) return; await api(`/proposals/${id}/reports/${slug}`, { method: 'DELETE' }); void loadLinks(); };
  return (
    <div className="fg-cards" style={{ gridTemplateColumns: 'minmax(18rem, 26rem) minmax(0, 1fr)', alignItems: 'start' }}>
      <div>
        <div className="panel">
          <h3>Links</h3>
          <p className="fg-note">Each publish makes a fresh link with today's saved numbers. Links already sent keep their numbers until you turn them off.</p>
          {repeats > 0 && <div className="warn" style={{ marginBottom: 12 }}>{repeats} rows repeat an employee and are counted separately, so the client would see the same person more than once. Turn on "Count repeated employees once" under eligibility requirements before you publish.</div>}
          {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}
          {msg && <div className="fg-callout" style={{ marginBottom: 12, wordBreak: 'break-all' }}>{msg}</div>}
          {canShare && <button className="primary" style={{ width: '100%' }} onClick={publish}>{dirty ? 'Save and publish a fresh link' : 'Publish a fresh link'}</button>}
          <div className="fg-tablebox" style={{ marginTop: 12 }}><table><tbody>{links.map((l) => (
            <tr key={l.slug}>
              <td><a href={`/r/${l.slug}`} target="_blank" rel="noreferrer" className="small">/r/{l.slug}</a><div className="muted small">{new Date(l.created_at).toLocaleString()} · {l.created_by_name ?? ''} · {l.views} views</div></td>
              <td style={{ whiteSpace: 'nowrap' }}>{l.revoked_at ? <span className="badge b-bad">Off</span> : <>{' '}<button className="small" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/r/${l.slug}`)?.catch(() => {}); setMsg('Link copied.'); }}>Copy</button>{canShare && <> <button className="small" onClick={() => revoke(l.slug)}>Turn off</button></>}</>}</td>
            </tr>
          ))}{!links.length && <tr><td className="muted small">No links yet.</td></tr>}</tbody></table></div>
        </div>
        <div className="panel">
          <h3>What the client sees</h3>
          <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label>Title<input maxLength={200} value={rs.title ?? ''} placeholder={preview?.title} onChange={(e) => set({ title: e.target.value || undefined })} /></label>
            <label>Presented by<input maxLength={120} value={rs.presentedBy} onChange={(e) => set({ presentedBy: e.target.value })} /></label>
            <label>Subtitle<input maxLength={160} value={rs.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></label>
            <label>Opening note (optional)<textarea maxLength={2000} value={rs.intro} onChange={(e) => set({ intro: e.target.value })} placeholder="A sentence or two for this client" /></label>
            <label>Employee section<select value={rs.showEmployees} onChange={(e) => set({ showEmployees: e.target.value })}><option value="all">Everyone, with their status and the reason</option><option value="list">Eligible employees only</option><option value="counts">Counts by status only</option><option value="none">Leave out</option></select></label>
            {rs.showEmployees === 'all' && <p className="fg-note" style={{ margin: 0 }}>People who do not qualify are listed by name with the reason (pay, hours, W-4 details) and what would change it. Anyone with the link can read it.</p>}
            {(rs.showEmployees === 'list' || rs.showEmployees === 'all') && <div><div className="fg-label" style={{ marginBottom: 4 }}>Columns for eligible employees</div>{REPORT_COLS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={rs.employeeColumns.includes(k)} onChange={(e) => set({ employeeColumns: e.target.checked ? [...rs.employeeColumns, k] : rs.employeeColumns.filter((c: string) => c !== k) })} />{l}</label>)}</div>}
            <label className="check" title={publicEmployer ? 'A public employer has no EBITDA, so the client page leaves the valuation out' : undefined}><input type="checkbox" disabled={publicEmployer} checked={rs.showValuation && !publicEmployer} onChange={(e) => set({ showValuation: e.target.checked })} />Show the valuation increase{publicEmployer ? ' (not for public employers)' : ''}</label>
            <label className="check"><input type="checkbox" checked={rs.showCompanies} onChange={(e) => set({ showCompanies: e.target.checked })} />Break out each company (multi-company files)</label>
            <label className="check"><input type="checkbox" checked={rs.showSource} onChange={(e) => set({ showSource: e.target.checked })} />Show the name of the file the numbers came from</label>
            {rs.steps.map((st: any, i: number) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>Step {i + 1}<input maxLength={120} value={st.title} onChange={(e) => set({ steps: rs.steps.map((x: any, j: number) => (j === i ? { ...x, title: e.target.value } : x)) })} /></label>
                <textarea aria-label={`Step ${i + 1} text`} maxLength={600} style={{ minHeight: 64 }} value={st.text} onChange={(e) => set({ steps: rs.steps.map((x: any, j: number) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                <button type="button" className="fg-link small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ steps: rs.steps.filter((_: any, j: number) => j !== i) })}>Remove step {i + 1}</button>
              </div>
            ))}
            {rs.steps.length < 6 && <button type="button" className="small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ steps: [...rs.steps, { title: '', text: '' }] })}>Add a step</button>}
            <label>Next-steps heading<input maxLength={160} value={rs.ctaHeading} onChange={(e) => set({ ctaHeading: e.target.value })} /></label>
            <label>Next-steps text<input maxLength={600} value={rs.ctaText} onChange={(e) => set({ ctaText: e.target.value })} /></label>
            <label>Button label<input maxLength={80} value={rs.ctaLabel} onChange={(e) => set({ ctaLabel: e.target.value })} /></label>
            <label>Button link (paperwork URL; while this is blank the button goes nowhere)<input maxLength={500} value={rs.ctaUrl} onChange={(e) => set({ ctaUrl: e.target.value })} placeholder="https://" /></label>
            <label>Contact email<input maxLength={200} value={rs.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} /></label>
            <label>Address<input maxLength={300} value={rs.address} onChange={(e) => set({ address: e.target.value })} /></label>
            <label>Disclaimer<textarea maxLength={4000} value={rs.disclaimer} onChange={(e) => set({ disclaimer: e.target.value })} /></label>
          </fieldset>
        </div>
      </div>
      <div className="panel" style={{ position: 'sticky', top: 24 }}>
        <h3>Preview</h3>
        <p className="fg-note">How the published link will look, with the saved numbers{dirty ? ' (save to include your latest changes)' : ''}.</p>
        <div className="fg-preview-frame">{preview ? <ReportView r={preview} preview /> : <span className="muted">Loading…</span>}</div>
      </div>
    </div>
  );
}

/** Every save and recalculation, with the headline numbers, so you can go back to an earlier set of rules. */
function History({ id, onLoad, editable }: any) {
  const [rows, setRows] = useState<any[]>();
  useEffect(() => { api(`/proposals/${id}/revisions`).then(setRows); }, [id]);
  return (
    <div className="panel">
      <h3>Versions</h3>
      <p className="fg-note">Each save or recalculation is kept. Load an older version's rules to recalculate with them, then save if you want to keep it.</p>
      <div className="fg-tablebox tall"><table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th className="num">Eligible</th><th className="num">Employer savings / yr</th><th className="num">Valuation</th><th>Rules</th><th /></tr></thead>
        <tbody>{(rows ?? []).map((r) => (
          <tr key={r.id}>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString()}</td>
            <td>{r.user_name ?? '—'}</td>
            <td>{r.label}</td>
            <td className="num">{r.summary?.eligibleTotal ?? '—'}</td>
            <td className="num">{money(r.summary?.employerAnnualSavings?.total)}</td>
            <td className="num">{money(r.summary?.valuationIncrease)}</td>
            <td className="small muted">{money(r.settings.allotmentThreshold)} price · {money(r.settings.deductionPerCheck)}/check · {Math.round((r.settings.participationRate ?? 1) * 100)}% enroll · {Object.keys(r.settings.overrides ?? {}).length} overrides</td>
            <td>{editable && <button className="small" onClick={() => onLoad(r.settings)}>Load these rules</button>}</td>
          </tr>
        ))}
          {rows && !rows.length && <tr><td colSpan={8} className="muted">No versions yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
