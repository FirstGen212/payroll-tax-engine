/**
 * Local jurisdictions: cities, counties, school districts, PA PSDs, transit districts.
 *
 * This file holds a curated starter set for the major local systems. The full
 * jurisdiction lists (PA DCED ~2,500 PSDs, Ohio ~600 municipalities and ~200
 * school districts, KY occupational, IN 92 counties, MD 24 counties, MI 24 cities)
 * are loaded by the importers in apps/api/src/importers from the agency files.
 * Every row here is 'unverified' unless noted.
 */
import type { CalcSpec, Jurisdiction, JurisdictionType, TaxKind, TaxRule, VerificationStatus } from './types.js';
import { agencySource } from './sources.js';

export interface LocalDef {
  code: string;
  name: string;
  state: string;
  type: JurisdictionType;
  kind: TaxKind;
  payer?: 'employee' | 'employer';
  /** Rate for residents (percent). */
  resident?: number;
  /** Rate for nonresidents working there (percent). */
  nonresident?: number;
  calc?: CalcSpec;
  from?: string;
  status?: VerificationStatus;
  source?: string;
  notes?: string;
  optional?: boolean;
  /** Extra attributes (school district base type, PSD code, credit rules). */
  attrs?: Record<string, unknown>;
}

const pct = (r: number): CalcSpec => ({ kind: 'percent', rate: r / 100 });

// ---------- Ohio municipalities (employer withholds for work city; resident credit varies) ----------
const OH_CITIES: [string, string, number, number?][] = [
  ['COLUMBUS', 'Columbus', 2.5, 2.5], ['CLEVELAND', 'Cleveland', 2.5, 2.5], ['CINCINNATI', 'Cincinnati', 1.8, 1.8], ['TOLEDO', 'Toledo', 2.5, 2.5],
  ['AKRON', 'Akron', 2.5, 2.5], ['DAYTON', 'Dayton', 2.5, 2.25], ['YOUNGSTOWN', 'Youngstown', 2.75, 2.75], ['CANTON', 'Canton', 2.5, 2.5],
  ['PARMA', 'Parma', 2.5, 2.5], ['LORAIN', 'Lorain', 2.5, 2.5], ['HAMILTON', 'Hamilton', 2.0, 2.0], ['SPRINGFIELD', 'Springfield', 2.4, 2.4],
  ['KETTERING', 'Kettering', 2.5, 2.5], ['ELYRIA', 'Elyria', 2.25, 2.25], ['LAKEWOOD', 'Lakewood', 1.5, 1.5], ['CUYAHOGA_FALLS', 'Cuyahoga Falls', 2.0, 2.0],
  ['EUCLID', 'Euclid', 2.85, 2.85], ['MANSFIELD', 'Mansfield', 2.0, 2.0], ['NEWARK', 'Newark', 1.75, 1.75], ['MENTOR', 'Mentor', 2.0, 2.0],
  ['CLEVELAND_HEIGHTS', 'Cleveland Heights', 2.5, 2.5], ['DUBLIN', 'Dublin', 2.0, 2.0], ['WESTERVILLE', 'Westerville', 2.0, 2.0], ['UPPER_ARLINGTON', 'Upper Arlington', 2.5, 2.5],
  ['GROVE_CITY', 'Grove City', 2.0, 2.0], ['HILLIARD', 'Hilliard', 2.5, 2.5], ['GAHANNA', 'Gahanna', 2.5, 2.5], ['STRONGSVILLE', 'Strongsville', 2.0, 2.0],
  ['FAIRBORN', 'Fairborn', 2.0, 2.0], ['HUBER_HEIGHTS', 'Huber Heights', 2.25, 2.25], ['DELAWARE', 'Delaware', 1.85, 1.85], ['FINDLAY', 'Findlay', 1.9, 1.9],
  ['LIMA', 'Lima', 1.5, 1.5], ['MARION', 'Marion', 2.0, 2.0], ['WARREN', 'Warren', 2.5, 2.5], ['MASSILLON', 'Massillon', 1.8, 1.8],
  ['MIDDLETOWN', 'Middletown', 2.0, 2.0], ['REYNOLDSBURG', 'Reynoldsburg', 2.5, 2.5], ['WORTHINGTON', 'Worthington', 2.5, 2.5], ['BOWLING_GREEN', 'Bowling Green', 2.0, 2.0],
];

// ---------- Ohio school district income tax (SDIT). base: 'traditional' (Ohio taxable income) or 'earned' (wages). ----------
const OH_SCHOOLS: [string, string, number, 'traditional' | 'earned'][] = [
  ['4501', 'Big Walnut LSD', 0.75, 'earned'], ['2102', 'Buckeye Valley LSD', 1.0, 'earned'], ['7101', 'Wilmington CSD (example)', 1.0, 'traditional'],
  ['2301', 'Fairfield Union LSD', 1.25, 'traditional'], ['0204', 'Shawnee LSD (Allen)', 1.0, 'traditional'], ['8302', 'Mount Vernon CSD (example)', 1.0, 'earned'],
  ['1603', 'Northwest LSD (Stark)', 1.0, 'earned'], ['4602', 'Mariemont CSD (example)', 0.75, 'earned'],
];

// ---------- Pennsylvania EIT (Act 32): withhold the higher of resident total rate or work-location nonresident rate ----------
// [PSD code, name, resident total %, nonresident %, LST $]
const PA_PSDS: [string, string, number, number, number][] = [
  ['510101', 'Philadelphia (see wage tax rule)', 0, 0, 0],
  ['700102', 'Pittsburgh City / Pittsburgh SD', 3.0, 1.0, 52],
  ['351601', 'Scranton City / Scranton SD', 3.4, 1.0, 156],
  ['062801', 'Reading City / Reading SD', 3.6, 1.3, 52],
  ['390301', 'Allentown City / Allentown SD', 1.975, 1.28, 52],
  ['250701', 'Erie City / Erie SD', 1.65, 1.18, 52],
  ['220601', 'Harrisburg City / Harrisburg SD', 2.0, 1.0, 52],
  ['360701', 'Lancaster City / School District of Lancaster', 1.1, 1.1, 52],
  ['481601', 'Bethlehem City (Northampton) / Bethlehem Area SD', 1.0, 1.0, 52],
  ['671501', 'York City / York City SD', 1.25, 1.0, 52],
  ['400701', 'Wilkes-Barre City / Wilkes-Barre Area SD', 2.85, 1.85, 52],
  ['020101', 'Bethel Park Boro / Bethel Park SD', 1.0, 0.0, 52],
  ['880000', 'Default (no local EIT on file)', 0.5, 0.0, 0],
];

// ---------- Michigan cities (resident / nonresident) ----------
const MI_CITIES: [string, string, number, number][] = [
  ['DETROIT', 'Detroit', 2.4, 1.2], ['GRAND_RAPIDS', 'Grand Rapids', 1.5, 0.75], ['HIGHLAND_PARK', 'Highland Park', 2.0, 1.0], ['SAGINAW', 'Saginaw', 1.5, 0.75],
  ['LANSING', 'Lansing', 1.0, 0.5], ['FLINT', 'Flint', 1.0, 0.5], ['PONTIAC', 'Pontiac', 1.0, 0.5], ['BATTLE_CREEK', 'Battle Creek', 1.0, 0.5],
  ['JACKSON', 'Jackson', 1.0, 0.5], ['MUSKEGON', 'Muskegon', 1.0, 0.5], ['PORT_HURON', 'Port Huron', 1.0, 0.5], ['HAMTRAMCK', 'Hamtramck', 1.0, 0.5],
  ['ALBION', 'Albion', 1.0, 0.5], ['BENTON_HARBOR', 'Benton Harbor', 1.0, 0.5], ['BIG_RAPIDS', 'Big Rapids', 1.0, 0.5], ['EAST_LANSING', 'East Lansing', 1.0, 0.5],
  ['GRAYLING', 'Grayling', 1.0, 0.5], ['HUDSON', 'Hudson', 1.0, 0.5], ['IONIA', 'Ionia', 1.0, 0.5], ['LAPEER', 'Lapeer', 1.0, 0.5],
  ['MUSKEGON_HEIGHTS', 'Muskegon Heights', 1.0, 0.5], ['PORTLAND', 'Portland', 1.0, 0.5], ['SPRINGFIELD', 'Springfield', 1.0, 0.5], ['WALKER', 'Walker', 1.0, 0.5],
];

// ---------- Maryland counties (resident rate; nonresidents pay 2.25% special nonresident tax) ----------
const MD_COUNTIES: [string, string, number][] = [
  ['ALLEGANY', 'Allegany', 3.03], ['ANNE_ARUNDEL', 'Anne Arundel', 2.81], ['BALTIMORE_CITY', 'Baltimore City', 3.2], ['BALTIMORE_CO', 'Baltimore County', 3.2],
  ['CALVERT', 'Calvert', 3.0], ['CAROLINE', 'Caroline', 3.2], ['CARROLL', 'Carroll', 3.03], ['CECIL', 'Cecil', 2.74], ['CHARLES', 'Charles', 3.03],
  ['DORCHESTER', 'Dorchester', 3.3], ['FREDERICK', 'Frederick', 2.96], ['GARRETT', 'Garrett', 2.65], ['HARFORD', 'Harford', 3.06], ['HOWARD', 'Howard', 3.2],
  ['KENT', 'Kent', 3.2], ['MONTGOMERY', 'Montgomery', 3.2], ['PRINCE_GEORGES', "Prince George's", 3.2], ['QUEEN_ANNES', "Queen Anne's", 3.2],
  ['ST_MARYS', "St. Mary's", 3.2], ['SOMERSET', 'Somerset', 3.2], ['TALBOT', 'Talbot', 2.4], ['WASHINGTON', 'Washington', 2.95], ['WICOMICO', 'Wicomico', 3.2],
  ['WORCESTER', 'Worcester', 2.25],
];

// ---------- Indiana counties (same rate for residents and nonresidents since 2017; residence county as of Jan 1 controls) ----------
const IN_COUNTIES: [string, string, number][] = [
  ['MARION', 'Marion', 2.02], ['LAKE', 'Lake', 1.5], ['ALLEN', 'Allen', 1.59], ['HAMILTON', 'Hamilton', 1.1], ['ST_JOSEPH', 'St. Joseph', 1.75],
  ['VANDERBURGH', 'Vanderburgh', 1.25], ['TIPPECANOE', 'Tippecanoe', 1.28], ['PORTER', 'Porter', 0.5], ['ELKHART', 'Elkhart', 2.0], ['MONROE', 'Monroe', 1.345],
  ['HENDRICKS', 'Hendricks', 1.7], ['JOHNSON', 'Johnson', 1.0], ['MADISON', 'Madison', 2.25], ['DELAWARE', 'Delaware', 1.5], ['CLARK', 'Clark', 2.0],
  ['VIGO', 'Vigo', 2.0], ['LAPORTE', 'LaPorte', 0.95], ['HOWARD', 'Howard', 1.75], ['KOSCIUSKO', 'Kosciusko', 1.0], ['BARTHOLOMEW', 'Bartholomew', 1.75],
];

// ---------- Kentucky occupational license taxes (city/county; often with wage caps) ----------
const KY_OLT: [string, string, number, number?][] = [
  ['LOUISVILLE_METRO', 'Louisville/Jefferson County Metro (resident)', 2.2, 1.45], ['LEXINGTON_FAYETTE', 'Lexington-Fayette Urban County', 2.25, 2.25],
  ['COVINGTON', 'Covington', 2.45, 2.45], ['BOWLING_GREEN', 'Bowling Green', 1.85, 1.85], ['OWENSBORO', 'Owensboro', 1.47, 1.47],
  ['FRANKFORT', 'Frankfort', 2.0, 2.0], ['FLORENCE', 'Florence', 2.0, 2.0], ['RICHMOND', 'Richmond', 2.25, 2.25], ['KENTON_COUNTY', 'Kenton County', 0.7, 0.7],
  ['BOONE_COUNTY', 'Boone County', 0.8, 0.8],
];

// ---------- Missouri, Alabama, Delaware, Oregon, Colorado, NY, NJ, WV and others ----------
const OTHER: LocalDef[] = [
  { code: 'MO-KANSAS_CITY', name: 'Kansas City Earnings Tax', state: 'MO', type: 'city', kind: 'LIT_EE', resident: 1.0, nonresident: 1.0 },
  { code: 'MO-ST_LOUIS', name: 'St. Louis City Earnings Tax', state: 'MO', type: 'city', kind: 'LIT_EE', resident: 1.0, nonresident: 1.0 },
  { code: 'AL-BIRMINGHAM', name: 'Birmingham Occupational Tax', state: 'AL', type: 'city', kind: 'LIT_EE', resident: 1.0, nonresident: 1.0, notes: 'Work-location tax regardless of residence.' },
  { code: 'AL-BESSEMER', name: 'Bessemer Occupational Tax', state: 'AL', type: 'city', kind: 'LIT_EE', resident: 1.0, nonresident: 1.0 },
  { code: 'AL-GADSDEN', name: 'Gadsden Occupational Tax', state: 'AL', type: 'city', kind: 'LIT_EE', resident: 2.0, nonresident: 2.0 },
  { code: 'AL-AUBURN', name: 'Auburn Occupational Tax', state: 'AL', type: 'city', kind: 'LIT_EE', resident: 1.0, nonresident: 1.0 },
  { code: 'AL-OPELIKA', name: 'Opelika Occupational Tax', state: 'AL', type: 'city', kind: 'LIT_EE', resident: 1.0, nonresident: 1.0 },
  { code: 'AL-MACON_CO', name: 'Macon County Occupational Tax', state: 'AL', type: 'county', kind: 'LIT_EE', resident: 1.0, nonresident: 1.0 },
  { code: 'DE-WILMINGTON', name: 'Wilmington City Wage Tax', state: 'DE', type: 'city', kind: 'LIT_EE', resident: 1.25, nonresident: 1.25 },
  { code: 'NJ-NEWARK', name: 'Newark Payroll Tax (employer)', state: 'NJ', type: 'city', kind: 'LIT_ER', payer: 'employer', resident: 1.0, nonresident: 1.0, notes: 'Employer-paid 1% on wages of employees working in Newark.' },
  { code: 'OR-TRIMET', name: 'TriMet Transit District Payroll Tax', state: 'OR', type: 'transit_district', kind: 'TRANSIT_ER', payer: 'employer', resident: 0.8237, nonresident: 0.8237, notes: 'Rate rises ~0.01% each January; confirm current.' },
  { code: 'OR-LANE_TRANSIT', name: 'Lane Transit District Payroll Tax', state: 'OR', type: 'transit_district', kind: 'TRANSIT_ER', payer: 'employer', resident: 0.79, nonresident: 0.79 },
  { code: 'OR-METRO_SHS', name: 'Portland Metro Supportive Housing Services tax', state: 'OR', type: 'special_district', kind: 'LIT_EE', resident: 1.0, nonresident: 1.0, optional: true, calc: { kind: 'percent', rate: 0.01, threshold: 200000 }, notes: '1% on taxable income over $125k single / $200k joint. Withholding mandatory for employees with wages over $200k who have not opted out; otherwise elective.' },
  { code: 'OR-MULTNOMAH_PFA', name: 'Multnomah County Preschool for All tax', state: 'OR', type: 'county', kind: 'LIT_EE', resident: 1.5, nonresident: 1.5, optional: true, calc: { kind: 'percent', rate: 0.015, threshold: 200000 }, notes: '1.5% over $125k/$200k, plus 1.5% over $250k/$400k (not yet modeled).' },
  { code: 'CO-DENVER', name: 'Denver Occupational Privilege Tax', state: 'CO', type: 'city', kind: 'OPT_EE', calc: { kind: 'fixed', amount: 5.75, per: 'month', minEarnings: 500, minEarningsPer: 'month' }, notes: 'Employer also pays $4.00/month (separate rule).' },
  { code: 'CO-DENVER-ER', name: 'Denver OPT (employer head tax)', state: 'CO', type: 'city', kind: 'OPT_ER', payer: 'employer', calc: { kind: 'fixed', amount: 4.0, per: 'month', minEarnings: 500, minEarningsPer: 'month' } },
  { code: 'CO-AURORA', name: 'Aurora Occupational Privilege Tax', state: 'CO', type: 'city', kind: 'OPT_EE', calc: { kind: 'fixed', amount: 2.0, per: 'month', minEarnings: 250, minEarningsPer: 'month' } },
  { code: 'CO-GREENWOOD_VILLAGE', name: 'Greenwood Village OPT', state: 'CO', type: 'city', kind: 'OPT_EE', calc: { kind: 'fixed', amount: 2.0, per: 'month', minEarnings: 250, minEarningsPer: 'month' } },
  { code: 'CO-GLENDALE', name: 'Glendale OPT', state: 'CO', type: 'city', kind: 'OPT_EE', calc: { kind: 'fixed', amount: 5.0, per: 'month', minEarnings: 750, minEarningsPer: 'month' } },
  { code: 'CO-SHERIDAN', name: 'Sheridan OPT', state: 'CO', type: 'city', kind: 'OPT_EE', calc: { kind: 'fixed', amount: 3.0, per: 'month', minEarnings: 500, minEarningsPer: 'month' } },
  { code: 'WV-CHARLESTON', name: 'Charleston City Service Fee', state: 'WV', type: 'city', kind: 'LIT_EE', calc: { kind: 'fixed', amount: 3.0, per: 'week' } },
  { code: 'WV-HUNTINGTON', name: 'Huntington Municipal Service Fee', state: 'WV', type: 'city', kind: 'LIT_EE', calc: { kind: 'fixed', amount: 5.0, per: 'week' } },
  { code: 'WV-WHEELING', name: 'Wheeling Municipal Service Fee', state: 'WV', type: 'city', kind: 'LIT_EE', calc: { kind: 'fixed', amount: 2.0, per: 'week' } },
  { code: 'WV-MORGANTOWN', name: 'Morgantown User Fee', state: 'WV', type: 'city', kind: 'LIT_EE', calc: { kind: 'fixed', amount: 3.0, per: 'week' } },
  // New York City / Yonkers / MCTMT
  { code: 'NY-NYC', name: 'New York City resident income tax', state: 'NY', type: 'city', kind: 'LIT_EE', calc: { kind: 'custom', handler: 'NYC', params: { brackets: [{ over: 0, rate: 0.03078 }, { over: 12000, rate: 0.03762 }, { over: 25000, rate: 0.03819 }, { over: 50000, rate: 0.03876 }], standardDeduction: { single: 5000, mfj: 5500 }, allowanceDeduction: 1000 } }, attrs: { residentOnly: true }, notes: 'Residents only. NYC-specific withholding tables in NYS-50-T-NYC should replace this approximation.' },
  { code: 'NY-YONKERS', name: 'Yonkers resident surcharge (16.75% of NYS tax)', state: 'NY', type: 'city', kind: 'LIT_EE', calc: { kind: 'custom', handler: 'PCT_OF_STATE', params: { pct: 0.1675 } }, attrs: { residentOnly: true } },
  { code: 'NY-YONKERS-NR', name: 'Yonkers nonresident earnings tax (0.5%)', state: 'NY', type: 'city', kind: 'LIT_EE', calc: { kind: 'percent', rate: 0.005 }, attrs: { nonresidentOnly: true } },
  { code: 'NY-MCTMT', name: 'Metropolitan Commuter Transportation Mobility Tax (Zone 1)', state: 'NY', type: 'transit_district', kind: 'TRANSIT_ER', payer: 'employer', calc: { kind: 'percent', rate: 0.006 }, optional: true, notes: 'Applies to employers with MCTD payroll over $1.75M per quarter (0.11%-0.60% tiers). Toggle per client.' },
  // Philadelphia
  { code: 'PA-PHILADELPHIA', name: 'Philadelphia Wage Tax', state: 'PA', type: 'city', kind: 'LIT_EE', resident: 3.74, nonresident: 3.43, from: '2025-07-01', notes: 'Rates change each July 1; confirm current rates with Philadelphia Dept. of Revenue. Excluded from Act 32 EIT collection.' },
  { code: 'PA-PHILADELPHIA-PRE', name: 'Philadelphia Wage Tax (pre-July 2025)', state: 'PA', type: 'city', kind: 'LIT_EE', resident: 3.75, nonresident: 3.44, from: '2024-07-01', status: 'unverified' },
];

function localsFromTables(): LocalDef[] {
  const out: LocalDef[] = [];
  for (const [c, n, r, nr] of OH_CITIES) out.push({ code: `OH-${c}`, name: `${n} municipal income tax`, state: 'OH', type: 'city', kind: 'LIT_EE', resident: r, nonresident: nr ?? r, attrs: { residentCreditPct: 100, residentCreditLimit: r } });
  for (const [c, n, r, base] of OH_SCHOOLS) out.push({ code: `OH-SD-${c}`, name: `${n} school district income tax`, state: 'OH', type: 'school_district', kind: 'SCHOOL_EE', resident: r, attrs: { residentOnly: true, base, sdNumber: c } });
  for (const [psd, n, r, nr, lst] of PA_PSDS) {
    if (psd === '510101') continue;
    out.push({ code: `PA-PSD-${psd}`, name: `${n} EIT`, state: 'PA', type: 'psd', kind: 'LIT_EE', resident: r, nonresident: nr, attrs: { psd, act32: true } });
    if (lst > 0) out.push({ code: `PA-PSD-${psd}-LST`, name: `${n} Local Services Tax`, state: 'PA', type: 'psd', kind: 'LST_EE', calc: { kind: 'fixed', amount: lst, per: 'year', annualMax: lst }, attrs: { psd, lowIncomeExemption: lst > 10 ? 12000 : 0 }, notes: 'Prorated per pay period; employees earning under $12,000 are exempt where LST > $10.' });
  }
  for (const [c, n, r, nr] of MI_CITIES) out.push({ code: `MI-${c}`, name: `${n} city income tax`, state: 'MI', type: 'city', kind: 'LIT_EE', resident: r, nonresident: nr, attrs: { exemptionPerAllowance: c === 'DETROIT' ? 600 : c === 'GRAND_RAPIDS' ? 600 : 600 } });
  for (const [c, n, r] of MD_COUNTIES) out.push({ code: `MD-${c}`, name: `${n} County local income tax`, state: 'MD', type: 'county', kind: 'LIT_EE', resident: r, attrs: { residentOnly: true }, notes: c === 'ANNE_ARUNDEL' || c === 'FREDERICK' ? 'Tiered county rate by income; flat rate shown.' : undefined });
  out.push({ code: 'MD-NONRESIDENT', name: 'Maryland special nonresident tax', state: 'MD', type: 'special_district', kind: 'LIT_EE', nonresident: 2.25, attrs: { nonresidentOnly: true }, notes: 'Withheld for nonresidents working in MD who are not residents of a reciprocal state.' });
  for (const [c, n, r] of IN_COUNTIES) out.push({ code: `IN-${c}`, name: `${n} County income tax`, state: 'IN', type: 'county', kind: 'LIT_EE', resident: r, nonresident: r, attrs: { residenceAsOfJan1: true } });
  for (const [c, n, r, nr] of KY_OLT) out.push({ code: `KY-${c}`, name: `${n} occupational license tax`, state: 'KY', type: c.endsWith('COUNTY') ? 'county' : 'city', kind: 'LIT_EE', resident: r, nonresident: nr ?? r });
  return out;
}

export const LOCALS: LocalDef[] = [...localsFromTables(), ...OTHER];

export function buildLocalJurisdictions(): Jurisdiction[] {
  return LOCALS.map((l) => ({ code: l.code, name: l.name, type: l.type, state: l.state, parent: l.state, attrs: l.attrs, notes: l.notes }));
}

export function buildLocalRules(): TaxRule[] {
  const rules: TaxRule[] = [];
  for (const l of LOCALS) {
    const src = agencySource(`${l.state.toLowerCase()}-local`, `${l.state} local tax administrators`, `${l.state} local income tax rate lists`, LOCAL_RATE_FILES[l.state] ?? '');
    const residentOnly = !!l.attrs?.residentOnly;
    const nonresidentOnly = !!l.attrs?.nonresidentOnly;
    const resCalc = l.calc ?? (l.resident !== undefined ? pct(l.resident) : undefined);
    const nrCalc = l.calc ?? (l.nonresident !== undefined ? pct(l.nonresident) : undefined);
    rules.push({
      id: `${l.code}.${l.kind}.${(l.from ?? '2025-01-01').slice(0, 4)}`,
      jurisdiction: l.code,
      kind: l.kind,
      name: l.name,
      payer: l.payer ?? 'employee',
      wageBasis: 'LOCAL',
      effectiveFrom: l.from ?? '2025-01-01',
      effectiveTo: l.code === 'PA-PHILADELPHIA-PRE' ? '2025-06-30' : undefined,
      status: l.status ?? 'unverified',
      sources: [src.id, 'research-memory-2026'],
      calc: (nonresidentOnly ? nrCalc : resCalc) ?? { kind: 'none' },
      nonresidentCalc: residentOnly ? undefined : nrCalc,
      appliesTo: residentOnly ? 'resident' : nonresidentOnly ? 'work' : 'resident_or_work',
      optional: l.optional,
      notes: [l.notes, l.attrs ? `attrs=${JSON.stringify(l.attrs)}` : undefined].filter(Boolean).join(' '),
    });
  }
  return rules;
}

export const LOCAL_ATTRS = new Map(LOCALS.map((l) => [l.code, l.attrs ?? {}]));

/** Official bulk rate files the importers consume. */
export const LOCAL_RATE_FILES: Record<string, string> = {
  PA: 'https://dced.pa.gov/local-government/local-income-tax-information/psd-codes-and-eit-rates/',
  OH: 'https://tax.ohio.gov/individual/resources/municipal-income-tax-rate-database',
  MI: 'https://www.michigan.gov/taxes/questions/iit/accordion/general/which-cities-levy-an-income-tax',
  MD: 'https://www.marylandtaxes.gov/individual/income/tax-info/tax-rates.php',
  IN: 'https://www.in.gov/dor/files/dn01.pdf',
  KY: 'https://kyclc.org/',
  NY: 'https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nyc.pdf',
  MO: 'https://www.kcmo.gov/city-hall/departments/finance/earnings-tax',
  CO: 'https://tax.colorado.gov/',
  OR: 'https://www.oregon.gov/dor/programs/businesses/Pages/Transit-Taxes.aspx',
  AL: 'https://www.revenue.alabama.gov/',
  DE: 'https://www.wilmingtonde.gov/government/city-departments/finance/wage-tax',
  NJ: 'https://www.newarknj.gov/',
  WV: 'https://tax.wv.gov/',
};
