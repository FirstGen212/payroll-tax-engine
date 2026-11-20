import { describe, expect, it } from 'vitest';
import { DEFAULT_REPORT_SETTINGS, ReportSettingsIn, buildSnapshot, mergeReportSettings, newSlug } from '../src/proposals/report.js';

const summary: any = {
  employees: 3, eligibleTotal: 2, eligibleFull: 1, eligiblePartTime: 1, projectedEnrolled: 2, participationRate: 1,
  employerAnnualSavings: { total: 2600.13 }, valuationIncrease: 13520.68, employeeAnnualTaxSavings: 900,
  payFrequency: { frequency: 'biweekly', periodsPerYear: 26 }, byEligibility: { Eligible: 1, 'PT Eligible': 1, 'Not Eligible - Insufficient allotment': 1 },
  byCompany: [{ company: 'Acme', employees: 3, eligible: 2, monthlySavings: 300, employerAnnualSavings: 2600.13 }], benefitPackage: { name: 'Standard' },
};
const results: any[] = [
  { name: 'Zed Young', eligibility: 'Eligible', row: { workState: 'TX' }, perPeriod: { firstGen: 200 }, monthly: { allotment: 150, employerTaxSavings: 100 } },
  { name: 'Amy Adams', eligibility: 'PT Eligible', row: { workState: 'NY' }, partTime: { deductionPerCheck: 80, allotment: 40, calc: { monthly: { employerTaxSavings: 30 } } } },
  { name: 'Not Listed', eligibility: 'Not Eligible - Insufficient allotment', row: { workState: 'NY' } },
];
const proposal = (report_settings?: unknown) => ({ name: 'Acme proposal', company: 'Acme', file_name: 'Acme census.xlsx', settings: { year: 2027, ebitdaMultiple: 5.2 }, summary, results, report_settings });

describe('client proposal page', () => {
  it('shows the saved numbers and only the employees who qualify', () => {
    const s = buildSnapshot(proposal());
    expect(s).toMatchObject({ company: 'Acme', title: 'Acme Proposal', presentedBy: 'First Gen Financial', employerAnnualSavings: 2600.13, valuationIncrease: 13520.68, ebitdaMultiple: 5.2, eligible: 2, employeesReviewed: 3, sourceFile: 'Acme census.xlsx' });
    expect(s.perPeriodSavings).toBe(100.01); // 2600.13 / 26, to the cent
    expect(s.payFrequency).toEqual({ label: 'Bi-Weekly', periodsPerYear: 26 });
    expect(s.employees).toEqual([
      { name: 'Amy Adams', state: 'NY', plan: 'Part-time', deductionPerCheck: 80, employeeMonthlySavings: 40, employerAnnualSavings: 360 },
      { name: 'Zed Young', state: 'TX', plan: 'Full', deductionPerCheck: 200, employeeMonthlySavings: 150, employerAnnualSavings: 1200 },
    ]);
    expect(s.companies).toEqual([]); // one company: no breakdown
  });

  it('leaves out what the reviewer turned off', () => {
    const s = buildSnapshot(proposal({ showEmployees: 'counts', showSource: false, title: 'A better offer', intro: 'Hello.' }));
    expect(s.employees).toEqual([]);
    expect(s.byStatus).toEqual(summary.byEligibility);
    expect(s.sourceFile).toBeNull();
    expect(s.title).toBe('A better offer');
    expect(s.intro).toBe('Hello.');
    expect(buildSnapshot(proposal({ showEmployees: 'none' })).employees).toEqual([]);
  });

  it('only links the button to a web address', () => {
    expect(buildSnapshot(proposal({ ctaUrl: 'https://sign.example.com/acme' })).ctaUrl).toBe('https://sign.example.com/acme');
    for (const bad of ['javascript:alert(1)', ' data:text/html,x', 'sign.example.com', '//evil.example']) expect(buildSnapshot(proposal({ ctaUrl: bad })).ctaUrl).toBe('');
  });

  it('falls back to the standard page when saved settings are not in a usable shape', () => {
    expect(mergeReportSettings(null)).toEqual(DEFAULT_REPORT_SETTINGS);
    expect(mergeReportSettings({ steps: 'not a list' })).toEqual(DEFAULT_REPORT_SETTINGS);
    expect(mergeReportSettings({ subtitle: 'Summary', madeUp: true })).toEqual({ ...DEFAULT_REPORT_SETTINGS, subtitle: 'Summary' });
    expect(buildSnapshot(proposal({ steps: 'not a list' })).steps).toEqual(DEFAULT_REPORT_SETTINGS.steps);
    expect(ReportSettingsIn.safeParse({ steps: Array(7).fill({ title: 'x', text: 'y' }) }).success).toBe(false);
    expect(ReportSettingsIn.safeParse({ showEmployees: 'everything' }).success).toBe(false);
  });

  it('names each link after the company plus a part nobody can guess', () => {
    expect(newSlug('Maple Street Daycare', '0123456789abcdef')).toBe('maple-street-daycare-0123456789abcdef');
    expect(newSlug('Café & Señor’s — LLC', 'ff')).toBe('cafe-senor-s-llc-ff');
    expect(newSlug('!!!', 'ab')).toBe('proposal-ab');
  });
});
