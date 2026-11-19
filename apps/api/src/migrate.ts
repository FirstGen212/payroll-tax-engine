import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate() {
  await pool.query('create table if not exists schema_migration (name text primary key, applied_at timestamptz default now())');
  const done = new Set((await pool.query('select name from schema_migration')).rows.map((r) => r.name));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await pool.query(readFileSync(join(dir, f), 'utf8'));
    await pool.query('insert into schema_migration(name) values ($1)', [f]);
    console.log(`applied ${f}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => pool.end());
}
