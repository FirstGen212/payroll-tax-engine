import { describe, expect, it } from 'vitest';
import { DEFAULT_REPORT_SETTINGS, ReportSettingsIn, buildSnapshot, mergeReportSettings, newSlug } from '../src/proposals/report.js';

const summary: any = {
  employees: 3, eligibleTotal: 2, eligibleFull: 1, eligiblePartTime: 1, projectedEnrolled: 2, participationRate: 1,
  employerAnnualSavings: { total: 2600.13 }, valuationIncrease: 13520.68, employeeAnnualTaxSavings: 900,
  payFrequency: { frequency: 'biweekly', periodsPerYear: 26 }, byEligibility: { Eligible: 1, 'PT Eligible': 1, 'Not Eligible - Insufficient allotment': 1 },
  byCompany: [{ company: 'Acme', employees: 3, eligible: 2, monthlySavings: 300, employerAnnualSavings: 2600.13 }], benefitPackage: { name: 'Standard' },
};
// Zed and Amy were saved before results carried a client explanation; Bea and Cal carry one.
const results: any[] = [
  { name: 'Zed Young', eligibility: 'Eligible', row: { workState: 'TX' }, perPeriod: { firstGen: 200 }, monthly: { allotment: 150, employerTaxSavings: 100 } },
  { name: 'Amy Adams', eligibility: 'PT Eligible', row: { workState: 'NY' }, partTime: { deductionPerCheck: 80, allotment: 40, calc: { monthly: { allotment: 40, employerTaxSavings: 30 } } } },
  { name: 'Cal Reyes', eligibility: 'Not Eligible - Insufficient Savings', row: { workState: 'NY' }, monthly: { allotment: 90, employerTaxSavings: 60 }, reasons: ['Monthly allotment $90.00 is below the $149.00 threshold.'],
    explanation: { status: 'Not eligible', tone: 'notEligible', headline: 'Savings too low', reason: 'Their estimated savings are $90.00 a month, and the plan needs $149.00.', suggestions: ['Would qualify at about $1,400 per check, $200 more than today.'] } },
  { name: 'Bea Stone', eligibility: 'NEEDS REVIEW', row: { workState: 'TX' }, reasons: ['Hours missing for an hourly employee.'],
    explanation: { status: 'Under review', tone: 'review', headline: 'Hours to confirm', reason: 'Their hours per pay period are missing from the file.', suggestions: ['Send their average hours and we will finish their calculation.'] } },
  { name: 'Old Rule', eligibility: 'Not Eligible - Low Income', row: { workState: 'NY' }, reasons: ['Annual gross $20,000.00 is at or below $26,000.00.'] },
  { name: 'Owner Kin', eligibility: 'Not Eligible - Reviewer decision', row: { workState: 'NY' }, reasons: ['Marked not eligible by the reviewer (rules said Eligible): family of the owner.'] },
  { name: 'Left Out', eligibility: 'Excluded', row: { workState: 'NY' }, reasons: ['Left out by the reviewer: duplicate.'] },
];
const proposal = (report_settings?: unknown) => ({ name: 'Acme proposal', company: 'Acme', file_name: 'Acme census.xlsx', settings: { year: 2027, ebitdaMultiple: 5.2 }, summary, results, report_settings });

describe('client proposal page', () => {
  it('shows the saved numbers and every employee with their status and the reason', () => {
    const s = buildSnapshot(proposal());
    expect(s).toMatchObject({ company: 'Acme', title: 'Acme Proposal', presentedBy: 'First Gen Financial', employerAnnualSavings: 2600.13, valuationIncrease: 13520.68, ebitdaMultiple: 5.2, eligible: 2, employeesReviewed: 3, sourceFile: 'Acme census.xlsx' });
    expect(s.perPeriodSavings).toBe(100.01); // 2600.13 / 26, to the cent
    expect(s.payFrequency).toEqual({ label: 'Bi-Weekly', periodsPerYear: 26 });
    expect(s.showEmployees).toBe('all');
    // People on a plan first, then under review, then not eligible; by name within each
    expect(s.employees.map((e) => [e.name, e.status, e.headline])).toEqual([
      ['Amy Adams', 'Eligible (part-time plan)', ''],
      ['Zed Young', 'Eligible', ''],
      ['Bea Stone', 'Under review', 'Hours to confirm'],
      ['Cal Reyes', 'Not eligible', 'Savings too low'],
      ['Old Rule', 'Not eligible', 'Low Income'],
      ['Owner Kin', 'Not eligible', 'Left out after review'],
    ]);
    expect(s.employees[0]).toEqual({ name: 'Amy Adams', state: 'NY', status: 'Eligible (part-time plan)', tone: 'partTime', headline: '', reason: 'Qualifies for the part-time plan.', suggestions: [], plan: 'Part-time', deductionPerCheck: 80, employeeMonthlySavings: 40, employerAnnualSavings: 360 });
    expect(s.employees[1]).toMatchObject({ plan: 'Full', deductionPerCheck: 200, employeeMonthlySavings: 150, employerAnnualSavings: 1200 });
    // No amounts next to someone who is not on a plan, even though the rules calculated them
    expect(s.employees[3]).toEqual({ name: 'Cal Reyes', state: 'NY', status: 'Not eligible', tone: 'notEligible', headline: 'Savings too low', reason: 'Their estimated savings are $90.00 a month, and the plan needs $149.00.', suggestions: ['Would qualify at about $1,400 per check, $200 more than today.'] });
    expect(s.statusCounts).toEqual({ eligible: 2, partTime: 1, review: 1, notEligible: 3 });
    expect(s.byReason.map((r) => [r.status, r.headline, r.count])).toEqual(expect.arrayContaining([['Under review', 'Hours to confirm', 1], ['Not eligible', 'Savings too low', 1]]));
    expect(s.companies).toEqual([]); // one company: no breakdown
  });

  it('never shows a row the reviewer left out, or a reviewer note', () => {
    const text = JSON.stringify(buildSnapshot(proposal()));
    expect(text).not.toMatch(/Left Out/);
    expect(text).not.toMatch(/family of the owner|duplicate/);
  });

  it('can list only the employees who qualify', () => {
    const s = buildSnapshot(proposal({ showEmployees: 'list' }));
    expect(s.employees.map((e) => e.name)).toEqual(['Amy Adams', 'Zed Young']);
    expect(s.statusCounts.notEligible).toBe(3); // the counts still cover everyone
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
