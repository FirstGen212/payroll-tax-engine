/** The client-facing proposal page: its editable settings and the snapshot a published link shows. */
import { z } from 'zod';
import type { ProposalEmployeeResult, ProposalSummary } from '@pte/engine';

export interface ReportSettings {
  title?: string;
  presentedBy: string;
  subtitle: string;
  intro: string;
  /** What the employee section shows: nothing, counts by status, or the list of eligible employees. */
  showEmployees: 'none' | 'counts' | 'list';
  /** Columns of the employee list. */
  employeeColumns: ('state' | 'plan' | 'deduction' | 'employeeSavings' | 'employerSavings')[];
  showValuation: boolean;
  showCompanies: boolean;
  /** Show the uploaded file's name next to "Last updated". */
  showSource: boolean;
  steps: { title: string; text: string }[];
  ctaHeading: string;
  ctaText: string;
  ctaLabel: string;
  ctaUrl: string;
  contactEmail: string;
  address: string;
  disclaimer: string;
}

export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  presentedBy: 'First Gen Financial',
  subtitle: 'First Gen Health Summary',
  intro: '',
  showEmployees: 'list',
  employeeColumns: ['plan', 'deduction', 'employeeSavings', 'employerSavings'],
  showValuation: true,
  showCompanies: true,
  showSource: true,
  steps: [
    { title: 'Employee education', text: 'Through live, email, and SMS our team educates your employees and admin team.' },
    { title: 'Payroll implementation', text: 'We alleviate any administrative burden and work with you to get deductions and reimbursements set up in your payroll system.' },
    { title: 'Customer portal access', text: 'Easily add new employees or unenroll employees with our Customer Portal.' },
  ],
  ctaHeading: 'Ready for next steps?',
  ctaText: 'Review and sign our Account Opening Paperwork to get started.',
  ctaLabel: 'Account Opening Paperwork',
  ctaUrl: '',
  contactEmail: 'Operations@1gfg.com',
  address: '99 Wall Street #5012, New York, NY 10005',
  disclaimer: 'All figures are estimates only. Per-paycheck amounts are the annual figures divided by the pay periods per year. In particular, the EBITDA multiple and resulting valuation increase are illustrative and can change materially based on market conditions and transaction specifics. This is not financial, tax, or legal advice. Consult your advisors.',
};

/** What the page editor may send. Everything is optional (defaults fill the rest) and sized so a page stays a page. */
export const ReportSettingsIn = z.object({
  title: z.string().max(200),
  presentedBy: z.string().max(120),
  subtitle: z.string().max(160),
  intro: z.string().max(2000),
  showEmployees: z.enum(['none', 'counts', 'list']),
  employeeColumns: z.array(z.enum(['state', 'plan', 'deduction', 'employeeSavings', 'employerSavings'])).max(5),
  showValuation: z.boolean(),
  showCompanies: z.boolean(),
  showSource: z.boolean(),
  steps: z.array(z.object({ title: z.string().max(120), text: z.string().max(600) })).max(6),
  ctaHeading: z.string().max(160),
  ctaText: z.string().max(600),
  ctaLabel: z.string().max(80),
  ctaUrl: z.string().max(500),
  contactEmail: z.string().max(200),
  address: z.string().max(300),
  disclaimer: z.string().max(4000),
}).partial();

const FREQ_LABEL: Record<string, string> = { weekly: 'Weekly', biweekly: 'Bi-Weekly', semimonthly: 'Semi-Monthly', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual', daily: 'Daily' };

/** Saved settings over the defaults. Anything saved in a shape the page can't use falls back to the default. */
export const mergeReportSettings = (r?: unknown): ReportSettings => {
  const parsed = ReportSettingsIn.safeParse(r ?? {});
  const given = parsed.success ? Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) : {};
  return { ...DEFAULT_REPORT_SETTINGS, ...given };
};

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '') || 'proposal';
export const newSlug = (name: string, rand: string) => `${slugify(name)}-${rand}`;

/** Freeze what the client sees. Later edits to the proposal don't change a link that was already sent. */
export function buildSnapshot(p: { name: string; company?: string | null; file_name?: string | null; settings: any; summary: ProposalSummary; results: ProposalEmployeeResult[]; report_settings?: unknown }) {
  const rs = mergeReportSettings(p.report_settings);
  const s = p.summary;
  const company = p.company || p.name.replace(/ proposal$/i, '');
  const periods = s.payFrequency?.periodsPerYear || 26;
  const enrolled = (p.results ?? []).filter((e) => e.eligibility === 'Eligible' || e.eligibility === 'PT Eligible');
  const rate = s.participationRate ?? 1;
  return {
    company,
    title: rs.title || `${company} Proposal`,
    presentedBy: rs.presentedBy,
    subtitle: rs.subtitle,
    intro: rs.intro,
    sourceFile: rs.showSource ? p.file_name ?? null : null,
    generatedAt: new Date().toISOString(),
    planYear: p.settings?.year,
    ebitdaMultiple: p.settings?.ebitdaMultiple,
    employerAnnualSavings: s.employerAnnualSavings.total,
    valuationIncrease: s.valuationIncrease,
    perPeriodSavings: Math.round((s.employerAnnualSavings.total / periods) * 100) / 100,
    payFrequency: { label: FREQ_LABEL[s.payFrequency?.frequency ?? 'biweekly'] ?? 'Bi-Weekly', periodsPerYear: periods },
    employeesReviewed: s.employees,
    eligible: s.eligibleTotal,
    eligibleFull: s.eligibleFull,
    eligiblePartTime: s.eligiblePartTime,
    projectedEnrolled: s.projectedEnrolled ?? s.eligibleTotal,
    participationRate: rate,
    employeeAnnualTaxSavings: s.employeeAnnualTaxSavings,
    benefitPackage: s.benefitPackage?.name,
    // Rows the reviewer left out are an internal decision, not a status the client needs to see.
    byStatus: Object.fromEntries(Object.entries(s.byEligibility ?? {}).filter(([k]) => k !== 'Excluded')),
    companies: rs.showCompanies && (s.byCompany?.length ?? 0) > 1 ? s.byCompany : [],
    employees: rs.showEmployees === 'list'
      ? enrolled.map((e) => {
          const pt = e.eligibility === 'PT Eligible';
          const m = pt ? e.partTime!.calc.monthly : e.monthly!;
          return {
            name: e.name,
            state: e.row.workState,
            plan: pt ? 'Part-time' : 'Full',
            deductionPerCheck: pt ? e.partTime!.deductionPerCheck : e.perPeriod?.firstGen,
            employeeMonthlySavings: pt ? e.partTime!.allotment : e.monthly!.allotment,
            employerAnnualSavings: Math.round(m.employerTaxSavings * 12 * 100) / 100,
          };
        }).sort((a, b) => a.name.localeCompare(b.name))
      : [],
    showEmployees: rs.showEmployees,
    employeeColumns: rs.employeeColumns,
    showValuation: rs.showValuation,
    steps: rs.steps,
    ctaHeading: rs.ctaHeading,
    ctaText: rs.ctaText,
    ctaLabel: rs.ctaLabel,
    ctaUrl: /^https?:\/\//.test(rs.ctaUrl) ? rs.ctaUrl : '',
    contactEmail: rs.contactEmail.trim(),
    address: rs.address,
    disclaimer: rs.disclaimer,
  };
}
