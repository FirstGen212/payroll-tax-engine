/**
 * Vendor calculation profiles.
 *
 * Payroll providers all follow IRS/state rules, but they differ in conventions:
 * rounding, supplemental method, FICA true-up, deduction ordering, local wage base.
 * These profiles start as 'assumed' and are refined by the profile learner
 * (packages/engine/src/vendor-learner.ts) from sample paychecks/registers.
 */

export type RoundingMode = 'half_up' | 'half_even' | 'truncate';

export interface VendorConventions {
  /** Round federal income tax per check to cents or whole dollars. */
  fitRounding: 'cents' | 'dollar';
  /** Round state income tax per check. 'state_rule' = whatever the state formula says. */
  sitRounding: 'cents' | 'dollar' | 'state_rule';
  roundingMode: RoundingMode;
  /** Supplemental wages paid alone: flat 22% vs. aggregate with regular wages. */
  supplementalMethod: 'flat' | 'aggregate';
  /** Supplemental paid in the same check as regular wages: identified separately (flat) or combined (aggregate). */
  supplementalWithRegular: 'flat_separate' | 'aggregate_combined';
  /** FICA: compute on each check only, or true up to exact YTD tax each check. */
  ficaMethod: 'per_check' | 'ytd_true_up';
  /** Withhold Additional Medicare once YTD exceeds $200k (all vendors) - included for completeness. */
  addlMedicareTiming: 'threshold_crossing';
  /** Wage base for local income taxes when the jurisdiction allows a choice. */
  localWageBasis: 'local_rules' | 'medicare' | 'state' | 'gross';
  /** Apply pre-tax deductions in code order (125 before retirement), or retirement first. */
  deductionOrder: 'section125_first' | 'retirement_first';
  /** Percent-of-pay deductions computed on gross, or on gross after 125. */
  percentDeductionBase: 'gross' | 'gross_less_125';
  /** Include Step 4(c) extra withholding before or after rounding. */
  extraWithholdingTiming: 'after_rounding' | 'before_rounding';
  /** Number of pay periods used to annualize (standard) or calendar-day method. */
  annualization: 'pay_periods' | 'days';
}

export interface VendorProfile {
  id: string;
  name: string;
  status: 'assumed' | 'learned' | 'confirmed';
  conventions: VendorConventions;
  notes?: string;
  /** Number of sample paychecks the learned conventions are based on. */
  sampleCount?: number;
}

export const IRS_BY_THE_BOOK: VendorConventions = {
  fitRounding: 'cents',
  sitRounding: 'state_rule',
  roundingMode: 'half_up',
  supplementalMethod: 'flat',
  supplementalWithRegular: 'flat_separate',
  ficaMethod: 'per_check',
  addlMedicareTiming: 'threshold_crossing',
  localWageBasis: 'local_rules',
  deductionOrder: 'section125_first',
  percentDeductionBase: 'gross',
  extraWithholdingTiming: 'after_rounding',
  annualization: 'pay_periods',
};

export const VENDOR_PROFILES: VendorProfile[] = [
  { id: 'generic', name: 'By the book (IRS Pub 15-T)', status: 'confirmed', conventions: IRS_BY_THE_BOOK, notes: 'Reference calculation with no vendor-specific conventions.' },
  { id: 'adp', name: 'ADP (Workforce Now / RUN)', status: 'assumed', conventions: { ...IRS_BY_THE_BOOK, ficaMethod: 'ytd_true_up' }, notes: 'Assumed until learned from sample registers.' },
  { id: 'paychex', name: 'Paychex (Flex)', status: 'assumed', conventions: { ...IRS_BY_THE_BOOK } },
  { id: 'viventium', name: 'Viventium', status: 'assumed', conventions: { ...IRS_BY_THE_BOOK } },
  { id: 'empeon', name: 'Empeon', status: 'assumed', conventions: { ...IRS_BY_THE_BOOK }, notes: 'Listed as "Empion" in the request; assumed to be Empeon. Confirm.' },
  { id: 'paycor', name: 'Paycor', status: 'assumed', conventions: { ...IRS_BY_THE_BOOK } },
  { id: 'paylocity', name: 'Paylocity', status: 'assumed', conventions: { ...IRS_BY_THE_BOOK } },
];

/** The convention dimensions the learner searches over. */
export const CONVENTION_SEARCH_SPACE: { [K in keyof VendorConventions]?: VendorConventions[K][] } = {
  fitRounding: ['cents', 'dollar'],
  sitRounding: ['state_rule', 'cents', 'dollar'],
  roundingMode: ['half_up', 'half_even', 'truncate'],
  supplementalWithRegular: ['flat_separate', 'aggregate_combined'],
  ficaMethod: ['per_check', 'ytd_true_up'],
  percentDeductionBase: ['gross', 'gross_less_125'],
  extraWithholdingTiming: ['after_rounding', 'before_rounding'],
};
