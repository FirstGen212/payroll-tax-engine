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

  it('reviewer overrides: exclude, force status, deduction and hours', () => {
    const rows: CensusRow[] = [
      { ...base, employeeId: 'x' },
      { ...base, employeeId: 'y', hoursPerPeriod: 10 },
      { ...base, employeeId: 'z' },
      { ...base, employeeId: 'w' },
    ];
    const first = runProposal(rows, std, db);
    const [kx, ky, kz, kw] = first.employees.map((e) => e.key);
    expect(first.employees[1].standardEligibility).toBe('Not Eligible - Insufficient Hours');
    const r = runProposal(rows, { ...std, overrides: {
      [kx]: { exclude: true, note: 'terminated' },
      [ky]: { hoursPerPeriod: 40 },
      [kz]: { status: 'Not Eligible', note: 'owner' },
      [kw]: { deductionPerCheck: 250 },
    } }, db);
    expect(r.employees.map((e) => e.eligibility)).toEqual(['Excluded', 'Eligible', 'Not Eligible - Reviewer decision', 'Eligible']);
    expect(r.employees[0].reasons[0]).toMatch(/terminated/);
    expect(r.employees[2].standardEligibility).toBe('Eligible');
    expect(r.employees[3].perPeriod!.firstGen).toBe(250);
    expect(r.summary.overridesApplied).toBe(4);
    const forced = runProposal([{ ...base, hoursPerPeriod: 10 }], { ...std, partTime: { enabled: false } as any, overrides: { [first.employees[1].key.replace('|y|', '|1|')]: { status: 'Eligible' } } }, db);
    expect(forced.employees[0].eligibility).toBe('Eligible');
  });

  it('participation rate scales savings and valuation; pay frequency and companies are summarized', () => {
    const all = runProposal([base, { ...base, employeeId: '2', company: 'B Co' }], std, db);
    const half = runProposal([base, { ...base, employeeId: '2', company: 'B Co' }], { ...std, participationRate: 0.5 }, db);
    expect(half.summary.employerAnnualSavings.total).toBeCloseTo(all.summary.employerAnnualSavings.total / 2, 1);
    expect(half.summary.valuationIncrease).toBeCloseTo(all.summary.valuationIncrease / 2, 0);
    expect(half.summary.projectedEnrolled).toBe(1);
    expect(all.summary.payFrequency).toMatchObject({ frequency: 'weekly', periodsPerYear: 52 });
    expect(all.summary.byCompany.map((c) => c.company).sort()).toEqual(['(no company)', 'B Co']);
  });

  it('explains every result in plain words, with what would change it', () => {
    const rows: CensusRow[] = [
      base,
      { ...base, employeeId: 'a', grossPay: 0 },
      { ...base, employeeId: 'b', grossPay: 150 }, // deduction exceeds pay
      { ...base, employeeId: 'c', grossPay: 480 }, // $24,960/yr at $12 an hour
      { ...base, employeeId: 'd', hoursPerPeriod: 20 },
      { ...base, employeeId: 'f', payFrequency: 'sometimes' },
    ];
    const x = runProposal(rows, { ...std, partTime: { enabled: false } as any }, db).employees.map((e) => e.explanation!);
    expect(x.map((e) => [e.tone, e.status, e.headline])).toEqual([
      ['eligible', 'Eligible', ''],
      ['notEligible', 'Not eligible', 'No pay reported'],
      ['notEligible', 'Not eligible', 'Paycheck too small'],
      ['notEligible', 'Not eligible', 'Pay under the minimum'],
      ['notEligible', 'Not eligible', 'Too few hours'],
      ['review', 'Under review', 'Pay schedule to confirm'],
    ]);
    expect(x[0].suggestions).toEqual([]);
    expect(x[2].reason).toBe('The $200.00 deduction is more than their $150.00 check can cover.');
    expect(x[2].suggestions[0]).toMatch(/^Would qualify at about \$501 per check, \$351 more than today\./);
    expect(x[3].reason).toBe('Their pay comes to $24,960 a year, and the plan starts above $26,000.');
    expect(x[3].suggestions).toEqual(['Would qualify at about $501 per check, $21 more than today. At their current $12.00 an hour that is about 42 hours per pay period, 2 more than today.']);
    expect(x[4].reason).toBe('They average 20 hours per pay period, and the plan needs at least 23.');
    expect(x[4].suggestions).toEqual(['Would qualify at 23 or more hours per pay period, about 3 more than today.']);
    expect(x[5].suggestions).toEqual(['Tell us their pay schedule and we will finish their calculation.']);
  });

  it('says what keeps the savings low: the pay, the W-4 credits or the filing status', () => {
    const off = { enabled: false } as any;
    // $200 saves 7.65% + 12% = 19.65%; a $149 allotment needs 149 x 12 / (52 x 0.75 x 200) = 22.9%
    const pay = runProposal([base], { ...std, allotmentThreshold: 149, partTime: off }, db).employees[0].explanation!;
    expect(pay.headline).toBe('Savings too low');
    expect(pay.reason).toMatch(/^Their estimated savings are \$127\.\d\d a month, and the plan needs \$149\.00\. Each dollar set aside saves them about 20 cents in tax, and the plan needs about 23 cents\./);
    expect(pay.reason).toMatch(/at a low rate, because of the tax bracket their pay falls in\. Texas has no state income tax/);
    expect(pay.suggestions[0]).toMatch(/^Would qualify at about \$[\d,]+ per check, \$[\d,]+ more than today\./);

    const credits = runProposal([{ ...base, dependentCredits: 6000 }], { ...std, partTime: off }, db).employees[0];
    expect(credits.eligibility).toBe('Not Eligible - Insufficient Savings');
    expect(credits.explanation!.reason).toMatch(/No federal income tax is withheld from their check today, because their W-4 claims \$6,000 a year in dependent credits\./);

    const single = runProposal([base], { ...std, allotmentThreshold: 120, partTime: off }, db).employees[0];
    const married = runProposal([{ ...base, federalFilingStatus: 'Married filing jointly' }], { ...std, allotmentThreshold: 120, partTime: off }, db).employees[0];
    expect(single.eligibility).toBe('Eligible');
    expect(married.eligibility).toBe('Not Eligible - Insufficient Savings');
    expect(married.explanation!.reason).toMatch(/because their W-4 uses the Married filing jointly rate, which withholds less than the Single rate at this pay/);
    // A W-4 is the employee's own choice, so it is given as the reason and never as the thing to change.
    for (const e of [credits, married]) expect(e.explanation!.suggestions.join(' ')).not.toMatch(/W-4|filing|credit/i);
  });

  it('part-time plan results say how to reach the full plan', () => {
    const r = runProposal([{ ...base, hoursPerPeriod: 20 }], { ...std, partTime: { enabled: true, deductionPerCheck: 120, allotmentThreshold: 50, maxHoursPerWeek: 29, maxAnnualGross: 20000 } }, db);
    expect(r.employees[0].explanation).toEqual({
      status: 'Eligible (part-time plan)', tone: 'partTime', headline: '',
      reason: 'Qualifies for the part-time plan, which uses a smaller $120.00 deduction per check because they average 20 hours a week.',
      suggestions: ['Would qualify for the full plan at 23 or more hours per pay period, about 3 more than today.'],
    });
  });

  it('keeps reviewer notes out of the client wording', () => {
    const key = runProposal([base], std, db).employees[0].key;
    const out = runProposal([base], { ...std, overrides: { [key]: { status: 'Not Eligible', note: 'Owner asked us to skip the family' } } }, db).employees[0];
    expect(out.reasons.join(' ')).toMatch(/Owner asked/);
    expect(JSON.stringify(out.explanation)).not.toMatch(/Owner asked/);
    expect(out.explanation).toMatchObject({ status: 'Not eligible', headline: 'Left out after review' });
  });

  it('calculates Alabama pay over $100,000 with tax rules that came from the database', () => {
    // The database stores rules as JSON, which turns the open-ended top tier (Infinity) into null.
    const stored = JSON.parse(JSON.stringify(db));
    const r = runProposal([{ ...base, workState: 'AL', grossPay: 2500 }], std, stored);
    expect(r.employees[0].eligibility).toBe('Eligible');
    expect(r.employees[0].monthly!.allotment).toBeGreaterThan(100);
  });

  it('refuses a plan year with no tax tables', () => {
    expect(() => runProposal([base], { ...std, year: 2031 }, db)).toThrow(/outside the tax data on file/);
  });
});

describe('Texas TRS payroll model', () => {
  const trs = { ...std, allotmentThreshold: 50, retirementSystem: 'TX_TRS' };

  it('district without Social Security: savings are income tax + Medicare only, TRS stays the same', () => {
    const r = runProposal([base], trs, db);
    const e = r.employees[0];
    // 8.25% TRS pick-up on the full $1,000, before and after the Section 125 deduction
    const pickup = (x: typeof e.check) => x!.before.otherDeductions;
    expect(pickup(e.check)).toBeCloseTo(82.5, 2);
    expect(e.check!.after.otherDeductions).toBeCloseTo(82.5, 2);
    // No Social Security either way; Medicare 1.45% x 200 = 2.90 and FIT 12% x 200 = 24.00 per check
    expect(e.check!.before.fica).toBeCloseTo(1000 * 0.0145, 2);
    expect(e.perPeriod!.taxBefore - e.perPeriod!.taxAfter).toBeCloseTo(26.9, 2);
    expect(e.monthly!.employerTaxSavings).toBeCloseTo((2.9 * 52) / 12, 1);
    expect(e.retirement).toMatchObject({ system: 'TX_TRS', memberBefore: 4290, memberAfter: 4290 });
    expect(e.retirement!.employerBefore).toBeCloseTo(1000 * 52 * 0.0275, 0);
    expect(e.retirement!.employerAfter).toBe(e.retirement!.employerBefore);
    expect(r.summary.retirement).toMatchObject({ system: 'TX_TRS', socialSecurity: 'none', memberRate: 0.0825 });
    expect(r.summary.employerAnnualSavings.total).toBeCloseTo(2.9 * 52, 1);
  });

  it('district with a Section 218 agreement pays Social Security too', () => {
    const e = runProposal([base], { ...trs, publicEmployer: { socialSecurityCovered: true } as any }, db).employees[0];
    expect(e.perPeriod!.taxBefore - e.perPeriod!.taxAfter).toBeCloseTo(39.3, 2);
    expect(e.monthly!.employerTaxSavings).toBeCloseTo((15.3 * 52) / 12, 1);
  });

  it('a row the file shows paying Social Security is treated as covered', () => {
    const r = runProposal([{ ...base, employeeId: 'x' }, { ...base, employeeId: 'y', socialSecurityPaid: true }], trs, db);
    expect(r.employees[0].perPeriod!.taxBefore - r.employees[0].perPeriod!.taxAfter).toBeCloseTo(26.9, 2);
    expect(r.employees[1].perPeriod!.taxBefore - r.employees[1].perPeriod!.taxAfter).toBeCloseTo(39.3, 2);
    expect(r.employees[1].flags.join(' ')).toMatch(/Section 218/);
    expect(r.summary.retirement).toMatchObject({ socialSecurity: 'some', socialSecurityEmployees: 1 });
  });

  it('uses the file TRS amount when present, and can model a plan TRS does not count', () => {
    const e = runProposal([{ ...base, retirementSystemContribution: 82.5 }], trs, db).employees[0];
    expect(e.check!.before.otherDeductions).toBeCloseTo(82.5, 2);
    const off = runProposal([base], { ...trs, publicEmployer: { cafeteriaReductionsCovered: false } as any }, db).employees[0];
    expect(off.retirement!.memberAfter).toBeCloseTo((82.5 - 16.5) * 52, 1);
    expect(off.retirement!.employerAfter).toBeLessThan(off.retirement!.employerBefore);
  });

  it('explains a no-Social-Security shortfall in plain words', () => {
    const e = runProposal([{ ...base, grossPay: 600, federalTaxPaid: false }], { ...trs, allotmentThreshold: 149, lowIncomeMax: 0, partTime: { enabled: false } as any }, db).employees[0];
    expect(e.eligibility).toMatch(/Insufficient Savings/);
    expect(e.explanation!.reason).toMatch(/Medicare tax \(their employer does not take out Social Security\)/);
  });

  it('maps TRS and Social Security columns from a district register', () => {
    const m = autoMapColumns(['Employee ID', 'First Name', 'Last Name', 'Gross Pay', 'TRS', 'Medicare', 'Social Security']);
    expect(m.retirementSystemContribution).toBe('TRS');
    expect(m.socialSecurityPaid).toBe('Social Security');
    const rows = rowsFromSheet([{ 'Employee ID': '1', 'Gross Pay': '1,000', TRS: '82.50', 'Social Security': '0' }], m);
    expect(rows[0]).toMatchObject({ retirementSystemContribution: 82.5, socialSecurityPaid: false });
  });
});
