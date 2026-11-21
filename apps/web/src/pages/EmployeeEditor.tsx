import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { LocalPicker, PageHead, StateSelect } from '../components';
import { DeductionRows, FederalW4Fields, StateW4Fields, WorkAllocations, TAX_TOGGLE_KINDS } from '../forms';

const blank = { firstName: '', lastName: '', employeeNumber: '', birthDate: '', hireDate: '', payType: 'hourly', payRate: 0, standardHours: 80, residenceState: 'NY', residenceLocals: [] as string[], residenceZip: '', unemploymentState: '', ssCovered: true, medicareCovered: true, federalW4: { version: '2020+', filingStatus: 'single' }, stateW4: {} as Record<string, any>, taxToggles: {} as Record<string, boolean>, work: [{ state: 'NY', localCodes: [], percent: 1 }] as any[], deductions: [] as any[] };

export default function EmployeeEditor() {
  const { id: clientIdParam, employeeId } = useParams();
  const nav = useNavigate();
  const [f, setF] = useState<any>(blank);
  const [clientId, setClientId] = useState(clientIdParam);
  const [locations, setLocations] = useState<any[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (employeeId) api(`/employees/${employeeId}`).then((e) => {
      setClientId(e.client_id);
      setF({ firstName: e.first_name, lastName: e.last_name, employeeNumber: e.employee_number ?? '', birthDate: e.birth_date?.slice(0, 10) ?? '', hireDate: e.hire_date?.slice(0, 10) ?? '', payType: e.pay_type, payRate: Number(e.pay_rate), standardHours: Number(e.standard_hours), residenceState: e.residence_state, residenceLocals: e.residence_locals, residenceZip: e.residence_zip ?? '', unemploymentState: e.unemployment_state ?? '', ssCovered: e.ss_covered, medicareCovered: e.medicare_covered, federalW4: e.federal_w4, stateW4: e.state_w4, taxToggles: e.tax_toggles,
        work: e.work.map((w: any) => ({ locationId: w.location_id ?? undefined, state: w.state, localCodes: w.local_codes, percent: Number(w.percent), remoteForConvenience: w.remote_for_convenience })),
        deductions: e.deductions.map((d: any) => ({ code: d.deduction_code, amount: d.amount != null ? Number(d.amount) : undefined, percent: d.percent != null ? Number(d.percent) : undefined, retirementSystem: d.retirement_system ?? undefined, garnishment: d.garnishment ?? undefined })) });
    });
  }, [employeeId]);
  useEffect(() => { if (clientId) api(`/clients/${clientId}`).then((c) => setLocations(c.locations)); }, [clientId]);
  const set = (p: any) => setF({ ...f, ...p });
  const states = [...new Set([f.residenceState, ...f.work.map((w: any) => w.state)])].filter(Boolean) as string[];
  const save = async () => {
    setErr('');
    const body = { ...f, birthDate: f.birthDate || undefined, hireDate: f.hireDate || undefined, unemploymentState: f.unemploymentState || undefined, residenceZip: f.residenceZip || undefined, employeeNumber: f.employeeNumber || undefined };
    try {
      if (employeeId) await api(`/employees/${employeeId}`, { method: 'PUT', json: body });
      else await api(`/clients/${clientId}/employees`, { json: body });
      nav(`/clients/${clientId}`);
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <>
      <PageHead eyebrow="Employee" title={employeeId ? `${f.firstName} ${f.lastName}` : 'New employee'}>Pay, residence, work locations, W-4s and deductions used for every paycheck this employee gets.</PageHead>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Employee</h3>
        <div className="row">
          <label>First name<input value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} /></label>
          <label>Last name<input value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} /></label>
          <label>Employee #<input value={f.employeeNumber} onChange={(e) => set({ employeeNumber: e.target.value })} /></label>
          <label>Birth date<input type="date" value={f.birthDate} onChange={(e) => set({ birthDate: e.target.value })} /></label>
          <label>Hire date<input type="date" value={f.hireDate} onChange={(e) => set({ hireDate: e.target.value })} /></label>
          <label>Pay type<select value={f.payType} onChange={(e) => set({ payType: e.target.value })}><option value="hourly">Hourly</option><option value="salary">Salary (per period)</option></select></label>
          <label>{f.payType === 'hourly' ? 'Hourly rate' : 'Salary per period'}<input type="number" value={f.payRate} onChange={(e) => set({ payRate: Number(e.target.value) })} /></label>
          {f.payType === 'hourly' && <label>Standard hours<input type="number" value={f.standardHours} onChange={(e) => set({ standardHours: Number(e.target.value) })} /></label>}
        </div>
      </div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Residence</h3>
        <div className="row">
          <label>State / territory<StateSelect value={f.residenceState} onChange={(v) => set({ residenceState: v, residenceLocals: [] })} /></label>
          <label style={{ minWidth: 320 }}>Resident locals (city, county, school district, PSD)<LocalPicker state={f.residenceState} value={f.residenceLocals} onChange={(v) => set({ residenceLocals: v })} /></label>
          <label>ZIP<input value={f.residenceZip} onChange={(e) => set({ residenceZip: e.target.value })} /></label>
        </div>
      </div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Work locations and wage allocation</h3>
        <WorkAllocations work={f.work} onChange={(w) => set({ work: w })} locations={locations} />
        <div className="row" style={{ marginTop: 8 }}><label>Unemployment (SUI) state override<StateSelect allowEmpty value={f.unemploymentState} onChange={(v) => set({ unemploymentState: v })} /></label></div>
      </div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Federal Form W-4</h3><FederalW4Fields w4={f.federalW4} onChange={(w) => set({ federalW4: w })} /></div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>State withholding certificates</h3>
        {states.map((s) => <StateW4Fields key={s} state={s} w4={f.stateW4[s] ?? {}} onChange={(w) => set({ stateW4: { ...f.stateW4, [s]: w } })} />)}
      </div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Recurring deductions, benefits and garnishments</h3><DeductionRows rows={f.deductions} onChange={(d) => set({ deductions: d })} /></div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Coverage and employee tax toggles</h3>
        <div className="row">
          <label className="check"><input type="checkbox" checked={f.ssCovered} onChange={(e) => set({ ssCovered: e.target.checked })} />Social Security covered (uncheck for non-Section 218 public employers, e.g. most Texas TRS districts)</label>
          <label className="check"><input type="checkbox" checked={f.medicareCovered} onChange={(e) => set({ medicareCovered: e.target.checked })} />Medicare covered</label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {states.flatMap((s) => TAX_TOGGLE_KINDS.filter((k) => !['FIT', 'SS_EE', 'MED_EE'].includes(k)).map((k) => `${s}.${k}`)).concat(['US.FIT']).map((k) => (
            <label key={k} className="check small"><input type="checkbox" checked={f.taxToggles[k] !== false} onChange={(e) => set({ taxToggles: { ...f.taxToggles, [k]: e.target.checked } })} />{k}</label>
          ))}
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      <button className="primary" disabled={!f.firstName || !f.lastName} onClick={save}>Save employee</button>
    </>
  );
}
