import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { runProposal } from '@pte/engine';
import type { CensusRow, ProposalResult, ProposalSettings } from '@pte/engine';
import type { TaxDatabase } from '@pte/tax-data';
import type { CalcJob } from './worker.js';

/**
 * runProposal in a worker thread, so the server keeps answering (health checks, other people) while it works.
 * The built app ships dist/worker.js next to dist/server.js; in tests and `tsx` dev there is none, and the
 * calculation runs inline as before.
 */
const workerFile = fileURLToPath(new URL('./worker.js', import.meta.url));
const useWorker = existsSync(workerFile) && import.meta.url.endsWith('/server.js');

let worker: Worker | undefined;
let sentDb: TaxDatabase | undefined;
const versions = new WeakMap<TaxDatabase, number>();
let nextVersion = 0;
let nextId = 0;
const pending = new Map<number, { resolve: (r: ProposalResult) => void; reject: (e: Error) => void }>();

function start(): Worker {
  // The worker gets its own heap; the cap keeps a very large file from taking the whole 512 MB server with it.
  const w = new Worker(workerFile, { resourceLimits: { maxOldGenerationSizeMb: 300 } });
  w.on('message', (m: { id: number; result?: ProposalResult; error?: { message: string; statusCode?: number } }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(Object.assign(new Error(m.error.message), m.error.statusCode ? { statusCode: m.error.statusCode } : {}));
    else p.resolve(m.result!);
  });
  const fail = (err: Error) => {
    if (worker === w) { worker = undefined; sentDb = undefined; }
    for (const [id, p] of pending) { pending.delete(id); p.reject(err); }
  };
  w.on('error', (e) => fail(Object.assign(new Error(/memory/i.test(e.message) ? 'This file is too large to calculate at once. Split it and run each part.' : `The calculation stopped: ${e.message}`), { statusCode: 503 })));
  w.on('exit', (code) => { if (code !== 0) fail(Object.assign(new Error('The calculation stopped unexpectedly. Try again.'), { statusCode: 503 })); });
  return w;
}

export function runProposalOffThread(rows: CensusRow[], settings: Partial<ProposalSettings>, db: TaxDatabase): Promise<ProposalResult> {
  if (!useWorker) return Promise.resolve().then(() => runProposal(rows, settings, db));
  worker ??= start();
  if (!versions.has(db)) versions.set(db, nextVersion++);
  const job: CalcJob = { id: nextId++, rows, settings, dbVersion: versions.get(db)!, ...(sentDb === db ? {} : { db }) };
  sentDb = db;
  const w = worker;
  return new Promise((resolve, reject) => { pending.set(job.id, { resolve, reject }); w.postMessage(job); });
}
