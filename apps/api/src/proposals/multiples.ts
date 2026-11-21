/** The valuation multiples table: seeding, reading and editing. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../auth.js';
import { pool, q } from '../db.js';
import { INDUSTRIES, SIZE_BANDS, seedRows } from './multiples-data.js';

/** Insert or refresh the sourced figures. A cell someone edited keeps their number; only its reset value is refreshed. */
export async function seedMultiples() {
  for (const r of seedRows()) {
    await pool.query(
      `insert into valuation_multiple(id,industry,ownership,size_band,multiple,seed_multiple,basis,seed_basis,source,source_url,as_of,method,updated_by)
       values($1,$2,$3,$4,$5,$5,$6,$6,$7,$8,$9,$10,'seed')
       on conflict(id) do update set seed_multiple=excluded.seed_multiple, seed_basis=excluded.seed_basis, source=excluded.source, source_url=excluded.source_url, as_of=excluded.as_of, method=excluded.method,
         multiple=case when valuation_multiple.basis='custom' then valuation_multiple.multiple else excluded.multiple end,
         basis=case when valuation_multiple.basis='custom' then 'custom' else excluded.basis end`,
      [r.id, r.industry, r.ownership, r.sizeBand, r.multiple, r.basis, r.source, r.sourceUrl, r.asOf, r.method]);
  }
}

const SELECT = `select id, industry, ownership, size_band as "sizeBand", multiple::float8 as multiple, seed_multiple::float8 as "seedMultiple", basis, source, source_url as "sourceUrl", as_of as "asOf", method, updated_at as "updatedAt", updated_by as "updatedBy" from valuation_multiple`;

export async function multiplesRoutes(app: FastifyInstance) {
  app.get('/api/multiples', async () => ({
    industries: INDUSTRIES.map((i) => ({ key: i.key, label: i.label })),
    sizes: SIZE_BANDS,
    rows: await q(`${SELECT} order by industry, ownership, size_band`),
  }));

  /** Replace one figure with First Gen's own. The sourced figure is kept so it can be put back. */
  app.put('/api/multiples/:id', async (req) => {
    const id = (req.params as any).id as string;
    const { multiple } = z.object({ multiple: z.number().positive().max(100) }).parse(req.body);
    const by = req.actor?.email ?? 'ui';
    const rows = await q(`update valuation_multiple set multiple=$2, basis='custom', updated_at=now(), updated_by=$3 where id=$1 returning industry, ownership, size_band, seed_multiple::float8 as was`, [id, multiple, by]);
    if (!rows.length) throw Object.assign(new Error('That multiple was not found.'), { statusCode: 404 });
    await audit(req, 'multiple.edit', id, { multiple, sourced: rows[0].was });
    return (await q(`${SELECT} where id=$1`, [id]))[0];
  });

  app.post('/api/multiples/:id/reset', async (req) => {
    const id = (req.params as any).id as string;
    const by = req.actor?.email ?? 'ui';
    const rows = await q(`update valuation_multiple set multiple=seed_multiple, basis=seed_basis, updated_at=now(), updated_by=$2 where id=$1 and seed_multiple is not null returning id`, [id, by]);
    if (!rows.length) throw Object.assign(new Error('That multiple was not found.'), { statusCode: 404 });
    await audit(req, 'multiple.reset', id);
    return (await q(`${SELECT} where id=$1`, [id]))[0];
  });
}
