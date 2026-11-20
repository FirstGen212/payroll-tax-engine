/**
 * Seed (or refresh) the reference tax database from @pte/tax-data.
 * Upserts are idempotent; existing client data is untouched. Rule changes are logged to tax_rule_history.
 */
import { BENEFIT_LIMITS, DEDUCTION_TYPES, EARNING_TYPES, LOCAL_ATTRS, RECIPROCITY, RETIREMENT_SYSTEMS, SOURCES, VENDOR_PROFILES, loadTaxDatabase } from '@pte/tax-data';
import { pool, tx } from './db.js';
import { migrate } from './migrate.js';
import { seedMultiples } from './proposals/multiples.js';

export async function seed() {
  await migrate();
  const db = loadTaxDatabase();
  await tx(async (c) => {
    for (const s of SOURCES) await c.query('insert into tax_source(id,agency,title,url,retrieved,notes) values($1,$2,$3,$4,$5,$6) on conflict(id) do update set agency=excluded.agency,title=excluded.title,url=excluded.url,retrieved=excluded.retrieved,notes=excluded.notes', [s.id, s.agency, s.title, s.url, s.retrieved ?? null, s.notes ?? null]);
    // parents first
    const order = ['federal', 'state', 'district', 'territory', 'county', 'city', 'township', 'school_district', 'psd', 'transit_district', 'special_district'];
    const js = [...db.jurisdictions].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    for (const j of js) await c.query('insert into jurisdiction(code,name,type,parent_code,state,fips,flags,attrs,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(code) do update set name=excluded.name,type=excluded.type,parent_code=excluded.parent_code,state=excluded.state,fips=excluded.fips,flags=excluded.flags,attrs=excluded.attrs,notes=excluded.notes', [j.code, j.name, j.type, j.parent ?? null, j.state, j.fips ?? null, j.flags ?? [], j.attrs ?? LOCAL_ATTRS.get(j.code) ?? {}, j.notes ?? null]);
    // Rules go in as one statement. A rule a person has edited in the app keeps their edit: only rows last written by the seed are refreshed.
    const existing = new Map((await c.query('select id, calc, status, nonresident_calc, updated_by from tax_rule')).rows.map((r) => [r.id as string, r]));
    const mine = (id: string) => { const e = existing.get(id); return !e || e.updated_by === null || e.updated_by === 'seed'; };
    const rows = db.rules.filter((r) => mine(r.id)).map((r) => ({ id: r.id, jurisdiction: r.jurisdiction, kind: r.kind, name: r.name, payer: r.payer, wage_basis: r.wageBasis, effective_from: r.effectiveFrom, effective_to: r.effectiveTo ?? null, status: r.status, calc: r.calc, nonresident_calc: r.nonresidentCalc ?? null, applies_to: r.appliesTo ?? null, optional: !!r.optional, notes: r.notes ?? null }));
    const history: { rule_id: string; before: unknown; after: unknown }[] = [];
    for (const r of rows) {
      const prev = existing.get(r.id);
      const after = { calc: r.calc, status: r.status, nonresident_calc: r.nonresident_calc };
      if (!prev || JSON.stringify({ calc: prev.calc, status: prev.status, nonresident_calc: prev.nonresident_calc }) !== JSON.stringify(JSON.parse(JSON.stringify(after))))
        history.push({ rule_id: r.id, before: prev ? { calc: prev.calc, status: prev.status, nonresident_calc: prev.nonresident_calc } : null, after });
    }
    await c.query(`insert into tax_rule(id,jurisdiction,kind,name,payer,wage_basis,effective_from,effective_to,status,calc,nonresident_calc,applies_to,optional,notes,updated_by)
      select id,jurisdiction,kind,name,payer,wage_basis,effective_from,effective_to,status,calc,nonresident_calc,applies_to,optional,notes,'seed'
      from jsonb_to_recordset($1::jsonb) as x(id text,jurisdiction text,kind text,name text,payer text,wage_basis text,effective_from date,effective_to date,status text,calc jsonb,nonresident_calc jsonb,applies_to text,optional boolean,notes text)
      on conflict(id) do update set jurisdiction=excluded.jurisdiction,kind=excluded.kind,name=excluded.name,payer=excluded.payer,wage_basis=excluded.wage_basis,effective_from=excluded.effective_from,effective_to=excluded.effective_to,status=excluded.status,calc=excluded.calc,nonresident_calc=excluded.nonresident_calc,applies_to=excluded.applies_to,optional=excluded.optional,notes=excluded.notes,updated_at=case when tax_rule.calc is distinct from excluded.calc or tax_rule.status is distinct from excluded.status then now() else tax_rule.updated_at end,updated_by='seed'`,
      [JSON.stringify(rows)]);
    // A rule the seed wrote earlier and no longer produces (a renamed or replaced row) is removed, so two versions can never both apply.
    const ids = db.rules.map((r) => r.id);
    const stale = (await c.query("delete from tax_rule where updated_by = 'seed' and not (id = any($1::text[])) returning id, calc, status, nonresident_calc", [ids])).rows;
    for (const r of stale) history.push({ rule_id: r.id, before: { calc: r.calc, status: r.status, nonresident_calc: r.nonresident_calc }, after: null });
    if (history.length) await c.query("insert into tax_rule_history(rule_id,changed_by,before,after) select rule_id,'seed',before,after from jsonb_to_recordset($1::jsonb) as x(rule_id text,before jsonb,after jsonb)", [JSON.stringify(history)]);
    const links = db.rules.filter((r) => mine(r.id)).flatMap((r) => r.sources.map((s) => ({ rule_id: r.id, source_id: s })));
    await c.query('delete from tax_rule_source where rule_id = any($1::text[])', [rows.map((r) => r.id)]);
    await c.query('insert into tax_rule_source select rule_id, source_id from jsonb_to_recordset($1::jsonb) as x(rule_id text, source_id text) on conflict do nothing', [JSON.stringify(links)]);
    // A place the data no longer lists, with no rules left and nothing pointing at it, is dropped too.
    await c.query(`delete from jurisdiction j where not (j.code = any($1::text[]))
      and not exists (select 1 from tax_rule r where r.jurisdiction = j.code)
      and not exists (select 1 from jurisdiction k where k.parent_code = j.code)`, [db.jurisdictions.map((j) => j.code)]);
    const kept = db.rules.length - rows.length;
    if (kept || stale.length) console.log(`seed: kept ${kept} rules edited in the app, removed ${stale.length} rules no longer in the data`);
    for (const r of RECIPROCITY) await c.query('insert into reciprocity_agreement values($1,$2,$3,$4,$5,$6,$7) on conflict(work_state,resident_state,effective_from) do update set form=excluded.form,status=excluded.status,notes=excluded.notes', [r.workState, r.residentState, r.form, r.effectiveFrom, r.effectiveTo ?? null, r.status, r.notes ?? null]);
    for (const e of EARNING_TYPES) await c.query('insert into earning_type values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(code) do update set name=excluded.name,category=excluded.category,cash=excluded.cash,supplemental=excluded.supplemental,taxability=excluded.taxability,state_overrides=excluded.state_overrides,w2=excluded.w2,notes=excluded.notes', [e.code, e.name, e.category, e.cash, e.supplemental, e.taxability, e.stateOverrides ?? null, e.w2 ?? null, e.notes ?? null]);
    for (const d of DEDUCTION_TYPES) await c.query('insert into deduction_type values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(code) do update set name=excluded.name,category=excluded.category,reduces_wages=excluded.reduces_wages,state_overrides=excluded.state_overrides,limit_key=excluded.limit_key,catch_up_limit_key=excluded.catch_up_limit_key,sort_order=excluded.sort_order,employer_paid=excluded.employer_paid,w2=excluded.w2,notes=excluded.notes', [d.code, d.name, d.category, d.reducesWages, d.stateOverrides ?? null, d.limitKey ?? null, d.catchUpLimitKey ?? null, d.order, !!d.employerPaid, d.w2 ?? null, d.notes ?? null]);
    for (const l of BENEFIT_LIMITS) await c.query('insert into benefit_limit values($1,$2,$3,$4,$5,$6) on conflict(key,year) do update set name=excluded.name,amount=excluded.amount,status=excluded.status,notes=excluded.notes', [l.key, l.year, l.name, l.amount, l.status, l.notes ?? null]);
    for (const r of RETIREMENT_SYSTEMS) await c.query('insert into retirement_system values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(code) do update set name=excluded.name,member_rate=excluded.member_rate,employer_rate=excluded.employer_rate,pickup_414h=excluded.pickup_414h,ss_covered=excluded.ss_covered,status=excluded.status,notes=excluded.notes', [r.code, r.name, r.state, r.memberRate, r.employerRate ?? null, r.pickup414h, String(r.socialSecurityTypicallyCovered), r.effectiveFrom, r.status, r.notes ?? null]);
    for (const v of VENDOR_PROFILES) await c.query("insert into vendor_profile(id,name,status,conventions,notes) values($1,$2,$3,$4,$5) on conflict(id) do update set name=excluded.name, notes=excluded.notes, conventions=case when vendor_profile.status='assumed' then excluded.conventions else vendor_profile.conventions end", [v.id, v.name, v.status, v.conventions, v.notes ?? null]);
  });
  await seedMultiples();
  const counts = (await pool.query('select (select count(*) from jurisdiction) j, (select count(*) from tax_rule) r, (select count(*) from tax_source) s')).rows[0];
  console.log(`seeded ${counts.j} jurisdictions, ${counts.r} tax rules, ${counts.s} sources`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
