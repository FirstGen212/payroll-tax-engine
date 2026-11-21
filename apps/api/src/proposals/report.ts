/** The client-facing proposal page: its editable settings and the snapshot a published link shows. */
import { z } from 'zod';
import type { EmployeeExplanation, ProposalEmployeeResult, ProposalSettings, ProposalSummary } from '@pte/engine';

export interface ReportSettings {
  title?: string;
  presentedBy: string;
  subtitle: string;
  intro: string;
  /** What the employee section shows: nothing, counts by status, the eligible employees, or everyone with their status and the reason. */
  showEmployees: 'none' | 'counts' | 'list' | 'all';
  /** Columns of the employee list. */
  employeeColumns: ('state' | 'plan' | 'inPerson' | 'deduction' | 'employeeSavings' | 'employerSavings' | 'voluntary')[];
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
  showEmployees: 'all',
  employeeColumns: ['plan', 'inPerson', 'deduction', 'employeeSavings', 'voluntary', 'employerSavings'],
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
  showEmployees: z.enum(['none', 'counts', 'list', 'all']),
  employeeColumns: z.array(z.enum(['state', 'plan', 'inPerson', 'deduction', 'employeeSavings', 'employerSavings', 'voluntary'])).max(7),
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

/**
 * The client wording for a result. Proposals calculated before explanations existed have none stored,
 * so those fall back to the status and the rule's own sentence (reviewer notes are never shown).
 */
export function explanationOf(e: ProposalEmployeeResult): EmployeeExplanation {
  if (e.explanation) return e.explanation;
  const el = e.eligibility;
  if (el === 'Excluded') return { status: 'Left out', tone: 'notEligible', headline: '', reason: 'Left out of this proposal by the reviewer.', suggestions: [] };
  if (el === 'Eligible') return { status: 'Eligible', tone: 'eligible', headline: '', reason: 'Qualifies for the full plan.', suggestions: [] };
  if (el === 'PT Eligible') return { status: 'Eligible (part-time plan)', tone: 'partTime', headline: '', reason: 'Qualifies for the part-time plan.', suggestions: [] };
  if (el === 'NEEDS REVIEW' || el === 'No Federal Taxes Paid') return { status: 'Under review', tone: 'review', headline: 'Details to confirm', reason: 'Their details need a second look before their result is final.', suggestions: [] };
  const reviewer = el === 'Not Eligible - Reviewer decision';
  return { status: 'Not eligible', tone: 'notEligible', headline: reviewer ? 'Left out after review' : el.replace(/^Not Eligible - /, ''), reason: reviewer ? 'Left out after a review of their details.' : e.reasons?.[0] ?? '', suggestions: [] };
}

/** One line on where the multiple came from, e.g. "Typical for private companies (Home care and home health, $10M to $25M in value). Calculated from GF Data averages." */
export function multipleNote(info?: ProposalSettings['multipleInfo']): string {
  if (!info) return '';
  const detail = [info.industry === 'Other or not listed' ? 'all industries' : info.industry, info.size ? `${info.size} in value` : ''].filter(Boolean).join(', ');
  const publisher = info.source.split(/[,;(]/)[0].trim();
  const how = info.basis === 'custom' ? "First Gen's own figure." : info.basis === 'derived' ? `Calculated from ${publisher} averages.` : `Source: ${publisher}.`;
  return `Typical for ${info.ownership} companies (${detail}). ${how}`;
}

const TONE_ORDER = { eligible: 0, partTime: 0, review: 1, notEligible: 2 } as const;

/** Freeze what the client sees. Later edits to the proposal don't change a link that was already sent. */
export function buildSnapshot(p: { name: string; company?: string | null; file_name?: string | null; settings: any; summary: ProposalSummary; results: ProposalEmployeeResult[]; report_settings?: unknown }) {
  const rs = mergeReportSettings(p.report_settings);
  const s = p.summary;
  const company = p.company || p.name.replace(/ proposal$/i, '');
  const periods = s.payFrequency?.periodsPerYear || 26;
  // Rows the reviewer left out are an internal decision, not a status the client needs to see.
  const people = (p.results ?? []).filter((e) => e.eligibility !== 'Excluded').map((e) => ({ e, x: explanationOf(e) }));
  const listed = rs.showEmployees === 'all' ? people : rs.showEmployees === 'list' ? people.filter(({ x }) => x.tone === 'eligible' || x.tone === 'partTime') : [];
  const count = (tone: EmployeeExplanation['tone']) => people.filter(({ x }) => x.tone === tone).length;
  const reasons = new Map<string, { status: string; tone: string; headline: string; count: number }>();
  for (const { x } of people) {
    const k = `${x.tone}|${x.headline}`;
    const r = reasons.get(k) ?? { status: x.status, tone: x.tone, headline: x.headline, count: 0 };
    r.count++;
    reasons.set(k, r);
  }
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
    multipleNote: multipleNote(p.settings?.multipleInfo),
    employerAnnualSavings: s.employerAnnualSavings.total,
    // Proposals calculated before the admin fee existed have none.
    adminFee: s.adminFee && s.adminFee.annual > 0 ? { annual: s.adminFee.annual, amount: s.adminFee.amount, per: s.adminFee.per } : null,
    employerNetAnnualSavings: s.employerNetAnnualSavings ?? s.employerAnnualSavings.total,
    netPerPeriodSavings: Math.round(((s.employerNetAnnualSavings ?? s.employerAnnualSavings.total) / periods) * 100) / 100,
    addOns: s.voluntary?.addOns ?? [],
    valuationIncrease: s.valuationIncrease,
    perPeriodSavings: Math.round((s.employerAnnualSavings.total / periods) * 100) / 100,
    payFrequency: { label: FREQ_LABEL[s.payFrequency?.frequency ?? 'biweekly'] ?? 'Bi-Weekly', periodsPerYear: periods },
    // The same people the list shows: a row the reviewer left out is not part of the client's headcount.
    employeesReviewed: s.employees - (s.byEligibility?.Excluded ?? 0),
    eligible: s.eligibleTotal,
    eligibleFull: s.eligibleFull,
    eligiblePartTime: s.eligiblePartTime,
    projectedEnrolled: s.projectedEnrolled ?? s.eligibleTotal,
    participationRate: rate,
    employeeAnnualTaxSavings: s.employeeAnnualTaxSavings,
    benefitPackage: s.benefitPackage?.name,
    /** Tier pricing: each plan people were placed in, with its price. Margins and benefit costs stay internal. */
    plans: s.pricingMode === 'tiers' ? (s.tiers ?? []).filter((t) => t.id !== 'total' && t.enrolled > 0).map((t) => ({ name: t.name, employees: t.enrolled, monthlyPrice: t.price, benefitPackage: t.packageName })) : [],
    byStatus: Object.fromEntries(Object.entries(s.byEligibility ?? {}).filter(([k]) => k !== 'Excluded')),
    /** People by client status, and by the rule that decided it (largest group first within a status). */
    statusCounts: { eligible: count('eligible') + count('partTime'), partTime: count('partTime'), review: count('review'), notEligible: count('notEligible') },
    byReason: [...reasons.values()].sort((a, b) => TONE_ORDER[a.tone as keyof typeof TONE_ORDER] - TONE_ORDER[b.tone as keyof typeof TONE_ORDER] || b.count - a.count),
    companies: rs.showCompanies && (s.byCompany?.length ?? 0) > 1 ? s.byCompany : [],
    employees: listed
      .map(({ e, x }) => {
        const enrolled = x.tone === 'eligible' || x.tone === 'partTime';
        const pt = e.eligibility === 'PT Eligible';
        const m = pt ? e.partTime!.calc.monthly : e.monthly;
        return {
          name: e.name,
          state: e.row.workState,
          status: x.status,
          tone: x.tone,
          headline: x.headline,
          reason: x.reason,
          suggestions: x.suggestions,
          // Amounts only for people on a plan: a figure next to someone who is not enrolled would read as a promise.
          ...(enrolled && m ? {
            plan: pt ? 'Part-time' : e.tier?.name ?? 'Full',
            deductionPerCheck: pt ? e.partTime!.deductionPerCheck : e.perPeriod?.firstGen,
            employeeMonthlySavings: pt ? e.partTime!.allotment : m.allotment,
            employerAnnualSavings: Math.round(m.employerTaxSavings * 12 * 100) / 100,
            ...(e.voluntary ? { addOnCost: e.voluntary.addOnCost, voluntarySurplus: e.voluntary.surplus, inPersonPreventative: e.voluntary.addOns.some((a) => a.id === 'mec') } : {}),
          } : {}),
        };
      })
      .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || a.name.localeCompare(b.name)),
    showEmployees: rs.showEmployees,
    employeeColumns: rs.employeeColumns,
    // A public employer (school district) has no EBITDA, so a valuation figure would mean nothing to them.
    showValuation: rs.showValuation && !s.retirement,
    /** Public employer: which retirement system, and whether savings include Social Security. */
    publicRetirement: s.retirement ? { name: s.retirement.name, socialSecurity: s.retirement.socialSecurity, cafeteriaReductionsCovered: s.retirement.cafeteriaReductionsCovered } : null,
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
