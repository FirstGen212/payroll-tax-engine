/**
 * Vendor profile learner.
 *
 * Given sample paychecks from a provider (ADP, Paychex, Viventium, ...) where we know
 * the inputs (earnings, deductions, W-4, location, YTD) and the provider's actual tax
 * amounts, search the convention space for the combination that best reproduces the
 * provider's numbers. The result is a learned VendorProfile that simulations can select.
 */
import { CONVENTION_SEARCH_SPACE, IRS_BY_THE_BOOK, loadTaxDatabase } from '@pte/tax-data';
import type { TaxDatabase, VendorConventions, VendorProfile } from '@pte/tax-data';
import { calculatePay } from './calculate.js';
import type { PayInput } from './types.js';

export interface SamplePaycheck {
  /** Reconstructed engine input for the check. */
  input: PayInput;
  /** Provider's actual amounts keyed by `${jurisdiction}.${kind}` (e.g. 'US.FIT', 'NY.SIT', 'US.SS_EE'). */
  actualTaxes: Record<string, number>;
  actualNetPay?: number;
  label?: string;
}

export interface LearnResult {
  vendorId: string;
  best: VendorConventions;
  /** Total absolute difference (dollars) across all samples and matched tax lines. */
  totalError: number;
  exactMatchRate: number;
  /** Per-dimension evidence: error when that dimension takes each value (others at best). */
  evidence: Record<string, Record<string, number>>;
  /** Lines that no convention explains (likely data, setup or rate differences). */
  residuals: { label: string; key: string; expected: number; computed: number; diff: number }[];
  evaluated: number;
}

function* combos(space: typeof CONVENTION_SEARCH_SPACE): Generator<Partial<VendorConventions>> {
  const keys = Object.keys(space) as (keyof VendorConventions)[];
  const rec = function* (i: number, acc: Partial<VendorConventions>): Generator<Partial<VendorConventions>> {
    if (i === keys.length) { yield { ...acc }; return; }
    for (const v of space[keys[i]] as unknown[]) yield* rec(i + 1, { ...acc, [keys[i]]: v });
  };
  yield* rec(0, {});
}

function score(samples: SamplePaycheck[], conv: VendorConventions, db: TaxDatabase) {
  let err = 0;
  let matched = 0;
  let total = 0;
  const rows: LearnResult['residuals'] = [];
  for (const s of samples) {
    const r = calculatePay({ ...s.input, conventions: conv }, db);
    const computed: Record<string, number> = {};
    for (const t of r.taxes) computed[`${t.jurisdiction}.${t.kind}`] = (computed[`${t.jurisdiction}.${t.kind}`] ?? 0) + t.amount;
    for (const [k, expected] of Object.entries(s.actualTaxes)) {
      const c = computed[k] ?? 0;
      const d = Math.abs(c - expected);
      err += d;
      total++;
      if (d < 0.005) matched++;
      else rows.push({ label: s.label ?? s.input.employee.id, key: k, expected, computed: c, diff: Math.round((c - expected) * 100) / 100 });
    }
    if (s.actualNetPay !== undefined) err += Math.abs(r.netPay - s.actualNetPay) * 0.1;
  }
  return { err, rate: total ? matched / total : 0, rows };
}

export function learnVendorProfile(vendorId: string, samples: SamplePaycheck[], db: TaxDatabase = loadTaxDatabase()): LearnResult {
  let best: VendorConventions = IRS_BY_THE_BOOK;
  let bestScore = score(samples, best, db);
  let evaluated = 1;
  const all: { conv: VendorConventions; err: number }[] = [];
  for (const c of combos(CONVENTION_SEARCH_SPACE)) {
    const conv = { ...IRS_BY_THE_BOOK, ...c } as VendorConventions;
    const s = score(samples, conv, db);
    evaluated++;
    all.push({ conv, err: s.err });
    if (s.err < bestScore.err - 1e-9) { best = conv; bestScore = s; }
  }
  // Evidence: for each dimension, the best error achievable with each value.
  const evidence: LearnResult['evidence'] = {};
  for (const dim of Object.keys(CONVENTION_SEARCH_SPACE) as (keyof VendorConventions)[]) {
    evidence[dim] = {};
    for (const v of CONVENTION_SEARCH_SPACE[dim] as string[]) {
      const errs = all.filter((a) => a.conv[dim] === v).map((a) => a.err);
      evidence[dim][v] = Math.round(Math.min(...errs) * 100) / 100;
    }
  }
  return { vendorId, best, totalError: Math.round(bestScore.err * 100) / 100, exactMatchRate: bestScore.rate, evidence, residuals: bestScore.rows, evaluated };
}

export function toLearnedProfile(base: VendorProfile, r: LearnResult, sampleCount: number): VendorProfile {
  return { ...base, status: 'learned', conventions: r.best, sampleCount, notes: `Learned from ${sampleCount} sample checks; exact-match rate ${(r.exactMatchRate * 100).toFixed(1)}%, residual error $${r.totalError}.` };
}

/** Column aliases used to normalize provider register exports into SamplePaycheck rows. */
export const REGISTER_COLUMN_ALIASES: Record<string, string[]> = {
  'US.FIT': ['Federal Income Tax', 'Fed Income Tax', 'FITW', 'Federal W/H', 'FED WH', 'Federal Withholding'],
  'US.SS_EE': ['Social Security', 'OASDI', 'Soc Sec', 'FICA-SS', 'Social Security EE'],
  'US.MED_EE': ['Medicare', 'Medicare EE', 'FICA-MED', 'MED'],
  'US.MED_ADDL_EE': ['Addl Medicare', 'Additional Medicare'],
  SIT: ['State Income Tax', 'State W/H', 'SITW', 'State Tax'],
  LIT: ['Local Tax', 'City Tax', 'Local W/H', 'Local Income Tax'],
  SDI: ['SDI', 'State Disability', 'DBL', 'TDI'],
  PFL: ['PFL', 'FLI', 'Paid Family Leave', 'PFML'],
  NET: ['Net Pay', 'Net', 'Net Check'],
  GROSS: ['Gross Pay', 'Gross', 'Total Gross', 'Gross Earnings'],
};

/** Map one register row (header -> value) to tax amounts using the aliases and a state code. */
export function normalizeRegisterRow(row: Record<string, string | number>, state: string, localCode?: string): { taxes: Record<string, number>; net?: number; gross?: number } {
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$,()\s]/g, '')) || 0);
  const find = (aliases: string[]) => {
    const k = Object.keys(row).find((h) => aliases.some((a) => h.trim().toLowerCase() === a.toLowerCase()));
    return k === undefined ? undefined : Math.abs(num(row[k]));
  };
  const taxes: Record<string, number> = {};
  for (const k of ['US.FIT', 'US.SS_EE', 'US.MED_EE', 'US.MED_ADDL_EE']) {
    const v = find(REGISTER_COLUMN_ALIASES[k]);
    if (v !== undefined) taxes[k] = v;
  }
  const sit = find(REGISTER_COLUMN_ALIASES.SIT);
  if (sit !== undefined) taxes[`${state}.SIT`] = sit;
  const sdi = find(REGISTER_COLUMN_ALIASES.SDI);
  if (sdi !== undefined) taxes[`${state}.SDI_EE`] = sdi;
  const pfl = find(REGISTER_COLUMN_ALIASES.PFL);
  if (pfl !== undefined) taxes[`${state}.FLI_EE`] = pfl;
  const lit = find(REGISTER_COLUMN_ALIASES.LIT);
  if (lit !== undefined && localCode) taxes[`${localCode}.LIT_EE`] = lit;
  return { taxes, net: find(REGISTER_COLUMN_ALIASES.NET), gross: find(REGISTER_COLUMN_ALIASES.GROSS) };
}
