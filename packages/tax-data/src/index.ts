import type { Jurisdiction, TaxRule, TaxKind } from './types.js';
import { FEDERAL_JURISDICTION, FEDERAL_RULES } from './federal.js';
import { buildStateJurisdictions, buildStateRules } from './states.js';
import { buildLocalJurisdictions, buildLocalRules } from './locals.js';

export * from './types.js';
export * from './sources.js';
export * from './federal.js';
export * from './states.js';
export * from './locals.js';
export * from './benefits.js';
export * from './section125.js';
export * from './reciprocity.js';
export * from './vendors.js';

/** The full in-memory tax database. The API seeds Postgres from this and reads it back. */
export interface TaxDatabase {
  jurisdictions: Jurisdiction[];
  rules: TaxRule[];
}

let cached: TaxDatabase | undefined;

export function loadTaxDatabase(): TaxDatabase {
  if (!cached) {
    cached = {
      jurisdictions: [FEDERAL_JURISDICTION, ...buildStateJurisdictions(), ...buildLocalJurisdictions()],
      rules: [...FEDERAL_RULES, ...buildStateRules(), ...buildLocalRules()],
    };
  }
  return cached;
}

/** Rules for a jurisdiction and kind effective on a date (latest effectiveFrom wins). */
/** Rules grouped by jurisdiction, built once per rule list (a pay run asks for the same places thousands of times). */
const RULE_INDEX = new WeakMap<TaxRule[], { size: number; by: Map<string, TaxRule[]> }>();
function rulesFor(db: TaxDatabase, jurisdiction: string): TaxRule[] {
  let idx = RULE_INDEX.get(db.rules);
  if (!idx || idx.size !== db.rules.length) {
    const by = new Map<string, TaxRule[]>();
    for (const r of db.rules) {
      const list = by.get(r.jurisdiction);
      if (list) list.push(r);
      else by.set(r.jurisdiction, [r]);
    }
    for (const list of by.values()) list.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    idx = { size: db.rules.length, by };
    RULE_INDEX.set(db.rules, idx);
  }
  return idx.by.get(jurisdiction) ?? [];
}

export function rulesOn(db: TaxDatabase, jurisdiction: string, onDate: string, kind?: TaxKind): TaxRule[] {
  // Keep only the most recent rule per (kind, name) so overlapping open-ended rows resolve to the newest.
  const byKey = new Map<string, TaxRule>();
  for (const r of rulesFor(db, jurisdiction)) {
    if ((kind && r.kind !== kind) || r.effectiveFrom > onDate || (r.effectiveTo && r.effectiveTo < onDate)) continue;
    byKey.set(`${r.kind}|${r.name}`, r);
  }
  return [...byKey.values()];
}

/** First and last tax year with federal withholding tables on file. */
export function coveredYears(db: TaxDatabase): [number, number] {
  const years = rulesFor(db, 'US').filter((r) => r.kind === 'FIT').map((r) => Number(r.effectiveFrom.slice(0, 4)));
  return years.length ? [Math.min(...years), Math.max(...years)] : [0, 0];
}

export function ruleOn(db: TaxDatabase, jurisdiction: string, kind: TaxKind, onDate: string): TaxRule | undefined {
  return rulesOn(db, jurisdiction, onDate, kind).pop();
}
