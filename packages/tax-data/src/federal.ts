import type { Bracket, FederalWithholdingParams, Jurisdiction, TaxRule } from './types.js';

const FED_RATES = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];

/** Build federal brackets from the six upper thresholds (10% ends at t[0], ... 35% ends at t[5]). */
export function fedBrackets(t: number[]): Bracket[] {
  return FED_RATES.map((rate, i) => ({ over: i === 0 ? 0 : t[i - 1], rate }));
}

export const FEDERAL_JURISDICTION: Jurisdiction = {
  code: 'US',
  name: 'United States (Federal)',
  type: 'federal',
  state: 'US',
  flags: ['fica_applies', 'futa_applies'],
};

// ---------------- Federal income tax withholding parameters by year ----------------

/** 2025: Pub 15-T 2025 tables were built on the pre-P.L. 119-21 standard deduction ($15,000 / $30,000 / $22,500). */
const FIT_2025: FederalWithholdingParams = {
  brackets: {
    single: fedBrackets([11925, 48475, 103350, 197300, 250525, 626350]),
    mfs: fedBrackets([11925, 48475, 103350, 197300, 250525, 375800]),
    mfj: fedBrackets([23850, 96950, 206700, 394600, 501050, 751600]),
    hoh: fedBrackets([17000, 64850, 103350, 197300, 250500, 626350]),
  },
  standardDeduction: { single: 15000, mfs: 15000, mfj: 30000, hoh: 22500 },
  line1g: { mfj: 12900, other: 8600 },
  allowanceValue: 4300,
  nraAnnualAddOn: { pre2020: 10700, w4_2020: 15000 },
  supplementalRate: 0.22,
  supplementalOver1MRate: 0.37,
  supplementalMandatoryThreshold: 1_000_000,
};

/** 2026: Rev. Proc. 2025-32 brackets and standard deduction ($16,100 / $32,200 / $24,150). */
const FIT_2026: FederalWithholdingParams = {
  brackets: {
    single: fedBrackets([12400, 50400, 105700, 201775, 256225, 640600]),
    mfs: fedBrackets([12400, 50400, 105700, 201775, 256225, 384350]),
    mfj: fedBrackets([24800, 100800, 211400, 403550, 512450, 768700]),
    hoh: fedBrackets([17700, 67450, 105700, 201750, 256200, 640600]),
  },
  standardDeduction: { single: 16100, mfs: 16100, mfj: 32200, hoh: 24150 },
  line1g: { mfj: 12900, other: 8600 },
  allowanceValue: 4300,
  nraAnnualAddOn: { pre2020: 11800, w4_2020: 16100 },
  supplementalRate: 0.22,
  supplementalOver1MRate: 0.37,
  supplementalMandatoryThreshold: 1_000_000,
};

/**
 * 2027: Rev. Proc. 2026-35 (IR-2026-133) brackets and standard deduction ($16,600 / $33,200 / $24,925).
 * HoH thresholds from Tax Foundation table citing Rev. Proc. 2026-35. MFS 35% bracket ends at half the MFJ threshold.
 * Draft Pub 15-T (Nov 9 2026): line 1g $8,600 / $12,900, allowance $4,300, NRA Table 1 $12,300, Table 2 $16,600.
 */
const FIT_2027: FederalWithholdingParams = {
  brackets: {
    single: fedBrackets([12800, 52025, 109125, 208325, 264550, 661375]),
    mfs: fedBrackets([12800, 52025, 109125, 208325, 264550, 396825]),
    mfj: fedBrackets([25600, 104050, 218250, 416650, 529100, 793650]),
    hoh: fedBrackets([18250, 69650, 109100, 208300, 264550, 661350]),
  },
  standardDeduction: { single: 16600, mfs: 16600, mfj: 33200, hoh: 24925 },
  line1g: { mfj: 12900, other: 8600 },
  allowanceValue: 4300,
  nraAnnualAddOn: { pre2020: 12300, w4_2020: 16600 },
  supplementalRate: 0.22,
  supplementalOver1MRate: 0.37,
  supplementalMandatoryThreshold: 1_000_000,
};

/** Social Security wage base by year (SSA contribution and benefit base). */
export const SS_WAGE_BASE: Record<number, { amount: number; status: 'published' | 'projected' }> = {
  2024: { amount: 168600, status: 'published' },
  2025: { amount: 176100, status: 'published' },
  2026: { amount: 184500, status: 'published' },
  2027: { amount: 192300, status: 'published' },
};

function yearRange(y: number) {
  return { effectiveFrom: `${y}-01-01`, effectiveTo: `${y}-12-31` };
}

const fitRule = (y: number, params: FederalWithholdingParams, status: TaxRule['status'], sources: string[], notes?: string): TaxRule => ({
  id: `US.FIT.${y}`,
  jurisdiction: 'US',
  kind: 'FIT',
  name: 'Federal income tax withholding',
  payer: 'employee',
  wageBasis: 'FIT',
  ...yearRange(y),
  status,
  sources,
  calc: { kind: 'federal_withholding', params },
  notes,
});

const ficaRules = (y: number): TaxRule[] => {
  const base = SS_WAGE_BASE[y];
  const src = y === 2027 ? ['ssa-cola-2027', 'irs-p15'] : ['ssa-cbb', 'irs-p15'];
  return [
    { id: `US.SS_EE.${y}`, jurisdiction: 'US', kind: 'SS_EE', name: 'Social Security (employee)', payer: 'employee', wageBasis: 'FICA', ...yearRange(y), status: base.status, sources: src, calc: { kind: 'percent', rate: 0.062, wageBase: base.amount } },
    { id: `US.SS_ER.${y}`, jurisdiction: 'US', kind: 'SS_ER', name: 'Social Security (employer)', payer: 'employer', wageBasis: 'FICA', ...yearRange(y), status: base.status, sources: src, calc: { kind: 'percent', rate: 0.062, wageBase: base.amount } },
    { id: `US.MED_EE.${y}`, jurisdiction: 'US', kind: 'MED_EE', name: 'Medicare (employee)', payer: 'employee', wageBasis: 'MEDICARE', ...yearRange(y), status: 'published', sources: ['irs-p15'], calc: { kind: 'percent', rate: 0.0145 } },
    { id: `US.MED_ER.${y}`, jurisdiction: 'US', kind: 'MED_ER', name: 'Medicare (employer)', payer: 'employer', wageBasis: 'MEDICARE', ...yearRange(y), status: 'published', sources: ['irs-p15'], calc: { kind: 'percent', rate: 0.0145 } },
    { id: `US.MED_ADDL_EE.${y}`, jurisdiction: 'US', kind: 'MED_ADDL_EE', name: 'Additional Medicare tax (employee, wages over $200,000)', payer: 'employee', wageBasis: 'MEDICARE', ...yearRange(y), status: 'published', sources: ['irs-p15'], calc: { kind: 'percent', rate: 0.009, threshold: 200000 }, notes: 'Employer must withhold once wages paid by that employer exceed $200,000 in the calendar year, regardless of filing status. No employer match.' },
    { id: `US.FUTA.${y}`, jurisdiction: 'US', kind: 'FUTA', name: 'Federal unemployment (FUTA), net of 5.4% state credit', payer: 'employer', wageBasis: 'FUTA', ...yearRange(y), status: 'published', sources: ['irs-p15'], calc: { kind: 'percent', rate: 0.006, wageBase: 7000 }, notes: 'Gross 6.0% less maximum 5.4% credit. Credit reduction states add to this rate (see FUTA_CREDIT_REDUCTION).' },
  ];
};

export const FEDERAL_RULES: TaxRule[] = [
  fitRule(2025, FIT_2025, 'published', ['irs-p15t-2025', 'irs-rp-2024-40'], 'Tables derived from brackets and $15,000/$30,000/$22,500; matches Pub 15-T 2025 structure.'),
  fitRule(2026, FIT_2026, 'published', ['irs-p15t-2026', 'irs-rp-2025-32'], 'Tables derived from Rev. Proc. 2025-32 brackets and standard deduction. Compare to final Pub 15-T 2026 tables.'),
  fitRule(2027, FIT_2027, 'draft', ['irs-p15t-2027-draft', 'irs-rp-2026-35', 'irs-ir-2026-133', 'taxfoundation-2027'], 'Draft Pub 15-T (Nov 2026). Tables derived from Rev. Proc. 2026-35; replace with final Pub 15-T tables when issued (usually December).'),
  ...ficaRules(2025),
  ...ficaRules(2026),
  ...ficaRules(2027),
];

/**
 * FUTA credit reduction (additional employer FUTA rate) by year and state.
 * The DOL announces the final list each November for the current year.
 */
export const FUTA_CREDIT_REDUCTION: Record<number, { rates: Record<string, number>; status: 'published' | 'projected' | 'unverified'; notes?: string }> = {
  2024: { rates: { CA: 0.009, VI: 0.042 }, status: 'unverified' },
  2025: { rates: { CA: 0.012, VI: 0.045 }, status: 'unverified' },
  2026: { rates: { CA: 0.015 }, status: 'published', notes: 'Final US DOL determination of November 10, 2026: California 1.5%. The US Virgin Islands repaid its federal loans and has no reduction for 2026.' },
  2027: { rates: { CA: 0.018 }, status: 'projected', notes: 'Projection only: California adds 0.3 points a year while its federal loan is outstanding. The final list is published by US DOL in November 2027.' },
};
