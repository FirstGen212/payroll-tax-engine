/**
 * Import Ohio municipal income tax rates (Ohio Dept. of Taxation municipal rate table / RITA / CCA lists).
 * Expected columns (aliases accepted): Municipality, Rate, Credit (%), Credit Limit (rate), Administrator.
 * Usage: npm run import:oh-muni -w apps/api -- path/to/ohio.csv 2027-01-01
 */
import { readFileSync } from 'node:fs';
import { pool, tx } from '../db.js';
import { col, parseCsv, pctNum } from './csv.js';

export async function importOhMuni(file: string, effectiveFrom: string) {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  let n = 0;
  await tx(async (c) => {
    await c.query("insert into tax_source(id,agency,title,url,retrieved) values('oh-muni-rates','Ohio Department of Taxation','Municipal income tax rate table','https://tax.ohio.gov/individual/resources/municipal-income-tax-rate-database',now()) on conflict(id) do update set retrieved=now()");
    for (const r of rows) {
      const muni = col(r, 'Municipality', 'MUNICIPALITY', 'City', 'Name');
      if (!muni) continue;
      const rate = pctNum(col(r, 'Rate', 'Tax Rate', 'RATE'));
      const credit = pctNum(col(r, 'Credit', 'Credit %', 'Credit Percent')) || 100;
      const limit = pctNum(col(r, 'Credit Limit', 'Credit Rate Limit')) || rate;
      const code = `OH-${muni.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
      await c.query("insert into jurisdiction(code,name,type,parent_code,state,attrs) values($1,$2,'city','OH','OH',$3) on conflict(code) do update set name=excluded.name, attrs=excluded.attrs", [code, `${muni} municipal income tax`, { residentCreditPct: credit, residentCreditLimit: limit, administrator: col(r, 'Administrator', 'Collector') }]);
      const id = `${code}.LIT_EE.${effectiveFrom.slice(0, 4)}`;
      await c.query(`insert into tax_rule(id,jurisdiction,kind,name,payer,wage_basis,effective_from,status,calc,nonresident_calc,applies_to,updated_by)
        values($1,$2,'LIT_EE',$3,'employee','LOCAL',$4,'published',$5,$5,'resident_or_work','import:oh') on conflict(id) do update set calc=excluded.calc, nonresident_calc=excluded.nonresident_calc, status='published', updated_at=now()`,
        [id, code, `${muni} municipal income tax`, effectiveFrom, { kind: 'percent', rate: rate / 100 }]);
      await c.query('insert into tax_rule_source values($1,$2) on conflict do nothing', [id, 'oh-muni-rates']);
      n++;
    }
  });
  console.log(`imported ${n} Ohio municipalities`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, eff = '2027-01-01'] = process.argv.slice(2);
  importOhMuni(file, eff).then(() => pool.end());
}
