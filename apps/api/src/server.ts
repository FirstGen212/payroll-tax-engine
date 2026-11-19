import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { BENEFIT_LIMITS, DEDUCTION_TYPES, EARNING_TYPES, RECIPROCITY, RETIREMENT_SYSTEMS, SOURCES, STATES, rulesOn } from '@pte/tax-data';
import { calculatePay, compareScenarios, learnVendorProfile, totalsOf } from '@pte/engine';
import type { PayInput, PayResult } from '@pte/engine';
import { pool, q, tx } from './db.js';
import { getTaxDb, invalidateTaxDb } from './taxdb.js';
import { seed } from './seed.js';
import { proposalRoutes } from './proposals/routes.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 40 * 1024 * 1024 });
await app.register(cors, { origin: true });
app.setErrorHandler((err, _req, reply) => {
  const status = (err as any).issues ? 400 : (err as any).statusCode ?? 500;
  reply.code(status).send({ error: err.message, issues: (err as any).issues });
});

const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d as string | null) ?? undefined);

// ------------------------------------------------------------------ reference / research database
app.get('/api/health', async () => ({ ok: true }));

app.get('/api/reference', async () => {
  const vendors = await q('select id, name, status, conventions, sample_count, notes from vendor_profile order by id');
  return { earningTypes: EARNING_TYPES, deductionTypes: DEDUCTION_TYPES, limits: BENEFIT_LIMITS, retirementSystems: RETIREMENT_SYSTEMS, reciprocity: RECIPROCITY, sources: SOURCES, vendors, states: STATES.map((s) => ({ code: s.code, name: s.name, type: s.type, flags: s.flags, agency: s.agency, notes: s.notes })) };
});

app.get('/api/jurisdictions', async (req) => {
  const { state, type, search } = req.query as Record<string, string | undefined>;
  return q(`select code, name, type, state, parent_code, flags, attrs, notes from jurisdiction
    where ($1::text is null or state = $1) and ($2::text is null or type = $2) and ($3::text is null or name ilike '%'||$3||'%' or code ilike '%'||$3||'%')
    order by state, type, name limit 2000`, [state ?? null, type ?? null, search ?? null]);
});

app.get('/api/rules', async (req) => {
  const { jurisdiction, date, kind, status } = req.query as Record<string, string | undefined>;
  return q(`select r.*, coalesce(array_agg(s.source_id) filter (where s.source_id is not null), '{}') as sources
    from tax_rule r left join tax_rule_source s on s.rule_id = r.id
    where ($1::text is null or r.jurisdiction = $1) and ($2::date is null or (r.effective_from <= $2 and (r.effective_to is null or r.effective_to >= $2)))
      and ($3::text is null or r.kind = $3) and ($4::text is null or r.status = $4)
    group by r.id order by r.jurisdiction, r.kind, r.effective_from limit 5000`, [jurisdiction ?? null, date ?? null, kind ?? null, status ?? null]);
});

app.get('/api/rules/:id/history', async (req) => q('select * from tax_rule_history where rule_id=$1 order by changed_at desc', [(req.params as any).id]));

/** Edit a rule (research workflow): updates calc/status/notes and records history. */
app.patch('/api/rules/:id', async (req) => {
  const id = (req.params as any).id as string;
  const body = z.object({ calc: z.any().optional(), status: z.enum(['published', 'draft', 'projected', 'unverified', 'placeholder']).optional(), notes: z.string().nullish(), effectiveTo: z.string().nullable().optional(), by: z.string().nullish() }).parse(req.body);
  await tx(async (c) => {
    const before = (await c.query('select * from tax_rule where id=$1', [id])).rows[0];
    if (!before) throw Object.assign(new Error(`Rule ${id} not found`), { statusCode: 404 });
    await c.query('update tax_rule set calc=coalesce($2,calc), status=coalesce($3,status), notes=coalesce($4,notes), effective_to=case when $5::boolean then $6::date else effective_to end, updated_at=now(), updated_by=$7 where id=$1',
      [id, body.calc ? JSON.stringify(body.calc) : null, body.status ?? null, body.notes ?? null, body.effectiveTo !== undefined, body.effectiveTo ?? null, body.by ?? 'ui']);
    const after = (await c.query('select * from tax_rule where id=$1', [id])).rows[0];
    await c.query('insert into tax_rule_history(rule_id,changed_by,before,after) values($1,$2,$3,$4)', [id, body.by ?? 'ui', before, after]);
  });
  invalidateTaxDb();
  return { ok: true };
});

/** Coverage and verification status by jurisdiction: what's in the database and how sure we are. */
app.get('/api/coverage', async () => {
  const byState = await q(`select j.state, j.type, count(distinct j.code) jurisdictions, count(r.id) rules,
      count(r.id) filter (where r.status in ('published','draft')) verified,
      count(r.id) filter (where r.status='unverified') unverified,
      count(r.id) filter (where r.status='projected') projected,
      count(r.id) filter (where r.status='placeholder') placeholder
    from jurisdiction j left join tax_rule r on r.jurisdiction = j.code
    group by j.state, j.type order by j.state, j.type`);
  const totals = (await q(`select status, count(*)::int n from tax_rule group by status`)).reduce((a: any, r: any) => ({ ...a, [r.status]: r.n }), {});
  return { byState, totals };
});

// ------------------------------------------------------------------ clients
const ClientBody = z.object({ name: z.string(), fein: z.string().nullish(), homeState: z.string().nullish(), payFrequency: z.string().default('biweekly'), futaExempt: z.boolean().default(false), employeeCount: z.number().int().optional(), currentVendor: z.string().nullish(), withholdResidentLocal: z.boolean().default(true), notes: z.string().nullish() });

app.get('/api/clients', async () => q(`select c.*, (select count(*) from employee e where e.client_id=c.id and e.active)::int employees from client c order by name`));
app.post('/api/clients', async (req) => {
  const b = ClientBody.parse(req.body);
  return (await q('insert into client(name,fein,home_state,pay_frequency,futa_exempt,employee_count,current_vendor,withhold_resident_local,notes) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *', [b.name, b.fein ?? null, b.homeState ?? null, b.payFrequency, b.futaExempt, b.employeeCount ?? null, b.currentVendor ?? null, b.withholdResidentLocal, b.notes ?? null]))[0];
});
app.get('/api/clients/:id', async (req) => {
  const id = (req.params as any).id;
  const [client] = await q('select * from client where id=$1', [id]);
  const locations = await q('select * from client_work_location where client_id=$1 order by label', [id]);
  const settings = await q('select * from client_tax_setting where client_id=$1 order by tax_key', [id]);
  return { ...client, locations, settings };
});
app.put('/api/clients/:id', async (req) => {
  const b = ClientBody.parse(req.body);
  return (await q('update client set name=$2,fein=$3,home_state=$4,pay_frequency=$5,futa_exempt=$6,employee_count=$7,current_vendor=$8,withhold_resident_local=$9,notes=$10 where id=$1 returning *', [(req.params as any).id, b.name, b.fein ?? null, b.homeState ?? null, b.payFrequency, b.futaExempt, b.employeeCount ?? null, b.currentVendor ?? null, b.withholdResidentLocal, b.notes ?? null]))[0];
});
app.post('/api/clients/:id/locations', async (req) => {
  const b = z.object({ label: z.string(), state: z.string(), localCodes: z.array(z.string()).default([]), address: z.string().nullish() }).parse(req.body);
  return (await q('insert into client_work_location(client_id,label,state,local_codes,address) values($1,$2,$3,$4,$5) returning *', [(req.params as any).id, b.label, b.state, b.localCodes, b.address ?? null]))[0];
});
/** Tax toggles, SUI rates and account numbers per client. */
app.put('/api/clients/:id/tax-settings', async (req) => {
  const rows = z.array(z.object({ taxKey: z.string(), enabled: z.boolean().nullable().optional(), rate: z.number().nullable().optional(), accountNumber: z.string().nullable().optional(), effectiveFrom: z.string().default('2027-01-01') })).parse(req.body);
  await tx(async (c) => {
    for (const r of rows) await c.query('insert into client_tax_setting(client_id,tax_key,enabled,rate,account_number,effective_from) values($1,$2,$3,$4,$5,$6) on conflict(client_id,tax_key,effective_from) do update set enabled=excluded.enabled, rate=excluded.rate, account_number=excluded.account_number', [(req.params as any).id, r.taxKey, r.enabled ?? null, r.rate ?? null, r.accountNumber ?? null, r.effectiveFrom]);
  });
  return { ok: true };
});
/** All taxes that could apply to a client's locations, with current toggle state (drives the tax toggle screen). */
app.get('/api/clients/:id/applicable-taxes', async (req) => {
  const id = (req.params as any).id;
  const date = ((req.query as any).date as string) ?? '2027-01-01';
  const db = await getTaxDb();
  const locs = await q('select * from client_work_location where client_id=$1', [id]);
  const emps = await q('select residence_state, residence_locals from employee where client_id=$1 and active', [id]);
  const settings = await q('select * from client_tax_setting where client_id=$1', [id]);
  const codes = new Set<string>(['US']);
  for (const l of locs) { codes.add(l.state); for (const c of l.local_codes) codes.add(c); }
  for (const e of emps) { codes.add(e.residence_state); for (const c of e.residence_locals) codes.add(c); }
  const out = [];
  for (const code of codes) for (const r of rulesOn(db, code, date)) {
    if (r.calc.kind === 'none') continue;
    const k = `${r.jurisdiction}.${r.kind}`;
    const s = settings.find((x: any) => x.tax_key === k || x.tax_key === r.id);
    out.push({ key: k, ruleId: r.id, jurisdiction: r.jurisdiction, kind: r.kind, name: r.name, payer: r.payer, status: r.status, optional: !!r.optional, enabled: s?.enabled ?? !r.optional, rate: s?.rate != null ? Number(s.rate) : null, defaultRate: r.calc.kind === 'percent' ? r.calc.rate : null, rateOverridable: r.calc.kind === 'percent' && (r.kind === 'SUI_ER' || !!r.calc.employerRateOverridable), accountNumber: s?.account_number ?? null, notes: r.notes });
  }
  return out.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.kind.localeCompare(b.kind));
});

// ------------------------------------------------------------------ employees
const EmployeeBody = z.object({
  employeeNumber: z.string().nullish(), firstName: z.string(), lastName: z.string(), birthDate: z.string().nullish(), hireDate: z.string().nullish(),
  payType: z.enum(['hourly', 'salary']).default('hourly'), payRate: z.number().default(0), standardHours: z.number().default(80),
  residenceState: z.string(), residenceLocals: z.array(z.string()).default([]), residenceZip: z.string().nullish(), unemploymentState: z.string().nullish(),
  ssCovered: z.boolean().default(true), medicareCovered: z.boolean().default(true),
  federalW4: z.any(), stateW4: z.record(z.any()).default({}), taxToggles: z.record(z.boolean()).default({}),
  work: z.array(z.object({ locationId: z.string().nullish(), state: z.string(), localCodes: z.array(z.string()).default([]), percent: z.number(), remoteForConvenience: z.boolean().default(false) })).default([]),
  deductions: z.array(z.object({ code: z.string(), amount: z.number().nullable().optional(), percent: z.number().nullable().optional(), retirementSystem: z.string().nullable().optional(), garnishment: z.any().optional() })).default([]),
});

async function saveEmployee(clientId: string, b: z.infer<typeof EmployeeBody>, id?: string) {
  return tx(async (c) => {
    const vals = [clientId, b.employeeNumber ?? null, b.firstName, b.lastName, b.birthDate ?? null, b.hireDate ?? null, b.payType, b.payRate, b.standardHours, b.residenceState, b.residenceLocals, b.residenceZip ?? null, b.unemploymentState ?? null, b.ssCovered, b.medicareCovered, b.federalW4, b.stateW4, b.taxToggles];
    let row;
    if (id) row = (await c.query('update employee set client_id=$1,employee_number=$2,first_name=$3,last_name=$4,birth_date=$5,hire_date=$6,pay_type=$7,pay_rate=$8,standard_hours=$9,residence_state=$10,residence_locals=$11,residence_zip=$12,unemployment_state=$13,ss_covered=$14,medicare_covered=$15,federal_w4=$16,state_w4=$17,tax_toggles=$18 where id=$19 returning *', [...vals, id])).rows[0];
    else row = (await c.query('insert into employee(client_id,employee_number,first_name,last_name,birth_date,hire_date,pay_type,pay_rate,standard_hours,residence_state,residence_locals,residence_zip,unemployment_state,ss_covered,medicare_covered,federal_w4,state_w4,tax_toggles) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *', vals)).rows[0];
    await c.query('delete from employee_work_allocation where employee_id=$1', [row.id]);
    for (const w of b.work) await c.query('insert into employee_work_allocation(employee_id,location_id,state,local_codes,percent,remote_for_convenience) values($1,$2,$3,$4,$5,$6)', [row.id, w.locationId ?? null, w.state, w.localCodes, w.percent, w.remoteForConvenience]);
    await c.query('delete from employee_recurring_deduction where employee_id=$1', [row.id]);
    for (const d of b.deductions) await c.query('insert into employee_recurring_deduction(employee_id,deduction_code,amount,percent,retirement_system,garnishment) values($1,$2,$3,$4,$5,$6)', [row.id, d.code, d.amount ?? null, d.percent ?? null, d.retirementSystem ?? null, d.garnishment ?? null]);
    return row;
  });
}

app.get('/api/clients/:id/employees', async (req) => q('select * from employee where client_id=$1 order by last_name, first_name', [(req.params as any).id]));
app.post('/api/clients/:id/employees', async (req) => saveEmployee((req.params as any).id, EmployeeBody.parse(req.body)));
app.get('/api/employees/:id', async (req) => {
  const id = (req.params as any).id;
  const [e] = await q('select * from employee where id=$1', [id]);
  const work = await q('select * from employee_work_allocation where employee_id=$1', [id]);
  const deductions = await q('select * from employee_recurring_deduction where employee_id=$1', [id]);
  const ytd = await q('select * from employee_ytd where employee_id=$1 order by year desc', [id]);
  return { ...e, work, deductions, ytd };
});
app.put('/api/employees/:id', async (req) => {
  const [e] = await q('select client_id from employee where id=$1', [(req.params as any).id]);
  return saveEmployee(e.client_id, EmployeeBody.parse(req.body), (req.params as any).id);
});

// ------------------------------------------------------------------ calculations
async function buildInput(clientId: string, employeeId: string, line: { earnings: any[]; deductions?: any[]; replaceRecurring?: boolean }, checkDate: string, runType: PayInput['runType'], vendorId?: string): Promise<PayInput> {
  const [client] = await q('select * from client where id=$1', [clientId]);
  const [e] = await q('select * from employee where id=$1 and client_id=$2', [employeeId, clientId]);
  if (!e) throw new Error(`Employee ${employeeId} not found for client`);
  const work = await q('select * from employee_work_allocation where employee_id=$1', [employeeId]);
  const recurring = line.replaceRecurring ? [] : await q('select * from employee_recurring_deduction where employee_id=$1', [employeeId]);
  const settings = await q('select * from client_tax_setting where client_id=$1 and effective_from <= $2 order by effective_from', [clientId, checkDate]);
  const year = Number(checkDate.slice(0, 4));
  const [ytdRow] = await q('select ytd from employee_ytd where employee_id=$1 and year=$2', [employeeId, year]);
  const vendor = vendorId ? (await q('select conventions from vendor_profile where id=$1', [vendorId]))[0] : undefined;
  const suiRates: Record<string, number> = {};
  const toggles: Record<string, boolean> = {};
  const rateOverrides: Record<string, number> = {};
  for (const s of settings) {
    if (s.enabled !== null) toggles[s.tax_key] = s.enabled;
    if (s.rate !== null) {
      if (s.tax_key.endsWith('.SUI_ER')) suiRates[s.tax_key.split('.')[0]] = Number(s.rate);
      else rateOverrides[s.tax_key] = Number(s.rate);
    }
  }
  return {
    checkDate,
    payFrequency: client.pay_frequency,
    runType,
    vendorProfileId: vendorId,
    conventions: vendor?.conventions,
    employer: { id: client.id, name: client.name, fein: client.fein ?? undefined, homeState: client.home_state ?? undefined, suiRates, taxToggles: toggles, rateOverrides, futaExempt: client.futa_exempt, employeeCount: client.employee_count ?? undefined, withholdResidentLocal: client.withhold_resident_local },
    employee: {
      id: e.id, name: `${e.first_name} ${e.last_name}`, birthDate: iso(e.birth_date), federalW4: e.federal_w4, stateW4: e.state_w4,
      residence: { state: e.residence_state, localCodes: e.residence_locals, zip: e.residence_zip ?? undefined },
      work: work.map((w: any) => ({ state: w.state, localCodes: w.local_codes, percent: Number(w.percent), remoteForConvenience: w.remote_for_convenience })),
      unemploymentState: e.unemployment_state ?? undefined, socialSecurityCovered: e.ss_covered, medicareCovered: e.medicare_covered, taxToggles: e.tax_toggles,
    },
    earnings: line.earnings,
    deductions: [
      ...recurring.map((d: any) => ({ code: d.deduction_code, amount: d.amount != null ? Number(d.amount) : undefined, percent: d.percent != null ? Number(d.percent) : undefined, retirementSystem: d.retirement_system ?? undefined, garnishment: d.garnishment ?? undefined })),
      ...(line.deductions ?? []),
    ],
    ytd: runType === 'actual' ? ytdRow?.ytd ?? {} : ytdRow?.ytd ?? {},
  };
}

/** Stateless calculator: post a full PayInput, get the full result with audit trail. */
await proposalRoutes(app);

app.post('/api/calculate', async (req) => calculatePay(req.body as PayInput, await getTaxDb()));

const PayRunBody = z.object({
  checkDate: z.string(), runType: z.enum(['actual', 'mock', 'proposal']).default('mock'), vendorProfileId: z.string().nullish(), label: z.string().nullish(), save: z.boolean().default(true),
  lines: z.array(z.object({ employeeId: z.string(), earnings: z.array(z.object({ code: z.string(), amount: z.number(), hours: z.number().optional(), rate: z.number().optional() })), deductions: z.array(z.any()).optional(), replaceRecurring: z.boolean().optional() })),
});

app.post('/api/clients/:id/payruns', async (req) => {
  const clientId = (req.params as any).id;
  const b = PayRunBody.parse(req.body);
  const db = await getTaxDb();
  const inputs = await Promise.all(b.lines.map((l) => buildInput(clientId, l.employeeId, l, b.checkDate, b.runType, b.vendorProfileId ?? undefined)));
  const results: PayResult[] = inputs.map((i) => calculatePay(i, db));
  const totals = totalsOf(results);
  if (!b.save) return { id: null, totals, results };
  const [client] = await q('select pay_frequency from client where id=$1', [clientId]);
  const runId = await tx(async (c) => {
    const run = (await c.query('insert into pay_run(client_id,run_type,vendor_profile_id,check_date,pay_frequency,label,totals) values($1,$2,$3,$4,$5,$6,$7) returning id', [clientId, b.runType, b.vendorProfileId ?? null, b.checkDate, client.pay_frequency, b.label ?? null, totals])).rows[0].id;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      await c.query('insert into pay_statement(pay_run_id,employee_id,input,result,gross,net,employee_taxes,employer_taxes) values($1,$2,$3,$4,$5,$6,$7,$8)', [run, r.employeeId, inputs[i], r, r.grossPay, r.netPay, r.employeeTaxes, r.employerTaxes]);
      // Only actual runs advance YTD.
      if (b.runType === 'actual') await c.query('insert into employee_ytd(employee_id,year,ytd) values($1,$2,$3) on conflict(employee_id,year) do update set ytd=excluded.ytd', [r.employeeId, Number(b.checkDate.slice(0, 4)), r.ytdAfter]);
    }
    return run;
  });
  return { id: runId, totals, results };
});
app.get('/api/clients/:id/payruns', async (req) => q('select id, run_type, vendor_profile_id, check_date, label, totals, created_at from pay_run where client_id=$1 order by created_at desc', [(req.params as any).id]));
app.get('/api/payruns/:id', async (req) => {
  const id = (req.params as any).id;
  const [run] = await q('select * from pay_run where id=$1', [id]);
  const statements = await q(`select s.id, s.employee_id, e.first_name, e.last_name, s.result, s.gross, s.net from pay_statement s join employee e on e.id=s.employee_id where s.pay_run_id=$1 order by e.last_name`, [id]);
  return { ...run, statements };
});

/** Proposal / eligibility modeling: same employees and pay with a variant (e.g. add Section 125 plan). */
app.post('/api/scenarios/compare', async (req) => {
  const b = z.object({ base: z.array(z.any()), variant: z.array(z.any()) }).parse(req.body);
  return compareScenarios(b.base as PayInput[], b.variant as PayInput[], await getTaxDb());
});

// ------------------------------------------------------------------ vendor profiles
app.get('/api/vendor-profiles', async () => q('select * from vendor_profile order by id'));
app.post('/api/vendor-profiles/:id/samples', async (req) => {
  const vendorId = (req.params as any).id;
  const rows = z.array(z.object({ label: z.string().nullish(), clientId: z.string().nullish(), input: z.any(), actualTaxes: z.record(z.number()), actualNetPay: z.number().optional() })).parse(req.body);
  for (const r of rows) await q('insert into vendor_sample_paycheck(vendor_id,client_id,label,input,actual) values($1,$2,$3,$4,$5)', [vendorId, r.clientId ?? null, r.label ?? null, r.input, { taxes: r.actualTaxes, net: r.actualNetPay }]);
  return { added: rows.length };
});
app.post('/api/vendor-profiles/:id/learn', async (req) => {
  const vendorId = (req.params as any).id;
  const samples = (await q('select label, input, actual from vendor_sample_paycheck where vendor_id=$1', [vendorId])).map((s: any) => ({ label: s.label, input: s.input, actualTaxes: s.actual.taxes, actualNetPay: s.actual.net }));
  if (!samples.length) return { error: 'No sample paychecks uploaded for this vendor yet.' };
  const result = learnVendorProfile(vendorId, samples, await getTaxDb());
  await q('insert into vendor_learn_run(vendor_id,result) values($1,$2)', [vendorId, result]);
  await q("update vendor_profile set status='learned', conventions=$2, sample_count=$3, notes=$4, updated_at=now() where id=$1", [vendorId, result.best, samples.length, `Learned from ${samples.length} samples; exact match ${(result.exactMatchRate * 100).toFixed(1)}%`]);
  return result;
});

// ------------------------------------------------------------------ static web app (production build)
const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: 'not found' }) : reply.sendFile('index.html')));
}


if (process.env.SEED_ON_START !== 'false') await seed();
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
process.on('SIGTERM', () => { void app.close().then(() => pool.end()).finally(() => process.exit(0)); });
