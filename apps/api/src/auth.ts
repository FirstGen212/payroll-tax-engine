/**
 * Sign-in, roles and permissions, impersonation and the audit log.
 *
 * Sessions are random tokens in an httpOnly cookie; only their sha256 is stored. An admin can "view as" another
 * user: the session keeps the admin as the actor and the other user as the effective user, so permissions and data
 * follow the other user while every audit row records both.
 *
 * Access is decided from the matched route pattern (for example /api/proposals/:id), never from the raw URL. The
 * router decodes percent-escapes before it matches, so "/%61pi/admin/users" reaches the same handler as
 * "/api/admin/users"; a check on the raw text would let it through.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { q, tx } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const PERMISSIONS: { key: string; label: string; group: string }[] = [
  { key: 'clients.view', label: 'See clients, employees and pay runs', group: 'Clients and payroll' },
  { key: 'clients.edit', label: 'Add and change clients, locations, employees and tax setup', group: 'Clients and payroll' },
  { key: 'payroll.run', label: 'Run and save pay runs', group: 'Clients and payroll' },
  { key: 'vendors.edit', label: 'Upload samples and learn vendor profiles', group: 'Clients and payroll' },
  { key: 'rules.edit', label: 'Change tax rules, their verification status and the valuation multiples', group: 'Clients and payroll' },
  { key: 'proposals.view', label: 'See their own proposals', group: 'Proposals' },
  { key: 'proposals.edit', label: 'Create, recalculate and change proposals', group: 'Proposals' },
  { key: 'proposals.view_all', label: "See and work on everyone's proposals", group: 'Proposals' },
  { key: 'proposals.share', label: 'Publish and revoke client proposal links', group: 'Proposals' },
  { key: 'proposals.delete', label: 'Delete proposals', group: 'Proposals' },
  { key: 'users.manage', label: 'Add users, set roles and permissions, reset passwords', group: 'Admin' },
  { key: 'users.impersonate', label: 'View the app as another user', group: 'Admin' },
  { key: 'audit.view', label: 'See the audit log', group: 'Admin' },
];
const ALL = PERMISSIONS.map((p) => p.key);
const labelOf = (perm: string) => PERMISSIONS.find((p) => p.key === perm)?.label ?? perm;

export const ROLES: { key: string; label: string; description: string; permissions: string[] }[] = [
  { key: 'admin', label: 'Admin', description: 'Everything, including users, impersonation and the audit log.', permissions: ALL },
  { key: 'manager', label: 'Manager', description: "Works on everyone's proposals and clients, publishes links, sees the audit log.", permissions: ['clients.view', 'clients.edit', 'payroll.run', 'vendors.edit', 'rules.edit', 'proposals.view', 'proposals.edit', 'proposals.view_all', 'proposals.share', 'proposals.delete', 'audit.view'] },
  { key: 'analyst', label: 'Analyst', description: 'Builds and shares their own proposals and runs mock payroll.', permissions: ['clients.view', 'payroll.run', 'proposals.view', 'proposals.edit', 'proposals.share'] },
  { key: 'viewer', label: 'Viewer', description: 'Read-only: sees clients and all proposals.', permissions: ['clients.view', 'proposals.view', 'proposals.view_all'] },
];

export interface AuthUser { id: string; email: string; name: string; role: string; permissions: string[]; active: boolean }

declare module 'fastify' {
  interface FastifyRequest {
    /** The effective user (the impersonated user while an admin is viewing as someone). */
    user?: AuthUser;
    /** The person who is really signed in. */
    actor?: AuthUser;
    sessionId?: string;
  }
}

export const effectivePermissions = (u: { role: string; extra_permissions?: string[] | null; denied_permissions?: string[] | null }) => {
  const base = ROLES.find((r) => r.key === u.role)?.permissions ?? [];
  const set = new Set([...base, ...(u.extra_permissions ?? [])].filter((p) => ALL.includes(p)));
  for (const d of u.denied_permissions ?? []) set.delete(d);
  return ALL.filter((p) => set.has(p));
};
const toUser = (r: any): AuthUser => ({ id: r.id, email: r.email, name: r.name, role: r.role, active: r.active, permissions: effectivePermissions(r) });

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, saltHex, keyHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(keyHex, 'hex');
  return key.length === want.length && timingSafeEqual(key, want);
}
/** A sign-in for an unknown email does the same work as one for a real account, so timing doesn't reveal who has one. */
const dummyHash = hashPassword(randomBytes(16).toString('hex'));

const COOKIE = 'pte_session';
const SESSION_DAYS = 14;
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const sameSecret = (a: string, b: string) => timingSafeEqual(Buffer.from(sha(a), 'hex'), Buffer.from(sha(b), 'hex'));
const readCookie = (req: FastifyRequest) => {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) { try { return decodeURIComponent(v.join('=')); } catch { return undefined; } }
  }
  return undefined;
};
const isHttps = (req: FastifyRequest) => req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
const setCookie = (req: FastifyRequest, reply: FastifyReply, token: string, maxAge: number) =>
  reply.header('set-cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
/**
 * Where the request came from, for the audit log only (nothing is decided from it). Behind a host's proxy the socket
 * address is the proxy, so the forwarded chain is kept as sent: its last entries come from the proxy, its first can
 * be typed by the caller.
 */
const origin = (req: FastifyRequest) => String(req.headers['x-forwarded-for'] ?? req.ip ?? '').slice(0, 120) || null;

export async function audit(req: FastifyRequest | null, action: string, target?: string | null, detail?: unknown, ids?: { actor?: string | null; asUser?: string | null }) {
  if (req) (req as any).audited = true; // the catch-all hook skips requests that logged a named event
  const actor = ids?.actor !== undefined ? ids.actor : req?.actor?.id ?? null;
  const asUser = ids?.asUser !== undefined ? ids.asUser : req?.user && req.actor && req.user.id !== req.actor.id ? req.user.id : null;
  await q('insert into audit_log(actor_id, as_user_id, action, target, detail, ip) values($1,$2,$3,$4,$5,$6)', [actor, asUser, action, target ?? null, detail === undefined ? null : JSON.stringify(detail), req ? origin(req) : null]);
}

const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
export const can = (req: FastifyRequest, perm: string) => !!req.user?.permissions.includes(perm);
export const requirePerm = (req: FastifyRequest, perm: string) => {
  if (!can(req, perm)) throw httpError(403, `You don't have permission to do this (${labelOf(perm)}).`);
};

/** No one may call it: a route that changes data but has no rule below. New routes fail closed until they get one. */
export const NO_RULE = 'no-rule';
/** Routes that only calculate and save nothing: any signed-in user. */
const CALCULATE_ONLY = new Set(['/api/calculate', '/api/scenarios/compare']);

/**
 * Which permission a route needs: a permission key, null for "any signed-in user", or NO_RULE.
 * `route` is the matched route pattern, e.g. /api/proposals/:id (see the note at the top of this file).
 * Routes with finer rules (proposal ownership, who may be impersonated) check again inside.
 */
export function requiredPermission(method: string, route: string): string | null {
  const write = method !== 'GET' && method !== 'HEAD';
  if (route.startsWith('/api/admin/audit')) return 'audit.view';
  if (route.startsWith('/api/admin/impersonate')) return 'users.impersonate';
  if (route.startsWith('/api/admin')) return 'users.manage';
  if (route.startsWith('/api/proposals')) {
    if (route === '/api/proposals/:id/report-preview') return 'proposals.view'; // builds a preview, saves nothing
    if (/^\/api\/proposals\/[^/]+\/reports/.test(route) && write) return 'proposals.share';
    if (route === '/api/proposals/calculate' || route === '/api/proposals/parse' || route === '/api/proposals/export') return 'proposals.edit';
    if (method === 'DELETE') return 'proposals.delete';
    return write ? 'proposals.edit' : 'proposals.view';
  }
  if (route.startsWith('/api/vendor-profiles')) return write ? 'vendors.edit' : null;
  if (/^\/api\/clients\/[^/]+\/payruns/.test(route) && write) return 'payroll.run';
  if (route.startsWith('/api/clients') || route.startsWith('/api/employees') || route.startsWith('/api/payruns')) return write ? 'clients.edit' : 'clients.view';
  if (route.startsWith('/api/rules') && write) return 'rules.edit';
  if (route.startsWith('/api/multiples') && write) return 'rules.edit'; // reading the table is open to any signed-in user
  if (!write || CALCULATE_ONLY.has(route)) return null; // reference data, rules, calculator
  return NO_RULE;
}

const isApi = (route: string) => route === '/api' || route.startsWith('/api/');
const PUBLIC = (route: string) => route === '/api/health' || route.startsWith('/api/auth/') || route.startsWith('/api/public/');
const QUIET = new Set(['/api/proposals/calculate', '/api/proposals/parse', '/api/proposals/export', '/api/proposals/:id/report-preview', '/api/calculate', '/api/scenarios/compare']);

/** Counts failures per key in a time window. Held in memory: one app instance, and a restart only forgives. */
function limiter(max: number, windowMs: number) {
  const seen = new Map<string, { n: number; until: number }>();
  return {
    blocked: (key: string) => { const f = seen.get(key); return !!f && f.n >= max && f.until > Date.now(); },
    fail: (key: string) => {
      const now = Date.now();
      if (seen.size > 5000) for (const [k, f] of seen) if (f.until < now) seen.delete(k);
      if (seen.size > 20000) seen.clear(); // a flood of made-up keys must not grow memory without limit
      const f = seen.get(key);
      const fresh = !f || f.until < now;
      seen.set(key, { n: fresh ? 1 : f!.n + 1, until: now + windowMs });
    },
    clear: (key: string) => { seen.delete(key); },
  };
}

async function startSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = randomBytes(32).toString('base64url');
  await q('delete from app_session where expires_at < now()');
  await q(`insert into app_session(id, user_id, expires_at) values($1,$2, now() + interval '${SESSION_DAYS} days')`, [sha(token), userId]);
  await q('update app_user set last_login_at = now() where id=$1', [userId]);
  setCookie(req, reply, token, SESSION_DAYS * 86400);
}

const known = (list: string[]) => [...new Set(list.filter((p) => ALL.includes(p)))];
const UserIn = z.object({
  email: z.string().email().max(200).transform((s) => s.trim().toLowerCase()),
  name: z.string().trim().min(1).max(120),
  role: z.enum(['admin', 'manager', 'analyst', 'viewer']),
  extraPermissions: z.array(z.string()).default([]).transform(known),
  deniedPermissions: z.array(z.string()).default([]).transform(known),
  active: z.boolean().default(true),
  password: z.string().min(10, 'Passwords need at least 10 characters.').max(200).optional(),
});

export async function registerAuth(app: FastifyInstance) {
  const setupKey = process.env.APP_PASSWORD; // on Render this is the generated secret; it guards first-admin setup
  // A hosted app with no setup key would let whoever finds the URL first become the admin.
  const hosted = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
  const logins = limiter(10, 15 * 60_000);
  const setups = limiter(10, 15 * 60_000);

  app.addHook('onRequest', async (req, reply) => {
    const route = req.routeOptions?.url ?? ''; // '' when nothing matched (the web app's own pages, 404s)
    if (!isApi(route)) return; // static files and the web app shell
    const token = readCookie(req);
    if (token) {
      const [s] = await q(
        `select s.id sid, s.impersonating_id, u.*, row_to_json(iu) iu from app_session s join app_user u on u.id = s.user_id
         left join app_user iu on iu.id = s.impersonating_id where s.id=$1 and s.expires_at > now()`, [sha(token)]);
      if (s && s.active) {
        req.sessionId = s.sid;
        req.actor = toUser(s);
        req.user = req.actor;
        if (s.iu && s.iu.active) {
          // Viewing as someone never gives more than the signed-in person already has.
          const as = toUser(s.iu);
          req.user = { ...as, permissions: as.permissions.filter((p) => req.actor!.permissions.includes(p)) };
        }
      }
    }
    if (PUBLIC(route)) return;
    if (!req.user) return reply.code(401).send({ error: 'Please sign in.' });
    const need = requiredPermission(req.method, route);
    if (need === NO_RULE) return reply.code(403).send({ error: 'This action has no permission rule yet, so it is turned off.' });
    if (need && !can(req, need)) return reply.code(403).send({ error: `You don't have permission to do this (${labelOf(need)}).` });
  });

  // Every change made through the API is logged with who did it and whose view they were in.
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? '';
    if (!req.actor || req.method === 'GET' || req.method === 'HEAD' || !isApi(route) || PUBLIC(route) || QUIET.has(route) || reply.statusCode >= 400 || (req as any).audited) return;
    await audit(req, `${req.method} ${route}`, req.url.split('?')[0].slice(0, 300), { status: reply.statusCode }).catch(() => {});
  });

  app.get('/api/auth/me', async (req) => {
    if (!req.user) {
      const [{ n }] = await q('select count(*)::int n from app_user');
      return { user: null, setupRequired: n === 0, setupNeedsKey: !!setupKey || hosted };
    }
    return { user: req.user, actor: req.actor, impersonating: req.user.id !== req.actor!.id, setupRequired: false };
  });

  app.post('/api/auth/setup', async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(120), email: z.string().email().max(200), password: z.string().min(10, 'Passwords need at least 10 characters.').max(200), setupKey: z.string().max(500).optional() }).parse(req.body);
    const taken = async () => (await q('select count(*)::int n from app_user'))[0].n > 0;
    if (await taken()) throw httpError(409, 'An admin already exists. Sign in instead.');
    if (!setupKey && hosted) throw httpError(403, 'Set APP_PASSWORD in the service environment first. It is the key for creating the first admin.');
    if (setupKey) {
      if (setups.blocked('setup')) throw httpError(429, 'Too many tries. Wait 15 minutes and try again.');
      if (!sameSecret(b.setupKey ?? '', setupKey)) {
        setups.fail('setup');
        throw httpError(403, 'That setup key is not right. It is the APP_PASSWORD value in the Render service settings.');
      }
    }
    // Two setup requests at the same moment must not both create an admin: they take turns on a lock, and the second
    // one finds the first one's account.
    const hash = await hashPassword(b.password);
    const u = await tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(727001)');
      if ((await c.query('select 1 from app_user limit 1')).rows.length) throw httpError(409, 'An admin already exists. Sign in instead.');
      return (await c.query(`insert into app_user(email, name, role, password_hash) values($1,$2,'admin',$3) returning id`, [b.email.trim().toLowerCase(), b.name, hash])).rows[0];
    });
    await audit(req, 'setup.first_admin', b.email, null, { actor: u.id, asUser: null });
    await startSession(req, reply, u.id);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = z.object({ email: z.string().max(200), password: z.string().max(200) }).parse(req.body);
    const email = b.email.trim().toLowerCase();
    // Counted per account, not per address: behind a proxy every caller can look like the same address.
    if (logins.blocked(email)) throw httpError(429, 'Too many tries. Wait 15 minutes and try again.');
    const [u] = await q('select * from app_user where email=$1', [email]);
    const ok = await verifyPassword(b.password, u?.password_hash ?? (await dummyHash));
    if (!u || !u.active || !ok) {
      logins.fail(email);
      await audit(req, 'login.failed', email, null, { actor: u?.id ?? null, asUser: null });
      throw httpError(401, 'That email and password do not match an active account.');
    }
    logins.clear(email);
    await startSession(req, reply, u.id);
    await audit(req, 'login', email, null, { actor: u.id, asUser: null });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionId) {
      await audit(req, 'logout', req.actor?.email);
      await q('delete from app_session where id=$1', [req.sessionId]);
    }
    setCookie(req, reply, '', 0);
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    if (!req.actor) throw httpError(401, 'Please sign in.');
    const b = z.object({ current: z.string().max(200), next: z.string().min(10, 'Passwords need at least 10 characters.').max(200) }).parse(req.body);
    const [u] = await q('select password_hash from app_user where id=$1', [req.actor.id]);
    if (logins.blocked(req.actor.email)) throw httpError(429, 'Too many tries. Wait 15 minutes and try again.');
    if (!(await verifyPassword(b.current, u.password_hash))) { logins.fail(req.actor.email); throw httpError(400, 'Your current password is not right.'); }
    await q('update app_user set password_hash=$2 where id=$1', [req.actor.id, await hashPassword(b.next)]);
    await q('delete from app_session where user_id=$1 and id<>$2', [req.actor.id, req.sessionId]);
    await audit(req, 'password.changed', req.actor.email);
    return { ok: true };
  });

  app.post('/api/auth/stop-impersonating', async (req) => {
    if (!req.sessionId || !req.actor) throw httpError(401, 'Please sign in.');
    if (req.user && req.user.id !== req.actor.id) await audit(req, 'impersonate.stop', req.user.email);
    await q('update app_session set impersonating_id=null where id=$1', [req.sessionId]);
    return { ok: true };
  });

  // ---------------------------------------------------------------- admin
  /** Permissions in `perms` that the person making the request doesn't hold themselves. */
  const beyond = (req: FastifyRequest, perms: string[]) => perms.filter((p) => !req.user!.permissions.includes(p));
  const list = (perms: string[]) => perms.map(labelOf).join('; ');

  app.get('/api/admin/permissions', async () => ({ permissions: PERMISSIONS, roles: ROLES }));

  app.get('/api/admin/users', async () => {
    const rows = await q(`select u.id, u.email, u.name, u.role, u.extra_permissions, u.denied_permissions, u.active, u.created_at, u.last_login_at,
      (select count(*)::int from proposal p where p.owner_id = u.id) proposals from app_user u order by u.active desc, u.name`);
    return rows.map((r) => ({ ...r, permissions: effectivePermissions(r) }));
  });

  app.post('/api/admin/users', async (req) => {
    const b = UserIn.parse(req.body);
    if (!b.password) throw httpError(400, 'Set a starting password (at least 10 characters).');
    const grant = effectivePermissions({ role: b.role, extra_permissions: b.extraPermissions, denied_permissions: b.deniedPermissions });
    if (beyond(req, grant).length) throw httpError(403, `You can't give someone access you don't have yourself: ${list(beyond(req, grant))}.`);
    const [dupe] = await q('select 1 from app_user where email=$1', [b.email]);
    if (dupe) throw httpError(409, 'A user with that email already exists.');
    const [u] = await q(`insert into app_user(email, name, role, extra_permissions, denied_permissions, active, password_hash) values($1,$2,$3,$4,$5,$6,$7) returning id`,
      [b.email, b.name, b.role, b.extraPermissions, b.deniedPermissions, b.active, await hashPassword(b.password)]);
    await audit(req, 'user.create', b.email, { role: b.role, extra: b.extraPermissions, denied: b.deniedPermissions });
    return { id: u.id };
  });

  app.put('/api/admin/users/:id', async (req) => {
    const id = (req.params as any).id;
    const b = UserIn.parse(req.body);
    const [before] = await q('select * from app_user where id=$1', [id]);
    if (!before) throw httpError(404, 'User not found');
    if (beyond(req, effectivePermissions(before)).length) throw httpError(403, `You can't change ${before.name}: they have access you don't have.`);
    const grant = effectivePermissions({ role: b.role, extra_permissions: b.extraPermissions, denied_permissions: b.deniedPermissions });
    if (beyond(req, grant).length) throw httpError(403, `You can't give someone access you don't have yourself: ${list(beyond(req, grant))}.`);
    if (id === req.actor!.id && !b.active) throw httpError(400, "You can't turn off your own account.");
    // Never leave the app with nobody who can manage users.
    const others = await q('select role, extra_permissions, denied_permissions from app_user where active and id<>$1', [id]);
    const managed = (b.active && grant.includes('users.manage')) || others.some((o) => effectivePermissions(o).includes('users.manage'));
    if (!managed) throw httpError(400, 'At least one active person must be able to manage users. Give that access to someone else first.');
    const [dupe] = await q('select 1 from app_user where email=$1 and id<>$2', [b.email, id]);
    if (dupe) throw httpError(409, 'Another user already has that email.');
    await q('update app_user set email=$2, name=$3, role=$4, extra_permissions=$5, denied_permissions=$6, active=$7 where id=$1', [id, b.email, b.name, b.role, b.extraPermissions, b.deniedPermissions, b.active]);
    if (b.password) { await q('update app_user set password_hash=$2 where id=$1', [id, await hashPassword(b.password)]); await q('delete from app_session where user_id=$1 and id<>$2', [id, req.sessionId]); }
    if (!b.active) await q('delete from app_session where user_id=$1', [id]);
    if (!b.active) await q('update app_session set impersonating_id=null where impersonating_id=$1', [id]);
    await audit(req, 'user.update', b.email, {
      role: before.role !== b.role ? [before.role, b.role] : undefined,
      extra: b.extraPermissions, denied: b.deniedPermissions, active: before.active !== b.active ? b.active : undefined, passwordReset: !!b.password || undefined,
    });
    return { ok: true };
  });

  app.post('/api/admin/impersonate/:id', async (req) => {
    const id = (req.params as any).id;
    if (req.user!.id !== req.actor!.id) throw httpError(400, 'Stop viewing as the current user first.');
    if (id === req.actor!.id) throw httpError(400, "You're already signed in as yourself.");
    const [u] = await q('select * from app_user where id=$1', [id]);
    if (!u || !u.active) throw httpError(404, 'That user is not active.');
    if (beyond(req, effectivePermissions(u)).length) throw httpError(403, `You can only view as someone whose access is the same as or less than yours. ${u.name} can do things you can't.`);
    await q('update app_session set impersonating_id=$2 where id=$1', [req.sessionId, id]);
    await audit(req, 'impersonate.start', u.email, null, { actor: req.actor!.id, asUser: id });
    return { ok: true };
  });

  app.get('/api/admin/audit', async (req) => {
    const { user, action, limit } = req.query as Record<string, string | undefined>;
    const uuid = z.string().uuid().safeParse(user);
    // Catch-all rows keep the request path as their target; target_name puts a client, employee or proposal name next to it.
    return q(`select a.id, a.at, a.action, a.target, a.detail, a.ip, au.name actor_name, au.email actor_email, iu.name as_user_name, iu.email as_user_email,
        coalesce(c.name, e.first_name || ' ' || e.last_name, p.name, pc.name) target_name
      from audit_log a left join app_user au on au.id = a.actor_id left join app_user iu on iu.id = a.as_user_id
        left join lateral (select substring(a.target from '^/api/[a-z-]+/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})')::uuid ref) x on true
        left join client c on c.id = x.ref left join employee e on e.id = x.ref left join proposal p on p.id = x.ref
        left join pay_run pr on pr.id = x.ref left join client pc on pc.id = pr.client_id
      where ($1::uuid is null or a.actor_id = $1 or a.as_user_id = $1) and ($2::text is null or a.action ilike '%'||$2||'%')
      order by a.at desc limit $3`, [uuid.success ? uuid.data : null, action || null, Math.min(Math.max(Number(limit) || 200, 1), 1000)]);
  });
}
