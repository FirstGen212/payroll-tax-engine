import { describe, expect, it } from 'vitest';
import { loadTaxDatabase } from '@pte/tax-data';
import { analyzePrograms, runProposal } from '../src/index.js';
import type { CensusRow } from '../src/index.js';
import { analyzePrograms as analyzeInBrowser, analyzeTiers as tiersInBrowser, cleanPrices, pricePerCheck } from '../../../apps/web/src/pricing';
import { analyzeTiers } from '../src/index.js';

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
  const pt = { price: s.partTime.monthlyPrice!, benefitMonthlyCost: s.benefitPackages.find((p) => p.id === s.partTime.benefitPackageId)!.monthlyCost };

  it('the browser gives the same table as the engine, so a picked price shows the numbers the saved proposal will have', () => {
    expect(analyzeInBrowser(result.employees, s.programPrices, cost, s.needsReviewAllotment, pt)).toEqual(result.summary.programs);
    // And for prices the engine was not asked about, the two still agree.
    const other = [210, 175.5, 99, 60];
    expect(analyzeInBrowser(result.employees, other, cost, s.needsReviewAllotment, pt)).toEqual(analyzePrograms(result.employees, other, cost, s.needsReviewAllotment, pt));
  });

  it('the table is sane: highest price first, fewer people qualify as the price rises, margin is price less benefit cost, part-time revenue included', () => {
    const t = result.summary.programs;
    expect(t.map((p) => p.price)).toEqual([159, 149, 139, 129]);
    for (let i = 1; i < t.length; i++) expect(t[i].eligible).toBeGreaterThanOrEqual(t[i - 1].eligible);
    expect(t.some((p) => p.eligible > 0)).toBe(true);
    const ptCount = result.summary.eligiblePartTime;
    expect(ptCount).toBeGreaterThan(0);
    // Defaults: part-time plan at $74 a month on the MEC package ($55).
    expect(pt).toEqual({ price: 74, benefitMonthlyCost: 55 });
    for (const p of t) {
      expect(p.partTimeEligible).toBe(ptCount);
      expect(p.partTimeRevenue).toBeCloseTo(ptCount * 74, 2);
      expect(p.monthlyRevenue).toBeCloseTo(p.eligible * p.price + ptCount * 74, 2);
      expect(p.monthlyMargin).toBeCloseTo(p.eligible * (p.price - cost) + ptCount * (74 - 55), 2);
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

describe('tier margins', () => {
  const result = runProposal(rows, { year: 2027, pricingMode: 'tiers' }, db);
  const s = result.settings;

  it('the browser gives the same tier table as the engine, also after a price is typed', () => {
    expect(tiersInBrowser(result.employees, s.tiers, s.benefitPackages)).toEqual(result.summary.tiers);
    const repriced = s.tiers.map((t) => (t.id === 'standard' ? { ...t, monthlyPrice: 125 } : t));
    expect(tiersInBrowser(result.employees, repriced, s.benefitPackages)).toEqual(analyzeTiers(result.employees, repriced, s.benefitPackages));
  });

  it('margin is price less the package cost, Essential is marked as losing money, and the total adds up', () => {
    const t = result.summary.tiers!;
    const by = Object.fromEntries(t.map((r) => [r.id, r]));
    expect(by.plus.marginPerEmployee).toBe(159 - 65);
    expect(by.standard.marginPerEmployee).toBe(117 - 65);
    expect(by.basic.marginPerEmployee).toBe(74 - 55);
    expect(by.essential.marginPerEmployee).toBe(31 - 55);
    expect(t.filter((r) => r.losesMoney).map((r) => r.id)).toEqual(['essential']);
    const tiersOnly = t.filter((r) => r.id !== 'total');
    expect(by.total.enrolled).toBe(tiersOnly.reduce((a, r) => a + r.enrolled, 0));
    expect(by.total.monthlyMargin).toBeCloseTo(tiersOnly.reduce((a, r) => a + r.monthlyMargin, 0), 2);
    expect(by.total.enrolled).toBe(result.employees.filter((e) => e.eligibility === 'Eligible').length);
  });

  it('price per check spreads the monthly price over the year', () => {
    expect([24, 26, 52].map((n) => pricePerCheck(159, n))).toEqual([79.5, 73.38, 36.69]);
    expect([24, 26, 52].map((n) => pricePerCheck(117, n))).toEqual([58.5, 54, 27]);
    expect([24, 26, 52].map((n) => pricePerCheck(74, n))).toEqual([37, 34.15, 17.08]);
    expect([24, 26, 52].map((n) => pricePerCheck(31, n))).toEqual([15.5, 14.31, 7.15]);
  });
});
