/**
 * State, DC and territory tax profiles.
 *
 * IMPORTANT ON VERIFICATION: values marked 'unverified' were entered from
 * secondary research and must be checked against the cited agency withholding
 * guide before being used for live payroll. The app surfaces this status on
 * every calculated line. 2027 rows are produced by `projectForward` unless a
 * state has a scheduled statutory change entered explicitly.
 */
import type { Bracket, CalcSpec, Jurisdiction, JurisdictionFlag, StateFormula, TaxKind, TaxRule, VerificationStatus, WageBasis, Payer } from './types.js';
import { agencySource } from './sources.js';

/** Brackets from [threshold, rate%] pairs. */
const br = (...pairs: [number, number][]): Bracket[] => pairs.map(([over, pct]) => ({ over, rate: pct / 100 }));
/** Double every threshold (typical MFJ schedule). */
const dbl = (b: Bracket[]): Bracket[] => b.map((x) => ({ over: x.over * 2, rate: x.rate }));
const flat = (pct: number): Bracket[] => br([0, pct]);

export interface SuiProfile {
  wageBase: Partial<Record<number, number>>;
  /** New-employer rate (percent). Clients override with their assigned experience rate. */
  newEmployerRate: number;
  /** Range of assigned rates (percent). */
  rateRange?: [number, number];
  /** Employee-paid SUI. */
  employeeRate?: number;
  employeeWageBase?: Partial<Record<number, number>>;
  /** Extra employer assessments on SUI wages (ETT, admin, reemployment funds). */
  surcharges?: { name: string; rate: number; wageBase?: number }[];
  /** Years whose wage base matches the EY (2025, 2026) or APS (2027) state-by-state compilation read on 2026-11-20. */
  confirmedYears?: number[];
  status?: VerificationStatus;
}

export interface ProgramRule {
  kind: TaxKind;
  name: string;
  payer: Payer;
  wageBasis?: WageBasis;
  calc: CalcSpec;
  from: string;
  to?: string;
  status: VerificationStatus;
  notes?: string;
  optional?: boolean;
  /** Rate or cap is reset by the agency every year: later years without their own row are carried forward as 'projected'. */
  annual?: boolean;
  /** With `annual`: the last year this rate was checked for (defaults to the starting year). */
  verifiedThrough?: number;
  /** Extra source ids for this row (the state agency is always cited). */
  sources?: string[];
}

interface SitYear { calc: CalcSpec; status: VerificationStatus; notes?: string; sources?: string[] }

export interface StateProfile {
  code: string;
  name: string;
  fips: string;
  type: 'state' | 'district' | 'territory';
  flags: JurisdictionFlag[];
  agency: { name: string; url: string; withholdingGuide?: string };
  /** Income tax withholding by year. Missing years are projected forward from the latest. */
  sit: Partial<Record<number, SitYear>>;
  sui?: SuiProfile;
  programs?: ProgramRule[];
  notes?: string;
}

const SF = (formula: StateFormula): CalcSpec => ({ kind: 'state_formula', formula });
/** A USDA National Finance Center tax bulletin: the federal payroll provider's published summary of a state's withholding formula. */
const nfc = (code: string, path: string): string => agencySource(`nfc-${code.toLowerCase()}-${path.replace(/\W+/g, '-')}`, 'USDA National Finance Center', `${code} income tax withholding bulletin (${path.slice(0, 4)})`, `https://help.nfc.usda.gov/bulletins/${path}.htm`).id;
/** Connecticut TPG-211 (2026) tables, read from the DRS document. Ranges are "more than" the lower bound and "up to" the upper. */
const CT_CREDIT_DECIMALS = [0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.14, 0.13, 0.12, 0.11, 0.1, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01];
const ctB = (...rows: [number, number][]) => br(...rows);
export const CT_TPG211_2026 = {
  /** Table A: exemption, reduced $1,000 for each $1,000 (or part) of annual salary over the start. Code D has none. */
  exemption: { A: { base: 12000, start: 24000 }, B: { base: 19000, start: 38000 }, C: { base: 24000, start: 48000 }, D: { base: 0, start: 0 }, F: { base: 15000, start: 30000 } },
  /** Table B: initial tax on annual taxable income. */
  brackets: {
    A: ctB([0, 2], [10000, 4.5], [50000, 5.5], [100000, 6], [200000, 6.5], [250000, 6.9], [500000, 6.99]),
    B: ctB([0, 2], [16000, 4.5], [80000, 5.5], [160000, 6], [320000, 6.5], [400000, 6.9], [800000, 6.99]),
    C: ctB([0, 2], [20000, 4.5], [100000, 5.5], [200000, 6], [400000, 6.5], [500000, 6.9], [1000000, 6.99]),
  },
  /** Table C: 2% phase-out add-back, in steps over the start, up to the cap. */
  addBack: { A: { start: 50250, step: 2500, inc: 25, cap: 250 }, D: { start: 50250, step: 2500, inc: 25, cap: 250 }, B: { start: 78500, step: 4000, inc: 40, cap: 400 }, C: { start: 100500, step: 5000, inc: 50, cap: 500 }, F: { start: 56500, step: 5000, inc: 25, cap: 250 } },
  /** Table D: recapture, in tiers; each tier adds its step amount over its start, up to its cumulative cap. */
  recapture: {
    A: [{ start: 105000, step: 5000, inc: 25, cap: 250 }, { start: 200000, step: 5000, inc: 90, cap: 2950 }, { start: 500000, step: 5000, inc: 50, cap: 3400 }],
    B: [{ start: 168000, step: 8000, inc: 40, cap: 400 }, { start: 320000, step: 8000, inc: 140, cap: 4600 }, { start: 800000, step: 8000, inc: 80, cap: 5320 }],
    C: [{ start: 210000, step: 10000, inc: 50, cap: 500 }, { start: 400000, step: 10000, inc: 180, cap: 5900 }, { start: 1000000, step: 10000, inc: 100, cap: 6800 }],
  },
  /** Table E: personal tax credit. Upper bound of each row, paired with CT_CREDIT_DECIMALS; above the last row the credit is 0. Code D has none. */
  creditUpTo: {
    A: [15000, 15500, 16000, 16500, 17000, 17500, 18000, 18500, 20000, 20500, 21000, 21500, 25000, 25500, 26000, 26500, 27000, 48000, 48500, 49000, 49500, 50000, 50500, 51000, 51500, 52000, 52500],
    B: [24000, 24500, 25000, 25500, 26000, 26500, 27000, 27500, 34000, 34500, 35000, 35500, 44000, 44500, 45000, 45500, 46000, 74000, 74500, 75000, 75500, 76000, 76500, 77000, 77500, 78000, 78500],
    C: [30000, 30500, 31000, 31500, 32000, 32500, 33000, 33500, 40000, 40500, 41000, 41500, 50000, 50500, 51000, 51500, 52000, 96000, 96500, 97000, 97500, 98000, 98500, 99000, 99500, 100000, 100500],
    F: [18800, 19300, 19800, 20300, 20800, 21300, 21800, 22300, 25000, 25500, 26000, 26500, 31300, 31800, 32300, 32800, 33300, 60000, 60500, 61000, 61500, 62000, 62500, 63000, 63500, 64000, 64500],
  },
  creditDecimals: CT_CREDIT_DECIMALS,
};

const NONE: CalcSpec = { kind: 'none', reason: 'No state income tax on wages' };
const U: VerificationStatus = 'unverified';
const C: VerificationStatus = 'confirmed';
const P: VerificationStatus = 'published';

export const STATES: StateProfile[] = [
  {
    code: 'AL', name: 'Alabama', fips: '01', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Alabama Department of Revenue', url: 'https://www.revenue.alabama.gov/', withholdingGuide: 'https://www.revenue.alabama.gov/withholding-tax/' },
    sit: { 2026: { status: C, sources: [nfc('AL', '2022/1666037747')], calc: { kind: 'custom', handler: 'AL', params: { brackets: { single: br([0, 2], [500, 4], [3000, 5]), mfj: br([0, 2], [1000, 4], [6000, 5]) }, personalExemption: { single: 1500, mfs: 1500, hoh: 3000, mfj: 3000 }, dependentTiers: [[50000, 1000], [100000, 500], [Infinity, 300]], stdDed: { single: [2500, 3000], mfj: [5000, 8500], hoh: [2500, 5200], mfs: [2500, 4250] }, stdDedPhase: { single: { start: 26000, step: 500, drop: 25 }, mfj: { start: 26000, step: 500, drop: 175 }, hoh: { start: 26000, step: 500, drop: 135 }, mfs: { start: 13000, step: 250, drop: 88 } }, federalTaxDeduction: true, supplementalRate: 0.05 } }, notes: 'Formula in effect since October 2022 (the latest bulletin): standard deduction steps down from $26,000 of wages ($13,000 married filing separately), $1,000 per dependent up to $50,000 of wages, and federal income tax withheld is subtracted.' } },
    sui: { wageBase: { 2025: 8000, 2026: 8000, 2027: 8000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.7, rateRange: [0.2, 6.8] },
  },
  {
    code: 'AK', name: 'Alaska', fips: '02', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'Alaska Department of Labor', url: 'https://labor.alaska.gov/estax/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 51700, 2026: 54200 }, confirmedYears: [2025, 2026], newEmployerRate: 1, rateRange: [1.0, 5.4], employeeRate: 0.5, employeeWageBase: { 2025: 51700, 2026: 54200 } },
  },
  {
    code: 'AZ', name: 'Arizona', fips: '04', type: 'state', flags: ['has_sui'],
    agency: { name: 'Arizona Department of Revenue', url: 'https://azdor.gov/', withholdingGuide: 'https://azdor.gov/forms/withholding-forms/arizona-form-a-4' },
    sit: { 2026: { status: C, sources: [nfc('AZ', '2023/1686066172')], calc: { kind: 'elected_percent', allowed: [0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035], default: 0.02 }, notes: 'Employee elects a % of gross on Form A-4; 2.0% if no A-4. 0% election requires expected zero liability.' } },
    sui: { wageBase: { 2025: 8000, 2026: 8000, 2027: 8000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2, rateRange: [0.07, 18.78] },
  },
  {
    code: 'AR', name: 'Arkansas', fips: '05', type: 'state', flags: ['has_sui'],
    agency: { name: 'Arkansas DFA', url: 'https://www.dfa.arkansas.gov/', withholdingGuide: 'https://www.dfa.arkansas.gov/income-tax/withholding-tax-branch/' },
    sit: { 2026: { status: C, sources: [nfc('AR', '2026/1781190112')], calc: SF({ form: 'AR4EC', brackets: { all: br([0, 0], [5600, 2], [11200, 3], [16000, 3.4], [26400, 3.7]) }, standardDeduction: { all: 2470 }, allowanceCredit: 29, supplementalRate: 0.037 }), notes: 'Table in effect from August 2026 (top rate 3.7%). Not modeled: rounding income under $100,001 to the $50 midpoint, the bracket adjustment between $94,701 and $97,601, and the optional low-income tables.' } },
    sui: { wageBase: { 2025: 7000, 2026: 7000 }, confirmedYears: [2025, 2026], newEmployerRate: 2, rateRange: [0.1, 5.0] },
  },
  {
    code: 'CA', name: 'California', fips: '06', type: 'state', flags: ['has_sui', 'has_sdi'],
    agency: { name: 'California EDD', url: 'https://edd.ca.gov/', withholdingGuide: 'https://edd.ca.gov/en/Payroll_Taxes/Rates_and_Withholding/' },
    sit: {
      2026: { status: P, sources: ['edd-de44-2026'], calc: { kind: 'custom', handler: 'CA', params: {
        // EDD withholding schedules, Method B (exact calculation), 2026.
        lowIncomeExemption: { single: 18896, mfj_low: 18896, mfj_high: 37791, hoh: 37791 },
        standardDeduction: { single: 5706, mfj_low: 5706, mfj_high: 11412, hoh: 11412 },
        estimatedDeductionPerAllowance: 1000,
        exemptionCreditPerAllowance: 168.3,
        brackets: {
          single: br([0, 1.1], [11079, 2.2], [26264, 4.4], [41452, 6.6], [57542, 8.8], [72724, 10.23], [371479, 11.33], [445771, 12.43], [742953, 13.53], [1000000, 14.63]),
          mfj: br([0, 1.1], [22158, 2.2], [52528, 4.4], [82904, 6.6], [115084, 8.8], [145448, 10.23], [742958, 11.33], [891542, 12.43], [1000000, 13.53], [1485906, 14.63]),
          hoh: br([0, 1.1], [22173, 2.2], [52530, 4.4], [67716, 6.6], [83805, 8.8], [98990, 10.23], [505208, 11.33], [606251, 12.43], [1000000, 13.53], [1010417, 14.63]),
        },
        supplementalRate: 0.066, bonusStockRate: 0.1023,
      } }, notes: 'Read from the EDD 2026 Method B schedule (26methb.pdf): Tables 1, 3, 4 and the annual rate tables. The rate table includes the 10% gross-up EDD uses (1.1% = 1% x 1.1). Supplemental rates 6.6% and 10.23% are from the DE 44 text, not re-read this pass.' },
      2027: { status: P, sources: ['edd-de44-2027'], calc: { kind: 'custom', handler: 'CA', params: {
        // EDD withholding schedules, Method B (exact calculation), 2027.
        lowIncomeExemption: { single: 19528, mfj_low: 19528, mfj_high: 39056, hoh: 39056 },
        standardDeduction: { single: 5900, mfj_low: 5900, mfj_high: 11800, hoh: 11800 },
        estimatedDeductionPerAllowance: 1000,
        exemptionCreditPerAllowance: 173.8,
        brackets: {
          single: br([0, 1.1], [11456, 2.2], [27157, 4.4], [42861, 6.6], [59498, 8.8], [75197, 10.23], [384109, 11.33], [460927, 12.43], [768213, 13.53], [1000000, 14.63]),
          mfj: br([0, 1.1], [22912, 2.2], [54314, 4.4], [85722, 6.6], [118996, 8.8], [150394, 10.23], [768218, 11.33], [921854, 12.43], [1000000, 13.53], [1536426, 14.63]),
          hoh: br([0, 1.1], [22927, 2.2], [54316, 4.4], [70018, 6.6], [86654, 8.8], [102356, 10.23], [522385, 11.33], [626864, 12.43], [1000000, 13.53], [1034000, 14.63]),
        },
        supplementalRate: 0.066, bonusStockRate: 0.1023,
      } }, notes: 'Read from the EDD 2027 Method B schedule (27methb.pdf): Tables 1, 3, 4 and the annual rate tables. The rate table includes the 10% gross-up EDD uses (1.1% = 1% x 1.1). Supplemental rates 6.6% and 10.23% are from the DE 44 text, not re-read this pass.' },
    },
    sui: { wageBase: { 2025: 7000, 2026: 7000, 2027: 7000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 3.4, rateRange: [1.5, 6.2], surcharges: [{ name: 'Employment Training Tax (ETT)', rate: 0.1, wageBase: 7000 }] },
    programs: [
      { kind: 'SDI_EE', name: 'CA State Disability Insurance (incl. PFL)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.014 }, from: '2027-01-01', status: P, sources: ['edd-rates'], notes: 'EDD rates page: 1.4% for 2027, no wage limit (SB 951).' },
      { kind: 'SDI_EE', name: 'CA State Disability Insurance (incl. PFL)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.013 }, from: '2026-01-01', to: '2026-12-31', status: P, sources: ['edd-rates'], notes: 'EDD rates page: 1.3% for 2026, no wage limit (SB 951).' },
      { kind: 'SDI_EE', name: 'CA State Disability Insurance (incl. PFL)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.012 }, from: '2025-01-01', to: '2025-12-31', status: P, sources: ['edd-rates'], notes: 'EDD rates page: 1.2% for 2025.' },
    ],
  },
  {
    code: 'CO', name: 'Colorado', fips: '08', type: 'state', flags: ['has_sui', 'has_pfml', 'has_local_income_tax'],
    agency: { name: 'Colorado Department of Revenue', url: 'https://tax.colorado.gov/', withholdingGuide: 'https://tax.colorado.gov/withholding-tax-guide' },
    sit: {
      2026: { status: C, sources: [nfc('CO', '2026/1772551649')], calc: SF({ form: 'DR 0004', usesFederalW4: true, brackets: { all: flat(4.4) }, standardDeduction: { single: 5500, mfs: 5500, hoh: 5500, mfj: 11000 }, supplementalRate: 0.044, roundToDollar: true }), notes: 'Flat 4.4% of annual wages less the annual withholding amount ($11,000 married filing jointly, $5,500 everyone else) when the employee has not filed a DR 0004.' },
      2027: { status: P, sources: ['co-dr1098-2027'], calc: SF({ form: 'DR 0004', usesFederalW4: true, brackets: { all: br([0, 3.7], [25000, 4.2], [100000, 4.4], [500000, 7.4], [750000, 7.9], [1000000, 8.4]) }, standardDeduction: { single: 5500, mfs: 5500, hoh: 8500, mfj: 11000 } }), notes: 'Read from the final 2027 DR 1098 worksheet (dated November 17, 2026): graduated rates from 3.7% to 8.4% on annual wages less the allowance ($11,000 married filing jointly, $8,500 head of household, $5,500 others) when no DR 0004 is filed. One table for every filing status. The worksheet does not give a supplemental rate.' },
    },
    sui: { wageBase: { 2025: 27200, 2026: 30600, 2027: 32100 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 1.7, rateRange: [0.75, 10.39] },
    programs: [
      { kind: 'PFML_EE', name: 'CO FAMLI (employee share)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0043, wageBase: 'SS' }, from: '2027-01-01', status: C, sources: ['hrmorning-co-famli-2027', 'symetra-pfml-2027'], notes: 'Total premium drops from 0.88% to 0.86% on January 1, 2027, split evenly; wage cap is the Social Security wage base. Employers with fewer than 10 employees owe only the employee share.' },
      { kind: 'PFML_EE', name: 'CO FAMLI (employee share)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0044, wageBase: 'SS' }, from: '2026-01-01', to: '2026-12-31', status: C, sources: ['mercer-pfml-2026'], notes: 'Total premium 0.88% for 2026 split 50/50; wage cap = SS wage base. Employers with <10 employees owe only employee share.' },
      { kind: 'PFML_ER', name: 'CO FAMLI (employer share)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0043, wageBase: 'SS' }, from: '2027-01-01', status: C, sources: ['hrmorning-co-famli-2027', 'symetra-pfml-2027'] },
      { kind: 'PFML_ER', name: 'CO FAMLI (employer share)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0044, wageBase: 'SS' }, from: '2026-01-01', to: '2026-12-31', status: C, sources: ['mercer-pfml-2026'] },
    ],
  },
  {
    code: 'CT', name: 'Connecticut', fips: '09', type: 'state', flags: ['has_sui', 'has_pfml', 'convenience_of_employer'],
    agency: { name: 'Connecticut DRS', url: 'https://portal.ct.gov/drs', withholdingGuide: 'https://portal.ct.gov/drs/publications/informational-publications' },
    sit: { 2026: { status: P, sources: [agencySource('ct-tpg211-2026', 'Connecticut Department of Revenue Services', 'TPG-211, 2026 Withholding Calculation Rules (Rev. 12/25), effective January 1, 2026', 'https://portal.ct.gov/-/media/drs/forms/2025/wth/tpg-211_1225.pdf').id], calc: { kind: 'custom', handler: 'CT', params: CT_TPG211_2026 }, notes: 'Full TPG-211 method: Table A exemption phase-out, Table B tax, Table C 2% phase-out add-back, Table D recapture, Table E personal tax credit. The 2026 rules are unchanged from 2025. Code from the CT-W4 when known; otherwise Single F, Married filing separately A, Married filing jointly C (A when both spouses work), Head of household B.' } },
    sui: { wageBase: { 2025: 26100, 2026: 27000 }, confirmedYears: [2025, 2026], newEmployerRate: 1.9, rateRange: [1.1, 8.9] },
    programs: [{ kind: 'PFML_EE', name: 'CT Paid Leave', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.005, wageBase: 'SS' }, from: '2026-01-01', status: C, annual: true, verifiedThrough: 2027, sources: ['mercer-pfml-2026', 'symetra-pfml-2027'], notes: 'Wage cap tracks the SS wage base.' }],
  },
  {
    code: 'DE', name: 'Delaware', fips: '10', type: 'state', flags: ['has_sui', 'has_pfml', 'has_local_income_tax', 'convenience_of_employer'],
    agency: { name: 'Delaware Division of Revenue', url: 'https://revenue.delaware.gov/', withholdingGuide: 'https://revenue.delaware.gov/employers-guide-withholding-regulations-employers-duties/' },
    sit: { 2026: { status: C, sources: [nfc('DE', '2020/1605647748')], calc: SF({ form: 'W-4 (DE)', usesFederalW4: false, brackets: { all: br([0, 0], [2000, 2.2], [5000, 3.9], [10000, 4.8], [20000, 5.2], [25000, 5.55], [60000, 6.6]) }, standardDeduction: { single: 3250, mfs: 3250, hoh: 3250, mfj: 6500 }, allowanceCredit: 110 }), notes: 'Matches the latest federal payroll bulletin (November 2020); Delaware has not changed the formula since.' } },
    sui: { wageBase: { 2025: 12500, 2026: 14500, 2027: 16500 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 1, rateRange: [0.3, 5.4] },
    programs: [
      { kind: 'PFML_EE', name: 'Delaware Paid Leave (employee share, up to 50%)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.004, wageBase: 'SS' }, from: '2025-01-01', status: C, annual: true, verifiedThrough: 2026, sources: ['mercer-pfml-2026'], notes: 'Total 0.8% (0.5% family+medical with parental 0.3%); employer may deduct up to 50%.' },
      { kind: 'PFML_ER', name: 'Delaware Paid Leave (employer share)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.004, wageBase: 'SS' }, from: '2025-01-01', status: C, annual: true, verifiedThrough: 2026, sources: ['mercer-pfml-2026'] },
    ],
  },
  {
    code: 'DC', name: 'District of Columbia', fips: '11', type: 'district', flags: ['has_sui', 'has_pfml'],
    agency: { name: 'DC Office of Tax and Revenue', url: 'https://otr.cfo.dc.gov/' },
    sit: { 2026: { status: U, calc: SF({ form: 'D-4', brackets: { all: br([0, 4], [10000, 6], [40000, 6.5], [60000, 8.5], [250000, 9.25], [500000, 9.75], [1000000, 10.75]) }, standardDeduction: { single: 16100, mfs: 16100, mfj: 32200, hoh: 24150 } }), notes: 'DC standard deduction follows the federal amount.' }, 2027: { status: 'projected', calc: SF({ form: 'D-4', brackets: { all: br([0, 4], [10000, 6], [40000, 6.5], [60000, 8.5], [250000, 9.25], [500000, 9.75], [1000000, 10.75]) }, standardDeduction: { single: 16600, mfs: 16600, mfj: 33200, hoh: 24925 } }), notes: 'Standard deduction tied to federal 2027 amounts; rates carried forward.' } },
    sui: { wageBase: { 2025: 9000, 2026: 9000, 2027: 9000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.7, rateRange: [1.9, 7.4], surcharges: [{ name: 'Administrative funding assessment', rate: 0.2, wageBase: 9000 }] },
    programs: [{ kind: 'PFML_ER', name: 'DC Paid Family Leave (employer)', payer: 'employer', wageBasis: 'GROSS', calc: { kind: 'percent', rate: 0.0075 }, from: '2025-01-01', status: C, annual: true, verifiedThrough: 2026, sources: ['mercer-pfml-2026'] }],
  },
  {
    code: 'FL', name: 'Florida', fips: '12', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'Florida Department of Revenue', url: 'https://floridarevenue.com/taxes/taxesfees/Pages/reemployment.aspx' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 7000, 2026: 7000, 2027: 7000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.7, rateRange: [0.1, 5.4] },
  },
  {
    code: 'GA', name: 'Georgia', fips: '13', type: 'state', flags: ['has_sui'],
    agency: { name: 'Georgia Department of Revenue', url: 'https://dor.georgia.gov/', withholdingGuide: 'https://dor.georgia.gov/employers-tax-guide' },
    sit: {
      2026: { status: C, sources: [nfc('GA', '2026/1784643404')], calc: SF({ form: 'G-4', brackets: { all: flat(4.99) }, standardDeduction: { single: 15000, mfs: 15000, hoh: 15000, mfj_two_income: 15000, mfj: 30000 }, dependentDeduction: 5000, allowanceDeduction: 5000 }), notes: 'HB 463 (2026): 4.99% retroactive to January 1, 2026. Standard deduction $15,000 ($30,000 married, one spouse working), $5,000 per dependent or additional allowance. Revised tables applied from June 2026.' },
      2027: { status: 'projected', calc: SF({ form: 'G-4', brackets: { all: flat(4.99) }, standardDeduction: { single: 15000, mfs: 15000, hoh: 15000, mfj_two_income: 15000, mfj: 30000 }, dependentDeduction: 5000, allowanceDeduction: 5000 }), notes: 'Carried forward. Further cuts of 0.125 a year depend on revenue targets and none is confirmed for 2027.' },
    },
    sui: { wageBase: { 2025: 9500, 2026: 9500, 2027: 9500 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.64, rateRange: [0.04, 8.1] },
  },
  {
    code: 'HI', name: 'Hawaii', fips: '15', type: 'state', flags: ['has_sui', 'has_sdi'],
    agency: { name: 'Hawaii Department of Taxation', url: 'https://tax.hawaii.gov/', withholdingGuide: 'https://files.hawaii.gov/tax/legal/brochures/booklet_a.pdf' },
    sit: { 2026: { status: C, sources: [nfc('HI', '2026/1768321238')], calc: SF({ form: 'HW-4', brackets: { single: br([0, 1.4], [9600, 3.2], [14400, 5.5], [19200, 6.4], [24000, 6.8], [36000, 7.2], [48000, 7.6], [125000, 7.9]), mfj: dbl(br([0, 1.4], [9600, 3.2], [14400, 5.5], [19200, 6.4], [24000, 6.8], [36000, 7.2], [48000, 7.6], [125000, 7.9])) }, allowanceDeduction: 1144, standardDeduction: { all: 4350 } }), notes: 'Withholding tables stop at 7.9% (Hawaii does not withhold at the higher return rates). $4,350 is subtracted for every employee in addition to $1,144 per allowance, in effect from August 2026.' } },
    sui: { wageBase: { 2025: 62000, 2026: 64500 }, confirmedYears: [2025, 2026], newEmployerRate: 2.4, rateRange: [0.0, 5.8] },
    programs: [{ kind: 'SDI_EE', name: 'HI Temporary Disability Insurance (employee max)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.005, weeklyMax: 7.5 }, from: '2026-01-01', status: C, annual: true, sources: ['mercer-pfml-2026'], notes: 'Employee share up to 0.5% of weekly wages, capped at 0.5% of max weekly wage base. Employer funds the rest via private plan.' }],
  },
  {
    code: 'ID', name: 'Idaho', fips: '16', type: 'state', flags: ['has_sui'],
    agency: { name: 'Idaho State Tax Commission', url: 'https://tax.idaho.gov/', withholdingGuide: 'https://tax.idaho.gov/taxes/income-tax/withholding/' },
    sit: { 2026: { status: C, sources: [nfc('ID', '2026/1786997961')], calc: SF({ form: 'ID W-4', brackets: { single: br([0, 0], [16100, 5.3]), mfj: br([0, 0], [32200, 5.3]) }, supplementalRate: 0.053, roundToDollar: true }), notes: 'Tables in effect from September 2026: the per-allowance deduction was removed and the zero bracket equals the standard deduction.' } },
    sui: { wageBase: { 2025: 55300, 2026: 58300 }, confirmedYears: [2025, 2026], newEmployerRate: 1, rateRange: [0.204, 5.4] },
  },
  {
    code: 'IL', name: 'Illinois', fips: '17', type: 'state', flags: ['has_sui'],
    agency: { name: 'Illinois Department of Revenue', url: 'https://tax.illinois.gov/', withholdingGuide: 'https://tax.illinois.gov/research/publications/bulletins.html' },
    sit: { 2026: { status: C, sources: [nfc('IL', '2026/1784121339')], calc: SF({ form: 'IL-W-4', brackets: { all: flat(4.95) }, allowanceDeduction: 2925, dependentDeduction: 1000, supplementalRate: 0.0495 }), notes: '$2,925 per regular allowance and $1,000 per additional allowance for 2026.' } },
    sui: { wageBase: { 2025: 13916, 2026: 14250, 2027: 14592 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 3.35, rateRange: [0.85, 8.65] },
  },
  {
    code: 'IN', name: 'Indiana', fips: '18', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Indiana Department of Revenue', url: 'https://www.in.gov/dor/', withholdingGuide: 'https://www.in.gov/dor/business-tax/withholding-tax/' },
    sit: {
      2025: { status: U, calc: SF({ form: 'WH-4', brackets: { all: flat(3.0) }, allowanceDeduction: 1000, dependentDeduction: 1500 }) },
      2026: { status: C, sources: [nfc('IN', '2026/1774379018')], calc: SF({ form: 'WH-4', brackets: { all: flat(2.95) }, allowanceDeduction: 1000, dependentDeduction: 1500 }), notes: '2.95% for 2026; $1,000 per exemption and $1,500 per additional dependent exemption.' },
      2027: { status: 'projected', calc: SF({ form: 'WH-4', brackets: { all: flat(2.9) }, allowanceDeduction: 1000, dependentDeduction: 1500 }), notes: 'HB 1001 sets 2.9% for 2027. The January 2027 Departmental Notice #1 is expected in December 2026.' },
    },
    sui: { wageBase: { 2025: 9500, 2026: 9500, 2027: 9500 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.5, rateRange: [0.5, 7.4] },
  },
  {
    code: 'IA', name: 'Iowa', fips: '19', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Iowa Department of Revenue', url: 'https://revenue.iowa.gov/', withholdingGuide: 'https://revenue.iowa.gov/taxes/tax-guidance/withholding-tax' },
    sit: { 2026: { status: U, calc: SF({ form: 'IA W-4', brackets: { all: flat(3.8) }, standardDeduction: { single: 15000, mfj: 30000, hoh: 22500, mfs: 15000 }, allowanceCredit: 40, supplementalRate: 0.038 }), notes: 'Flat 3.8% from 2025. Iowa school district surtax is applied on the annual return, not withheld (flagged only).' } },
    sui: { wageBase: { 2025: 39500, 2026: 20400, 2027: 21100 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 1, rateRange: [0, 7.0] },
  },
  {
    code: 'KS', name: 'Kansas', fips: '20', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Kansas Department of Revenue', url: 'https://www.ksrevenue.gov/', withholdingGuide: 'https://www.ksrevenue.gov/forms-btwh.html' },
    sit: { 2026: { status: C, sources: [nfc('KS', '2024/1722617728')], calc: SF({ form: 'K-4', brackets: { single: br([0, 0], [3605, 5.2], [26605, 5.58]), mfj: br([0, 0], [8240, 5.2], [54240, 5.58]) }, allowanceTiers: { single: { amount: 9160, count: 1 }, mfj: { amount: 9160, count: 2 } }, allowanceDeduction: 2320, supplementalRate: 0.05 }), notes: 'Formula in effect since August 2024 (the latest bulletin): $9,160 for the first allowance (first two when married) and $2,320 for each more. Supplemental 5% not re-read.' } },
    sui: { wageBase: { 2025: 14000, 2026: 15100 }, confirmedYears: [2025, 2026], newEmployerRate: 1.75, rateRange: [0.1, 7.6] },
  },
  {
    code: 'KY', name: 'Kentucky', fips: '21', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Kentucky Department of Revenue', url: 'https://revenue.ky.gov/', withholdingGuide: 'https://revenue.ky.gov/Business/Withholding-Tax/' },
    sit: {
      2025: { status: U, calc: SF({ form: 'K-4', brackets: { all: flat(4.0) }, standardDeduction: { all: 3270 }, supplementalRate: 0.040 }) },
      2026: { status: C, sources: [nfc('KY', '2026/1770145550')], calc: SF({ form: 'K-4', brackets: { all: flat(3.5) }, standardDeduction: { all: 3360 }, supplementalRate: 0.035 }), notes: '3.5% with a $3,360 standard deduction for 2026.' },
    },
    sui: { wageBase: { 2025: 11700, 2026: 12000, 2027: 12000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.7, rateRange: [0.3, 9.0] },
  },
  {
    code: 'LA', name: 'Louisiana', fips: '22', type: 'state', flags: ['has_sui'],
    agency: { name: 'Louisiana Department of Revenue', url: 'https://revenue.louisiana.gov/', withholdingGuide: 'https://revenue.louisiana.gov/WithholdingTax' },
    sit: { 2026: { status: C, sources: [nfc('LA', '2026/1767639939')], calc: SF({ form: 'L-4', brackets: { all: flat(3.09) }, standardDeduction: { single: 12875, mfs: 12875, hoh: 25750, mfj: 25750 } }), notes: 'Withholding rate 3.09% with the standard deduction claimed on the L-4, in effect from September 2026.' } },
    sui: { wageBase: { 2025: 7700, 2026: 7000 }, confirmedYears: [2025, 2026], newEmployerRate: 1.21, rateRange: [0.09, 6.2] },
  },
  {
    code: 'ME', name: 'Maine', fips: '23', type: 'state', flags: ['has_sui', 'has_pfml'],
    agency: { name: 'Maine Revenue Services', url: 'https://www.maine.gov/revenue/', withholdingGuide: 'https://www.maine.gov/revenue/tax-return-forms/payroll-withholding' },
    sit: { 2026: { status: C, sources: [nfc('ME', '2026/1787745725')], calc: SF({ form: 'W-4ME', brackets: { single: br([0, 5.8], [27400, 6.75], [64850, 7.15], [1000000, 9.15]), mfj: br([0, 5.8], [54850, 6.75], [129750, 7.15], [1500000, 9.15]) }, standardDeduction: { single: 12850, mfs: 12850, hoh: 12850, mfj: 28550 }, standardDeductionPhaseOut: { single: { start: 102250, end: 177250 }, mfj: { start: 204550, end: 354550 } }, allowanceDeduction: 5300, roundToDollar: true }), notes: 'Tables in effect from September 2026, including the new 9.15% bracket over $1,000,000 ($1,500,000 married). The standard deduction phases out over the stated range.' } },
    sui: { wageBase: { 2025: 12000, 2026: 12000, 2027: 12000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.23, rateRange: [0.28, 5.81] },
    programs: [
      { kind: 'PFML_EE', name: 'Maine Paid Family and Medical Leave (employee up to 50%)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.005, wageBase: 'SS' }, from: '2025-01-01', status: C, annual: true, verifiedThrough: 2026, sources: ['mercer-pfml-2026'], notes: 'Total 1%; employers with <15 employees pay only the employee share.' },
      { kind: 'PFML_ER', name: 'Maine PFML (employer share)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.005, wageBase: 'SS' }, from: '2025-01-01', status: C, annual: true, verifiedThrough: 2026, sources: ['mercer-pfml-2026'] },
    ],
  },
  {
    code: 'MD', name: 'Maryland', fips: '24', type: 'state', flags: ['has_sui', 'has_local_income_tax', 'has_pfml'],
    agency: { name: 'Comptroller of Maryland', url: 'https://www.marylandtaxes.gov/', withholdingGuide: 'https://www.marylandtaxes.gov/business/income/withholding/index.php' },
    sit: { 2026: { status: C, sources: [nfc('MD', '2026/1783003892')], calc: SF({ form: 'MW507', brackets: { single: br([0, 4.75], [100000, 5], [125000, 5.25], [150000, 5.5], [250000, 5.75], [500000, 6.25], [1000000, 6.5]), mfj: br([0, 4.75], [150000, 5], [175000, 5.25], [225000, 5.5], [300000, 5.75], [600000, 6.25], [1200000, 6.5]) }, standardDeduction: { all: 3400 }, allowanceDeduction: 3200, noTaxBelow: { all: 4999.99 } }), notes: 'Formula in effect from July 2026: $3,400 standard deduction, $3,200 per exemption, 4.75% up to the first threshold, no withholding when annual pay is under $5,000. County tax is a separate rule.' } },
    sui: { wageBase: { 2025: 8500, 2026: 8500, 2027: 8500 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.6, rateRange: [0.3, 7.5] },
    programs: [
      { kind: 'PFML_EE', name: 'MD FAMLI (employee 50%)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0045, wageBase: 'SS' }, from: '2027-01-01', status: C, sources: ['md-famli-2027'], notes: 'Contributions start January 1, 2027 at 0.9% of wages up to the Social Security wage base, split evenly.' },
      { kind: 'PFML_ER', name: 'MD FAMLI (employer 50%)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0045, wageBase: 'SS' }, from: '2027-01-01', status: C, sources: ['md-famli-2027'], optional: true, notes: 'Employers with fewer than 15 employees pay no employer share.' },
    ],
  },
  {
    code: 'MA', name: 'Massachusetts', fips: '25', type: 'state', flags: ['has_sui', 'has_pfml', 'convenience_of_employer'],
    agency: { name: 'Massachusetts DOR', url: 'https://www.mass.gov/orgs/massachusetts-department-of-revenue', withholdingGuide: 'https://www.mass.gov/doc/circular-m-massachusetts-income-tax-withholding-tables' },
    sit: { 2026: { status: C, sources: [nfc('MA', '2026/1769797447')], calc: { kind: 'custom', handler: 'MA', params: { rate: 0.05, surtaxRate: 0.04, surtaxThreshold: 1107750, firstExemption: 4400, additionalExemption: 1000, ficaDeductionMax: 2000, hohExtra: 2400, supplementalRate: 0.05 } }, notes: 'Circular M: 5% of wages less exemptions ($4,400 for the first, $1,000 for each more) and Social Security, Medicare and retirement contributions up to $2,000 a year, plus 4% over $1,107,750. Not modeled: the $110 blindness credit and no withholding under $8,000 a year when an exemption is claimed.' } },
    sui: { wageBase: { 2025: 15000, 2026: 15000, 2027: 15000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.42, rateRange: [0.94, 14.37], surcharges: [{ name: 'Workforce Training Fund', rate: 0.056, wageBase: 15000 }, { name: 'EMAC (employer medical assistance)', rate: 0.34, wageBase: 15000 }] },
    programs: [
      { kind: 'PFML_EE', name: 'MA PFML (employee share)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.0046, wageBase: 'SS' }, from: '2025-01-01', status: C, annual: true, verifiedThrough: 2027, sources: ['ma-dfml-2027'], notes: '0.88% total; employee up to 100% family + 40% medical for 25+ employees.' },
      { kind: 'PFML_ER', name: 'MA PFML (employer share, 25+ employees)', payer: 'employer', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.0042, wageBase: 'SS' }, from: '2025-01-01', status: C, annual: true, verifiedThrough: 2027, sources: ['ma-dfml-2027'] },
    ],
  },
  {
    code: 'MI', name: 'Michigan', fips: '26', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Michigan Department of Treasury', url: 'https://www.michigan.gov/taxes', withholdingGuide: 'https://www.michigan.gov/taxes/business-taxes/withholding' },
    sit: { 2026: { status: C, sources: [nfc('MI', '2026/1781704387')], calc: SF({ form: 'MI-W4', brackets: { all: flat(4.25) }, allowanceDeduction: 5900, supplementalRate: 0.0425 }), notes: '$5,900 per exemption for 2026.' } },
    sui: { wageBase: { 2025: 9000, 2026: 9000 }, confirmedYears: [2025, 2026], newEmployerRate: 2.7, rateRange: [0.06, 10.3] },
  },
  {
    code: 'MN', name: 'Minnesota', fips: '27', type: 'state', flags: ['has_sui', 'has_pfml'],
    agency: { name: 'Minnesota Department of Revenue', url: 'https://www.revenue.state.mn.us/', withholdingGuide: 'https://www.revenue.state.mn.us/minnesota-income-tax-withholding-instruction-booklet-and-tax-tables' },
    sit: { 2026: { status: C, sources: [nfc('MN', '2026/1782924992')], calc: SF({ form: 'W-4MN', brackets: { single: br([0, 0], [4700, 5.35], [38010, 6.8], [114130, 7.85], [207850, 9.85]), mfj: br([0, 0], [14700, 5.35], [63400, 6.8], [208180, 7.85], [352630, 9.85]) }, allowanceDeduction: 5300, supplementalRate: 0.0625 }), notes: '2026 tables: $5,300 per allowance, with the deduction built into the zero bracket. Supplemental 6.25% not re-read.' } },
    sui: { wageBase: { 2025: 43000, 2026: 44000 }, confirmedYears: [2025, 2026], newEmployerRate: 1, rateRange: [0.1, 9.0] },
    programs: [
      { kind: 'PFML_EE', name: 'MN Paid Leave (employee up to 50%)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0044, wageBase: 'SS' }, from: '2026-01-01', status: C, annual: true, verifiedThrough: 2027, sources: ['mercer-pfml-2026', 'symetra-pfml-2027'], notes: 'Premiums begin Jan 1 2026 at 0.88% total.' },
      { kind: 'PFML_ER', name: 'MN Paid Leave (employer)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0044, wageBase: 'SS' }, from: '2026-01-01', status: C, annual: true, verifiedThrough: 2027, sources: ['mercer-pfml-2026', 'symetra-pfml-2027'] },
      { kind: 'WORKFORCE_ER', name: 'MN Workforce Development Fee', payer: 'employer', wageBasis: 'SUI', calc: { kind: 'percent', rate: 0.001, wageBase: 44000 }, from: '2026-01-01', status: U },
    ],
  },
  {
    code: 'MS', name: 'Mississippi', fips: '28', type: 'state', flags: ['has_sui'],
    agency: { name: 'Mississippi DOR', url: 'https://www.dor.ms.gov/', withholdingGuide: 'https://www.dor.ms.gov/business/withholding-tax' },
    sit: {
      2026: { status: C, sources: [nfc('MS', '2026/1768327516')], calc: SF({ form: '89-350', brackets: { all: br([0, 0], [10000, 4.0]) }, standardDeduction: { single: 2300, mfs: 2300, mfj_two_income: 2300, mfj: 4600, hoh: 3400 }, personalExemption: { single: 6000, mfs: 6000, mfj: 12000, hoh: 9500 }, dependentDeduction: 1500, allowanceDeduction: 1500, roundToDollar: true }), notes: '4.0% over $10,000 for 2026. Standard deduction $2,300 ($4,600 married with one income, $3,400 head of family), personal exemption by status and $1,500 per dependent.' },
      2027: { status: 'projected', calc: SF({ form: '89-350', brackets: { all: br([0, 0], [10000, 3.75]) }, standardDeduction: { single: 2300, mfs: 2300, mfj_two_income: 2300, mfj: 4600, hoh: 3400 }, personalExemption: { single: 6000, mfs: 6000, mfj: 12000, hoh: 9500 }, dependentDeduction: 1500, allowanceDeduction: 1500, roundToDollar: true }), notes: 'HB 1 (2025) sets 3.75% for 2027; the 2027 withholding tables were not read.' },
    },
    sui: { wageBase: { 2025: 14000, 2026: 14000, 2027: 14000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 1, rateRange: [0, 5.4] },
  },
  {
    code: 'MO', name: 'Missouri', fips: '29', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Missouri DOR', url: 'https://dor.mo.gov/', withholdingGuide: 'https://dor.mo.gov/taxation/business/tax-types/withholding/' },
    sit: { 2026: { status: C, sources: [nfc('MO', '2026/1773783048')], calc: SF({ form: 'MO W-4', usesFederalW4: false, brackets: { all: br([0, 0], [1348, 2], [2696, 2.5], [4044, 3], [5392, 3.5], [6740, 4], [8088, 4.5], [9436, 4.7]) }, standardDeduction: { single: 16100, mfs: 16100, mfj_two_income: 16100, mfj: 32200, hoh: 24150 }, roundToDollar: true }), notes: '2026 withholding formula. Married with a working spouse uses the single standard deduction.' } },
    sui: { wageBase: { 2025: 9500, 2026: 9000 }, confirmedYears: [2025, 2026], newEmployerRate: 2.376, rateRange: [0, 6.0] },
  },
  {
    code: 'MT', name: 'Montana', fips: '30', type: 'state', flags: ['has_sui'],
    agency: { name: 'Montana DOR', url: 'https://mtrevenue.gov/', withholdingGuide: 'https://mtrevenue.gov/taxes/wage-withholding/' },
    sit: {
      2026: { status: C, sources: [nfc('MT', '2026/1767632355')], calc: SF({ form: 'MW-4', brackets: { single: br([0, 0], [16100, 4.7], [63600, 5.65]), mfj: br([0, 0], [32200, 4.7], [127200, 5.65]), hoh: br([0, 0], [24150, 4.7], [95400, 5.65]), mfj_two_income: br([0, 0], [16100, 4.7], [63600, 5.65]) } }), notes: '2026 tables: the standard deduction is built into the zero bracket; 4.7% then 5.65%. Married with both spouses working uses the single table.' },
      2027: { status: 'projected', calc: SF({ form: 'MW-4', brackets: { single: br([0, 0], [16100, 4.7], [63600, 5.4]), mfj: br([0, 0], [32200, 4.7], [127200, 5.4]), hoh: br([0, 0], [24150, 4.7], [95400, 5.4]), mfj_two_income: br([0, 0], [16100, 4.7], [63600, 5.4]) } }), notes: 'Projection: 2026 thresholds with the 5.4% top rate HB 337 sets for 2027.' },
    },
    sui: { wageBase: { 2025: 45100, 2026: 47300 }, confirmedYears: [2025, 2026], newEmployerRate: 1, rateRange: [0, 6.12] },
  },
  {
    code: 'NE', name: 'Nebraska', fips: '31', type: 'state', flags: ['has_sui'],
    agency: { name: 'Nebraska DOR', url: 'https://revenue.nebraska.gov/', withholdingGuide: 'https://revenue.nebraska.gov/businesses/circular-en-income-tax-withholding-wages-pensions-and-annuities-and-gambling' },
    sit: {
      2026: { status: C, sources: [nfc('NE', '2026/1774374744')], calc: SF({ form: 'W-4N', brackets: { single: br([0, 0], [3430, 2.26], [6710, 3.22], [21810, 4.21], [31610, 4.35], [40130, 4.48], [75370, 4.6]), mfj: br([0, 0], [8190, 2.26], [13010, 3.22], [32400, 4.21], [50400, 4.35], [62530, 4.48], [82920, 4.6]) }, allowanceDeduction: 2440 }), notes: '2026 Circular EN table as summarized by NFC. Not modeled: the LB 223 minimum (half the tax on one or two allowances) for employees claiming more.' },
      2027: { status: 'projected', calc: SF({ form: 'W-4N', brackets: { single: br([0, 0], [3430, 2.26], [6710, 3.22], [21810, 3.99], [31610, 3.99], [40130, 3.99], [75370, 3.99]), mfj: br([0, 0], [8190, 2.26], [13010, 3.22], [32400, 3.99], [50400, 3.99], [62530, 3.99], [82920, 3.99]) }, allowanceDeduction: 2440 }), notes: 'Projection: 2026 thresholds with every rate capped at the 3.99% top rate that LB 754 sets for 2027. Replace with the 2027 Circular EN.' },
    },
    sui: { wageBase: { 2025: 9000, 2026: 9000, 2027: 9000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 1.25, rateRange: [0, 5.4] },
  },
  {
    code: 'NV', name: 'Nevada', fips: '32', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'Nevada DETR / Department of Taxation', url: 'https://tax.nv.gov/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 41800, 2026: 43700, 2027: 45400 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.95, rateRange: [0.25, 5.4], surcharges: [{ name: 'Career Enhancement Program', rate: 0.05 }] },
    programs: [{ kind: 'STATE_PAYROLL_ER', name: 'NV Modified Business Tax (general business, wages over $50,000/qtr)', payer: 'employer', wageBasis: 'GROSS', calc: { kind: 'percent', rate: 0.01378, threshold: 50000 }, from: '2025-07-01', status: U, notes: 'Quarterly threshold, not annual: engine treats as estimate. Financial institutions and mining use 1.554%. Rate reverts to 1.378% after the 1.17% temporary rate; confirm.' }],
  },
  {
    code: 'NH', name: 'New Hampshire', fips: '33', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'NH Employment Security', url: 'https://www.nhes.nh.gov/' },
    sit: { 2026: { status: 'published', calc: NONE, notes: 'Interest and dividends tax repealed for 2025+; no wage tax.' } },
    sui: { wageBase: { 2025: 14000, 2026: 14000, 2027: 14000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.7, rateRange: [0.1, 8.5] },
  },
  {
    code: 'NJ', name: 'New Jersey', fips: '34', type: 'state', flags: ['has_sui', 'has_sdi', 'has_pfml', 'has_local_income_tax'],
    agency: { name: 'NJ Division of Taxation', url: 'https://www.nj.gov/treasury/taxation/', withholdingGuide: 'https://www.nj.gov/treasury/taxation/pdf/current/njwt.pdf' },
    sit: { 2026: { status: C, sources: [nfc('NJ', '2021/1615324548')], calc: { kind: 'custom', handler: 'NJ', params: {
      allowanceDeduction: 1000,
      tables: {
        A: br([0, 1.5], [20000, 2.0], [35000, 3.9], [40000, 6.1], [75000, 7.0], [500000, 9.9], [1000000, 11.8]),
        B: br([0, 1.5], [20000, 2.0], [50000, 2.7], [70000, 3.9], [80000, 6.1], [150000, 7.0], [500000, 9.9], [1000000, 11.8]),
        C: br([0, 1.5], [20000, 2.3], [40000, 2.8], [50000, 3.5], [60000, 5.6], [150000, 6.6], [500000, 9.9], [1000000, 11.8]),
        D: br([0, 1.5], [20000, 2.7], [40000, 3.4], [50000, 4.3], [60000, 5.6], [150000, 6.5], [500000, 9.9], [1000000, 11.8]),
        E: br([0, 1.5], [20000, 2.0], [35000, 5.8], [100000, 6.5], [500000, 9.9], [1000000, 11.8]),
      },
      statusTable: { single: 'A', mfs: 'A', mfj: 'B', hoh: 'B', qss: 'B' },
      supplementalRate: null,
    } }, notes: 'NJ-WT rate tables A-E (employee may elect a table on NJ-W4). All five tables match the federal payroll bulletin of March 2021, the latest one.' } },
    sui: { wageBase: { 2025: 43300, 2026: 44800, 2027: 46400 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.8, rateRange: [0.4, 5.4], employeeRate: 0.425, employeeWageBase: { 2025: 43300, 2026: 44800, 2027: 46400 } },
    programs: [
      { kind: 'SDI_EE', name: 'NJ Temporary Disability Insurance (employee)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.0024, wageBase: 177100 }, from: '2027-01-01', status: U, sources: ['symetra-pfml-2027'], notes: '2027 employee rate 0.24% as listed by one insurer summary; the same page is unclear on the wage base, so $177,100 is taken from its family leave row. Check against the New Jersey Department of Labor notice.' },
      { kind: 'SDI_EE', name: 'NJ Temporary Disability Insurance (employee)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.0019, wageBase: 171100 }, from: '2026-01-01', to: '2026-12-31', status: C, sources: ['mercer-pfml-2026'], notes: '0.19% on the first $171,100 for 2026. Wage base equals the FLI base since 2020 (A3975).' },
      { kind: 'FLI_EE', name: 'NJ Family Leave Insurance (employee)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.0023, wageBase: 177100 }, from: '2027-01-01', status: U, sources: ['symetra-pfml-2027'], notes: '2027: 0.23% on wages up to $177,100 as listed by one insurer summary. Check against the New Jersey Department of Labor notice.' },
      { kind: 'FLI_EE', name: 'NJ Family Leave Insurance (employee)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.0023, wageBase: 171100 }, from: '2026-01-01', to: '2026-12-31', status: C, sources: ['mercer-pfml-2026'], notes: '0.23% on the first $171,100 for 2026.' },
      { kind: 'SDI_EE', name: 'NJ Temporary Disability Insurance (employee)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.0023, wageBase: 165400 }, from: '2025-01-01', to: '2025-12-31', status: U },
      { kind: 'FLI_EE', name: 'NJ Family Leave Insurance (employee)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.0033, wageBase: 165400 }, from: '2025-01-01', to: '2025-12-31', status: U },
      { kind: 'SDI_ER', name: 'NJ TDI (employer)', payer: 'employer', wageBasis: 'SUI', calc: { kind: 'percent', rate: 0.005, wageBase: 44800, employerRateOverridable: true, rateRange: [0.1, 1.1] }, from: '2026-01-01', status: U, annual: true, notes: 'New employer rate 0.5%; assigned rates 0.1% to 1.1% on the unemployment wage base.' },
    ],
  },
  {
    code: 'NM', name: 'New Mexico', fips: '35', type: 'state', flags: ['has_sui'],
    agency: { name: 'NM Taxation and Revenue', url: 'https://www.tax.newmexico.gov/', withholdingGuide: 'https://www.tax.newmexico.gov/businesses/wage-withholding-tax/' },
    sit: { 2026: { status: C, sources: [nfc('NM', '2026/1776874663')], calc: SF({ form: 'W-4 (federal)', usesFederalW4: true, brackets: { single: br([0, 0], [8050, 1.5], [13550, 3.2], [24550, 4.3], [41550, 4.7], [74550, 4.9], [218050, 5.9]), mfj: br([0, 0], [16100, 1.5], [24100, 3.2], [41100, 4.3], [66100, 4.7], [116100, 4.9], [331100, 5.9]), hoh: br([0, 0], [12075, 1.5], [20075, 3.2], [37075, 4.3], [62075, 4.7], [112075, 4.9], [327075, 5.9]) } }), notes: 'FYI-104 tables in effect from mid-2026; the deduction is built into the zero bracket.' } },
    sui: { wageBase: { 2025: 33200, 2026: 34800 }, confirmedYears: [2025, 2026], newEmployerRate: 1, rateRange: [0.33, 6.4] },
    programs: [
      { kind: 'WC_EE', name: 'NM Workers Compensation Fee (employee)', payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'fixed', amount: 2.0, per: 'quarter' }, from: '2025-01-01', status: U },
      { kind: 'WC_ER', name: 'NM Workers Compensation Fee (employer)', payer: 'employer', wageBasis: 'GROSS', calc: { kind: 'fixed', amount: 2.3, per: 'quarter' }, from: '2025-01-01', status: U },
    ],
  },
  {
    code: 'NY', name: 'New York', fips: '36', type: 'state', flags: ['has_sui', 'has_sdi', 'has_pfml', 'has_local_income_tax', 'convenience_of_employer'],
    agency: { name: 'NYS Department of Taxation and Finance', url: 'https://www.tax.ny.gov/', withholdingGuide: 'https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf' },
    sit: { 2026: { status: C, sources: [nfc('NY', '2026/1772477134')], calc: SF({ form: 'IT-2104', brackets: { single: br([0, 3.9], [8500, 4.4], [11700, 5.15], [13900, 5.4], [80650, 5.9], [96800, 7.03], [107650, 7.53], [157650, 6.4], [215400, 11.44], [265400, 7.35], [1077550, 10.45], [5000000, 11.1], [25000000, 11.7]), mfj: br([0, 3.9], [8500, 4.4], [11700, 5.15], [13900, 5.4], [80650, 5.9], [96800, 6.57], [107650, 7.07], [157650, 8.01], [211550, 6.4], [323200, 13.49], [373200, 7.35], [1077550, 7.65], [2155350, 10.45], [5000000, 11.1], [25000000, 11.7]) }, standardDeduction: { single: 7400, mfs: 7400, hoh: 7400, mfj: 7950 }, allowanceDeduction: 1000, supplementalRate: 0.1023 }), notes: 'NYS-50-T-NYS exact calculation method for 2026 (rates reflect the 2026 rate cut and the built-in recapture steps). Above about $1,077,550 the state taxes all income at the bracket rate rather than marginally; that is not modeled. Supplemental rate not re-read.' } },
    sui: { wageBase: { 2025: 12800, 2026: 17600 }, confirmedYears: [2025, 2026], newEmployerRate: 3.4, rateRange: [2.1, 9.9], surcharges: [{ name: 'Re-employment Service Fund', rate: 0.075 }] },
    programs: [
      { kind: 'SDI_EE', name: 'NY Disability Benefits (DBL), employee max $0.60/week', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.005, weeklyMax: 0.6 }, from: '2025-01-01', status: 'published', notes: 'Employer may collect 0.5% of wages up to $0.60 per week.' },
      { kind: 'FLI_EE', name: 'NY Paid Family Leave', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.00452, wageBase: 99957.96, annualMax: 451.81 }, from: '2027-01-01', status: P, sources: ['ny-dfs-pfl-2027'], notes: 'DFS decision of Aug 31, 2026: 0.452% of wages, maximum $451.81 for the year. DFS does not print the wage cap; the cap here is the maximum divided by the rate, and the annual maximum is what limits the deduction.' },
      { kind: 'FLI_EE', name: 'NY Paid Family Leave', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.00432, wageBase: 95349.54, annualMax: 411.91 }, from: '2026-01-01', to: '2026-12-31', status: C, sources: ['mercer-pfml-2026'], notes: 'Rate and cap set annually by DFS (based on NYS average weekly wage).' },
      { kind: 'FLI_EE', name: 'NY Paid Family Leave', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.00388, wageBase: 91373.7, annualMax: 354.53 }, from: '2025-01-01', to: '2025-12-31', status: 'published' },
    ],
  },
  {
    code: 'NC', name: 'North Carolina', fips: '37', type: 'state', flags: ['has_sui'],
    agency: { name: 'NC Department of Revenue', url: 'https://www.ncdor.gov/', withholdingGuide: 'https://www.ncdor.gov/taxes-forms/withholding-tax' },
    sit: { 2026: { status: C, sources: [nfc('NC', '2026/1767633224')], calc: SF({ form: 'NC-4', brackets: { all: flat(4.09) }, standardDeduction: { single: 12750, mfs: 12750, mfj: 12750, hoh: 19125 }, allowanceDeduction: 2500, supplementalRate: 0.0409, roundToDollar: true }), notes: 'Withholding rate 4.09% for 2026 (the 3.99% tax rate plus the 0.1 point the law adds for withholding). Standard deduction $12,750, or $19,125 for head of household; married employees use $12,750 each. $2,500 per allowance.' } },
    sui: { wageBase: { 2025: 32600, 2026: 34200 }, confirmedYears: [2025, 2026], newEmployerRate: 1, rateRange: [0.06, 5.76] },
  },
  {
    code: 'ND', name: 'North Dakota', fips: '38', type: 'state', flags: ['has_sui'],
    agency: { name: 'ND Office of State Tax Commissioner', url: 'https://www.tax.nd.gov/', withholdingGuide: 'https://www.tax.nd.gov/business/income-tax-withholding' },
    sit: { 2026: { status: U, sources: [nfc('ND', '2026/1767646699')], calc: SF({ form: 'W-4 (federal)', usesFederalW4: true, brackets: { single: br([0, 0], [57625, 1.95], [258450, 2.5]), mfj: br([0, 0], [80975, 1.95], [298075, 2.5]), hoh: br([0, 0], [78475, 1.95], [289675, 2.5]) }, roundToDollar: true }), notes: 'Single and head of household tables from the NFC bulletin of August 2026 (no separate deduction: the zero bracket covers it). The state booklet confirms these single figures, and a married zero bracket of $57,500, for W-4 forms from before 2020 (with $5,050 per allowance). The tables for 2020 and later W-4 forms could not be read, so the married thresholds here are still the 2025 ones. Treat North Dakota as an estimate.' } },
    sui: { wageBase: { 2025: 45100, 2026: 46600 }, confirmedYears: [2025, 2026], newEmployerRate: 1.03, rateRange: [0.08, 9.68] },
  },
  {
    code: 'OH', name: 'Ohio', fips: '39', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Ohio Department of Taxation', url: 'https://tax.ohio.gov/', withholdingGuide: 'https://tax.ohio.gov/business/ohio-business-taxes/employer-withholding' },
    sit: { 2026: { status: C, sources: [nfc('OH', '2026/1786990318')], calc: SF({ form: 'IT 4', brackets: { all: br([0, 1.6], [26050, 2.99], [100000, 3.4]) }, allowanceDeduction: 650, supplementalRate: 0.035 }), notes: 'Withholding table in effect from September 2026 (NFC bulletin of 2026-09-23). The withholding rates differ from the statutory rate on purpose. Supplemental 3.5% not re-read.' } },
    sui: { wageBase: { 2025: 9000, 2026: 9000, 2027: 9000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.7, rateRange: [0.4, 10.2] },
  },
  {
    code: 'OK', name: 'Oklahoma', fips: '40', type: 'state', flags: ['has_sui'],
    agency: { name: 'Oklahoma Tax Commission', url: 'https://oklahoma.gov/tax.html', withholdingGuide: 'https://oklahoma.gov/tax/businesses/withholding.html' },
    sit: { 2026: { status: C, sources: [nfc('OK', '2026/1773324603')], calc: SF({ form: 'OK-W-4', brackets: { single: br([0, 0], [10100, 2.5], [11250, 3.5], [13550, 4.5]), mfj: br([0, 0], [20200, 2.5], [22500, 3.5], [27100, 4.5]) }, allowanceDeduction: 1000, roundToDollar: true }), notes: '2026 tables: three rates with a 4.5% top rate; the deduction is built into the zero bracket. $1,000 per allowance.' } },
    sui: { wageBase: { 2025: 28200, 2026: 25000, 2027: 24400 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 1.5, rateRange: [0.3, 9.2] },
  },
  {
    code: 'OR', name: 'Oregon', fips: '41', type: 'state', flags: ['has_sui', 'has_pfml', 'has_local_income_tax'],
    agency: { name: 'Oregon Department of Revenue', url: 'https://www.oregon.gov/dor/', withholdingGuide: 'https://www.oregon.gov/dor/programs/businesses/Pages/Withholding-and-payroll-tax.aspx' },
    sit: { 2026: { status: C, sources: [nfc('OR', '2026/1778117419')], calc: { kind: 'custom', handler: 'OR', params: {
      federalTaxCap: 8750, federalTaxPhase: { single: 125000, mfj: 250000, step: { single: 5000, mfj: 10000 }, reduceBy: 1750 },
      standardDeduction: { singleUnder3: 2910, other: 5820 }, allowanceCredit: 263, lowWageLimit: 50000,
      low: { single: br([0, 4.75], [4550, 6.75], [11400, 8.75]), other: br([0, 4.75], [9100, 6.75], [22800, 8.75]) },
      high: { single: { floor: 11400, base: 678, brackets: br([0, 8.75], [113600, 9.9]) }, other: { floor: 22800, base: 1357, brackets: br([0, 8.75], [227200, 9.9]) } },
      allowanceReduction: { single: 100000, mfj: 200000 }, noFormRate: 0.08, supplementalRate: 0.08,
    } }, notes: 'Oregon formula in effect from September 2026: federal tax subtraction capped at $8,750 and phased out, standard deduction, two tables split at $50,000 of annual wages, $263 credit per allowance. The low-wage table in the bulletin adds $263 to the tax before the credit; that is carried in the handler.' } },
    sui: { wageBase: { 2025: 54300, 2026: 56700 }, confirmedYears: [2025, 2026], newEmployerRate: 2.4, rateRange: [0.9, 5.4] },
    programs: [
      { kind: 'TRANSIT_EE', name: 'Oregon Statewide Transit Tax', payer: 'employee', wageBasis: 'SIT', calc: { kind: 'percent', rate: 0.001 }, from: '2018-07-01', status: 'published', sources: ['or-dor-statewide-transit'], notes: 'Figured on wages as defined in ORS 316.162 (state withholding wages), so pre-tax Section 125 deductions lower it.' },
      { kind: 'PFML_EE', name: 'Paid Leave Oregon (employee 60%)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.006, wageBase: 'SS' }, from: '2026-01-01', status: C, annual: true, sources: ['mercer-pfml-2026'] },
      { kind: 'PFML_ER', name: 'Paid Leave Oregon (employer 40%, 25+ employees)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.004, wageBase: 'SS' }, from: '2026-01-01', status: C, annual: true, sources: ['mercer-pfml-2026'], optional: true },
      { kind: 'WC_EE', name: 'Oregon Workers Benefit Fund (employee, per hour)', payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'custom', handler: 'PER_HOUR', params: { rate: 0.011 } }, from: '2026-01-01', status: U, notes: 'Cents-per-hour assessment split between employer and employee.' },
    ],
  },
  {
    code: 'PA', name: 'Pennsylvania', fips: '42', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'PA Department of Revenue', url: 'https://www.revenue.pa.gov/', withholdingGuide: 'https://www.revenue.pa.gov/TaxTypes/EmployerWithholding/' },
    sit: { 2026: { status: 'published', calc: SF({ brackets: { all: flat(3.07) }, supplementalRate: 0.0307 }), notes: 'Flat 3.07% on PA compensation; no exemptions. PA taxes 401(k)/403(b)/457 deferrals.' } },
    sui: { wageBase: { 2025: 10000, 2026: 10000, 2027: 10000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 3.822, rateRange: [1.419, 10.374], employeeRate: 0.07 },
  },
  {
    code: 'RI', name: 'Rhode Island', fips: '44', type: 'state', flags: ['has_sui', 'has_sdi'],
    agency: { name: 'RI Division of Taxation', url: 'https://tax.ri.gov/', withholdingGuide: 'https://tax.ri.gov/tax-sections/withholding-tax' },
    sit: { 2026: { status: C, sources: [nfc('RI', '2026/1772030778')], calc: SF({ form: 'RI W-4', brackets: { all: br([0, 3.75], [82050, 4.75], [186450, 5.99]) }, allowanceDeduction: 1000, allowanceNoneAbove: 290800 }), notes: '$1,000 per exemption, and none once annual pay is over $290,800.' } },
    sui: { wageBase: { 2025: 29800, 2026: 30800 }, confirmedYears: [2025, 2026], newEmployerRate: 1, rateRange: [0.9, 9.8], surcharges: [{ name: 'Job Development Fund', rate: 0.21 }] },
    programs: [
      { kind: 'SDI_EE', name: 'RI Temporary Disability / Caregiver Insurance', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.011, wageBase: 100000 }, from: '2026-01-01', status: C, annual: true, sources: ['mercer-pfml-2026'], notes: '1.1% on the first $100,000 for 2026. Rate and wage base reset annually by RI DLT.' },
      { kind: 'SDI_EE', name: 'RI Temporary Disability / Caregiver Insurance', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.013, wageBase: 89200 }, from: '2025-01-01', to: '2025-12-31', status: U, notes: '2025: 1.3% on the first $89,200 (from memory of the RI DLT notice; not re-read).' },
    ],
  },
  {
    code: 'SC', name: 'South Carolina', fips: '45', type: 'state', flags: ['has_sui'],
    agency: { name: 'SC Department of Revenue', url: 'https://dor.sc.gov/', withholdingGuide: 'https://dor.sc.gov/tax/withholding' },
    sit: { 2026: { status: C, sources: [nfc('SC', '2026/1773173131')], calc: SF({ form: 'SC W-4', brackets: { all: br([0, 0], [3640, 3], [18230, 6.0]) }, standardDeduction: { all: { pct: 0.1, min: 0, max: 7500 } }, standardDeductionNeedsAllowance: true, allowanceDeduction: 5000 }), notes: '2026 formula: $5,000 per allowance; with at least one allowance, a standard deduction of 10% of wages up to $7,500.' } },
    sui: { wageBase: { 2025: 14000, 2026: 14000, 2027: 14000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 1, rateRange: [0.06, 5.46], surcharges: [{ name: 'Contingency assessment', rate: 0.06 }] },
  },
  {
    code: 'SD', name: 'South Dakota', fips: '46', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'SD Department of Labor', url: 'https://dlr.sd.gov/ra/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 15000, 2026: 15000, 2027: 15000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 1.2, rateRange: [0, 9.35] },
  },
  {
    code: 'TN', name: 'Tennessee', fips: '47', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'TN Department of Labor', url: 'https://www.tn.gov/workforce/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 7000, 2026: 7000 }, confirmedYears: [2025, 2026], newEmployerRate: 2.7, rateRange: [0.01, 10.0] },
  },
  {
    code: 'TX', name: 'Texas', fips: '48', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'Texas Workforce Commission', url: 'https://www.twc.texas.gov/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 9000, 2026: 9000, 2027: 9000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.7, rateRange: [0.25, 6.25] },
  },
  {
    code: 'UT', name: 'Utah', fips: '49', type: 'state', flags: ['has_sui'],
    agency: { name: 'Utah State Tax Commission', url: 'https://tax.utah.gov/', withholdingGuide: 'https://tax.utah.gov/forms/pubs/pub-14.pdf' },
    sit: { 2026: { status: C, sources: [nfc('UT', '2026/1782763921')], calc: { kind: 'custom', handler: 'UT', params: { rate: 0.0445, baseAllowance: { single: 485, mfs: 485, hoh: 485, mfj: 970 }, phaseoutStart: { single: 9348, mfs: 9348, hoh: 9348, mfj: 18696 }, phaseoutRate: 0.013 } }, notes: 'In effect from July 2026: 4.45% of wages less an allowance of $485 ($970 married) that shrinks by 1.3% of wages over $9,348 ($18,696 married).' } },
    sui: { wageBase: { 2025: 48900, 2026: 50700 }, confirmedYears: [2025, 2026], newEmployerRate: 1.2, rateRange: [0.3, 7.3] },
  },
  {
    code: 'VT', name: 'Vermont', fips: '50', type: 'state', flags: ['has_sui'],
    agency: { name: 'Vermont Department of Taxes', url: 'https://tax.vermont.gov/', withholdingGuide: 'https://tax.vermont.gov/business/withholding' },
    sit: { 2026: { status: C, sources: [nfc('VT', '2026/1780320782')], calc: SF({ form: 'W-4VT', brackets: { single: br([0, 0], [3925, 3.35], [54675, 6.6], [126775, 7.6], [260225, 8.75]), mfj: br([0, 0], [11775, 3.35], [96475, 6.6], [216525, 7.6], [323825, 8.75]) }, allowanceDeduction: 5400 }), notes: '2026 tables with $5,400 per allowance.' } },
    sui: { wageBase: { 2025: 14800, 2026: 15400 }, confirmedYears: [2025, 2026], newEmployerRate: 1, rateRange: [0.4, 5.4] },
  },
  {
    code: 'VA', name: 'Virginia', fips: '51', type: 'state', flags: ['has_sui'],
    agency: { name: 'Virginia Department of Taxation', url: 'https://www.tax.virginia.gov/', withholdingGuide: 'https://www.tax.virginia.gov/withholding-tax' },
    sit: { 2026: { status: C, sources: [nfc('VA', '2025/1750694986')], calc: SF({ form: 'VA-4', brackets: { all: br([0, 2], [3000, 3], [5000, 5], [17000, 5.75]) }, standardDeduction: { all: 8750 }, allowanceDeduction: 930 }), notes: 'Enhanced standard deduction $8,750 through 2026; personal exemption $930.' } },
    sui: { wageBase: { 2025: 8000, 2026: 8000, 2027: 8000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.5, rateRange: [0.1, 6.2] },
  },
  {
    code: 'WA', name: 'Washington', fips: '53', type: 'state', flags: ['has_sui', 'no_income_tax', 'has_pfml'],
    agency: { name: 'WA Employment Security Department', url: 'https://esd.wa.gov/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 72800, 2026: 78200, 2027: 82000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 1, rateRange: [0.0, 6.0], surcharges: [{ name: 'Employment Administration Fund', rate: 0.03 }] },
    programs: [
      { kind: 'PFML_EE', name: 'WA Paid Family & Medical Leave (employee)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.008484, wageBase: 'SS' }, from: '2027-01-01', status: C, sources: ['nfp-wa-pfml-2027'], notes: 'Total premium 1.2% for 2027; employees pay 70.7% of it (0.8484%). Wage cap is the Social Security wage base.' },
      { kind: 'PFML_ER', name: 'WA PFML (employer, 50+ employees)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.003516, wageBase: 'SS' }, from: '2027-01-01', status: C, sources: ['nfp-wa-pfml-2027'], optional: true, notes: 'Employers pay 29.3% of the 1.2% premium (0.3516%); employers with fewer than 50 employees pay no employer share.' },
      { kind: 'PFML_EE', name: 'WA Paid Family & Medical Leave (employee)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0080716, wageBase: 'SS' }, from: '2026-01-01', to: '2026-12-31', status: C, sources: ['mercer-pfml-2026'], notes: 'Total 1.13% for 2026; employees pay 71.43% (0.80716%).' },
      { kind: 'PFML_ER', name: 'WA PFML (employer, 50+ employees)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0032284, wageBase: 'SS' }, from: '2026-01-01', to: '2026-12-31', status: C, sources: ['mercer-pfml-2026'], optional: true, notes: 'Employers pay 28.57% of the 1.13% premium (0.32284%); under 50 employees exempt.' },
      { kind: 'LTC_EE', name: 'WA Cares Fund (long-term care)', payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'percent', rate: 0.0058 }, from: '2023-07-01', status: 'published', notes: 'No wage cap. Employees with approved exemptions are excluded (toggle per employee).' },
      { kind: 'WC_EE', name: 'WA L&I workers comp (employee share, per hour)', payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'custom', handler: 'PER_HOUR', params: { rate: 0 } }, from: '2026-01-01', status: 'placeholder', notes: 'Rate depends on risk class; set per client.' },
    ],
  },
  {
    code: 'WV', name: 'West Virginia', fips: '54', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'WV State Tax Department', url: 'https://tax.wv.gov/', withholdingGuide: 'https://tax.wv.gov/Business/Withholding/Pages/Withholding.aspx' },
    sit: { 2026: { status: C, sources: [nfc('WV', '2026/1786455448')], calc: SF({ form: 'WV/IT-104', brackets: { all: br([0, 2.11], [10000, 2.81], [25000, 3.16], [40000, 4.22], [60000, 4.58]), mfj_two_income: br([0, 2.11], [7500, 2.81], [18750, 3.16], [30000, 4.22], [45000, 4.58]) }, allowanceDeduction: 2000, roundToDollar: true }), notes: 'Tables in effect from August 2026. The one-earner table is the default; the two-earner table applies when the employee marks two earners or two jobs.' } },
    sui: { wageBase: { 2025: 9500, 2026: 9500, 2027: 9500 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 2.7, rateRange: [1.5, 8.5] },
  },
  {
    code: 'WI', name: 'Wisconsin', fips: '55', type: 'state', flags: ['has_sui'],
    agency: { name: 'Wisconsin DOR', url: 'https://www.revenue.wi.gov/', withholdingGuide: 'https://www.revenue.wi.gov/DOR%20Publications/pb166.pdf' },
    sit: { 2026: { status: C, sources: [nfc('WI', '2022/1646766842')], calc: SF({ form: 'WT-4', brackets: { all: br([0, 3.54], [12760, 4.65], [25520, 5.3], [280950, 7.65]) }, standardDeduction: { single: 6702, mfs: 6702, hoh: 6702, mfj: 9461 }, standardDeductionSlide: { single: { start: 17780, rate: 0.12 }, mfj: { start: 25727, rate: 0.2 } }, allowanceDeduction: 400 }), notes: 'Withholding tables in effect since January 2022 (the latest bulletin; Wisconsin has not reissued them). Deduction of $6,702 single or $9,461 married, shrinking as wages rise; $400 per exemption. The bulletin does not label the second deduction table; it is read as the married table.' } },
    sui: { wageBase: { 2025: 14000, 2026: 14000, 2027: 14000 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 3.05, rateRange: [0, 12.0] },
  },
  {
    code: 'WY', name: 'Wyoming', fips: '56', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'WY Department of Workforce Services', url: 'https://dws.wyo.gov/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 32400, 2026: 33800, 2027: 34900 }, confirmedYears: [2025, 2026, 2027], newEmployerRate: 1, rateRange: [0.09, 8.5] },
  },

  // ---------------- Territories ----------------
  {
    code: 'PR', name: 'Puerto Rico', fips: '72', type: 'territory', flags: ['fica_applies', 'futa_applies', 'has_sui', 'has_sdi', 'fit_replaced_by_territory_tax'],
    agency: { name: 'Departamento de Hacienda de Puerto Rico', url: 'https://hacienda.pr.gov/', withholdingGuide: 'https://hacienda.pr.gov/' },
    sit: { 2026: { status: U, calc: { kind: 'custom', handler: 'PR', params: { brackets: br([0, 0], [9000, 7], [25000, 14], [41500, 25], [61500, 33]), personalExemption: { single: 3500, mfs: 3500, hoh: 3500, mfj: 7000 }, allowanceDeduction: 500, dependentDeduction: 2500, gradualAdjustment: true } }, notes: 'Code 2011 withholding tables; personal exemption $3,500 ($7,000 married), $500 per allowance for deductions and $2,500 per dependent, per the 2018 federal payroll bulletin (the latest). Bonus/supplemental and 2025 reform proposals not modeled.' } },
    sui: { wageBase: { 2025: 7000, 2026: 7000 }, confirmedYears: [2025, 2026], newEmployerRate: 3.4, rateRange: [2.4, 5.4] },
    programs: [
      { kind: 'TERR_SDI_EE', name: 'PR SINOT disability (employee)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.003, wageBase: 9000 }, from: '2020-01-01', status: U },
      { kind: 'TERR_SDI_ER', name: 'PR SINOT disability (employer)', payer: 'employer', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.003, wageBase: 9000 }, from: '2020-01-01', status: U },
      { kind: 'TERR_DRIVER_EE', name: "PR Chauffeur's insurance (drivers only)", payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'fixed', amount: 0.3, per: 'week' }, from: '2020-01-01', status: U, optional: true },
      { kind: 'TERR_DRIVER_ER', name: "PR Chauffeur's insurance (employer, drivers only)", payer: 'employer', wageBasis: 'GROSS', calc: { kind: 'fixed', amount: 0.3, per: 'week' }, from: '2020-01-01', status: U, optional: true },
    ],
    notes: 'PR residents working in PR: wages generally excluded from US FIT (IRC 933); FICA and FUTA apply. Employer files with Hacienda (Form 499R-2/W-2PR).',
  },
  {
    code: 'GU', name: 'Guam', fips: '66', type: 'territory', flags: ['mirror_code', 'fica_applies', 'fit_replaced_by_territory_tax'],
    agency: { name: 'Guam Department of Revenue and Taxation', url: 'https://www.guamtax.com/' },
    sit: { 2026: { status: 'published', calc: { kind: 'custom', handler: 'MIRROR_FEDERAL', params: {} }, notes: 'Guam Territorial Income Tax mirrors the IRC: withhold using federal Pub 15-T tables, remit to Guam DRT. No FUTA, no SUI program.' } },
  },
  {
    code: 'VI', name: 'U.S. Virgin Islands', fips: '78', type: 'territory', flags: ['mirror_code', 'fica_applies', 'futa_applies', 'has_sui', 'fit_replaced_by_territory_tax', 'futa_credit_reduction'],
    agency: { name: 'USVI Bureau of Internal Revenue', url: 'https://bir.vi.gov/' },
    sit: { 2026: { status: 'published', calc: { kind: 'custom', handler: 'MIRROR_FEDERAL', params: {} }, notes: 'Mirror code: federal tables, remit to VI BIR. FUTA applies with credit reduction.' } },
    sui: { wageBase: { 2025: 31100, 2026: 32100 }, confirmedYears: [2025, 2026], newEmployerRate: 2, rateRange: [0, 6.0], status: 'unverified' },
  },
  {
    code: 'AS', name: 'American Samoa', fips: '60', type: 'territory', flags: ['fica_applies', 'fit_replaced_by_territory_tax'],
    agency: { name: 'American Samoa Tax Office', url: 'https://www.americansamoa.gov/' },
    sit: { 2026: { status: 'placeholder', calc: { kind: 'custom', handler: 'MIRROR_FEDERAL', params: { note: 'AS uses its own income tax code modeled on the IRC with local modifications; placeholder uses federal tables.' } }, notes: 'Placeholder: American Samoa income tax withholding needs agency tables. No FUTA, no SUI.' } },
  },
  {
    code: 'MP', name: 'Northern Mariana Islands', fips: '69', type: 'territory', flags: ['mirror_code', 'fica_applies', 'fit_replaced_by_territory_tax'],
    agency: { name: 'CNMI Division of Revenue and Taxation', url: 'https://www.finance.gov.mp/' },
    sit: { 2026: { status: U, calc: { kind: 'custom', handler: 'MIRROR_FEDERAL', params: {} }, notes: 'NMTIT mirror withholding using federal tables; the Wage & Salary Tax (separate rule) is creditable against NMTIT via rebate.' } },
    programs: [{ kind: 'TERR_WAGE_EE', name: 'CNMI Wage and Salary Tax', payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'custom', handler: 'ANNUAL_BRACKETS_ON_GROSS', params: { brackets: br([0, 0], [1000, 2], [5000, 3], [7000, 5], [22000, 6], [30000, 7], [40000, 8], [50000, 9]) } }, from: '2020-01-01', status: U, notes: '4 CMC 1203 schedule applied to annualized gross wages.' }],
  },
];

// ---------------- Builders ----------------

const lastYear = 2027;

/** Clone a year's definition into later years as 'projected' (carry-forward). */
function expandSitYears(p: StateProfile): [number, SitYear][] {
  const years = Object.keys(p.sit).map(Number).sort();
  const out: [number, SitYear][] = [];
  for (let y = years[0]; y <= lastYear; y++) {
    if (p.sit[y]) out.push([y, p.sit[y]!]);
    else {
      const prev = out[out.length - 1][1];
      const keepPublishedNone = prev.calc.kind === 'none' && prev.status === 'published';
      out.push([y, { calc: prev.calc, status: keepPublishedNone ? 'published' : 'projected', sources: prev.sources, notes: keepPublishedNone ? prev.notes : `Carried forward from ${y - 1}; agency has not published ${y} values in our data yet. ${prev.notes ?? ''}`.trim() }]);
    }
  }
  return out;
}

export function buildStateJurisdictions(): Jurisdiction[] {
  return STATES.map((s) => ({ code: s.code, name: s.name, type: s.type, state: s.code, fips: s.fips, parent: 'US', flags: s.flags, notes: s.notes }));
}

/** Where a figure came from decides how it is labeled: only a figure with a named outside source can be more than 'unverified'. */
const INTERNAL = 'research-memory-2026';

export function buildStateRules(): TaxRule[] {
  const rules: TaxRule[] = [];
  for (const s of STATES) {
    const src = agencySource(`${s.code.toLowerCase()}-agency`, s.agency.name, `${s.agency.name} withholding guidance`, s.agency.withholdingGuide ?? s.agency.url);
    for (const [y, def] of expandSitYears(s)) {
      // A state with no wage income tax is a matter of statute: the agency is the only source it needs.
      const sources = def.sources?.length ? [src.id, ...def.sources] : def.calc.kind === 'none' && def.status === 'published' ? [src.id] : [src.id, INTERNAL];
      rules.push({ id: `${s.code}.SIT.${y}`, jurisdiction: s.code, kind: 'SIT', name: `${s.name} income tax withholding`, payer: 'employee', wageBasis: 'SIT', effectiveFrom: `${y}-01-01`, effectiveTo: `${y}-12-31`, status: def.status, sources, calc: def.calc, appliesTo: 'resident_or_work', notes: def.notes });
    }
    if (s.sui) {
      const years = Object.keys(s.sui.wageBase).map(Number).sort();
      for (let y = years[0]; y <= lastYear; y++) {
        const base = s.sui.wageBase[y] ?? s.sui.wageBase[years[years.length - 1]]!;
        const projected = s.sui.wageBase[y] === undefined;
        const confirmed = !projected && !!s.sui.confirmedYears?.includes(y);
        const status: VerificationStatus = projected ? 'projected' : confirmed ? 'confirmed' : s.sui.status ?? U;
        const compiled = confirmed ? [y >= 2027 ? 'aps-sui-2027' : 'ey-sui-2026'] : [];
        const ePeriod = { effectiveFrom: `${y}-01-01`, effectiveTo: `${y}-12-31` };
        const note = projected ? `Wage base carried forward from ${years[years.length - 1]}; most states announce in Q4.` : confirmed ? 'Wage base and new-employer rate match the state-by-state compilation.' : undefined;
        rules.push({ id: `${s.code}.SUI_ER.${y}`, jurisdiction: s.code, kind: 'SUI_ER', name: `${s.name} unemployment insurance (employer)`, payer: 'employer', wageBasis: 'SUI', ...ePeriod, status, sources: [src.id, ...compiled, 'dol-sui-comparison'], appliesTo: 'work', calc: { kind: 'percent', rate: s.sui.newEmployerRate / 100, wageBase: base, employerRateOverridable: true, rateRange: s.sui.rateRange ? [s.sui.rateRange[0] / 100, s.sui.rateRange[1] / 100] : undefined }, notes: `Default is the new-employer rate; set each client's assigned rate. ${note ?? ''}`.trim() });
        // Employee rates and the small employer assessments were not part of the compilation, so they stay unverified.
        const sideStatus: VerificationStatus = projected ? 'projected' : s.sui.status ?? U;
        if (s.sui.employeeRate) {
          const eb = s.sui.employeeWageBase ? (s.sui.employeeWageBase[y] ?? Object.values(s.sui.employeeWageBase).pop()) : undefined;
          rules.push({ id: `${s.code}.SUI_EE.${y}`, jurisdiction: s.code, kind: 'SUI_EE', name: `${s.name} unemployment insurance (employee)`, payer: 'employee', wageBasis: 'SUI', ...ePeriod, status: sideStatus, sources: [src.id, INTERNAL], appliesTo: 'work', calc: { kind: 'percent', rate: s.sui.employeeRate / 100, wageBase: eb } });
        }
        for (const [i, sc] of (s.sui.surcharges ?? []).entries()) {
          rules.push({ id: `${s.code}.SUI_ER_SURCHARGE${i}.${y}`, jurisdiction: s.code, kind: 'SUI_ER_SURCHARGE', name: `${s.name} ${sc.name}`, payer: 'employer', wageBasis: 'SUI', ...ePeriod, status: sideStatus, sources: [src.id, INTERNAL], appliesTo: 'work', calc: { kind: 'percent', rate: sc.rate / 100, wageBase: sc.wageBase ?? base } });
        }
      }
    }
    // Program ids come from the kind and the starting year, not the row's position, so adding a row never renames another rule.
    const used = new Set<string>();
    const idFor = (kind: string, year: number) => {
      let id = `${s.code}.${kind}.${year}`;
      for (let n = 2; used.has(id); n++) id = `${s.code}.${kind}.${year}.${n}`;
      used.add(id);
      return id;
    };
    for (const pr of s.programs ?? []) {
      const sources = pr.sources?.length ? [src.id, ...pr.sources] : [src.id, INTERNAL];
      const common = { jurisdiction: s.code, kind: pr.kind, name: pr.name, payer: pr.payer, wageBasis: pr.wageBasis ?? ('GROSS' as WageBasis), sources, calc: pr.calc, appliesTo: 'work' as const, optional: pr.optional };
      const from = Number(pr.from.slice(0, 4));
      if (pr.annual && !pr.to && from < lastYear) {
        // Reset by the agency every year: one rule per year, and years past the last checked one are projections.
        const checked = pr.verifiedThrough ?? from;
        for (let y = from; y <= lastYear; y++) {
          const carried = y > checked;
          rules.push({ ...common, id: idFor(pr.kind, y), effectiveFrom: y === from ? pr.from : `${y}-01-01`, effectiveTo: `${y}-12-31`, status: carried ? 'projected' : pr.status, notes: carried ? `Carried forward from ${checked}: the ${y} rate was not found when this was checked. ${pr.notes ?? ''}`.trim() : pr.notes });
        }
      } else {
        rules.push({ ...common, id: idFor(pr.kind, from), effectiveFrom: pr.from, effectiveTo: pr.to, status: pr.status, notes: pr.notes });
      }
    }
  }
  return rules;
}
