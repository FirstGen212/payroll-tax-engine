/** Writes docs/COVERAGE.md: what the tax database holds and how verified it is, by state/territory. */
import { writeFileSync } from 'node:fs';
import { STATES, loadTaxDatabase } from '@pte/tax-data';

const db = loadTaxDatabase();
const statuses = ['published', 'draft', 'projected', 'unverified', 'placeholder'] as const;
const lines: string[] = ['# Tax database coverage', '', `Generated ${new Date().toISOString().slice(0, 10)} from \`packages/tax-data\`. Regenerate with \`npm run coverage:report\`.`, ''];
const tot = Object.fromEntries(statuses.map((s) => [s, db.rules.filter((r) => r.status === s).length]));
lines.push(`**${db.jurisdictions.length} jurisdictions, ${db.rules.length} effective-dated rules.** ` + statuses.map((s) => `${s}: ${tot[s]}`).join(', ') + '.', '');
lines.push('| Code | Name | Local jurisdictions | Rules | Published/draft | Projected | Unverified | Placeholder | 2027 income tax |', '|---|---|---|---|---|---|---|---|---|');
for (const s of STATES) {
  const jur = db.jurisdictions.filter((j) => j.state === s.code);
  const rules = db.rules.filter((r) => jur.some((j) => j.code === r.jurisdiction));
  const c = (st: string[]) => rules.filter((r) => st.includes(r.status)).length;
  const sit = db.rules.find((r) => r.jurisdiction === s.code && r.kind === 'SIT' && r.effectiveFrom <= '2027-06-30' && (!r.effectiveTo || r.effectiveTo >= '2027-06-30'));
  const sitDesc = sit ? (sit.calc.kind === 'none' ? 'none' : `${sit.calc.kind === 'custom' ? sit.calc.handler : sit.calc.kind} (${sit.status})`) : 'missing';
  lines.push(`| ${s.code} | ${s.name} | ${jur.length - 1} | ${rules.length} | ${c(['published', 'draft'])} | ${c(['projected'])} | ${c(['unverified'])} | ${c(['placeholder'])} | ${sitDesc} |`);
}
writeFileSync(new URL('../docs/COVERAGE.md', import.meta.url), lines.join('\n') + '\n');
console.log('wrote docs/COVERAGE.md');
