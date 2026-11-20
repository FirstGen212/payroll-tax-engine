import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, money } from '../api';
import { PageHead, StateSelect, useReference } from '../components';

const FIELD_LABELS: Record<string, string> = {
  company: 'Company Name', employeeId: 'Employee ID', firstName: 'First Name', lastName: 'Last Name', workState: 'Work State', residenceState: 'Residence State',
  municipality: 'Municipality', grossPay: 'Gross Pay (per period or yearly)', otherComp: 'Commission / Bonus / Other', payFrequency: 'Pay Frequency', periodsPerYear: '# Periods',
  employmentType: 'Employment Type', hoursPerPeriod: 'Avg Hours per Period', hourlyRate: 'Hourly Rate', federalFilingStatus: 'Federal W-4 Status',
  dependentAllowances: 'Dependent Allowances (pre-2020 W-4)', dependentCredits: 'Dependent Credits (W-4 Step 3, $/yr)', additionalFit: 'Additional FITWH',
  federalTaxPaid: 'Federal Tax Before (yes/no)', stateTaxPaid: 'State Tax Before (yes/no)', stateFilingStatus: 'State Filing Status', stateDependents: 'State Dependents',
  additionalSit: 'Additional SITWH', healthMonthly: 'Group Health / month (pre-tax)', otherPretaxMonthly: 'Other Pre-Tax / month', retirementMonthly: '401(k) / IRA $ / month',
  retirementPercent: '401(k) %', postTaxMonthly: 'Post-Tax / month', proposedDeduction: 'First Gen Deduction Amount', tips: 'Tips', pto: 'PTO',
  reimbursements: 'Reimbursements', confidence: 'Confidence', birthDate: 'Birth Date',
};
const REQUIRED = ['grossPay', 'payFrequency', 'workState', 'federalFilingStatus'];
const ORDER = ['Eligible', 'PT Eligible', 'No Federal Taxes Paid', 'NEEDS REVIEW', 'Not Eligible - Insufficient Savings', 'Not Eligible - Insufficient Savings + No Federal Taxes Paid', 'Not Eligible - Low Income', 'Not Eligible - Insufficient Hours', 'Not Eligible - Insufficient Funds', 'Not Eligible - No Gross Compensation'];
const SHORT = (e: string) => e.replace('Not Eligible - ', '');
const ELIG_CLASS = (e: string) => (e === 'Eligible' || e === 'PT Eligible' ? 'b-ok' : e === 'NEEDS REVIEW' || e === 'No Federal Taxes Paid' ? 'b-warn' : 'b-bad');
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

  useEffect(() => {
    api('/proposals/defaults').then((d) => {
      setDefaults(d);
      if (!id) { setSettings(structuredClone(d.settings)); return; }
      api(`/proposals/${id}`).then((p) => {
        setMeta({ name: p.name, clientId: p.client_id ?? '', status: p.status, company: p.company });
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

  const body = (s = settings) => ({ headers, rows, mapping, settings: s, name: meta.name || 'Proposal', clientId: meta.clientId || null, company: meta.company ?? null, fileName: file?.fileName ?? null, sheetName, status: meta.status });
  const calculate = async (s = settings) => {
    setErr(''); setBusy(`Calculating ${rows.length} rows: a full year of checks for each, with and without the deduction…`);
    try { setResult(await api('/proposals/calculate', { json: body(s) })); } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
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
  const pickProgram = (price: number) => {
    const s = { ...settings, allotmentThreshold: price };
    setSettings(s);
    calculate(s);
  };
  const pickClient = (cid: string) => {
    const c = clients.find((x) => x.id === cid);
    setMeta({ ...meta, clientId: cid, name: meta.name || (c ? `${c.name} proposal` : '') });
    if (c) setSettings({ ...settings, employer: { ...settings.employer, name: c.name, homeState: c.home_state ?? undefined, futaExempt: c.futa_exempt }, vendorProfileId: c.current_vendor ?? settings.vendorProfileId });
  };

  if (!defaults || !settings) return <p className="muted">Loading…</p>;
  const setS = (p: any) => setSettings({ ...settings, ...p });
  const setPT = (p: any) => setS({ partTime: { ...settings.partTime, ...p } });
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const missing = REQUIRED.filter((f) => !mapping[f]);
  const step = result ? 3 : rows.length ? 2 : 1;
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <>
      <div className="noprint">
        <PageHead eyebrow={<><Link to="/proposals">Proposal tool</Link> / {id ? 'Proposal' : 'New proposal'}</>} title={meta.company ?? (meta.name || 'New proposal')}>
          {result
            ? <><b>{result.summary.eligibleTotal}</b> of <b>{result.summary.employees}</b> employees qualify, for <b>{money(result.summary.monthlySavings.total)}</b> a month in allotments and a <b>{money(result.summary.valuationIncrease)}</b> valuation increase.</>
            : rows.length ? <>Read <b>{rows.length}</b> rows. Check the column mapping, then calculate.</> : 'Upload a census, underwriting sheet or payroll register to compare every employee\'s taxes before and after the First Gen deduction.'}
        </PageHead>
      </div>
      <div className="stepper noprint">{['Import', 'Map', 'Results'].map((l, i) => <span key={l} className={step > i + 1 ? 'done' : step === i + 1 ? 'on' : ''}><b>{step > i + 1 ? '✓' : i + 1}</b>{l}</span>)}</div>
      {err && <div className="err" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="panel noprint">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}><h3 style={{ margin: 0 }}>Import source</h3>{file?.fileName && <span className="muted small">{file.fileName}{sheetName ? ` · ${sheetName}` : ''}</span>}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <label>Census, underwriting sheet or payroll register (.xlsx or .csv)<input type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => upload(e.target.files?.[0])} /></label>
          <label style={{ minWidth: 260 }}>Proposal name<input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></label>
          <label>Client (optional)<select value={meta.clientId} onChange={(e) => pickClient(e.target.value)}><option value="">Prospect (not a client yet)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Status<select value={meta.status} onChange={(e) => setMeta({ ...meta, status: e.target.value })}>{['draft', 'sent', 'won', 'lost'].map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
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
              <label>Employees with no federal tax withheld<select value={settings.noFederalTaxAs} onChange={(e) => setS({ noFederalTaxAs: e.target.value })}><option value="warning">Warning only (still eligible)</option><option value="status">Own status: No Federal Taxes Paid</option></select></label>
              <label>Employer savings<select value={settings.employerSavingsBasis} onChange={(e) => setS({ employerSavingsBasis: e.target.value })}><option value="fica">Social Security + Medicare (7.65%)</option><option value="all">All employer taxes (adds FUTA, SUI, etc.)</option></select></label>
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

      {result && (
        <Results result={result} settings={settings} setS={setS} view={view} setView={setView} meta={meta} busy={busy}
          onSave={save} onDownload={download} onPickProgram={pickProgram} saveLabel={id ? 'Save changes' : 'Save proposal'} />
      )}
    </>
  );
}

function Results({ result, settings, setS, view, setView, meta, busy, onSave, onDownload, onPickProgram, saveLabel }: any) {
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
  const pageRows = shown.slice(page * 25, page * 25 + 25);
  const pages = Math.max(1, Math.ceil(shown.length / 25));
  const tot = (f: (e: any) => number | undefined) => shown.reduce((a: number, e: any) => a + (f(e) ?? 0), 0);
  const pt = result.employees.filter((e: any) => e.partTime?.eligible);
  const best = s.programs.reduce((a: any, p: any) => (!a || p.annualMargin > a.annualMargin ? p : a), undefined);
  const dist = s.allotmentDistribution;
  const distTotal = dist.below + dist.near + dist.atOrAbove || 1;
  const csv = () => {
    const lines = [['Row', ...cols.map((c) => c[1]), 'PT allotment', 'Reason', 'Flags'].join(','), ...shown.map((e: any) => [e.row.rowNumber, ...cols.map((c) => c[2](e) ?? ''), e.partTime?.allotment ?? '', e.reasons.join(' '), e.flags.join(' ')].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: `${meta.name || 'proposal'} results.csv` }).click();
  };

  return (
    <>
      <div className="panel noprint">
        <div className="row" style={{ alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Results</h3><span className="badge b-neutral">{s.rowsInFile} rows processed</span>
          <button className="small" onClick={csv}>CSV</button>
          <button className="small primary" onClick={onDownload}>Underwriting workbook</button>
          <button className="small" onClick={() => setView(view === 'proposal' ? 'results' : 'proposal')}>{view === 'proposal' ? 'Back to results' : 'Proposal'}</button>
          <button className="small" onClick={onSave}>{saveLabel}</button>
          <button className="small" disabled title="Next step: connect the app to Pipedrive">Send to Pipedrive</button>
          {busy && <span className="muted small">{busy}</span>}
        </div>
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <label>EBITDA industry<input value={settings.industry ?? ''} onChange={(e) => setS({ industry: e.target.value })} /></label>
          <div className="seg">{['private', 'public'].map((o) => <button key={o} className={settings.ownership === o ? 'on' : ''} onClick={() => setS({ ownership: o })}>{o[0].toUpperCase() + o.slice(1)}</button>)}</div>
          <label>Multiple (x)<input style={{ width: 80 }} type="number" step="0.1" value={settings.ebitdaMultiple} onChange={(e) => setS({ ebitdaMultiple: Number(e.target.value) })} /></label>
          <label>Savings / employee<input style={{ width: 120 }} readOnly value={money(s.employerAnnualSavings.perEmployee)} /></label>
          {settings.ebitdaMultiple !== result.settings.ebitdaMultiple && <span className="muted small">Recalculate to apply the new multiple.</span>}
        </div>
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
            <div className="kpi"><div className="l">Valuation increase</div><div className="v">{money(s.valuationIncrease)}</div>
              <div className="s"><b>{money(s.employerAnnualSavings.total)}</b> employer savings a year × {result.settings.ebitdaMultiple}x EBITDA</div></div>
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
            {[['Employees reviewed', s.employees], ['Eligible employees', `${s.eligibleTotal}`], ['Estimated employer savings per year', money(s.employerAnnualSavings.total)], ['Estimated valuation increase', money(s.valuationIncrease)]].map(([l, v]) => <div key={l} className="kpi"><div className="l">{l}</div><div className="v">{v}</div></div>)}
          </div>
          <h3>How it works</h3>
          <p>Eligible employees enroll in a pre-tax benefit through the company's Section 125 plan, with a {s.benefitPackage?.name} preventative care package. Because the deduction comes out before taxes, both the employee's and the employer's payroll taxes go down. The employer saves Social Security and Medicare tax on every dollar deducted.</p>
          <h3>Estimated impact</h3>
          <table style={{ maxWidth: 640 }}><tbody>
            <tr><td>Eligible employees (full plan / part-time plan)</td><td className="num">{s.eligibleFull} / {s.eligiblePartTime}</td></tr>
            <tr><td>Employer payroll tax savings per year</td><td className="num"><b>{money(s.employerAnnualSavings.total)}</b></td></tr>
            <tr><td>Employer savings per enrolled employee per year</td><td className="num">{money(s.employerAnnualSavings.perEmployee)}</td></tr>
            <tr><td>Valuation increase at {result.settings.ebitdaMultiple}x EBITDA</td><td className="num"><b>{money(s.valuationIncrease)}</b></td></tr>
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
