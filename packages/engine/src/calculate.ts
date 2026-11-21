/**
 * Paycheck calculation orchestrator.
 *
 * Order of operations (each step is written to the audit trail):
 *  1. Resolve earnings and the year's rules; apply vendor conventions.
 *  2. Compute pre-tax deductions (with annual limits) and taxable wages per basis and state.
 *  3. Federal: FIT (Pub 15-T), Social Security, Medicare, Additional Medicare, FUTA.
 *  4. States: work-state and resident-state income tax with reciprocity, convenience-of-employer
 *     sourcing and resident credit; unemployment, disability, paid leave and other programs
 *     for the localized state.
 *  5. Locals: PA Act 32 EIT and LST, Philadelphia, Ohio municipal + school district with
 *     resident credit, NYC/Yonkers, MD counties, IN counties, MI/KY/MO/AL cities, OPT, transit.
 *  6. Garnishments (CCPA limits) and post-tax deductions; net pay; employer cost.
 */
import {
  CONVENIENCE_OF_EMPLOYER,
  DEDUCTION_TYPES,
  section125BenefitOf,
  section125RuleOf,
  EARNING_TYPES,
  FUTA_CREDIT_REDUCTION,
  IRS_BY_THE_BOOK,
  LOCAL_ATTRS,
  RETIREMENT_SYSTEMS,
  SS_WAGE_BASE,
  findReciprocity,
  limitFor,
  loadTaxDatabase,
  ruleOn,
  coveredYears,
  rulesOn,
} from '@pte/tax-data';
import type { CalcSpec, DeductionType, EarningType, FederalWithholdingParams, Jurisdiction, TaxDatabase, TaxRule, VendorConventions, WageBasis } from '@pte/tax-data';
import { cents, dollars, PERIODS_PER_YEAR, WEEKS_PER_PERIOD, sum } from './money.js';
import { computeFederalWithholding, supplementalFlat } from './federal.js';
import { computeStateCalc, type StateContext } from './state.js';
import type { AuditEntry, DeductionLine, DeductionResult, PayInput, PayResult, StateW4, TaxLine, YearToDate } from './types.js';

const EARN = new Map(EARNING_TYPES.map((e) => [e.code, e]));
const DED = new Map(DEDUCTION_TYPES.map((d) => [d.code, d]));
const RETSYS = new Map(RETIREMENT_SYSTEMS.map((r) => [r.code, r]));

interface ResolvedEarning { type: EarningType; amount: number; hours: number; supplemental: boolean }
interface ResolvedDeduction { type: DeductionType; amount: number; line: DeductionLine; notes: string[] }

const key = (jur: string, kind: string) => `${jur}.${kind}`;

function ageAtYearEnd(birthDate: string | undefined, year: number): number | undefined {
  if (!birthDate) return undefined;
  return year - Number(birthDate.slice(0, 4));
}

/** Jurisdictions by code, built once per list instead of on every paycheck. */
const JUR_INDEX = new WeakMap<Jurisdiction[], { size: number; by: Map<string, Jurisdiction> }>();
function jurisdictionIndex(db: TaxDatabase): Map<string, Jurisdiction> {
  let idx = JUR_INDEX.get(db.jurisdictions);
  if (!idx || idx.size !== db.jurisdictions.length) {
    idx = { size: db.jurisdictions.length, by: new Map(db.jurisdictions.map((j) => [j.code, j])) };
    JUR_INDEX.set(db.jurisdictions, idx);
  }
  return idx.by;
}

export function calculatePay(input: PayInput, db: TaxDatabase = loadTaxDatabase()): PayResult {
  const conv: VendorConventions = { ...IRS_BY_THE_BOOK, ...(input.conventions ?? {}) };
  const date = input.checkDate;
  const year = Number(date.slice(0, 4));
  const periods = PERIODS_PER_YEAR[input.payFrequency];
  const weeks = WEEKS_PER_PERIOD[input.payFrequency];
  const emp = input.employee;
  const er = input.employer;
  const ytd: YearToDate = input.ytd ?? {};
  const ytdW = ytd.taxableWages ?? {};
  const ytdT = ytd.taxes ?? {};
  const audit: AuditEntry[] = [];
  const warnings: string[] = [];
  const taxes: TaxLine[] = [];
  const log = (step: string, detail: string) => audit.push({ step, detail });
  const rnd = (x: number) => cents(x, conv.roundingMode);
  const jurIndex = jurisdictionIndex(db);
  const flagsOf = (code: string) => jurIndex.get(code)?.flags ?? [];

  log('setup', `Check ${date}, ${input.payFrequency} (${periods}/yr), run type ${input.runType ?? 'actual'}, conventions ${input.vendorProfileId ?? 'generic'}`);

  // ---------- 1. Earnings ----------
  const earnings: ResolvedEarning[] = input.earnings.map((l) => {
    let t = EARN.get(l.code);
    if (!t) {
      warnings.push(`Unknown earning code ${l.code}; treated as regular taxable wages.`);
      t = EARN.get('REG')!;
    }
    return { type: t, amount: l.amount, hours: l.hours ?? 0, supplemental: l.supplemental ?? t.supplemental };
  });
  const cashGross = sum(earnings.filter((e) => e.type.cash).map((e) => e.amount));
  const totalComp = sum(earnings.map((e) => e.amount));
  const totalHours = earnings.reduce((a, e) => a + e.hours, 0);
  log('earnings', `Cash gross ${cashGross.toFixed(2)}; total compensation incl. non-cash ${totalComp.toFixed(2)}`);

  // ---------- Toggles ----------
  const isOn = (r: TaxRule): boolean => {
    const k = key(r.jurisdiction, r.kind);
    const e = emp.taxToggles ?? {};
    const c = er.taxToggles ?? {};
    if (e[r.id] !== undefined) return e[r.id];
    if (e[k] !== undefined) return e[k];
    if (c[r.id] !== undefined) return c[r.id];
    if (c[k] !== undefined) return c[k];
    return !r.optional;
  };

  // ---------- 2. Pre-tax and other deductions (amounts) ----------
  const s125Total = () => sum(resolvedDeds.filter((d) => d.type.category === 'section125_health' || d.type.category === 'hsa' || d.type.category === 'fsa' || d.type.category === 'dependent_care').map((d) => d.amount));
  const resolvedDeds: ResolvedDeduction[] = [];
  const dedLines = [...(input.deductions ?? [])]
    .map((l) => ({ l, t: DED.get(l.code) }))
    .filter((x) => {
      if (!x.t) warnings.push(`Unknown deduction code ${x.l.code}; skipped.`);
      return !!x.t;
    })
    .sort((a, b) => {
      const ra = conv.deductionOrder === 'retirement_first' && a.t!.category.startsWith('retirement') ? -1 : 0;
      const rb = conv.deductionOrder === 'retirement_first' && b.t!.category.startsWith('retirement') ? -1 : 0;
      return ra - rb || a.t!.order - b.t!.order;
    });
  const age = ageAtYearEnd(emp.birthDate, year);
  for (const { l, t } of dedLines) {
    const type = t!;
    if (type.category === 'garnishment') continue; // computed after taxes
    const notes: string[] = [];
    let amount = l.amount ?? 0;
    let pctRate = l.percent;
    if (l.retirementSystem) {
      const rs = RETSYS.get(l.retirementSystem);
      if (rs) {
        pctRate = pctRate ?? rs.memberRate;
        notes.push(`${rs.name}: member rate ${(rs.memberRate * 100).toFixed(2)}% (${rs.status})`);
      } else warnings.push(`Unknown retirement system ${l.retirementSystem}`);
    }
    // A retirement system that counts Section 125 reductions as pay (Texas TRS) takes its rate on gross, whatever the vendor's habit.
    const rsCovers125 = l.retirementSystem ? RETSYS.get(l.retirementSystem)?.cafeteriaReductionsCovered === true : false;
    if (pctRate !== undefined) {
      const base = conv.percentDeductionBase === 'gross_less_125' && !rsCovers125 ? cashGross - s125Total() : cashGross;
      amount = rnd(base * pctRate);
      notes.push(`${(pctRate * 100).toFixed(3)}% of ${base.toFixed(2)}`);
    }
    if (type.limitKey) {
      const lim = limitFor(type.limitKey, year);
      if (lim) {
        let cap = lim.amount;
        if (type.catchUpLimitKey && age !== undefined && age >= 50) {
          const superCatch = age >= 60 && age <= 63 ? limitFor('402g_catchup_60_63', year) : undefined;
          const cu = superCatch ?? limitFor(type.catchUpLimitKey, year);
          if (cu) cap += cu.amount;
        }
        if (type.limitKey === 'transit' || type.limitKey === 'parking') cap = (lim.amount * 12) / periods;
        const sameLimitCodes = DEDUCTION_TYPES.filter((d) => d.limitKey === type.limitKey).map((d) => d.code);
        const usedYtd = sum(sameLimitCodes.map((c) => ytd.deductions?.[c] ?? 0)) + sum(resolvedDeds.filter((d) => d.type.limitKey === type.limitKey).map((d) => d.amount));
        const room = Math.max(0, type.limitKey === 'transit' || type.limitKey === 'parking' ? cap : cap - usedYtd);
        if (amount > room) {
          notes.push(`Capped at annual limit ${lim.key} ${cap} (${lim.year}); YTD used ${usedYtd.toFixed(2)}`);
          warnings.push(`${type.name} reduced from ${amount.toFixed(2)} to ${room.toFixed(2)} by the ${lim.year} ${lim.name} limit.`);
          amount = rnd(room);
        }
      }
    }
    resolvedDeds.push({ type, amount, line: l, notes });
  }

  // ---------- Taxable wages ----------
  /**
   * Taxable wages for a basis. State and local bases read overrides keyed by the local jurisdiction code first
   * (one place, e.g. Philadelphia), then by its state. Section 125 treatment by state and place comes from
   * packages/tax-data/src/section125.ts through these overrides.
   */
  const wagesFor = (basis: WageBasis, state?: string, localCode?: string): number => {
    if (basis === 'GROSS') return sum(earnings.filter((e) => Object.values(e.type.taxability).some((v) => v !== false)).map((e) => e.amount));
    let effective: WageBasis = basis;
    if (basis === 'LOCAL' && conv.localWageBasis !== 'local_rules') effective = conv.localWageBasis === 'medicare' ? 'MEDICARE' : conv.localWageBasis === 'state' ? 'SIT' : 'GROSS';
    if (effective === 'GROSS') return wagesFor('GROSS');
    const useState = effective === 'SIT' || effective === 'SUI' || effective === 'SDI' || effective === 'LOCAL';
    const ovOf = (ov: Record<string, Partial<Record<WageBasis, boolean>>> | undefined) =>
      !useState || !ov ? undefined : (localCode ? ov[localCode]?.[effective] : undefined) ?? (state ? ov[state]?.[effective] : undefined);
    const earn = sum(earnings.filter((e) => (ovOf(e.type.stateOverrides) ?? e.type.taxability[effective]) !== false).map((e) => e.amount));
    const red = sum(resolvedDeds.filter((d) => (ovOf(d.type.stateOverrides) ?? d.type.reducesWages[effective]) === true && !d.type.employerPaid).map((d) => d.amount));
    return Math.max(0, earn - red);
  };
  /** Explanation line for a state or local tax when a Section 125 deduction is on the check. */
  const s125Note = (basis: 'SIT' | 'LOCAL' | 'SDI' | 'SUI', state?: string, localCode?: string): string[] => {
    const s125 = resolvedDeds.filter((d) => !d.type.employerPaid && d.amount > 0 && section125BenefitOf(d.type.category));
    if (!s125.length) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const d of s125) {
      const rule = section125RuleOf(section125BenefitOf(d.type.category)!, basis, state, localCode);
      const reduces = rule ? rule.reduces : d.type.reducesWages[basis] === true;
      const k = `${reduces}|${rule?.jurisdiction ?? ''}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const what = s125.filter((x) => { const r = section125RuleOf(section125BenefitOf(x.type.category)!, basis, state, localCode); return (r ? r.reduces : x.type.reducesWages[basis] === true) === reduces; }).map((x) => x.type.name).join(', ');
      out.push(`Section 125: ${what} ${reduces ? 'lowers' : 'does not lower'} the wages for this tax${rule ? ` (${rule.status}${rule.sources.length ? `, ${rule.sources.join(', ')}` : ''})` : ''}`);
    }
    return out;
  };
  const supplementalFor = (basis: WageBasis, state?: string) =>
    sum(earnings.filter((e) => e.supplemental && ((state ? e.type.stateOverrides?.[state]?.[basis] : undefined) ?? e.type.taxability[basis]) !== false).map((e) => e.amount));

  const taxableWages: Record<string, number> = {};
  const ytdAfterWages: Record<string, number> = { ...ytdW };
  const ytdAfterTaxes: Record<string, number> = { ...ytdT };

  /** Generic percent / fixed / custom calculator for non-income-tax rules. */
  const applyRule = (r: TaxRule, wages: number, opts: { share?: number; calc?: CalcSpec; extra?: string[]; context?: Partial<StateContext> } = {}): TaxLine | undefined => {
    const calc = opts.calc ?? r.calc;
    const k = key(r.jurisdiction, r.kind);
    const ytdWages = ytdW[k] ?? 0;
    const ytdTax = ytdT[k] ?? 0;
    const expl: string[] = [...(opts.extra ?? [])];
    let amount = 0;
    let subject = wages;
    if (calc.kind === 'none') return undefined;
    if (calc.kind === 'percent') {
      let rate = calc.rate;
      if (r.kind === 'SUI_ER' && er.suiRates?.[r.jurisdiction] !== undefined) { rate = er.suiRates[r.jurisdiction]; expl.push(`Client SUI rate ${(rate * 100).toFixed(3)}%`); }
      else if (er.rateOverrides?.[k] !== undefined) { rate = er.rateOverrides[k]; expl.push(`Client rate override ${(rate * 100).toFixed(3)}%`); }
      else if (calc.employerRateOverridable) expl.push(`Default/new-employer rate ${(rate * 100).toFixed(3)}% - set the client's assigned rate`);
      const base = calc.wageBase === 'SS' ? SS_WAGE_BASE[year]?.amount ?? SS_WAGE_BASE[2027].amount : calc.wageBase;
      if (base !== undefined) {
        subject = Math.max(0, Math.min(wages, base - ytdWages));
        if (subject < wages) expl.push(`Wage base ${base}: ${subject.toFixed(2)} of ${wages.toFixed(2)} taxable (YTD ${ytdWages.toFixed(2)})`);
      }
      if (calc.threshold !== undefined) {
        subject = Math.max(0, ytdWages + wages - calc.threshold) - Math.max(0, ytdWages - calc.threshold);
        expl.push(`Applies to wages over ${calc.threshold} YTD: ${subject.toFixed(2)}`);
      }
      if (conv.ficaMethod === 'ytd_true_up' && (r.kind === 'SS_EE' || r.kind === 'MED_EE') && base === undefined && calc.threshold === undefined) {
        amount = rnd((ytdWages + subject) * rate) - ytdTax;
        expl.push('YTD true-up method');
      } else if (conv.ficaMethod === 'ytd_true_up' && r.kind === 'SS_EE' && base !== undefined) {
        amount = rnd((Math.min(base, ytdWages + wages)) * rate) - ytdTax;
        expl.push('YTD true-up method');
      } else amount = subject * rate;
      if (opts.share !== undefined) amount *= opts.share;
      if (calc.weeklyMax !== undefined) amount = Math.min(amount, calc.weeklyMax * weeks);
      if (calc.annualMax !== undefined) amount = Math.min(amount, Math.max(0, calc.annualMax - ytdTax));
      expl.push(`${subject.toFixed(2)} x ${(rate * 100).toFixed(4)}%${opts.share !== undefined && opts.share !== 1 ? ` x ${(opts.share * 100).toFixed(1)}% allocation` : ''}`);
    } else if (calc.kind === 'fixed') {
      const share = opts.share ?? 1;
      if (calc.per === 'pay_period') amount = calc.amount;
      else if (calc.per === 'week') amount = calc.amount * weeks;
      else if (calc.per === 'month') {
        const monthlyGross = (wages * periods) / 12;
        if (calc.minEarnings && monthlyGross < calc.minEarnings) { expl.push(`Monthly earnings ~${monthlyGross.toFixed(2)} below ${calc.minEarnings}: not due`); amount = 0; }
        else amount = (calc.amount * 12) / periods;
      } else if (calc.per === 'quarter') amount = (calc.amount * 4) / periods;
      else if (calc.per === 'year') {
        const lowInc = (jurIndex.get(r.jurisdiction)?.attrs ?? LOCAL_ATTRS.get(r.jurisdiction))?.lowIncomeExemption as number | undefined;
        if (lowInc && wages * periods < lowInc) { expl.push(`Annualized earnings below ${lowInc} low-income exemption`); amount = 0; }
        else amount = calc.amount / periods;
      }
      if (calc.annualMax !== undefined) amount = Math.min(amount, Math.max(0, calc.annualMax - ytdTax));
      amount *= share;
      expl.push(`Flat ${calc.amount} per ${calc.per}`);
      subject = wages;
    } else if (calc.kind === 'custom' || calc.kind === 'state_formula' || calc.kind === 'elected_percent') {
      const ctx: StateContext = { state: r.jurisdiction, wages, supplemental: 0, periods, w4: {}, federalW4: emp.federalW4, hours: totalHours, useFlatSupplemental: false, ...(opts.context ?? {}) };
      const res = computeStateCalc(calc, ctx);
      amount = res.amount * (opts.share ?? 1);
      expl.push(...res.lines);
    } else return undefined;
    amount = rnd(Math.max(0, amount));
    const line: TaxLine = { ruleId: r.id, jurisdiction: r.jurisdiction, kind: r.kind, name: r.name, payer: r.payer, wageBasis: r.wageBasis, taxableWages: rnd(subject * (opts.share ?? 1)), amount, rate: subject > 0 ? amount / (subject * (opts.share ?? 1)) : undefined, status: r.status, sources: r.sources, explanation: expl };
    return line;
  };

  const push = (line: TaxLine | undefined, wagesForYtd?: number) => {
    if (!line) return;
    // Thresholded taxes not yet reached (e.g. Additional Medicare under $200k) are not shown as lines.
    if (line.amount === 0 && line.taxableWages === 0 && line.kind === 'MED_ADDL_EE') return;
    taxes.push(line);
    const k = key(line.jurisdiction, line.kind);
    taxableWages[k] = (taxableWages[k] ?? 0) + line.taxableWages;
    ytdAfterWages[k] = (ytdAfterWages[k] ?? 0) + (wagesForYtd ?? line.taxableWages);
    ytdAfterTaxes[k] = (ytdAfterTaxes[k] ?? 0) + line.amount;
  };

  // ---------- Jurisdiction picture ----------
  const residence = emp.residence.state;
  let allocations = emp.work.length ? emp.work : [{ state: residence, percent: 1, localCodes: emp.residence.localCodes }];
  const allocSum = allocations.reduce((a, w) => a + w.percent, 0);
  if (Math.abs(allocSum - 1) > 0.0001) warnings.push(`Work allocations sum to ${(allocSum * 100).toFixed(2)}%, not 100%; amounts are scaled.`);
  allocations = allocations.map((a) => ({ ...a, percent: a.percent / (allocSum || 1) }));
  // Convenience of employer sourcing
  allocations = allocations.map((a) => {
    if (a.remoteForConvenience && er.homeState && a.state !== er.homeState && (CONVENIENCE_OF_EMPLOYER as readonly string[]).includes(er.homeState)) {
      log('multi-state', `${a.label ?? a.state} remote work for employee convenience sourced to ${er.homeState} (convenience-of-employer rule)`);
      return { ...a, state: er.homeState };
    }
    return a;
  });
  const workStates = new Map<string, number>();
  for (const a of allocations) workStates.set(a.state, (workStates.get(a.state) ?? 0) + a.percent);
  const uiState = emp.unemploymentState ?? [...workStates.entries()].sort((a, b) => b[1] - a[1])[0][0];
  log('multi-state', `Resident ${residence}; work ${[...workStates.entries()].map(([s, p]) => `${s} ${(p * 100).toFixed(1)}%`).join(', ')}; unemployment state ${uiState}`);

  // ---------- 3. Federal ----------
  const fitRule = ruleOn(db, 'US', 'FIT', date);
  if (!fitRule) {
    const [first, last] = coveredYears(db);
    warnings.push(`No federal tax tables are on file for ${date.slice(0, 4)}: the data covers ${first} to ${last}. Federal, state and local taxes for this check are missing or incomplete.`);
  }
  const fedParams = fitRule?.calc.kind === 'federal_withholding' ? (fitRule.calc.params as FederalWithholdingParams) : undefined;
  const allTerritoryReplaced = flagsOf(residence).includes('fit_replaced_by_territory_tax') && [...workStates.keys()].every((s) => flagsOf(s).includes('fit_replaced_by_territory_tax'));
  const fitWages = wagesFor('FIT');
  let fitPerPeriodRegular = 0;
  if (fitRule && fedParams && isOn(fitRule) && !allTerritoryReplaced) {
    const supp = Math.min(fitWages, supplementalFor('FIT'));
    const regular = fitWages - supp;
    const expl: string[] = [];
    let amount = 0;
    if (emp.federalW4.exempt) {
      expl.push('Exempt from federal income tax withholding (W-4)');
    } else if (supp > 0 && (conv.supplementalWithRegular === 'flat_separate' || regular === 0) && conv.supplementalMethod === 'flat') {
      const reg = regular > 0 ? computeFederalWithholding(regular, periods, { ...emp.federalW4, extraWithholding: 0 }, fedParams) : undefined;
      const fl = supplementalFlat(supp, ytd.supplementalWages ?? 0, fedParams);
      fitPerPeriodRegular = reg?.afterCredits ?? 0;
      let regAmt = reg?.afterCredits ?? 0;
      if (conv.fitRounding === 'dollar') regAmt = dollars(regAmt, conv.roundingMode);
      amount = regAmt + fl.tax;
      expl.push(...(reg?.lines ?? []), fl.line);
    } else {
      const r = computeFederalWithholding(fitWages, periods, { ...emp.federalW4, extraWithholding: 0 }, fedParams);
      fitPerPeriodRegular = r.afterCredits;
      amount = conv.fitRounding === 'dollar' ? dollars(r.afterCredits, conv.roundingMode) : r.afterCredits;
      expl.push(...r.lines);
      if (supp > 0) expl.push('Supplemental wages aggregated with regular wages (aggregate method)');
    }
    const extra = emp.federalW4.exempt ? 0 : emp.federalW4.extraWithholding ?? 0;
    if (conv.extraWithholdingTiming === 'before_rounding' && conv.fitRounding === 'dollar') amount = dollars(amount + extra, conv.roundingMode);
    else amount = amount + extra;
    if (extra) expl.push(`Step 4(c) extra +${extra}`);
    amount = rnd(Math.max(0, amount));
    push({ ruleId: fitRule.id, jurisdiction: 'US', kind: 'FIT', name: fitRule.name, payer: 'employee', wageBasis: 'FIT', taxableWages: rnd(fitWages), amount, rate: fitWages ? amount / fitWages : undefined, status: fitRule.status, sources: fitRule.sources, explanation: expl }, fitWages);
  } else {
    taxableWages['US.FIT'] = rnd(fitWages);
  }
  if (allTerritoryReplaced) {
    log('federal', `Federal income tax not withheld: ${residence} territory income tax applies instead (see territory line).`);
  }

  const ssCovered = emp.socialSecurityCovered !== false;
  const medCovered = emp.medicareCovered !== false;
  const ficaW = wagesFor('FICA');
  const medW = wagesFor('MEDICARE');
  for (const kind of ['SS_EE', 'SS_ER', 'MED_EE', 'MED_ER', 'MED_ADDL_EE'] as const) {
    const r = ruleOn(db, 'US', kind, date);
    if (!r || !isOn(r)) continue;
    if (kind.startsWith('SS') && !ssCovered) { log('federal', 'Not covered by Social Security (e.g. non-Section 218 public employer): SS skipped'); continue; }
    if (kind.startsWith('MED') && !medCovered) continue;
    const w = kind.startsWith('SS') ? ficaW : medW;
    push(applyRule(r, w), w);
  }
  // FUTA
  const futaRule = ruleOn(db, 'US', 'FUTA', date);
  const uiFlags = flagsOf(uiState);
  if (futaRule && isOn(futaRule) && !er.futaExempt && (jurIndex.get(uiState)?.type !== 'territory' || uiFlags.includes('futa_applies'))) {
    const cr = FUTA_CREDIT_REDUCTION[year]?.rates[uiState] ?? 0;
    const calc: CalcSpec = futaRule.calc.kind === 'percent' ? { ...futaRule.calc, rate: futaRule.calc.rate + cr } : futaRule.calc;
    const extra = cr ? [`Credit reduction ${uiState} +${(cr * 100).toFixed(1)}% (${FUTA_CREDIT_REDUCTION[year]?.status})`] : [];
    const w = wagesFor('FUTA');
    push(applyRule(futaRule, w, { calc, extra }), w);
  } else if (er.futaExempt) log('federal', 'Employer is FUTA-exempt (e.g. 501(c)(3) or government)');

  // ---------- 4. State income tax ----------
  const fedTaxAnnual = fitPerPeriodRegular * periods;
  const ficaAnnual = (ficaW * 0.062 + medW * 0.0145) * periods;
  const sitFor = (state: string, share: number, role: string): TaxLine | undefined => {
    const r = ruleOn(db, state, 'SIT', date);
    if (!r || !isOn(r) || r.calc.kind === 'none') return undefined;
    const w4: StateW4 = emp.stateW4?.[state] ?? {};
    if (!emp.stateW4?.[state] && !(r.calc.kind === 'custom' && r.calc.handler === 'MIRROR_FEDERAL')) warnings.push(`No ${state} withholding certificate on file; using defaults (status from federal W-4, 0 allowances).`);
    const wages = wagesFor('SIT', state);
    const ctx: StateContext = { state, wages, supplemental: Math.min(wages, supplementalFor('SIT', state)), periods, w4, federalW4: emp.federalW4, federalParams: fedParams, annualFederalTax: fedTaxAnnual, annualFica: ficaAnnual, hours: totalHours, useFlatSupplemental: conv.supplementalWithRegular === 'flat_separate' };
    const res = computeStateCalc(r.calc, ctx);
    let amount = res.amount * share;
    if (conv.sitRounding === 'dollar') amount = dollars(amount, conv.roundingMode);
    amount = rnd(Math.max(0, amount));
    return { ruleId: r.id, jurisdiction: state, kind: 'SIT', name: r.name, payer: 'employee', wageBasis: 'SIT', taxableWages: rnd(wages * share), amount, rate: wages ? amount / (wages * share) : undefined, status: r.status, sources: r.sources, explanation: [`${role}${share < 1 ? ` (allocation ${(share * 100).toFixed(1)}%, proportional method)` : ''}`, ...res.lines, ...s125Note('SIT', state)] };
  };
  const workTaxByState = new Map<string, number>();
  for (const [ws, share] of workStates) {
    if (ws === residence) continue;
    const recip = findReciprocity(ws, residence, date);
    if (recip) {
      if (emp.stateW4?.[ws]?.reciprocityCertificate !== false) {
        log('multi-state', `Reciprocity: ${residence} resident working in ${ws} (form ${recip.form}); ${ws} tax not withheld, resident state withholds.`);
        if (emp.stateW4?.[ws]?.reciprocityCertificate === undefined) warnings.push(`Reciprocity ${ws}/${residence} applied; confirm the employee filed ${recip.form}.`);
        continue;
      }
    }
    const line = sitFor(ws, share, `Nonresident working in ${ws}`);
    if (line) { push(line); workTaxByState.set(ws, line.amount); }
  }
  const resLine = sitFor(residence, 1, `Resident of ${residence}`);
  if (resLine) {
    const credit = sum([...workTaxByState.values()]);
    if (credit > 0) {
      // Credit cannot exceed what the resident state would have charged on that share.
      const nonResShare = sum([...workStates.entries()].filter(([s]) => s !== residence && workTaxByState.has(s)).map(([, p]) => p));
      const cap = resLine.amount * nonResShare;
      const applied = Math.min(credit, cap);
      resLine.explanation.push(`Resident credit for other-state tax withheld: -${applied.toFixed(2)} (limited to ${cap.toFixed(2)})`);
      resLine.amount = rnd(Math.max(0, resLine.amount - applied));
    }
    push(resLine);
  }

  // ---------- State programs for the unemployment state ----------
  const programKinds = new Set(['SUI_ER', 'SUI_EE', 'SUI_ER_SURCHARGE', 'SDI_EE', 'SDI_ER', 'FLI_EE', 'FLI_ER', 'PFML_EE', 'PFML_ER', 'LTC_EE', 'WC_EE', 'WC_ER', 'TRANSIT_EE', 'WORKFORCE_ER', 'STATE_PAYROLL_ER', 'TERR_SDI_EE', 'TERR_SDI_ER', 'TERR_DRIVER_EE', 'TERR_DRIVER_ER', 'TERR_WAGE_EE']);
  for (const r of rulesOn(db, uiState, date)) {
    if (!programKinds.has(r.kind)) continue;
    if (!isOn(r)) { log('toggles', `${r.name} is switched off (optional or toggled)`); continue; }
    const w = wagesFor(r.wageBasis, uiState);
    const b = r.wageBasis;
    push(applyRule(r, w, { extra: b === 'SDI' || b === 'SUI' || b === 'SIT' ? s125Note(b, uiState) : [] }), w);
  }
  // Oregon statewide transit also applies to OR residents working elsewhere
  if (residence === 'OR' && uiState !== 'OR') {
    const r = rulesOn(db, 'OR', date, 'TRANSIT_EE')[0];
    if (r && isOn(r)) push(applyRule(r, wagesFor(r.wageBasis, 'OR'), { extra: ['Oregon resident working outside Oregon', ...s125Note('SIT', 'OR')] }));
  }

  // ---------- 5. Locals ----------
  const resLocals = new Set(emp.residence.localCodes ?? []);
  const workLocals = new Map<string, number>();
  for (const a of allocations) for (const c of a.localCodes ?? []) workLocals.set(c, (workLocals.get(c) ?? 0) + a.percent);
  // Work-location (nonresident) localities first so resident credits can see their tax.
  const allLocal = new Set([...[...workLocals.keys()].filter((c) => !resLocals.has(c)), ...resLocals, ...workLocals.keys()]);
  const localTax: TaxLine[] = [];
  const attrsOf = (c: string) => (jurIndex.get(c)?.attrs ?? LOCAL_ATTRS.get(c) ?? {}) as Record<string, any>;
  const stateOfLocal = (c: string) => jurIndex.get(c)?.state ?? c.slice(0, 2);
  const nySit = () => taxes.find((t) => t.jurisdiction === 'NY' && t.kind === 'SIT');

  // PA Act 32 EIT: higher of resident total rate or work-location nonresident rate
  const paRes = [...resLocals].find((c) => attrsOf(c).act32 && !c.endsWith('-LST'));
  const paWork = [...workLocals.entries()].filter(([c]) => attrsOf(c).act32 && !c.endsWith('-LST'));
  const paHandled = new Set<string>();
  if (paRes || paWork.length) {
    const wages = wagesFor('LOCAL', 'PA');
    const resRule = paRes ? rulesOn(db, paRes, date).find((r) => r.kind === 'LIT_EE') : undefined;
    const resRate = resRule?.calc.kind === 'percent' ? resRule.calc.rate : 0;
    const paShare = sum([...workStates.entries()].filter(([s]) => s === 'PA').map(([, p]) => p));
    const covered = sum(paWork.map(([, p]) => p));
    const pieces: { code: string; share: number; rate: number; why: string }[] = [];
    for (const [wc, share] of paWork) {
      const wr = rulesOn(db, wc, date).find((r) => r.kind === 'LIT_EE');
      const nr = wr?.nonresidentCalc?.kind === 'percent' ? wr.nonresidentCalc.rate : 0;
      const isResident = wc === paRes;
      const rate = isResident ? resRate : Math.max(resRate, nr);
      pieces.push({ code: wc, share, rate, why: isResident ? 'resident and work PSD' : `max(resident ${(resRate * 100).toFixed(3)}%, work NR ${(nr * 100).toFixed(3)}%)` });
    }
    if (paRes && 1 - covered > 0.0001) pieces.push({ code: paRes, share: 1 - covered, rate: resRate, why: `resident rate on wages earned outside a PA PSD${paShare < 1 ? ' (resident EIT applies to all earned income)' : ''}` });
    for (const pc of pieces) {
      const rule = resRule ?? rulesOn(db, pc.code, date).find((r) => r.kind === 'LIT_EE');
      if (!rule || !isOn(rule)) continue;
      const amount = rnd(wages * pc.share * pc.rate);
      const line: TaxLine = { ruleId: rule.id, jurisdiction: paRes ?? pc.code, kind: 'LIT_EE', name: `PA local earned income tax (Act 32)${pc.code !== paRes ? ` - work PSD ${pc.code}` : ''}`, payer: 'employee', wageBasis: 'LOCAL', taxableWages: rnd(wages * pc.share), amount, rate: pc.rate, status: rule.status, sources: rule.sources, explanation: [`Act 32: ${pc.why}`, `${(wages * pc.share).toFixed(2)} x ${(pc.rate * 100).toFixed(3)}%`, ...s125Note('LOCAL', 'PA')] };
      push(line);
    }
    if (paRes) paHandled.add(paRes);
    for (const [c] of paWork) paHandled.add(c);
  }

  // Indiana: county of residence on Jan 1 controls for residents
  const inResCounty = [...resLocals].find((c) => attrsOf(c).residenceAsOfJan1);

  for (const code of allLocal) {
    if (paHandled.has(code)) continue;
    const a = attrsOf(code);
    const lstate = stateOfLocal(code);
    const isRes = resLocals.has(code);
    const workShare = workLocals.get(code) ?? 0;
    for (const r of rulesOn(db, code, date)) {
      if (!isOn(r)) { log('toggles', `${r.name} switched off`); continue; }
      const wages = wagesFor('LOCAL', lstate, code);
      const note = s125Note('LOCAL', lstate, code);
      if (r.kind === 'LST_EE' || r.kind === 'OPT_EE' || r.kind === 'OPT_ER') {
        if (workShare > 0) push(applyRule(r, wages));
        continue;
      }
      if (a.residenceAsOfJan1) {
        if (inResCounty && code !== inResCounty) continue; // IN resident: only resident county
        const share = code === inResCounty ? 1 : workShare;
        push(applyRule(r, wages, { share, extra: [code === inResCounty ? 'Indiana county of residence (Jan 1)' : 'Nonresident of Indiana: county of principal employment', ...note] }));
        continue;
      }
      if (r.appliesTo === 'resident' && !isRes) continue;
      if (a.nonresidentOnly && (isRes || workShare === 0)) continue;
      if (a.residentOnly || r.appliesTo === 'resident') {
        if (r.calc.kind === 'custom' && r.calc.handler === 'PCT_OF_STATE') {
          const ny = nySit();
          const pctOf = (r.calc.params as any).pct as number;
          if (ny) push({ ruleId: r.id, jurisdiction: code, kind: r.kind, name: r.name, payer: r.payer, wageBasis: 'LOCAL', taxableWages: ny.taxableWages, amount: rnd(ny.amount * pctOf), status: r.status, sources: r.sources, explanation: [`${(pctOf * 100).toFixed(2)}% of NYS withholding ${ny.amount.toFixed(2)}`] });
          continue;
        }
        const nyW4 = lstate === 'NY' ? emp.stateW4?.NY ?? {} : {};
        push(applyRule(r, wages, { context: { w4: nyW4 }, extra: note }));
        continue;
      }
      if (r.payer === 'employer') {
        if (workShare > 0) push(applyRule(r, wages, { share: workShare, extra: note }));
        continue;
      }
      // Generic resident / nonresident local income tax (OH, MI, KY, MO, AL, DE, ...)
      if (workShare > 0 && !isRes) {
        const line = applyRule(r, wages, { share: workShare, calc: r.nonresidentCalc ?? r.calc, extra: ['Nonresident working here', ...note] });
        if (line) { push(line); localTax.push(line); }
      }
      if (isRes) {
        if (workShare === 0 && lstate === 'OH' && er.withholdResidentLocal === false) { log('locals', `${r.name}: employer does not courtesy-withhold resident city tax`); continue; }
        const line = applyRule(r, wages, { extra: [workShare > 0 ? 'Resident (works here too)' : 'Resident', ...note] });
        if (line) {
          // Resident credit for other-city tax withheld (OH style credit percent and rate limit)
          const others = localTax.filter((t) => t.jurisdiction !== code && stateOfLocal(t.jurisdiction) === lstate);
          if (others.length && a.residentCreditPct) {
            const limitRate = (a.residentCreditLimit ?? 100) / 100;
            const credit = sum(others.map((t) => Math.min(t.amount, t.taxableWages * limitRate))) * (a.residentCreditPct / 100);
            const capped = Math.min(credit, line.amount);
            line.explanation.push(`Resident credit for work-city tax: -${capped.toFixed(2)}`);
            line.amount = rnd(line.amount - capped);
          }
          push(line);
        }
      }
    }
  }
  // Maryland special nonresident tax
  if (workStates.has('MD') && residence !== 'MD' && !findReciprocity('MD', residence, date)) {
    const r = rulesOn(db, 'MD-NONRESIDENT', date)[0];
    if (r && isOn(r)) push(applyRule(r, wagesFor('LOCAL', 'MD', 'MD-NONRESIDENT'), { share: workStates.get('MD'), calc: r.nonresidentCalc ?? r.calc, extra: ['Nonresident working in Maryland', ...s125Note('LOCAL', 'MD')] }));
  }

  // ---------- 6. Garnishments and post-tax deductions ----------
  const eeTaxes = rnd(sum(taxes.filter((t) => t.payer === 'employee').map((t) => t.amount)));
  const erTaxes = rnd(sum(taxes.filter((t) => t.payer === 'employer').map((t) => t.amount)));
  const mandatory = sum(resolvedDeds.filter((d) => d.type.category === 'retirement_pickup').map((d) => d.amount));
  const disposable = Math.max(0, cashGross - eeTaxes - mandatory);
  log('garnishment', `Disposable earnings ${disposable.toFixed(2)} = cash gross - employee taxes - mandatory retirement`);
  let garnished = 0;
  let supportTaken = 0;
  const garnResults: ResolvedDeduction[] = [];
  const minWageFloor = 30 * 7.25 * weeks;
  for (const { l, t } of dedLines.filter((x) => x.t!.category === 'garnishment')) {
    const type = t!;
    const g = l.garnishment ?? {};
    const notes: string[] = [];
    let requested = l.amount ?? (l.percent ? disposable * l.percent : Infinity);
    let limit = Infinity;
    switch (type.code) {
      case 'GARN_CHILD_SUPPORT': {
        const pctMax = (g.supportsOtherFamily ? 0.5 : 0.6) + (g.arrearsOver12Weeks ? 0.05 : 0);
        limit = disposable * pctMax - supportTaken;
        notes.push(`CCPA support limit ${(pctMax * 100).toFixed(0)}% of disposable`);
        break;
      }
      case 'GARN_FED_LEVY': {
        const fs = g.levyFilingStatus ?? 'single';
        const std = fedParams?.standardDeduction[fs] ?? 16600;
        const exempt = (std + (g.levyDependents ?? 0) * (fedParams?.allowanceValue ?? 4300)) / periods;
        const takeHome = cashGross - eeTaxes - sum(resolvedDeds.filter((d) => !d.type.employerPaid).map((d) => d.amount)) - garnished;
        limit = Math.max(0, takeHome - exempt);
        if (requested === Infinity) requested = limit;
        notes.push(`Pub 1494 exempt amount ~${exempt.toFixed(2)} (std deduction ${std} + dependents); verify against current Pub 1494 table`);
        break;
      }
      case 'GARN_STUDENT_LOAN':
        limit = disposable * 0.15;
        notes.push('AWG limit 15% of disposable');
        break;
      case 'GARN_CREDITOR': {
        const pctMax = g.maxPercentOverride ?? 0.25;
        limit = Math.max(0, Math.min(disposable * pctMax, disposable - minWageFloor) - garnished);
        notes.push(`CCPA creditor limit: lesser of ${(pctMax * 100).toFixed(0)}% of disposable or disposable over 30x federal minimum wage; reduced by prior garnishments`);
        break;
      }
      default:
        limit = Math.max(0, disposable - garnished);
    }
    let amount = Math.max(0, Math.min(requested, limit, g.balance ?? Infinity, Math.max(0, disposable - garnished)));
    if (amount < requested && requested !== Infinity) warnings.push(`${type.name} limited to ${amount.toFixed(2)} (requested ${requested.toFixed(2)}).`);
    amount = rnd(amount);
    garnished += amount;
    if (type.code === 'GARN_CHILD_SUPPORT') supportTaken += amount;
    garnResults.push({ type, amount, line: l, notes });
  }

  const allDeds = [...resolvedDeds, ...garnResults].sort((a, b) => a.type.order - b.type.order);
  let remaining = cashGross - eeTaxes;
  const deductionResults: DeductionResult[] = [];
  for (const d of allDeds) {
    if (d.type.employerPaid) {
      deductionResults.push({ code: d.type.code, name: d.type.name, amount: d.amount, employerPaid: true, preTax: false, notes: d.notes });
      continue;
    }
    let amt = d.amount;
    if (amt > remaining) {
      warnings.push(`${d.type.name}: insufficient net pay; took ${Math.max(0, remaining).toFixed(2)} of ${amt.toFixed(2)}.`);
      amt = rnd(Math.max(0, remaining));
    }
    remaining -= amt;
    const preTax = Object.values(d.type.reducesWages).some(Boolean);
    deductionResults.push({ code: d.type.code, name: d.type.name, amount: amt, employerPaid: false, preTax, notes: d.notes });
  }
  const eeDeds = sum(deductionResults.filter((d) => !d.employerPaid).map((d) => d.amount));
  const erContrib = sum(deductionResults.filter((d) => d.employerPaid).map((d) => d.amount));
  const netPay = rnd(cashGross - eeTaxes - eeDeds);
  if (netPay < 0) warnings.push('Net pay is negative.');

  // Verification warnings (once per status class)
  const unverified = taxes.filter((t) => t.amount > 0 && (t.status === 'unverified' || t.status === 'placeholder' || t.status === 'projected'));
  if (unverified.length) warnings.push(`${unverified.length} tax line(s) use data not yet verified against the agency source: ${unverified.map((t) => `${t.jurisdiction} ${t.kind} (${t.status})`).join(', ')}.`);

  const ytdDeds: Record<string, number> = { ...(ytd.deductions ?? {}) };
  for (const d of deductionResults) ytdDeds[d.code] = rnd((ytdDeds[d.code] ?? 0) + d.amount);

  return {
    checkDate: date,
    employeeId: emp.id,
    grossPay: rnd(cashGross),
    grossTaxableComp: rnd(totalComp),
    earnings: earnings.map((e) => ({ code: e.type.code, name: e.type.name, amount: e.amount, cash: e.type.cash, supplemental: e.supplemental })),
    taxableWages: Object.fromEntries(Object.entries(taxableWages).map(([k, v]) => [k, rnd(v)])),
    taxes,
    employeeTaxes: eeTaxes,
    employerTaxes: erTaxes,
    deductions: deductionResults,
    netPay,
    employerCost: rnd(cashGross + erTaxes + erContrib),
    warnings,
    audit,
    ytdAfter: {
      taxableWages: Object.fromEntries(Object.entries(ytdAfterWages).map(([k, v]) => [k, rnd(v)])),
      taxes: Object.fromEntries(Object.entries(ytdAfterTaxes).map(([k, v]) => [k, rnd(v)])),
      supplementalWages: rnd((ytd.supplementalWages ?? 0) + supplementalFor('FIT')),
      deductions: ytdDeds,
    },
    conventions: conv,
  };
}

