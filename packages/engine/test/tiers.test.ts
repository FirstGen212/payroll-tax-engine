import { describe, expect, it } from 'vitest';
import { loadTaxDatabase } from '@pte/tax-data';
import { DEFAULT_PROPOSAL_SETTINGS, autoMapColumns, hceCapReason, rowsFromSheet, runProposal, tierDeduction } from '../src/index.js';
import type { CensusRow } from '../src/index.js';

const db = loadTaxDatabase();
const base: CensusRow = { rowNumber: 2, employeeId: '1', firstName: 'Pat', lastName: 'Lee', workState: 'NY', payFrequency: 'Biweekly', hoursPerPeriod: 80, federalFilingStatus: 'Single' };
const tiers = { year: 2027, pricingMode: 'tiers' as const };
const row = (id: string, grossPay: number, extra: Partial<CensusRow> = {}): CensusRow => ({ ...base, employeeId: id, rowNumber: Number(id.replace(/\D/g, '') || 2), grossPay, ...extra });

describe('tier pricing', () => {
  it('is off by default: proposals keep the full-time and part-time plans, and the top price is $159', () => {
    expect(DEFAULT_PROPOSAL_SETTINGS.pricingMode).toBe('standard');
    expect(DEFAULT_PROPOSAL_SETTINGS.allotmentThreshold).toBe(159);
    const r = runProposal([row('1', 3000)], { year: 2027 }, db);
    expect(r.employees[0].tier).toBeUndefined();
    expect(r.summary.tiers).toBeUndefined();
    expect(r.summary.pricingMode).toBe('standard');
  });

  it('ships the four tiers Evan set: deductions per check, prices, cutoffs', () => {
    const t = Object.fromEntries(DEFAULT_PROPOSAL_SETTINGS.tiers.map((x) => [x.id, x]));
    expect(t.plus.deductionByFrequency).toEqual({ monthly: 1293, semimonthly: 646.5, biweekly: 596.77, weekly: 298.38 });
    expect(t.standard.deductionByFrequency).toEqual({ monthly: 1040, semimonthly: 520, biweekly: 480, weekly: 240 });
    expect(t.basic.deductionByFrequency).toEqual({ monthly: 780, semimonthly: 390, biweekly: 360, weekly: 180 });
    expect(t.essential.deductionByFrequency).toEqual({ monthly: 520, semimonthly: 260, biweekly: 240, weekly: 120 });
    expect(DEFAULT_PROPOSAL_SETTINGS.tiers.map((x) => [x.monthlyPrice, x.allotmentCutoff])).toEqual([[159, 149], [117, 120], [74, 74], [31, 60]]);
    // Frequencies without their own amount spread the semi-monthly year.
    expect(tierDeduction(t.standard, 'daily')).toBeCloseTo((520 * 24) / 260, 2);
  });

  it('places each person in the highest tier their own savings cover, with that tier\'s deduction', () => {
    const r = runProposal([row('1', 3000), row('2', 900), row('3', 700, { hoursPerPeriod: 60 }), row('4', 600, { hoursPerPeriod: 30 })], tiers, db);
    for (const e of r.employees) {
      if (e.eligibility !== 'Eligible') continue;
      const t = r.settings.tiers.find((x) => x.id === e.tier!.id)!;
      expect(e.perPeriod!.firstGen).toBe(t.deductionByFrequency.biweekly);
      expect(e.monthly!.allotment).toBeGreaterThanOrEqual(t.allotmentCutoff);
      // Every higher tier was tried and missed.
      for (const h of r.settings.tiers.filter((x) => x.allotmentCutoff > t.allotmentCutoff)) expect(e.reasons.join(' ')).toContain(`${h.name}:`);
    }
    expect(r.employees.map((e) => e.tier?.id)).toEqual(['plus', 'standard', 'basic', undefined]);
    expect(r.employees[0].explanation?.status).toBe('Eligible (Plus)');
  });

  it('decides "no federal tax" from the engine, not the file\'s yes/no column', () => {
    for (const federalTaxPaid of [true, false, null]) {
      const e = runProposal([row('1', 3000, { federalTaxPaid })], { ...tiers, noFederalTaxAs: 'status' }, db).employees[0];
      expect(e.eligibility).not.toBe('No Federal Taxes Paid');
      expect(e.tier?.id).toBe('plus');
    }
  });

  it('cutoffs are editable: raising Plus\'s cutoff moves the same person down a tier', () => {
    const p = row('1', 1500);
    const before = runProposal([p], tiers, db).employees[0];
    expect(before.tier?.id).toBe('plus');
    const t = DEFAULT_PROPOSAL_SETTINGS.tiers.map((x) => (x.id === 'plus' ? { ...x, allotmentCutoff: before.monthly!.allotment + 1 } : x));
    const after = runProposal([p], { ...tiers, tiers: t }, db).employees[0];
    expect(after.tier?.id).toBe('standard');
    expect(after.perPeriod!.firstGen).toBe(480);
  });

  it('holds owners and HCEs at Standard; without prior-year pay, this year\'s pay is used', () => {
    const r = runProposal([row('1', 3000, { owner: true }), row('2', 7000), row('3', 3000, { priorYearPay: 170000 }), row('4', 7000, { priorYearPay: 150000 }), row('5', 3000)], { ...tiers, needsReviewAllotment: 5000 }, db);
    expect(r.employees.map((e) => e.tier?.id)).toEqual(['standard', 'standard', 'standard', 'plus', 'plus']);
    expect(r.employees[0].tier?.capped).toBe('Owner');
    expect(r.employees[1].tier?.capped).toMatch(/this year's pay was used/);
    expect(r.employees[2].tier?.capped).toMatch(/prior-year pay \$170,000/);
    const off = runProposal([row('1', 3000, { owner: true })], { ...tiers, hceCap: { enabled: false, payOver: 160000, maxTierId: 'standard' } }, db);
    expect(off.employees[0].tier?.id).toBe('plus');
    expect(hceCapReason({ priorYearPay: 160000 }, 0, DEFAULT_PROPOSAL_SETTINGS)).toBeUndefined();
  });

  it('Plus needs the full-time pay and hours rules; the other tiers do not', () => {
    // 20 hours a period is under the 23-hour minimum: no Plus, but a lower tier if savings allow.
    const r = runProposal([row('1', 1600, { hoursPerPeriod: 20 }), row('2', 900)], tiers, db);
    expect(r.employees[0].tier?.id).toBe('standard');
    expect(r.employees[0].reasons.join(' ')).toMatch(/Plus: 20 hours per period is under 23/);
    // $23,400 a year is under the $26,000 low-income line.
    expect(r.employees[1].reasons.join(' ')).toMatch(/Plus: pay of \$23,400\.00 a year is at or below \$26,000\.00/);
    // Turning the full-time rules on for Standard pushes both down to Basic.
    const t = DEFAULT_PROPOSAL_SETTINGS.tiers.map((x) => (x.id === 'standard' ? { ...x, fullTimeRules: true } : x));
    expect(runProposal([row('1', 1600, { hoursPerPeriod: 20 }), row('2', 900)], { ...tiers, tiers: t }, db).employees.map((e) => e.tier?.id)).toEqual(['basic', 'basic']);
  });

  it('reports against the lowest tier when nothing fits', () => {
    const r = runProposal([row('1', 500, { hoursPerPeriod: 30, workState: 'TX' })], tiers, db);
    const e = r.employees[0];
    expect(e.eligibility).toMatch(/Insufficient Savings|Insufficient Funds/);
    expect(e.tier).toBeUndefined();
    expect(e.reasons.join(' ')).toMatch(/No tier fits/);
    if (e.eligibility === 'Not Eligible - Insufficient Savings') expect(e.explanation?.reason).toMatch(/plan needs \$60\.00/);
  });

  it('ignores the part-time plan and the file deduction in tier mode, but a reviewer\'s deduction still wins', () => {
    const r = runProposal([row('1', 3000, { proposedDeduction: 100 }), row('2', 3000)], { ...tiers, useRowDeduction: true, overrides: { '|2|2': { deductionPerCheck: 400 } } }, db);
    expect(r.employees[0].perPeriod!.firstGen).toBe(596.77);
    expect(r.employees[0].flags.join(' ')).toMatch(/not used: tier pricing/);
    expect(r.employees[1].perPeriod!.firstGen).toBe(400);
    expect(r.employees.every((e) => e.eligibility !== 'PT Eligible')).toBe(true);
  });

  it('reads Owner and Prior-year pay columns', () => {
    const m = autoMapColumns(['First Name', 'Owner', 'Prior Year Pay']);
    expect(m.owner).toBe('Owner');
    expect(m.priorYearPay).toBe('Prior Year Pay');
    const [x] = rowsFromSheet([{ 'First Name': 'A', Owner: 'Yes', 'Prior Year Pay': '$180,000' }], m);
    expect(x.owner).toBe(true);
    expect(x.priorYearPay).toBe(180000);
  });
});
