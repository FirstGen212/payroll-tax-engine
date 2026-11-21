import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { loadTaxDatabase } from '@pte/tax-data';
import { runProposal } from '@pte/engine';
import type { CensusRow } from '@pte/engine';

vi.mock('../src/db.js', () => ({ pool: {}, q: vi.fn(async () => []) }));
const { exportWorkbook, ProgramPrices } = await import('../src/proposals/routes.js');

const base: CensusRow = { rowNumber: 2, employeeId: '1', firstName: 'Pat', lastName: 'Lee', company: 'Acme', workState: 'TX', grossPay: 1000, payFrequency: 'Weekly', hoursPerPeriod: 40, federalFilingStatus: 'Single' };
const rows: CensusRow[] = [
  base,
  { ...base, rowNumber: 3, employeeId: '2', firstName: 'Ana', lastName: 'Diaz', grossPay: 1400 },
  { ...base, rowNumber: 4, employeeId: '3', firstName: 'Sam', lastName: 'Cole', grossPay: 480 }, // under the pay minimum
  { ...base, rowNumber: 5, employeeId: '4', firstName: 'Lou', lastName: 'Park', hoursPerPeriod: 20 }, // part-time plan
];
const settings = { year: 2027, deductionByFrequency: { weekly: 200 }, useRowDeduction: false, allotmentThreshold: 100, partTime: { enabled: true, deductionPerCheck: 120, allotmentThreshold: 50, maxHoursPerWeek: 29, maxAnnualGross: 20000 } };
const headers = ['First Name', 'Last Name', 'Gross Pay'];
const raw = rows.map((r) => ({ 'First Name': r.firstName, 'Last Name': r.lastName, 'Gross Pay': r.grossPay }));

async function workbook(result = runProposal(rows, settings, loadTaxDatabase())) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await exportWorkbook('Acme proposal', headers, raw, {}, result)) as any); // exceljs types predate Node's generic Buffer (as in parse.ts)
  return { wb, result };
}
const line = (ws: ExcelJS.Worksheet, n: number) => (ws.getRow(n).values as unknown[]).slice(1);
const num = (v: unknown) => (v && typeof v === 'object' && 'result' in v ? Number((v as { result: unknown }).result) : Number(v));

describe('proposal export', () => {
  it('opens on a sheet with every employee, their status and their savings allotment', async () => {
    const { wb, result } = await workbook();
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Employee allotments', 'Summary', 'Underwriting']);
    const ws = wb.getWorksheet('Employee allotments')!;
    const head = line(ws, 1) as string[];
    expect(head.slice(0, 3)).toEqual(['Employee', 'Employee ID', 'Company']);
    const col = (name: string) => head.indexOf(name);
    const people = [2, 3, 4, 5].map((n) => line(ws, n));
    // On a plan first (full, then part-time), then everyone else; by name within each
    expect(people.map((p) => [p[col('Employee')], p[col('Status')], p[col('Plan')]])).toEqual([
      ['Ana Diaz', 'Eligible', 'Full'],
      ['Pat Lee', 'Eligible', 'Full'],
      ['Lou Park', 'Eligible (part-time plan)', 'Part-time'],
      ['Sam Cole', 'Not eligible: Pay under the minimum', ''],
    ]);
    const pat = result.employees.find((e) => e.name === 'Pat Lee')!;
    const lou = result.employees.find((e) => e.name === 'Lou Park')!;
    expect(people[1][col('Savings allotment per month')]).toBe(pat.monthly!.allotment);
    expect(people[1][col('Savings allotment per year')]).toBeCloseTo(pat.monthly!.allotment * 12, 2);
    expect(people[1][col('Pre-tax deduction per check')]).toBe(200);
    // The part-time plan's own deduction and allotment, not the full plan's
    expect(people[2][col('Pre-tax deduction per check')]).toBe(120);
    expect(people[2][col('Savings allotment per month')]).toBe(lou.partTime!.allotment);
    // Not on a plan: no allotment to pay, but the reason and what would change it
    expect(people[3][col('Savings allotment per month')]).toBeUndefined();
    expect(people[3][col('Why')]).toMatch(/plan starts above \$26,000/);
    expect(people[3][col('What would change it')]).toMatch(/^Would qualify at about \$501 per check/);
    // The totals row adds up to the proposal
    const total = line(ws, 6);
    expect(total[0]).toBe('Total for the 3 on a plan');
    expect(num(total[col('Savings allotment per month')])).toBeCloseTo(result.summary.monthlySavings.total, 2);
    expect(num(total[col('Employer tax savings per year')])).toBeCloseTo(result.summary.employerAnnualSavings.total, 1);
  });

  it('adds the allotment and the client wording to the underwriting sheet', async () => {
    const { wb, result } = await workbook();
    const ws = wb.getWorksheet('Underwriting')!;
    const head = line(ws, 1) as string[];
    expect(head.slice(0, 3)).toEqual(headers);
    expect(head).toEqual(expect.arrayContaining(['Monthly allotment', 'Status', 'Why', 'What would change it']));
    const pat = line(ws, 2);
    expect(pat[head.indexOf('Monthly allotment')]).toBe(result.employees[0].monthly!.allotment);
    expect(pat[head.indexOf('Status')]).toBe('Eligible');
  });

  it('still exports a proposal saved before results carried the client wording', async () => {
    const result = runProposal(rows, settings, loadTaxDatabase());
    for (const e of result.employees) delete e.explanation;
    const { wb } = await workbook(result);
    const ws = wb.getWorksheet('Employee allotments')!;
    const head = line(ws, 1) as string[];
    expect([2, 3, 4, 5].map((n) => line(ws, n)[head.indexOf('Status')])).toEqual(['Eligible', 'Eligible', 'Eligible (part-time plan)', 'Not eligible: Low Income']);
  });
});

describe('program prices a request may ask for', () => {
  it('takes up to 12 prices from $1 to $5,000 and refuses the rest, so one request cannot ask for thousands of price points', () => {
    expect(ProgramPrices.parse([159, 149, 139, 129])).toEqual([159, 149, 139, 129]);
    expect(ProgramPrices.safeParse(Array(13).fill(100)).success).toBe(false);
    expect(ProgramPrices.safeParse([]).success).toBe(false);
    expect(ProgramPrices.safeParse([0]).success).toBe(false);
    expect(ProgramPrices.safeParse([5001]).success).toBe(false);
    expect(ProgramPrices.safeParse([Number.NaN]).success).toBe(false);
  });
});
