/** Demo clients and employees (fictional) to exercise every screen. Run: npm run seed:demo -w apps/api */
import { pool, q } from './db.js';

async function client(name: string, homeState: string, payFrequency: string, extra: Record<string, unknown> = {}) {
  const [c] = await q('insert into client(name,home_state,pay_frequency,futa_exempt,current_vendor,notes,retirement_system,social_security_covered) values($1,$2,$3,$4,$5,$6,$7,$8) returning id', [name, homeState, payFrequency, extra.futaExempt ?? false, extra.vendor ?? null, 'Demo data (fictional)', extra.retirementSystem ?? null, extra.socialSecurityCovered ?? true]);
  return c.id as string;
}
async function location(clientId: string, label: string, state: string, locals: string[]) {
  const [l] = await q('insert into client_work_location(client_id,label,state,local_codes) values($1,$2,$3,$4) returning id', [clientId, label, state, locals]);
  return l.id as string;
}
async function employee(clientId: string, e: any) {
  const [row] = await q(`insert into employee(client_id,first_name,last_name,birth_date,pay_type,pay_rate,standard_hours,residence_state,residence_locals,ss_covered,federal_w4,state_w4) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [clientId, e.first, e.last, e.birth ?? null, e.payType ?? 'hourly', e.rate, e.hours ?? 80, e.resState, e.resLocals ?? [], e.ss ?? true, e.w4, e.stateW4 ?? {}]);
  for (const w of e.work) await q('insert into employee_work_allocation(employee_id,location_id,state,local_codes,percent,remote_for_convenience) values($1,$2,$3,$4,$5,$6)', [row.id, w.locationId ?? null, w.state, w.locals ?? [], w.percent, w.remote ?? false]);
  for (const d of e.deductions ?? []) await q('insert into employee_recurring_deduction(employee_id,deduction_code,amount,percent,retirement_system,garnishment) values($1,$2,$3,$4,$5,$6)', [row.id, d.code, d.amount ?? null, d.percent ?? null, d.rs ?? null, d.garnishment ?? null]);
}

export async function seedDemo() {
  const a = await client('Demo Home Care Agency (NY)', 'NY', 'weekly', { vendor: 'viventium' });
  const bx = await location(a, 'Bronx office', 'NY', ['NY-NYC']);
  const yk = await location(a, 'Yonkers office', 'NY', []);
  await employee(a, { first: 'Maria', last: 'Santos', rate: 21, hours: 45, resState: 'NY', resLocals: ['NY-NYC'], w4: { version: '2020+', filingStatus: 'hoh', dependentsAmount: 4400 }, stateW4: { NY: { allowances: 2 } }, work: [{ locationId: bx, state: 'NY', locals: ['NY-NYC'], percent: 1 }], deductions: [{ code: 'MED_125', amount: 35 }, { code: 'GARN_CHILD_SUPPORT', amount: 120 }] });
  await employee(a, { first: 'James', last: 'Okafor', rate: 22.5, hours: 40, resState: 'NY', resLocals: ['NY-YONKERS'], w4: { version: 'pre2020', filingStatus: 'mfj', allowances: 3 }, stateW4: { NY: { allowances: 3, filingStatus: 'mfj' } }, work: [{ locationId: yk, state: 'NY', percent: 1 }], deductions: [{ code: '401K', percent: 0.04 }] });
  await employee(a, { first: 'Ana', last: 'Reyes', rate: 20, hours: 38, resState: 'NJ', w4: { version: '2020+', filingStatus: 'single' }, stateW4: { NJ: {}, NY: {} }, work: [{ locationId: bx, state: 'NY', locals: ['NY-NYC'], percent: 1 }] });

  const b = await client('Demo Independent School District (TX)', 'TX', 'monthly', { futaExempt: true, retirementSystem: 'TX_TRS', socialSecurityCovered: false });
  const campus = await location(b, 'High school campus', 'TX', []);
  await employee(b, { first: 'Linda', last: 'Garcia', payType: 'salary', rate: 5200, resState: 'TX', ss: false, birth: '1964-05-02', w4: { version: '2020+', filingStatus: 'mfj' }, work: [{ locationId: campus, state: 'TX', percent: 1 }], deductions: [{ code: '401A_PICKUP', rs: 'TX_TRS' }, { code: '403B', amount: 500 }, { code: 'MED_125', amount: 220 }] });
  await employee(b, { first: 'Robert', last: 'Nguyen', payType: 'salary', rate: 4800, resState: 'TX', ss: false, w4: { version: '2020+', filingStatus: 'single' }, work: [{ locationId: campus, state: 'TX', percent: 1 }], deductions: [{ code: '401A_PICKUP', rs: 'TX_TRS' }, { code: 'HSA_125', amount: 150 }] });

  const c = await client('Demo Multi-State Services', 'PA', 'biweekly', { vendor: 'adp' });
  const pit = await location(c, 'Pittsburgh', 'PA', ['PA-PSD-700102', 'PA-PSD-700102-LST']);
  const cle = await location(c, 'Cleveland', 'OH', ['OH-CLEVELAND']);
  await employee(c, { first: 'Kevin', last: 'Miller', rate: 32, resState: 'PA', resLocals: ['PA-PSD-020101'], w4: { version: '2020+', filingStatus: 'mfj', step2Checked: true }, stateW4: { PA: {} }, work: [{ locationId: pit, state: 'PA', locals: ['PA-PSD-700102', 'PA-PSD-700102-LST'], percent: 1 }], deductions: [{ code: 'MED_125', amount: 120 }, { code: '401K', percent: 0.06 }] });
  await employee(c, { first: 'Sarah', last: 'Brooks', rate: 28, resState: 'OH', resLocals: ['OH-EUCLID'], w4: { version: '2020+', filingStatus: 'single' }, stateW4: { OH: { allowances: 1 } }, work: [{ locationId: cle, state: 'OH', locals: ['OH-CLEVELAND'], percent: 1 }] });
  await employee(c, { first: 'Tom', last: 'Becker', rate: 35, resState: 'WV', w4: { version: '2020+', filingStatus: 'single' }, stateW4: { WV: {}, PA: { reciprocityCertificate: true }, OH: { reciprocityCertificate: true } }, work: [{ locationId: pit, state: 'PA', locals: ['PA-PSD-700102'], percent: 0.6 }, { locationId: cle, state: 'OH', locals: ['OH-CLEVELAND'], percent: 0.4 }] });
  console.log('demo clients created');
}

if (/[\\/]seed-demo\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) seedDemo().then(() => pool.end());
