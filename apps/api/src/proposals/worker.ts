/**
 * Runs proposal calculations off the server's main thread. A large census takes many seconds of CPU; on the main
 * thread that freezes every request, including Render's health check, and Render then restarts the app mid-save.
 * The worker keeps the tax database between jobs so each employee's year of paychecks stays cached.
 */
import { parentPort } from 'node:worker_threads';
import { runProposal } from '@pte/engine';
import type { CensusRow, ProposalSettings } from '@pte/engine';
import type { TaxDatabase } from '@pte/tax-data';

export interface CalcJob { id: number; rows: CensusRow[]; settings: Partial<ProposalSettings>; db?: TaxDatabase; dbVersion: number }

let db: TaxDatabase | undefined;
let dbVersion = -1;

parentPort?.on('message', (job: CalcJob) => {
  try {
    if (job.db) { db = job.db; dbVersion = job.dbVersion; }
    if (!db || dbVersion !== job.dbVersion) throw new Error('The calculator lost its tax data. Try again.');
    parentPort!.postMessage({ id: job.id, result: runProposal(job.rows, job.settings, db) });
  } catch (e: any) {
    parentPort!.postMessage({ id: job.id, error: { message: e?.message ?? String(e), statusCode: e?.statusCode } });
  }
});
