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

export interface ProposalTier {
  id: string;
  name: string;
  /** Employees qualify for the highest tier whose minimums they meet. */
  minHoursPerWeek: number;
  minAnnualGross?: number;
  /** New pre-tax deduction. */
  deductionAmount: number;
  deductionPer: 'check' | 'month';
  /** Share of the deduction paid back to the employee each check as a non-taxable benefit payment (0-1). */
  benefitOffsetPercent: number;
  /** Fee charged to the employer per employee per month (pricing). */
  employerFeeMonthly: number;
  /** Fee charged to the employee per month, after tax (pricing). */
  employeeFeeMonthly: number;
}

export interface ProposalSettings {
  /** Plan year: the engine runs every check date in this year. */
  year: number;
  tiers: ProposalTier[];
  /** Use the per-row proposed deduction from the sheet when present. */
  useRowDeduction: boolean;
  /** Is the row deduction per check or per month? */
  rowDeductionPer: 'check' | 'month';
  /** Annual gross at or below this is "Low Income". */
  lowIncomeMax: number;
  /** Hours per week above this are flagged as suspicious. */
  maxHoursPerWeek: number;
  /** Rows with a data-confidence score below this go to NEEDS REVIEW (0 = off). */
  reviewMinConfidence: number;
  /** Minimum monthly increase in the employee's take-home pay after fees. */
  minMonthlyEmployeeGain: number;
  /** Minimum monthly employer savings after fees (0 = must not cost the employer). */
  minMonthlyEmployerGain: number;
  /** Monthly allotment = percent x base (the sheet's "Monthly Allotment (75%)"). */
  allotmentPercent: number;
  allotmentBase: 'deduction' | 'employee_tax_savings' | 'total_tax_savings';
  /** Count an employee once when the same company + ID + name appears on several rows. */
  dedupe: boolean;
  /** Hours assumed for salaried rows with no hours. */
  salariedHoursPerWeek: number;
  /** Gross values at or above this are treated as annual and divided by periods. */
  annualGrossThreshold: number;
  employer: { name?: string; homeState?: string; suiRates?: Record<string, number>; futaExempt?: boolean };
  conventions?: Partial<VendorConventions>;
  vendorProfileId?: string;
}

export const DEFAULT_PROPOSAL_SETTINGS: ProposalSettings = {
  year: 2027,
  tiers: [
    { id: 'ft', name: 'Full-time', minHoursPerWeek: 30, deductionAmount: 298.38, deductionPer: 'check', benefitOffsetPercent: 1, employerFeeMonthly: 0, employeeFeeMonthly: 0 },
    { id: 'pt', name: 'Part-time', minHoursPerWeek: 25, deductionAmount: 172.15, deductionPer: 'check', benefitOffsetPercent: 1, employerFeeMonthly: 0, employeeFeeMonthly: 0 },
  ],
  useRowDeduction: true,
  rowDeductionPer: 'check',
  lowIncomeMax: 26000,
  maxHoursPerWeek: 80,
  reviewMinConfidence: 0,
  minMonthlyEmployeeGain: 25,
  minMonthlyEmployerGain: 0,
  allotmentPercent: 0.75,
  allotmentBase: 'deduction',
  dedupe: true,
  salariedHoursPerWeek: 40,
  annualGrossThreshold: 20000,
  employer: {},
};

export type Eligibility =
  | 'Eligible'
  | 'No Federal Taxes Paid'
  | 'NEEDS REVIEW'
  | 'Not Eligible - No Gross Compensation'
  | 'Not Eligible - Insufficient Hours'
  | 'Not Eligible - Low Income'
  | 'Not Eligible - Insufficient Savings'
  | 'Not Eligible - Insufficient Savings + No Federal Taxes Paid';

export const ELIGIBILITY_ORDER: Eligibility[] = [
  'Eligible',
  'No Federal Taxes Paid',
  'NEEDS REVIEW',
  'Not Eligible - Insufficient Savings',
  'Not Eligible - Insufficient Savings + No Federal Taxes Paid',
  'Not Eligible - Low Income',
  'Not Eligible - Insufficient Hours',
  'Not Eligible - No Gross Compensation',
];

export interface ScenarioTotals {
  gross: number;
  fit: number;
  fica: number;
  stateLocal: number;
  employeeTaxes: number;
  employerTaxes: number;
  newDeduction: number;
  benefitPayment: number;
  netPay: number;
}

export interface ProposalEmployeeResult {
  key: string;
  row: CensusRow;
  name: string;
  frequency?: PayFrequency;
  periodsPerYear?: number;
  hoursPerWeek?: number;
  annualGross?: number;
  tier?: string;
  deductionPerCheck?: number;
  /** Typical check (first check of the year). */
  check?: { before: ScenarioTotals; after: ScenarioTotals };
  /** Full-year totals. */
  annual?: { before: ScenarioTotals; after: ScenarioTotals };
  monthly?: {
    employeeTaxBefore: number;
    employeeTaxAfter: number;
    employeeTaxSavings: number;
    employerTaxSavings: number;
    employeeNetGain: number;
    employerNetGain: number;
    allotment: number;
    employerFee: number;
    employeeFee: number;
  };
  eligibility: Eligibility;
  /** Eligibility on tax savings alone, before tier fees. */
  eligibleBeforePricing: boolean;
  reasons: string[];
  flags: string[];
}

export interface ProposalSummary {
  employees: number;
  byEligibility: Record<string, number>;
  eligibleBeforePricing: number;
  eligibleAfterPricing: number;
  /** Annual totals for the eligible group. */
  eligible: {
    count: number;
    employerTaxSavings: number;
    employeeTaxSavings: number;
    employerFees: number;
    employeeFees: number;
    employerNetSavings: number;
    employeeNetGain: number;
    newDeductions: number;
    avgEmployeeMonthlyGain: number;
    avgEmployerMonthlySavings: number;
  };
  byTier: Record<string, number>;
  dataWarnings: number;
  rowsInFile: number;
  /** Rows skipped because the same employee already appeared earlier in the file. */
  duplicates: { rowNumber?: number; duplicateOf?: number; name: string }[];
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
  const t: ScenarioTotals = { gross: 0, fit: 0, fica: 0, stateLocal: 0, employeeTaxes: 0, employerTaxes: 0, newDeduction: 0, benefitPayment: 0, netPay: 0 };
  for (const r of results) {
    t.gross += r.grossPay;
    for (const x of r.taxes) {
      if (x.payer !== 'employee') continue;
      if (x.kind === 'FIT') t.fit += x.amount;
      else if (x.kind === 'SS_EE' || x.kind === 'MED_EE' || x.kind === 'MED_ADDL_EE') t.fica += x.amount;
      else t.stateLocal += x.amount;
    }
    t.employeeTaxes += r.employeeTaxes;
    t.employerTaxes += r.employerTaxes;
    t.newDeduction += r.deductions.filter((d) => d.code === deductionCode).reduce((a, d) => a + d.amount, 0);
    t.benefitPayment += benefitPerCheck;
    t.netPay += r.netPay + benefitPerCheck;
  }
  for (const k of Object.keys(t) as (keyof ScenarioTotals)[]) t[k] = r2(t[k]);
  return t;
}

export const PROPOSAL_DEDUCTION_CODE = 'PROPOSED_125';

/** Turn a census row into an engine pay input (without the new deduction). */
export function payInputFromRow(row: CensusRow, freq: PayFrequency, grossPerCheck: number, s: ProposalSettings): { input: PayInput; notes: string[] } {
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
  if (row.otherComp) earnings.push({ code: 'COMMISSION', amount: row.otherComp });

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

function pickTier(tiers: ProposalTier[], hoursPerWeek: number, annualGross: number): ProposalTier | undefined {
  const sorted = [...tiers].sort((a, b) => b.minHoursPerWeek - a.minHoursPerWeek || (b.minAnnualGross ?? 0) - (a.minAnnualGross ?? 0));
  return sorted.find((t) => hoursPerWeek >= t.minHoursPerWeek && annualGross >= (t.minAnnualGross ?? 0));
}

export function evaluateEmployee(row: CensusRow, s: ProposalSettings, db: TaxDatabase): ProposalEmployeeResult {
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || row.employeeId || `Row ${row.rowNumber ?? '?'}`;
  const res: ProposalEmployeeResult = {
    key: `${row.company ?? ''}|${row.employeeId ?? ''}|${row.rowNumber ?? ''}`,
    row,
    name,
    eligibility: 'NEEDS REVIEW',
    eligibleBeforePricing: false,
    reasons: [],
    flags: [],
  };
  const fail = (e: Eligibility, why: string) => {
    res.eligibility = e;
    res.reasons.push(why);
    return res;
  };
  const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

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
  res.frequency = freq;
  res.periodsPerYear = periods;
  const annualGross = r2((gross + (row.otherComp ?? 0)) * periods);
  res.annualGross = annualGross;

  let hoursPerWeek: number | undefined;
  if (row.hoursPerPeriod && row.hoursPerPeriod > 0) hoursPerWeek = row.hoursPerPeriod / WEEKS_PER_PERIOD[freq];
  else if (/salar/i.test(row.employmentType ?? '')) {
    hoursPerWeek = s.salariedHoursPerWeek;
    res.flags.push(`Salaried with no hours: ${s.salariedHoursPerWeek} hours/week assumed.`);
  }
  if (hoursPerWeek !== undefined) res.hoursPerWeek = Math.round(hoursPerWeek * 10) / 10;
  if (hoursPerWeek !== undefined && hoursPerWeek > s.maxHoursPerWeek) res.flags.push(`${res.hoursPerWeek} hours/week is above ${s.maxHoursPerWeek}; check the hours column.`);

  // 2. Tier by hours (highest qualifying); when none qualifies, price on the lowest tier so savings can still be shown.
  const qualified = hoursPerWeek === undefined ? undefined : pickTier(s.tiers, hoursPerWeek, annualGross);
  const tier = qualified ?? [...s.tiers].sort((a, b) => a.minHoursPerWeek - b.minHoursPerWeek)[0];
  if (!tier) return fail('NEEDS REVIEW', 'No pricing tiers are set up.');
  res.tier = qualified?.name;
  if (!qualified) res.flags.push(`Below every tier's hours minimum; savings shown using the ${tier.name} tier pricing.`);

  const useRow = s.useRowDeduction && row.proposedDeduction && row.proposedDeduction > 0;
  const amount = useRow ? row.proposedDeduction! : tier.deductionAmount;
  const per = useRow ? s.rowDeductionPer : tier.deductionPer;
  const dedPerCheck = r2(per === 'check' ? amount : (amount * 12) / periods);
  res.deductionPerCheck = dedPerCheck;
  const benefitPerCheck = r2(dedPerCheck * tier.benefitOffsetPercent);

  const { input, notes } = payInputFromRow(row, freq, gross, s);
  res.flags.push(...notes);
  const fitCalcFor = (r: PayResult[]) => r.reduce((a, x) => a + x.taxes.filter((t) => t.kind === 'FIT').reduce((b, t) => b + t.amount, 0), 0);
  const existingPretax = (input.deductions ?? []).reduce((a, d) => a + (d.amount ?? (d.percent ?? 0) * gross), 0);
  const noFedFromSheet = row.federalTaxPaid === false;

  // 3. Before / after, full year
  if (dedPerCheck + existingPretax > gross) {
    const why = `New deduction ${usd(dedPerCheck)} plus existing deductions exceed gross pay per check (${usd(gross)}).`;
    return fail(noFedFromSheet ? 'Not Eligible - Insufficient Savings + No Federal Taxes Paid' : 'Not Eligible - Insufficient Savings', why);
  }
  const dates = checkDatesFor(s.year, freq);
  const withDed: PayInput = { ...input, deductions: [...(input.deductions ?? []), { code: PROPOSAL_DEDUCTION_CODE, amount: dedPerCheck }] };
  const before = runSeries(input, dates, db);
  const after = runSeries(withDed, dates, db);
  const aB = totalsOf(before, PROPOSAL_DEDUCTION_CODE, 0);
  const aA = totalsOf(after, PROPOSAL_DEDUCTION_CODE, benefitPerCheck);
  res.annual = { before: aB, after: aA };
  res.check = { before: totalsOf(before.slice(0, 1), PROPOSAL_DEDUCTION_CODE, 0), after: totalsOf(after.slice(0, 1), PROPOSAL_DEDUCTION_CODE, benefitPerCheck) };
  const unverified = new Set(before.concat(after).flatMap((r) => r.taxes).filter((t) => t.status !== 'published' && t.status !== 'draft').map((t) => `${t.jurisdiction} ${t.kind} (${t.status})`));
  if (unverified.size) res.flags.push(`Uses tax data not yet verified: ${[...unverified].join(', ')}.`);

  const eeTaxSav = r2((aB.employeeTaxes - aA.employeeTaxes) / 12);
  const erTaxSav = r2((aB.employerTaxes - aA.employerTaxes) / 12);
  const eeGainBeforeFees = r2((aA.netPay - aB.netPay) / 12);
  const eeGain = r2(eeGainBeforeFees - tier.employeeFeeMonthly);
  const erGain = r2(erTaxSav - tier.employerFeeMonthly);
  const dedMonthly = r2((dedPerCheck * periods) / 12);
  const allotBase = s.allotmentBase === 'deduction' ? dedMonthly : s.allotmentBase === 'employee_tax_savings' ? eeTaxSav : eeTaxSav + erTaxSav;
  res.monthly = {
    employeeTaxBefore: r2(aB.employeeTaxes / 12),
    employeeTaxAfter: r2(aA.employeeTaxes / 12),
    employeeTaxSavings: eeTaxSav,
    employerTaxSavings: erTaxSav,
    employeeNetGain: eeGain,
    employerNetGain: erGain,
    allotment: r2(allotBase * s.allotmentPercent),
    employerFee: tier.employerFeeMonthly,
    employeeFee: tier.employeeFeeMonthly,
  };

  // Federal tax paid: the sheet's flag when given, else the engine's calculation.
  const fitBefore = fitCalcFor(before);
  if (row.federalTaxPaid === true && fitBefore === 0) res.flags.push('Sheet says federal tax is withheld, but the engine calculates none from this W-4 and pay.');
  if (row.federalTaxPaid === false && fitBefore > 0) res.flags.push(`Sheet says no federal tax is withheld, but the engine calculates ${usd(fitBefore / periods)} per check.`);
  if (row.stateTaxPaid === true && aB.stateLocal === 0) res.flags.push('Sheet says state tax is withheld, but the engine calculates none (no-income-tax state or below the threshold).');
  const noFed = row.federalTaxPaid === false || (row.federalTaxPaid == null && fitBefore === 0);

  // 4. Eligibility, in the order the underwriting sheet applies it
  res.eligibleBeforePricing = eeGainBeforeFees >= s.minMonthlyEmployeeGain && erTaxSav >= s.minMonthlyEmployerGain;
  const enoughSavings = eeGain >= s.minMonthlyEmployeeGain && erGain >= s.minMonthlyEmployerGain;
  if (!enoughSavings) {
    const why: string[] = [];
    if (eeGain < s.minMonthlyEmployeeGain) why.push(`employee take-home rises ${usd(eeGain)}/month (minimum ${usd(s.minMonthlyEmployeeGain)})`);
    if (erGain < s.minMonthlyEmployerGain) why.push(`employer saves ${usd(erGain)}/month after fees (minimum ${usd(s.minMonthlyEmployerGain)})`);
    return fail(noFed ? 'Not Eligible - Insufficient Savings + No Federal Taxes Paid' : 'Not Eligible - Insufficient Savings', why.join('; ') + '.');
  }
  if (annualGross <= s.lowIncomeMax) return fail('Not Eligible - Low Income', `Annual gross ${usd(annualGross)} is at or below ${usd(s.lowIncomeMax)}.`);
  if (noFed) return fail('No Federal Taxes Paid', 'Savings meet the minimums, but no federal income tax is withheld today; review before enrolling.');
  if (hoursPerWeek === undefined) return fail('NEEDS REVIEW', 'Hours missing for an hourly employee.');
  if (!qualified) {
    const min = Math.min(...s.tiers.map((t) => t.minHoursPerWeek));
    return fail('Not Eligible - Insufficient Hours', `${res.hoursPerWeek} hours/week is below the ${min}-hour minimum.`);
  }
  if (s.reviewMinConfidence > 0 && row.confidence !== undefined && row.confidence < s.reviewMinConfidence)
    return fail('NEEDS REVIEW', `Data confidence ${row.confidence} is below ${s.reviewMinConfidence}.`);
  res.eligibility = 'Eligible';
  return res;
}

export function runProposal(rows: CensusRow[], settings: Partial<ProposalSettings> = {}, db: TaxDatabase = loadTaxDatabase()): ProposalResult {
  const s: ProposalSettings = { ...DEFAULT_PROPOSAL_SETTINGS, ...settings, employer: { ...DEFAULT_PROPOSAL_SETTINGS.employer, ...(settings.employer ?? {}) } };
  // The same employee can appear more than once (several checks in a register); count each person once.
  const seen = new Map<string, number>();
  const duplicates: { rowNumber?: number; duplicateOf?: number; name: string }[] = [];
  const unique = rows.filter((r) => {
    if (!s.dedupe) return true;
    const who = `${r.company ?? ''}|${r.employeeId ?? ''}|${r.firstName ?? ''}|${r.lastName ?? ''}`.toLowerCase();
    if (!r.employeeId && !r.firstName && !r.lastName) return true;
    if (seen.has(who)) {
      duplicates.push({ rowNumber: r.rowNumber, duplicateOf: seen.get(who), name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.employeeId || '' });
      return false;
    }
    seen.set(who, r.rowNumber ?? 0);
    return true;
  });
  const employees = unique.map((r) => evaluateEmployee({ ...r }, s, db));
  const byEligibility: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  const el = { count: 0, employerTaxSavings: 0, employeeTaxSavings: 0, employerFees: 0, employeeFees: 0, employerNetSavings: 0, employeeNetGain: 0, newDeductions: 0, avgEmployeeMonthlyGain: 0, avgEmployerMonthlySavings: 0 };
  for (const e of employees) {
    byEligibility[e.eligibility] = (byEligibility[e.eligibility] ?? 0) + 1;
    if (e.eligibility !== 'Eligible' || !e.monthly || !e.annual) continue;
    el.count++;
    byTier[e.tier!] = (byTier[e.tier!] ?? 0) + 1;
    el.employerTaxSavings += e.monthly.employerTaxSavings * 12;
    el.employeeTaxSavings += e.monthly.employeeTaxSavings * 12;
    el.employerFees += e.monthly.employerFee * 12;
    el.employeeFees += e.monthly.employeeFee * 12;
    el.employerNetSavings += e.monthly.employerNetGain * 12;
    el.employeeNetGain += e.monthly.employeeNetGain * 12;
    el.newDeductions += e.annual.after.newDeduction;
  }
  for (const k of Object.keys(el) as (keyof typeof el)[]) if (k !== 'count') el[k] = r2(el[k]);
  el.avgEmployeeMonthlyGain = el.count ? r2(el.employeeNetGain / el.count / 12) : 0;
  el.avgEmployerMonthlySavings = el.count ? r2(el.employerNetSavings / el.count / 12) : 0;
  return {
    settings: s,
    employees,
    summary: {
      employees: employees.length,
      byEligibility,
      eligibleBeforePricing: employees.filter((e) => e.eligibleBeforePricing).length,
      eligibleAfterPricing: el.count,
      eligible: el,
      byTier,
      dataWarnings: employees.reduce((a, e) => a + e.flags.length, 0),
      rowsInFile: rows.length,
      duplicates,
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
