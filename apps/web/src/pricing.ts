/**
 * The margin analyzer, run in the browser so a price change shows at once without a trip to the server.
 * It is the same calculation as analyzePrograms in packages/engine/src/proposal.ts; a test keeps the two in step.
 */
export interface ProgramRow {
  price: number;
  eligible: number;
  partTimeEligible: number;
  monthlyRevenue: number;
  monthlyBenefitCost: number;
  monthlyMargin: number;
  marginPercent: number;
  annualMargin: number;
}

export interface PricedEmployee {
  passesNonSavingsRules?: boolean;
  eligibility?: string;
  monthly?: { allotment: number } | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function analyzePrograms(employees: PricedEmployee[], prices: number[], benefitMonthlyCost: number, needsReviewAllotment: number): ProgramRow[] {
  const partTime = employees.filter((e) => e.eligibility === 'PT Eligible').length;
  return [...new Set(prices)].sort((a, b) => b - a).map((price) => {
    const eligible = employees.filter((e) => e.passesNonSavingsRules && e.monthly && e.monthly.allotment >= price && e.monthly.allotment < needsReviewAllotment).length;
    const revenue = eligible * price;
    const cost = eligible * benefitMonthlyCost;
    return { price, eligible, partTimeEligible: partTime, monthlyRevenue: r2(revenue), monthlyBenefitCost: r2(cost), monthlyMargin: r2(revenue - cost), marginPercent: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 1000 : 0, annualMargin: r2((revenue - cost) * 12) };
  });
}

/** Prices typed into the editor, cleaned: whole cents, $1 to $5,000, no repeats, highest first, at most 12. */
export function cleanPrices(prices: unknown[]): number[] {
  const ok = prices.map(Number).filter((p) => Number.isFinite(p) && p >= 1 && p <= 5000).map((p) => Math.round(p * 100) / 100);
  return [...new Set(ok)].sort((a, b) => b - a).slice(0, 12);
}
