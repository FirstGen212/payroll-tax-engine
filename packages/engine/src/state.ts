/**
 * State / territory income tax withholding: the generic annualized formula
 * plus custom handlers for states whose formulas do not fit it.
 */
import type { Bracket, ByStatus, CalcSpec, FederalWithholdingParams, FilingStatus, StateFormula } from '@pte/tax-data';
import { bracketTax } from './money.js';
import { computeFederalWithholding } from './federal.js';
import type { FederalW4, StateW4 } from './types.js';

export interface StateContext {
  state: string;
  wages: number; // taxable state wages this period (already allocated)
  supplemental: number; // portion of `wages` that is supplemental
  periods: number;
  w4: StateW4;
  federalW4: FederalW4;
  /** Federal withholding params for the year (mirror-code territories, fed tax deduction). */
  federalParams?: FederalWithholdingParams;
  /** Annualized federal income tax for this employee (AL/OR deduction). */
  annualFederalTax?: number;
  /** Annualized FICA (MA deduction). */
  annualFica?: number;
  hours?: number;
  useFlatSupplemental: boolean;
}

export interface StateComputation {
  amount: number;
  lines: string[];
}

export function statusFor(w4: StateW4, fed: FederalW4): FilingStatus {
  if (w4.filingStatus) return w4.filingStatus;
  return fed.filingStatus === 'mfs' ? 'single' : fed.filingStatus;
}

export function pick<T>(m: ByStatus<T> | undefined, status: FilingStatus): T | undefined {
  if (!m) return undefined;
  const order: (FilingStatus | 'all')[] = [status];
  if (status === 'qss' || status === 'mfj_one_income' || status === 'mfj_two_income') order.push('mfj');
  if (status === 'mfs' || status === 'hoh') order.push('single');
  order.push('all', 'single');
  for (const k of order) if (m[k] !== undefined) return m[k];
  return undefined;
}

export function genericFormula(f: StateFormula, ctx: StateContext): StateComputation {
  const lines: string[] = [];
  const status = statusFor(ctx.w4, ctx.federalW4);
  const allowances = ctx.w4.allowances ?? 0;
  const deps = ctx.w4.dependents ?? 0;
  const regular = ctx.useFlatSupplemental && f.supplementalRate ? ctx.wages - ctx.supplemental : ctx.wages;
  const annual = regular * ctx.periods;
  lines.push(`Annualized state wages ${regular.toFixed(2)} x ${ctx.periods} = ${annual.toFixed(2)} (status ${status})`);
  const noTax = pick(f.noTaxBelow, status);
  let tax = 0;
  if (noTax !== undefined && annual <= noTax) {
    lines.push(`Annual wages at or below ${noTax}: no withholding`);
  } else {
    let taxable = annual;
    const sd = pick(f.standardDeduction, status);
    if (sd !== undefined && !(f.standardDeductionNeedsAllowance && allowances === 0)) {
      let amt = typeof sd === 'number' ? sd : Math.min(sd.max, Math.max(sd.min, annual * sd.pct));
      const phase = pick(f.standardDeductionPhaseOut, status);
      if (phase && annual > phase.start) amt = annual >= phase.end ? 0 : amt * ((phase.end - annual) / (phase.end - phase.start));
      const slide = pick(f.standardDeductionSlide, status);
      if (slide && annual > slide.start) amt = Math.max(0, amt - (annual - slide.start) * slide.rate);
      taxable -= amt;
      lines.push(`Standard deduction -${amt.toFixed(2)}`);
    }
    const pe = pick(f.personalExemption, status);
    if (pe) { taxable -= pe; lines.push(`Personal exemption -${pe}`); }
    const allowanceOff = f.allowanceNoneAbove !== undefined && annual > f.allowanceNoneAbove;
    if (allowanceOff && allowances) lines.push(`Annual wages over ${f.allowanceNoneAbove}: no allowance deduction`);
    if (!allowanceOff) {
      const tier = pick(f.allowanceTiers, status);
      const high = tier ? Math.min(allowances, tier.count) : 0;
      if (high) { taxable -= high * tier!.amount; lines.push(`Allowances ${high} x ${tier!.amount}`); }
      const rest = allowances - high;
      if (f.allowanceDeduction && rest) { taxable -= rest * f.allowanceDeduction; lines.push(`Allowances ${rest} x ${f.allowanceDeduction}`); }
      if (f.allowanceDeduction && ctx.w4.additionalAllowances) { taxable -= ctx.w4.additionalAllowances * f.allowanceDeduction; lines.push(`Additional allowances ${ctx.w4.additionalAllowances} x ${f.allowanceDeduction}`); }
    }
    if (f.dependentDeduction && deps) { taxable -= deps * f.dependentDeduction; lines.push(`Dependents ${deps} x ${f.dependentDeduction}`); }
    if (f.federalTaxDeduction && ctx.annualFederalTax) {
      const cap = pick(f.federalTaxDeduction.cap, status) ?? Infinity;
      const ded = Math.min(cap, ctx.annualFederalTax);
      taxable -= ded;
      lines.push(`Federal tax deduction -${ded.toFixed(2)}`);
    }
    taxable = Math.max(0, taxable);
    const brackets = pick(f.brackets, status) ?? [];
    tax = bracketTax(taxable, brackets);
    lines.push(`Tax on ${taxable.toFixed(2)} = ${tax.toFixed(2)}`);
    let credits = 0;
    if (f.allowanceCredit) credits += allowances * f.allowanceCredit;
    credits += pick(f.personalCredit, status) ?? 0;
    if (f.dependentCredit) credits += deps * f.dependentCredit;
    if (credits) { lines.push(`Credits -${credits.toFixed(2)}`); tax = Math.max(0, tax - credits); }
  }
  let perPeriod = tax / ctx.periods;
  if (ctx.useFlatSupplemental && f.supplementalRate && ctx.supplemental) {
    perPeriod += ctx.supplemental * f.supplementalRate;
    lines.push(`Supplemental flat ${ctx.supplemental.toFixed(2)} x ${f.supplementalRate}`);
  }
  if (f.roundToDollar) perPeriod = Math.round(perPeriod);
  return { amount: perPeriod, lines };
}

type Handler = (params: any, ctx: StateContext) => StateComputation;

const statusKey = (s: FilingStatus) => (s === 'qss' ? 'mfj' : s === 'mfj_one_income' || s === 'mfj_two_income' ? 'mfj' : s);

export const CUSTOM_HANDLERS: Record<string, Handler> = {
  /** Alabama: sliding standard deduction, personal + dependent exemptions, federal tax deduction. */
  AL(p, ctx) {
    const lines: string[] = [];
    const s = statusKey(statusFor(ctx.w4, ctx.federalW4));
    const annual = ctx.wages * ctx.periods;
    const [min, max] = (p.stdDed[s] ?? p.stdDed.single) as [number, number];
    // The deduction drops by a fixed amount for each band of wages at or above the start, down to the minimum.
    const ph = (p.stdDedPhase[s] ?? p.stdDedPhase.single ?? p.stdDedPhase) as { start: number; step: number; drop?: number };
    const bands = annual >= ph.start ? Math.floor((annual - ph.start) / ph.step) + 1 : 0;
    const std = Math.max(min, max - bands * (ph.drop ?? (max - min) / 20));
    const pe = p.personalExemption[s] ?? 1500;
    const deps = ctx.w4.dependents ?? 0;
    // The top tier has no upper limit. It is stored as Infinity, which becomes null once the rule has been through JSON (the database).
    const tiers = p.dependentTiers as [number | null, number][];
    const depAmt = (tiers.find(([lim]) => lim === null || annual <= lim) ?? tiers[tiers.length - 1])[1];
    const fed = ctx.annualFederalTax ?? 0;
    const taxable = Math.max(0, annual - std - pe - deps * depAmt - fed);
    const brackets: Bracket[] = s === 'mfj' ? p.brackets.mfj : p.brackets.single;
    const tax = bracketTax(taxable, brackets);
    lines.push(`AL: annual ${annual.toFixed(2)} - std ${std.toFixed(0)} - exemption ${pe} - deps ${deps}x${depAmt} - FIT ${fed.toFixed(2)} = ${taxable.toFixed(2)}; tax ${tax.toFixed(2)}`);
    return { amount: tax / ctx.periods, lines };
  },

  /** California DE 44 Method B. */
  CA(p, ctx) {
    const lines: string[] = [];
    const st = statusFor(ctx.w4, ctx.federalW4);
    const allowances = ctx.w4.allowances ?? 0;
    const married = st === 'mfj' || st === 'qss';
    const key = st === 'hoh' ? 'hoh' : married ? (allowances >= 2 ? 'mfj_high' : 'mfj_low') : 'single';
    const regular = ctx.useFlatSupplemental ? ctx.wages - ctx.supplemental : ctx.wages;
    const annual = regular * ctx.periods;
    let tax = 0;
    if (annual <= p.lowIncomeExemption[key]) {
      lines.push(`CA: annual ${annual.toFixed(2)} at or below low-income exemption ${p.lowIncomeExemption[key]}`);
    } else {
      const est = (ctx.w4.additionalAllowances ?? 0) * p.estimatedDeductionPerAllowance;
      const std = p.standardDeduction[key];
      const taxable = Math.max(0, annual - est - std);
      const brackets: Bracket[] = st === 'hoh' ? p.brackets.hoh : married ? p.brackets.mfj : p.brackets.single;
      tax = Math.max(0, bracketTax(taxable, brackets) - allowances * p.exemptionCreditPerAllowance);
      lines.push(`CA Method B: ${annual.toFixed(2)} - est. deduction ${est} - std ${std} = ${taxable.toFixed(2)}; tax less ${allowances} x ${p.exemptionCreditPerAllowance} credit = ${tax.toFixed(2)}`);
    }
    let per = tax / ctx.periods;
    if (ctx.useFlatSupplemental && ctx.supplemental) { per += ctx.supplemental * p.supplementalRate; lines.push(`CA supplemental ${p.supplementalRate}`); }
    return { amount: per, lines };
  },

  /** Massachusetts Circular M. */
  MA(p, ctx) {
    const lines: string[] = [];
    const ex = ctx.w4.allowances ?? 0;
    const st = statusFor(ctx.w4, ctx.federalW4);
    const regular = ctx.useFlatSupplemental ? ctx.wages - ctx.supplemental : ctx.wages;
    const annual = regular * ctx.periods;
    const exemptions = ex > 0 ? p.firstExemption + (ex - 1) * p.additionalExemption : 0;
    const fica = Math.min(p.ficaDeductionMax, ctx.annualFica ?? 0);
    const hoh = st === 'hoh' ? p.hohExtra : 0;
    const taxable = Math.max(0, annual - exemptions - fica - hoh);
    let tax = taxable * p.rate;
    if (annual > p.surtaxThreshold) tax += (annual - p.surtaxThreshold) * p.surtaxRate;
    lines.push(`MA: (${annual.toFixed(2)} - exemptions ${exemptions} - FICA ${fica.toFixed(2)} - HoH ${hoh}) x 5% = ${tax.toFixed(2)}`);
    let per = tax / ctx.periods;
    if (ctx.useFlatSupplemental && ctx.supplemental) per += ctx.supplemental * p.supplementalRate;
    return { amount: per, lines };
  },

  /** New Jersey rate tables A-E. */
  NJ(p, ctx) {
    const st = statusFor(ctx.w4, ctx.federalW4);
    const table = ctx.w4.njTable ?? p.statusTable[statusKey(st)] ?? 'A';
    const annual = ctx.wages * ctx.periods;
    const taxable = Math.max(0, annual - (ctx.w4.allowances ?? 0) * p.allowanceDeduction);
    const tax = bracketTax(taxable, p.tables[table]);
    return { amount: tax / ctx.periods, lines: [`NJ table ${table}: tax on ${taxable.toFixed(2)} = ${tax.toFixed(2)}`] };
  },

  /** Connecticut TPG-211: exemption (Table A), tax (B), 2% add-back (C), recapture (D), less the personal tax credit (E). */
  CT(p, ctx) {
    const st = statusFor(ctx.w4, ctx.federalW4);
    const code = ctx.w4.ctCode ?? (st === 'hoh' ? 'B' : st === 'mfs' || st === 'mfj_two_income' ? 'A' : st === 'mfj' || st === 'mfj_one_income' || st === 'qss' ? 'C' : 'F');
    const annual = ctx.wages * ctx.periods;
    const steps = (over: number, step: number) => (over > 0 ? Math.ceil(over / step - 1e-9) : 0);
    const ex = p.exemption[code];
    const exemption = Math.max(0, ex.base - 1000 * steps(annual - ex.start, 1000));
    const taxable = Math.max(0, annual - exemption);
    const lines = [`CT code ${code}: annual ${annual.toFixed(2)} - exemption ${exemption} = ${taxable.toFixed(2)}`];
    if (taxable <= 0) return { amount: 0, lines };
    const initial = bracketTax(taxable, p.brackets[code === 'B' || code === 'C' ? code : 'A']);
    const ab = p.addBack[code];
    const addBack = Math.min(ab.cap, ab.inc * steps(annual - ab.start, ab.step));
    // Recapture tiers are cumulative: each tier starts from the previous tier's cap.
    let recapture = 0;
    let prevCap = 0;
    for (const t of p.recapture[code === 'B' || code === 'C' ? code : 'A']) {
      if (annual > t.start) recapture = Math.min(t.cap, prevCap + t.inc * steps(annual - t.start, t.step));
      prevCap = t.cap;
    }
    let credit = 0;
    if (code !== 'D') {
      const ups: number[] = p.creditUpTo[code];
      const i = ups.findIndex((u) => annual <= u);
      credit = i === -1 ? 0 : p.creditDecimals[i];
    }
    const tax = (initial + addBack + recapture) * (1 - credit);
    lines.push(`CT tax ${initial.toFixed(2)} + add-back ${addBack} + recapture ${recapture} = ${(initial + addBack + recapture).toFixed(2)}, less ${Math.round(credit * 100)}% credit = ${tax.toFixed(2)}`);
    return { amount: tax / ctx.periods, lines };
  },

  /** Utah Pub 14: flat rate less a phased-out allowance credit. */
  UT(p, ctx) {
    const st = statusKey(statusFor(ctx.w4, ctx.federalW4));
    const annual = ctx.wages * ctx.periods;
    const base = p.baseAllowance[st] ?? p.baseAllowance.single;
    const start = p.phaseoutStart[st] ?? p.phaseoutStart.single;
    const credit = Math.max(0, base - Math.max(0, annual - start) * p.phaseoutRate);
    const tax = Math.max(0, annual * p.rate - credit);
    return { amount: tax / ctx.periods, lines: [`UT: ${annual.toFixed(2)} x ${p.rate} - allowance credit ${credit.toFixed(2)} = ${tax.toFixed(2)}`] };
  },

  /** Puerto Rico annualized brackets. */
  PR(p, ctx) {
    const st = statusKey(statusFor(ctx.w4, ctx.federalW4));
    const annual = ctx.wages * ctx.periods;
    const pe = (p.personalExemption?.[st] ?? p.personalExemption?.single ?? 0) as number;
    const allow = (ctx.w4.allowances ?? 0) * (p.allowanceDeduction ?? 0);
    const taxable = Math.max(0, annual - pe - allow - (ctx.w4.dependents ?? 0) * p.dependentDeduction);
    const tax = bracketTax(taxable, p.brackets);
    return { amount: tax / ctx.periods, lines: [`PR: ${annual.toFixed(2)} - exemption ${pe} - allowances ${allow} - dependents = ${taxable.toFixed(2)}; tax ${tax.toFixed(2)}`] };
  },

  /** Oregon: federal tax subtraction (capped, phased out), standard deduction, two tables split by annual wages, credit per allowance. */
  OR(p, ctx) {
    const st = statusFor(ctx.w4, ctx.federalW4);
    const married = st === 'mfj' || st === 'qss' || st === 'mfj_one_income';
    let allowances = ctx.w4.allowances ?? 0;
    const regular = ctx.useFlatSupplemental ? ctx.wages - ctx.supplemental : ctx.wages;
    const annual = regular * ctx.periods;
    const side = married ? 'mfj' : 'single';
    const start = p.federalTaxPhase[side] as number;
    const step = p.federalTaxPhase.step[side] as number;
    const cap = annual >= start ? Math.max(0, p.federalTaxCap - p.federalTaxPhase.reduceBy * (Math.floor((annual - start) / step) + 1)) : p.federalTaxCap;
    const fed = Math.min(cap, Math.max(0, ctx.annualFederalTax ?? 0));
    const table = !married && allowances < 3 ? 'single' : 'other';
    const std = table === 'single' ? p.standardDeduction.singleUnder3 : p.standardDeduction.other;
    const base = Math.max(0, annual - fed - std);
    if (annual > p.allowanceReduction[side]) allowances = Math.max(0, allowances - 1);
    let tax: number;
    if (annual < p.lowWageLimit || base <= p.high[table].floor) tax = (annual < p.lowWageLimit ? p.allowanceCredit : 0) + bracketTax(base, p.low[table]);
    else tax = p.high[table].base + bracketTax(base - p.high[table].floor, p.high[table].brackets);
    tax = Math.max(0, tax - allowances * p.allowanceCredit);
    const lines = [`OR: ${annual.toFixed(2)} - federal tax ${fed.toFixed(2)} (cap ${cap}) - standard deduction ${std} = ${base.toFixed(2)}; tax less ${allowances} x ${p.allowanceCredit} credit = ${tax.toFixed(2)}`];
    let per = tax / ctx.periods;
    if (ctx.useFlatSupplemental && ctx.supplemental) { per += ctx.supplemental * p.supplementalRate; lines.push(`OR supplemental ${p.supplementalRate}`); }
    return { amount: Math.round(per), lines };
  },

  /** Guam, USVI, CNMI (and placeholder American Samoa): withhold using federal Pub 15-T on the federal W-4. */
  MIRROR_FEDERAL(_p, ctx) {
    if (!ctx.federalParams) return { amount: 0, lines: ['No federal parameters for mirror-code computation'] };
    const r = computeFederalWithholding(ctx.wages, ctx.periods, ctx.federalW4, ctx.federalParams);
    return { amount: r.perPeriod, lines: ['Mirror code: federal Pub 15-T computation remitted to territory', ...r.lines] };
  },

  ANNUAL_BRACKETS_ON_GROSS(p, ctx) {
    const annual = ctx.wages * ctx.periods;
    const tax = bracketTax(annual, p.brackets);
    return { amount: tax / ctx.periods, lines: [`Annualized gross ${annual.toFixed(2)} -> ${tax.toFixed(2)}`] };
  },

  PER_HOUR(p, ctx) {
    const h = ctx.hours ?? 0;
    return { amount: h * p.rate, lines: [`${h} hours x ${p.rate}`] };
  },

  /** New York City resident tax (approximation of NYS-50-T-NYC). */
  NYC(p, ctx) {
    const st = statusFor(ctx.w4, ctx.federalW4);
    const married = st === 'mfj' || st === 'qss';
    const annual = ctx.wages * ctx.periods;
    const taxable = Math.max(0, annual - (married ? p.standardDeduction.mfj : p.standardDeduction.single) - (ctx.w4.allowances ?? 0) * p.allowanceDeduction);
    const tax = bracketTax(taxable, p.brackets);
    return { amount: tax / ctx.periods, lines: [`NYC: tax on ${taxable.toFixed(2)} = ${tax.toFixed(2)}`] };
  },
};

export function computeStateCalc(calc: CalcSpec, ctx: StateContext): StateComputation {
  if (ctx.w4.exempt) return { amount: 0, lines: ['Employee claimed exempt on the state certificate'] };
  let r: StateComputation;
  switch (calc.kind) {
    case 'none':
      return { amount: 0, lines: [calc.reason ?? 'No tax'] };
    case 'state_formula':
      r = genericFormula(calc.formula, ctx);
      break;
    case 'elected_percent': {
      const pctRate = ctx.w4.electedPercent ?? calc.default;
      r = { amount: ctx.wages * pctRate, lines: [`Elected ${(pctRate * 100).toFixed(1)}% of ${ctx.wages.toFixed(2)}`] };
      break;
    }
    case 'percent':
      r = { amount: ctx.wages * calc.rate, lines: [`${ctx.wages.toFixed(2)} x ${calc.rate}`] };
      break;
    case 'custom': {
      const h = CUSTOM_HANDLERS[calc.handler];
      if (!h) return { amount: 0, lines: [`Missing handler ${calc.handler}`] };
      r = h(calc.params, ctx);
      break;
    }
    default:
      return { amount: 0, lines: [`Unsupported calc kind ${calc.kind} for income tax`] };
  }
  if (ctx.w4.additional) {
    r.amount += ctx.w4.additional;
    r.lines.push(`Additional state withholding +${ctx.w4.additional}`);
  }
  return r;
}
