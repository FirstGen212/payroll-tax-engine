/**
 * Federal income tax withholding: IRS Publication 15-T, Worksheet 1A
 * (percentage method tables for automated payroll systems), handling both
 * 2020-or-later and 2019-or-earlier Forms W-4, plus supplemental wages.
 */
import type { FederalWithholdingParams } from '@pte/tax-data';
import { bracketTax } from './money.js';
import type { FederalW4 } from './types.js';

type FedStatus = 'single' | 'mfj' | 'hoh' | 'mfs';

export interface FitComputation {
  annualWages: number;
  adjustedAnnualWage: number;
  tentativeAnnual: number;
  tentativePerPeriod: number;
  creditsPerPeriod: number;
  afterCredits: number;
  extra: number;
  perPeriod: number;
  lines: string[];
}

/** Which bracket schedule a W-4 maps to and whether the Step 2 (half-bracket) table applies. */
function schedule(w4: FederalW4): { status: FedStatus; step2: boolean } {
  if (w4.version === 'pre2020') {
    // 2019-or-earlier: Married uses the MFJ table; Single and "Married, but withhold at higher Single rate" use Single.
    return { status: w4.filingStatus === 'mfj' ? 'mfj' : 'single', step2: false };
  }
  const status: FedStatus = w4.filingStatus === 'mfs' ? 'single' : w4.filingStatus;
  return { status, step2: !!w4.step2Checked };
}

/**
 * Tentative annual withholding from the annual percentage method table.
 * Tables are derived from the year's brackets: the standard table starts at
 * (standard deduction - line 1g) and the Step 2 table uses half of every amount.
 * Published table rows take priority when loaded.
 */
export function tentativeAnnualWithholding(adjusted: number, status: FedStatus, step2: boolean, p: FederalWithholdingParams): number {
  const key = `${status}${step2 ? '_step2' : ''}`;
  const table = p.publishedTables?.[key];
  if (table && table.length) {
    let row = table[0];
    for (const r of table) if (adjusted >= r.over) row = r;
    return row.base + (adjusted - row.over) * row.rate;
  }
  const brackets = p.brackets[status];
  const std = p.standardDeduction[status];
  if (!step2) {
    const line1g = status === 'mfj' ? p.line1g.mfj : p.line1g.other;
    const floor = std - line1g;
    return bracketTax(adjusted - floor, brackets);
  }
  // Step 2 checkbox schedule: every threshold and the floor are halved.
  const floor = std / 2;
  return bracketTax(2 * (adjusted - floor), brackets) / 2;
}

export function computeFederalWithholding(wagesThisPeriod: number, periodsPerYear: number, w4: FederalW4, p: FederalWithholdingParams): FitComputation {
  const lines: string[] = [];
  if (w4.exempt) {
    return { annualWages: 0, adjustedAnnualWage: 0, tentativeAnnual: 0, tentativePerPeriod: 0, creditsPerPeriod: 0, afterCredits: 0, extra: 0, perPeriod: 0, lines: ['Employee claimed exempt on Form W-4; no federal income tax withheld.'] };
  }
  const { status, step2 } = schedule(w4);
  let annual = wagesThisPeriod * periodsPerYear;
  lines.push(`1c Annualized wages: ${wagesThisPeriod.toFixed(2)} x ${periodsPerYear} = ${annual.toFixed(2)}`);
  if (w4.nonresidentAlien) {
    const add = w4.version === 'pre2020' ? p.nraAnnualAddOn.pre2020 : p.nraAnnualAddOn.w4_2020;
    annual += add;
    lines.push(`Nonresident alien add-on (Pub 15-T Table ${w4.version === 'pre2020' ? 1 : 2}): +${add}`);
  }
  let adjusted: number;
  if (w4.version === '2020+') {
    const other = w4.otherIncome ?? 0;
    const ded = w4.deductions ?? 0;
    const line1g = step2 ? 0 : status === 'mfj' ? p.line1g.mfj : p.line1g.other;
    adjusted = Math.max(0, annual + other - (ded + line1g));
    lines.push(`1d-1i Step 4(a) ${other}, Step 4(b) ${ded}, line 1g ${line1g} -> adjusted annual wage ${adjusted.toFixed(2)}`);
  } else {
    const allowances = w4.allowances ?? 0;
    adjusted = Math.max(0, annual - allowances * p.allowanceValue);
    lines.push(`2019-or-earlier W-4: ${allowances} allowances x ${p.allowanceValue} -> adjusted annual wage ${adjusted.toFixed(2)}`);
  }
  const tentativeAnnual = tentativeAnnualWithholding(adjusted, status, step2, p);
  const tentativePerPeriod = tentativeAnnual / periodsPerYear;
  lines.push(`2 Table: ${status}${step2 ? ' (Step 2 checkbox)' : ''} -> tentative annual ${tentativeAnnual.toFixed(2)}, per period ${tentativePerPeriod.toFixed(2)}`);
  const creditsPerPeriod = w4.version === '2020+' ? (w4.dependentsAmount ?? 0) / periodsPerYear : 0;
  const afterCredits = Math.max(0, tentativePerPeriod - creditsPerPeriod);
  if (creditsPerPeriod) lines.push(`3 Step 3 credits ${(w4.dependentsAmount ?? 0)} / ${periodsPerYear} = ${creditsPerPeriod.toFixed(2)} -> ${afterCredits.toFixed(2)}`);
  const extra = w4.extraWithholding ?? 0;
  if (extra) lines.push(`4 Step 4(c) extra withholding +${extra}`);
  return { annualWages: annual, adjustedAnnualWage: adjusted, tentativeAnnual, tentativePerPeriod, creditsPerPeriod, afterCredits, extra, perPeriod: afterCredits + extra, lines };
}

/** Supplemental wages under the optional flat rate, with the mandatory rate above $1M YTD. */
export function supplementalFlat(supplemental: number, ytdSupplementalBefore: number, p: FederalWithholdingParams): { tax: number; line: string } {
  const thr = p.supplementalMandatoryThreshold;
  const below = Math.max(0, Math.min(supplemental, thr - ytdSupplementalBefore));
  const above = supplemental - below;
  const tax = below * p.supplementalRate + above * p.supplementalOver1MRate;
  const line = above > 0
    ? `Supplemental flat: ${below.toFixed(2)} x ${p.supplementalRate} + ${above.toFixed(2)} x ${p.supplementalOver1MRate} (over $1M YTD, mandatory)`
    : `Supplemental flat: ${supplemental.toFixed(2)} x ${p.supplementalRate}`;
  return { tax, line };
}
