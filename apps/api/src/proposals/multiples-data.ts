/**
 * Typical EBITDA multiples by industry and company size: the seed for the valuation_multiple table.
 *
 * Nothing here is invented. Each figure is either copied from a published dataset or calculated from
 * published figures by the stated method, and every row says which. People with permission can edit
 * any cell in the app; an edited cell is marked as First Gen's own figure and can be reset.
 *
 * Private companies: GF Data (ACG), average enterprise value / trailing adjusted EBITDA on
 * private-equity-sponsored deals.
 * Public companies: NYU Stern (Aswath Damodaran), EV/EBITDA by US industry, firms with positive EBITDA.
 */

export type Ownership = 'private' | 'public';
export type Basis = 'published' | 'derived' | 'custom';

export interface SizeBand { key: string; label: string; short: string }
/** Company size is enterprise value, because that is how the published deal data is grouped. */
export const SIZE_BANDS: SizeBand[] = [
  { key: 'all', label: 'Any size (industry average)', short: 'Any size' },
  { key: 'under5', label: 'Under $5M in value', short: 'Under $5M' },
  { key: '5to10', label: '$5M to $10M in value', short: '$5M to $10M' },
  { key: '10to25', label: '$10M to $25M in value', short: '$10M to $25M' },
  { key: '25to50', label: '$25M to $50M in value', short: '$25M to $50M' },
  { key: '50to100', label: '$50M to $100M in value', short: '$50M to $100M' },
  { key: '100to250', label: '$100M to $250M in value', short: '$100M to $250M' },
  { key: '250to500', label: '$250M to $500M in value', short: '$250M to $500M' },
];

const GF_SIZE_SOURCE = { source: 'GF Data, Fourth Quarter 2024 highlights (deals 2003 to 2024)', url: 'https://middlemarketgrowth.org/wp-content/uploads/2025/04/GF-Data-4th-Quarter-Highlights-and-Products.pdf', asOf: '2024-12-31' };
const GF_SMALL_SOURCE = { source: 'GF Data, first half 2025 deals under $10M, as reported by CapitalPad', url: null as string | null, asOf: '2025-06-30' };
const GF_INDUSTRY_SOURCE = { source: 'GF Data, Private Equity Mid-Market Overview, Third Quarter 2024 (deals of $10M to $250M, 2003 to 2024)', url: 'https://www.acg.org/sites/default/files/2024-11/GF%20Data%20Slide%20Deck.pdf', asOf: '2024-09-30' };
const STERN_SOURCE = { source: 'NYU Stern (Damodaran), Enterprise Value Multiples by Sector (US), firms with positive EBITDA', url: 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/vebitda.html', asOf: '2026-01-01' };

/** GF Data, all industries, average multiple by enterprise value. */
export const GF_BY_SIZE: Record<string, number> = { under5: 5.5, '5to10': 5.6, '10to25': 5.9, '25to50': 6.7, '50to100': 7.7, '100to250': 8.5, '250to500': 9.9 };
/** GF Data, all sizes, all industries. */
export const GF_ALL = 6.9;
/** GF Data, average multiple by its eight business groups. */
export const GF_BY_GROUP: Record<string, number> = { Manufacturing: 6.4, 'Business Services': 6.9, 'Health Care Services': 7.6, Retail: 7.0, Distribution: 6.8, 'Media & Telecom': 7.6, Technology: 8.6, Other: 6.4 };

export interface Industry { key: string; label: string; gfGroup: keyof typeof GF_BY_GROUP | null; stern: string; sternMultiple: number }
/**
 * The industries a proposal can pick. Each points at the closest GF Data group (private) and NYU Stern
 * industry (public). GF Data publishes eight groups, so several industries share one group's figure.
 */
export const INDUSTRIES: Industry[] = [
  { key: 'home-care', label: 'Home care and home health', gfGroup: 'Health Care Services', stern: 'Healthcare Support Services', sternMultiple: 11.17 },
  { key: 'healthcare-facilities', label: 'Healthcare practices and facilities', gfGroup: 'Health Care Services', stern: 'Hospitals/Healthcare Facilities', sternMultiple: 8.86 },
  { key: 'childcare-education', label: 'Childcare and education', gfGroup: 'Other', stern: 'Education', sternMultiple: 9.26 },
  { key: 'staffing-professional', label: 'Staffing and professional services', gfGroup: 'Business Services', stern: 'Business & Consumer Services', sternMultiple: 14.26 },
  { key: 'facility-services', label: 'Security, janitorial and facility services', gfGroup: 'Business Services', stern: 'Business & Consumer Services', sternMultiple: 14.26 },
  { key: 'environmental-waste', label: 'Environmental and waste services', gfGroup: 'Business Services', stern: 'Environmental & Waste Services', sternMultiple: 15.61 },
  { key: 'construction', label: 'Construction and contracting', gfGroup: 'Other', stern: 'Engineering/Construction', sternMultiple: 17.18 },
  { key: 'manufacturing', label: 'Manufacturing', gfGroup: 'Manufacturing', stern: 'Machinery', sternMultiple: 16.22 },
  { key: 'food-manufacturing', label: 'Food manufacturing', gfGroup: 'Manufacturing', stern: 'Food Processing', sternMultiple: 10.01 },
  { key: 'distribution', label: 'Wholesale and distribution', gfGroup: 'Distribution', stern: 'Retail (Distributors)', sternMultiple: 13.71 },
  { key: 'food-distribution', label: 'Food distribution', gfGroup: 'Distribution', stern: 'Food Wholesalers', sternMultiple: 11.08 },
  { key: 'retail', label: 'Retail', gfGroup: 'Retail', stern: 'Retail (General)', sternMultiple: 17.38 },
  { key: 'grocery', label: 'Grocery', gfGroup: 'Retail', stern: 'Retail (Grocery and Food)', sternMultiple: 8.94 },
  { key: 'auto-retail', label: 'Auto dealers and repair', gfGroup: 'Retail', stern: 'Retail (Automotive)', sternMultiple: 14.79 },
  { key: 'restaurants', label: 'Restaurants and food service', gfGroup: 'Other', stern: 'Restaurant/Dining', sternMultiple: 17.49 },
  { key: 'hospitality', label: 'Hotels and hospitality', gfGroup: 'Other', stern: 'Hotel/Gaming', sternMultiple: 14.93 },
  { key: 'transportation', label: 'Transportation and logistics', gfGroup: 'Other', stern: 'Transportation', sternMultiple: 12.55 },
  { key: 'trucking', label: 'Trucking', gfGroup: 'Other', stern: 'Trucking', sternMultiple: 10.41 },
  { key: 'software', label: 'Technology and software', gfGroup: 'Technology', stern: 'Software (System & Application)', sternMultiple: 24.48 },
  { key: 'it-services', label: 'IT services', gfGroup: 'Technology', stern: 'Computer Services', sternMultiple: 14.1 },
  { key: 'media-telecom', label: 'Media and telecom', gfGroup: 'Media & Telecom', stern: 'Telecom. Services', sternMultiple: 6.54 },
  { key: 'oil-gas', label: 'Energy: oil and gas production', gfGroup: 'Other', stern: 'Oil/Gas (Production and Exploration)', sternMultiple: 5.15 },
  { key: 'oilfield-services', label: 'Energy: oilfield services', gfGroup: 'Other', stern: 'Oilfield Svcs/Equip.', sternMultiple: 8.63 },
  { key: 'real-estate', label: 'Real estate and property management', gfGroup: 'Other', stern: 'Real Estate (Operations & Services)', sternMultiple: 21.95 },
  { key: 'agriculture', label: 'Agriculture', gfGroup: 'Other', stern: 'Farming/Agriculture', sternMultiple: 16.04 },
  { key: 'other', label: 'Other or not listed', gfGroup: null, stern: 'Total Market (without financials)', sternMultiple: 16.95 },
];

export interface MultipleRow {
  id: string; industry: string; ownership: Ownership; sizeBand: string; multiple: number; basis: Basis;
  source: string; sourceUrl: string | null; asOf: string; method: string | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
export const multipleId = (industry: string, ownership: Ownership, sizeBand: string) => `${industry}|${ownership}|${sizeBand}`;

/** Every seeded row: for each industry one public figure, one private industry average and one private figure per size band. */
export function seedRows(): MultipleRow[] {
  const rows: MultipleRow[] = [];
  for (const ind of INDUSTRIES) {
    rows.push({ id: multipleId(ind.key, 'public', 'all'), industry: ind.key, ownership: 'public', sizeBand: 'all', multiple: ind.sternMultiple, basis: 'published',
      source: STERN_SOURCE.source, sourceUrl: STERN_SOURCE.url, asOf: STERN_SOURCE.asOf, method: `NYU Stern industry: ${ind.stern}.` });
    const group = ind.gfGroup;
    const avg = group ? GF_BY_GROUP[group] : GF_ALL;
    rows.push({ id: multipleId(ind.key, 'private', 'all'), industry: ind.key, ownership: 'private', sizeBand: 'all', multiple: avg, basis: 'published',
      source: group ? GF_INDUSTRY_SOURCE.source : GF_SIZE_SOURCE.source, sourceUrl: group ? GF_INDUSTRY_SOURCE.url : GF_SIZE_SOURCE.url, asOf: group ? GF_INDUSTRY_SOURCE.asOf : GF_SIZE_SOURCE.asOf,
      method: group ? `GF Data group: ${group}.` : 'GF Data average for all industries.' });
    for (const [band, sizeAvg] of Object.entries(GF_BY_SIZE)) {
      const src = band === 'under5' || band === '5to10' ? GF_SMALL_SOURCE : GF_SIZE_SOURCE;
      rows.push({ id: multipleId(ind.key, 'private', band), industry: ind.key, ownership: 'private', sizeBand: band,
        multiple: group ? r1((sizeAvg * avg) / GF_ALL) : sizeAvg, basis: group ? 'derived' : 'published',
        source: group ? `${src.source}; ${GF_INDUSTRY_SOURCE.source}` : src.source, sourceUrl: src.url, asOf: src.asOf,
        method: group ? `Calculated: ${sizeAvg}x for this size (all industries) times ${avg}x for ${group}, divided by ${GF_ALL}x for all deals.` : 'GF Data average for all industries at this size.' });
    }
  }
  return rows;
}

/**
 * The row for a proposal: the industry at that size, or the industry average when the size is not set
 * (public figures are not split by size). An unknown industry has no row, so the caller keeps its own number.
 */
export function pickMultiple<T extends { industry: string; ownership: string; sizeBand: string }>(rows: T[], industry: string | undefined, ownership: Ownership | undefined, sizeBand: string | undefined): T | undefined {
  if (!industry) return undefined;
  const own = ownership ?? 'private';
  const mine = rows.filter((r) => r.industry === industry && r.ownership === own);
  return (own === 'private' ? mine.find((r) => r.sizeBand === (sizeBand || 'all')) : undefined) ?? mine.find((r) => r.sizeBand === 'all');
}

export const industryLabel = (key?: string) => INDUSTRIES.find((i) => i.key === key)?.label;
export const sizeLabel = (key?: string) => SIZE_BANDS.find((s) => s.key === key);
