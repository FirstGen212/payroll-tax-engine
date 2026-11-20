import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { CENSUS_COLUMN_ALIASES, DEFAULT_PROPOSAL_SETTINGS, ELIGIBILITY_ORDER, autoMapColumns, rowsFromSheet, runProposal } from '@pte/engine';
import type { CensusRow, ProposalResult, ProposalSettings } from '@pte/engine';
import type { TaxDatabase } from '@pte/tax-data';
import { randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { q } from '../db.js';
import { audit, can } from '../auth.js';
import { DEFAULT_REPORT_SETTINGS, ReportSettingsIn, buildSnapshot, mergeReportSettings, newSlug } from './report.js';
import { getTaxDb } from '../taxdb.js';
import { parseWorkbook } from './parse.js';

export const STATUSES = ['draft', 'review', 'completed', 'sent', 'won', 'lost'] as const;
const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

const Calc = z.object({
  headers: z.array(z.string()).default([]),
  rows: z.array(z.record(z.any())),
  mapping: z.record(z.string().nullish()),
  settings: z.record(z.any()).default({}),
});

const Save = Calc.extend({
  name: z.string().min(1),
  clientId: z.string().uuid().nullish(),
  company: z.string().nullish(),
  fileName: z.string().nullish(),
  sheetName: z.string().nullish(),
  status: z.enum(STATUSES).default('draft'),
  notes: z.string().max(4000).nullish(),
  reportSettings: ReportSettingsIn.nullish(),
  revisionLabel: z.string().max(120).nullish(),
});

const norm = (s: string) => s.toLowerCase().replace(/^(city|town|village|borough|township|county) of /, '').replace(/[^a-z0-9]/g, '');

/** Match the sheet's municipality text to local jurisdictions in the work state. */
function matchLocals(rows: CensusRow[], db: TaxDatabase): void {
  const locals = db.jurisdictions.filter((j) => j.type !== 'federal' && j.type !== 'state' && j.type !== 'territory');
  for (const r of rows) {
    if (!r.municipality || !r.workState) continue;
    const st = r.workState.trim().toUpperCase();
    const want = norm(r.municipality);
    const hits = locals.filter((j) => j.state === st && (norm(j.name) === want || norm(j.name).startsWith(want) || j.code.toUpperCase() === r.municipality!.toUpperCase()));
    if (hits.length) r.localCodes = hits.map((h) => h.code);
  }
}

async function vendorConventions(id?: string) {
  if (!id) return undefined;
  const [v] = await q('select conventions from vendor_profile where id=$1', [id]);
  return v?.conventions;
}

export async function calculate(body: z.infer<typeof Calc>): Promise<ProposalResult & { unmatchedMunicipalities: string[] }> {
  const db = await getTaxDb();
  const rows = rowsFromSheet(body.rows, body.mapping as any);
  matchLocals(rows, db);
  const settings = body.settings as Partial<ProposalSettings>;
  const conventions = await vendorConventions(settings.vendorProfileId);
  const result = runProposal(rows, { ...settings, conventions }, db);
  const unmatched = [...new Set(rows.filter((r) => r.municipality && !r.localCodes).map((r) => `${r.workState ?? ''} ${r.municipality}`))];
  for (const e of result.employees) if (e.row.municipality && !e.row.localCodes) e.flags.push(`Municipality "${e.row.municipality}" did not match a local tax jurisdiction; no local tax calculated.`);
  return { ...result, unmatchedMunicipalities: unmatched };
}

/** Build the underwriting workbook: the original columns with the calculated columns filled in, plus a summary tab. */
export async function exportWorkbook(name: string, headers: string[], rawRows: Record<string, unknown>[], mapping: Record<string, string | null | undefined>, result: ProposalResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sum = wb.addWorksheet('Summary');
  const s = result.summary;
  const usd = '"$"#,##0.00';
  const pct = (n: number) => n;
  sum.addRows([
    ['Proposal', name],
    ['Plan year', result.settings.year],
    ['Rows in file', s.rowsInFile],
    ['Employees calculated', s.employees],
    ['Eligible (full plan)', s.eligibleFull],
    ['Eligible (part-time plan)', s.eligiblePartTime],
    [],
    ['Eligibility', 'Employees', 'Share'],
    ...ELIGIBILITY_ORDER.filter((k) => s.byEligibility[k]).map((k) => [k, s.byEligibility[k], pct(s.byEligibility[k] / s.employees)]),
    [],
    ['Estimates', 'Amount'],
    ['Monthly savings (sum of allotments)', s.monthlySavings.total],
    ['Annual savings (allotments x 12)', s.monthlySavings.annual],
    ['Average allotment (full plan)', s.monthlySavings.average],
    ['Employer annual tax savings', s.employerAnnualSavings.total],
    ['Employer savings per employee', s.employerAnnualSavings.perEmployee],
    [`Valuation increase (${result.settings.ebitdaMultiple}x EBITDA)`, s.valuationIncrease],
    [],
    ['Program price', 'Eligible', 'Monthly revenue', 'Benefit cost', 'Monthly margin', 'Margin %', '12-month margin'],
    ...s.programs.map((p) => [p.price, p.eligible, p.monthlyRevenue, p.monthlyBenefitCost, p.monthlyMargin, p.marginPercent, p.annualMargin]),
    [],
    ['Estimates from the payroll tax engine; tax lines marked projected or unverified are not yet checked against agency sources.'],
  ]);
  sum.getColumn(1).width = 52;
  sum.getColumn(2).width = 18;
  sum.eachRow((r) => {
    const first = String(r.getCell(1).value ?? '');
    if (/savings|allotment|valuation/i.test(first)) r.getCell(2).numFmt = usd;
    if (s.byEligibility[first] !== undefined) r.getCell(3).numFmt = '0%';
    if (typeof r.getCell(1).value === 'number') { [1, 3, 4, 5, 7].forEach((c) => (r.getCell(c).numFmt = usd)); r.getCell(6).numFmt = '0.0%'; }
  });

  const ws = wb.addWorksheet('Underwriting');
  const fill: Record<string, (i: number) => unknown> = {};
  const byRow = new Map(result.employees.map((e) => [e.row.rowNumber, e]));
  const emp = (i: number) => byRow.get(i + 2);
  const setIf = (header: string | undefined, f: (i: number) => unknown) => { if (header) fill[header] = f; };
  const find = (re: RegExp) => headers.find((h) => re.test(h));
  setIf(find(/^before taxes$/i), (i) => emp(i)?.perPeriod?.taxBefore);
  setIf(find(/^after taxes$/i), (i) => emp(i)?.perPeriod?.taxAfter);
  setIf(find(/allotment/i), (i) => emp(i)?.monthly?.allotment);
  const dup = new Map((result.summary.duplicates ?? []).map((d) => [d.rowNumber, d.duplicateOf]));
  setIf(find(/^eligibility$/i), (i) => emp(i)?.eligibility ?? (dup.has(i + 2) ? `Duplicate of row ${dup.get(i + 2)}` : undefined));
  const extra = ['First Gen per check', 'Net per check', 'Employee tax savings / mo', 'Employer tax savings / mo', 'Eff. rate', 'PT allotment', 'Reason', 'Data flags'];
  ws.addRow([...headers, ...extra]).font = { bold: true };
  rawRows.forEach((r, i) => {
    const e = emp(i);
    const vals = headers.map((h) => (fill[h] ? fill[h](i) ?? r[h] : r[h]));
    ws.addRow([...vals, e?.deductionPerCheck, e?.perPeriod?.net, e?.monthly?.employeeTaxSavings, e?.monthly?.employerTaxSavings, e?.perPeriod?.effectiveRate, e?.partTime?.allotment, e?.reasons.join(' '), e?.flags.join(' ')]);
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  headers.concat(extra).forEach((h, i) => (ws.getColumn(i + 1).width = Math.min(Math.max(h.length + 2, 10), 40)));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function proposalRoutes(app: FastifyInstance) {
  app.get('/api/proposals/defaults', async () => ({
    settings: DEFAULT_PROPOSAL_SETTINGS,
    fields: Object.keys(CENSUS_COLUMN_ALIASES).filter((k) => !['rowNumber', 'localCodes'].includes(k)),
    eligibilityOrder: ELIGIBILITY_ORDER,
  }));

  app.post('/api/proposals/parse', async (req) => {
    const b = z.object({ fileName: z.string(), base64: z.string() }).parse(req.body);
    const sheets = await parseWorkbook(b.fileName, Buffer.from(b.base64, 'base64')).catch((e) => {
      req.log.warn(e, 'could not read the uploaded file');
      throw httpError(400, 'That file could not be read. Upload an .xlsx or .csv file (an old .xls needs to be saved as .xlsx first).');
    });
    if (!sheets.length) throw Object.assign(new Error('No sheets with data found.'), { statusCode: 400 });
    const scored = sheets.map((s) => ({ ...s, mapping: autoMapColumns(s.headers) }));
    const best = scored.find((s) => /underwrit/i.test(s.name)) ?? [...scored].sort((a, b) => Object.keys(b.mapping).length - Object.keys(a.mapping).length)[0];
    return { fileName: b.fileName, suggestedSheet: best.name, sheets: scored.map((s) => ({ name: s.name, headers: s.headers, rows: s.rows, mapping: s.mapping })) };
  });

  app.post('/api/proposals/calculate', async (req) => calculate(Calc.parse(req.body)));

  app.post('/api/proposals/export', async (req, reply) => {
    const b = Calc.extend({ name: z.string().default('Proposal') }).parse(req.body);
    const result = await calculate(b);
    const buf = await exportWorkbook(b.name, b.headers, b.rows, b.mapping, result);
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', `attachment; filename="${b.name.replace(/[^\w .-]/g, '')} - Underwriting.xlsx"`);
    return reply.send(buf);
  });

  /** A proposal the current user may see (their own, or anyone's with proposals.view_all). */
  const load = async (req: FastifyRequest, id: string) => {
    const [p] = await q(`select p.*, u.name owner_name from proposal p left join app_user u on u.id = p.owner_id where p.id=$1`, [id]);
    if (!p || (!can(req, 'proposals.view_all') && p.owner_id !== req.user!.id)) throw httpError(404, 'Proposal not found');
    return p;
  };

  // The queue: every saved proposal the user can see, newest activity first.
  app.get('/api/proposals', async (req) => {
    const all = can(req, 'proposals.view_all');
    return q(`select p.id, p.name, p.company, p.file_name, p.status, p.client_id, c.name client_name, p.summary, p.notes, p.owner_id, u.name owner_name,
        p.created_at, p.updated_at, p.completed_at,
        (select count(*)::int from proposal_revision r where r.proposal_id = p.id) revisions,
        (select json_build_object('slug', r.slug, 'created_at', r.created_at, 'views', r.views) from proposal_report r where r.proposal_id = p.id and r.revoked_at is null order by r.created_at desc limit 1) latest_report
      from proposal p left join client c on c.id = p.client_id left join app_user u on u.id = p.owner_id
      where ($1 or p.owner_id = $2) order by p.updated_at desc`, [all, req.user!.id]);
  });

  app.get('/api/proposals/:id', async (req) => {
    const p = await load(req, (req.params as any).id);
    return { ...p, report_settings: mergeReportSettings(p.report_settings) };
  });

  app.get('/api/report-defaults', async () => DEFAULT_REPORT_SETTINGS);

  const save = async (req: FastifyRequest, b: z.infer<typeof Save>, id?: string, event = id ? 'proposal.save' : 'proposal.create') => {
    const result = await calculate(b);
    const summary = { ...result.summary, unmatchedMunicipalities: result.unmatchedMunicipalities };
    const vals = [b.name, b.clientId ?? null, b.company ?? null, b.fileName ?? null, b.sheetName ?? null, JSON.stringify(b.headers), JSON.stringify(b.rows), JSON.stringify(b.mapping), JSON.stringify(result.settings), JSON.stringify(summary), JSON.stringify(result.employees), b.status, b.notes ?? null, JSON.stringify(b.reportSettings ?? {})];
    let pid = id;
    if (id) {
      const before = await load(req, id);
      await q(`update proposal set name=$1, client_id=$2, company=$3, file_name=$4, sheet_name=$5, headers=$6, raw_rows=$7, mapping=$8, settings=$9, summary=$10, results=$11, status=$12, notes=$13, report_settings=$14,
          completed_at = case when $12 = 'completed' and status <> 'completed' then now() else completed_at end, updated_at=now() where id=$15`, [...vals, id]);
      if (before.status !== b.status) await audit(req, 'proposal.status', b.name, { proposal: id, from: before.status, to: b.status });
    } else {
      const [p] = await q(`insert into proposal (name, client_id, company, file_name, sheet_name, headers, raw_rows, mapping, settings, summary, results, status, notes, report_settings, owner_id, completed_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, case when $12='completed' then now() end) returning id`, [...vals, req.user!.id]);
      pid = p.id;
    }
    await q('insert into proposal_revision(proposal_id, user_id, label, settings, summary) values($1,$2,$3,$4,$5)', [pid, req.actor!.id, b.revisionLabel ?? (id ? 'Saved' : 'Created'), JSON.stringify(result.settings), JSON.stringify(summary)]);
    await audit(req, event, b.name, { proposal: pid });
    return { id: pid, result: { ...result, summary } };
  };
  app.post('/api/proposals', async (req) => save(req, Save.parse(req.body)));
  app.put('/api/proposals/:id', async (req) => save(req, Save.parse(req.body), (req.params as any).id));

  // Re-run a saved proposal with today's tax data and engine, keeping its file, mapping and settings.
  app.post('/api/proposals/:id/recalculate', async (req) => {
    const p = await load(req, (req.params as any).id);
    return save(req, { name: p.name, clientId: p.client_id, company: p.company, fileName: p.file_name, sheetName: p.sheet_name, headers: p.headers, rows: p.raw_rows, mapping: p.mapping, settings: p.settings, status: p.status, notes: p.notes, reportSettings: mergeReportSettings(p.report_settings), revisionLabel: 'Recalculated' }, p.id, 'proposal.recalculate');
  });

  app.post('/api/proposals/:id/duplicate', async (req) => {
    const p = await load(req, (req.params as any).id);
    const [n] = await q(`insert into proposal (name, client_id, company, file_name, sheet_name, headers, raw_rows, mapping, settings, summary, results, status, notes, report_settings, owner_id)
      select name || ' (copy)', client_id, company, file_name, sheet_name, headers, raw_rows, mapping, settings, summary, results, 'draft', notes, report_settings, $2 from proposal where id=$1 returning id`, [p.id, req.user!.id]);
    await q('insert into proposal_revision(proposal_id, user_id, label, settings, summary) values($1,$2,$3,$4,$5)', [n.id, req.actor!.id, `Copied from ${p.name}`, JSON.stringify(p.settings), JSON.stringify(p.summary)]);
    await audit(req, 'proposal.copy', `${p.name} (copy)`, { proposal: n.id, copiedFrom: p.name });
    return { id: n.id };
  });

  // Move a proposal along the queue without opening it.
  app.post('/api/proposals/:id/status', async (req) => {
    const p = await load(req, (req.params as any).id);
    const { status } = z.object({ status: z.enum(STATUSES) }).parse(req.body);
    if (status !== p.status) {
      await q(`update proposal set status=$2, completed_at = case when $2 = 'completed' then now() else completed_at end, updated_at = now() where id=$1`, [p.id, status]);
      await audit(req, 'proposal.status', p.name, { proposal: p.id, from: p.status, to: status });
    }
    return { ok: true, status };
  });

  app.get('/api/proposals/:id/revisions', async (req) => {
    const p = await load(req, (req.params as any).id);
    return q(`select r.id, r.at, r.label, r.settings, r.summary, u.name user_name from proposal_revision r left join app_user u on u.id = r.user_id where r.proposal_id=$1 order by r.at desc limit 100`, [p.id]);
  });

  app.delete('/api/proposals/:id', async (req) => {
    const p = await load(req, (req.params as any).id);
    await q('delete from proposal where id=$1', [p.id]);
    await audit(req, 'proposal.delete', p.name, { proposal: p.id });
    return { ok: true };
  });

  // ---------------------------------------------------------------- client-facing proposal links
  app.get('/api/proposals/:id/reports', async (req) => {
    const p = await load(req, (req.params as any).id);
    return q(`select r.slug, r.created_at, r.revoked_at, r.views, r.last_viewed_at, u.name created_by_name from proposal_report r left join app_user u on u.id = r.created_by where r.proposal_id=$1 order by r.created_at desc`, [p.id]);
  });
  app.post('/api/proposals/:id/reports', async (req) => {
    const p = await load(req, (req.params as any).id);
    if (!p.summary?.programs) throw httpError(400, 'Calculate and save the proposal before publishing it.');
    // The page editor sends its current settings so the link always matches the preview.
    const sent = z.object({ reportSettings: ReportSettingsIn.nullish() }).parse(req.body ?? {}).reportSettings;
    if (sent) {
      if (!can(req, 'proposals.edit')) throw httpError(403, 'You can publish links but not change the client page.');
      p.report_settings = sent;
      await q('update proposal set report_settings=$2 where id=$1', [p.id, JSON.stringify(sent)]);
    }
    // The link is the only key to the page, so the random part is long enough that it can't be guessed.
    const slug = newSlug(p.company || p.name, randomBytes(8).toString('hex'));
    await q('insert into proposal_report(slug, proposal_id, snapshot, created_by) values($1,$2,$3,$4)', [slug, p.id, JSON.stringify(buildSnapshot(p)), req.actor!.id]);
    await audit(req, 'report.publish', p.name, { proposal: p.id, link: `/r/${slug}` });
    return { slug, url: `/r/${slug}` };
  });
  app.delete('/api/proposals/:id/reports/:slug', async (req) => {
    const p = await load(req, (req.params as any).id);
    await q('update proposal_report set revoked_at = now() where slug=$1 and proposal_id=$2', [(req.params as any).slug, p.id]);
    await audit(req, 'report.revoke', p.name, { proposal: p.id, link: `/r/${(req.params as any).slug}` });
    return { ok: true };
  });
  // Live preview of the client page with the current saved numbers and report settings (not published).
  app.post('/api/proposals/:id/report-preview', async (req) => {
    const p = await load(req, (req.params as any).id);
    const rs = z.object({ reportSettings: ReportSettingsIn.nullish() }).parse(req.body ?? {}).reportSettings;
    return buildSnapshot({ ...p, report_settings: rs ?? p.report_settings });
  });

  // No sign-in: whoever has the link sees the page. Search engines are told not to list it.
  app.get('/api/public/reports/:slug', async (req, reply) => {
    reply.header('x-robots-tag', 'noindex, nofollow').header('cache-control', 'no-store');
    const [r] = await q('update proposal_report set views = views + 1, last_viewed_at = now() where slug=$1 and revoked_at is null returning snapshot', [(req.params as any).slug]);
    if (!r) throw httpError(404, 'This proposal link is no longer active.');
    return r.snapshot;
  });

  app.get('/api/proposals/:id/export', async (req, reply) => {
    const p = await load(req, (req.params as any).id);
    const result = { settings: p.settings, employees: p.results, summary: p.summary } as ProposalResult;
    const buf = await exportWorkbook(p.name, p.headers, p.raw_rows, p.mapping, result);
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', `attachment; filename="${String(p.name).replace(/[^\w .-]/g, '')} - Underwriting.xlsx"`);
    return reply.send(buf);
  });
}
