/**
 * The margin analyzer, run in the browser so a price change shows at once without a trip to the server.
 * It is the same calculation as analyzePrograms and analyzeTiers in packages/engine/src/proposal.ts; a test keeps them in step.
 */
export interface ProgramRow {
  price: number;
  eligible: number;
  partTimeEligible: number;
  partTimeRevenue: number;
  partTimeBenefitCost: number;
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
  tier?: { id: string } | null;
}

export interface PartTimePricing { price: number; benefitMonthlyCost: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (m: number, r: number) => (r ? Math.round((m / r) * 1000) / 1000 : 0);

export function analyzePrograms(employees: PricedEmployee[], prices: number[], benefitMonthlyCost: number, needsReviewAllotment: number, partTime: PartTimePricing = { price: 0, benefitMonthlyCost: 0 }): ProgramRow[] {
  const ptCount = employees.filter((e) => e.eligibility === 'PT Eligible').length;
  const ptRevenue = ptCount * partTime.price;
  const ptCost = ptCount * partTime.benefitMonthlyCost;
  return [...new Set(prices)].sort((a, b) => b - a).map((price) => {
    const eligible = employees.filter((e) => e.passesNonSavingsRules && e.monthly && e.monthly.allotment >= price && e.monthly.allotment < needsReviewAllotment).length;
    const revenue = eligible * price + ptRevenue;
    const cost = eligible * benefitMonthlyCost + ptCost;
    return { price, eligible, partTimeEligible: ptCount, partTimeRevenue: r2(ptRevenue), partTimeBenefitCost: r2(ptCost), monthlyRevenue: r2(revenue), monthlyBenefitCost: r2(cost), monthlyMargin: r2(revenue - cost), marginPercent: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 1000 : 0, annualMargin: r2((revenue - cost) * 12) };
  });
}

export interface TierInput { id: string; name: string; monthlyPrice: number; benefitPackageId: string; enabled: boolean }
export interface PackageInput { id: string; name: string; monthlyCost: number }
export interface TierRow {
  id: string; name: string; enrolled: number; price: number; benefitCost: number; packageName: string; marginPerEmployee: number;
  monthlyRevenue: number; monthlyBenefitCost: number; monthlyMargin: number; marginPercent: number; annualMargin: number; losesMoney: boolean;
}

/** Tier pricing margins: one row per tier that is turned on, then the total row (id 'total'). */
export function analyzeTiers(employees: PricedEmployee[], tiers: TierInput[], packages: PackageInput[]): TierRow[] {
  const rows: TierRow[] = tiers.filter((t) => t.enabled).map((t) => {
    const pkg = packages.find((p) => p.id === t.benefitPackageId);
    const cost = pkg?.monthlyCost ?? 0;
    const enrolled = employees.filter((e) => e.eligibility === 'Eligible' && e.tier?.id === t.id).length;
    const revenue = enrolled * t.monthlyPrice;
    const benefit = enrolled * cost;
    return { id: t.id, name: t.name, enrolled, price: t.monthlyPrice, benefitCost: cost, packageName: pkg?.name ?? '', marginPerEmployee: r2(t.monthlyPrice - cost), monthlyRevenue: r2(revenue), monthlyBenefitCost: r2(benefit), monthlyMargin: r2(revenue - benefit), marginPercent: pct(revenue - benefit, revenue), annualMargin: r2((revenue - benefit) * 12), losesMoney: t.monthlyPrice < cost };
  });
  const sum = (k: 'enrolled' | 'monthlyRevenue' | 'monthlyBenefitCost') => rows.reduce((a, r) => a + r[k], 0);
  const revenue = r2(sum('monthlyRevenue'));
  const benefit = r2(sum('monthlyBenefitCost'));
  const enrolled = sum('enrolled');
  rows.push({ id: 'total', name: 'All tiers', enrolled, price: enrolled ? r2(revenue / enrolled) : 0, benefitCost: enrolled ? r2(benefit / enrolled) : 0, packageName: '', marginPerEmployee: enrolled ? r2((revenue - benefit) / enrolled) : 0, monthlyRevenue: revenue, monthlyBenefitCost: benefit, monthlyMargin: r2(revenue - benefit), marginPercent: pct(revenue - benefit, revenue), annualMargin: r2((revenue - benefit) * 12), losesMoney: revenue < benefit });
  return rows;
}

/** Price per check for a monthly price: the year's price spread over the checks. */
export function pricePerCheck(monthly: number, periodsPerYear: number): number {
  return r2((monthly * 12) / periodsPerYear);
}

/** Prices typed into the editor, cleaned: whole cents, $1 to $5,000, no repeats, highest first, at most 12. */
export function cleanPrices(prices: unknown[]): number[] {
  const ok = prices.map(Number).filter((p) => Number.isFinite(p) && p >= 1 && p <= 5000).map((p) => Math.round(p * 100) / 100);
  return [...new Set(ok)].sort((a, b) => b - a).slice(0, 12);
}
