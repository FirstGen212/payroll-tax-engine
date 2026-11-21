import { describe, expect, it } from 'vitest';
import { loadTaxDatabase } from '@pte/tax-data';
import { runProposal } from '@pte/engine';
import { withoutMargins } from '../src/proposals/routes.js';
import { ROLES } from '../src/auth.js';

const rows: any[] = Array.from({ length: 20 }, (_, i) => ({ rowNumber: i + 2, employeeId: String(i), firstName: 'T', lastName: `P${i}`, workState: 'TX', grossPay: 1400 + i * 120, payFrequency: 'Biweekly', hoursPerPeriod: 80, federalFilingStatus: 'Single' }));

describe('package costs and margins are for admins only', () => {
  it('only the admin role has margins.view', () => {
    expect(ROLES.filter((r) => r.permissions.includes('margins.view')).map((r) => r.key)).toEqual(['admin']);
  });

  for (const pricingMode of ['standard', 'tiers'] as const) {
    it(`a ${pricingMode} proposal answer carries no package cost or margin for everyone else`, () => {
      const r = runProposal(rows, { year: 2027, pricingMode }, loadTaxDatabase());
      const answer = { id: 'x', result: { ...r, summary: { ...r.summary } } };
      const text = JSON.stringify(withoutMargins(answer));
      for (const k of ['monthlyCost":10', 'benefitCost', 'monthlyMargin', 'annualMargin', 'marginPercent', 'marginPerEmployee', 'monthlyBenefitCost', 'losesMoney']) expect(text).not.toContain(k);
      // Still there: prices, counts, the package names, and the In-Person Preventative add-on price (it is what the employee pays).
      const s = withoutMargins(answer).result;
      expect(s.settings.benefitPackages.map((p: any) => p.name)).toContain('Virtual care');
      if (pricingMode === 'tiers') expect(s.summary.tiers[0]).toMatchObject({ name: 'Plus', price: 159 });
      else expect(s.summary.programs[0]).toMatchObject({ price: 159 });
      expect(s.employees).toBe(r.employees);
      expect(s.settings.voluntaryBenefits.find((v: any) => v.id === 'mec').monthlyCost).toBe(55);
    });
  }

  it('lists (the queue, revisions) are cleaned too', () => {
    const r = runProposal(rows, { year: 2027 }, loadTaxDatabase());
    expect(JSON.stringify(withoutMargins([{ settings: r.settings, summary: r.summary }]))).not.toMatch(/monthlyMargin|benefitCost/);
  });
});
