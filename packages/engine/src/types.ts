import type { FilingStatus, Payer, TaxKind, VendorConventions, VerificationStatus, WageBasis } from '@pte/tax-data';
import type { PayFrequency } from './money.js';

export interface FederalW4 {
  /** '2020+' for the redesigned form, 'pre2020' for 2019-or-earlier forms still on file. */
  version: '2020+' | 'pre2020';
  /** 2020+: single (incl. MFS), mfj (incl. QSS), hoh. pre2020: single, mfj (married), or mfs = married-but-single-rate. */
  filingStatus: 'single' | 'mfj' | 'hoh' | 'mfs';
  step2Checked?: boolean;
  /** Step 3 total credits (annual dollars). */
  dependentsAmount?: number;
  /** Step 4(a) other income (annual). */
  otherIncome?: number;
  /** Step 4(b) deductions (annual). */
  deductions?: number;
  /** Step 4(c) extra withholding per pay period. */
  extraWithholding?: number;
  /** pre2020 allowances. */
  allowances?: number;
  exempt?: boolean;
  nonresidentAlien?: boolean;
}

export interface StateW4 {
  filingStatus?: FilingStatus;
  allowances?: number;
  dependents?: number;
  /** Additional allowances / estimated deductions (CA DE 4 line 1b, GA additional allowances). */
  additionalAllowances?: number;
  /** Extra withholding per period. */
  additional?: number;
  exempt?: boolean;
  /** Arizona A-4 elected percentage (decimal). */
  electedPercent?: number;
  /** New Jersey NJ-W4 rate table letter. */
  njTable?: 'A' | 'B' | 'C' | 'D' | 'E';
  /** Employee filed the reciprocity / nonresident exemption certificate for this (work) state. */
  reciprocityCertificate?: boolean;
}

export interface WorkAllocation {
  state: string;
  /** Local jurisdiction codes at the work location (city, county, PSD, transit district). */
  localCodes?: string[];
  /** Share of wages earned at this location (0-1). Allocations should sum to 1. */
  percent: number;
  /** Employee works remotely for their own convenience (triggers convenience-of-employer rules). */
  remoteForConvenience?: boolean;
  label?: string;
}

export interface EarningLine {
  code: string;
  amount: number;
  hours?: number;
  rate?: number;
  /** Override: treat as supplemental (or not) regardless of earning type default. */
  supplemental?: boolean;
}

export interface GarnishmentOrder {
  /** Child support: support second family? arrears over 12 weeks? */
  supportsOtherFamily?: boolean;
  arrearsOver12Weeks?: boolean;
  /** Federal levy: filing status and dependents from Form 668-W Part 3. */
  levyFilingStatus?: 'single' | 'mfj' | 'hoh' | 'mfs';
  levyDependents?: number;
  /** Total remaining balance; deduction stops at zero. */
  balance?: number;
  /** State-specific lower creditor percentage (e.g. 10% in some states). */
  maxPercentOverride?: number;
}

export interface DeductionLine {
  code: string;
  /** Flat amount per period. */
  amount?: number;
  /** Percent of gross (decimal). */
  percent?: number;
  /** Public retirement system code (e.g. TX_TRS) - derives the percent from system data. */
  retirementSystem?: string;
  garnishment?: GarnishmentOrder;
}

export interface Address {
  state: string;
  /** Local jurisdiction codes where the employee lives (city, county, school district, PSD). */
  localCodes?: string[];
  zip?: string;
}

export interface EmployeeInput {
  id: string;
  name?: string;
  birthDate?: string;
  federalW4: FederalW4;
  stateW4?: Record<string, StateW4>;
  residence: Address;
  work: WorkAllocation[];
  /** State used for SUI/SDI/PFML (localization). Defaults to the largest work allocation. */
  unemploymentState?: string;
  /** Covered by Social Security (false for many public employees, e.g. most Texas TRS districts). */
  socialSecurityCovered?: boolean;
  /** Covered by Medicare (true for public employees hired after 3/31/1986). */
  medicareCovered?: boolean;
  /** Per-employee toggles keyed by `${jurisdiction}.${kind}` or rule id: false switches a tax off. */
  taxToggles?: Record<string, boolean>;
  /** Prior-year FICA wages from this employer (Roth catch-up rule). */
  priorYearFicaWages?: number;
}

export interface EmployerInput {
  id: string;
  name: string;
  fein?: string;
  /** Primary office state (convenience-of-employer sourcing). */
  homeState?: string;
  /** Assigned SUI rates by state (decimal). */
  suiRates?: Record<string, number>;
  /** Client-level toggles keyed by `${jurisdiction}.${kind}` or rule id. */
  taxToggles?: Record<string, boolean>;
  /** Assigned rates for other employer-rated programs, keyed by `${jurisdiction}.${kind}`. */
  rateOverrides?: Record<string, number>;
  /** 501(c)(3) and government employers are FUTA-exempt. */
  futaExempt?: boolean;
  /** Headcount for PFML size thresholds. */
  employeeCount?: number;
  /** Withhold resident local tax (with credit) when the employee lives in a different taxing city (OH courtesy withholding). */
  withholdResidentLocal?: boolean;
}

/** Year-to-date taxable wages and taxes keyed by `${jurisdiction}.${kind}`, plus totals. */
export interface YearToDate {
  taxableWages?: Record<string, number>;
  taxes?: Record<string, number>;
  /** YTD supplemental wages (for the $1M mandatory 37% rule). */
  supplementalWages?: number;
  /** YTD deductions by code (for annual limits). */
  deductions?: Record<string, number>;
  /** YTD gross by month key 'YYYY-MM' (OPT minimums). */
  grossByMonth?: Record<string, number>;
  /** Number of checks already issued this quarter (quarterly fees). */
  checksThisQuarter?: number;
}

export interface PayInput {
  checkDate: string;
  payFrequency: PayFrequency;
  employee: EmployeeInput;
  employer: EmployerInput;
  earnings: EarningLine[];
  deductions?: DeductionLine[];
  ytd?: YearToDate;
  /** Vendor calculation conventions to emulate. Defaults to IRS by-the-book. */
  conventions?: Partial<VendorConventions>;
  /** Label of the vendor profile used (for the audit trail). */
  vendorProfileId?: string;
  /** Run type: actual, mock (simulation) or proposal (eligibility / savings modeling). */
  runType?: 'actual' | 'mock' | 'proposal';
}

export interface TaxLine {
  ruleId: string;
  jurisdiction: string;
  kind: TaxKind;
  name: string;
  payer: Payer;
  wageBasis: WageBasis;
  taxableWages: number;
  amount: number;
  /** Effective rate shown on the line (amount / taxable wages) when meaningful. */
  rate?: number;
  status: VerificationStatus;
  sources: string[];
  explanation: string[];
}

export interface DeductionResult {
  code: string;
  name: string;
  amount: number;
  employerPaid: boolean;
  preTax: boolean;
  notes?: string[];
}

export interface AuditEntry {
  step: string;
  detail: string;
}

export interface PayResult {
  checkDate: string;
  employeeId: string;
  grossPay: number;
  /** Gross including non-cash imputed income. */
  grossTaxableComp: number;
  earnings: { code: string; name: string; amount: number; cash: boolean; supplemental: boolean }[];
  taxableWages: Record<string, number>;
  taxes: TaxLine[];
  employeeTaxes: number;
  employerTaxes: number;
  deductions: DeductionResult[];
  netPay: number;
  employerCost: number;
  warnings: string[];
  audit: AuditEntry[];
  /** YTD after this check (feed into the next one). */
  ytdAfter: YearToDate;
  conventions: VendorConventions;
}
