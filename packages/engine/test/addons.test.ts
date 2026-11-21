import { describe, expect, it } from 'vitest';
import { loadTaxDatabase } from '@pte/tax-data';
import { DEFAULT_PROPOSAL_SETTINGS, runProposal } from '../src/index.js';
import type { CensusRow } from '../src/index.js';

const db = loadTaxDatabase();
const base: CensusRow = { rowNumber: 2, employeeId: '1', firstName: 'Pat', lastName: 'Lee', workState: 'NY', grossPay: 2000, payFrequency: 'Biweekly', hoursPerPeriod: 80, federalFilingStatus: 'Single' };
const rows: CensusRow[] = [base, { ...base, rowNumber: 3, employeeId: '2', grossPay: 2600 }, { ...base, rowNumber: 4, employeeId: '3', grossPay: 300 }];

describe('voluntary benefit add-ons', () => {
  it('dental $30 and vision $20 are offered, off by default', () => {
    expect(DEFAULT_PROPOSAL_SETTINGS.voluntaryBenefits).toEqual([
      { id: 'dental', name: 'Dental', monthlyCost: 30, selected: false },
      { id: 'vision', name: 'Vision', monthlyCost: 20, selected: false },
    ]);
  });

  it('with none chosen, each enrolled employee shows their savings left after the plan price as the surplus', () => {
    const r = runProposal(rows, { year: 2027 }, db);
    const [a, b, c] = r.employees;
    expect(a.eligibility).toBe('Eligible');
    expect(a.voluntary).toEqual({ price: 159, addOns: [], addOnCost: 0, surplus: Math.round((a.monthly!.allotment - 159) * 100) / 100 });
    expect(c.voluntary).toBeUndefined(); // not on a plan
    expect(r.summary.voluntary.surplusMonthly).toBeCloseTo(a.voluntary!.surplus + b.voluntary!.surplus, 2);
    expect(r.summary.voluntary.addOns).toEqual([]);
  });

  it('chosen add-ons come out of the surplus, and a shortfall is flagged', () => {
    const vb = DEFAULT_PROPOSAL_SETTINGS.voluntaryBenefits.map((v) => ({ ...v, selected: true }));
    const r = runProposal(rows, { year: 2027, voluntaryBenefits: vb }, db);
    const a = r.employees[0];
    expect(a.voluntary!.addOnCost).toBe(50);
    expect(a.voluntary!.surplus).toBeCloseTo(a.monthly!.allotment - 159 - 50, 2);
    // Price set just under the allotment: the add-ons do not fit.
    const tight = runProposal([base], { year: 2027, voluntaryBenefits: vb, allotmentThreshold: Math.floor(a.monthly!.allotment) - 10 }, db);
    expect(tight.employees[0].voluntary!.surplus).toBeLessThan(0);
    expect(tight.employees[0].flags.join(' ')).toMatch(/dental and vision add-ons \(\$50\.00 a month\) cost more/);
    expect(tight.summary.voluntary.shortfalls).toBe(1);
  });

  it('uses the tier price in tier pricing', () => {
    const r = runProposal([base], { year: 2027, pricingMode: 'tiers' }, db);
    const e = r.employees[0];
    expect(e.voluntary!.price).toBe(e.tier!.monthlyPrice);
  });
});

describe('employer admin fee', () => {
  it('has no default: no fee, net savings equal the savings', () => {
    const r = runProposal(rows, { year: 2027 }, db);
    expect(r.summary.adminFee).toEqual({ amount: 0, per: 'employee-month', annual: 0 });
    expect(r.summary.employerNetAnnualSavings).toBe(r.summary.employerAnnualSavings.total);
  });

  it('per enrolled employee: savings, then the fee, then what the employer keeps, which the valuation uses', () => {
    const r = runProposal(rows, { year: 2027, adminFee: { amount: 12.5, per: 'employee-month' } }, db);
    const n = r.summary.eligibleTotal;
    expect(r.summary.adminFee.annual).toBeCloseTo(12.5 * 12 * n, 2);
    expect(r.summary.employerNetAnnualSavings).toBeCloseTo(r.summary.employerAnnualSavings.total - 12.5 * 12 * n, 2);
    expect(r.summary.valuationIncrease).toBeCloseTo(r.summary.employerNetAnnualSavings * r.settings.ebitdaMultiple, 1);
    // At 50% participation the per-employee fee covers half the people.
    const half = runProposal(rows, { year: 2027, participationRate: 0.5, adminFee: { amount: 12.5, per: 'employee-month' } }, db);
    expect(half.summary.adminFee.annual).toBeCloseTo(12.5 * 12 * n * 0.5, 2);
  });

  it('as one amount a month', () => {
    const r = runProposal(rows, { year: 2027, adminFee: { amount: 250, per: 'month' } }, db);
    expect(r.summary.adminFee.annual).toBe(3000);
  });
});
