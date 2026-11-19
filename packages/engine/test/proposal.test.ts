import { describe, expect, it } from 'vitest';
import { loadTaxDatabase } from '@pte/tax-data';
import { autoMapColumns, checkDatesFor, parseFederalStatus, parseFrequency, rowsFromSheet, runProposal } from '../src/index.js';
import type { CensusRow } from '../src/index.js';

const db = loadTaxDatabase();
const base: CensusRow = { rowNumber: 2, employeeId: '1', firstName: 'Pat', lastName: 'Lee', workState: 'TX', grossPay: 1000, payFrequency: 'Weekly', hoursPerPeriod: 40, federalFilingStatus: 'Single' };
const std = { year: 2027, deductionPerCheck: 200, useRowDeduction: false, allotmentThreshold: 100 };

describe('proposal tool', () => {
  it('weekly $1,000 TX single with a $200/check pre-tax deduction', () => {
    const r = runProposal([base], std, db);
    const e = r.employees[0];
    expect(e.eligibility).toBe('Eligible');
    // FICA 7.65% x 200 = 15.30 and FIT 12% x 200 = 24.00 per check; 52 checks / 12 months
    expect(e.monthly!.employeeTaxSavings).toBeCloseTo((39.3 * 52) / 12, 1);
    expect(e.monthly!.allotment).toBeCloseTo(((39.3 * 52) / 12) * 0.75, 1);
    // Employer FICA only: 7.65% x 200 x 52 / 12
    expect(e.monthly!.employerTaxSavings).toBeCloseTo((15.3 * 52) / 12, 1);
    // Per period, as the register shows it
    expect(e.perPeriod!.taxBefore - e.perPeriod!.taxAfter).toBeCloseTo(39.3, 2);
    expect(e.perPeriod!.net).toBeCloseTo(1000 - 200 - e.perPeriod!.taxAfter, 2);
    expect(r.summary.employerAnnualSavings.total).toBeCloseTo(15.3 * 52, 1);
    expect(r.summary.valuationIncrease).toBeCloseTo(15.3 * 52 * 5.2, 0);
  });

  it('applies the eligibility rules in the current tool\'s order', () => {
    const rows: CensusRow[] = [
      { ...base, employeeId: 'a', grossPay: 0 },
      { ...base, employeeId: 'b', grossPay: 150 }, // deduction exceeds pay
      { ...base, employeeId: 'c', grossPay: 480 }, // $24,960/yr
      { ...base, employeeId: 'd', hoursPerPeriod: 20 },
      { ...base, employeeId: 'e', federalTaxPaid: false },
      { ...base, employeeId: 'f', payFrequency: 'sometimes' },
      { ...base, employeeId: 'g', grossPay: 3000, workState: 'CA', proposedDeduction: 600 },
    ];
    const r = runProposal(rows, { ...std, useRowDeduction: true, partTime: { enabled: false } as any }, db);
    expect(r.employees.map((e) => e.eligibility)).toEqual([
      'Not Eligible - No Gross Compensation',
      'Not Eligible - Insufficient Funds',
      'Not Eligible - Low Income',
      'Not Eligible - Insufficient Hours',
      'Eligible',
      'NEEDS REVIEW',
      'NEEDS REVIEW',
    ]);
    expect(r.employees[4].flags[0]).toMatch(/No federal income tax/);
    expect(r.employees[6].reasons[0]).toMatch(/review threshold/);
    const strict = runProposal([rows[4]], { ...std, noFederalTaxAs: 'status' }, db);
    expect(strict.employees[0].eligibility).toBe('No Federal Taxes Paid');
  });

  it('savings below the allotment threshold are insufficient; the price analyzer counts each price point', () => {
    const r = runProposal([base], { ...std, allotmentThreshold: 149, partTime: { enabled: false } as any }, db);
    expect(r.employees[0].monthly!.allotment).toBeLessThan(149);
    expect(r.employees[0].eligibility).toBe('Not Eligible - Insufficient Savings');
    const at = (p: number) => r.summary.programs.find((x) => x.price === p)!.eligible;
    expect(at(159)).toBe(0);
    expect(at(129)).toBe(0);
    const lower = runProposal([base], { ...std, programPrices: [129, 99] }, db);
    expect(lower.summary.programs.find((x) => x.price === 99)!.eligible).toBe(1);
  });

  it('moves part-time triggers to the part-time plan', () => {
    const r = runProposal([{ ...base, hoursPerPeriod: 20 }], { ...std, partTime: { enabled: true, deductionPerCheck: 120, allotmentThreshold: 50, maxHoursPerWeek: 29, maxAnnualGross: 20000 } }, db);
    const e = r.employees[0];
    expect(e.standardEligibility).toBe('Not Eligible - Insufficient Hours');
    expect(e.eligibility).toBe('PT Eligible');
    expect(e.partTime!.triggers).toEqual(['≤29hrs']);
    expect(e.partTime!.allotment).toBeCloseTo(((120 * 0.0765 + 120 * 0.12) * 52 / 12) * 0.75, 0);
    expect(r.summary.eligiblePartTime).toBe(1);
  });

  it('flags repeated employees and can count them once', () => {
    const rows = [base, { ...base, rowNumber: 3 }];
    expect(runProposal(rows, std, db).employees).toHaveLength(2);
    const r = runProposal(rows, { ...std, dedupe: true }, db);
    expect(r.employees).toHaveLength(1);
    expect(r.summary.duplicates).toEqual([{ rowNumber: 3, duplicateOf: 2, name: 'Pat Lee' }]);
  });

  it('maps the underwriting sheet headers and values', () => {
    const headers = ['Company Name', 'EMP ID', 'Employee First Name', 'Employee Last Name', 'Work State', 'Gross Pay per Pay Period (or yearly)', 'Pay Frequency', '#', 'Average Hour per Pay Period', 'Federal - W-4 Marital Status', 'Federal Tax before', 'Group Health Monthly - Employee Contribution', ' Pre-Tax Monthly Deduction - 401-k / IRA $ Amount', 'First Gen Deduction Amount'];
    const m = autoMapColumns(headers);
    expect(m).toMatchObject({ company: 'Company Name', employeeId: 'EMP ID', workState: 'Work State', grossPay: 'Gross Pay per Pay Period (or yearly)', periodsPerYear: '#', hoursPerPeriod: 'Average Hour per Pay Period', federalFilingStatus: 'Federal - W-4 Marital Status', federalTaxPaid: 'Federal Tax before', healthMonthly: 'Group Health Monthly - Employee Contribution', retirementMonthly: ' Pre-Tax Monthly Deduction - 401-k / IRA $ Amount', proposedDeduction: 'First Gen Deduction Amount' });
    const [row] = rowsFromSheet([{ 'Gross Pay per Pay Period (or yearly)': '$1,098.00', 'Federal Tax before': true, 'Work State': 'FL', 'EMP ID': '13' }], m);
    expect(row).toMatchObject({ grossPay: 1098, federalTaxPaid: true, workState: 'FL', employeeId: '13' });
  });

  it('parses statuses, frequencies and schedules', () => {
    expect(parseFederalStatus('Single or Married filing separately')).toBe('mfs');
    expect(parseFederalStatus('Married filing jointly or Qualifying widow(er)')).toBe('mfj');
    expect(parseFederalStatus('Head of Household')).toBe('hoh');
    expect(parseFrequency('Bi-Weekly')).toBe('biweekly');
    expect(parseFrequency(undefined, 24)).toBe('semimonthly');
    expect(checkDatesFor(2027, 'weekly')).toHaveLength(52);
    expect(checkDatesFor(2027, 'biweekly')).toHaveLength(26);
    expect(checkDatesFor(2027, 'semimonthly')).toHaveLength(24);
  });
});
