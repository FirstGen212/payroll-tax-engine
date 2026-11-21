import { LocalPicker, StateSelect, useReference } from './components';

export const num = (v: string) => (v === '' ? undefined : Number(v));

export function FederalW4Fields({ w4, onChange }: { w4: any; onChange: (w: any) => void }) {
  const set = (p: any) => onChange({ ...w4, ...p });
  const legacy = w4.version === 'pre2020';
  return (
    <div className="row">
      <label>Form version<select value={w4.version} onChange={(e) => set({ version: e.target.value })}><option value="2020+">2020 or later</option><option value="pre2020">2019 or earlier</option></select></label>
      <label>Filing status<select value={w4.filingStatus} onChange={(e) => set({ filingStatus: e.target.value })}>
        {legacy ? <><option value="single">Single</option><option value="mfj">Married</option><option value="mfs">Married, withhold at higher Single rate</option></>
          : <><option value="single">Single or Married filing separately</option><option value="mfj">Married filing jointly or Qualifying surviving spouse</option><option value="hoh">Head of household</option></>}
      </select></label>
      {legacy ? <label>Allowances<input type="number" value={w4.allowances ?? 0} onChange={(e) => set({ allowances: num(e.target.value) })} /></label> : <>
        <label className="check"><input type="checkbox" checked={!!w4.step2Checked} onChange={(e) => set({ step2Checked: e.target.checked })} />Step 2 checkbox</label>
        <label>Step 3 credits ($/yr)<input type="number" value={w4.dependentsAmount ?? ''} onChange={(e) => set({ dependentsAmount: num(e.target.value) })} /></label>
        <label>4(a) other income<input type="number" value={w4.otherIncome ?? ''} onChange={(e) => set({ otherIncome: num(e.target.value) })} /></label>
        <label>4(b) deductions<input type="number" value={w4.deductions ?? ''} onChange={(e) => set({ deductions: num(e.target.value) })} /></label>
      </>}
      <label>4(c) extra per check<input type="number" value={w4.extraWithholding ?? ''} onChange={(e) => set({ extraWithholding: num(e.target.value) })} /></label>
      <label className="check"><input type="checkbox" checked={!!w4.exempt} onChange={(e) => set({ exempt: e.target.checked })} />Exempt</label>
      <label className="check"><input type="checkbox" checked={!!w4.nonresidentAlien} onChange={(e) => set({ nonresidentAlien: e.target.checked })} />Nonresident alien</label>
    </div>
  );
}

export function StateW4Fields({ state, w4, onChange }: { state: string; w4: any; onChange: (w: any) => void }) {
  const set = (p: any) => onChange({ ...w4, ...p });
  return (
    <div className="row">
      <strong style={{ minWidth: 40 }}>{state}</strong>
      <label>Filing status<select value={w4.filingStatus ?? ''} onChange={(e) => set({ filingStatus: e.target.value || undefined })}><option value="">(from federal)</option><option value="single">Single</option><option value="mfj">Married</option><option value="mfs">Married filing separately</option><option value="hoh">Head of household</option></select></label>
      <label>Allowances / exemptions<input type="number" value={w4.allowances ?? ''} onChange={(e) => set({ allowances: num(e.target.value) })} /></label>
      <label>Dependents<input type="number" value={w4.dependents ?? ''} onChange={(e) => set({ dependents: num(e.target.value) })} /></label>
      <label>Additional allowances<input type="number" value={w4.additionalAllowances ?? ''} onChange={(e) => set({ additionalAllowances: num(e.target.value) })} /></label>
      <label>Extra per check<input type="number" value={w4.additional ?? ''} onChange={(e) => set({ additional: num(e.target.value) })} /></label>
      {state === 'AZ' && <label>A-4 elected %<select value={w4.electedPercent ?? 0.02} onChange={(e) => set({ electedPercent: Number(e.target.value) })}>{[0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035].map((p) => <option key={p} value={p}>{(p * 100).toFixed(1)}%</option>)}</select></label>}
      {state === 'NJ' && <label>NJ-W4 rate table<select value={w4.njTable ?? ''} onChange={(e) => set({ njTable: e.target.value || undefined })}><option value="">(by status)</option>{['A', 'B', 'C', 'D', 'E'].map((t) => <option key={t}>{t}</option>)}</select></label>}
      <label className="check"><input type="checkbox" checked={w4.reciprocityCertificate !== false} onChange={(e) => set({ reciprocityCertificate: e.target.checked })} />Reciprocity form filed (if applicable)</label>
      <label className="check"><input type="checkbox" checked={!!w4.exempt} onChange={(e) => set({ exempt: e.target.checked })} />Exempt</label>
    </div>
  );
}

export function WorkAllocations({ work, onChange, locations }: { work: any[]; onChange: (w: any[]) => void; locations?: any[] }) {
  const set = (i: number, p: any) => onChange(work.map((w, j) => (j === i ? { ...w, ...p } : w)));
  return (
    <div>
      {work.map((w, i) => (
        <div key={i} className="row" style={{ marginBottom: 8 }}>
          {locations?.length ? <label>Location<select value={w.locationId ?? ''} onChange={(e) => { const l = locations.find((x) => x.id === e.target.value); set(i, l ? { locationId: l.id, state: l.state, localCodes: l.local_codes } : { locationId: undefined }); }}><option value="">(custom)</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label> : null}
          <label>Work state<StateSelect value={w.state} onChange={(v) => set(i, { state: v, localCodes: [] })} /></label>
          <label style={{ minWidth: 300 }}>Work locals<LocalPicker state={w.state} value={w.localCodes ?? []} onChange={(v) => set(i, { localCodes: v })} /></label>
          <label>% of wages<input type="number" style={{ width: 80 }} value={Math.round(w.percent * 10000) / 100} onChange={(e) => set(i, { percent: Number(e.target.value) / 100 })} /></label>
          <label className="check"><input type="checkbox" checked={!!w.remoteForConvenience} onChange={(e) => set(i, { remoteForConvenience: e.target.checked })} />Remote for own convenience</label>
          <button className="small" onClick={() => onChange(work.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button className="small" onClick={() => onChange([...work, { state: work[0]?.state ?? 'NY', localCodes: [], percent: 0 }])}>Add work location</button>
    </div>
  );
}

export function DeductionRows({ rows, onChange }: { rows: any[]; onChange: (r: any[]) => void }) {
  const ref = useReference();
  const set = (i: number, p: any) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const types = ref?.deductionTypes ?? [];
  return (
    <div>
      {rows.map((d, i) => {
        const t = types.find((x: any) => x.code === d.code);
        return (
          <div key={i} className="row" style={{ marginBottom: 6 }}>
            <label>Deduction<select value={d.code} onChange={(e) => set(i, { code: e.target.value })}>{types.map((x: any) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
            <label>Amount<input type="number" style={{ width: 100 }} value={d.amount ?? ''} onChange={(e) => set(i, { amount: num(e.target.value) })} /></label>
            <label>or % of gross<input type="number" style={{ width: 80 }} value={d.percent != null ? d.percent * 100 : ''} onChange={(e) => set(i, { percent: e.target.value === '' ? undefined : Number(e.target.value) / 100 })} /></label>
            {t?.category === 'retirement_pickup' && <label>Retirement system<select value={d.retirementSystem ?? ''} onChange={(e) => set(i, { retirementSystem: e.target.value || undefined })}><option value="">-</option>{(ref?.retirementSystems ?? []).map((r: any) => <option key={r.code} value={r.code}>{r.name} ({(r.memberRate * 100).toFixed(2)}%)</option>)}</select></label>}
            {d.code === 'GARN_CHILD_SUPPORT' && <label className="check"><input type="checkbox" checked={!!d.garnishment?.arrearsOver12Weeks} onChange={(e) => set(i, { garnishment: { ...(d.garnishment ?? {}), arrearsOver12Weeks: e.target.checked } })} />Arrears over 12 weeks</label>}
            {d.code === 'GARN_FED_LEVY' && <label>Levy dependents<input type="number" style={{ width: 70 }} value={d.garnishment?.levyDependents ?? 0} onChange={(e) => set(i, { garnishment: { ...(d.garnishment ?? {}), levyDependents: Number(e.target.value) } })} /></label>}
            <span className="muted small">{t ? (Object.values(t.reducesWages).some(Boolean) ? 'pre-tax' : t.employerPaid ? 'employer-paid' : 'after-tax') : ''}</span>
            <button className="small" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button>
          </div>
        );
      })}
      <button className="small" onClick={() => onChange([...rows, { code: 'MED_125', amount: 0 }])}>Add deduction</button>
    </div>
  );
}

export function EarningRows({ rows, onChange }: { rows: any[]; onChange: (r: any[]) => void }) {
  const ref = useReference();
  const set = (i: number, p: any) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div>
      {rows.map((e, i) => (
        <div key={i} className="row" style={{ marginBottom: 6 }}>
          <label>Earning<select value={e.code} onChange={(ev) => set(i, { code: ev.target.value })}>{(ref?.earningTypes ?? []).map((x: any) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
          <label>Hours<input type="number" style={{ width: 80 }} value={e.hours ?? ''} onChange={(ev) => { const h = num(ev.target.value); set(i, { hours: h, amount: e.rate && h ? Math.round(e.rate * h * 100) / 100 : e.amount }); }} /></label>
          <label>Rate<input type="number" style={{ width: 90 }} value={e.rate ?? ''} onChange={(ev) => { const r = num(ev.target.value); set(i, { rate: r, amount: r && e.hours ? Math.round(r * e.hours * 100) / 100 : e.amount }); }} /></label>
          <label>Amount<input type="number" style={{ width: 110 }} value={e.amount ?? ''} onChange={(ev) => set(i, { amount: Number(ev.target.value) })} /></label>
          <button className="small" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button className="small" onClick={() => onChange([...rows, { code: 'BONUS', amount: 0 }])}>Add earning</button>
    </div>
  );
}

export const TAX_TOGGLE_KINDS = ['FIT', 'SS_EE', 'MED_EE', 'SIT', 'SDI_EE', 'FLI_EE', 'PFML_EE', 'LTC_EE', 'SUI_EE'];
