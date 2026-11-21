// Timing check for the engine: npm run bench
import { performance } from 'node:perf_hooks';
import { loadTaxDatabase, STATES } from '@pte/tax-data';
import { calculatePay, runProposal } from "./src/index.js";
const t = (label: string, f: () => unknown, n = 1) => { const s = performance.now(); for (let i = 0; i < n; i++) f(); const ms = (performance.now() - s) / n; console.log(label.padEnd(52), ms.toFixed(ms < 10 ? 3 : 1), 'ms'); return ms; };
t('load tax database (first)', () => loadTaxDatabase());
t('load tax database (again)', () => loadTaxDatabase(), 20);
const db = loadTaxDatabase();
const codes = STATES.map((s) => s.code);
const inputs = codes.map((state, i) => ({ checkDate: '2027-03-12', payFrequency: 'biweekly' as const, employer: { id: 'c', name: 'Bench', homeState: state }, employee: { id: `e${i}`, federalW4: { version: '2020+' as const, filingStatus: 'single' as const }, residence: { state }, work: [{ state, percent: 1 }], stateW4: { [state]: { allowances: 1 } } }, earnings: [{ code: 'REG', amount: 2400 }] }));
t('calculatePay, one check (avg over 56 states x 20)', () => inputs.forEach((i) => calculatePay(i as any, db)), 20);
const per = t('calculatePay per check', () => calculatePay(inputs[4] as any, db), 2000);
const freq = ['Weekly', 'Biweekly', 'Semi-Monthly', 'Monthly'];
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ rowNumber: i + 2, employeeId: String(i), firstName: 'Test', lastName: `Person${i}`, workState: codes[i % codes.length], grossPay: 600 + (i % 40) * 55, payFrequency: freq[i % 4], hoursPerPeriod: 20 + (i % 30), federalFilingStatus: i % 3 ? 'Single' : 'Married' }));
for (const n of [50, 250, 1000]) t(`runProposal, ${n} employees`, () => runProposal(rows(n) as any, { year: 2027 }, db), n > 500 ? 1 : 3);
