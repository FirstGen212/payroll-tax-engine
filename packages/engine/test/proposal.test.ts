import { describe, expect, it } from 'vitest';
import { loadTaxDatabase } from '@pte/tax-data';
import { autoMapColumns, checkDatesFor, parseFederalStatus, parseFrequency, rowsFromSheet, runProposal } from '../src/index.js';
import type { CensusRow } from '../src/index.js';

const db = loadTaxDatabase();
const tier = { id: 'ft', name: 'Full-time', minHoursPerWeek: 30, deductionAmount: 200, deductionPer: 'check' as const, benefitOffsetPercent: 1, employerFeeMonthly: 0, employeeFeeMonthly: 0 };
const base: CensusRow = { rowNumber: 2, employeeId: '1', firstName: 'Pat', lastName: 'Lee', workState: 'TX', grossPay: 1000, payFrequency: 'Weekly', hoursPerPeriod: 40, federalFilingStatus: 'Single' };

describe('proposal tool', () => {
  it('weekly $1,000 TX single, $200/check pre-tax with 100% benefit payment back', () => {
    const r = runProposal([base], { year: 2027, tiers: [tier], useRowDeduction: false }, db);
    const e = r.employees[0];
    expect(e.eligibility).toBe('Eligible');
    // FICA 7.65% x 200 = 15.30 and FIT 12% x 200 = 24.00 per check; 52 checks / 12 months
    expect(e.monthly!.employeeTaxSavings).toBeCloseTo((39.3 * 52) / 12, 1);
    expect(e.monthly!.employeeNetGain).toBeCloseTo((39.3 * 52) / 12, 1);
    // Employer: FICA only. FUTA ($7,000) and TX SUI ($9,000) wage bases are reached either way over a full year.
    expect(e.monthly!.employerTaxSavings).toBeCloseTo((15.3 * 52) / 12, 1);
    expect(e.check!.after.fica).toBeCloseTo(e.check!.before.fica - 15.3, 2);
  });

  it('applies the eligibility rules in order', () => {
    const rows: CensusRow[] = [
      { ...base, employeeId: 'a', grossPay: 0 },
      { ...base, employeeId: 'b', grossPay: 400 }, // $20,800/yr: low income
      { ...base, employeeId: 'c', hoursPerPeriod: 20 }, // below the 30-hour tier
      { ...base, employeeId: 'd', federalTaxPaid: false },
      { ...base, employeeId: 'e', grossPay: 150 }, // deduction exceeds pay
      { ...base, employeeId: 'f', payFrequency: 'sometimes' },
    ];
    const r = runProposal(rows, { tiers: [tier], useRowDeduction: false }, db);
    expect(r.employees.map((e) => e.eligibility)).toEqual([
      'Not Eligible - No Gross Compensation',
      'Not Eligible - Low Income',
      'Not Eligible - Insufficient Hours',
      'No Federal Taxes Paid',
      'Not Eligible - Insufficient Savings',
      'NEEDS REVIEW',
    ]);
  });

  it('employer and employee fees move people from eligible to not eligible', () => {
    const priced = { ...tier, employeeFeeMonthly: 200 };
    const r = runProposal([base], { tiers: [priced], useRowDeduction: false }, db);
    expect(r.employees[0].eligibleBeforePricing).toBe(true);
    expect(r.employees[0].eligibility).toBe('Not Eligible - Insufficient Savings');
    expect(r.summary.eligibleAfterPricing).toBe(0);
  });

  it('counts a repeated employee once', () => {
    const r = runProposal([base, { ...base, rowNumber: 3 }], { tiers: [tier] }, db);
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
