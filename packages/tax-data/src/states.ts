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
}

export interface StateProfile {
  code: string;
  name: string;
  fips: string;
  type: 'state' | 'district' | 'territory';
  flags: JurisdictionFlag[];
  agency: { name: string; url: string; withholdingGuide?: string };
  /** Income tax withholding by year. Missing years are projected forward from the latest. */
  sit: Partial<Record<number, { calc: CalcSpec; status: VerificationStatus; notes?: string }>>;
  sui?: SuiProfile;
  programs?: ProgramRule[];
  notes?: string;
}

const SF = (formula: StateFormula): CalcSpec => ({ kind: 'state_formula', formula });
const NONE: CalcSpec = { kind: 'none', reason: 'No state income tax on wages' };
const U: VerificationStatus = 'unverified';

export const STATES: StateProfile[] = [
  {
    code: 'AL', name: 'Alabama', fips: '01', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Alabama Department of Revenue', url: 'https://www.revenue.alabama.gov/', withholdingGuide: 'https://www.revenue.alabama.gov/withholding-tax/' },
    sit: { 2026: { status: U, calc: { kind: 'custom', handler: 'AL', params: { brackets: { single: br([0, 2], [500, 4], [3000, 5]), mfj: br([0, 2], [1000, 4], [6000, 5]) }, personalExemption: { single: 1500, mfs: 1500, hoh: 3000, mfj: 3000 }, dependentTiers: [[20000, 1000], [100000, 500], [Infinity, 300]], stdDed: { single: [2500, 3000], mfj: [5000, 8500], hoh: [2500, 5200], mfs: [2500, 4250] }, stdDedPhase: { start: 23000, step: 500 }, federalTaxDeduction: true, supplementalRate: 0.05 } }, notes: 'Std deduction phases down by income; federal income tax withheld is deductible.' } },
    sui: { wageBase: { 2025: 8000, 2026: 8000 }, newEmployerRate: 2.7, rateRange: [0.2, 6.8] },
  },
  {
    code: 'AK', name: 'Alaska', fips: '02', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'Alaska Department of Labor', url: 'https://labor.alaska.gov/estax/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 51700, 2026: 54200 }, newEmployerRate: 1.0, rateRange: [1.0, 5.4], employeeRate: 0.5, employeeWageBase: { 2025: 51700, 2026: 54200 } },
  },
  {
    code: 'AZ', name: 'Arizona', fips: '04', type: 'state', flags: ['has_sui'],
    agency: { name: 'Arizona Department of Revenue', url: 'https://azdor.gov/', withholdingGuide: 'https://azdor.gov/forms/withholding-forms/arizona-form-a-4' },
    sit: { 2026: { status: U, calc: { kind: 'elected_percent', allowed: [0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035], default: 0.02 }, notes: 'Employee elects a % of gross on Form A-4; 2.0% if no A-4. 0% election requires expected zero liability.' } },
    sui: { wageBase: { 2025: 8000, 2026: 8000 }, newEmployerRate: 2.0, rateRange: [0.07, 18.78] },
  },
  {
    code: 'AR', name: 'Arkansas', fips: '05', type: 'state', flags: ['has_sui'],
    agency: { name: 'Arkansas DFA', url: 'https://www.dfa.arkansas.gov/', withholdingGuide: 'https://www.dfa.arkansas.gov/income-tax/withholding-tax-branch/' },
    sit: { 2026: { status: U, calc: SF({ form: 'AR4EC', brackets: { all: br([0, 0], [5600, 2], [11200, 3], [16000, 3.4], [26400, 3.9]) }, standardDeduction: { all: 2410 }, allowanceCredit: 29, supplementalRate: 0.039 }) } },
    sui: { wageBase: { 2025: 7000, 2026: 7000 }, newEmployerRate: 3.1, rateRange: [0.1, 5.0] },
  },
  {
    code: 'CA', name: 'California', fips: '06', type: 'state', flags: ['has_sui', 'has_sdi'],
    agency: { name: 'California EDD', url: 'https://edd.ca.gov/', withholdingGuide: 'https://edd.ca.gov/en/Payroll_Taxes/Rates_and_Withholding/' },
    sit: { 2026: { status: U, calc: { kind: 'custom', handler: 'CA', params: {
      // DE 44 Method B structure. Values are 2025-level and must be refreshed from the 2026/2027 DE 44.
      lowIncomeExemption: { single: 18252, mfj_low: 18252, mfj_high: 36504, hoh: 36504 },
      standardDeduction: { single: 5540, mfj_low: 5540, mfj_high: 11080, hoh: 11080 },
      estimatedDeductionPerAllowance: 1000,
      exemptionCreditPerAllowance: 154.0,
      brackets: {
        single: br([0, 1.1], [11079, 2.2], [26264, 4.4], [41452, 6.6], [57542, 8.8], [72724, 10.23], [371479, 11.33], [445771, 12.43], [742953, 13.53], [1000000, 14.63]),
        mfj: br([0, 1.1], [22158, 2.2], [52528, 4.4], [82904, 6.6], [115084, 8.8], [145448, 10.23], [742958, 11.33], [891542, 12.43], [1000000, 13.53], [1485906, 14.63]),
        hoh: br([0, 1.1], [22173, 2.2], [52530, 4.4], [67716, 6.6], [83805, 8.8], [98990, 10.23], [505208, 11.33], [606251, 12.43], [1000000, 13.53], [1010417, 14.63]),
      },
      supplementalRate: 0.066, bonusStockRate: 0.1023,
    } }, notes: 'DE 44 tax rate table for withholding includes the 10% gross-up used by EDD (1.1% = 1% x 1.1). Refresh all tables from the 2026 and 2027 DE 44.' } },
    sui: { wageBase: { 2025: 7000, 2026: 7000 }, newEmployerRate: 3.4, rateRange: [1.5, 6.2], surcharges: [{ name: 'Employment Training Tax (ETT)', rate: 0.1, wageBase: 7000 }] },
    programs: [
      { kind: 'SDI_EE', name: 'CA State Disability Insurance (incl. PFL)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.013 }, from: '2026-01-01', status: U, notes: 'No wage ceiling since 2024 (SB 951). 2026 rate 1.3% per EDD; confirm 2027 rate (announced each fall).' },
      { kind: 'SDI_EE', name: 'CA State Disability Insurance (incl. PFL)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.012 }, from: '2025-01-01', to: '2025-12-31', status: U },
    ],
  },
  {
    code: 'CO', name: 'Colorado', fips: '08', type: 'state', flags: ['has_sui', 'has_pfml', 'has_local_income_tax'],
    agency: { name: 'Colorado Department of Revenue', url: 'https://tax.colorado.gov/', withholdingGuide: 'https://tax.colorado.gov/withholding-tax-guide' },
    sit: { 2026: { status: U, calc: SF({ form: 'DR 0004', brackets: { all: flat(4.4) }, standardDeduction: { single: 15000, mfs: 15000, mfj: 30000, hoh: 22500 }, supplementalRate: 0.044 }), notes: 'Withholding = 4.4% x (annual wages - DR 0004 annual allowance). Allowance defaults to federal-status table when no DR 0004; confirm amounts in DR 1098.' } },
    sui: { wageBase: { 2025: 23800, 2026: 27200 }, newEmployerRate: 1.7, rateRange: [0.75, 10.39] },
    programs: [
      { kind: 'PFML_EE', name: 'CO FAMLI (employee share)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0044, wageBase: 'SS' }, from: '2026-01-01', status: U, notes: 'Total premium 0.88% for 2026 split 50/50; wage cap = SS wage base. Employers with <10 employees owe only employee share.' },
      { kind: 'PFML_ER', name: 'CO FAMLI (employer share)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0044, wageBase: 'SS' }, from: '2026-01-01', status: U },
    ],
  },
  {
    code: 'CT', name: 'Connecticut', fips: '09', type: 'state', flags: ['has_sui', 'has_pfml', 'convenience_of_employer'],
    agency: { name: 'Connecticut DRS', url: 'https://portal.ct.gov/drs', withholdingGuide: 'https://portal.ct.gov/drs/publications/informational-publications' },
    sit: { 2026: { status: U, calc: SF({ form: 'CT-W4', brackets: { single: br([0, 2], [10000, 4.5], [50000, 5.5], [100000, 6], [200000, 6.5], [250000, 6.9], [500000, 6.99]), mfj: br([0, 2], [20000, 4.5], [100000, 5.5], [200000, 6], [400000, 6.5], [500000, 6.9], [1000000, 6.99]), hoh: br([0, 2], [16000, 4.5], [80000, 5.5], [160000, 6], [320000, 6.5], [400000, 6.9], [800000, 6.99]) }, personalExemption: { single: 15000, mfs: 12000, mfj: 24000, hoh: 19000 } }), notes: 'Simplified: CT TPG-211 withholding codes A-F, exemption phase-outs, 2% phase-out add-back and recapture not yet modeled. Treat as estimate.' } },
    sui: { wageBase: { 2025: 26100, 2026: 26100 }, newEmployerRate: 2.8, rateRange: [1.1, 8.9] },
    programs: [{ kind: 'PFML_EE', name: 'CT Paid Leave', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.005, wageBase: 'SS' }, from: '2026-01-01', status: U, notes: 'Wage cap tracks the SS wage base.' }],
  },
  {
    code: 'DE', name: 'Delaware', fips: '10', type: 'state', flags: ['has_sui', 'has_pfml', 'has_local_income_tax', 'convenience_of_employer'],
    agency: { name: 'Delaware Division of Revenue', url: 'https://revenue.delaware.gov/', withholdingGuide: 'https://revenue.delaware.gov/employers-guide-withholding-regulations-employers-duties/' },
    sit: { 2026: { status: U, calc: SF({ form: 'W-4 (DE)', usesFederalW4: false, brackets: { all: br([0, 0], [2000, 2.2], [5000, 3.9], [10000, 4.8], [20000, 5.2], [25000, 5.55], [60000, 6.6]) }, standardDeduction: { single: 3250, mfs: 3250, hoh: 3250, mfj: 6500 }, allowanceCredit: 110 }) } },
    sui: { wageBase: { 2025: 12500, 2026: 12500 }, newEmployerRate: 1.0, rateRange: [0.3, 5.4] },
    programs: [
      { kind: 'PFML_EE', name: 'Delaware Paid Leave (employee share, up to 50%)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.004, wageBase: 'SS' }, from: '2025-01-01', status: U, notes: 'Total 0.8% (0.5% family+medical with parental 0.3%); employer may deduct up to 50%.' },
      { kind: 'PFML_ER', name: 'Delaware Paid Leave (employer share)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.004, wageBase: 'SS' }, from: '2025-01-01', status: U },
    ],
  },
  {
    code: 'DC', name: 'District of Columbia', fips: '11', type: 'district', flags: ['has_sui', 'has_pfml'],
    agency: { name: 'DC Office of Tax and Revenue', url: 'https://otr.cfo.dc.gov/' },
    sit: { 2026: { status: U, calc: SF({ form: 'D-4', brackets: { all: br([0, 4], [10000, 6], [40000, 6.5], [60000, 8.5], [250000, 9.25], [500000, 9.75], [1000000, 10.75]) }, standardDeduction: { single: 16100, mfs: 16100, mfj: 32200, hoh: 24150 } }), notes: 'DC standard deduction follows the federal amount.' }, 2027: { status: 'projected', calc: SF({ form: 'D-4', brackets: { all: br([0, 4], [10000, 6], [40000, 6.5], [60000, 8.5], [250000, 9.25], [500000, 9.75], [1000000, 10.75]) }, standardDeduction: { single: 16600, mfs: 16600, mfj: 33200, hoh: 24925 } }), notes: 'Standard deduction tied to federal 2027 amounts; rates carried forward.' } },
    sui: { wageBase: { 2025: 9000, 2026: 9000 }, newEmployerRate: 2.7, rateRange: [1.9, 7.4], surcharges: [{ name: 'Administrative funding assessment', rate: 0.2, wageBase: 9000 }] },
    programs: [{ kind: 'PFML_ER', name: 'DC Paid Family Leave (employer)', payer: 'employer', wageBasis: 'GROSS', calc: { kind: 'percent', rate: 0.0075 }, from: '2025-01-01', status: U }],
  },
  {
    code: 'FL', name: 'Florida', fips: '12', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'Florida Department of Revenue', url: 'https://floridarevenue.com/taxes/taxesfees/Pages/reemployment.aspx' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 7000, 2026: 7000 }, newEmployerRate: 2.7, rateRange: [0.1, 5.4] },
  },
  {
    code: 'GA', name: 'Georgia', fips: '13', type: 'state', flags: ['has_sui'],
    agency: { name: 'Georgia Department of Revenue', url: 'https://dor.georgia.gov/', withholdingGuide: 'https://dor.georgia.gov/employers-tax-guide' },
    sit: {
      2026: { status: U, calc: SF({ form: 'G-4', brackets: { all: flat(5.09) }, standardDeduction: { single: 12000, mfs: 12000, hoh: 12000, mfj: 24000 }, dependentDeduction: 4000, allowanceDeduction: 3000 }), notes: 'Flat rate schedule steps down 0.10/yr toward 4.99% (HB 111). Confirm 2026 rate in Employer Tax Guide.' },
      2027: { status: 'projected', calc: SF({ form: 'G-4', brackets: { all: flat(4.99) }, standardDeduction: { single: 12000, mfs: 12000, hoh: 12000, mfj: 24000 }, dependentDeduction: 4000, allowanceDeduction: 3000 }), notes: 'Projected per statutory schedule.' },
    },
    sui: { wageBase: { 2025: 9500, 2026: 9500 }, newEmployerRate: 2.64, rateRange: [0.04, 8.1] },
  },
  {
    code: 'HI', name: 'Hawaii', fips: '15', type: 'state', flags: ['has_sui', 'has_sdi'],
    agency: { name: 'Hawaii Department of Taxation', url: 'https://tax.hawaii.gov/', withholdingGuide: 'https://files.hawaii.gov/tax/legal/brochures/booklet_a.pdf' },
    sit: { 2026: { status: U, calc: SF({ form: 'HW-4', brackets: { single: br([0, 1.4], [9600, 3.2], [14400, 5.5], [19200, 6.4], [24000, 6.8], [36000, 7.2], [48000, 7.6], [125000, 7.9], [175000, 8.25], [225000, 9], [275000, 10], [325000, 11]), mfj: dbl(br([0, 1.4], [9600, 3.2], [14400, 5.5], [19200, 6.4], [24000, 6.8], [36000, 7.2], [48000, 7.6], [125000, 7.9], [175000, 8.25], [225000, 9], [275000, 10], [325000, 11])) }, allowanceDeduction: 1144, standardDeduction: { single: 4400, mfj: 8800, mfs: 4400, hoh: 6424 } }), notes: 'Act 46 (2024) bracket widening phases in through 2031; Booklet A tables should replace these.' } },
    sui: { wageBase: { 2025: 62000, 2026: 64500 }, newEmployerRate: 4.0, rateRange: [0.0, 5.8] },
    programs: [{ kind: 'SDI_EE', name: 'HI Temporary Disability Insurance (employee max)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.005, weeklyMax: 7.17 }, from: '2026-01-01', status: U, notes: 'Employee share up to 0.5% of weekly wages, capped at 0.5% of max weekly wage base. Employer funds the rest via private plan.' }],
  },
  {
    code: 'ID', name: 'Idaho', fips: '16', type: 'state', flags: ['has_sui'],
    agency: { name: 'Idaho State Tax Commission', url: 'https://tax.idaho.gov/', withholdingGuide: 'https://tax.idaho.gov/taxes/income-tax/withholding/' },
    sit: { 2026: { status: U, calc: SF({ form: 'ID W-4', brackets: { single: br([0, 0], [4673, 5.3]), mfj: br([0, 0], [9346, 5.3]) }, standardDeduction: { single: 15000, mfs: 15000, hoh: 15000, mfj: 30000 }, allowanceDeduction: 3300, supplementalRate: 0.053 }) } },
    sui: { wageBase: { 2025: 55300, 2026: 57800 }, newEmployerRate: 0.979, rateRange: [0.204, 5.4] },
  },
  {
    code: 'IL', name: 'Illinois', fips: '17', type: 'state', flags: ['has_sui'],
    agency: { name: 'Illinois Department of Revenue', url: 'https://tax.illinois.gov/', withholdingGuide: 'https://tax.illinois.gov/research/publications/bulletins.html' },
    sit: { 2026: { status: U, calc: SF({ form: 'IL-W-4', brackets: { all: flat(4.95) }, allowanceDeduction: 2925, dependentDeduction: 1000, supplementalRate: 0.0495 }), notes: 'Line 1 allowances x $2,925 (2026, indexed) + Line 2 allowances x $1,000.' } },
    sui: { wageBase: { 2025: 13916, 2026: 14250 }, newEmployerRate: 3.65, rateRange: [0.85, 8.65] },
  },
  {
    code: 'IN', name: 'Indiana', fips: '18', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Indiana Department of Revenue', url: 'https://www.in.gov/dor/', withholdingGuide: 'https://www.in.gov/dor/business-tax/withholding-tax/' },
    sit: {
      2025: { status: U, calc: SF({ form: 'WH-4', brackets: { all: flat(3.0) }, allowanceDeduction: 1000, dependentDeduction: 1500 }) },
      2026: { status: U, calc: SF({ form: 'WH-4', brackets: { all: flat(2.95) }, allowanceDeduction: 1000, dependentDeduction: 1500 }), notes: 'Statutory schedule (HEA 1001-2023): 2.95% for 2026.' },
      2027: { status: 'projected', calc: SF({ form: 'WH-4', brackets: { all: flat(2.9) }, allowanceDeduction: 1000, dependentDeduction: 1500 }), notes: 'Statutory schedule: 2.9% for 2027 and later.' },
    },
    sui: { wageBase: { 2025: 9500, 2026: 9500 }, newEmployerRate: 2.5, rateRange: [0.5, 7.4] },
  },
  {
    code: 'IA', name: 'Iowa', fips: '19', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Iowa Department of Revenue', url: 'https://revenue.iowa.gov/', withholdingGuide: 'https://revenue.iowa.gov/taxes/tax-guidance/withholding-tax' },
    sit: { 2026: { status: U, calc: SF({ form: 'IA W-4', brackets: { all: flat(3.8) }, standardDeduction: { single: 15000, mfj: 30000, hoh: 22500, mfs: 15000 }, allowanceCredit: 40, supplementalRate: 0.038 }), notes: 'Flat 3.8% from 2025. Iowa school district surtax is applied on the annual return, not withheld (flagged only).' } },
    sui: { wageBase: { 2025: 39500, 2026: 40700 }, newEmployerRate: 1.0, rateRange: [0, 7.0] },
  },
  {
    code: 'KS', name: 'Kansas', fips: '20', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Kansas Department of Revenue', url: 'https://www.ksrevenue.gov/', withholdingGuide: 'https://www.ksrevenue.gov/forms-btwh.html' },
    sit: { 2026: { status: U, calc: SF({ form: 'K-4', brackets: { single: br([0, 5.2], [23000, 5.58]), mfj: br([0, 5.2], [46000, 5.58]) }, standardDeduction: { single: 3605, mfs: 3605, hoh: 3605, mfj: 8240 }, allowanceDeduction: 2320, supplementalRate: 0.05 }) } },
    sui: { wageBase: { 2025: 14000, 2026: 14000 }, newEmployerRate: 2.7, rateRange: [0.1, 7.6] },
  },
  {
    code: 'KY', name: 'Kentucky', fips: '21', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Kentucky Department of Revenue', url: 'https://revenue.ky.gov/', withholdingGuide: 'https://revenue.ky.gov/Business/Withholding-Tax/' },
    sit: {
      2025: { status: U, calc: SF({ form: 'K-4', brackets: { all: flat(4.0) }, standardDeduction: { all: 3270 }, supplementalRate: 0.04 }) },
      2026: { status: U, calc: SF({ form: 'K-4', brackets: { all: flat(3.5) }, standardDeduction: { all: 3360 }, supplementalRate: 0.035 }), notes: 'HB 1 (2025) reduced rate to 3.5% for 2026.' },
    },
    sui: { wageBase: { 2025: 11700, 2026: 12000 }, newEmployerRate: 2.7, rateRange: [0.3, 9.0] },
  },
  {
    code: 'LA', name: 'Louisiana', fips: '22', type: 'state', flags: ['has_sui'],
    agency: { name: 'Louisiana Department of Revenue', url: 'https://revenue.louisiana.gov/', withholdingGuide: 'https://revenue.louisiana.gov/WithholdingTax' },
    sit: { 2026: { status: U, calc: SF({ form: 'L-4', brackets: { all: flat(3.0) }, standardDeduction: { single: 12500, mfs: 12500, hoh: 25000, mfj: 25000 } }), notes: 'Flat 3% from 2025 (Act 11 of 2024 special session).' } },
    sui: { wageBase: { 2025: 7700, 2026: 7700 }, newEmployerRate: 1.21, rateRange: [0.09, 6.2] },
  },
  {
    code: 'ME', name: 'Maine', fips: '23', type: 'state', flags: ['has_sui', 'has_pfml'],
    agency: { name: 'Maine Revenue Services', url: 'https://www.maine.gov/revenue/', withholdingGuide: 'https://www.maine.gov/revenue/tax-return-forms/payroll-withholding' },
    sit: { 2026: { status: U, calc: SF({ form: 'W-4ME', brackets: { single: br([0, 5.8], [26800, 6.75], [63450, 7.15]), mfj: br([0, 5.8], [53600, 6.75], [126900, 7.15]) }, standardDeduction: { single: 15000, mfs: 15000, mfj: 30000, hoh: 22500 }, allowanceDeduction: 5150 }) } },
    sui: { wageBase: { 2025: 12000, 2026: 12000 }, newEmployerRate: 2.11, rateRange: [0.28, 5.81] },
    programs: [
      { kind: 'PFML_EE', name: 'Maine Paid Family and Medical Leave (employee up to 50%)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.005, wageBase: 'SS' }, from: '2025-01-01', status: U, notes: 'Total 1%; employers with <15 employees pay only the employee share.' },
      { kind: 'PFML_ER', name: 'Maine PFML (employer share)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.005, wageBase: 'SS' }, from: '2025-01-01', status: U },
    ],
  },
  {
    code: 'MD', name: 'Maryland', fips: '24', type: 'state', flags: ['has_sui', 'has_local_income_tax', 'has_pfml'],
    agency: { name: 'Comptroller of Maryland', url: 'https://www.marylandtaxes.gov/', withholdingGuide: 'https://www.marylandtaxes.gov/business/income/withholding/index.php' },
    sit: { 2026: { status: U, calc: SF({ form: 'MW507', brackets: { single: br([0, 2], [1000, 3], [2000, 4], [3000, 4.75], [100000, 5], [125000, 5.25], [150000, 5.5], [250000, 5.75], [500000, 6.25], [1000000, 6.5]), mfj: br([0, 2], [1000, 3], [2000, 4], [3000, 4.75], [150000, 5], [175000, 5.25], [225000, 5.5], [300000, 5.75], [600000, 6.25], [1200000, 6.5]) }, standardDeduction: { single: 3350, mfs: 3350, mfj: 6700, hoh: 6700 }, allowanceDeduction: 3200 }), notes: 'State portion only; county tax is a separate local rule (see locals). 2025 HB 352 added 6.25%/6.5% brackets and a flat standard deduction.' } },
    sui: { wageBase: { 2025: 8500, 2026: 8500 }, newEmployerRate: 2.6, rateRange: [0.3, 7.5] },
    programs: [
      { kind: 'PFML_EE', name: 'MD FAMLI (employee 50%)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0045, wageBase: 'SS' }, from: '2027-01-01', status: 'projected', notes: 'Contributions delayed to Jan 1 2027 (SB 485/2024 and 2025 changes). Rate shown is a projection; confirm with MD Labor.' },
      { kind: 'PFML_ER', name: 'MD FAMLI (employer 50%)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0045, wageBase: 'SS' }, from: '2027-01-01', status: 'projected' },
    ],
  },
  {
    code: 'MA', name: 'Massachusetts', fips: '25', type: 'state', flags: ['has_sui', 'has_pfml', 'convenience_of_employer'],
    agency: { name: 'Massachusetts DOR', url: 'https://www.mass.gov/orgs/massachusetts-department-of-revenue', withholdingGuide: 'https://www.mass.gov/doc/circular-m-massachusetts-income-tax-withholding-tables' },
    sit: { 2026: { status: U, calc: { kind: 'custom', handler: 'MA', params: { rate: 0.05, surtaxRate: 0.04, surtaxThreshold: 1107750, firstExemption: 4400, additionalExemption: 1000, ficaDeductionMax: 2000, hohExtra: 2400, supplementalRate: 0.05 } }, notes: 'Circular M formula: 5% x (wages - exemptions - FICA/retirement up to $2,000); 4% surtax over indexed threshold.' } },
    sui: { wageBase: { 2025: 15000, 2026: 15000 }, newEmployerRate: 2.42, rateRange: [0.94, 14.37], surcharges: [{ name: 'Workforce Training Fund', rate: 0.056, wageBase: 15000 }, { name: 'EMAC (employer medical assistance)', rate: 0.34, wageBase: 15000 }] },
    programs: [
      { kind: 'PFML_EE', name: 'MA PFML (employee share)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0046, wageBase: 'SS' }, from: '2025-01-01', status: U, notes: '0.88% total; employee up to 100% family + 40% medical for 25+ employees.' },
      { kind: 'PFML_ER', name: 'MA PFML (employer share, 25+ employees)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0042, wageBase: 'SS' }, from: '2025-01-01', status: U },
    ],
  },
  {
    code: 'MI', name: 'Michigan', fips: '26', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Michigan Department of Treasury', url: 'https://www.michigan.gov/taxes', withholdingGuide: 'https://www.michigan.gov/taxes/business-taxes/withholding' },
    sit: { 2026: { status: U, calc: SF({ form: 'MI-W4', brackets: { all: flat(4.25) }, allowanceDeduction: 5800, supplementalRate: 0.0425 }), notes: 'Personal exemption amount is indexed; confirm 2026/2027 (Form 446).' } },
    sui: { wageBase: { 2025: 9500, 2026: 9500 }, newEmployerRate: 2.7, rateRange: [0.06, 10.3] },
  },
  {
    code: 'MN', name: 'Minnesota', fips: '27', type: 'state', flags: ['has_sui', 'has_pfml'],
    agency: { name: 'Minnesota Department of Revenue', url: 'https://www.revenue.state.mn.us/', withholdingGuide: 'https://www.revenue.state.mn.us/minnesota-income-tax-withholding-instruction-booklet-and-tax-tables' },
    sit: { 2026: { status: U, calc: SF({ form: 'W-4MN', brackets: { single: br([0, 5.35], [32570, 6.8], [106990, 7.85], [198630, 9.85]), mfj: br([0, 5.35], [47620, 6.8], [189180, 7.85], [330410, 9.85]) }, standardDeduction: { single: 15000, mfs: 15000, mfj: 30000, hoh: 22500 }, allowanceDeduction: 5200, supplementalRate: 0.0625 }) } },
    sui: { wageBase: { 2025: 43000, 2026: 44000 }, newEmployerRate: 1.0, rateRange: [0.1, 9.0] },
    programs: [
      { kind: 'PFML_EE', name: 'MN Paid Leave (employee up to 50%)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0044, wageBase: 'SS' }, from: '2026-01-01', status: U, notes: 'Premiums begin Jan 1 2026 at 0.88% total.' },
      { kind: 'PFML_ER', name: 'MN Paid Leave (employer)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.0044, wageBase: 'SS' }, from: '2026-01-01', status: U },
      { kind: 'WORKFORCE_ER', name: 'MN Workforce Development Fee', payer: 'employer', wageBasis: 'SUI', calc: { kind: 'percent', rate: 0.001, wageBase: 44000 }, from: '2026-01-01', status: U },
    ],
  },
  {
    code: 'MS', name: 'Mississippi', fips: '28', type: 'state', flags: ['has_sui'],
    agency: { name: 'Mississippi DOR', url: 'https://www.dor.ms.gov/', withholdingGuide: 'https://www.dor.ms.gov/business/withholding-tax' },
    sit: {
      2026: { status: U, calc: SF({ form: '89-350', brackets: { all: br([0, 0], [10000, 4.0]) }, standardDeduction: { single: 2300, mfs: 2300, mfj: 4600, hoh: 3400 }, personalExemption: { single: 6000, mfs: 6000, mfj: 12000, hoh: 9500 }, dependentDeduction: 1500 }), notes: 'HB 1 (2025): 4.0% for 2026, 3.75% for 2027, stepping to 3.0% by 2030.' },
      2027: { status: 'projected', calc: SF({ form: '89-350', brackets: { all: br([0, 0], [10000, 3.75]) }, standardDeduction: { single: 2300, mfs: 2300, mfj: 4600, hoh: 3400 }, personalExemption: { single: 6000, mfs: 6000, mfj: 12000, hoh: 9500 }, dependentDeduction: 1500 }) },
    },
    sui: { wageBase: { 2025: 14000, 2026: 14000 }, newEmployerRate: 1.0, rateRange: [0, 5.4] },
  },
  {
    code: 'MO', name: 'Missouri', fips: '29', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Missouri DOR', url: 'https://dor.mo.gov/', withholdingGuide: 'https://dor.mo.gov/taxation/business/tax-types/withholding/' },
    sit: { 2026: { status: U, calc: SF({ form: 'MO W-4', usesFederalW4: false, brackets: { all: br([0, 0], [1313, 2], [2626, 2.5], [3939, 3], [5252, 3.5], [6565, 4], [7878, 4.5], [9191, 4.7]) }, standardDeduction: { single: 16100, mfs: 16100, mfj: 32200, hoh: 24150 } }), notes: 'MO standard deduction follows federal. Top rate 4.7% may step down under SB 3 triggers.' } },
    sui: { wageBase: { 2025: 9500, 2026: 9500 }, newEmployerRate: 2.376, rateRange: [0, 6.0] },
  },
  {
    code: 'MT', name: 'Montana', fips: '30', type: 'state', flags: ['has_sui'],
    agency: { name: 'Montana DOR', url: 'https://mtrevenue.gov/', withholdingGuide: 'https://mtrevenue.gov/taxes/wage-withholding/' },
    sit: {
      2026: { status: U, calc: SF({ form: 'MW-4', brackets: { single: br([0, 4.7], [21100, 5.65]), mfj: br([0, 4.7], [42200, 5.65]) }, standardDeduction: { single: 15000, mfs: 15000, mfj: 30000, hoh: 22500 } }), notes: 'HB 337 (2025): top rate 5.65% for 2026, 5.4% for 2027.' },
      2027: { status: 'projected', calc: SF({ form: 'MW-4', brackets: { single: br([0, 4.7], [21100, 5.4]), mfj: br([0, 4.7], [42200, 5.4]) }, standardDeduction: { single: 15000, mfs: 15000, mfj: 30000, hoh: 22500 } }) },
    },
    sui: { wageBase: { 2025: 45100, 2026: 47300 }, newEmployerRate: 1.0, rateRange: [0, 6.12] },
  },
  {
    code: 'NE', name: 'Nebraska', fips: '31', type: 'state', flags: ['has_sui'],
    agency: { name: 'Nebraska DOR', url: 'https://revenue.nebraska.gov/', withholdingGuide: 'https://revenue.nebraska.gov/businesses/circular-en-income-tax-withholding-wages-pensions-and-annuities-and-gambling' },
    sit: {
      2026: { status: U, calc: SF({ form: 'W-4N', brackets: { single: br([0, 0], [3350, 2.46], [7380, 3.51], [27470, 5.01], [42220, 4.55]), mfj: br([0, 0], [7950, 2.46], [15910, 3.51], [56110, 5.01], [85620, 4.55]) }, allowanceDeduction: 2200 }), notes: 'LB 754 (2023): top rate 4.55% for 2026, 3.99% for 2027. Circular EN schedules should replace these thresholds.' },
      2027: { status: 'projected', calc: SF({ form: 'W-4N', brackets: { single: br([0, 0], [3350, 2.46], [7380, 3.51], [27470, 3.99]), mfj: br([0, 0], [7950, 2.46], [15910, 3.51], [56110, 3.99]) }, allowanceDeduction: 2200 }) },
    },
    sui: { wageBase: { 2025: 9000, 2026: 9000 }, newEmployerRate: 1.25, rateRange: [0, 5.4] },
  },
  {
    code: 'NV', name: 'Nevada', fips: '32', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'Nevada DETR / Department of Taxation', url: 'https://tax.nv.gov/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 41800, 2026: 43700 }, newEmployerRate: 2.95, rateRange: [0.25, 5.4], surcharges: [{ name: 'Career Enhancement Program', rate: 0.05 }] },
    programs: [{ kind: 'STATE_PAYROLL_ER', name: 'NV Modified Business Tax (general business, wages over $50,000/qtr)', payer: 'employer', wageBasis: 'GROSS', calc: { kind: 'percent', rate: 0.01378, threshold: 50000 }, from: '2025-07-01', status: U, notes: 'Quarterly threshold, not annual: engine treats as estimate. Financial institutions and mining use 1.554%. Rate reverts to 1.378% after the 1.17% temporary rate; confirm.' }],
  },
  {
    code: 'NH', name: 'New Hampshire', fips: '33', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'NH Employment Security', url: 'https://www.nhes.nh.gov/' },
    sit: { 2026: { status: 'published', calc: NONE, notes: 'Interest and dividends tax repealed for 2025+; no wage tax.' } },
    sui: { wageBase: { 2025: 14000, 2026: 14000 }, newEmployerRate: 1.7, rateRange: [0.1, 8.5] },
  },
  {
    code: 'NJ', name: 'New Jersey', fips: '34', type: 'state', flags: ['has_sui', 'has_sdi', 'has_pfml', 'has_local_income_tax'],
    agency: { name: 'NJ Division of Taxation', url: 'https://www.nj.gov/treasury/taxation/', withholdingGuide: 'https://www.nj.gov/treasury/taxation/pdf/current/njwt.pdf' },
    sit: { 2026: { status: U, calc: { kind: 'custom', handler: 'NJ', params: {
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
    } }, notes: 'NJ-WT rate tables A-E (employee may elect a table on NJ-W4). Thresholds approximate; replace from NJ-WT.' } },
    sui: { wageBase: { 2025: 43300, 2026: 44800 }, newEmployerRate: 2.8, rateRange: [0.4, 5.4], employeeRate: 0.425, employeeWageBase: { 2025: 43300, 2026: 44800 } },
    programs: [
      { kind: 'SDI_EE', name: 'NJ Temporary Disability Insurance (employee)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.0023, wageBase: 165400 }, from: '2025-01-01', status: U, notes: 'Wage base equals FLI base since 2020 (A3975).' },
      { kind: 'FLI_EE', name: 'NJ Family Leave Insurance (employee)', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.0033, wageBase: 165400 }, from: '2025-01-01', status: U },
      { kind: 'SDI_ER', name: 'NJ TDI (employer)', payer: 'employer', wageBasis: 'SUI', calc: { kind: 'percent', rate: 0.005, wageBase: 44800, employerRateOverridable: true, rateRange: [0.1, 1.1] }, from: '2026-01-01', status: U },
    ],
  },
  {
    code: 'NM', name: 'New Mexico', fips: '35', type: 'state', flags: ['has_sui'],
    agency: { name: 'NM Taxation and Revenue', url: 'https://www.tax.newmexico.gov/', withholdingGuide: 'https://www.tax.newmexico.gov/businesses/wage-withholding-tax/' },
    sit: { 2026: { status: U, calc: SF({ form: 'W-4 (federal)', usesFederalW4: true, brackets: { single: br([0, 1.5], [5500, 3.2], [16500, 4.3], [33500, 4.7], [66500, 4.9], [210000, 5.9]), mfj: br([0, 1.5], [8000, 3.2], [25000, 4.3], [50000, 4.7], [100000, 4.9], [315000, 5.9]), hoh: br([0, 1.5], [8000, 3.2], [25000, 4.3], [50000, 4.7], [100000, 4.9], [315000, 5.9]) }, standardDeduction: { single: 16100, mfs: 16100, mfj: 32200, hoh: 24150 } }), notes: 'HB 252 (2024) restructured brackets from 2025. NM uses federal W-4 and federal standard deduction.' } },
    sui: { wageBase: { 2025: 33200, 2026: 34800 }, newEmployerRate: 1.0, rateRange: [0.33, 6.4] },
    programs: [
      { kind: 'WC_EE', name: 'NM Workers Compensation Fee (employee)', payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'fixed', amount: 2.0, per: 'quarter' }, from: '2025-01-01', status: U },
      { kind: 'WC_ER', name: 'NM Workers Compensation Fee (employer)', payer: 'employer', wageBasis: 'GROSS', calc: { kind: 'fixed', amount: 2.3, per: 'quarter' }, from: '2025-01-01', status: U },
    ],
  },
  {
    code: 'NY', name: 'New York', fips: '36', type: 'state', flags: ['has_sui', 'has_sdi', 'has_pfml', 'has_local_income_tax', 'convenience_of_employer'],
    agency: { name: 'NYS Department of Taxation and Finance', url: 'https://www.tax.ny.gov/', withholdingGuide: 'https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf' },
    sit: { 2026: { status: U, calc: SF({ form: 'IT-2104', brackets: { single: br([0, 4], [8500, 4.5], [11700, 5.25], [13900, 5.5], [80650, 6], [215400, 6.85], [1077550, 9.65], [5000000, 10.3], [25000000, 10.9]), mfj: br([0, 4], [17150, 4.5], [23600, 5.25], [27900, 5.5], [161550, 6], [323200, 6.85], [2155350, 9.65], [5000000, 10.3], [25000000, 10.9]) }, standardDeduction: { single: 7400, mfs: 7400, hoh: 7400, mfj: 7950 }, allowanceDeduction: 1000, supplementalRate: 0.1023 }), notes: 'NYS-50-T-NYS uses exact tables with recapture; this bracket form is an approximation. 2026 budget lowered the bottom five rates; refresh from 2026/2027 NYS-50-T-NYS.' } },
    sui: { wageBase: { 2025: 12800, 2026: 13000 }, newEmployerRate: 4.1, rateRange: [2.1, 9.9], surcharges: [{ name: 'Re-employment Service Fund', rate: 0.075 }] },
    programs: [
      { kind: 'SDI_EE', name: 'NY Disability Benefits (DBL), employee max $0.60/week', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.005, weeklyMax: 0.6 }, from: '2025-01-01', status: 'published', notes: 'Employer may collect 0.5% of wages up to $0.60 per week.' },
      { kind: 'FLI_EE', name: 'NY Paid Family Leave', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.00432, wageBase: 95349.5, annualMax: 411.91 }, from: '2026-01-01', status: U, notes: 'Rate and cap set annually by DFS (based on NYS average weekly wage).' },
      { kind: 'FLI_EE', name: 'NY Paid Family Leave', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.00388, wageBase: 91373.7, annualMax: 354.53 }, from: '2025-01-01', to: '2025-12-31', status: 'published' },
    ],
  },
  {
    code: 'NC', name: 'North Carolina', fips: '37', type: 'state', flags: ['has_sui'],
    agency: { name: 'NC Department of Revenue', url: 'https://www.ncdor.gov/', withholdingGuide: 'https://www.ncdor.gov/taxes-forms/withholding-tax' },
    sit: { 2026: { status: U, calc: SF({ form: 'NC-4', brackets: { all: flat(3.99) }, standardDeduction: { single: 12750, mfs: 12750, mfj: 25500, hoh: 19125 }, allowanceDeduction: 2500, supplementalRate: 0.0399 }), notes: '3.99% for 2026; 2027+ step-downs depend on revenue triggers (S.L. 2023-134).' } },
    sui: { wageBase: { 2025: 32600, 2026: 33600 }, newEmployerRate: 1.0, rateRange: [0.06, 5.76] },
  },
  {
    code: 'ND', name: 'North Dakota', fips: '38', type: 'state', flags: ['has_sui'],
    agency: { name: 'ND Office of State Tax Commissioner', url: 'https://www.tax.nd.gov/', withholdingGuide: 'https://www.tax.nd.gov/business/income-tax-withholding' },
    sit: { 2026: { status: U, calc: SF({ form: 'W-4 (federal)', usesFederalW4: true, brackets: { single: br([0, 0], [48475, 1.95], [244825, 2.5]), mfj: br([0, 0], [80975, 1.95], [298075, 2.5]), hoh: br([0, 0], [64950, 1.95], [271450, 2.5]) }, standardDeduction: { single: 16100, mfs: 16100, mfj: 32200, hoh: 24150 } }) } },
    sui: { wageBase: { 2025: 45100, 2026: 46800 }, newEmployerRate: 1.08, rateRange: [0.08, 9.68] },
  },
  {
    code: 'OH', name: 'Ohio', fips: '39', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'Ohio Department of Taxation', url: 'https://tax.ohio.gov/', withholdingGuide: 'https://tax.ohio.gov/business/ohio-business-taxes/employer-withholding' },
    sit: { 2026: { status: U, calc: SF({ form: 'IT 4', brackets: { all: br([0, 0], [26050, 2.75]) }, allowanceDeduction: 650, supplementalRate: 0.035 }), notes: 'HB 96 (2025) moved to a flat 2.75% above $26,050 for 2026. Employer withholding tables (Optional Computer Formula) should replace this.' } },
    sui: { wageBase: { 2025: 9000, 2026: 9000 }, newEmployerRate: 2.7, rateRange: [0.4, 10.2] },
  },
  {
    code: 'OK', name: 'Oklahoma', fips: '40', type: 'state', flags: ['has_sui'],
    agency: { name: 'Oklahoma Tax Commission', url: 'https://oklahoma.gov/tax.html', withholdingGuide: 'https://oklahoma.gov/tax/businesses/withholding.html' },
    sit: { 2026: { status: U, calc: SF({ form: 'OK-W-4', brackets: { single: br([0, 0], [3750, 2.5], [4900, 3.5], [7200, 4.5]), mfj: br([0, 0], [7500, 2.5], [9800, 3.5], [14400, 4.5]) }, standardDeduction: { single: 6350, mfs: 6350, mfj: 12700, hoh: 9350 }, allowanceDeduction: 1000 }), notes: 'HB 2764 (2025): consolidated brackets and 4.5% top rate from 2026.' } },
    sui: { wageBase: { 2025: 25000, 2026: 25000 }, newEmployerRate: 1.5, rateRange: [0.3, 9.2] },
  },
  {
    code: 'OR', name: 'Oregon', fips: '41', type: 'state', flags: ['has_sui', 'has_pfml', 'has_local_income_tax'],
    agency: { name: 'Oregon Department of Revenue', url: 'https://www.oregon.gov/dor/', withholdingGuide: 'https://www.oregon.gov/dor/programs/businesses/Pages/Withholding-and-payroll-tax.aspx' },
    sit: { 2026: { status: U, calc: SF({ form: 'OR-W-4', brackets: { single: br([0, 4.75], [4400, 6.75], [11050, 8.75], [125000, 9.9]), mfj: br([0, 4.75], [8800, 6.75], [22100, 8.75], [250000, 9.9]) }, standardDeduction: { single: 2835, mfs: 2835, mfj: 5670, hoh: 4560 }, allowanceCredit: 256, federalTaxDeduction: { cap: { all: 8500 } }, supplementalRate: 0.08 }), notes: 'Federal tax subtraction phases out above $125k/$250k (not yet modeled). Refresh from Oregon Withholding Tax Formulas (150-206-436).' } },
    sui: { wageBase: { 2025: 54300, 2026: 56700 }, newEmployerRate: 2.4, rateRange: [0.9, 5.4] },
    programs: [
      { kind: 'TRANSIT_EE', name: 'Oregon Statewide Transit Tax', payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'percent', rate: 0.001 }, from: '2018-07-01', status: 'published' },
      { kind: 'PFML_EE', name: 'Paid Leave Oregon (employee 60%)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.006, wageBase: 'SS' }, from: '2026-01-01', status: U },
      { kind: 'PFML_ER', name: 'Paid Leave Oregon (employer 40%, 25+ employees)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.004, wageBase: 'SS' }, from: '2026-01-01', status: U, optional: true },
      { kind: 'WC_EE', name: 'Oregon Workers Benefit Fund (employee, per hour)', payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'custom', handler: 'PER_HOUR', params: { rate: 0.011 } }, from: '2026-01-01', status: U, notes: 'Cents-per-hour assessment split between employer and employee.' },
    ],
  },
  {
    code: 'PA', name: 'Pennsylvania', fips: '42', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'PA Department of Revenue', url: 'https://www.revenue.pa.gov/', withholdingGuide: 'https://www.revenue.pa.gov/TaxTypes/EmployerWithholding/' },
    sit: { 2026: { status: 'published', calc: SF({ brackets: { all: flat(3.07) }, supplementalRate: 0.0307 }), notes: 'Flat 3.07% on PA compensation; no exemptions. PA taxes 401(k)/403(b)/457 deferrals.' } },
    sui: { wageBase: { 2025: 10000, 2026: 10000 }, newEmployerRate: 3.822, rateRange: [1.419, 10.374], employeeRate: 0.07 },
  },
  {
    code: 'RI', name: 'Rhode Island', fips: '44', type: 'state', flags: ['has_sui', 'has_sdi'],
    agency: { name: 'RI Division of Taxation', url: 'https://tax.ri.gov/', withholdingGuide: 'https://tax.ri.gov/tax-sections/withholding-tax' },
    sit: { 2026: { status: U, calc: SF({ form: 'RI W-4', brackets: { all: br([0, 3.75], [79900, 4.75], [181650, 5.99]) }, allowanceDeduction: 5100 }) } },
    sui: { wageBase: { 2025: 29800, 2026: 30800 }, newEmployerRate: 1.0, rateRange: [0.9, 9.8], surcharges: [{ name: 'Job Development Fund', rate: 0.21 }] },
    programs: [{ kind: 'SDI_EE', name: 'RI Temporary Disability / Caregiver Insurance', payer: 'employee', wageBasis: 'SDI', calc: { kind: 'percent', rate: 0.012, wageBase: 89200 }, from: '2025-01-01', status: U, notes: 'Rate and wage base reset annually by RI DLT.' }],
  },
  {
    code: 'SC', name: 'South Carolina', fips: '45', type: 'state', flags: ['has_sui'],
    agency: { name: 'SC Department of Revenue', url: 'https://dor.sc.gov/', withholdingGuide: 'https://dor.sc.gov/tax/withholding' },
    sit: { 2026: { status: U, calc: SF({ form: 'SC W-4', brackets: { all: br([0, 0], [3560, 3], [17830, 6.0]) }, standardDeduction: { all: { pct: 0.1, min: 0, max: 6925 } }, allowanceDeduction: 4840 }) } },
    sui: { wageBase: { 2025: 14000, 2026: 14000 }, newEmployerRate: 0.39, rateRange: [0.06, 5.46] },
  },
  {
    code: 'SD', name: 'South Dakota', fips: '46', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'SD Department of Labor', url: 'https://dlr.sd.gov/ra/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 15000, 2026: 15000 }, newEmployerRate: 1.0, rateRange: [0, 9.35] },
  },
  {
    code: 'TN', name: 'Tennessee', fips: '47', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'TN Department of Labor', url: 'https://www.tn.gov/workforce/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 7000, 2026: 7000 }, newEmployerRate: 2.7, rateRange: [0.01, 10.0] },
  },
  {
    code: 'TX', name: 'Texas', fips: '48', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'Texas Workforce Commission', url: 'https://www.twc.texas.gov/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 9000, 2026: 9000 }, newEmployerRate: 2.7, rateRange: [0.25, 6.25] },
  },
  {
    code: 'UT', name: 'Utah', fips: '49', type: 'state', flags: ['has_sui'],
    agency: { name: 'Utah State Tax Commission', url: 'https://tax.utah.gov/', withholdingGuide: 'https://tax.utah.gov/forms/pubs/pub-14.pdf' },
    sit: { 2026: { status: U, calc: { kind: 'custom', handler: 'UT', params: { rate: 0.045, baseAllowance: { single: 918, mfs: 918, hoh: 918, mfj: 1836 }, phaseoutStart: { single: 9065, mfs: 9065, hoh: 9065, mfj: 18130 }, phaseoutRate: 0.013 } }, notes: 'Pub 14: tax = rate x wages - (base allowance - 1.3% x wages over threshold). Rate 4.5% (2025); confirm 2026/2027.' } },
    sui: { wageBase: { 2025: 48900, 2026: 50700 }, newEmployerRate: 1.2, rateRange: [0.3, 7.3] },
  },
  {
    code: 'VT', name: 'Vermont', fips: '50', type: 'state', flags: ['has_sui'],
    agency: { name: 'Vermont Department of Taxes', url: 'https://tax.vermont.gov/', withholdingGuide: 'https://tax.vermont.gov/business/withholding' },
    sit: { 2026: { status: U, calc: SF({ form: 'W-4VT', brackets: { single: br([0, 0], [3500, 3.35], [51400, 6.6], [119500, 7.6], [245500, 8.75]), mfj: br([0, 0], [10200, 3.35], [91350, 6.6], [212650, 7.6], [376900, 8.75]) }, allowanceDeduction: 5300 }) } },
    sui: { wageBase: { 2025: 14800, 2026: 15400 }, newEmployerRate: 1.0, rateRange: [0.4, 5.4] },
  },
  {
    code: 'VA', name: 'Virginia', fips: '51', type: 'state', flags: ['has_sui'],
    agency: { name: 'Virginia Department of Taxation', url: 'https://www.tax.virginia.gov/', withholdingGuide: 'https://www.tax.virginia.gov/withholding-tax' },
    sit: { 2026: { status: U, calc: SF({ form: 'VA-4', brackets: { all: br([0, 2], [3000, 3], [5000, 5], [17000, 5.75]) }, standardDeduction: { all: 8750 }, allowanceDeduction: 930 }), notes: 'Enhanced standard deduction $8,750 through 2026; personal exemption $930.' } },
    sui: { wageBase: { 2025: 8000, 2026: 8000 }, newEmployerRate: 2.5, rateRange: [0.1, 6.2] },
  },
  {
    code: 'WA', name: 'Washington', fips: '53', type: 'state', flags: ['has_sui', 'no_income_tax', 'has_pfml'],
    agency: { name: 'WA Employment Security Department', url: 'https://esd.wa.gov/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 72800, 2026: 78200 }, newEmployerRate: 1.0, rateRange: [0.0, 6.0], surcharges: [{ name: 'Employment Administration Fund', rate: 0.03 }] },
    programs: [
      { kind: 'PFML_EE', name: 'WA Paid Family & Medical Leave (employee)', payer: 'employee', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.008082, wageBase: 'SS' }, from: '2026-01-01', status: U, notes: 'Total 1.13% for 2026; employee 71.52%. Employers <50 employees exempt from employer share.' },
      { kind: 'PFML_ER', name: 'WA PFML (employer, 50+ employees)', payer: 'employer', wageBasis: 'FICA', calc: { kind: 'percent', rate: 0.003218, wageBase: 'SS' }, from: '2026-01-01', status: U, optional: true },
      { kind: 'LTC_EE', name: 'WA Cares Fund (long-term care)', payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'percent', rate: 0.0058 }, from: '2023-07-01', status: 'published', notes: 'No wage cap. Employees with approved exemptions are excluded (toggle per employee).' },
      { kind: 'WC_EE', name: 'WA L&I workers comp (employee share, per hour)', payer: 'employee', wageBasis: 'GROSS', calc: { kind: 'custom', handler: 'PER_HOUR', params: { rate: 0 } }, from: '2026-01-01', status: 'placeholder', notes: 'Rate depends on risk class; set per client.' },
    ],
  },
  {
    code: 'WV', name: 'West Virginia', fips: '54', type: 'state', flags: ['has_sui', 'has_local_income_tax'],
    agency: { name: 'WV State Tax Department', url: 'https://tax.wv.gov/', withholdingGuide: 'https://tax.wv.gov/Business/Withholding/Pages/Withholding.aspx' },
    sit: { 2026: { status: U, calc: SF({ form: 'WV/IT-104', brackets: { all: br([0, 2.22], [10000, 2.96], [25000, 3.33], [40000, 4.44], [60000, 4.82]) }, allowanceDeduction: 2000 }) } },
    sui: { wageBase: { 2025: 9500, 2026: 9500 }, newEmployerRate: 2.7, rateRange: [1.5, 8.5] },
  },
  {
    code: 'WI', name: 'Wisconsin', fips: '55', type: 'state', flags: ['has_sui'],
    agency: { name: 'Wisconsin DOR', url: 'https://www.revenue.wi.gov/', withholdingGuide: 'https://www.revenue.wi.gov/DOR%20Publications/pb166.pdf' },
    sit: { 2026: { status: U, calc: SF({ form: 'WT-4', brackets: { single: br([0, 3.5], [14680, 4.4], [29370, 5.3], [323290, 7.65]), mfj: br([0, 3.5], [19580, 4.4], [39150, 5.3], [431060, 7.65]) }, standardDeduction: { single: 13930, mfs: 9180, mfj: 25640, hoh: 17960 }, allowanceDeduction: 700 }), notes: 'Pub W-166 uses a sliding standard deduction; this uses the maximum. Estimate.' } },
    sui: { wageBase: { 2025: 14000, 2026: 14000 }, newEmployerRate: 3.05, rateRange: [0, 12.0] },
  },
  {
    code: 'WY', name: 'Wyoming', fips: '56', type: 'state', flags: ['has_sui', 'no_income_tax'],
    agency: { name: 'WY Department of Workforce Services', url: 'https://dws.wyo.gov/' },
    sit: { 2026: { status: 'published', calc: NONE } },
    sui: { wageBase: { 2025: 32400, 2026: 33800 }, newEmployerRate: 1.0, rateRange: [0.09, 8.5] },
  },

  // ---------------- Territories ----------------
  {
    code: 'PR', name: 'Puerto Rico', fips: '72', type: 'territory', flags: ['fica_applies', 'futa_applies', 'has_sui', 'has_sdi', 'fit_replaced_by_territory_tax'],
    agency: { name: 'Departamento de Hacienda de Puerto Rico', url: 'https://hacienda.pr.gov/', withholdingGuide: 'https://hacienda.pr.gov/' },
    sit: { 2026: { status: U, calc: { kind: 'custom', handler: 'PR', params: { brackets: br([0, 0], [9000, 7], [25000, 14], [41500, 25], [61500, 33]), personalExemption: { single: 0, mfj: 0, hoh: 0, mfs: 0 }, dependentDeduction: 2500, gradualAdjustment: true } }, notes: 'Code 2011 withholding tables; personal exemption folded into the 0% band. Bonus/supplemental and 2025 reform proposals not modeled.' } },
    sui: { wageBase: { 2025: 7000, 2026: 7000 }, newEmployerRate: 3.4, rateRange: [2.4, 5.4] },
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
    sui: { wageBase: { 2025: 33600, 2026: 35000 }, newEmployerRate: 1.5, rateRange: [0, 6.0], status: 'unverified' },
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
function expandSitYears(p: StateProfile): [number, { calc: CalcSpec; status: VerificationStatus; notes?: string }][] {
  const years = Object.keys(p.sit).map(Number).sort();
  const out: [number, { calc: CalcSpec; status: VerificationStatus; notes?: string }][] = [];
  for (let y = years[0]; y <= lastYear; y++) {
    if (p.sit[y]) out.push([y, p.sit[y]!]);
    else {
      const prev = out[out.length - 1][1];
      const keepPublishedNone = prev.calc.kind === 'none' && prev.status === 'published';
      out.push([y, { calc: prev.calc, status: keepPublishedNone ? 'published' : 'projected', notes: keepPublishedNone ? prev.notes : `Carried forward from ${y - 1}; agency has not published ${y} values in our data yet. ${prev.notes ?? ''}`.trim() }]);
    }
  }
  return out;
}

export function buildStateJurisdictions(): Jurisdiction[] {
  return STATES.map((s) => ({ code: s.code, name: s.name, type: s.type, state: s.code, fips: s.fips, parent: 'US', flags: s.flags, notes: s.notes }));
}

export function buildStateRules(): TaxRule[] {
  const rules: TaxRule[] = [];
  for (const s of STATES) {
    const src = agencySource(`${s.code.toLowerCase()}-agency`, s.agency.name, `${s.agency.name} withholding guidance`, s.agency.withholdingGuide ?? s.agency.url);
    const sources = [src.id, 'research-memory-2026'];
    for (const [y, def] of expandSitYears(s)) {
      rules.push({ id: `${s.code}.SIT.${y}`, jurisdiction: s.code, kind: 'SIT', name: `${s.name} income tax withholding`, payer: 'employee', wageBasis: 'SIT', effectiveFrom: `${y}-01-01`, effectiveTo: `${y}-12-31`, status: def.status, sources, calc: def.calc, appliesTo: 'resident_or_work', notes: def.notes });
    }
    if (s.sui) {
      const years = Object.keys(s.sui.wageBase).map(Number).sort();
      for (let y = years[0]; y <= lastYear; y++) {
        const base = s.sui.wageBase[y] ?? s.sui.wageBase[years[years.length - 1]]!;
        const projected = s.sui.wageBase[y] === undefined;
        const status: VerificationStatus = projected ? 'projected' : s.sui.status ?? U;
        const ePeriod = { effectiveFrom: `${y}-01-01`, effectiveTo: `${y}-12-31` };
        const note = projected ? `Wage base carried forward from ${years[years.length - 1]}; most states announce in Q4.` : undefined;
        rules.push({ id: `${s.code}.SUI_ER.${y}`, jurisdiction: s.code, kind: 'SUI_ER', name: `${s.name} unemployment insurance (employer)`, payer: 'employer', wageBasis: 'SUI', ...ePeriod, status, sources: [src.id, 'dol-sui-comparison'], appliesTo: 'work', calc: { kind: 'percent', rate: s.sui.newEmployerRate / 100, wageBase: base, employerRateOverridable: true, rateRange: s.sui.rateRange ? [s.sui.rateRange[0] / 100, s.sui.rateRange[1] / 100] : undefined }, notes: `Default is the new-employer rate; set each client's assigned rate. ${note ?? ''}`.trim() });
        if (s.sui.employeeRate) {
          const eb = s.sui.employeeWageBase ? (s.sui.employeeWageBase[y] ?? Object.values(s.sui.employeeWageBase).pop()) : undefined;
          rules.push({ id: `${s.code}.SUI_EE.${y}`, jurisdiction: s.code, kind: 'SUI_EE', name: `${s.name} unemployment insurance (employee)`, payer: 'employee', wageBasis: 'SUI', ...ePeriod, status, sources: [src.id], appliesTo: 'work', calc: { kind: 'percent', rate: s.sui.employeeRate / 100, wageBase: eb } });
        }
        for (const [i, sc] of (s.sui.surcharges ?? []).entries()) {
          rules.push({ id: `${s.code}.SUI_ER_SURCHARGE${i}.${y}`, jurisdiction: s.code, kind: 'SUI_ER_SURCHARGE', name: `${s.name} ${sc.name}`, payer: 'employer', wageBasis: 'SUI', ...ePeriod, status, sources: [src.id], appliesTo: 'work', calc: { kind: 'percent', rate: sc.rate / 100, wageBase: sc.wageBase ?? base } });
        }
      }
    }
    for (const [i, pr] of (s.programs ?? []).entries()) {
      rules.push({ id: `${s.code}.${pr.kind}.${i}.${pr.from.slice(0, 4)}`, jurisdiction: s.code, kind: pr.kind, name: pr.name, payer: pr.payer, wageBasis: pr.wageBasis ?? 'GROSS', effectiveFrom: pr.from, effectiveTo: pr.to, status: pr.status, sources: [src.id, 'research-memory-2026'], calc: pr.calc, appliesTo: 'work', optional: pr.optional, notes: pr.notes });
    }
  }
  return rules;
}
