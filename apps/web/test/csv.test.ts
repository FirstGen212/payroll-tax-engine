import { describe, expect, it } from 'vitest';
import { csvCell } from '../src/api';

describe('CSV downloads', () => {
  it('text a spreadsheet would run as a formula is kept as text', () => {
    expect(csvCell('=HYPERLINK("http://example.com","Click")')).toBe(`"'=HYPERLINK(""http://example.com"",""Click"")"`);
    expect(csvCell('+1 555')).toBe(`"'+1 555"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('-x')).toBe(`"'-x"`);
  });

  it('numbers stay numbers and ordinary text is quoted only when it needs to be', () => {
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(1500)).toBe('1500');
    expect(csvCell('Lee, Pat')).toBe('"Lee, Pat"');
    expect(csvCell('Pat Lee')).toBe('Pat Lee');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});
