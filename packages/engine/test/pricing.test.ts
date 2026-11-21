import { describe, expect, it } from 'vitest';
import { loadTaxDatabase } from '@pte/tax-data';
import { analyzePrograms, runProposal } from '../src/index.js';
import type { CensusRow } from '../src/index.js';
import { analyzePrograms as analyzeInBrowser, cleanPrices } from '../../../apps/web/src/pricing';

const db = loadTaxDatabase();
const states = ['TX', 'NY', 'CA', 'PA', 'FL', 'OH'];
// Made-up people across pay levels, schedules and hours, so every price point has some in and some out.
const rows: CensusRow[] = Array.from({ length: 60 }, (_, i) => ({
  rowNumber: i + 2, employeeId: String(i), firstName: 'Test', lastName: `Person ${i}`, workState: states[i % states.length],
  grossPay: 700 + i * 45, payFrequency: ['Weekly', 'Biweekly', 'Semi-Monthly'][i % 3], hoursPerPeriod: 20 + (i % 7) * 10, federalFilingStatus: i % 4 ? 'Single' : 'Married',
}));

describe('margin analyzer', () => {
  const result = runProposal(rows, { year: 2027, programPrices: [159, 149, 139, 129] }, db);
  const s = result.settings;
  const cost = s.benefitPackages.find((p) => p.id === s.benefitPackageId)!.monthlyCost;

  it('the browser gives the same table as the engine, so a picked price shows the numbers the saved proposal will have', () => {
    expect(analyzeInBrowser(result.employees, s.programPrices, cost, s.needsReviewAllotment)).toEqual(result.summary.programs);
    // And for prices the engine was not asked about, the two still agree.
    const other = [210, 175.5, 99, 60];
    expect(analyzeInBrowser(result.employees, other, cost, s.needsReviewAllotment)).toEqual(analyzePrograms(result.employees, other, cost, s.needsReviewAllotment));
  });

  it('the table is sane: highest price first, fewer people qualify as the price rises, margin is price less benefit cost', () => {
    const t = result.summary.programs;
    expect(t.map((p) => p.price)).toEqual([159, 149, 139, 129]);
    for (let i = 1; i < t.length; i++) expect(t[i].eligible).toBeGreaterThanOrEqual(t[i - 1].eligible);
    expect(t.some((p) => p.eligible > 0)).toBe(true);
    for (const p of t) {
      expect(p.monthlyRevenue).toBeCloseTo(p.eligible * p.price, 2);
      expect(p.monthlyMargin).toBeCloseTo(p.eligible * (p.price - cost), 2);
      expect(p.annualMargin).toBeCloseTo(p.monthlyMargin * 12, 2);
    }
  });

  it('picking a price and recalculating marks the employees the table counted at that price', () => {
    const at139 = runProposal(rows, { year: 2027, allotmentThreshold: 139 }, db);
    const counted = result.summary.programs.find((p) => p.price === 139)!.eligible;
    const fullPlan = at139.employees.filter((e) => e.eligibility === 'Eligible' && !e.override).length;
    // The table counts everyone whose savings reach the price and who pass the pay and hours rules; the recalculated
    // proposal can only hold back people for reasons outside those (missing hours, low data confidence).
    expect(fullPlan).toBeLessThanOrEqual(counted);
    expect(fullPlan).toBeGreaterThan(0);
  });

  it('cleans typed prices: drops blanks and out-of-range values, rounds to cents, removes repeats, highest first, at most 12', () => {
    expect(cleanPrices(['149', '', 'abc', '0', '5001', '139.999', '149', 129])).toEqual([149, 140, 129]);
    expect(cleanPrices(Array.from({ length: 20 }, (_, i) => i + 1))).toHaveLength(12);
  });
});
