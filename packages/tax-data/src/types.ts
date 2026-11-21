/**
 * Core data model for the payroll tax research database.
 *
 * Every tax rule is effective-dated and carries a verification status plus
 * one or more source citations, so the app can show exactly how confident we
 * are in each number and where it came from.
 */

/** How much we trust a row. Shown in the UI and in every calculation audit line. */
export type VerificationStatus =
  /** Matches a final, published agency document we cited. */
  | 'published'
  /** Matches a recognized compilation that cites the agency (EY, PayrollOrg, USDA NFC, Mercer); the agency document itself was not read. */
  | 'confirmed'
  /** Matches a draft agency document (e.g. IRS draft Pub 15-T). */
  | 'draft'
  /** Carried forward or estimated because the agency has not published the year yet. */
  | 'projected'
  /** Entered from secondary research; needs to be checked against the cited agency source. */
  | 'unverified'
  /** Structure exists but values are a stand-in. Never use for real payroll. */
  | 'placeholder';

export interface Source {
  id: string;
  agency: string;
  title: string;
  url: string;
  /** ISO date the source was read. */
  retrieved?: string;
  notes?: string;
}

export type JurisdictionType =
  | 'federal'
  | 'state'
  | 'district'
  | 'territory'
  | 'county'
  | 'city'
  | 'township'
  | 'school_district'
  /** Pennsylvania political subdivision (PSD code). */
  | 'psd'
  | 'transit_district'
  | 'special_district';

/** Flags that describe how a territory or state treats federal programs. */
export type JurisdictionFlag =
  /** Territory income tax mirrors the US Internal Revenue Code (Guam, USVI, CNMI). */
  | 'mirror_code'
  /** Wages are subject to Social Security and Medicare. */
  | 'fica_applies'
  /** Employer owes FUTA on wages here (states, DC, PR, USVI). */
  | 'futa_applies'
  /** Federal income tax withholding does not apply; territory income tax is withheld instead. */
  | 'fit_replaced_by_territory_tax'
  /** Has a state/territory unemployment insurance program. */
  | 'has_sui'
  /** Has a disability insurance program. */
  | 'has_sdi'
  /** Has paid family / medical leave contributions. */
  | 'has_pfml'
  /** No wage income tax. */
  | 'no_income_tax'
  /** Applies convenience-of-employer rule for nonresident remote workers. */
  | 'convenience_of_employer'
  /** Has local income taxes administered by localities. */
  | 'has_local_income_tax'
  /** Subject to FUTA credit reduction this year. */
  | 'futa_credit_reduction';

export interface Jurisdiction {
  /** Stable code. 'US', 'CA', 'PR', 'OH-COLUMBUS', 'PA-PSD-880000', 'NY-NYC'. */
  code: string;
  name: string;
  type: JurisdictionType;
  /** Parent jurisdiction code, e.g. 'OH' for 'OH-COLUMBUS'. */
  parent?: string;
  /** Two-letter postal code of the containing state/territory. */
  state: string;
  fips?: string;
  flags?: JurisdictionFlag[];
  /** Extra attributes for local systems (Act 32, credit rules, school district base, etc.). */
  attrs?: Record<string, unknown>;
  notes?: string;
}

/** A tax "kind": what is being taxed and who pays. */
export type TaxKind =
  | 'FIT' // federal income tax withholding
  | 'SS_EE'
  | 'SS_ER'
  | 'MED_EE'
  | 'MED_ER'
  | 'MED_ADDL_EE'
  | 'FUTA'
  | 'SIT' // state / territory income tax withholding
  | 'SUI_EE'
  | 'SUI_ER'
  | 'SUI_ER_SURCHARGE' // ETT, workforce, admin assessments tied to SUI wages
  | 'SDI_EE'
  | 'SDI_ER'
  | 'FLI_EE' // family leave insurance
  | 'FLI_ER'
  | 'PFML_EE'
  | 'PFML_ER'
  | 'LTC_EE' // WA Cares long-term care
  | 'WC_EE' // employee share of workers' comp (WA, NM)
  | 'WC_ER'
  | 'LIT_EE' // local income / earned income / wage tax
  | 'LIT_ER' // employer-paid local payroll tax
  | 'SCHOOL_EE' // school district income tax
  | 'LST_EE' // PA local services tax, flat per-head
  | 'OPT_EE' // occupational privilege tax (CO)
  | 'OPT_ER'
  | 'TRANSIT_EE'
  | 'TRANSIT_ER'
  | 'TERR_SDI_EE'
  | 'TERR_SDI_ER'
  | 'TERR_DRIVER_EE' // Puerto Rico chauffeur's insurance
  | 'TERR_DRIVER_ER'
  | 'TERR_WAGE_EE' // CNMI wage and salary tax
  | 'STATE_PAYROLL_ER' // employer-paid state payroll taxes (NV Modified Business Tax)
  | 'WORKFORCE_ER'; // workforce / training assessments outside SUI

export type Payer = 'employee' | 'employer';

/** Which taxable-wage definition a rule is applied to. */
export type WageBasis = 'FIT' | 'FICA' | 'MEDICARE' | 'FUTA' | 'SIT' | 'SUI' | 'SDI' | 'LOCAL' | 'GROSS';

/** Normalized filing status used by the engine. States map their own statuses onto these. */
export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh' | 'qss' | 'mfj_one_income' | 'mfj_two_income';

export interface Bracket {
  /** Lower bound of the bracket (income over this amount). */
  over: number;
  /** Marginal rate as a decimal (0.05 = 5%). */
  rate: number;
}

export type ByStatus<T> = Partial<Record<FilingStatus | 'all', T>>;

/** Generic annualized state withholding formula. Covers most states without custom code. */
export interface StateFormula {
  /** Normalized status used when the employee's status has no entry. */
  defaultStatus?: FilingStatus;
  brackets: ByStatus<Bracket[]>;
  /** Standard deduction subtracted from annual wages. Either a fixed amount or a percentage with min/max. */
  standardDeduction?: ByStatus<number | { pct: number; min: number; max: number }>;
  /** The standard deduction shrinks in a straight line to zero between `start` and `end` of annual wages (Maine). */
  standardDeductionPhaseOut?: ByStatus<{ start: number; end: number }>;
  /** The standard deduction is reduced by `rate` times annual wages over `start`, not below zero (Wisconsin). */
  standardDeductionSlide?: ByStatus<{ start: number; rate: number }>;
  /** The standard deduction applies only when at least one allowance is claimed (South Carolina). */
  standardDeductionNeedsAllowance?: boolean;
  /** Deduction per withholding allowance / exemption claimed. */
  allowanceDeduction?: number;
  /** The first `count` allowances are worth `amount` each instead of `allowanceDeduction` (Kansas, Massachusetts style). */
  allowanceTiers?: ByStatus<{ amount: number; count: number }>;
  /** No allowance deduction once annual wages exceed this (Rhode Island). */
  allowanceNoneAbove?: number;
  /** Deduction by filing status (personal exemption), applied in addition to allowances. */
  personalExemption?: ByStatus<number>;
  /** Tax credit per allowance (subtracted from computed annual tax). */
  allowanceCredit?: number;
  /** Tax credit by filing status. */
  personalCredit?: ByStatus<number>;
  /** Per-dependent deduction. */
  dependentDeduction?: number;
  /** Per-dependent credit. */
  dependentCredit?: number;
  /** Subtract annualized federal income tax withheld (AL, MO historically, OR with cap). */
  federalTaxDeduction?: { cap?: ByStatus<number> };
  /** No withholding if annual wages are at or below this. */
  noTaxBelow?: ByStatus<number>;
  /** Flat rate for supplemental wages when the flat method is used. */
  supplementalRate?: number;
  /** Round the per-period result to whole dollars (some states require). */
  roundToDollar?: boolean;
  /** True when the state uses the federal W-4 (no separate state form). */
  usesFederalW4?: boolean;
  /** Name of the state withholding certificate, e.g. 'DE 4', 'IT-2104'. */
  form?: string;
}

/** How a single tax rule is calculated. */
export type CalcSpec =
  | { kind: 'none'; reason?: string }
  /** Percentage of wages with optional annual wage base (per employer, per year). */
  | {
      kind: 'percent';
      rate: number;
      /** Annual taxable wage base; tax stops once YTD wages reach it. 'SS' = the Social Security wage base for the year. */
      wageBase?: number | 'SS';
      /** Wages must exceed this YTD amount before tax applies (e.g. Additional Medicare $200k). */
      threshold?: number;
      /** Cap on annual tax. */
      annualMax?: number;
      /** Cap on tax per pay period / week (HI TDI style). */
      weeklyMax?: number;
      /** True when the employer may choose the rate (e.g. SUI experience rate) - rate here is the new-employer default. */
      employerRateOverridable?: boolean;
      /** Allowed range for an employer-supplied rate. */
      rateRange?: [number, number];
    }
  /** Flat dollar amount per period (PA LST, CO OPT, WV city fees). */
  | {
      kind: 'fixed';
      amount: number;
      per: 'pay_period' | 'week' | 'month' | 'quarter' | 'year';
      /** Only applies when earnings in the month/year are at least this. */
      minEarnings?: number;
      minEarningsPer?: 'month' | 'year';
      annualMax?: number;
    }
  /** IRS Publication 15-T percentage method. */
  | { kind: 'federal_withholding'; params: FederalWithholdingParams }
  /** Generic annualized state formula. */
  | { kind: 'state_formula'; formula: StateFormula }
  /** Employee elects a percentage of gross (Arizona). */
  | { kind: 'elected_percent'; allowed: number[]; default: number; supplementalRate?: number }
  /** A named custom handler in the engine for states whose formula does not fit the generic shape. */
  | { kind: 'custom'; handler: string; params: Record<string, unknown> };

export interface FederalWithholdingParams {
  /** Tax brackets for the year by filing status (from the inflation Rev. Proc.). */
  brackets: Record<'single' | 'mfj' | 'hoh' | 'mfs', Bracket[]>;
  /** Standard deduction used to build the withholding tables. */
  standardDeduction: Record<'single' | 'mfj' | 'hoh' | 'mfs', number>;
  /** Worksheet 1A line 1g amounts when the Step 2 box is NOT checked. */
  line1g: { mfj: number; other: number };
  /** Value of one withholding allowance on a 2019-or-earlier Form W-4. */
  allowanceValue: number;
  /** Annual nonresident alien add-on, Table 1 (pre-2020 W-4) and Table 2 (2020+ W-4). */
  nraAnnualAddOn: { pre2020: number; w4_2020: number };
  /** Optional flat supplemental rate and the mandatory rate over $1M. */
  supplementalRate: number;
  supplementalOver1MRate: number;
  supplementalMandatoryThreshold: number;
  /** Published table rows, when we have them verbatim; otherwise tables are derived from brackets. */
  publishedTables?: Partial<Record<string, { over: number; base: number; rate: number }[]>>;
}

export interface TaxRule {
  /** Unique id, e.g. 'US.FIT.2027', 'CA.SDI_EE.2026'. */
  id: string;
  jurisdiction: string;
  kind: TaxKind;
  name: string;
  payer: Payer;
  wageBasis: WageBasis;
  /** ISO date (inclusive). */
  effectiveFrom: string;
  /** ISO date (inclusive). Omit for open-ended. */
  effectiveTo?: string;
  status: VerificationStatus;
  sources: string[];
  calc: CalcSpec;
  /** Who it applies to: workers working in the jurisdiction, residents, or both. */
  appliesTo?: 'work' | 'resident' | 'resident_or_work' | 'resident_and_work';
  /** Separate rate for nonresidents working in the jurisdiction (local income taxes). */
  nonresidentCalc?: CalcSpec;
  /** True when the employer can switch this tax off in the UI by default (optional/voluntary programs). */
  optional?: boolean;
  notes?: string;
}

/** Reciprocity: residents of `residentState` working in `workState` are taxed only by residence state. */
export interface ReciprocityAgreement {
  workState: string;
  residentState: string;
  /** Exemption certificate the employee files with the employer. */
  form: string;
  effectiveFrom: string;
  effectiveTo?: string;
  status: VerificationStatus;
  sources: string[];
  notes?: string;
}

/** Treatment of an earning or deduction under each wage basis. */
export type Taxability = Partial<Record<WageBasis, boolean>>;

export type EarningCategory =
  | 'regular'
  | 'overtime'
  | 'supplemental'
  | 'tips'
  | 'paid_time_off'
  | 'imputed'
  | 'reimbursement'
  | 'fringe'
  | 'retro'
  | 'severance'
  | 'third_party_sick'
  | 'other';

export interface EarningType {
  code: string;
  name: string;
  category: EarningCategory;
  /** Paid in cash in the check (false for imputed/non-cash fringe). */
  cash: boolean;
  /** Treated as supplemental wages for withholding. */
  supplemental: boolean;
  /** Taxable under each wage basis. Missing basis = taxable. */
  taxability: Taxability;
  /** State-specific overrides: { PA: { SIT: true } }. */
  stateOverrides?: Record<string, Taxability>;
  /** W-2 reporting box/code. */
  w2?: string;
  notes?: string;
  sources?: string[];
}

export type DeductionCategory =
  | 'retirement_pretax'
  | 'retirement_roth'
  | 'retirement_pickup'
  | 'retirement_loan'
  | 'section125_health'
  | 'hsa'
  | 'fsa'
  | 'dependent_care'
  | 'commuter'
  | 'insurance_posttax'
  | 'garnishment'
  | 'union'
  | 'charity'
  | 'other_posttax'
  | 'employer_contribution';

export interface DeductionType {
  code: string;
  name: string;
  category: DeductionCategory;
  /** Reduces wages for each basis when true (pre-tax). */
  reducesWages: Taxability;
  stateOverrides?: Record<string, Taxability>;
  /** Annual employee limit key into the limits table, e.g. '402g'. */
  limitKey?: string;
  /** Additional catch-up limit key. */
  catchUpLimitKey?: string;
  /** Default calculation order (lower runs first). */
  order: number;
  /** Paid by employer (no reduction of net pay). */
  employerPaid?: boolean;
  w2?: string;
  notes?: string;
  sources?: string[];
}

/** Effective-dated benefit limits (402(g), HSA, FSA, 132(f), etc.). */
export interface BenefitLimit {
  key: string;
  name: string;
  year: number;
  amount: number;
  status: VerificationStatus;
  sources: string[];
  notes?: string;
}

/** Public-sector retirement systems (Texas TRS etc.) with member contribution rates and FICA coverage. */
export interface RetirementSystem {
  code: string;
  name: string;
  state: string;
  /** Member contribution rate as a decimal of covered pay. */
  memberRate: number;
  employerRate?: number;
  /** IRC 414(h)(2) pick-up: excluded from FIT/most SIT but included in FICA. */
  pickup414h: boolean;
  /** Typical Social Security coverage for members (many TX districts are non-Section 218). */
  socialSecurityTypicallyCovered: boolean | 'varies';
  /** Other contributions on the same compensation, by who pays them (shown for context; they do not change with a Section 125 plan when salary reductions count as compensation). */
  otherContributions?: { key: string; label: string; payer: 'member' | 'employer' | 'state'; rate: number }[];
  /** Section 125 salary reductions count as covered compensation, so a cafeteria plan does not lower contributions or the pension. */
  cafeteriaReductionsCovered?: boolean;
  /** Fiscal year the rates apply to (e.g. 'FY2027: Sept 1, 2026 to Aug 31, 2027'). */
  rateYear?: string;
  effectiveFrom: string;
  status: VerificationStatus;
  sources: string[];
  notes?: string;
}
