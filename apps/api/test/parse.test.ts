import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { MAX_COLUMNS, MAX_ROWS_PER_SHEET, parseWorkbook } from '../src/proposals/parse.js';

const HEAD = ['EMP ID', 'First Name', 'Last Name', 'Hire Date', 'Gross'];
async function xlsx(build: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('reading an uploaded census', () => {
  it('reads values, dates, formula results and a title row above the header', async () => {
    const data = await xlsx((wb) => {
      const ws = wb.addWorksheet('Underwriting');
      ws.addRow(['Made Up Co census']);
      ws.addRow([]);
      ws.addRow(HEAD);
      ws.addRow([1, 'Ada', 'Example', new Date(Date.UTC(2024, 2, 5)), { formula: '1000+500', result: 1500 }]);
      ws.addRow([]);
      ws.addRow([2, 'Ben', 'Sample', null, 2000]);
    });
    const [s] = await parseWorkbook('census.xlsx', data);
    expect(s.name).toBe('Underwriting');
    expect(s.headers).toEqual(HEAD);
    expect(s.rows).toEqual([
      { 'EMP ID': 1, 'First Name': 'Ada', 'Last Name': 'Example', 'Hire Date': '2024-03-05', Gross: 1500 },
      { 'EMP ID': 2, 'First Name': 'Ben', 'Last Name': 'Sample', 'Hire Date': null, Gross: 2000 },
    ]);
    expect(s.truncated).toBeUndefined();
  });

  it('ignores formatting far below the data and a stray cell far to the right', async () => {
    const data = await xlsx((wb) => {
      const ws = wb.addWorksheet('Census');
      ws.addRow(HEAD);
      ws.addRow([1, 'Ada', 'Example', null, 1500]);
      for (let r = 3; r <= 30000; r++) ws.getCell(r, 1).numFmt = '0.00'; // a column formatted well past the last employee
      ws.getCell(1, 9000).value = ' ';
      ws.getCell(2, 9000).value = 'stray';
    });
    const [s] = await parseWorkbook('census.xlsx', data);
    expect(s.headers).toEqual(HEAD);
    expect(s.headers.length).toBeLessThanOrEqual(MAX_COLUMNS);
    expect(s.rows).toHaveLength(1);
  });

  it('reads every tab and stops at the row limit with a flag', async () => {
    const data = await xlsx((wb) => {
      const big = wb.addWorksheet('Big');
      big.addRow(HEAD);
      for (let i = 0; i < MAX_ROWS_PER_SHEET + 40; i++) big.addRow([i + 1, 'First', 'Last', null, 1000]);
      const small = wb.addWorksheet('Small');
      small.addRow(HEAD);
      small.addRow([1, 'Cy', 'Demo', null, 900]);
    });
    const sheets = await parseWorkbook('census.xlsx', data);
    expect(sheets.map((s) => s.name)).toEqual(['Big', 'Small']);
    expect(sheets[0].truncated).toBe(true);
    expect(sheets[0].rows.length).toBeLessThanOrEqual(MAX_ROWS_PER_SHEET + 15);
    expect(sheets[1].rows).toEqual([{ 'EMP ID': 1, 'First Name': 'Cy', 'Last Name': 'Demo', 'Hire Date': null, Gross: 900 }]);
  });

  it('still reads a csv', async () => {
    const [s] = await parseWorkbook('census.csv', Buffer.from('EMP ID,First Name,Last Name\n1,Ada,Example\n'));
    expect(s.rows).toEqual([{ 'EMP ID': '1', 'First Name': 'Ada', 'Last Name': 'Example' }]);
  });
});
