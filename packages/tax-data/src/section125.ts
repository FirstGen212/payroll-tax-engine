/**
 * Section 125 (cafeteria plan) treatment for state and local taxes.
 *
 * Federally, a salary reduction under a Section 125 cafeteria plan comes out of income tax, Social Security,
 * Medicare and FUTA wages (IRC 125, 3121(a)(5)(G), 3306(b)(5)(G)). States and localities do not all follow that.
 * This table records, for each state and local tax the engine models, whether the reduction also lowers the
 * wages that tax is figured on. It was researched on 2026-11-21; every row keeps its status and sources.
 *
 * The engine reads this table through `section125Overrides()`, which turns it into the `stateOverrides` of the
 * Section 125 deduction types in benefits.ts. Keys are a state code (whole state) or a local jurisdiction code
 * (one place, wins over its state). `basis` is the engine wage basis the row controls:
 *   SIT   state income tax
 *   LOCAL city, county, school district and other local wage taxes
 *   SDI   state disability, family leave and other programs figured on SDI wages
 *   SUI   unemployment wages
 *
 * Rule of thumb the table follows: a reduction lowers a tax's wages only when the agency's own text says so, or
 * when the tax is defined by reference to federal wages or federal income (which already exclude Section 125).
 * Where the agency text includes the reduction, the row says so with the quote. Where nothing was found, the row
 * is `unverified` and keeps the engine's earlier default, so the open list at the bottom is the work left.
 */
import type { VerificationStatus, WageBasis } from './types.js';
import { agencySource } from './sources.js';

/** Which Section 125 benefits a row covers. */
export type Section125Benefit = 'health' | 'fsa' | 'dependent_care' | 'hsa';
export const SECTION125_BENEFITS: Section125Benefit[] = ['health', 'fsa', 'dependent_care', 'hsa'];

export interface Section125Rule {
  /** State code (e.g. 'NJ') or local jurisdiction code (e.g. 'PA-PHILADELPHIA'). */
  jurisdiction: string;
  /** Plain name of the tax, for the research page. */
  tax: string;
  basis: Extract<WageBasis, 'SIT' | 'LOCAL' | 'SDI' | 'SUI'>;
  /** true: the salary reduction lowers this tax's wages. false: the tax is figured on pay before the reduction. */
  reduces: boolean;
  /** Benefits this row covers (all four when left out). */
  benefits?: Section125Benefit[];
  status: VerificationStatus;
  sources: string[];
  /** What the source says, in plain words, with a short quote where there is one. */
  notes: string;
}

// ---------- Sources read for this audit ----------
const src = (id: string, agency: string, title: string, url: string) => agencySource(id, agency, title, url).id;
const NJ_TB39 = src('nj-tb-39r', 'New Jersey Division of Taxation', 'TB-39(R), Cafeteria Plans (March 3, 2003)', 'https://nj.gov/treasury/taxation/pdf/pubs/tb/tb39r.pdf');
const NJ_54A_6_24 = src('nj-54a-6-24', 'New Jersey Legislature', 'N.J.S.A. 54A:6-24, Cafeteria plan, qualified option', 'https://law.justia.com/codes/new-jersey/title-54a/section-54a-6-24/');
const NJ_W2_2025 = src('nj-omb-w2-2025', 'New Jersey Office of Management and Budget', 'Important information about your 2025 W-2 statement (state payroll)', 'https://www.nj.gov/treasury/omb/payroll/pdf/w2info2025.pdf');
const NJ_DOL_GUIDE = src('nj-dol-employer-accounts', 'New Jersey Department of Labor and Workforce Development', 'Employer Accounts guide (2019), Chapter I Section 4, wages', 'https://nj.gov/labor/ea/assets/PDFs/EmployerAcctsGuide.pdf');
const PA_GROSS_COMP = src('pa-pit-gross-comp', 'Pennsylvania Department of Revenue', 'PA Personal Income Tax Guide, Gross Compensation', 'https://www.pa.gov/agencies/revenue/forms-and-publications/pa-personal-income-tax-guide/gross-compensation.html');
const PA_DCAP = src('pa-dcap-act34', 'Pennsylvania Department of Revenue', 'Dependent care assistance (Act 34 of 2023)', 'https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/employer-withholding/dependent-care-assistance.html');
const PA_DCED_ACT32 = src('pa-dced-act32-faq', 'Pennsylvania DCED', 'FAQ: Act 32, Earned Income Tax Collection Reform', 'https://dced.pa.gov/local-government/local-income-tax-information/act32-faq/');
const PA_KEYSTONE = src('pa-keystone-clgs32-1', 'Keystone Collections Group (Act 32 tax collector)', 'Form CLGS-32-1 local earned income tax return instructions (04-24)', 'https://keystonecollects.com/download/ITRInstructions.pdf');
const PHL_WAGE = src('phl-wage-tax-pretax', 'City of Philadelphia Department of Revenue', 'What types of income are not subject to the Wage Tax? (June 15, 2020)', 'https://www.phila.gov/2020-06-15-what-types-of-income-are-not-subject-to-the-wage-tax/');
const OH_718_01 = src('oh-orc-718-01', 'Ohio Legislature', 'Ohio Revised Code 718.01(R), qualifying wages (effective September 30, 2025)', 'https://codes.ohio.gov/orc/section-718.01');
const KY_67_750 = src('ky-krs-67-750', 'Kentucky Legislature', 'KRS 67.750(2), definition of compensation for occupational license taxes', 'https://statecodesfiles.justia.com/kentucky/2016/chapter-67/section-.750/section-.750.pdf');
const MI_141_612 = src('mi-mcl-141-612', 'Michigan Legislature', 'MCL 141.612 (City Income Tax Act, Sec. 12), resident income', 'https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-141-612');
const KC_FAQ = src('kcmo-earnings-tax-faq', 'City of Kansas City, Missouri Revenue Division', 'Tax FAQs (earnings tax)', 'https://kcmo.gov/city-hall/departments/finance/tax-home/tax-faqs');
const STL_ITEMS = src('stl-earnings-taxable-items', 'City of St. Louis Collector of Revenue', 'Earnings tax: taxable and non-taxable items', 'https://www.stlouis-mo.gov/government/departments/collector/earnings-tax/taxable-items.cfm');
const AL_FAQ = src('al-dor-125-faq', 'Alabama Department of Revenue', 'FAQ: Does Alabama recognize the Section 125 cafeteria plan exclusion?', 'https://www.revenue.alabama.gov/faqs/we-have-a-section-125-cafeteria-plan-available-to-our-employees-does-the-state-of-alabama-recognize-this-exclusion-from-gross-income');
const WILM_REGS = src('wilmington-eit-regs', 'City of Wilmington Department of Finance', 'Earned Income Tax Regulations (revised May 25, 2023), Section 104(A)(19)', 'https://wilmingtonde.gov/home/showpublisheddocument/462/638206223264700000');
const OR_STT = src('or-dor-statewide-transit', 'Oregon Department of Revenue', 'Statewide Transit Tax', 'https://www.oregon.gov/dor/programs/businesses/Pages/Statewide-Transit-Tax.aspx');
const MA_PFML_WAGES = src('ma-dfml-wages', 'Massachusetts Department of Family and Medical Leave', 'Wages subject to PFML contributions and how to report (updated October 21, 2024)', 'https://www.mass.gov/info-details/wages-subject-to-paid-family-and-medical-leave-pfml-contributions-and-how-to-report');

/** States with a wage-based personal income tax whose withholding starts from federal wages or federal income. */
const CONFORMING_SIT = ['AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'RI', 'SC', 'UT', 'VT', 'VA', 'WV', 'WI'];

export const SECTION125_RULES: Section125Rule[] = [
  // ---------- State income tax ----------
  { jurisdiction: 'NJ', tax: 'New Jersey Gross Income Tax', basis: 'SIT', reduces: false, status: 'published', sources: [NJ_TB39, NJ_54A_6_24, NJ_W2_2025],
    notes: 'New Jersey "does not adopt the federal income tax treatment of cafeteria plans" (TB-39(R)). Benefits bought by salary reduction, which the statute says includes "flexible spending accounts and premium conversion options", are not excluded, so health premiums, FSAs, dependent care and HSA contributions run through a cafeteria plan stay in NJ wages. 401(k) deferrals still follow federal treatment. The state payroll W-2 notes take Section 125 out of boxes 1, 3 and 5, and out of box 16 only for Pennsylvania.' },
  { jurisdiction: 'PA', tax: 'Pennsylvania personal income tax', basis: 'SIT', reduces: true, benefits: ['health', 'fsa', 'hsa'], status: 'published', sources: [PA_GROSS_COMP],
    notes: 'The PIT guide makes amounts deducted for accident or health coverage taxable "except in the case of cafeteria plans", so pre-tax health, dental and vision premiums through a cafeteria plan are excluded. The guide does not discuss health FSAs or HSAs by name; they follow the same health-coverage exclusion here (HSA was already excluded in this engine).' },
  { jurisdiction: 'PA', tax: 'Pennsylvania personal income tax (dependent care)', basis: 'SIT', reduces: true, benefits: ['dependent_care'], status: 'published', sources: [PA_DCAP],
    notes: 'Act 34 of 2023 (effective December 14, 2023) excludes IRC 129 dependent care assistance, including "pre-tax contributions made by the employee under a section 125 dependent care flexible spending account", up to $5,000. Before 2024 it was taxable for PA, which is what this engine had.' },
  { jurisdiction: 'AL', tax: 'Alabama income tax', basis: 'SIT', reduces: true, status: 'published', sources: [AL_FAQ],
    notes: 'Alabama "recognizes the following Federal Code Sections: Section 125 Cafeteria Plan, Section 401K, and Section 403B."' },
  ...CONFORMING_SIT.map((st): Section125Rule => ({ jurisdiction: st, tax: `${st} income tax`, basis: 'SIT', reduces: true, status: 'unverified', sources: [],
    notes: 'Withholding starts from federal wages or federal income, which already exclude Section 125. No state source was found that adds it back, but the agency text was not read for this state.' })),

  // ---------- Local wage taxes ----------
  { jurisdiction: 'PA', tax: 'Pennsylvania local earned income tax (Act 32)', basis: 'LOCAL', reduces: true, status: 'confirmed', sources: [PA_DCED_ACT32, PA_KEYSTONE],
    notes: 'Under Act 32 "earned income is compensation as defined under the PA Personal Income Tax Law" (DCED). The Act 32 collector\'s return instructions list "cafeteria plans" under non-taxable income and say PA law excludes up to $5,000 of dependent care benefits. This engine used to keep Section 125 in local EIT wages; that was the pre-2012 rule. The Local Services Tax is a flat amount and is not affected.' },
  { jurisdiction: 'PA-PHILADELPHIA', tax: 'Philadelphia Wage Tax', basis: 'LOCAL', reduces: false, status: 'published', sources: [PHL_WAGE],
    notes: 'Philadelphia is outside Act 32. The Revenue Department lists "Pre-tax Sec 125 benefits (Medical/Dental/Vision, etc.)" and "Flexible Spending Accounts (FSAs)" and HSAs as subject to Wage Tax. Employer-paid premiums are not taxable. The page is from 2020 and marked archived; no later change was found.' },
  { jurisdiction: 'OH', tax: 'Ohio municipal income tax', basis: 'LOCAL', reduces: true, status: 'published', sources: [OH_718_01],
    notes: 'Qualifying wages start from Medicare wages and deduct "compensation attributable to a plan or program described in section 125" (ORC 718.01(R)(1)(a)), with no date condition. 401(k), 403(b) and 457 deferrals are added back and stay taxable. Ohio school district income tax is figured on Ohio income (traditional base) or wages (earned income base) that start from the same federal figures.' },
  { jurisdiction: 'KY', tax: 'Kentucky city and county occupational license taxes', basis: 'LOCAL', reduces: false, status: 'published', sources: [KY_67_750],
    notes: 'KRS 67.750(2)(b): compensation includes "any amounts contributed by an employee to any welfare benefit, fringe benefit, or other benefit plan" by salary reduction that lowers federal taxable pay, "including but not limited to Sections 125 and 132". Retirement deferrals are added back as well. The text read is the 2015 version; local ordinances follow it.' },
  { jurisdiction: 'MI', tax: 'Michigan city income taxes', basis: 'LOCAL', reduces: true, status: 'published', sources: [MI_141_612],
    notes: 'City income tax applies to income "to the same extent and on the same basis that the income is subject to taxation under the federal internal revenue code" (MCL 141.612), so Section 125 is out. Detroit\'s withholding guide starts from gross earnings without naming pre-tax deductions; confirm with Detroit if a client is there.' },
  { jurisdiction: 'MO-KANSAS_CITY', tax: 'Kansas City earnings tax', basis: 'LOCAL', reduces: true, status: 'published', sources: [KC_FAQ],
    notes: '"Taxable earnings are gross compensation less contributions to cafeteria plans and qualified deferred compensation plans."' },
  { jurisdiction: 'MO-ST_LOUIS', tax: 'St. Louis earnings tax', basis: 'LOCAL', reduces: true, status: 'published', sources: [STL_ITEMS],
    notes: 'Lists "Cafeteria Plans (IRC Sec. 125-129 Plans)" as non-taxable for the employee earnings tax. (The separate employer payroll expense tax does tax them.)' },
  { jurisdiction: 'DE-WILMINGTON', tax: 'Wilmington earned income (wage) tax', basis: 'LOCAL', reduces: true, status: 'published', sources: [WILM_REGS],
    notes: 'Regulation 104(A)(19): "Any amount or benefit not included in federal gross income pursuant to Sections 125, 129, and 132" is not subject to the tax.' },
  { jurisdiction: 'MD', tax: 'Maryland county income tax and special nonresident tax', basis: 'LOCAL', reduces: true, status: 'unverified', sources: [],
    notes: 'Figured on the same Maryland wages as the state tax, which follow federal wages.' },
  { jurisdiction: 'IN', tax: 'Indiana county income tax', basis: 'LOCAL', reduces: true, status: 'unverified', sources: [],
    notes: 'Figured on Indiana adjusted gross income, which starts from federal income.' },
  { jurisdiction: 'NY', tax: 'New York City and Yonkers', basis: 'LOCAL', reduces: true, status: 'unverified', sources: [],
    notes: 'New York City tax uses the same wages as New York State, and the Yonkers resident surcharge is a share of the state tax, so both follow the state treatment.' },
  { jurisdiction: 'OR', tax: 'Oregon statewide transit tax', basis: 'SIT', reduces: true, status: 'published', sources: [OR_STT],
    notes: 'Figured on "wages as defined in ORS 316.162", the state withholding wages, which follow federal wages. The engine now figures this tax on state income tax wages instead of gross pay.' },
  { jurisdiction: 'AL', tax: 'Alabama city and county occupational taxes', basis: 'LOCAL', reduces: false, status: 'unverified', sources: [],
    notes: 'No city text was found saying whether Birmingham and the other occupational taxes are figured before or after Section 125. They are treated as taxable (no savings) until confirmed, so proposals do not overstate savings.' },

  // ---------- State programs ----------
  { jurisdiction: 'MA', tax: 'Massachusetts Paid Family and Medical Leave', basis: 'SDI', reduces: false, status: 'published', sources: [MA_PFML_WAGES],
    notes: '"Employee payments to a cafeteria plan are subject to PFML contributions if they are part of an employee\'s salary." Employer payments to a cafeteria plan are not. The engine now figures MA PFML on SDI wages so this can apply.' },
  { jurisdiction: 'NJ', tax: 'New Jersey UI, TDI and FLI (dependent care)', basis: 'SDI', reduces: false, benefits: ['dependent_care'], status: 'published', sources: [NJ_DOL_GUIDE],
    notes: 'A dependent care program "financed by an employee\'s voluntary salary reduction" is wages for unemployment and disability contributions. The guide does not address health premium salary reductions.' },
  { jurisdiction: 'NJ', tax: 'New Jersey UI, TDI and FLI (dependent care)', basis: 'SUI', reduces: false, benefits: ['dependent_care'], status: 'published', sources: [NJ_DOL_GUIDE],
    notes: 'Same guide as the TDI and FLI row.' },
];

/** Taxes checked with no answer yet. Each keeps the engine's earlier default. */
export const SECTION125_OPEN = [
  'New Jersey UI, TDI and FLI on health premium salary reductions (the Department of Labor guide covers only dependent care).',
  'New York Paid Family Leave and disability benefits: the agency pages say "gross wages" without saying whether Section 125 comes out first.',
  'Washington Paid Family and Medical Leave and WA Cares: RCW 50A.05.010 defines wages as remuneration and does not mention Section 125.',
  'California SDI: the EDD taxability table (DE 231TP) lists cafeteria plans but the extracted table did not line up the SDI column.',
  'Paid leave programs in CO, CT, DE, ME, MD, MN, OR and RI, Hawaii TDI and the employee unemployment taxes in AK and PA.',
  'Alabama city and county occupational taxes (Birmingham and others).',
  'Newark payroll tax and the TriMet and Lane transit taxes (employer-paid).',
  'State income tax rows marked unverified: the state follows federal wages, but its own text was not read in this audit.',
];

const CATEGORY_BENEFIT: Record<string, Section125Benefit> = { section125_health: 'health', fsa: 'fsa', dependent_care: 'dependent_care', hsa: 'hsa' };

/** The Section 125 benefit a deduction category belongs to, if any. */
export function section125BenefitOf(category: string): Section125Benefit | undefined {
  return CATEGORY_BENEFIT[category];
}

/** Rows that apply to a benefit, most specific (local code) last so it wins. */
export function section125RulesFor(benefit: Section125Benefit): Section125Rule[] {
  return SECTION125_RULES.filter((r) => !r.benefits || r.benefits.includes(benefit));
}

/** The table as `stateOverrides` entries for one benefit: { NJ: { SIT: false }, 'PA-PHILADELPHIA': { LOCAL: false }, ... }. */
export function section125Overrides(benefit: Section125Benefit): Record<string, Partial<Record<WageBasis, boolean>>> {
  const out: Record<string, Partial<Record<WageBasis, boolean>>> = {};
  for (const r of section125RulesFor(benefit)) {
    // Unverified rows that agree with the federal default add nothing; the rest are written so the engine and the seed carry them.
    out[r.jurisdiction] = { ...(out[r.jurisdiction] ?? {}), [r.basis]: r.reduces };
  }
  return out;
}

/** The row that decides one tax for one benefit, local code first, then its state. */
export function section125RuleOf(benefit: Section125Benefit, basis: Section125Rule['basis'], state?: string, localCode?: string): Section125Rule | undefined {
  const rows = section125RulesFor(benefit).filter((r) => r.basis === basis);
  return (localCode ? rows.find((r) => r.jurisdiction === localCode) : undefined) ?? (state ? rows.find((r) => r.jurisdiction === state) : undefined);
}
