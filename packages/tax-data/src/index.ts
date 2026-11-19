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
export function rulesOn(db: TaxDatabase, jurisdiction: string, onDate: string, kind?: TaxKind): TaxRule[] {
  const live = db.rules.filter(
    (r) => r.jurisdiction === jurisdiction && (!kind || r.kind === kind) && r.effectiveFrom <= onDate && (!r.effectiveTo || r.effectiveTo >= onDate),
  );
  // Keep only the most recent rule per (kind, name) so overlapping open-ended rows resolve to the newest.
  const byKey = new Map<string, TaxRule>();
  for (const r of live.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) byKey.set(`${r.kind}|${r.name}`, r);
  return [...byKey.values()];
}

export function ruleOn(db: TaxDatabase, jurisdiction: string, kind: TaxKind, onDate: string): TaxRule | undefined {
  return rulesOn(db, jurisdiction, onDate, kind).pop();
}
