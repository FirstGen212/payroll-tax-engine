/**
 * Proposal / underwriting tool: before-and-after comparison of adding a new
 * pre-tax deduction (with an optional benefit payment that gives part of it back)
 * for every employee in a census or payroll sample.
 *
 * For each employee the engine runs a full year of checks twice (without and with
 * the new deduction), so wage bases (Social Security, FUTA, SUI) are respected,
 * then applies eligibility rules and pricing tiers.
 */
import { loadTaxDatabase } from '@pte/tax-data';
import type { TaxDatabase, VendorConventions } from '@pte/tax-data';
import { runSeries } from './payrun.js';
import { cents, PERIODS_PER_YEAR, WEEKS_PER_PERIOD } from './money.js';
import type { PayFrequency } from './money.js';
import type { DeductionLine, EarningLine, FederalW4, PayInput, PayResult, StateW4 } from './types.js';

/** One employee row from an underwriting sheet, census or payroll register (already column-mapped). */
export interface CensusRow {
  rowNumber?: number;
  company?: string;
  employeeId?: string;
  firstName?: string;
  lastName?: string;
  workState?: string;
  /** Residence state when known; defaults to the work state. */
  residenceState?: string;
  /** Municipality / local name from the sheet (matched to a local jurisdiction when possible). */
  municipality?: string;
  /** Local jurisdiction codes (set by the API when the municipality matches). */
  localCodes?: string[];
  /** Gross pay per pay period (values that look annual are converted and flagged). */
  grossPay?: number;
  /** Commission / bonus / other compensation per pay period. */
  otherComp?: number;
  payFrequency?: string;
  periodsPerYear?: number;
  employmentType?: string;
  hoursPerPeriod?: number;
  hourlyRate?: number;
  federalFilingStatus?: string;
  dependentAllowances?: number;
  /** Federal W-4 Step 3 credits (annual dollars). */
  dependentCredits?: number;
  /** Additional federal withholding per check. */
  additionalFit?: number;
  /** From the sheet: does the employee currently have federal income tax withheld? */
  federalTaxPaid?: boolean | null;
  stateTaxPaid?: boolean | null;
  stateFilingStatus?: string;
  stateDependents?: number;
  additionalSit?: number;
  /** Existing monthly employee contributions. */
  healthMonthly?: number;
  otherPretaxMonthly?: number;
  retirementMonthly?: number;
  /** 401(k) as a decimal share of gross (used when no dollar amount is given). */
  retirementPercent?: number;
  postTaxMonthly?: number;
  /** Per-employee proposed deduction (e.g. the sheet's "First Gen Deduction Amount"); overrides the tier amount. */
  proposedDeduction?: number;
  tips?: number;
  pto?: number;
  reimbursements?: number;
  confidence?: number;
  birthDate?: string;
}

export interface BenefitPackage {
  id: string;
  name: string;
  /** Cost of the benefit per enrolled employee per month. */
  monthlyCost: number;
}

/** Part-time plan: rows that fail the standard plan but trigger it get a smaller deduction. */
export interface PartTimePlan {
  enabled: boolean;
  deductionPerCheck: number;
  /** Minimum monthly allotment for the part-time plan. */
  allotmentThreshold: number;
  /** Triggers: average hours per week at or below this, or annual gross below maxAnnualGross. */
  maxHoursPerWeek: number;
  maxAnnualGross: number;
}

/** A reviewer's decision for one row, keyed by the employee result's `key`. */
export interface EmployeeOverride {
  /** Leave the row out of the proposal entirely. */
  exclude?: boolean;
  /** Force a status after the calculation: put them on the full plan, the part-time plan, or mark them not eligible. */
  status?: 'Eligible' | 'PT Eligible' | 'Not Eligible';
  /** Use this First Gen deduction per check instead of the file or default amount. */
  deductionPerCheck?: number;
  /** Use these average hours per pay period instead of the file's. */
  hoursPerPeriod?: number;
  /** Why the reviewer changed it (shown in results and the audit trail). */
  note?: string;
}

export interface ProposalSettings {
  /** Plan year: the engine runs every check date in this year. */
  year: number;
  /** First Gen pre-tax deduction per check when the file has no per-employee amount. */
  deductionPerCheck: number;
  /** Use the file's per-employee deduction amount when present. */
  useRowDeduction: boolean;
  rowDeductionPer: 'check' | 'month';
  benefitPackages: BenefitPackage[];
  benefitPackageId: string;
  /** Program price: the monthly allotment an employee needs to be eligible. */
  allotmentThreshold: number;
  /** Price points compared in the margin strategy analyzer. */
  programPrices: number[];
  /** Annual gross at or below this is "Low Income". */
  lowIncomeMax: number;
  /** Minimum average hours per pay period. */
  minHoursPerPeriod: number;
  /** Minimum state income tax per period in states that have one (flagged when below). */
  stateTaxThreshold: number;
  /** Monthly allotment at or above this goes to NEEDS REVIEW. */
  needsReviewAllotment: number;
  /** Monthly allotment = employee monthly tax savings x this buffer. */
  allotmentBuffer: number;
  /** Employees the file marks as having no federal tax withheld: a warning (still eligible) or their own status. */
  noFederalTaxAs: 'warning' | 'status';
  /** Add commission / bonus / other comp to gross pay. */
  includeCommission: boolean;
  /** Count an employee once when the same company + ID + name appears on several rows. */
  dedupe: boolean;
  partTime: PartTimePlan;
  /** Employer savings basis: Social Security + Medicare only (7.65%), or all employer taxes (adds FUTA, SUI, etc.). */
  employerSavingsBasis: 'fica' | 'all';
  /** Share of the deduction returned to the employee each check as a tax-free benefit payment (for the take-home view). */
  benefitPaybackPercent: number;
  /** EBITDA multiple for the valuation-increase estimate. */
  ebitdaMultiple: number;
  industry?: string;
  ownership?: 'private' | 'public';
  /** Hours assumed for salaried rows with no hours. */
  salariedHoursPerWeek: number;
  /** Gross values at or above this are treated as annual and divided by periods. */
  annualGrossThreshold: number;
  /** Rows with a data-confidence score below this go to NEEDS REVIEW (0 = off). */
  reviewMinConfidence: number;
  employer: { name?: string; homeState?: string; suiRates?: Record<string, number>; futaExempt?: boolean };
  conventions?: Partial<VendorConventions>;
  vendorProfileId?: string;
  /** Share of eligible employees expected to enroll (1 = all). Scales savings, allotments and valuation. */
  participationRate: number;
  /** Per-employee reviewer decisions. */
  overrides: Record<string, EmployeeOverride>;
}

export const DEFAULT_PROPOSAL_SETTINGS: ProposalSettings = {
  year: 2027,
  deductionPerCheck: 298.38,
  useRowDeduction: true,
  rowDeductionPer: 'check',
  benefitPackages: [
    { id: 'mec', name: 'MEC', monthlyCost: 55 },
    { id: 'standard', name: 'Standard', monthlyCost: 65 },
    { id: 'mec_plus', name: 'MEC Plus', monthlyCost: 95 },
  ],
  benefitPackageId: 'standard',
  allotmentThreshold: 149,
  programPrices: [159, 149, 139, 129],
  lowIncomeMax: 26000,
  minHoursPerPeriod: 23,
  stateTaxThreshold: 0.01,
  needsReviewAllotment: 401,
  allotmentBuffer: 0.75,
  noFederalTaxAs: 'warning',
  includeCommission: false,
  dedupe: false,
  partTime: { enabled: true, deductionPerCheck: 180, allotmentThreshold: 74, maxHoursPerWeek: 29, maxAnnualGross: 20000 },
  employerSavingsBasis: 'fica',
  benefitPaybackPercent: 1,
  ebitdaMultiple: 5.2,
  industry: 'Energy (Oil & Gas)',
  ownership: 'private',
  salariedHoursPerWeek: 40,
  annualGrossThreshold: 20000,
  reviewMinConfidence: 0,
  employer: {},
  participationRate: 1,
  overrides: {},
};

export type Eligibility =
  | 'Eligible'
  | 'PT Eligible'
  | 'No Federal Taxes Paid'
  | 'NEEDS REVIEW'
  | 'Not Eligible - No Gross Compensation'
  | 'Not Eligible - Insufficient Funds'
  | 'Not Eligible - Insufficient Hours'
  | 'Not Eligible - Low Income'
  | 'Not Eligible - Insufficient Savings'
  | 'Not Eligible - Insufficient Savings + No Federal Taxes Paid'
  | 'Not Eligible - Reviewer decision'
  | 'Excluded';

export const ELIGIBILITY_ORDER: Eligibility[] = [
  'Eligible',
  'PT Eligible',
  'No Federal Taxes Paid',
  'NEEDS REVIEW',
  'Not Eligible - Insufficient Savings',
  'Not Eligible - Insufficient Savings + No Federal Taxes Paid',
  'Not Eligible - Low Income',
  'Not Eligible - Insufficient Hours',
  'Not Eligible - Insufficient Funds',
  'Not Eligible - No Gross Compensation',
  'Not Eligible - Reviewer decision',
  'Excluded',
];

export interface ScenarioTotals {
  gross: number;
  fit: number;
  fica: number;
  stateLocal: number;
  employeeTaxes: number;
  employerTaxes: number;
  /** Employer Social Security + Medicare. */
  employerFica: number;
  newDeduction: number;
  otherDeductions: number;
  benefitPayment: number;
  netPay: number;
}

/** Per-pay-period view, as payroll registers show it. */
export interface PerPeriod {
  gross: number;
  firstGen: number;
  deductions: number;
  /** Net after the First Gen deduction (before any benefit payment back). */
  net: number;
  taxBefore: number;
  taxAfter: number;
  stateTaxBefore: number;
  /** Employee taxes after / gross. */
  effectiveRate: number;
}

export interface PlanCalc {
  deductionPerCheck: number;
  perPeriod: PerPeriod;
  check: { before: ScenarioTotals; after: ScenarioTotals };
  annual: { before: ScenarioTotals; after: ScenarioTotals };
  monthly: {
    employeeTaxBefore: number;
    employeeTaxAfter: number;
    employeeTaxSavings: number;
    employerTaxSavings: number;
    allotment: number;
    /** Take-home change per month including the benefit payment back. */
    employeeNetGain: number;
  };
}

export interface ProposalEmployeeResult extends Partial<PlanCalc> {
  key: string;
  row: CensusRow;
  name: string;
  frequency?: PayFrequency;
  periodsPerYear?: number;
  hoursPerPeriod?: number;
  hoursPerWeek?: number;
  annualGross?: number;
  eligibility: Eligibility;
  /** Status under the standard plan before the part-time plan was tried. */
  standardEligibility?: Eligibility;
  /** Gates other than savings pass (used for price-point analysis). */
  passesNonSavingsRules: boolean;
  partTime?: { triggers: string[]; deductionPerCheck: number; allotment: number; savingsDelta: number; eligible: boolean; calc: PlanCalc };
  reasons: string[];
  flags: string[];
  /** The reviewer override applied to this row, if any. */
  override?: EmployeeOverride;
}

export interface ProgramAnalysis {
  price: number;
  eligible: number;
  partTimeEligible: number;
  monthlyRevenue: number;
  monthlyBenefitCost: number;
  monthlyMargin: number;
  marginPercent: number;
  annualMargin: number;
}

export interface ProposalSummary {
  rowsInFile: number;
  employees: number;
  byEligibility: Record<string, number>;
  eligibleFull: number;
  eligiblePartTime: number;
  eligibleTotal: number;
  /** Sum of monthly allotments of eligible employees (full + part-time). */
  monthlySavings: { total: number; full: number; partTime: number; average: number; annual: number };
  /** Employer tax savings of eligible employees (basis per settings). */
  employerAnnualSavings: { total: number; full: number; partTime: number; perEmployee: number };
  employeeAnnualTaxSavings: number;
  valuationIncrease: number;
  allotmentDistribution: { below: number; near: number; atOrAbove: number; lowEdge: number; highEdge: number };
  programs: ProgramAnalysis[];
  benefitPackage: BenefitPackage;
  dataWarnings: number;
  duplicates: { rowNumber?: number; duplicateOf?: number; name: string }[];
  /** Most common pay frequency among eligible employees (for "per pay period" figures). */
  payFrequency: { frequency?: PayFrequency; periodsPerYear: number; employees: number };
  /** Eligible employees expected to enroll at the participation rate. */
  projectedEnrolled: number;
  participationRate: number;
  overridesApplied: number;
  byCompany: { company: string; employees: number; eligible: number; monthlySavings: number; employerAnnualSavings: number }[];
}

export interface ProposalResult {
  settings: ProposalSettings;
  employees: ProposalEmployeeResult[];
  summary: ProposalSummary;
}

const FREQ_ALIASES: Record<string, PayFrequency> = {
  w: 'weekly', wk: 'weekly', weekly: 'weekly',
  bw: 'biweekly', biweekly: 'biweekly', 'bi-weekly': 'biweekly', 'every two weeks': 'biweekly', fortnightly: 'biweekly',
  sm: 'semimonthly', semimonthly: 'semimonthly', 'semi-monthly': 'semimonthly', 'twice a month': 'semimonthly',
  m: 'monthly', mo: 'monthly', monthly: 'monthly',
  d: 'daily', daily: 'daily', q: 'quarterly', quarterly: 'quarterly', a: 'annual', annual: 'annual', annually: 'annual', yearly: 'annual',
};

export function parseFrequency(freq?: string, periods?: number): PayFrequency | undefined {
  const f = freq?.toLowerCase().trim().replace(/\s+/g, ' ');
  if (f && FREQ_ALIASES[f]) return FREQ_ALIASES[f];
  if (f && FREQ_ALIASES[f.replace(/[^a-z]/g, '')]) return FREQ_ALIASES[f.replace(/[^a-z]/g, '')];
  const byPeriods = Object.entries(PERIODS_PER_YEAR).find(([, n]) => n === periods);
  return byPeriods?.[0] as PayFrequency | undefined;
}

/** Map W-4 marital / filing status text to the engine's federal status. */
export function parseFederalStatus(s?: string): FederalW4['filingStatus'] | undefined {
  if (!s) return undefined;
  const t = s.toLowerCase();
  if (/head/.test(t) || t === 'hoh' || t === 'h') return 'hoh';
  if (/higher single|single rate|withhold at single/.test(t)) return 'mfs';
  if (/separate/.test(t) || t === 'mfs') return 'mfs';
  if (/married|joint|mfj|qualifying|widow/.test(t) || t === 'm') return 'mfj';
  if (/single|^s$/.test(t)) return 'single';
  return undefined;
}

function stateStatus(s?: string): StateW4['filingStatus'] | undefined {
  const f = parseFederalStatus(s);
  if (!f) return undefined;
  return f === 'mfs' ? 'mfs' : f;
}

const r2 = cents;

/** Check dates for every pay period in a year. */
export function checkDatesFor(year: number, freq: PayFrequency): string[] {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const out: string[] = [];
  if (freq === 'semimonthly') {
    for (let m = 0; m < 12; m++) {
      out.push(iso(new Date(Date.UTC(year, m, 15))));
      out.push(iso(new Date(Date.UTC(year, m + 1, 0))));
    }
    return out;
  }
  if (freq === 'monthly' || freq === 'quarterly' || freq === 'semiannual' || freq === 'annual') {
    const step = 12 / PERIODS_PER_YEAR[freq];
    for (let m = step - 1; m < 12; m += step) out.push(iso(new Date(Date.UTC(year, m + 1, 0))));
    return out;
  }
  // weekly / biweekly / daily: first Friday of the year, then every N days
  const days = freq === 'weekly' ? 7 : freq === 'biweekly' ? 14 : 1;
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  for (let i = 0; i < PERIODS_PER_YEAR[freq]; i++) {
    out.push(iso(d));
    d.setUTCDate(d.getUTCDate() + days);
    if (d.getUTCFullYear() !== year) break;
  }
  return out;
}

function totalsOf(results: PayResult[], deductionCode: string, benefitPerCheck: number): ScenarioTotals {
  const t: ScenarioTotals = { gross: 0, fit: 0, fica: 0, stateLocal: 0, employeeTaxes: 0, employerTaxes: 0, employerFica: 0, newDeduction: 0, otherDeductions: 0, benefitPayment: 0, netPay: 0 };
  for (const r of results) {
    t.gross += r.grossPay;
    for (const x of r.taxes) {
      if (x.payer !== 'employee') {
        if (x.kind === 'SS_ER' || x.kind === 'MED_ER') t.employerFica += x.amount;
        continue;
      }
      if (x.kind === 'FIT') t.fit += x.amount;
      else if (x.kind === 'SS_EE' || x.kind === 'MED_EE' || x.kind === 'MED_ADDL_EE') t.fica += x.amount;
      else t.stateLocal += x.amount;
    }
    t.employeeTaxes += r.employeeTaxes;
    t.employerTaxes += r.employerTaxes;
    for (const d of r.deductions) {
      if (d.employerPaid) continue;
      if (d.code === deductionCode) t.newDeduction += d.amount;
      else t.otherDeductions += d.amount;
    }
    t.benefitPayment += benefitPerCheck;
    t.netPay += r.netPay + benefitPerCheck;
  }
  for (const k of Object.keys(t) as (keyof ScenarioTotals)[]) t[k] = r2(t[k]);
  return t;
}

export const PROPOSAL_DEDUCTION_CODE = 'PROPOSED_125';

/** Turn a census row into an engine pay input (without the new deduction). */
export function payInputFromRow(row: CensusRow, freq: PayFrequency, grossPerCheck: number, s: ProposalSettings, otherComp = 0): { input: PayInput; notes: string[] } {
  const notes: string[] = [];
  const periods = PERIODS_PER_YEAR[freq];
  const perCheck = (monthly?: number) => (monthly ? r2((monthly * 12) / periods) : 0);
  const workState = row.workState!.toUpperCase();
  const resState = (row.residenceState ?? workState).toUpperCase();
  if (!row.residenceState) notes.push(`Residence assumed to be the work state (${workState}).`);

  const status = parseFederalStatus(row.federalFilingStatus) ?? 'single';
  let federalW4: FederalW4;
  if (row.dependentCredits && row.dependentCredits > 0) {
    federalW4 = { version: '2020+', filingStatus: status === 'mfs' ? 'single' : status, dependentsAmount: row.dependentCredits, extraWithholding: row.additionalFit || undefined };
  } else if (row.dependentAllowances && row.dependentAllowances > 0) {
    federalW4 = { version: 'pre2020', filingStatus: status === 'hoh' ? 'single' : status, allowances: row.dependentAllowances, extraWithholding: row.additionalFit || undefined };
    notes.push(`Federal W-4 treated as a pre-2020 form with ${row.dependentAllowances} allowance(s).`);
  } else {
    federalW4 = { version: '2020+', filingStatus: status === 'mfs' ? 'single' : status, extraWithholding: row.additionalFit || undefined };
  }
  if (status === 'mfs' && federalW4.version === '2020+') notes.push('"Married, withhold at single rate" mapped to Single on the 2020+ W-4.');

  const sw: StateW4 = {
    filingStatus: stateStatus(row.stateFilingStatus) ?? stateStatus(row.federalFilingStatus),
    allowances: row.stateDependents ?? undefined,
    dependents: row.stateDependents ?? undefined,
    additional: row.additionalSit || undefined,
  };

  const earnings: EarningLine[] = [{ code: 'REG', amount: grossPerCheck }];
  if (otherComp) earnings.push({ code: 'COMMISSION', amount: otherComp });

  const deductions: DeductionLine[] = [];
  if (row.healthMonthly) deductions.push({ code: 'MED_125', amount: perCheck(row.healthMonthly) });
  if (row.otherPretaxMonthly) deductions.push({ code: 'OTHER_125', amount: perCheck(row.otherPretaxMonthly) });
  if (row.retirementMonthly) deductions.push({ code: '401K', amount: perCheck(row.retirementMonthly) });
  else if (row.retirementPercent && row.retirementPercent > 0 && row.retirementPercent < 1) deductions.push({ code: '401K', percent: row.retirementPercent });
  if (row.postTaxMonthly) deductions.push({ code: 'OTHER_POST', amount: perCheck(row.postTaxMonthly) });

  const input: PayInput = {
    checkDate: `${s.year}-01-01`,
    payFrequency: freq,
    runType: 'proposal',
    employer: {
      id: 'proposal',
      name: s.employer.name ?? row.company ?? 'Proposal',
      homeState: s.employer.homeState ?? workState,
      suiRates: s.employer.suiRates,
      futaExempt: s.employer.futaExempt,
    },
    employee: {
      id: row.employeeId ?? String(row.rowNumber ?? ''),
      name: [row.firstName, row.lastName].filter(Boolean).join(' '),
      birthDate: row.birthDate,
      federalW4,
      stateW4: { [workState]: sw, ...(resState !== workState ? { [resState]: sw } : {}) },
      residence: { state: resState, localCodes: resState === workState ? row.localCodes : undefined },
      work: [{ state: workState, percent: 1, localCodes: row.localCodes }],
    },
    earnings,
    deductions,
    conventions: s.conventions,
    vendorProfileId: s.vendorProfileId,
  };
  return { input, notes };
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Run one employee for a full year with and without a pre-tax deduction. */
function planCalc(input: PayInput, freq: PayFrequency, grossPerCheck: number, dedPerCheck: number, s: ProposalSettings, db: TaxDatabase): PlanCalc {
  const periods = PERIODS_PER_YEAR[freq];
  const benefitPerCheck = r2(dedPerCheck * s.benefitPaybackPercent);
  const dates = checkDatesFor(s.year, freq);
  const withDed: PayInput = { ...input, deductions: [...(input.deductions ?? []), { code: PROPOSAL_DEDUCTION_CODE, amount: dedPerCheck }] };
  const before = runSeries(input, dates, db);
  const after = runSeries(withDed, dates, db);
  const aB = totalsOf(before, PROPOSAL_DEDUCTION_CODE, 0);
  const aA = totalsOf(after, PROPOSAL_DEDUCTION_CODE, benefitPerCheck);
  const cB = totalsOf(before.slice(0, 1), PROPOSAL_DEDUCTION_CODE, 0);
  const cA = totalsOf(after.slice(0, 1), PROPOSAL_DEDUCTION_CODE, benefitPerCheck);
  const eeTaxSav = r2((aB.employeeTaxes - aA.employeeTaxes) / 12);
  const erTaxSav = r2((s.employerSavingsBasis === 'fica' ? aB.employerFica - aA.employerFica : aB.employerTaxes - aA.employerTaxes) / 12);
  const grossCheck = cB.gross;
  return {
    deductionPerCheck: dedPerCheck,
    perPeriod: {
      gross: grossCheck,
      firstGen: dedPerCheck,
      deductions: cB.otherDeductions,
      net: r2(cA.netPay - cA.benefitPayment),
      taxBefore: cB.employeeTaxes,
      taxAfter: cA.employeeTaxes,
      stateTaxBefore: cB.stateLocal,
      effectiveRate: grossCheck ? Math.round((cA.employeeTaxes / grossCheck) * 1000) / 1000 : 0,
    },
    check: { before: cB, after: cA },
    annual: { before: aB, after: aA },
    monthly: {
      employeeTaxBefore: r2(aB.employeeTaxes / 12),
      employeeTaxAfter: r2(aA.employeeTaxes / 12),
      employeeTaxSavings: eeTaxSav,
      employerTaxSavings: erTaxSav,
      allotment: r2(eeTaxSav * s.allotmentBuffer),
      employeeNetGain: r2((aA.netPay - aB.netPay) / 12),
    },
  };
  void periods; void grossPerCheck;
}

function unverifiedLines(input: PayInput, s: ProposalSettings, db: TaxDatabase): string[] {
  const r = runSeries(input, [`${s.year}-01-15`], db)[0];
  return [...new Set(r.taxes.filter((t) => t.status !== 'published' && t.status !== 'draft').map((t) => `${t.jurisdiction} ${t.kind} (${t.status})`))];
}

export function evaluateEmployee(row: CensusRow, s: ProposalSettings, db: TaxDatabase): ProposalEmployeeResult {
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || row.employeeId || `Row ${row.rowNumber ?? '?'}`;
  const res: ProposalEmployeeResult = {
    key: `${row.company ?? ''}|${row.employeeId ?? ''}|${row.rowNumber ?? ''}`,
    row,
    name,
    eligibility: 'NEEDS REVIEW',
    passesNonSavingsRules: false,
    reasons: [],
    flags: [],
  };
  const fail = (e: Eligibility, why: string) => {
    res.eligibility = e;
    res.reasons.push(why);
    return res;
  };
  const ov = s.overrides?.[res.key];
  if (ov && Object.keys(ov).length) res.override = ov;
  if (ov?.exclude) return fail('Excluded', `Left out by the reviewer${ov.note ? `: ${ov.note}` : '.'}`);

  // 1. Data needed to calculate at all
  const freq = parseFrequency(row.payFrequency, row.periodsPerYear);
  let gross = Number(row.grossPay ?? 0);
  if (!(gross > 0)) return fail('Not Eligible - No Gross Compensation', 'No gross pay in the data.');
  if (!freq) return fail('NEEDS REVIEW', `Pay frequency "${row.payFrequency ?? ''}" not recognized.`);
  if (!row.workState || !/^[A-Za-z]{2}$/.test(row.workState.trim())) return fail('NEEDS REVIEW', 'Work state missing or not a 2-letter code.');
  row.workState = row.workState.trim().toUpperCase();
  if (!db.jurisdictions.some((j) => j.code === row.workState)) return fail('NEEDS REVIEW', `Work state ${row.workState} is not in the tax database.`);
  if (!parseFederalStatus(row.federalFilingStatus)) res.flags.push(`Federal filing status "${row.federalFilingStatus ?? ''}" not recognized; Single assumed.`);

  const periods = PERIODS_PER_YEAR[freq];
  if (gross >= s.annualGrossThreshold && periods > 1) {
    res.flags.push(`Gross ${gross.toLocaleString()} looks annual; divided by ${periods} pay periods.`);
    gross = r2(gross / periods);
  }
  const otherComp = s.includeCommission ? row.otherComp ?? 0 : 0;
  if (!s.includeCommission && row.otherComp) res.flags.push(`Commission/bonus of ${usd(row.otherComp)} per check left out (turn on "Include commission/bonus").`);
  res.frequency = freq;
  res.periodsPerYear = periods;
  const annualGross = r2((gross + otherComp) * periods);
  res.annualGross = annualGross;

  let hoursPerPeriod: number | undefined;
  if (row.hoursPerPeriod !== undefined && row.hoursPerPeriod !== null) hoursPerPeriod = row.hoursPerPeriod;
  if (ov?.hoursPerPeriod !== undefined && ov.hoursPerPeriod !== null) {
    res.flags.push(`Hours per period set by the reviewer: ${ov.hoursPerPeriod} (file: ${row.hoursPerPeriod ?? 'none'}).`);
    hoursPerPeriod = ov.hoursPerPeriod;
  }
  if ((!hoursPerPeriod || hoursPerPeriod <= 0) && /salar/i.test(row.employmentType ?? '')) {
    hoursPerPeriod = s.salariedHoursPerWeek * WEEKS_PER_PERIOD[freq];
    res.flags.push(`Salaried with no hours: ${s.salariedHoursPerWeek} hours/week assumed.`);
  }
  if (hoursPerPeriod !== undefined) {
    res.hoursPerPeriod = Math.round(hoursPerPeriod * 100) / 100;
    res.hoursPerWeek = Math.round((hoursPerPeriod / WEEKS_PER_PERIOD[freq]) * 10) / 10;
  }

  // 2. Before / after on the standard plan
  const useRow = s.useRowDeduction && row.proposedDeduction && row.proposedDeduction > 0;
  let dedPerCheck = r2(useRow ? (s.rowDeductionPer === 'check' ? row.proposedDeduction! : (row.proposedDeduction! * 12) / periods) : s.deductionPerCheck);
  if (ov?.deductionPerCheck !== undefined && ov.deductionPerCheck !== null && ov.deductionPerCheck > 0) {
    res.flags.push(`Deduction set by the reviewer: ${usd(ov.deductionPerCheck)} per check (was ${usd(dedPerCheck)}).`);
    dedPerCheck = r2(ov.deductionPerCheck);
  }
  const { input, notes } = payInputFromRow(row, freq, gross, s, otherComp);
  res.flags.push(...notes);
  const existing = (input.deductions ?? []).reduce((a, d) => a + (d.amount ?? (d.percent ?? 0) * gross), 0);
  const noFed = row.federalTaxPaid === false;

  if (dedPerCheck + existing > gross + otherComp) {
    res.deductionPerCheck = dedPerCheck;
    res.perPeriod = { gross: gross + otherComp, firstGen: dedPerCheck, deductions: r2(existing), net: r2(gross + otherComp - existing - dedPerCheck), taxBefore: 0, taxAfter: 0, stateTaxBefore: 0, effectiveRate: 0 };
    fail('Not Eligible - Insufficient Funds', `Deduction ${usd(dedPerCheck)} plus existing deductions exceed gross pay per check (${usd(gross + otherComp)}).`);
    return applyStatusOverride(tryPartTime(res, input, freq, gross, s, db), input, freq, gross, s, db);
  }
  Object.assign(res, planCalc(input, freq, gross, dedPerCheck, s, db));
  const unv = unverifiedLines(input, s, db);
  if (unv.length) res.flags.push(`Uses tax data not yet verified: ${unv.join(', ')}.`);
  const m = res.monthly!;

  const fitBefore = res.annual!.before.fit;
  if (row.federalTaxPaid === true && fitBefore === 0) res.flags.push('Sheet says federal tax is withheld, but the engine calculates none from this W-4 and pay.');
  if (row.federalTaxPaid === false && fitBefore > 0) res.flags.push(`Sheet says no federal tax is withheld, but the engine calculates ${usd(fitBefore / periods)} per check.`);
  const hasSit = db.rules.some((r) => r.jurisdiction === row.workState && r.kind === 'SIT' && r.calc.kind !== 'none');
  if (hasSit && res.perPeriod!.stateTaxBefore < s.stateTaxThreshold) res.flags.push(`State tax per check ${usd(res.perPeriod!.stateTaxBefore)} is below the ${usd(s.stateTaxThreshold)} state tax threshold.`);
  if (row.stateTaxPaid === true && res.perPeriod!.stateTaxBefore === 0) res.flags.push('Sheet says state tax is withheld, but the engine calculates none (no-income-tax state or below the threshold).');

  // 3. Eligibility, in the order the current tool applies it
  if (m.allotment < s.allotmentThreshold) {
    fail(noFed ? 'Not Eligible - Insufficient Savings + No Federal Taxes Paid' : 'Not Eligible - Insufficient Savings', `Monthly allotment ${usd(m.allotment)} is below the ${usd(s.allotmentThreshold)} threshold.`);
  } else if (annualGross <= s.lowIncomeMax) {
    fail('Not Eligible - Low Income', `Annual gross ${usd(annualGross)} is at or below ${usd(s.lowIncomeMax)}.`);
  } else if (noFed && s.noFederalTaxAs === 'status') {
    fail('No Federal Taxes Paid', 'No federal income tax is withheld today according to the file; review before enrolling.');
  } else if (m.allotment >= s.needsReviewAllotment) {
    fail('NEEDS REVIEW', `Monthly allotment ${usd(m.allotment)} is at or above the ${usd(s.needsReviewAllotment)} review threshold.`);
  } else if (hoursPerPeriod === undefined) {
    fail('NEEDS REVIEW', 'Hours missing for an hourly employee.');
  } else if (hoursPerPeriod < s.minHoursPerPeriod) {
    fail('Not Eligible - Insufficient Hours', `${res.hoursPerPeriod} hours per pay period is below the ${s.minHoursPerPeriod}-hour minimum.`);
  } else if (s.reviewMinConfidence > 0 && row.confidence !== undefined && row.confidence < s.reviewMinConfidence) {
    fail('NEEDS REVIEW', `Data confidence ${row.confidence} is below ${s.reviewMinConfidence}.`);
  } else {
    res.eligibility = 'Eligible';
  }
  // Everything except the allotment test (for the price-point analyzer)
  if (noFed && s.noFederalTaxAs === 'warning') res.flags.unshift('⚠ No federal income tax withheld today according to the file.');
  res.passesNonSavingsRules = annualGross > s.lowIncomeMax && !(noFed && s.noFederalTaxAs === 'status') && hoursPerPeriod !== undefined && hoursPerPeriod >= s.minHoursPerPeriod;
  return applyStatusOverride(tryPartTime(res, input, freq, gross, s, db), input, freq, gross, s, db);
}

/** A reviewer's forced status wins over the rules; the rule result is kept in standardEligibility and the reasons. */
function applyStatusOverride(res: ProposalEmployeeResult, input: PayInput, freq: PayFrequency, gross: number, s: ProposalSettings, db: TaxDatabase): ProposalEmployeeResult {
  const want = res.override?.status;
  if (!want) return res;
  const why = res.override?.note ? `: ${res.override.note}` : '';
  const ruleResult = res.eligibility;
  if (want === 'Not Eligible') {
    res.standardEligibility = ruleResult;
    res.eligibility = 'Not Eligible - Reviewer decision';
    res.reasons.push(`Marked not eligible by the reviewer (rules said ${ruleResult})${why}.`);
  } else if (want === 'Eligible') {
    if (!res.monthly) { res.reasons.push(`Reviewer asked for the full plan, but the check could not be calculated (${ruleResult}).`); return res; }
    res.standardEligibility = ruleResult;
    res.eligibility = 'Eligible';
    res.reasons.push(`Put on the full plan by the reviewer (rules said ${ruleResult})${why}.`);
  } else if (want === 'PT Eligible') {
    const existing = (input.deductions ?? []).reduce((a, d) => a + (d.amount ?? (d.percent ?? 0) * gross), 0);
    if (s.partTime.deductionPerCheck + existing > gross) { res.reasons.push(`Reviewer asked for the part-time plan, but its ${usd(s.partTime.deductionPerCheck)} deduction does not fit the check.`); return res; }
    const calc = res.partTime?.calc ?? planCalc(input, freq, gross, s.partTime.deductionPerCheck, s, db);
    res.partTime = { triggers: res.partTime?.triggers ?? ['reviewer'], deductionPerCheck: s.partTime.deductionPerCheck, allotment: calc.monthly.allotment, savingsDelta: r2(calc.monthly.allotment - (res.monthly?.allotment ?? 0)), eligible: true, calc };
    res.standardEligibility = ruleResult === 'PT Eligible' ? res.standardEligibility : ruleResult;
    res.eligibility = 'PT Eligible';
    res.reasons.push(`Put on the part-time plan by the reviewer (rules said ${ruleResult})${why}.`);
  }
  return res;
}

/** Rows that fail the standard plan but trigger the part-time plan are re-run with the smaller deduction. */
function tryPartTime(res: ProposalEmployeeResult, input: PayInput, freq: PayFrequency, gross: number, s: ProposalSettings, db: TaxDatabase): ProposalEmployeeResult {
  const pt = s.partTime;
  if (!pt?.enabled || res.eligibility === 'Eligible' || res.eligibility === 'NEEDS REVIEW' || res.eligibility === 'No Federal Taxes Paid') return res;
  if (res.eligibility === 'Not Eligible - No Gross Compensation' || res.eligibility.includes('No Federal Taxes Paid')) return res;
  const triggers: string[] = [];
  if (res.hoursPerWeek !== undefined && res.hoursPerWeek <= pt.maxHoursPerWeek) triggers.push(`≤${pt.maxHoursPerWeek}hrs`);
  if (res.annualGross !== undefined && res.annualGross < pt.maxAnnualGross) triggers.push(`<$${Math.round(pt.maxAnnualGross / 1000)}k/yr`);
  if (!triggers.length) return res;
  const existing = (input.deductions ?? []).reduce((a, d) => a + (d.amount ?? (d.percent ?? 0) * gross), 0);
  if (pt.deductionPerCheck + existing > gross) return res;
  const calc = planCalc(input, freq, gross, pt.deductionPerCheck, s, db);
  const eligible = calc.monthly.allotment >= pt.allotmentThreshold;
  res.partTime = { triggers, deductionPerCheck: pt.deductionPerCheck, allotment: calc.monthly.allotment, savingsDelta: r2(calc.monthly.allotment - (res.monthly?.allotment ?? 0)), eligible, calc };
  if (eligible) {
    res.standardEligibility = res.eligibility;
    res.eligibility = 'PT Eligible';
    res.reasons.push(`Qualifies for the part-time plan: ${usd(pt.deductionPerCheck)} per check, allotment ${usd(calc.monthly.allotment)}/month (minimum ${usd(pt.allotmentThreshold)}).`);
  }
  return res;
}

export function runProposal(rows: CensusRow[], settings: Partial<ProposalSettings> = {}, db: TaxDatabase = loadTaxDatabase()): ProposalResult {
  const s: ProposalSettings = {
    ...DEFAULT_PROPOSAL_SETTINGS,
    ...settings,
    partTime: { ...DEFAULT_PROPOSAL_SETTINGS.partTime, ...(settings.partTime ?? {}) },
    employer: { ...DEFAULT_PROPOSAL_SETTINGS.employer, ...(settings.employer ?? {}) },
    overrides: settings.overrides ?? {},
    participationRate: settings.participationRate ?? DEFAULT_PROPOSAL_SETTINGS.participationRate,
  };
  const rate = Math.min(1, Math.max(0, s.participationRate));
  // The same employee can appear more than once (several checks in a register).
  const seen = new Map<string, number>();
  const duplicates: { rowNumber?: number; duplicateOf?: number; name: string }[] = [];
  for (const r of rows) {
    if (!r.employeeId && !r.firstName && !r.lastName) continue;
    const who = `${r.company ?? ''}|${r.employeeId ?? ''}|${r.firstName ?? ''}|${r.lastName ?? ''}`.toLowerCase();
    if (seen.has(who)) duplicates.push({ rowNumber: r.rowNumber, duplicateOf: seen.get(who), name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.employeeId || '' });
    else seen.set(who, r.rowNumber ?? 0);
  }
  const skip = new Set(s.dedupe ? duplicates.map((d) => d.rowNumber) : []);
  const employees = rows.filter((r) => !skip.has(r.rowNumber)).map((r) => evaluateEmployee({ ...r }, s, db));

  const byEligibility: Record<string, number> = {};
  for (const e of employees) byEligibility[e.eligibility] = (byEligibility[e.eligibility] ?? 0) + 1;
  const full = employees.filter((e) => e.eligibility === 'Eligible');
  const pt = employees.filter((e) => e.eligibility === 'PT Eligible');
  const sum = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));
  const msFull = sum(full.map((e) => e.monthly!.allotment));
  const msPt = sum(pt.map((e) => e.partTime!.allotment));
  const erFull = sum(full.map((e) => e.monthly!.employerTaxSavings * 12));
  const erPt = sum(pt.map((e) => e.partTime!.calc.monthly.employerTaxSavings * 12));
  const pkg = s.benefitPackages.find((p) => p.id === s.benefitPackageId) ?? s.benefitPackages[0];
  const withAllot = employees.filter((e) => e.monthly);
  const prices = [...s.programPrices].sort((a, b) => b - a);
  const lowEdge = s.allotmentThreshold - 10;

  const programs: ProgramAnalysis[] = prices.map((price) => {
    const eligible = employees.filter((e) => e.passesNonSavingsRules && e.monthly && e.monthly.allotment >= price && e.monthly.allotment < s.needsReviewAllotment).length;
    const revenue = eligible * price;
    const cost = eligible * (pkg?.monthlyCost ?? 0);
    return { price, eligible, partTimeEligible: pt.length, monthlyRevenue: r2(revenue), monthlyBenefitCost: r2(cost), monthlyMargin: r2(revenue - cost), marginPercent: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 1000 : 0, annualMargin: r2((revenue - cost) * 12) };
  });

  const erTotal = r2((erFull + erPt) * rate);
  const freqCount = new Map<PayFrequency, number>();
  for (const e of [...full, ...pt]) if (e.frequency) freqCount.set(e.frequency, (freqCount.get(e.frequency) ?? 0) + 1);
  const topFreq = [...freqCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const companies = new Map<string, { company: string; employees: number; eligible: number; monthlySavings: number; employerAnnualSavings: number }>();
  for (const e of employees) {
    const c = e.row.company?.trim() || '(no company)';
    const x = companies.get(c) ?? { company: c, employees: 0, eligible: 0, monthlySavings: 0, employerAnnualSavings: 0 };
    x.employees++;
    if (e.eligibility === 'Eligible') { x.eligible++; x.monthlySavings += e.monthly!.allotment * rate; x.employerAnnualSavings += e.monthly!.employerTaxSavings * 12 * rate; }
    if (e.eligibility === 'PT Eligible') { x.eligible++; x.monthlySavings += e.partTime!.allotment * rate; x.employerAnnualSavings += e.partTime!.calc.monthly.employerTaxSavings * 12 * rate; }
    companies.set(c, x);
  }
  return {
    settings: s,
    employees,
    summary: {
      rowsInFile: rows.length,
      employees: employees.length,
      byEligibility,
      eligibleFull: full.length,
      eligiblePartTime: pt.length,
      eligibleTotal: full.length + pt.length,
      monthlySavings: { total: r2((msFull + msPt) * rate), full: r2(msFull * rate), partTime: r2(msPt * rate), average: full.length ? r2(msFull / full.length) : 0, annual: r2((msFull + msPt) * 12 * rate) },
      employerAnnualSavings: { total: erTotal, full: r2(erFull * rate), partTime: r2(erPt * rate), perEmployee: full.length ? r2(erFull / full.length) : 0 },
      employeeAnnualTaxSavings: r2(sum(full.map((e) => e.monthly!.employeeTaxSavings * 12).concat(pt.map((e) => e.partTime!.calc.monthly.employeeTaxSavings * 12))) * rate),
      valuationIncrease: r2(erTotal * s.ebitdaMultiple),
      allotmentDistribution: {
        below: withAllot.filter((e) => e.monthly!.allotment < lowEdge).length,
        near: withAllot.filter((e) => e.monthly!.allotment >= lowEdge && e.monthly!.allotment < s.allotmentThreshold).length,
        atOrAbove: withAllot.filter((e) => e.monthly!.allotment >= s.allotmentThreshold).length,
        lowEdge,
        highEdge: s.allotmentThreshold,
      },
      programs,
      benefitPackage: pkg,
      dataWarnings: employees.reduce((a, e) => a + e.flags.length, 0),
      duplicates,
      payFrequency: { frequency: topFreq?.[0], periodsPerYear: topFreq ? PERIODS_PER_YEAR[topFreq[0]] : 26, employees: topFreq?.[1] ?? 0 },
      projectedEnrolled: Math.round((full.length + pt.length) * rate),
      participationRate: rate,
      overridesApplied: employees.filter((e) => e.override).length,
      byCompany: [...companies.values()].map((c) => ({ ...c, monthlySavings: r2(c.monthlySavings), employerAnnualSavings: r2(c.employerAnnualSavings) })).sort((a, b) => b.employerAnnualSavings - a.employerAnnualSavings),
    },
  };
}

/** Header aliases for auto-mapping uploaded sheets (lower-cased, punctuation-stripped). */
export const CENSUS_COLUMN_ALIASES: Record<keyof CensusRow, string[]> = {
  rowNumber: [],
  company: ['company name', 'company', 'client', 'employer', 'business name'],
  employeeId: ['emp id', 'employee id', 'employee number', 'employee', 'file number', 'position id', 'id'],
  firstName: ['employee first name', 'first name', 'first'],
  lastName: ['employee last name', 'last name', 'last'],
  workState: ['work state', 'state', 'worked state', 'sui state'],
  residenceState: ['residence state', 'home state', 'resident state', 'lived in state'],
  municipality: ['municipality if any', 'municipality', 'city', 'locality', 'local', 'county'],
  localCodes: [],
  grossPay: ['gross pay per pay period or yearly', 'gross pay per pay period', 'gross pay', 'gross', 'gross wages'],
  otherComp: ['commissionbonusother comps', 'commission bonus other comps', 'commission', 'bonus', 'other comp'],
  payFrequency: ['pay frequency', 'frequency', 'pay period'],
  periodsPerYear: ['', 'pay periods', 'periods per year'],
  employmentType: ['employment type salary or hourly', 'employment type', 'pay type', 'salary or hourly'],
  hoursPerPeriod: ['average hour per pay period', 'average hours per pay period', 'hours per pay period', 'hours'],
  hourlyRate: ['hourly rate', 'rate'],
  federalFilingStatus: ['federal w4 marital status', 'federal marital status', 'federal filing status', 'filing status', 'marital status'],
  dependentAllowances: ['dependent allowances', 'allowances', 'federal allowances'],
  dependentCredits: ['dependent credits', 'step 3', 'dependents amount'],
  additionalFit: ['additional fitwh', 'additional federal withholding', 'extra federal'],
  federalTaxPaid: ['federal tax before', 'federal tax paid', 'fed tax'],
  stateTaxPaid: ['state tax before', 'state tax paid'],
  stateFilingStatus: ['state marital withholding status', 'state filing status', 'state marital status'],
  stateDependents: ['state withholding dependents', 'state dependents', 'state allowances'],
  additionalSit: ['addition sitwh', 'additional sitwh', 'additional state withholding'],
  healthMonthly: ['group health monthly employee contribution', 'group health monthly', 'health monthly', 'medical monthly'],
  otherPretaxMonthly: ['pretax monthly deduction other amount', 'pre-tax monthly deduction other $ amount', 'other pretax monthly'],
  retirementMonthly: ['pretax monthly deduction 401k ira amount', '401k amount', '401k monthly', 'retirement monthly'],
  retirementPercent: ['if percent 401k', '401k percent', '401k %'],
  postTaxMonthly: ['posttax', 'post-tax', 'post tax monthly', 'after tax deductions'],
  proposedDeduction: ['first gen deduction amount', 'proposed deduction', 'new deduction', 'deduction amount'],
  tips: ['tips'],
  pto: ['pto'],
  reimbursements: ['reimbursementsmiscellaneous', 'reimbursements miscellaneous', 'reimbursements'],
  confidence: ['confidence'],
  birthDate: ['birth date', 'date of birth', 'dob'],
};

export const normalizeHeader = (h: string) => h.toLowerCase().replace(/-/g, '').replace(/[$*#()/\\?_.:,]+/g, ' ').replace(/[^a-z0-9% ]/g, '').replace(/\s+/g, ' ').trim();

/** Suggest a mapping of census fields to sheet headers. */
export function autoMapColumns(headers: string[]): Partial<Record<keyof CensusRow, string>> {
  const out: Partial<Record<keyof CensusRow, string>> = {};
  const norm = headers.map((h) => ({ h, n: normalizeHeader(h ?? '') }));
  const used = new Set<string>();
  // exact matches first, then "starts with"
  for (const pass of ['exact', 'prefix'] as const)
    for (const [field, aliases] of Object.entries(CENSUS_COLUMN_ALIASES) as [keyof CensusRow, string[]][]) {
      if (out[field]) continue;
      for (const a of aliases.map(normalizeHeader)) {
        const hit = norm.find((x) => !used.has(x.h) && (pass === 'exact' ? x.n === a : a.length > 3 && x.n.startsWith(a)));
        if (hit) {
          out[field] = hit.h;
          used.add(hit.h);
          break;
        }
      }
    }
  // The underwriting sheet labels pay periods per year as "#".
  const hash = headers.find((h) => h?.trim() === '#');
  if (hash && !out.periodsPerYear) out.periodsPerYear = hash;
  return out;
}

const NUMERIC: (keyof CensusRow)[] = ['grossPay', 'otherComp', 'periodsPerYear', 'hoursPerPeriod', 'hourlyRate', 'dependentAllowances', 'dependentCredits', 'additionalFit', 'stateDependents', 'additionalSit', 'healthMonthly', 'otherPretaxMonthly', 'retirementMonthly', 'retirementPercent', 'postTaxMonthly', 'proposedDeduction', 'tips', 'pto', 'reimbursements', 'confidence'];
const BOOL: (keyof CensusRow)[] = ['federalTaxPaid', 'stateTaxPaid'];

function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const s = String(v).replace(/[$,\s]/g, '');
  if (s.endsWith('%')) return Number(s.slice(0, -1)) / 100;
  const n = Number(s.replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : undefined;
}

function toBool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v > 0;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y', 'x', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0', 'none'].includes(s)) return false;
  const n = toNumber(s);
  return n === undefined ? null : n > 0;
}

/** Convert raw sheet rows (objects keyed by header) into census rows using a column mapping. */
export function rowsFromSheet(raw: Record<string, unknown>[], mapping: Partial<Record<keyof CensusRow, string>>): CensusRow[] {
  const out: CensusRow[] = [];
  raw.forEach((r, i) => {
    const row: CensusRow = { rowNumber: i + 2 };
    for (const [field, header] of Object.entries(mapping) as [keyof CensusRow, string][]) {
      if (!header) continue;
      const v = r[header];
      if (NUMERIC.includes(field)) (row as any)[field] = toNumber(v);
      else if (BOOL.includes(field)) (row as any)[field] = toBool(v);
      else if (v !== null && v !== undefined && String(v).trim() !== '') (row as any)[field] = String(v).trim();
    }
    if (Object.keys(row).length > 1 && (row.firstName || row.lastName || row.employeeId || row.grossPay !== undefined)) out.push(row);
  });
  return out;
}
