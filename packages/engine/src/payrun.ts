/**
 * Pay runs (many employees, chained YTD) and proposal comparisons
 * (e.g. payroll with vs. without a Section 125 plan to size FICA savings).
 */
import { loadTaxDatabase } from '@pte/tax-data';
import type { TaxDatabase } from '@pte/tax-data';
import { calculatePay } from './calculate.js';
import { cents, sum } from './money.js';
import type { PayInput, PayResult } from './types.js';

export interface PayRunTotals {
  employees: number;
  gross: number;
  employeeTaxes: number;
  employerTaxes: number;
  deductions: number;
  net: number;
  employerCost: number;
  byTax: Record<string, { name: string; payer: string; amount: number; wages: number }>;
  warnings: number;
}

export function totalsOf(results: PayResult[]): PayRunTotals {
  const byTax: PayRunTotals['byTax'] = {};
  for (const r of results)
    for (const t of r.taxes) {
      const k = `${t.jurisdiction}.${t.kind}`;
      byTax[k] ??= { name: t.name, payer: t.payer, amount: 0, wages: 0 };
      byTax[k].amount = cents(byTax[k].amount + t.amount);
      byTax[k].wages = cents(byTax[k].wages + t.taxableWages);
    }
  return {
    employees: results.length,
    gross: cents(sum(results.map((r) => r.grossPay))),
    employeeTaxes: cents(sum(results.map((r) => r.employeeTaxes))),
    employerTaxes: cents(sum(results.map((r) => r.employerTaxes))),
    deductions: cents(sum(results.map((r) => sum(r.deductions.filter((d) => !d.employerPaid).map((d) => d.amount))))),
    net: cents(sum(results.map((r) => r.netPay))),
    employerCost: cents(sum(results.map((r) => r.employerCost))),
    byTax,
    warnings: results.reduce((a, r) => a + r.warnings.length, 0),
  };
}

export function runPayroll(inputs: PayInput[], db: TaxDatabase = loadTaxDatabase()): { results: PayResult[]; totals: PayRunTotals } {
  const results = inputs.map((i) => calculatePay(i, db));
  return { results, totals: totalsOf(results) };
}

/** Run consecutive checks for one employee, carrying YTD forward (annual projections, wage-base testing). */
export function runSeries(first: PayInput, checkDates: string[], db: TaxDatabase = loadTaxDatabase()): PayResult[] {
  const out: PayResult[] = [];
  let ytd = first.ytd ?? {};
  for (const d of checkDates) {
    const r = calculatePay({ ...first, checkDate: d, ytd }, db);
    out.push(r);
    ytd = r.ytdAfter;
  }
  return out;
}

export interface ScenarioComparison {
  base: PayRunTotals;
  variant: PayRunTotals;
  employerTaxSavings: number;
  employeeTaxSavings: number;
  netPayChange: number;
  byTaxDelta: Record<string, number>;
}

/** Compare two versions of the same payroll (proposal / eligibility modeling). */
export function compareScenarios(base: PayInput[], variant: PayInput[], db: TaxDatabase = loadTaxDatabase()): ScenarioComparison {
  const a = runPayroll(base, db).totals;
  const b = runPayroll(variant, db).totals;
  const keys = new Set([...Object.keys(a.byTax), ...Object.keys(b.byTax)]);
  const byTaxDelta: Record<string, number> = {};
  for (const k of keys) byTaxDelta[k] = cents((a.byTax[k]?.amount ?? 0) - (b.byTax[k]?.amount ?? 0));
  return { base: a, variant: b, employerTaxSavings: cents(a.employerTaxes - b.employerTaxes), employeeTaxSavings: cents(a.employeeTaxes - b.employeeTaxes), netPayChange: cents(b.net - a.net), byTaxDelta };
}
