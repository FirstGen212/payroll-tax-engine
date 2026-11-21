import Decimal from 'decimal.js';
import type { Bracket } from '@pte/tax-data';
import type { RoundingMode } from '@pte/tax-data';

Decimal.set({ precision: 30 });

/** Round a number to `places` decimals with an explicit rounding mode (no binary float surprises). */
export function round(x: number, places = 2, mode: RoundingMode = 'half_up'): number {
  // Already at the requested precision (the common case for money): rounding in any mode returns it unchanged.
  if (places === 2 && Math.abs(x) < 1e12 && Math.round(x * 100) / 100 === x) return x;
  const rm = mode === 'half_up' ? Decimal.ROUND_HALF_UP : mode === 'half_even' ? Decimal.ROUND_HALF_EVEN : Decimal.ROUND_DOWN;
  return new Decimal(x).toDecimalPlaces(places, rm).toNumber();
}

export const cents = (x: number, mode: RoundingMode = 'half_up') => round(x, 2, mode);
export const dollars = (x: number, mode: RoundingMode = 'half_up') => round(x, 0, mode);

/** Exact decimal sum of money values. */
export function sum(values: number[]): number {
  // Whole-cent values add exactly as integers; anything finer goes through decimal arithmetic.
  let centsTotal = 0;
  let whole = true;
  for (const v of values) {
    const c = Math.round(v * 100);
    if (c / 100 !== v || Math.abs(c) > 1e13) { whole = false; break; }
    centsTotal += c;
  }
  if (whole && Math.abs(centsTotal) < 9e15) return centsTotal / 100;
  return values.reduce((acc, v) => acc.plus(v), new Decimal(0)).toNumber();
}

/** Tax on `income` under marginal brackets. */
export function bracketTax(income: number, brackets: Bracket[]): number {
  if (income <= 0) return 0;
  let tax = new Decimal(0);
  const sorted = [...brackets].sort((a, b) => a.over - b.over);
  for (let i = 0; i < sorted.length; i++) {
    const lo = sorted[i].over;
    const hi = i + 1 < sorted.length ? sorted[i + 1].over : Infinity;
    if (income <= lo) break;
    const span = Math.min(income, hi) - lo;
    tax = tax.plus(new Decimal(span).times(sorted[i].rate));
  }
  return tax.toNumber();
}

/** Marginal rate that applies at `income`. */
export function marginalRate(income: number, brackets: Bracket[]): number {
  const sorted = [...brackets].sort((a, b) => a.over - b.over);
  let r = 0;
  for (const b of sorted) if (income > b.over) r = b.rate;
  return r;
}

export const PERIODS_PER_YEAR = {
  daily: 260,
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
} as const;

export type PayFrequency = keyof typeof PERIODS_PER_YEAR;

/** Approximate number of weeks in a pay period (for per-week fees and weekly caps). */
export const WEEKS_PER_PERIOD: Record<PayFrequency, number> = {
  daily: 0.2,
  weekly: 1,
  biweekly: 2,
  semimonthly: 52 / 24,
  monthly: 52 / 12,
  quarterly: 13,
  semiannual: 26,
  annual: 52,
};
