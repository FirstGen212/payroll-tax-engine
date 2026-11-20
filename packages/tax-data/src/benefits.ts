/**
 * Earning types, deduction types, benefit limits and public retirement systems.
 * Taxability defaults follow IRS Pub 15 / 15-B. State overrides capture the
 * well-known exceptions (PA taxes retirement deferrals, NJ taxes 403(b)/457/414(h),
 * CA and NJ tax HSA contributions, NY adds back 414(h) pick-ups, etc.).
 */
import type { BenefitLimit, DeductionType, EarningType, RetirementSystem, Taxability } from './types.js';

const ALL: Taxability = { FIT: true, FICA: true, MEDICARE: true, FUTA: true, SIT: true, SUI: true, SDI: true, LOCAL: true };
const NONE: Taxability = { FIT: false, FICA: false, MEDICARE: false, FUTA: false, SIT: false, SUI: false, SDI: false, LOCAL: false };

const e = (code: string, name: string, category: EarningType['category'], opts: Partial<EarningType> = {}): EarningType => ({
  code, name, category, cash: true, supplemental: false, taxability: ALL, sources: ['irs-p15', 'irs-p15b'], ...opts,
});

export const EARNING_TYPES: EarningType[] = [
  e('REG', 'Regular', 'regular'),
  e('SALARY', 'Salary', 'regular'),
  e('OT', 'Overtime (1.5x)', 'overtime', { notes: 'Fully taxable for withholding. The FLSA premium portion is reportable as qualified overtime (P.L. 119-21, W-2 box 12 code TT) for the employee deduction.', w2: '12-TT (premium portion)' }),
  e('DT', 'Double time', 'overtime'),
  e('OT_PREMIUM_QUALIFIED', 'Qualified overtime premium (memo)', 'overtime', { cash: false, taxability: NONE, notes: 'Memo-only line for W-2 reporting of the half-time premium; does not add to gross.' }),
  e('SHIFT', 'Shift differential', 'regular'),
  e('ONCALL', 'On-call pay', 'regular'),
  e('HOL', 'Holiday', 'paid_time_off'),
  e('VAC', 'Vacation', 'paid_time_off'),
  e('SICK', 'Sick', 'paid_time_off'),
  e('PTO', 'Paid time off', 'paid_time_off'),
  e('BEREAV', 'Bereavement', 'paid_time_off'),
  e('JURY', 'Jury duty', 'paid_time_off'),
  e('PTO_PAYOUT', 'PTO payout', 'supplemental', { supplemental: true }),
  e('BONUS', 'Bonus', 'supplemental', { supplemental: true }),
  e('BONUS_SIGNON', 'Sign-on bonus', 'supplemental', { supplemental: true }),
  e('COMMISSION', 'Commission', 'supplemental', { supplemental: true }),
  e('AWARD_CASH', 'Cash award', 'supplemental', { supplemental: true }),
  e('RETRO', 'Retroactive pay', 'retro', { supplemental: true }),
  e('BACKPAY', 'Back pay', 'supplemental', { supplemental: true }),
  e('SEVERANCE', 'Severance', 'severance', { supplemental: true, notes: 'Subject to FICA (United States v. Quality Stores, 2014).' }),
  e('TIPS_CASH', 'Tips reported (cash)', 'tips', { cash: false, notes: 'Employee-reported cash tips: taxable, not paid in the check. Qualified tips reportable for the P.L. 119-21 deduction.', w2: '1,5,7 / 12-TP' }),
  e('TIPS_CHARGED', 'Tips charged (paid through payroll)', 'tips', { w2: '1,5,7 / 12-TP' }),
  e('SERVICE_CHARGE', 'Service charge (mandatory, treated as wages)', 'regular'),
  e('GTL_IMPUTED', 'Group-term life over $50,000 (imputed)', 'imputed', { cash: false, taxability: { ...ALL, FIT: false, FUTA: false, SUI: false }, stateOverrides: { PA: { SIT: false, LOCAL: false }, NJ: { SIT: true } }, w2: '12-C', notes: 'FICA required; FIT withholding optional. Value from IRS Table I uniform premiums.' }),
  e('DP_IMPUTED', 'Domestic partner benefits (imputed)', 'imputed', { cash: false }),
  e('AUTO_PERSONAL', 'Personal use of company vehicle', 'imputed', { cash: false, notes: 'May elect not to withhold FIT if employee notified (Pub 15-B).' }),
  e('GIFT_CASH_EQ', 'Gift card / cash-equivalent gift', 'fringe'),
  e('MOVING_TAXABLE', 'Moving expense reimbursement (taxable)', 'fringe', { supplemental: true }),
  e('EDU_EXCESS', 'Educational assistance over $5,250', 'fringe', { cash: false, supplemental: true }),
  e('DEPCARE_EXCESS', 'Dependent care assistance over limit', 'fringe', { cash: false, w2: '10' }),
  e('ADOPTION_ASSIST', 'Adoption assistance', 'fringe', { taxability: { ...ALL, FIT: false, SIT: false }, w2: '12-T', notes: 'Excludable from income tax up to the annual limit; subject to FICA and FUTA.' }),
  e('REIMB_NONTAX', 'Expense reimbursement (accountable plan)', 'reimbursement', { taxability: NONE }),
  e('REIMB_TAXABLE', 'Expense reimbursement (non-accountable)', 'reimbursement', { supplemental: true }),
  e('PERDIEM_EXCESS', 'Per diem over federal rate', 'reimbursement', { supplemental: true }),
  e('THIRD_PARTY_SICK', 'Third-party sick pay', 'third_party_sick', { cash: false, notes: 'FICA applies for first 6 months after last month worked; FIT on request (W-4S).' }),
  e('CLERGY_HOUSING', 'Clergy housing allowance', 'other', { taxability: NONE, notes: 'Excluded from FIT; ministers pay SECA, not FICA.' }),
  e('CLERGY_WAGES', 'Clergy wages (no FICA)', 'regular', { taxability: { ...ALL, FICA: false, MEDICARE: false, FUTA: false, SUI: false } }),
  e('MILITARY_DIFF', 'Military differential pay', 'other', { taxability: { ...ALL, FICA: false, MEDICARE: false, FUTA: false, SUI: false } }),
  e('SUB_PAY', 'Supplemental unemployment benefits (qualified)', 'supplemental', { supplemental: true, taxability: { ...ALL, FICA: false, MEDICARE: false, FUTA: false } }),
  e('NSO_SPREAD', 'Nonqualified stock option exercise', 'supplemental', { cash: false, supplemental: true, w2: '12-V' }),
  e('RSU_VEST', 'RSU vesting', 'supplemental', { cash: false, supplemental: true }),
  e('HOUSING_TAXABLE', 'Taxable housing / lodging', 'fringe', { cash: false }),
  e('FRINGE_OTHER', 'Other taxable fringe', 'fringe', { cash: false }),
  e('STIPEND', 'Stipend', 'regular'),
  e('PIECE', 'Piece rate', 'regular'),
  e('NONTAX_OTHER', 'Non-taxable payment', 'other', { taxability: NONE }),
];

const d = (code: string, name: string, category: DeductionType['category'], reducesWages: Taxability, order: number, opts: Partial<DeductionType> = {}): DeductionType => ({
  code, name, category, reducesWages, order, sources: ['irs-p15', 'irs-p15b'], ...opts,
});

/** Pre-tax retirement deferral: reduces income tax wages only. */
const RET: Taxability = { FIT: true, SIT: true };
/** Section 125 cafeteria: reduces nearly everything. */
const S125: Taxability = { FIT: true, FICA: true, MEDICARE: true, FUTA: true, SIT: true, SUI: true, SDI: true, LOCAL: true };
const POST: Taxability = {};

export const DEDUCTION_TYPES: DeductionType[] = [
  // Section 125 cafeteria plan first (reduces FICA, so it must run before retirement % calcs per most vendors)
  d('MED_125', 'Medical (Section 125)', 'section125_health', S125, 10, { stateOverrides: { PA: { LOCAL: false } }, w2: '12-DD (with employer share)' }),
  d('DEN_125', 'Dental (Section 125)', 'section125_health', S125, 11, { stateOverrides: { PA: { LOCAL: false } } }),
  d('VIS_125', 'Vision (Section 125)', 'section125_health', S125, 12, { stateOverrides: { PA: { LOCAL: false } } }),
  d('HOSP_IND_125', 'Hospital indemnity (pre-tax)', 'section125_health', S125, 13, { notes: 'Fixed-indemnity benefits paid without regard to expenses may be taxable when received if premiums were pre-tax.' }),
  d('ACC_125', 'Accident (pre-tax)', 'section125_health', S125, 14),
  d('CI_125', 'Critical illness (pre-tax)', 'section125_health', S125, 15),
  d('OTHER_125', 'Other pre-tax (Section 125)', 'section125_health', S125, 17, { stateOverrides: { PA: { LOCAL: false } } }),
  d('PROPOSED_125', 'Proposed pre-tax benefit (Section 125, proposal tool)', 'section125_health', S125, 18, { stateOverrides: { PA: { LOCAL: false } }, notes: 'The new pre-tax deduction modeled by the proposal tool. Treated like a Section 125 health premium: exempt from FIT, FICA, FUTA, and most state/SUI wages; PA local EIT still applies.' }),
  d('GTL_PRETAX_EE', 'Employee-paid group term life (≤$50k, pre-tax)', 'section125_health', S125, 16),
  d('HSA_125', 'HSA (through cafeteria plan)', 'hsa', S125, 20, { limitKey: 'hsa', catchUpLimitKey: 'hsa_catchup', stateOverrides: { CA: { SIT: false, SDI: false }, NJ: { SIT: false }, PA: { LOCAL: false } }, w2: '12-W' }),
  d('FSA_HEALTH', 'Health FSA', 'fsa', S125, 21, { limitKey: 'fsa_health' }),
  d('FSA_LTD', 'Limited-purpose FSA', 'fsa', S125, 22, { limitKey: 'fsa_health' }),
  d('DCAP', 'Dependent care FSA', 'dependent_care', { FIT: true, FICA: true, MEDICARE: true, FUTA: true, SIT: true, SUI: true, SDI: true, LOCAL: true }, 23, { limitKey: 'dcap', stateOverrides: { PA: { SIT: false, LOCAL: false } }, w2: '10' }),
  d('TRANSIT', 'Commuter transit (132(f))', 'commuter', { FIT: true, FICA: true, MEDICARE: true, FUTA: true, SIT: true, SUI: true, SDI: true, LOCAL: true }, 24, { limitKey: 'transit' }),
  d('PARKING', 'Qualified parking (132(f))', 'commuter', { FIT: true, FICA: true, MEDICARE: true, FUTA: true, SIT: true, SUI: true, SDI: true, LOCAL: true }, 25, { limitKey: 'parking' }),
  // Retirement deferrals
  d('401K', '401(k) pre-tax', 'retirement_pretax', RET, 30, { limitKey: '402g', catchUpLimitKey: '402g_catchup', stateOverrides: { PA: { SIT: false } }, w2: '12-D' }),
  d('401K_ROTH', '401(k) Roth', 'retirement_roth', POST, 31, { limitKey: '402g', catchUpLimitKey: '402g_catchup', w2: '12-AA' }),
  d('403B', '403(b) pre-tax', 'retirement_pretax', RET, 32, { limitKey: '402g', catchUpLimitKey: '402g_catchup', stateOverrides: { PA: { SIT: false }, NJ: { SIT: false } }, w2: '12-E' }),
  d('403B_ROTH', '403(b) Roth', 'retirement_roth', POST, 33, { limitKey: '402g', w2: '12-BB' }),
  d('457B', '457(b) governmental pre-tax', 'retirement_pretax', RET, 34, { limitKey: '457b', catchUpLimitKey: '402g_catchup', stateOverrides: { PA: { SIT: false }, NJ: { SIT: false } }, w2: '12-G' }),
  d('457B_ROTH', '457(b) Roth', 'retirement_roth', POST, 35, { limitKey: '457b', w2: '12-EE' }),
  d('SIMPLE_IRA', 'SIMPLE IRA (408(p))', 'retirement_pretax', RET, 36, { limitKey: 'simple', stateOverrides: { PA: { SIT: false } }, w2: '12-S' }),
  d('SARSEP', 'SARSEP (408(k)(6))', 'retirement_pretax', RET, 37, { limitKey: '402g', stateOverrides: { PA: { SIT: false } }, w2: '12-F' }),
  d('401A_PICKUP', '414(h)(2) employer pick-up (public plan)', 'retirement_pickup', RET, 38, { stateOverrides: { PA: { SIT: false }, NJ: { SIT: false }, NY: { SIT: false } }, notes: 'Excluded from FIT; included in FICA/Medicare wages when covered. Used for Texas TRS and most public plans.', w2: '14' }),
  d('PUBLIC_RET_POSTTAX', 'Public retirement (after-tax, non pick-up)', 'retirement_roth', POST, 39),
  d('401K_LOAN', '401(k) loan repayment', 'retirement_loan', POST, 60),
  // Post-tax insurance and voluntary
  d('LIFE_VOL', 'Voluntary life (after-tax)', 'insurance_posttax', POST, 70),
  d('ADD_VOL', 'AD&D (after-tax)', 'insurance_posttax', POST, 71),
  d('STD_POST', 'Short-term disability (after-tax)', 'insurance_posttax', POST, 72, { notes: 'After-tax premiums make benefits non-taxable.' }),
  d('LTD_POST', 'Long-term disability (after-tax)', 'insurance_posttax', POST, 73),
  d('ACC_POST', 'Accident (after-tax)', 'insurance_posttax', POST, 74),
  d('CI_POST', 'Critical illness (after-tax)', 'insurance_posttax', POST, 75),
  d('LEGAL', 'Legal plan', 'other_posttax', POST, 76),
  d('PET', 'Pet insurance', 'other_posttax', POST, 77),
  d('UNION', 'Union dues', 'union', POST, 78),
  d('CHARITY', 'Charitable contribution', 'charity', POST, 79),
  d('UNIFORM', 'Uniform', 'other_posttax', POST, 80),
  d('ADVANCE_REPAY', 'Payroll advance repayment', 'other_posttax', POST, 81),
  d('OTHER_POST', 'Other after-tax', 'other_posttax', POST, 82),
  // Garnishments (priority order per federal/state law; engine applies CCPA limits)
  d('GARN_CHILD_SUPPORT', 'Child support', 'garnishment', POST, 90, { sources: ['dol-ccpa'] }),
  d('GARN_FED_LEVY', 'Federal tax levy (IRS Form 668-W)', 'garnishment', POST, 91, { sources: ['irs-p1494'] }),
  d('GARN_BANKRUPTCY', 'Chapter 13 bankruptcy order', 'garnishment', POST, 92),
  d('GARN_STATE_LEVY', 'State tax levy', 'garnishment', POST, 93),
  d('GARN_STUDENT_LOAN', 'Student loan AWG (15%)', 'garnishment', POST, 94, { sources: ['ed-awg'] }),
  d('GARN_CREDITOR', 'Creditor garnishment', 'garnishment', POST, 95, { sources: ['dol-ccpa'] }),
  // Employer contributions (do not reduce net pay; reported)
  d('ER_401K_MATCH', 'Employer 401(k) match', 'employer_contribution', POST, 100, { employerPaid: true }),
  d('ER_HSA', 'Employer HSA contribution', 'employer_contribution', POST, 101, { employerPaid: true, w2: '12-W' }),
  d('ER_HEALTH', 'Employer health premium', 'employer_contribution', POST, 102, { employerPaid: true, w2: '12-DD' }),
  d('ER_PENSION', 'Employer pension / public plan contribution', 'employer_contribution', POST, 103, { employerPaid: true }),
];

const L = (key: string, name: string, year: number, amount: number, status: BenefitLimit['status'], sources: string[], notes?: string): BenefitLimit => ({ key, name, year, amount, status, sources, notes });

export const BENEFIT_LIMITS: BenefitLimit[] = [
  L('402g', '401(k)/403(b)/457(b) elective deferral', 2025, 23500, 'published', ['irs-401k-limits']),
  L('402g', '401(k)/403(b)/457(b) elective deferral', 2026, 24500, 'published', ['irs-401k-limits']),
  L('402g', '401(k)/403(b)/457(b) elective deferral', 2027, 25500, 'published', ['irs-401k-limits'], 'Notice 2026-66.'),
  L('457b', 'Governmental 457(b) deferral', 2026, 24500, 'published', ['irs-401k-limits']),
  L('457b', 'Governmental 457(b) deferral', 2027, 25500, 'published', ['irs-401k-limits']),
  L('402g_catchup', 'Age 50+ catch-up', 2026, 8000, 'published', ['irs-401k-limits']),
  L('402g_catchup', 'Age 50+ catch-up', 2027, 8500, 'published', ['irs-401k-limits']),
  L('402g_catchup_60_63', 'Age 60-63 super catch-up', 2026, 11250, 'published', ['irs-401k-limits']),
  L('402g_catchup_60_63', 'Age 60-63 super catch-up', 2027, 11750, 'published', ['irs-401k-limits']),
  L('roth_catchup_wage_threshold', 'Mandatory Roth catch-up prior-year FICA wage threshold', 2027, 155000, 'published', ['irs-401k-limits']),
  L('415c', '415(c) annual additions', 2027, 75000, 'published', ['irs-401k-limits']),
  L('simple', 'SIMPLE IRA deferral', 2026, 17000, 'unverified', ['irs-401k-limits']),
  L('simple', 'SIMPLE IRA deferral', 2027, 17500, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('simple_higher', 'SIMPLE IRA deferral (employers with 25 or fewer employees)', 2027, 19100, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('simple_catchup', 'SIMPLE age 50+ catch-up', 2027, 4000, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('simple_catchup_higher', 'SIMPLE age 50+ catch-up (higher-limit plans)', 2027, 3850, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('simple_catchup_60_63', 'SIMPLE age 60-63 catch-up', 2027, 5250, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('ira', 'IRA contribution', 2027, 7500, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('ira_catchup', 'IRA age 50+ catch-up', 2027, 1100, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('415b', '415(b) defined benefit annual limit', 2027, 300000, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('comp_401a17', 'Annual compensation limit, 401(a)(17)', 2027, 375000, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('key_employee', 'Key employee officer compensation', 2027, 245000, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('hce', 'Highly compensated employee threshold', 2027, 170000, 'published', ['irs-n-2026-66'], 'Notice 2026-66.'),
  L('hdhp_min_deductible', 'High-deductible plan minimum deductible, self-only', 2027, 1750, 'published', ['irs-rp-2026-24'], 'Rev. Proc. 2026-24.'),
  L('hdhp_min_deductible_family', 'High-deductible plan minimum deductible, family', 2027, 3500, 'published', ['irs-rp-2026-24'], 'Rev. Proc. 2026-24.'),
  L('hdhp_oop_max', 'High-deductible plan out-of-pocket maximum, self-only', 2027, 8700, 'published', ['irs-rp-2026-24'], 'Rev. Proc. 2026-24.'),
  L('hdhp_oop_max_family', 'High-deductible plan out-of-pocket maximum, family', 2027, 17400, 'published', ['irs-rp-2026-24'], 'Rev. Proc. 2026-24.'),
  L('hsa', 'HSA self-only', 2026, 4400, 'published', ['irs-hsa-rp']),
  L('hsa_family', 'HSA family', 2026, 8750, 'published', ['irs-hsa-rp']),
  L('hsa', 'HSA self-only', 2027, 4500, 'published', ['irs-hsa-rp'], 'Rev. Proc. 2026-24.'),
  L('hsa_family', 'HSA family', 2027, 9000, 'published', ['irs-hsa-rp'], 'Rev. Proc. 2026-24.'),
  L('hsa_catchup', 'HSA age 55+ catch-up (statutory)', 2027, 1000, 'published', ['irs-hsa-rp']),
  L('fsa_health', 'Health FSA salary reduction', 2026, 3400, 'published', ['irs-rp-2025-32']),
  L('fsa_health', 'Health FSA salary reduction', 2027, 3500, 'published', ['irs-ir-2026-133']),
  L('dcap', 'Dependent care assistance (household)', 2026, 7500, 'published', ['pl-119-21'], 'Raised from $5,000 by P.L. 119-21 for 2026+.'),
  L('dcap', 'Dependent care assistance (household)', 2027, 7500, 'published', ['pl-119-21']),
  L('transit', 'Qualified transportation (transit) monthly', 2026, 340, 'published', ['irs-rp-2025-32']),
  L('transit', 'Qualified transportation (transit) monthly', 2027, 350, 'published', ['irs-ir-2026-133']),
  L('parking', 'Qualified parking monthly', 2026, 340, 'published', ['irs-rp-2025-32']),
  L('parking', 'Qualified parking monthly', 2027, 350, 'published', ['irs-ir-2026-133']),
  L('adoption', 'Adoption assistance exclusion', 2027, 18250, 'published', ['irs-ir-2026-133']),
  L('edu_127', 'Educational assistance (127)', 2026, 5250, 'published', ['irs-p15b']),
  L('edu_127', 'Educational assistance (127)', 2027, 5250, 'projected', ['pl-119-21'], 'Indexed for inflation after 2026 under P.L. 119-21; confirm 2027 amount.'),
  L('gtl_exclusion', 'Group-term life exclusion', 2027, 50000, 'published', ['irs-p15b']),
  L('qualified_tips_deduction', 'Qualified tips deduction cap (employee return)', 2027, 25000, 'published', ['irs-p15t-2027-draft', 'pl-119-21']),
  L('qualified_ot_deduction', 'Qualified overtime deduction cap (employee return, single)', 2027, 12500, 'published', ['irs-p15t-2027-draft', 'pl-119-21']),
];

export const RETIREMENT_SYSTEMS: RetirementSystem[] = [
  { code: 'TX_TRS', name: 'Teacher Retirement System of Texas', state: 'TX', memberRate: 0.0825, employerRate: 0.0825, pickup414h: true, socialSecurityTypicallyCovered: 'varies', effectiveFrom: '2023-09-01', status: 'unverified', sources: ['research-memory-2026'], notes: 'Member 8.25% of creditable compensation (SB 12, 2019 schedule). Most Texas school districts do not participate in Social Security: Medicare-only for hires after 3/31/1986. Non-OASDI districts also pay TRS-Care and TRS-ActiveCare premiums separately.' },
  { code: 'TX_ERS', name: 'Employees Retirement System of Texas', state: 'TX', memberRate: 0.095, pickup414h: true, socialSecurityTypicallyCovered: true, effectiveFrom: '2021-09-01', status: 'unverified', sources: ['research-memory-2026'] },
  { code: 'TX_TMRS', name: 'Texas Municipal Retirement System', state: 'TX', memberRate: 0.07, pickup414h: true, socialSecurityTypicallyCovered: 'varies', effectiveFrom: '2020-01-01', status: 'unverified', sources: ['research-memory-2026'], notes: 'City elects 5%, 6% or 7% member rate.' },
  { code: 'TX_TCDRS', name: 'Texas County & District Retirement System', state: 'TX', memberRate: 0.07, pickup414h: true, socialSecurityTypicallyCovered: 'varies', effectiveFrom: '2020-01-01', status: 'unverified', sources: ['research-memory-2026'], notes: 'Employer elects 4%-7% member rate.' },
  { code: 'CA_CALSTRS', name: 'CalSTRS (2% at 60)', state: 'CA', memberRate: 0.1025, pickup414h: true, socialSecurityTypicallyCovered: false, effectiveFrom: '2020-07-01', status: 'unverified', sources: ['research-memory-2026'], notes: '2% at 62 members: 10.205% (rate reset annually).' },
  { code: 'CA_CALPERS_PEPRA', name: 'CalPERS (PEPRA miscellaneous)', state: 'CA', memberRate: 0.0775, pickup414h: true, socialSecurityTypicallyCovered: 'varies', effectiveFrom: '2025-07-01', status: 'unverified', sources: ['research-memory-2026'], notes: 'Rate varies by employer contract.' },
  { code: 'NY_NYSTRS_T6', name: 'NYSTRS Tier 6', state: 'NY', memberRate: 0.035, pickup414h: true, socialSecurityTypicallyCovered: true, effectiveFrom: '2022-04-01', status: 'unverified', sources: ['research-memory-2026'], notes: '3%-6% based on salary bracket. NY adds 414(h) back to state wages.' },
  { code: 'NY_NYSLRS_T6', name: 'NYSLRS Tier 6', state: 'NY', memberRate: 0.035, pickup414h: true, socialSecurityTypicallyCovered: true, effectiveFrom: '2022-04-01', status: 'unverified', sources: ['research-memory-2026'] },
  { code: 'FL_FRS', name: 'Florida Retirement System', state: 'FL', memberRate: 0.03, pickup414h: true, socialSecurityTypicallyCovered: true, effectiveFrom: '2011-07-01', status: 'unverified', sources: ['research-memory-2026'] },
  { code: 'IL_TRS', name: 'Teachers Retirement System of Illinois', state: 'IL', memberRate: 0.09, pickup414h: true, socialSecurityTypicallyCovered: false, effectiveFrom: '2020-07-01', status: 'unverified', sources: ['research-memory-2026'] },
  { code: 'OH_STRS', name: 'State Teachers Retirement System of Ohio', state: 'OH', memberRate: 0.14, pickup414h: true, socialSecurityTypicallyCovered: false, effectiveFrom: '2017-07-01', status: 'unverified', sources: ['research-memory-2026'] },
  { code: 'OH_OPERS', name: 'Ohio Public Employees Retirement System', state: 'OH', memberRate: 0.1, pickup414h: true, socialSecurityTypicallyCovered: false, effectiveFrom: '2015-01-01', status: 'unverified', sources: ['research-memory-2026'] },
  { code: 'GA_TRS', name: 'Teachers Retirement System of Georgia', state: 'GA', memberRate: 0.06, pickup414h: true, socialSecurityTypicallyCovered: 'varies', effectiveFrom: '2015-07-01', status: 'unverified', sources: ['research-memory-2026'] },
  { code: 'PA_PSERS', name: 'PA Public School Employees Retirement System', state: 'PA', memberRate: 0.075, pickup414h: true, socialSecurityTypicallyCovered: true, effectiveFrom: '2019-07-01', status: 'unverified', sources: ['research-memory-2026'], notes: 'Class T-E 7.5%, T-F 10.3%; PA taxes pick-ups for PIT.' },
];

export function limitFor(key: string, year: number): BenefitLimit | undefined {
  const rows = BENEFIT_LIMITS.filter((l) => l.key === key && l.year <= year).sort((a, b) => b.year - a.year);
  return rows[0];
}
