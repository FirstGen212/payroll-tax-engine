import { describe, expect, it, vi } from 'vitest';
import { GF_ALL, GF_BY_GROUP, GF_BY_SIZE, INDUSTRIES, SIZE_BANDS, multipleId, pickMultiple, seedRows } from '../src/proposals/multiples-data.js';
import { multipleNote } from '../src/proposals/report.js';

const table = seedRows();
vi.mock('../src/db.js', () => ({
  pool: {},
  q: vi.fn(async (_sql: string, params: unknown[]) => seedRows().filter((r) => r.industry === params[0])),
  tx: vi.fn(),
}));
const { withTableMultiple } = await import('../src/proposals/routes.js');

describe('valuation multiples', () => {
  it('seeds one public figure, one private average and one private figure per size for every industry', () => {
    const sizes = SIZE_BANDS.length;
    expect(table).toHaveLength(INDUSTRIES.length * (sizes + 1));
    expect(new Set(table.map((r) => r.id)).size).toBe(table.length);
    for (const r of table) {
      expect(r.multiple).toBeGreaterThan(0);
      expect(r.source).toBeTruthy();
      expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.method).toBeTruthy();
    }
  });

  it('marks a figure as published only when it is copied from the source, and shows the sum behind a calculated one', () => {
    const byId = new Map(table.map((r) => [r.id, r]));
    const avg = byId.get(multipleId('home-care', 'private', 'all'))!;
    expect(avg).toMatchObject({ multiple: GF_BY_GROUP['Health Care Services'], basis: 'published' });
    const sized = byId.get(multipleId('home-care', 'private', '10to25'))!;
    expect(sized.basis).toBe('derived');
    expect(sized.multiple).toBe(Math.round(((GF_BY_SIZE['10to25'] * GF_BY_GROUP['Health Care Services']) / GF_ALL) * 10) / 10);
    expect(sized.method).toBe('Calculated: 5.9x for this size (all industries) times 7.6x for Health Care Services, divided by 6.9x for all deals.');
    // "Other or not listed" has no industry adjustment, so its size figures are the published ones.
    expect(byId.get(multipleId('other', 'private', '25to50'))).toMatchObject({ multiple: 6.7, basis: 'published' });
    expect(byId.get(multipleId('oil-gas', 'public', 'all'))).toMatchObject({ multiple: 5.15, basis: 'published' });
  });

  it('gets larger with company size within an industry', () => {
    for (const ind of INDUSTRIES) {
      const bySize = SIZE_BANDS.filter((s) => s.key !== 'all').map((s) => table.find((r) => r.id === multipleId(ind.key, 'private', s.key))!.multiple);
      expect([...bySize].sort((a, b) => a - b)).toEqual(bySize);
    }
  });

  it('picks the industry at that size, the industry average without a size, and never splits public figures by size', () => {
    expect(pickMultiple(table, 'manufacturing', 'private', '50to100')?.id).toBe('manufacturing|private|50to100');
    expect(pickMultiple(table, 'manufacturing', 'private', undefined)?.id).toBe('manufacturing|private|all');
    expect(pickMultiple(table, 'manufacturing', 'public', '50to100')?.id).toBe('manufacturing|public|all');
    expect(pickMultiple(table, 'Energy (Oil & Gas)', 'private', 'all')).toBeUndefined();
    expect(pickMultiple(table, '', 'private', 'all')).toBeUndefined();
  });

  it('fills the multiple into the settings from the table, with where it came from', async () => {
    const s = await withTableMultiple({ industry: 'home-care', ownership: 'private', companySize: '10to25', ebitdaMultiple: 5.2 });
    expect(s.ebitdaMultiple).toBe(6.5);
    expect(s.multipleInfo).toMatchObject({ industry: 'Home care and home health', size: '$10M to $25M', ownership: 'private', basis: 'derived' });
    expect(multipleNote(s.multipleInfo)).toBe('Typical for private companies (Home care and home health, $10M to $25M in value). Calculated from GF Data averages.');
    const pub = await withTableMultiple({ industry: 'home-care', ownership: 'public', companySize: '10to25', ebitdaMultiple: 5.2 });
    expect(pub.ebitdaMultiple).toBe(11.17);
    expect(multipleNote(pub.multipleInfo)).toBe('Typical for public companies (Home care and home health). Source: NYU Stern.');
  });

  it('leaves a typed multiple and an unknown industry alone, and drops a stale source note', async () => {
    const stale = { industry: 'Home care and home health', size: null, ownership: 'private' as const, basis: 'published' as const, source: 'GF Data', asOf: null, method: null };
    const typed = await withTableMultiple({ industry: 'home-care', multipleAuto: false, ebitdaMultiple: 4, multipleInfo: stale });
    expect(typed).toMatchObject({ ebitdaMultiple: 4 });
    expect(typed.multipleInfo).toBeUndefined();
    const old = await withTableMultiple({ industry: 'Energy (Oil & Gas)', ebitdaMultiple: 5.2 });
    expect(old).toMatchObject({ ebitdaMultiple: 5.2 });
    expect(old.multipleInfo).toBeUndefined();
    expect(multipleNote(undefined)).toBe('');
  });
});
