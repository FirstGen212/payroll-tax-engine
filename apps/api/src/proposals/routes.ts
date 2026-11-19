import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { CENSUS_COLUMN_ALIASES, DEFAULT_PROPOSAL_SETTINGS, ELIGIBILITY_ORDER, autoMapColumns, rowsFromSheet, runProposal } from '@pte/engine';
import type { CensusRow, ProposalResult, ProposalSettings } from '@pte/engine';
import type { TaxDatabase } from '@pte/tax-data';
import { q } from '../db.js';
import { getTaxDb } from '../taxdb.js';
import { parseWorkbook } from './parse.js';

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
  status: z.enum(['draft', 'sent', 'won', 'lost']).default('draft'),
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
    const sheets = await parseWorkbook(b.fileName, Buffer.from(b.base64, 'base64'));
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

  app.get('/api/proposals', async () =>
    q(`select p.id, p.name, p.company, p.file_name, p.status, p.client_id, c.name client_name, p.summary, p.created_at, p.updated_at
       from proposal p left join client c on c.id = p.client_id order by p.updated_at desc`));

  app.get('/api/proposals/:id', async (req) => {
    const [p] = await q('select * from proposal where id=$1', [(req.params as any).id]);
    if (!p) throw Object.assign(new Error('Proposal not found'), { statusCode: 404 });
    return p;
  });

  const save = async (b: z.infer<typeof Save>, id?: string) => {
    const result = await calculate(b);
    const vals = [b.name, b.clientId ?? null, b.company ?? null, b.fileName ?? null, b.sheetName ?? null, JSON.stringify(b.headers), JSON.stringify(b.rows), JSON.stringify(b.mapping), JSON.stringify(result.settings), JSON.stringify({ ...result.summary, unmatchedMunicipalities: result.unmatchedMunicipalities }), JSON.stringify(result.employees), b.status];
    if (id) {
      const [p] = await q(`update proposal set name=$1, client_id=$2, company=$3, file_name=$4, sheet_name=$5, headers=$6, raw_rows=$7, mapping=$8, settings=$9, summary=$10, results=$11, status=$12, updated_at=now() where id=$13 returning id`, [...vals, id]);
      if (!p) throw Object.assign(new Error('Proposal not found'), { statusCode: 404 });
      return { id: p.id, result };
    }
    const [p] = await q(`insert into proposal (name, client_id, company, file_name, sheet_name, headers, raw_rows, mapping, settings, summary, results, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`, vals);
    return { id: p.id, result };
  };
  app.post('/api/proposals', async (req) => save(Save.parse(req.body)));
  app.put('/api/proposals/:id', async (req) => save(Save.parse(req.body), (req.params as any).id));
  app.delete('/api/proposals/:id', async (req) => {
    await q('delete from proposal where id=$1', [(req.params as any).id]);
    return { ok: true };
  });

  app.get('/api/proposals/:id/export', async (req, reply) => {
    const [p] = await q('select * from proposal where id=$1', [(req.params as any).id]);
    if (!p) throw Object.assign(new Error('Proposal not found'), { statusCode: 404 });
    const result = { settings: p.settings, employees: p.results, summary: p.summary } as ProposalResult;
    const buf = await exportWorkbook(p.name, p.headers, p.raw_rows, p.mapping, result);
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('content-disposition', `attachment; filename="${String(p.name).replace(/[^\w .-]/g, '')} - Underwriting.xlsx"`);
    return reply.send(buf);
  });
}
