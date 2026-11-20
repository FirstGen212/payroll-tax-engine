import { useState } from 'react';
import { api } from '../api';
import { LocalPicker, PageHead, PayStub, StateSelect, useReference } from '../components';
import { DeductionRows, EarningRows, FederalW4Fields, StateW4Fields, WorkAllocations } from '../forms';

/** Stateless paycheck calculator for proposals and what-ifs; no client setup needed. */
export default function Calculator() {
  const ref = useReference();
  const [f, setF] = useState<any>({ checkDate: '2027-01-15', payFrequency: 'biweekly', vendor: '', residence: { state: 'NY', localCodes: [] }, work: [{ state: 'NY', localCodes: [], percent: 1 }], federalW4: { version: '2020+', filingStatus: 'single' }, stateW4: {}, earnings: [{ code: 'REG', hours: 80, rate: 25, amount: 2000 }], deductions: [], ssCovered: true, homeState: 'NY', suiRate: '' });
  const [r, setR] = useState<any>();
  const [compare, setCompare] = useState<any>();
  const [err, setErr] = useState('');
  const set = (p: any) => setF({ ...f, ...p });
  const states = [...new Set([f.residence.state, ...f.work.map((w: any) => w.state)])] as string[];
  const input = (deductions = f.deductions) => ({
    checkDate: f.checkDate, payFrequency: f.payFrequency, runType: 'proposal', vendorProfileId: f.vendor || undefined,
    conventions: ref?.vendors.find((v: any) => v.id === f.vendor)?.conventions,
    employer: { id: 'calc', name: 'Calculator', homeState: f.homeState, suiRates: f.suiRate ? { [f.work[0].state]: Number(f.suiRate) / 100 } : {} },
    employee: { id: 'calc', residence: f.residence, work: f.work, federalW4: f.federalW4, stateW4: f.stateW4, socialSecurityCovered: f.ssCovered },
    earnings: f.earnings, deductions,
  });
  const calc = async () => { setErr(''); try { setR(await api('/calculate', { json: input() })); setCompare(undefined); } catch (e: any) { setErr(e.message); } };
  const compare125 = async () => {
    const pretax = f.deductions.filter((d: any) => ref.deductionTypes.find((t: any) => t.code === d.code)?.category === 'section125_health');
    if (!pretax.length) { setErr('Add at least one Section 125 deduction to compare against paying it after tax.'); return; }
    const post = f.deductions.map((d: any) => (pretax.includes(d) ? { ...d, code: 'OTHER_POST' } : d));
    setCompare(await api('/scenarios/compare', { json: { base: [input(post)], variant: [input()] } }));
  };
  return (
    <>
      <PageHead eyebrow="Tools" title="Paycheck calculator">Run one check for any state and local mix, and see what a Section 125 deduction saves the employee and the employer.</PageHead>
      <div className="panel"><div className="row">
        <label>Check date<input type="date" value={f.checkDate} onChange={(e) => set({ checkDate: e.target.value })} /></label>
        <label>Frequency<select value={f.payFrequency} onChange={(e) => set({ payFrequency: e.target.value })}>{['weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual', 'daily'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Calculate like<select value={f.vendor} onChange={(e) => set({ vendor: e.target.value })}><option value="">By the book (IRS)</option>{(ref?.vendors ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label>Employer home state<StateSelect value={f.homeState} onChange={(v) => set({ homeState: v })} /></label>
        <label>Employer SUI rate %<input style={{ width: 90 }} value={f.suiRate} onChange={(e) => set({ suiRate: e.target.value })} placeholder="new-employer" /></label>
      </div></div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Residence</h3><div className="row">
        <label>State<StateSelect value={f.residence.state} onChange={(v) => set({ residence: { state: v, localCodes: [] } })} /></label>
        <label style={{ minWidth: 320 }}>Locals<LocalPicker state={f.residence.state} value={f.residence.localCodes} onChange={(v) => set({ residence: { ...f.residence, localCodes: v } })} /></label>
        <label className="check"><input type="checkbox" checked={f.ssCovered} onChange={(e) => set({ ssCovered: e.target.checked })} />Social Security covered</label>
      </div></div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Work</h3><WorkAllocations work={f.work} onChange={(w) => set({ work: w })} /></div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Federal W-4</h3><FederalW4Fields w4={f.federalW4} onChange={(w) => set({ federalW4: w })} />
        <h3>State certificates</h3>{states.map((s) => <StateW4Fields key={s} state={s} w4={f.stateW4[s] ?? {}} onChange={(w) => set({ stateW4: { ...f.stateW4, [s]: w } })} />)}</div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Earnings</h3><EarningRows rows={f.earnings} onChange={(e) => set({ earnings: e })} />
        <h3>Deductions</h3><DeductionRows rows={f.deductions} onChange={(d) => set({ deductions: d })} /></div>
      {err && <div className="err">{err}</div>}
      <div className="row"><button className="primary" onClick={calc}>Calculate</button><button onClick={compare125}>Compare: Section 125 pre-tax vs. after-tax</button></div>
      {compare && <div className="panel"><h3 style={{ marginTop: 0 }}>Section 125 savings (per check)</h3>
        <div className="kpis"><div className="kpi"><div className="l">Employer tax savings</div><div className="v">${compare.employerTaxSavings.toFixed(2)}</div></div><div className="kpi"><div className="l">Employee tax savings</div><div className="v">${compare.employeeTaxSavings.toFixed(2)}</div></div><div className="kpi"><div className="l">Net pay change</div><div className="v">${compare.netPayChange.toFixed(2)}</div></div></div>
        <table><tbody>{Object.entries(compare.byTaxDelta).filter(([, v]: any) => v !== 0).map(([k, v]: any) => <tr key={k}><td>{k}</td><td className="num">${v.toFixed(2)}</td></tr>)}</tbody></table></div>}
      {r && <PayStub r={r} title="Result" />}
    </>
  );
}
