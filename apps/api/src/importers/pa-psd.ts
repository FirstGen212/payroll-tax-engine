/**
 * Import Pennsylvania PSD codes with resident/nonresident EIT and LST from the
 * PA DCED export (https://dced.pa.gov/local-government/local-income-tax-information/psd-codes-and-eit-rates/).
 * Usage: npm run import:pa-psd -w apps/api -- path/to/psd.csv 2027-01-01
 * Rows are written with status 'published' and the DCED source, replacing starter rows for the same PSD.
 */
import { readFileSync } from 'node:fs';
import { pool, tx } from '../db.js';
import { col, parseCsv, pctNum } from './csv.js';

export async function importPaPsd(file: string, effectiveFrom: string) {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  let n = 0;
  await tx(async (c) => {
    await c.query("insert into tax_source(id,agency,title,url,retrieved) values('pa-dced-psd','PA DCED','PSD Codes and EIT Rates','https://dced.pa.gov/local-government/local-income-tax-information/psd-codes-and-eit-rates/',now()) on conflict(id) do update set retrieved=now()");
    for (const r of rows) {
      const psd = (col(r, 'PSD Code', 'PSD', 'PSD_CODE') ?? '').replace(/\D/g, '').padStart(6, '0');
      if (!psd || psd === '000000') continue;
      const muni = col(r, 'Municipality', 'MUNICIPALITY', 'Municipality Name') ?? psd;
      const sd = col(r, 'School District', 'SCHOOL DISTRICT', 'School District Name') ?? '';
      const county = col(r, 'County', 'COUNTY') ?? '';
      const res = pctNum(col(r, 'Total Resident EIT', 'Resident EIT', 'RESIDENT EIT RATE', 'Total Resident Rate'));
      const nr = pctNum(col(r, 'Non-Resident EIT', 'NONRESIDENT EIT RATE', 'Municipal Non-Resident EIT'));
      const lst = pctNum(col(r, 'LST', 'Total LST', 'LST Amount'));
      const code = `PA-PSD-${psd}`;
      const name = `${muni} / ${sd}${county ? ` (${county})` : ''}`;
      await c.query("insert into jurisdiction(code,name,type,parent_code,state,attrs) values($1,$2,'psd','PA','PA',$3) on conflict(code) do update set name=excluded.name, attrs=excluded.attrs", [code, name, { psd, act32: true }]);
      const id = `${code}.LIT_EE.${effectiveFrom.slice(0, 4)}`;
      await c.query(`insert into tax_rule(id,jurisdiction,kind,name,payer,wage_basis,effective_from,status,calc,nonresident_calc,applies_to,updated_by)
        values($1,$2,'LIT_EE',$3,'employee','LOCAL',$4,'published',$5,$6,'resident_or_work','import:pa-dced') on conflict(id) do update set calc=excluded.calc, nonresident_calc=excluded.nonresident_calc, status='published', updated_at=now(), updated_by='import:pa-dced'`,
        [id, code, `${name} EIT`, effectiveFrom, { kind: 'percent', rate: res / 100 }, { kind: 'percent', rate: nr / 100 }]);
      await c.query('insert into tax_rule_source values($1,$2) on conflict do nothing', [id, 'pa-dced-psd']);
      if (lst > 0) {
        const lcode = `${code}-LST`;
        await c.query("insert into jurisdiction(code,name,type,parent_code,state,attrs) values($1,$2,'psd','PA','PA',$3) on conflict(code) do update set name=excluded.name, attrs=excluded.attrs", [lcode, `${name} LST`, { psd, lowIncomeExemption: lst > 10 ? 12000 : 0 }]);
        const lid = `${lcode}.LST_EE.${effectiveFrom.slice(0, 4)}`;
        await c.query(`insert into tax_rule(id,jurisdiction,kind,name,payer,wage_basis,effective_from,status,calc,applies_to,updated_by)
          values($1,$2,'LST_EE',$3,'employee','LOCAL',$4,'published',$5,'work','import:pa-dced') on conflict(id) do update set calc=excluded.calc, status='published', updated_at=now()`,
          [lid, lcode, `${name} Local Services Tax`, effectiveFrom, { kind: 'fixed', amount: lst, per: 'year', annualMax: lst }]);
        await c.query('insert into tax_rule_source values($1,$2) on conflict do nothing', [lid, 'pa-dced-psd']);
      }
      n++;
    }
  });
  console.log(`imported ${n} PSDs`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, eff = '2027-01-01'] = process.argv.slice(2);
  importPaPsd(file, eff).then(() => pool.end());
}
