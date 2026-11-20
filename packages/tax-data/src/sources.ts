import type { Source } from './types.js';

/**
 * Citation registry. Every rule references one or more of these ids.
 * Agency sources are the source of truth; secondary sources are listed only
 * where the agency document could not be read directly and are labeled as such.
 */
export const SOURCES: Source[] = [
  // ---- Federal ----
  { id: 'irs-rp-2026-35', agency: 'IRS', title: 'Rev. Proc. 2026-35 (2027 inflation adjustments)', url: 'https://www.irs.gov/pub/irs-drop/rp-26-35.pdf', retrieved: '2026-11-19' },
  { id: 'irs-ir-2026-133', agency: 'IRS', title: 'IR-2026-133: IRS releases tax inflation adjustments for tax year 2027', url: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2027-taxpayers-continue-to-benefit-from-the-working-families-tax-cuts', retrieved: '2026-11-19' },
  { id: 'taxfoundation-2027', agency: 'Tax Foundation (secondary)', title: '2027 Tax Brackets (citing Rev. Proc. 2026-35; source for HoH thresholds)', url: 'https://taxfoundation.org/data/all/federal/2027-tax-brackets/', retrieved: '2026-11-19' },
  { id: 'irs-p15t-2027-draft', agency: 'IRS', title: 'Publication 15-T (2027) early release draft, Nov 9 2026', url: 'https://www.irs.gov/pub/irs-dft/p15t--dft.pdf', retrieved: '2026-11-19', notes: 'Tables are in an Excel attachment to the PDF; engine derives tables from Rev. Proc. 2026-35 until the final is loaded.' },
  { id: 'irs-rp-2025-32', agency: 'IRS', title: 'Rev. Proc. 2025-32 (2026 inflation adjustments incl. P.L. 119-21)', url: 'https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill' },
  { id: 'irs-p15t-2026', agency: 'IRS', title: 'Publication 15-T (2026), Federal Income Tax Withholding Methods', url: 'https://www.irs.gov/pub/irs-pdf/p15t.pdf' },
  { id: 'irs-p15t-2025', agency: 'IRS', title: 'Publication 15-T (2025)', url: 'https://www.irs.gov/pub/irs-prior/p15t--2025.pdf' },
  { id: 'irs-rp-2024-40', agency: 'IRS', title: 'Rev. Proc. 2024-40 (2025 inflation adjustments)', url: 'https://www.irs.gov/pub/irs-drop/rp-24-40.pdf' },
  { id: 'irs-p15', agency: 'IRS', title: "Publication 15 (Circular E), Employer's Tax Guide", url: 'https://www.irs.gov/publications/p15' },
  { id: 'irs-p15b', agency: 'IRS', title: "Publication 15-B, Employer's Tax Guide to Fringe Benefits", url: 'https://www.irs.gov/publications/p15b' },
  { id: 'irs-p15a', agency: 'IRS', title: "Publication 15-A, Employer's Supplemental Tax Guide", url: 'https://www.irs.gov/publications/p15a' },
  { id: 'irs-p1494', agency: 'IRS', title: 'Publication 1494, Table for Figuring Amount Exempt From Levy on Wages', url: 'https://www.irs.gov/pub/irs-pdf/p1494.pdf' },
  { id: 'irs-p80', agency: 'IRS', title: 'Publication 80 (Circular SS), Federal Tax Guide for Employers in the USVI, Guam, American Samoa, and CNMI', url: 'https://www.irs.gov/publications/p80' },
  { id: 'irs-p179', agency: 'IRS', title: 'Publicación 179 (Circular PR), Guía Contributiva Federal para Patronos Puertorriqueños', url: 'https://www.irs.gov/pub/irs-pdf/p179.pdf' },
  { id: 'irs-futa-credit-reduction', agency: 'US DOL / IRS', title: 'FUTA credit reduction states', url: 'https://oui.doleta.gov/unemploy/futa_credit.asp' },
  { id: 'irs-401k-limits', agency: 'IRS', title: 'COLA increases for dollar limitations on benefits and contributions', url: 'https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions' },
  { id: 'irs-hsa-rp', agency: 'IRS', title: 'HSA inflation-adjusted amounts (annual Rev. Proc.)', url: 'https://www.irs.gov/publications/p969' },
  { id: 'ssa-cola-2027', agency: 'SSA', title: '2027 Social Security Changes / Contribution and Benefit Base ($192,300)', url: 'https://www.ssa.gov/oact/cola/cbb.html', notes: 'Figure confirmed in multiple secondary reports (APA, Journal of Accountancy, Oct 2026).' },
  { id: 'ssa-cbb', agency: 'SSA', title: 'Contribution and Benefit Base history', url: 'https://www.ssa.gov/oact/cola/cbb.html' },
  { id: 'dol-ccpa', agency: 'US DOL', title: 'Consumer Credit Protection Act Title III (wage garnishment)', url: 'https://www.dol.gov/agencies/whd/garnishment' },
  { id: 'ed-awg', agency: 'US Dept. of Education', title: 'Administrative Wage Garnishment (15% of disposable pay)', url: 'https://www.ed.gov/' },
  { id: 'pl-119-21', agency: 'Congress', title: 'P.L. 119-21 (2025 reconciliation act): qualified tips and overtime deductions, W-2 reporting', url: 'https://www.congress.gov/bill/119th-congress/house-bill/1' },

  // ---- Compilations and agency pages read for the November 2026 re-verification ----
  { id: 'ey-sui-2026', agency: 'EY (secondary)', title: 'State unemployment insurance wage bases and rates for 2025 and 2026', url: 'https://taxnews.ey.com/news/2026-1640-state-unemployment-insurance-wage-bases-and-tax-rates-for-2026-updated-as-of-july-29-2026', retrieved: '2026-11-20', notes: 'State-by-state compilation citing each workforce agency.' },
  { id: 'aps-sui-2027', agency: 'APS Payroll (secondary)', title: '2027 state unemployment wage bases', url: 'https://apspayroll.com/insights/suta-wage-bases/', retrieved: '2026-11-20', notes: 'Covers the states that had announced 2027 by November 2026.' },
  { id: 'mercer-pfml-2026', agency: 'Mercer (secondary)', title: '2026 state paid family and medical leave and disability contribution rates', url: 'https://marketingpreview.mercer.com/content/dam/mercer-dotcom/migrated-assets/blogs/law-and-policy/2026/02/pdf-2026-state-paid-family-and-medical-leave-contributions-and-benefits.pdf', retrieved: '2026-11-20' },
  { id: 'nfp-wa-pfml-2027', agency: 'NFP (secondary)', title: 'Washington Paid Family and Medical Leave 2027 premium rate', url: 'https://www.nfp.com/insights/washington-announces-2027-paid-family-and-medical-leave-premium-rate/', retrieved: '2026-11-20' },
  { id: 'ny-dfs-pfl-2027', agency: 'NY Department of Financial Services', title: 'Paid Family Leave premium rate for 2027', url: 'https://www.dfs.ny.gov/apps-and-licensing/health-insurers/pfl-rate-decision-2027-page', retrieved: '2026-11-20' },
  { id: 'ma-dfml-2027', agency: 'MA Department of Family and Medical Leave', title: 'PFML contribution rates for 2026 and 2027', url: 'https://www.mass.gov/', retrieved: '2026-11-20' },
  { id: 'md-famli-2027', agency: 'Maryland Department of Labor', title: 'FAMLI contribution rate from January 1, 2027', url: 'https://paidleave.maryland.gov/', retrieved: '2026-11-20' },
  { id: 'edd-de44-2026', agency: 'California EDD', title: 'DE 44 California withholding schedules for 2026 (Method B)', url: 'https://edd.ca.gov/siteassets/files/pdf_pub_ctr/26methb.pdf', retrieved: '2026-11-20' },
  { id: 'edd-de44-2027', agency: 'California EDD', title: 'California withholding schedules for 2027 (Method B)', url: 'https://edd.ca.gov/siteassets/files/pdf_pub_ctr/27methb.pdf', retrieved: '2026-11-20' },
  { id: 'edd-rates', agency: 'California EDD', title: 'Rates and withholding: SDI, UI and ETT', url: 'https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/', retrieved: '2026-11-20' },
  { id: 'irs-n-2026-66', agency: 'IRS', title: 'Notice 2026-66: 2027 retirement plan limits', url: 'https://www.irs.gov/retirement-plans/cola-increases-for-dollar-limitations-on-benefits-and-contributions', retrieved: '2026-11-20' },
  { id: 'irs-rp-2026-24', agency: 'IRS', title: 'Rev. Proc. 2026-24: 2027 HSA and high-deductible plan amounts', url: 'https://www.irs.gov/pub/irs-drop/rp-26-24.pdf', retrieved: '2026-11-20' },
  { id: 'dol-futa-2026', agency: 'US DOL', title: 'FUTA credit reduction determination for 2026 (November 10, 2026)', url: 'https://oui.doleta.gov/unemploy/futa_credit.asp', retrieved: '2026-11-20' },

  { id: 'symetra-pfml-2027', agency: 'Symetra (secondary)', title: 'Statutory disability and paid family and medical leave programs (updated October 8, 2026)', url: 'https://benefitsbrokersconsultants.symetra.com/learn/articles-for-employers/statutory-disability-income-and-state-paid-family-and-medical-leave/statutory-disability-income-paid-family-medical-leave-programs/', retrieved: '2026-11-20' },
  { id: 'hrmorning-co-famli-2027', agency: 'HRMorning (secondary)', title: 'Colorado FAMLI premium rate for 2027', url: 'https://www.hrmorning.com/news/colorado-famli-premium-rate/', retrieved: '2026-11-20' },
  { id: 'co-dr1098-2027', agency: 'Colorado Department of Revenue', title: 'DR 1098, 2027 Colorado Withholding Worksheet for Employers (November 17, 2026)', url: 'https://tax.colorado.gov/sites/default/files/2026-11/DR_1098_2027.pdf', retrieved: '2026-11-20' },
  // ---- Generic state agency entry points (row-level notes refine these) ----
  { id: 'fta-state-rates', agency: 'Federation of Tax Administrators (secondary)', title: 'State individual income tax rates / agency directory', url: 'https://taxadmin.org/' },
  { id: 'dol-sui-comparison', agency: 'US DOL (secondary)', title: 'Comparison of State Unemployment Insurance Laws', url: 'https://oui.doleta.gov/unemploy/statelaws.asp' },
  { id: 'research-memory-2026', agency: 'Internal research', title: 'Researcher-entered values pending agency verification', url: '', notes: 'Rows citing only this source are status unverified by construction.' },
];

export const sourceById = new Map(SOURCES.map((s) => [s.id, s]));

/** Register a state/local agency source on the fly (used by state data modules). */
export function agencySource(id: string, agency: string, title: string, url: string): Source {
  if (!sourceById.has(id)) {
    const s = { id, agency, title, url };
    SOURCES.push(s);
    sourceById.set(id, s);
  }
  return sourceById.get(id)!;
}
