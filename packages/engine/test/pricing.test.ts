import { describe, expect, it } from 'vitest';
import { loadTaxDatabase } from '@pte/tax-data';
import { analyzePrograms, planCacheStats, runProposal } from '../src/index.js';
import type { CensusRow } from '../src/index.js';
import { analyzePrograms as analyzeInBrowser, analyzeTiers as tiersInBrowser, cleanPrices, pricePerCheck } from '../../../apps/web/src/pricing';
import { analyzeTiers, mergePackages, VIRTUAL_CARE_MONTHLY_COST } from '../src/index.js';

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

  it('picking a price and recalculating gives every total the table showed for that price', () => {
    for (const price of [159, 149, 139, 129]) {
      const at = runProposal(rows, { year: 2027, programPrices: [159, 149, 139, 129], allotmentThreshold: price }, db);
      const row = result.summary.programs.find((p) => p.price === price)!;
      const full = at.employees.filter((e) => e.eligibility === 'Eligible');
      // The table's count is exactly the full-plan count the recalculated proposal shows, so the two never disagree.
      expect(at.summary.eligibleFull).toBe(row.eligible);
      expect(full.length).toBe(row.eligible);
      // And the recalculated proposal's own table row for that price is the same row.
      expect(at.summary.programs.find((p) => p.price === price)).toEqual(row);
      // The totals below the table follow the price: allotments are the eligible people's allotments.
      const ptOn = at.employees.filter((e) => e.eligibility === 'PT Eligible').reduce((a, e) => a + e.partTime!.allotment, 0);
      expect(at.summary.monthlySavings.full).toBeCloseTo(full.reduce((a, e) => a + e.monthly!.allotment, 0), 1);
      expect(at.summary.monthlySavings.total).toBeCloseTo(at.summary.monthlySavings.full + ptOn, 1);
    }
    const hi = runProposal(rows, { year: 2027, allotmentThreshold: 159 }, db).summary;
    const lo = runProposal(rows, { year: 2027, allotmentThreshold: 129 }, db).summary;
    expect(lo.eligibleFull).toBeGreaterThan(hi.eligibleFull);
    expect(lo.monthlySavings.full).toBeGreaterThan(hi.monthlySavings.full);
    expect(lo.employerAnnualSavings.full).toBeGreaterThan(hi.employerAnnualSavings.full);
  });

  it('a price change reuses each employee\'s year of paychecks and gives exactly what a fresh calculation gives', () => {
    const before = planCacheStats.hits;
    const cached = runProposal(rows, { year: 2027, allotmentThreshold: 139 }, db);
    expect(planCacheStats.hits).toBeGreaterThan(before);
    // A copy of the tax database has its own, empty store, so this run calculates everything again.
    const fresh = runProposal(rows, { year: 2027, allotmentThreshold: 139 }, { ...db });
    expect(cached.summary).toEqual(fresh.summary);
    expect(cached.employees.map((e) => [e.eligibility, e.monthly, e.partTime?.allotment, e.explanation])).toEqual(fresh.employees.map((e) => [e.eligibility, e.monthly, e.partTime?.allotment, e.explanation]));
    // Changing something that does change taxes (the buffer) is not served from the store.
    const buffered = runProposal(rows, { year: 2027, allotmentThreshold: 139, allotmentBuffer: 0.5 }, db);
    expect(buffered.employees[10].monthly!.allotment).not.toBe(cached.employees[10].monthly!.allotment);
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

  it('margin is price less the package cost (the $55 MEC by default), Essential is marked as losing money, and the total adds up', () => {
    const t = result.summary.tiers!;
    const by = Object.fromEntries(t.map((r) => [r.id, r]));
    expect(by.plus.marginPerEmployee).toBe(159 - 55);
    expect(by.standard.marginPerEmployee).toBe(117 - 55);
    expect(by.basic.marginPerEmployee).toBe(74 - 55);
    // Essential carries virtual care only, so it no longer pays for MEC it cannot afford.
    expect(by.essential.packageName).toBe('Virtual care only');
    expect(by.essential.marginPerEmployee).toBe(31 - VIRTUAL_CARE_MONTHLY_COST);
    expect(t.filter((r) => r.losesMoney).map((r) => r.id)).toEqual(31 < VIRTUAL_CARE_MONTHLY_COST ? ['essential'] : []);
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

describe('benefit packages', () => {
  it('offers virtual care only next to MEC, and a saved proposal keeps its own costs while picking up new packages', () => {
    const d = mergePackages();
    expect(d.map((p) => p.id)).toEqual(['virtual', 'mec', 'standard', 'mec_plus']);
    const saved = mergePackages([{ id: 'mec', name: 'MEC', monthlyCost: 60 }, { id: 'custom', name: 'Custom', monthlyCost: 10 }]);
    expect(saved.find((p) => p.id === 'mec')!.monthlyCost).toBe(60);
    expect(saved.map((p) => p.id)).toEqual(['virtual', 'mec', 'standard', 'mec_plus', 'custom']);
  });

  it('the full plan can be set to virtual care only, and its cost comes off the margin', () => {
    const r = runProposal(rows, { year: 2027, benefitPackageId: 'virtual', benefitPackages: mergePackages().map((p) => (p.id === 'virtual' ? { ...p, monthlyCost: 12 } : p)) }, db);
    expect(r.summary.benefitPackage.name).toBe('Virtual care only');
    const row = r.summary.programs[0];
    expect(row.monthlyMargin).toBeCloseTo(row.eligible * (row.price - 12) + row.partTimeEligible * (74 - 55), 2);
  });
});
