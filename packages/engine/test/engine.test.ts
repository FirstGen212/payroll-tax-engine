import { describe, expect, it } from 'vitest';
import { calculatePay, computeStateCalc, learnVendorProfile, compareScenarios, runSeries } from '../src/index.js';
import type { PayInput, PayResult } from '../src/index.js';
import { loadTaxDatabase, SOURCES, STATES, ruleOn } from '@pte/tax-data';

const employer = { id: 'c1', name: 'Test Client', homeState: 'NY' };
const base = (over: Partial<PayInput> = {}): PayInput => ({
  checkDate: '2027-01-15',
  payFrequency: 'biweekly',
  employer,
  employee: { id: 'e1', federalW4: { version: '2020+', filingStatus: 'single' }, residence: { state: 'TX' }, work: [{ state: 'TX', percent: 1 }] },
  earnings: [{ code: 'REG', amount: 3000 }],
  ...over,
});
const tax = (r: PayResult, k: string) => r.taxes.filter((t) => `${t.jurisdiction}.${t.kind}` === k).reduce((a, t) => a + t.amount, 0);

describe('Federal income tax withholding (Pub 15-T 2027, Worksheet 1A)', () => {
  it('single, 2020+ W-4, biweekly $3,000', () => {
    // 78,000 - 8,600 = 69,400 adjusted; floor 8,000; 61,400 taxable -> 8,049.50 / 26
    expect(tax(calculatePay(base()), 'US.FIT')).toBe(309.6);
  });
  it('MFJ with Step 2 checkbox, monthly $10,000', () => {
    const r = calculatePay(base({ payFrequency: 'monthly', earnings: [{ code: 'SALARY', amount: 10000 }], employee: { ...base().employee, federalW4: { version: '2020+', filingStatus: 'mfj', step2Checked: true } } }));
    expect(tax(r, 'US.FIT')).toBe(1440.79);
  });
  it('2019-or-earlier W-4, married, 3 allowances, weekly $1,500', () => {
    const r = calculatePay(base({ payFrequency: 'weekly', earnings: [{ code: 'REG', amount: 1500 }], employee: { ...base().employee, federalW4: { version: 'pre2020', filingStatus: 'mfj', allowances: 3 } } }));
    expect(tax(r, 'US.FIT')).toBe(93.54);
  });
  it('Step 3 credits and Step 4(c) extra withholding', () => {
    const r = calculatePay(base({ employee: { ...base().employee, federalW4: { version: '2020+', filingStatus: 'single', dependentsAmount: 4600, extraWithholding: 25 } } }));
    expect(tax(r, 'US.FIT')).toBe(157.67); // 309.5962 - 176.9231 + 25
  });
  it('exempt W-4 withholds nothing but FICA still applies', () => {
    const r = calculatePay(base({ employee: { ...base().employee, federalW4: { version: '2020+', filingStatus: 'single', exempt: true } } }));
    expect(tax(r, 'US.FIT')).toBe(0);
    expect(tax(r, 'US.SS_EE')).toBe(186);
  });
  it('supplemental flat 22% when bonus is paid with regular wages', () => {
    const r = calculatePay(base({ earnings: [{ code: 'REG', amount: 3000 }, { code: 'BONUS', amount: 5000 }] }));
    expect(tax(r, 'US.FIT')).toBe(1409.6);
  });
  it('mandatory 37% on supplemental wages over $1M YTD', () => {
    const r = calculatePay(base({ earnings: [{ code: 'BONUS', amount: 100000 }], ytd: { supplementalWages: 950000 } }));
    expect(tax(r, 'US.FIT')).toBe(50000 * 0.22 + 50000 * 0.37);
  });
  it('2026 tables use Rev. Proc. 2025-32 amounts', () => {
    // 2026 single: 78,000 - 16,100 = 61,900 -> 1,240 + 4,560 + 22% x 11,500 = 8,330 / 26 = 320.38
    expect(tax(calculatePay(base({ checkDate: '2026-06-15' })), 'US.FIT')).toBe(320.38);
  });
});

describe('FICA, Additional Medicare, FUTA', () => {
  it('basic FICA employee and employer', () => {
    const r = calculatePay(base());
    expect(tax(r, 'US.SS_EE')).toBe(186);
    expect(tax(r, 'US.SS_ER')).toBe(186);
    expect(tax(r, 'US.MED_EE')).toBe(43.5);
    expect(tax(r, 'US.MED_ER')).toBe(43.5);
  });
  it('Social Security stops at the 2027 wage base ($192,300)', () => {
    const r = calculatePay(base({ earnings: [{ code: 'REG', amount: 5000 }], ytd: { taxableWages: { 'US.SS_EE': 190000, 'US.SS_ER': 190000 } } }));
    expect(tax(r, 'US.SS_EE')).toBe(142.6);
  });
  it('Additional Medicare starts once YTD wages exceed $200,000', () => {
    const r = calculatePay(base({ earnings: [{ code: 'REG', amount: 5000 }], ytd: { taxableWages: { 'US.MED_ADDL_EE': 198000 } } }));
    expect(tax(r, 'US.MED_ADDL_EE')).toBe(27);
  });
  it('FUTA on the first $7,000 with projected CA credit reduction', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'CA' }, work: [{ state: 'CA', percent: 1 }], stateW4: { CA: {} } }, ytd: { taxableWages: { 'US.FUTA': 6000 } } }));
    expect(tax(r, 'US.FUTA')).toBe(24); // 1,000 x (0.6% + 1.8%)
  });
  it('FUTA-exempt employer', () => {
    const r = calculatePay(base({ employer: { ...employer, futaExempt: true } }));
    expect(tax(r, 'US.FUTA')).toBe(0);
  });
});

describe('Pre-tax deductions and taxable wage bases', () => {
  it('Section 125 reduces FIT and FICA; 401(k) reduces FIT only', () => {
    const r = calculatePay(base({ deductions: [{ code: 'MED_125', amount: 200 }, { code: '401K', percent: 0.1 }] }));
    expect(r.taxableWages['US.FIT']).toBe(2500);
    expect(tax(r, 'US.SS_EE')).toBe(173.6); // 2,800 x 6.2%
  });
  it('PA taxes 401(k) deferrals for state income tax', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'PA' }, work: [{ state: 'PA', percent: 1 }], stateW4: { PA: {} } }, deductions: [{ code: '401K', amount: 300 }] }));
    expect(tax(r, 'PA.SIT')).toBe(92.1); // 3,000 x 3.07%
  });
  it('401(k) is capped at the 2027 402(g) limit', () => {
    const r = calculatePay(base({ deductions: [{ code: '401K', amount: 1000 }], ytd: { deductions: { '401K': 25000 } } }));
    expect(r.deductions.find((d) => d.code === '401K')!.amount).toBe(500);
  });
  it('age 60-63 super catch-up raises the cap', () => {
    const r = calculatePay(base({ employee: { ...base().employee, birthDate: '1965-03-01' }, deductions: [{ code: '401K', amount: 1000 }], ytd: { deductions: { '401K': 25000 } } }));
    expect(r.deductions.find((d) => d.code === '401K')!.amount).toBe(1000);
  });
  it('Texas TRS teacher: 8.25% pick-up, no Social Security, Medicare on full pay', () => {
    const r = calculatePay(base({ employee: { ...base().employee, socialSecurityCovered: false }, deductions: [{ code: '401A_PICKUP', retirementSystem: 'TX_TRS' }] }));
    expect(r.deductions[0].amount).toBe(247.5);
    expect(tax(r, 'US.SS_EE')).toBe(0);
    expect(tax(r, 'US.MED_EE')).toBe(43.5);
    expect(r.taxableWages['US.FIT']).toBe(2752.5);
  });
  it('GTL imputed income is FICA-taxable, not FIT, and not paid in cash', () => {
    const r = calculatePay(base({ earnings: [{ code: 'REG', amount: 3000 }, { code: 'GTL_IMPUTED', amount: 20 }] }));
    expect(r.grossPay).toBe(3000);
    expect(tax(r, 'US.SS_EE')).toBe(187.24);
    expect(r.taxableWages['US.FIT']).toBe(3000);
  });
});

describe('Multi-state rules', () => {
  it('reciprocity: PA resident working in NJ pays only PA', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'PA' }, work: [{ state: 'NJ', percent: 1 }], stateW4: { PA: {}, NJ: { reciprocityCertificate: true } } } }));
    expect(tax(r, 'NJ.SIT')).toBe(0);
    expect(tax(r, 'PA.SIT')).toBe(92.1);
    expect(tax(r, 'NJ.SUI_EE')).toBeGreaterThan(0); // NJ unemployment still applies to the work state
  });
  it('no reciprocity: NY resident working in NJ gets resident credit', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'NY' }, work: [{ state: 'NJ', percent: 1 }], stateW4: { NY: {}, NJ: {} } } }));
    const nj = tax(r, 'NJ.SIT');
    expect(nj).toBeGreaterThan(0);
    const nyLine = r.taxes.find((t) => t.jurisdiction === 'NY' && t.kind === 'SIT')!;
    expect(nyLine.explanation.join(' ')).toMatch(/Resident credit/);
  });
  it('wage allocation splits nonresident state tax', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'TX' }, work: [{ state: 'TX', percent: 0.5 }, { state: 'CO', percent: 0.5 }], stateW4: { CO: {} } } }));
    const full = calculatePay(base({ employee: { ...base().employee, residence: { state: 'TX' }, work: [{ state: 'CO', percent: 1 }], stateW4: { CO: {} } } }));
    expect(tax(r, 'CO.SIT')).toBeCloseTo(tax(full, 'CO.SIT') / 2, 1);
  });
  it('convenience of employer sources remote work to the NY office', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'FL' }, work: [{ state: 'FL', percent: 1, remoteForConvenience: true }], stateW4: { NY: {} } } }));
    expect(tax(r, 'NY.SIT')).toBeGreaterThan(0);
  });
  it('Arizona elected percentage', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'AZ' }, work: [{ state: 'AZ', percent: 1 }], stateW4: { AZ: { electedPercent: 0.025 } } } }));
    expect(tax(r, 'AZ.SIT')).toBe(75);
  });
});

describe('State programs', () => {
  it('CA SDI follows the year: 1.3% in 2026, 1.4% in 2027, no wage cap', () => {
    const ca = { ...base().employee, residence: { state: 'CA' }, work: [{ state: 'CA', percent: 1 }], stateW4: { CA: {} } };
    expect(tax(calculatePay(base({ checkDate: '2026-06-15', employee: ca })), 'CA.SDI_EE')).toBe(39);
    expect(tax(calculatePay(base({ employee: ca })), 'CA.SDI_EE')).toBe(42);
  });
  it('client SUI rate overrides the new-employer rate', () => {
    const r = calculatePay(base({ employer: { ...employer, suiRates: { TX: 0.01 } } }));
    expect(tax(r, 'TX.SUI_ER')).toBe(30);
  });
  it('WA Cares and WA PFML', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'WA' }, work: [{ state: 'WA', percent: 1 }] } }));
    expect(tax(r, 'WA.LTC_EE')).toBe(17.4);
    expect(tax(r, 'WA.PFML_EE')).toBeGreaterThan(0);
    expect(tax(r, 'WA.PFML_ER')).toBe(0); // optional (50+ employees) - off by default
  });
  it('toggling a tax off removes it', () => {
    const r = calculatePay(base({ employer: { ...employer, taxToggles: { 'TX.SUI_ER': false } } }));
    expect(tax(r, 'TX.SUI_ER')).toBe(0);
  });
});

describe('Local taxes', () => {
  it('PA Act 32: withhold the higher of resident and work nonresident rate', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'PA', localCodes: ['PA-PSD-880000'] }, work: [{ state: 'PA', percent: 1, localCodes: ['PA-PSD-062801'] }], stateW4: { PA: {} } } }));
    expect(tax(r, 'PA-PSD-880000.LIT_EE')).toBe(30); // 3,000 x 1.0% (Reading nonresident) > 0.5% resident
  });
  it('Pittsburgh LST is prorated per period', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'PA', localCodes: ['PA-PSD-700102'] }, work: [{ state: 'PA', percent: 1, localCodes: ['PA-PSD-700102', 'PA-PSD-700102-LST'] }], stateW4: { PA: {} } } }));
    expect(tax(r, 'PA-PSD-700102.LIT_EE')).toBe(90);
    expect(tax(r, 'PA-PSD-700102-LST.LST_EE')).toBe(2);
  });
  it('Ohio: work city plus resident city with credit', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'OH', localCodes: ['OH-EUCLID'] }, work: [{ state: 'OH', percent: 1, localCodes: ['OH-CLEVELAND'] }], stateW4: { OH: {} } } }));
    expect(tax(r, 'OH-CLEVELAND.LIT_EE')).toBe(75);
    expect(tax(r, 'OH-EUCLID.LIT_EE')).toBe(10.5); // 2.85% - 2.5% credit on 3,000
  });
  it('NYC resident and Yonkers surcharge', () => {
    const nyc = calculatePay(base({ employee: { ...base().employee, residence: { state: 'NY', localCodes: ['NY-NYC'] }, work: [{ state: 'NY', percent: 1 }], stateW4: { NY: {} } } }));
    expect(tax(nyc, 'NY-NYC.LIT_EE')).toBeGreaterThan(0);
    const yk = calculatePay(base({ employee: { ...base().employee, residence: { state: 'NY', localCodes: ['NY-YONKERS'] }, work: [{ state: 'NY', percent: 1 }], stateW4: { NY: {} } } }));
    expect(tax(yk, 'NY-YONKERS.LIT_EE')).toBeCloseTo(tax(yk, 'NY.SIT') * 0.1675, 2);
  });
  it('Indiana: resident county on Jan 1 controls', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'IN', localCodes: ['IN-HAMILTON'] }, work: [{ state: 'IN', percent: 1, localCodes: ['IN-MARION'] }], stateW4: { IN: {} } } }));
    expect(tax(r, 'IN-HAMILTON.LIT_EE')).toBe(33);
    expect(tax(r, 'IN-MARION.LIT_EE')).toBe(0);
  });
  it('Denver OPT employee and employer head tax', () => {
    const r = calculatePay(base({ payFrequency: 'monthly', employee: { ...base().employee, residence: { state: 'CO' }, work: [{ state: 'CO', percent: 1, localCodes: ['CO-DENVER', 'CO-DENVER-ER'] }], stateW4: { CO: {} } } }));
    expect(tax(r, 'CO-DENVER.OPT_EE')).toBe(5.75);
    expect(tax(r, 'CO-DENVER-ER.OPT_ER')).toBe(4);
  });
});

describe('Territories', () => {
  it('Puerto Rico: no FIT, PR income tax, FICA and FUTA apply, SINOT', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'PR' }, work: [{ state: 'PR', percent: 1 }], stateW4: { PR: {} } } }));
    expect(tax(r, 'US.FIT')).toBe(0);
    expect(tax(r, 'PR.SIT')).toBeGreaterThan(0);
    expect(tax(r, 'US.SS_EE')).toBe(186);
    expect(tax(r, 'US.FUTA')).toBe(18);
    expect(tax(r, 'PR.TERR_SDI_EE')).toBe(9);
  });
  it('Guam: mirror code equals federal computation; no FUTA', () => {
    const r = calculatePay(base({ employee: { ...base().employee, residence: { state: 'GU' }, work: [{ state: 'GU', percent: 1 }] } }));
    expect(tax(r, 'US.FIT')).toBe(0);
    expect(tax(r, 'GU.SIT')).toBe(309.6);
    expect(tax(r, 'US.FUTA')).toBe(0);
  });
});

describe('Garnishments', () => {
  it('child support limited to 60% of disposable earnings', () => {
    const r = calculatePay(base({ deductions: [{ code: 'GARN_CHILD_SUPPORT', amount: 5000 }] }));
    const disposable = 3000 - r.employeeTaxes;
    expect(r.deductions.find((d) => d.code === 'GARN_CHILD_SUPPORT')!.amount).toBeCloseTo(disposable * 0.6, 2);
  });
  it('creditor garnishment limited to 25%', () => {
    const r = calculatePay(base({ deductions: [{ code: 'GARN_CREDITOR', amount: 5000 }] }));
    expect(r.deductions[0].amount).toBeCloseTo((3000 - r.employeeTaxes) * 0.25, 2);
  });
});

describe('Data coverage and integrity', () => {
  const db = loadTaxDatabase();
  it('every state, DC and territory has a 2027 income tax rule', () => {
    expect(STATES.length).toBe(56);
    for (const s of STATES) expect(ruleOn(db, s.code, 'SIT', '2027-06-30'), s.code).toBeDefined();
  });
  it('every rule cites at least one source and has a status', () => {
    for (const r of db.rules) {
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      expect(r.status, r.id).toBeTruthy();
    }
  });
  it('rule ids are unique', () => {
    const ids = db.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Pay runs, scenarios and vendor learning', () => {
  it('series carries YTD forward across the SS wage base', () => {
    const dates = Array.from({ length: 26 }, (_, i) => `2027-${String(Math.floor(i / 2.2) + 1).padStart(2, '0')}-15`);
    const res = runSeries(base({ earnings: [{ code: 'SALARY', amount: 10000 }] }), dates);
    const ss = res.reduce((a, r) => a + tax(r, 'US.SS_EE'), 0);
    expect(ss).toBeCloseTo(192300 * 0.062, 1);
  });
  it('Section 125 proposal shows employer FICA savings', () => {
    const without = [base()];
    const withPlan = [base({ deductions: [{ code: 'MED_125', amount: 500 }] })];
    const c = compareScenarios(without, withPlan);
    expect(c.employerTaxSavings).toBeCloseTo(500 * (0.0765 + 0.006 + 0.027), 2); // FICA + FUTA + TX SUI new-employer 2.7%
  });
  it('learner recovers whole-dollar FIT rounding from vendor samples', () => {
    const inputs = [2875.55, 1999.99, 4321.1, 812.37, 3650].map((amt, i) => base({ employee: { ...base().employee, id: `s${i}` }, earnings: [{ code: 'REG', amount: amt }] }));
    const samples = inputs.map((input) => {
      const r = calculatePay({ ...input, conventions: { fitRounding: 'dollar' } });
      return { input, actualTaxes: { 'US.FIT': tax(r, 'US.FIT'), 'US.SS_EE': tax(r, 'US.SS_EE') } };
    });
    const learned = learnVendorProfile('adp', samples);
    expect(learned.best.fitRounding).toBe('dollar');
    expect(learned.exactMatchRate).toBe(1);
  });
});

describe('State formulas re-verified in November 2026', () => {
  const sit = (state: string, w4: Record<string, unknown> = {}, amount = 3000, checkDate = '2026-10-16') =>
    tax(calculatePay(base({ checkDate, earnings: [{ code: 'REG', amount }], employee: { ...base().employee, residence: { state }, work: [{ state, percent: 1 }], stateW4: { [state]: w4 } } })), `${state}.SIT`);
  const direct = (state: string, w4: Record<string, unknown>, wages: number, annualFederalTax: number) =>
    computeStateCalc(ruleOn(loadTaxDatabase(), state, 'SIT', '2026-10-16')!.calc, { state, wages, supplemental: 0, periods: 26, w4, federalW4: { version: '2020+', filingStatus: 'single' }, annualFederalTax, useFlatSupplemental: false }).amount;

  it('Maine: standard deduction, then its phase-out above $102,250', () => {
    // 78,000 - 12,850 = 65,150 -> 1,589.20 + 2,527.875 + 21.45 = 4,138.525 / 26, whole dollars
    expect(sit('ME')).toBe(159);
    // 130,000: deduction 12,850 x 47,250/75,000 = 8,095.50; tax 8,196.47 / 26
    expect(sit('ME', {}, 5000)).toBe(315);
  });
  it('Kansas: $9,160 for the first two allowances when married, $2,320 after', () => {
    // 78,000 - 18,320 - 2,320 = 57,360 -> 2,392 + 174.096
    expect(sit('KS', { filingStatus: 'mfj', allowances: 3 })).toBe(98.7);
  });
  it('Wisconsin: the deduction shrinks as wages rise', () => {
    expect(sit('WI', { allowances: 1 })).toBe(146.36); // deduction gone at 78,000
    expect(sit('WI', { allowances: 1 }, 1000)).toBe(30.11); // 26,000: deduction 5,715.60
  });
  it('Rhode Island: no exemptions above $290,800', () => {
    expect(sit('RI', { allowances: 2 })).toBe(109.62);
    expect(sit('RI', { allowances: 2 }, 12000)).toBe(598.32);
  });
  it('South Carolina: the standard deduction needs at least one allowance', () => {
    expect(sit('SC')).toBe(154.77);
    expect(sit('SC', { allowances: 1 })).toBe(125.92);
  });
  it('North Carolina: 4.09% after a $12,750 deduction, whole dollars', () => {
    expect(sit('NC')).toBe(103);
  });
  it('Oregon: federal tax subtraction, two tables split at $50,000', () => {
    // 39,000 - 3,000 - 2,910 = 33,090 -> 263 + 216.125 + 462.375 + 1,897.875 - 263 credit = 2,576.375 / 26
    expect(direct('OR', { allowances: 1 }, 1500, 3000)).toBe(99);
    // 78,000 - 8,750 (cap) - 2,910 = 66,340 -> 678 + 4,807.25 - 263 = 5,222.25 / 26
    expect(direct('OR', { allowances: 1 }, 3000, 9000)).toBe(201);
  });
  it('Alabama: deduction steps down from $26,000 of wages', () => {
    // 78,000 - 2,500 - 1,500 - 8,000 federal = 66,000 -> 10 + 100 + 3,150 = 3,260 / 26
    expect(direct('AL', {}, 3000, 8000)).toBeCloseTo(125.38, 2);
    // 27,000: third band, deduction 2,925 -> 27,000 - 2,925 - 1,500 = 22,575 -> 110 + 978.75
    expect(direct('AL', {}, 27000 / 26, 0)).toBeCloseTo(1088.75 / 26, 2);
  });
  it('Philadelphia uses the rate for the date', () => {
    const db = loadTaxDatabase();
    expect((ruleOn(db, 'PA-PHILADELPHIA', 'LIT_EE', '2026-03-01')!.calc as any).rate).toBeCloseTo(0.0374);
    expect((ruleOn(db, 'PA-PHILADELPHIA', 'LIT_EE', '2026-08-01')!.calc as any).rate).toBeCloseTo(0.03735);
  });
});

describe('Every rule in the data', () => {
  const db = loadTaxDatabase();
  it('has a unique id and cites sources that exist', () => {
    const known = new Set(SOURCES.map((s) => s.id));
    expect(new Set(db.rules.map((r) => r.id)).size).toBe(db.rules.length);
    expect(db.rules.flatMap((r) => r.sources.filter((s) => !known.has(s)).map((s) => `${r.id}: ${s}`))).toEqual([]);
  });
  it('never overlaps another rule for the same tax', () => {
    const groups = new Map<string, typeof db.rules>();
    for (const r of db.rules) groups.set(`${r.jurisdiction}|${r.kind}|${r.name}`, [...(groups.get(`${r.jurisdiction}|${r.kind}|${r.name}`) ?? []), r]);
    const clashes: string[] = [];
    for (const rs of groups.values()) for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++)
      if (rs[i].effectiveFrom <= (rs[j].effectiveTo ?? '9999') && rs[j].effectiveFrom <= (rs[i].effectiveTo ?? '9999')) clashes.push(`${rs[i].id} / ${rs[j].id}`);
    expect(clashes).toEqual([]);
  });
  it('is only called confirmed when an outside source is named', () => {
    const inside = (s: string) => s === 'research-memory-2026' || s.endsWith('-agency') || s.endsWith('-local') || s === 'dol-sui-comparison';
    expect(db.rules.filter((r) => r.status === 'confirmed' && r.sources.every(inside)).map((r) => r.id)).toEqual([]);
  });
});

describe('Sanity sweep across every state, status and wage level', () => {
  const db = loadTaxDatabase();
  const levels = [8000, 15000, 22000, 30000, 40000, 52000, 65000, 80000, 100000, 130000, 180000, 260000, 520000, 1300000];
  it('state income tax is never negative, never falls as wages rise, and stays under 13.5% of wages', () => {
    const problems: string[] = [];
    for (const st of STATES) for (const date of ['2026-06-12', '2027-06-11']) for (const fs of ['single', 'mfj', 'hoh'] as const) for (const allowances of [0, 2]) {
      let prev = -1;
      for (const annual of levels) {
        const r = calculatePay(base({ checkDate: date, earnings: [{ code: 'REG', amount: annual / 26 }], employee: { id: 'e', federalW4: { version: '2020+', filingStatus: fs }, residence: { state: st.code }, work: [{ state: st.code, percent: 1 }], stateW4: { [st.code]: { filingStatus: fs, allowances } } } }), db);
        if (r.taxes.some((t) => !Number.isFinite(t.amount) || t.amount < 0)) problems.push(`${st.code} ${date} ${fs}: a tax line is negative or not a number at ${annual}`);
        const sit = tax(r, `${st.code}.SIT`) * 26;
        if (sit < prev - 30) problems.push(`${st.code} ${date} ${fs} ${allowances}: falls from ${prev.toFixed(0)} to ${sit.toFixed(0)} at ${annual}`);
        // Territories collect their income tax in place of the federal one, so their rates run higher.
        if (st.type !== 'territory' && sit / annual > 0.135) problems.push(`${st.code} ${date} ${fs}: ${((100 * sit) / annual).toFixed(1)}% at ${annual}`);
        prev = sit;
      }
    }
    expect(problems).toEqual([]);
  });
  it('a check dated outside the tax years on file says so instead of quietly withholding nothing', () => {
    const r = calculatePay(base({ checkDate: '2031-01-10' }), db);
    expect(r.warnings.join(' ')).toMatch(/No federal tax tables are on file for 2031/);
  });
});

describe('Connecticut TPG-211 withholding', () => {
  const ct = (wages: number, fed: any, w4: any = {}) => {
    const calc = loadTaxDatabase().rules.find((r) => r.jurisdiction === 'CT' && r.kind === 'SIT' && r.effectiveFrom.startsWith('2026'))!.calc;
    return computeStateCalc(calc, { state: 'CT', wages, supplemental: 0, periods: 52, w4, federalW4: fed, useFlatSupplemental: false }).amount * 52;
  };
  it('single (code F), low pay: exemption and the 35% personal tax credit', () => {
    // 22,393.80 - 15,000 = 7,393.80 x 2% = 147.88; credit .35 -> 96.12
    expect(ct(22393.8 / 52, { version: '2020+', filingStatus: 'single' })).toBeCloseTo(96.12, 1);
  });
  it('single over $44,000: exemption fully phased out, 10% credit', () => {
    // 52,826.28: 200 + 1,800 + 5.5% x 2,826.28 = 2,155.45; credit .10 -> 1,939.90
    expect(ct(52826.28 / 52, { version: '2020+', filingStatus: 'single' })).toBeCloseTo(1939.9, 1);
  });
  it('single $70,000: 2% add-back and no credit', () => {
    // 200 + 4.5% x 40,000 + 5.5% x 20,000 = 3,100; add-back (70,000 is in 66,500-71,500) $75
    expect(ct(70000 / 52, { version: '2020+', filingStatus: 'single' })).toBeCloseTo(3175, 1);
  });
  it('married filing jointly (code C) $36,226: $24,000 exemption, 35% credit', () => {
    // 12,226.32 x 2% = 244.53; credit .35 (33,500-40,000) -> 158.94
    expect(ct(36226.32 / 52, { version: '2020+', filingStatus: 'mfj' })).toBeCloseTo(158.94, 1);
  });
  it('single $120,000: recapture $75', () => {
    // 200 + 1,800 + 2,750 + 6% x 20,000 = 5,950; add-back 250; recapture (115,000-120,000) 75
    expect(ct(120000 / 52, { version: '2020+', filingStatus: 'single' })).toBeCloseTo(6275, 1);
  });
  it('code D: no exemption and no credit', () => {
    // 2% x 10,000 + 4.5% x 10,000 = 650
    expect(ct(20000 / 52, { version: '2020+', filingStatus: 'single' }, { ctCode: 'D' })).toBeCloseTo(650, 1);
  });
});
