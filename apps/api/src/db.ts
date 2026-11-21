import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/payroll',
  // A query that runs away (a huge audit search, a stuck lock) is stopped instead of holding a connection forever.
  statement_timeout: 60_000,
});
// When the database restarts or drops an idle connection, pg reports it on the pool. With no listener Node treats that
// as an uncaught error and the whole app stops; logged here, the pool simply opens a new connection next time.
pool.on('error', (err) => { console.error('database connection lost (the pool will reconnect):', err.message); });

export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
