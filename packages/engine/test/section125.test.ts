import { describe, expect, it } from 'vitest';
import { DEDUCTION_TYPES, SECTION125_RULES, SOURCES, loadTaxDatabase, section125RuleOf } from '@pte/tax-data';
import { calculatePay, runProposal } from '../src/index.js';
import type { CensusRow, PayInput, PayResult } from '../src/index.js';

const db = loadTaxDatabase();
const pay = (state: string, opts: { res?: string[]; work?: string[]; ded?: { code: string; amount: number }[] } = {}): PayInput => ({
  checkDate: '2027-01-15',
  payFrequency: 'biweekly',
  employer: { id: 'c1', name: 'Test Client', homeState: state },
  employee: { id: 'e1', federalW4: { version: '2020+', filingStatus: 'single' }, residence: { state, localCodes: opts.res }, work: [{ state, percent: 1, localCodes: opts.work ?? opts.res }], stateW4: { [state]: {} } },
  earnings: [{ code: 'REG', amount: 3000 }],
  deductions: opts.ded,
});
const line = (r: PayResult, pred: (t: PayResult['taxes'][number]) => boolean) => r.taxes.find(pred);
/** Taxable wages of the first matching line, with and without a $200 proposed Section 125 deduction. */
const wagesBoth = (state: string, pred: (t: PayResult['taxes'][number]) => boolean, opts: { res?: string[]; work?: string[]; code?: string } = {}) => {
  const before = line(calculatePay(pay(state, opts), db), pred);
  const after = line(calculatePay(pay(state, { ...opts, ded: [{ code: opts.code ?? 'PROPOSED_125', amount: 200 }] }), db), pred);
  return { before: before?.taxableWages, after: after?.taxableWages, line: after };
};

describe('Section 125 audit table', () => {
  it('every row that is not unverified cites a source that exists', () => {
    const ids = new Set(SOURCES.map((s) => s.id));
    for (const r of SECTION125_RULES) {
      if (r.status !== 'unverified') expect(r.sources.length, r.tax).toBeGreaterThan(0);
      for (const s of r.sources) expect(ids.has(s), s).toBe(true);
    }
  });
  it('feeds the Section 125 deduction types', () => {
    const med = DEDUCTION_TYPES.find((d) => d.code === 'MED_125')!;
    expect(med.stateOverrides?.NJ?.SIT).toBe(false);
    expect(med.stateOverrides?.PA?.LOCAL).toBe(true);
    expect(med.stateOverrides?.['PA-PHILADELPHIA']?.LOCAL).toBe(false);
    expect(med.stateOverrides?.KY?.LOCAL).toBe(false);
    // An HSA keeps its own California and New Jersey rule on top of the table.
    const hsa = DEDUCTION_TYPES.find((d) => d.code === 'HSA_125')!;
    expect(hsa.stateOverrides?.CA?.SIT).toBe(false);
    expect(section125RuleOf('health', 'LOCAL', 'PA', 'PA-PHILADELPHIA')?.jurisdiction).toBe('PA-PHILADELPHIA');
    expect(section125RuleOf('health', 'LOCAL', 'OH', 'OH-COLUMBUS')?.jurisdiction).toBe('OH');
  });
});

describe('Section 125 in state and local taxes', () => {
  it('New Jersey income tax keeps the deduction in wages; federal income tax does not', () => {
    const nj = wagesBoth('NJ', (t) => t.kind === 'SIT' && t.jurisdiction === 'NJ');
    expect(nj.before).toBe(3000);
    expect(nj.after).toBe(3000);
    expect(nj.line!.explanation.join(' ')).toMatch(/does not lower/);
    const fit = wagesBoth('NJ', (t) => t.kind === 'FIT');
    expect(fit.after).toBe(fit.before! - 200);
  });
  it('New York income tax and New York City tax drop with the deduction', () => {
    expect(wagesBoth('NY', (t) => t.kind === 'SIT').after).toBe(2800);
    const nyc = wagesBoth('NY', (t) => t.jurisdiction === 'NY-NYC', { res: ['NY-NYC'] });
    expect(nyc.after).toBe(nyc.before! - 200);
  });
  it('Pennsylvania income tax and Act 32 local EIT drop; Philadelphia Wage Tax does not', () => {
    expect(wagesBoth('PA', (t) => t.kind === 'SIT').after).toBe(2800);
    const eit = wagesBoth('PA', (t) => t.kind === 'LIT_EE', { res: ['PA-PSD-700102'] });
    expect(eit.before).toBe(3000);
    expect(eit.after).toBe(2800);
    const phl = wagesBoth('PA', (t) => t.jurisdiction === 'PA-PHILADELPHIA', { res: ['PA-PHILADELPHIA'] });
    expect(phl.before).toBe(3000);
    expect(phl.after).toBe(3000);
  });
  it('Pennsylvania excludes dependent care FSA contributions since Act 34 of 2023', () => {
    expect(wagesBoth('PA', (t) => t.kind === 'SIT', { code: 'DCAP' }).after).toBe(2800);
  });
  it('Ohio city tax drops; Kentucky occupational tax does not', () => {
    const oh = wagesBoth('OH', (t) => t.jurisdiction === 'OH-COLUMBUS', { res: ['OH-COLUMBUS'] });
    expect(oh.after).toBe(oh.before! - 200);
    const ky = wagesBoth('KY', (t) => t.jurisdiction === 'KY-LOUISVILLE_METRO', { res: ['KY-LOUISVILLE_METRO'] });
    expect(ky.before).toBe(3000);
    expect(ky.after).toBe(3000);
  });
  it('Kansas City and St. Louis earnings taxes drop', () => {
    for (const c of ['MO-KANSAS_CITY', 'MO-ST_LOUIS']) {
      const x = wagesBoth('MO', (t) => t.jurisdiction === c, { res: [c] });
      expect(x.after, c).toBe(x.before! - 200);
    }
  });
  it('Massachusetts paid leave keeps the deduction in wages', () => {
    const ma = wagesBoth('MA', (t) => t.kind === 'PFML_EE' && t.jurisdiction === 'MA');
    expect(ma.before).toBe(3000);
    expect(ma.after).toBe(3000);
  });
  it('Oregon statewide transit tax drops with the deduction', () => {
    const or = wagesBoth('OR', (t) => t.kind === 'TRANSIT_EE');
    expect(or.after).toBe(2800);
  });
});

describe('Section 125 in proposals', () => {
  const row = (workState: string, localCodes?: string[]): CensusRow => ({ rowNumber: 2, employeeId: workState, firstName: 'Pat', lastName: 'Lee', workState, localCodes, grossPay: 1500, payFrequency: 'Weekly', hoursPerPeriod: 40, federalFilingStatus: 'Single' });
  const settings = { year: 2027, deductionByFrequency: { weekly: 200 }, useRowDeduction: false, allotmentThreshold: 100 };
  it('splits employee savings by tax, and the parts add up', () => {
    const r = runProposal([row('NY'), row('NJ'), row('TX'), row('PA', ['PA-PSD-700102'])], settings, db);
    for (const e of r.employees) {
      const by = e.monthly!.savingsBy;
      const total = by.federalIncome + by.fica + by.stateIncome + by.local + by.statePrograms;
      expect(total, e.workState).toBeCloseTo(e.monthly!.employeeTaxSavings, 1);
    }
    const [ny, nj, tx, pa] = r.employees;
    expect(ny.monthly!.savingsBy.stateIncome).toBeGreaterThan(0);
    expect(nj.monthly!.savingsBy.stateIncome).toBe(0);
    expect(tx.monthly!.savingsBy.stateIncome).toBe(0);
    // Pittsburgh EIT 3% of $200 a week
    expect(pa.monthly!.savingsBy.local).toBeCloseTo((200 * 0.03 * 52) / 12, 1);
    expect(r.summary.employeeAnnualTaxSavingsBy.stateIncome).toBeGreaterThan(0);
  });
  it('a New York employee saves more than the same pay in Texas because state tax drops too', () => {
    const r = runProposal([row('NY'), row('TX')], settings, db);
    expect(r.employees[0].monthly!.employeeTaxSavings).toBeGreaterThan(r.employees[1].monthly!.employeeTaxSavings);
  });
});
