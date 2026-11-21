/** Load the TaxDatabase the engine uses from Postgres, so edits made in the DB/UI take effect immediately. */
import type { Jurisdiction, TaxDatabase, TaxRule } from '@pte/tax-data';
import { loadTaxDatabase } from '@pte/tax-data';
import { q } from './db.js';

let cache: { db: TaxDatabase; at: number } | undefined;

const iso = (d: Date | string | null) => (d == null ? undefined : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));

export async function getTaxDb(force = false): Promise<TaxDatabase> {
  if (cache && !force && Date.now() - cache.at < 60_000) return cache.db;
  const [js, rs, srcs] = await Promise.all([
    q('select * from jurisdiction'),
    q('select * from tax_rule'),
    q('select rule_id, source_id from tax_rule_source'),
  ]);
  if (!rs.length) return loadTaxDatabase();
  const bySrc = new Map<string, string[]>();
  for (const s of srcs) bySrc.set(s.rule_id, [...(bySrc.get(s.rule_id) ?? []), s.source_id]);
  const jurisdictions: Jurisdiction[] = js.map((j) => ({ code: j.code, name: j.name, type: j.type, parent: j.parent_code ?? undefined, state: j.state, fips: j.fips ?? undefined, flags: j.flags, attrs: j.attrs ?? undefined, notes: j.notes ?? undefined }));
  const rules: TaxRule[] = rs.map((r) => ({ id: r.id, jurisdiction: r.jurisdiction, kind: r.kind, name: r.name, payer: r.payer, wageBasis: r.wage_basis, effectiveFrom: iso(r.effective_from)!, effectiveTo: iso(r.effective_to), status: r.status, sources: bySrc.get(r.id) ?? [], calc: r.calc, nonresidentCalc: r.nonresident_calc ?? undefined, appliesTo: r.applies_to ?? undefined, optional: r.optional, notes: r.notes ?? undefined }));
  cache = { db: { jurisdictions, rules }, at: Date.now() };
  return cache.db;
}

export function invalidateTaxDb() { cache = undefined; }
