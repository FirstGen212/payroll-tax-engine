import type { ReciprocityAgreement } from './types.js';

/**
 * State income tax reciprocity agreements.
 * Each pair means: a resident of `residentState` working in `workState` may file
 * the exemption certificate with the employer and have only resident-state tax withheld.
 */
const pairs: [string, string[], string][] = [
  // [work state, resident states, exemption form]
  ['AZ', ['CA', 'IN', 'OR', 'VA'], 'WEC'],
  ['DC', ['*'], 'D-4A'],
  ['IL', ['IA', 'KY', 'MI', 'WI'], 'IL-W-5-NR'],
  ['IN', ['KY', 'MI', 'OH', 'PA', 'WI'], 'WH-47'],
  ['IA', ['IL'], '44-016'],
  ['KY', ['IL', 'IN', 'MI', 'OH', 'VA', 'WV', 'WI'], '42A809'],
  ['MD', ['DC', 'PA', 'VA', 'WV'], 'MW507'],
  ['MI', ['IL', 'IN', 'KY', 'MN', 'OH', 'WI'], 'MI-W4'],
  ['MN', ['MI', 'ND'], 'MWR'],
  ['MT', ['ND'], 'MT-R'],
  ['ND', ['MN', 'MT'], 'NDW-R'],
  ['NJ', ['PA'], 'NJ-165'],
  ['OH', ['IN', 'KY', 'MI', 'PA', 'WV'], 'IT 4NR'],
  ['PA', ['IN', 'MD', 'NJ', 'OH', 'VA', 'WV'], 'REV-419'],
  ['VA', ['DC', 'KY', 'MD', 'PA', 'WV'], 'VA-4'],
  ['WV', ['KY', 'MD', 'OH', 'PA', 'VA'], 'WV/IT-104R'],
  ['WI', ['IL', 'IN', 'KY', 'MI'], 'W-220'],
];

export const RECIPROCITY: ReciprocityAgreement[] = pairs.flatMap(([work, residents, form]) =>
  residents.map((r) => ({
    workState: work,
    residentState: r,
    form,
    effectiveFrom: '2020-01-01',
    status: 'unverified' as const,
    sources: ['fta-state-rates'],
    notes: work === 'DC' ? 'DC cannot tax nonresidents; all nonresidents are exempt with D-4A.' : work === 'VA' ? 'VA reciprocity for DC/MD/PA/WV is for commuters (daily return); KY requires residency only.' : undefined,
  })),
);

/** States that tax nonresident remote workers whose remote work is for the employee's convenience. */
export const CONVENIENCE_OF_EMPLOYER = ['NY', 'CT', 'DE', 'NE', 'PA', 'NJ'] as const;

export function findReciprocity(workState: string, residentState: string, onDate: string): ReciprocityAgreement | undefined {
  return RECIPROCITY.find(
    (r) => r.workState === workState && (r.residentState === residentState || r.residentState === '*') && r.effectiveFrom <= onDate && (!r.effectiveTo || r.effectiveTo >= onDate),
  );
}
