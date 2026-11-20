import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for Postgres: just enough of each query the sign-in code runs. */
const db = vi.hoisted(() => ({
  sessions: new Map<string, any>(),
  users: [] as any[],
  audit: [] as { action: string; actor: unknown; asUser: unknown }[],
  writes: [] as string[],
}));
vi.mock('../src/db.js', () => ({
  pool: {},
  q: vi.fn(async (sql: string, params: unknown[] = []) => {
    const s = sql.trim();
    if (s.includes('from app_session s join app_user u')) { const row = db.sessions.get(String(params[0])); return row ? [row] : []; }
    if (s.startsWith('select count(*)::int n from app_user')) return [{ n: db.users.length }];
    if (s.startsWith('insert into audit_log')) { db.audit.push({ actor: params[0], asUser: params[1], action: String(params[2]) }); return []; }
    if (s.startsWith('select * from app_user where id=$1')) return db.users.filter((u) => u.id === params[0]);
    if (s.startsWith('select * from app_user where email=$1')) return db.users.filter((u) => u.email === params[0]);
    if (s.startsWith('select role, extra_permissions, denied_permissions from app_user where active and id<>$1')) return db.users.filter((u) => u.active && u.id !== params[0]);
    if (s.startsWith('select 1 from app_user where email=$1')) return db.users.filter((u) => u.email === params[0] && u.id !== params[1]);
    if (s.startsWith('insert into app_user')) { db.writes.push('insert user'); return [{ id: 'new-user' }]; }
    if (s.startsWith('update') || s.startsWith('insert') || s.startsWith('delete')) { db.writes.push(s.split(/\s+/).slice(0, 3).join(' ')); return []; }
    return [];
  }),
}));

import { NO_RULE, PERMISSIONS, ROLES, effectivePermissions, hashPassword, registerAuth, requiredPermission } from '../src/auth.js';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const person = (id: string, role: string, more: Record<string, unknown> = {}) => ({ id, email: `${id}@example.com`, name: id, role, extra_permissions: [], denied_permissions: [], active: true, password_hash: 'x', ...more });
/** Signs `user` in (optionally viewing as `as`) and returns the cookie header. */
const signIn = (user: any, as?: any) => {
  const token = `token-${user.id}-${as?.id ?? ''}`;
  db.sessions.set(sha(token), { ...user, sid: sha(token), impersonating_id: as?.id ?? null, iu: as ?? null });
  return { cookie: `pte_session=${token}` };
};

async function build(web = true) {
  const app = Fastify();
  await registerAuth(app);
  const ok = async () => ({ ok: true });
  app.get('/api/health', ok);
  app.get('/api/reference', ok);
  app.get('/api/clients', ok);
  app.post('/api/clients', ok);
  app.post('/api/clients/:id/payruns', ok);
  app.patch('/api/rules/:id', ok);
  app.post('/api/calculate', ok);
  app.post('/api/brand-new-thing', ok);
  app.get('/api/public/reports/:slug', ok);
  app.get('/api/proposals', ok);
  app.post('/api/proposals/:id/reports', ok);
  app.post('/api/proposals/:id/report-preview', ok);
  app.delete('/api/proposals/:id', ok);
  if (web) app.get('/*', async () => 'web app'); // stands in for the built web app
  await app.ready();
  return app;
}

const admin = person('ada', 'admin');
const manager = person('max', 'manager');
const analyst = person('ana', 'analyst');
const viewer = person('vic', 'viewer');

beforeEach(() => {
  db.sessions.clear();
  db.audit.length = 0;
  db.writes.length = 0;
  db.users = [admin, manager, analyst, viewer];
  delete process.env.APP_PASSWORD;
  delete process.env.RENDER;
  delete process.env.NODE_ENV;
});
afterEach(() => vi.clearAllMocks());

describe('who gets in', () => {
  it('turns away anyone who is not signed in, however the address is spelled', async () => {
    const app = await build();
    for (const url of ['/api/admin/users', '/%61pi/admin/users', '/api/%61dmin/users', '/%61%70%69/admin/users', '/api/clients', '/api/clients?next=/api/public/', '/api/proposals']) {
      const r = await app.inject({ url });
      expect([url, r.statusCode]).toEqual([url, 401]);
    }
    // Spellings the router doesn't treat as the API never reach an API handler at all.
    for (const url of ['/API/admin/users', '//api/admin/users', '/api/public/../admin/users', '/api%2Fadmin%2Fusers']) {
      const r = await app.inject({ url });
      expect(r.body).not.toContain('"email"');
      expect(r.body).not.toContain('"ok":true');
    }
  });

  it('leaves the health check, sign-in and published client pages open', async () => {
    const app = await build();
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/public/reports/acme-0123456789abcdef' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/me' })).json()).toMatchObject({ user: null, setupRequired: false });
    expect((await app.inject({ url: '/proposals/new' })).body).toBe('web app');
    // With no web build (development) an unknown address is a plain 404, signed in or not.
    const bare = await build(false);
    expect((await bare.inject({ url: '/nowhere' })).statusCode).toBe(404);
    expect((await bare.inject({ url: '/api/nowhere', headers: signIn(viewer) })).statusCode).toBe(404);
  });

  it('applies the right permission to each role, including for percent-encoded addresses', async () => {
    const app = await build();
    const as = (u: any) => (method: any, url: string) => app.inject({ method, url, headers: signIn(u), payload: method === 'GET' ? undefined : {} }).then((r) => r.statusCode);
    const v = as(viewer);
    expect(await v('GET', '/api/clients')).toBe(200);
    expect(await v('GET', '/api/reference')).toBe(200);
    expect(await v('POST', '/api/clients')).toBe(403);
    expect(await v('GET', '/api/admin/users')).toBe(403);
    expect(await v('GET', '/api/%61dmin/users')).toBe(403);
    expect(await v('GET', '/%61pi/admin/users')).toBe(403);
    expect(await v('GET', '/api/admin/audit')).toBe(403);
    expect(await v('PATCH', '/api/rules/7')).toBe(403);
    expect(await v('POST', '/api/calculate')).toBe(200);
    expect(await v('POST', '/api/proposals/1/report-preview')).toBe(200);
    expect(await v('POST', '/api/proposals/1/reports')).toBe(403);
    expect(await v('DELETE', '/api/proposals/1')).toBe(403);

    const a = as(analyst);
    expect(await a('POST', '/api/clients/1/payruns')).toBe(200);
    expect(await a('POST', '/api/clients')).toBe(403);
    expect(await a('POST', '/api/proposals/1/reports')).toBe(200);
    expect(await a('DELETE', '/api/proposals/1')).toBe(403);
    expect(await a('PATCH', '/api/rules/7')).toBe(403);

    const m = as(manager);
    expect(await m('PATCH', '/api/rules/7')).toBe(200);
    expect(await m('GET', '/api/admin/audit')).toBe(200);
    expect(await m('GET', '/api/admin/users')).toBe(403);

    expect(await as(admin)('GET', '/api/admin/users')).toBe(200);
  });

  it('turns off a new route that changes data until it is given a rule', async () => {
    const app = await build();
    const r = await app.inject({ method: 'POST', url: '/api/brand-new-thing', headers: signIn(admin), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(requiredPermission('POST', '/api/brand-new-thing')).toBe(NO_RULE);
  });

  it('ignores a session whose account was turned off', async () => {
    const app = await build();
    const r = await app.inject({ url: '/api/clients', headers: signIn({ ...viewer, active: false }) });
    expect(r.statusCode).toBe(401);
  });
});

describe('permission rules', () => {
  it('maps every route of the app', () => {
    const rules: [string, string, string | null][] = [
      ['GET', '/api/reference', null], ['GET', '/api/jurisdictions', null], ['GET', '/api/rules', null], ['GET', '/api/rules/:id/history', null], ['GET', '/api/coverage', null],
      ['PATCH', '/api/rules/:id', 'rules.edit'],
      ['GET', '/api/clients', 'clients.view'], ['POST', '/api/clients', 'clients.edit'], ['GET', '/api/clients/:id', 'clients.view'], ['PUT', '/api/clients/:id', 'clients.edit'],
      ['POST', '/api/clients/:id/locations', 'clients.edit'], ['PUT', '/api/clients/:id/tax-settings', 'clients.edit'], ['GET', '/api/clients/:id/applicable-taxes', 'clients.view'],
      ['GET', '/api/clients/:id/employees', 'clients.view'], ['POST', '/api/clients/:id/employees', 'clients.edit'], ['GET', '/api/employees/:id', 'clients.view'], ['PUT', '/api/employees/:id', 'clients.edit'],
      ['POST', '/api/calculate', null], ['POST', '/api/scenarios/compare', null],
      ['POST', '/api/clients/:id/payruns', 'payroll.run'], ['GET', '/api/clients/:id/payruns', 'clients.view'], ['GET', '/api/payruns/:id', 'clients.view'],
      ['GET', '/api/vendor-profiles', null], ['POST', '/api/vendor-profiles/:id/samples', 'vendors.edit'], ['POST', '/api/vendor-profiles/:id/learn', 'vendors.edit'],
      ['GET', '/api/proposals/defaults', 'proposals.view'], ['POST', '/api/proposals/parse', 'proposals.edit'], ['POST', '/api/proposals/calculate', 'proposals.edit'], ['POST', '/api/proposals/export', 'proposals.edit'],
      ['GET', '/api/proposals', 'proposals.view'], ['GET', '/api/proposals/:id', 'proposals.view'], ['GET', '/api/report-defaults', null],
      ['POST', '/api/proposals', 'proposals.edit'], ['PUT', '/api/proposals/:id', 'proposals.edit'], ['POST', '/api/proposals/:id/recalculate', 'proposals.edit'],
      ['POST', '/api/proposals/:id/duplicate', 'proposals.edit'], ['POST', '/api/proposals/:id/status', 'proposals.edit'], ['GET', '/api/proposals/:id/revisions', 'proposals.view'],
      ['DELETE', '/api/proposals/:id', 'proposals.delete'], ['GET', '/api/proposals/:id/reports', 'proposals.view'], ['POST', '/api/proposals/:id/reports', 'proposals.share'],
      ['DELETE', '/api/proposals/:id/reports/:slug', 'proposals.share'], ['POST', '/api/proposals/:id/report-preview', 'proposals.view'], ['GET', '/api/proposals/:id/export', 'proposals.view'],
      ['GET', '/api/admin/permissions', 'users.manage'], ['GET', '/api/admin/users', 'users.manage'], ['POST', '/api/admin/users', 'users.manage'], ['PUT', '/api/admin/users/:id', 'users.manage'],
      ['POST', '/api/admin/impersonate/:id', 'users.impersonate'], ['GET', '/api/admin/audit', 'audit.view'],
    ];
    for (const [method, route, want] of rules) expect([method, route, requiredPermission(method, route)]).toEqual([method, route, want]);
  });

  it('builds a person\'s permissions from their role plus the changes made for them', () => {
    const all = PERMISSIONS.map((p) => p.key);
    expect(effectivePermissions({ role: 'admin' })).toEqual(all);
    expect(effectivePermissions({ role: 'viewer', extra_permissions: ['proposals.edit', 'made.up'], denied_permissions: ['clients.view'] })).toEqual(['proposals.view', 'proposals.edit', 'proposals.view_all']);
    expect(effectivePermissions({ role: 'nobody' })).toEqual([]);
    // Roles only ever use permissions that exist.
    for (const r of ROLES) for (const p of r.permissions) expect(all).toContain(p);
  });
});

describe('viewing as another user', () => {
  it('follows the other user\'s permissions and says who is really signed in', async () => {
    const app = await build();
    const headers = signIn(admin, viewer);
    const me = (await app.inject({ url: '/api/auth/me', headers })).json();
    expect(me).toMatchObject({ impersonating: true, user: { id: 'vic' }, actor: { id: 'ada' } });
    expect((await app.inject({ url: '/api/admin/users', headers })).statusCode).toBe(403);
    await app.inject({ method: 'POST', url: '/api/clients/1/payruns', headers: signIn(admin, analyst), payload: {} });
    expect(db.audit.at(-1)).toMatchObject({ actor: 'ada', asUser: 'ana', action: 'POST /api/clients/:id/payruns' });
  });

  it('never gives more access than the signed-in person has', async () => {
    const app = await build();
    const helper = person('hal', 'analyst', { extra_permissions: ['users.impersonate'] });
    db.users.push(helper);
    // Asking to view as an admin is refused...
    const r = await app.inject({ method: 'POST', url: '/api/admin/impersonate/ada', headers: signIn(helper), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(db.writes).toEqual([]);
    // ...and a session that somehow points at one still only has the helper's own permissions.
    const me = (await app.inject({ url: '/api/auth/me', headers: signIn(helper, admin) })).json();
    expect(me.user.permissions).toEqual(effectivePermissions(helper));
    expect((await app.inject({ url: '/api/admin/users', headers: signIn(helper, admin) })).statusCode).toBe(403);
    // Viewing as someone with the same or less access is fine.
    expect((await app.inject({ method: 'POST', url: '/api/admin/impersonate/vic', headers: signIn(admin), payload: {} })).statusCode).toBe(200);
    expect(db.audit.at(-1)).toMatchObject({ action: 'impersonate.start', actor: 'ada', asUser: 'vic' });
  });
});

describe('managing users', () => {
  const body = (u: any, more: Record<string, unknown> = {}) => ({ name: u.name, email: u.email, role: u.role, extraPermissions: u.extra_permissions, deniedPermissions: u.denied_permissions, active: true, ...more });

  it('stops someone handing out, or changing, access above their own', async () => {
    const app = await build();
    const lead = person('lee', 'manager', { extra_permissions: ['users.manage'] });
    db.users.push(lead);
    const headers = signIn(lead);
    const make = await app.inject({ method: 'POST', url: '/api/admin/users', headers, payload: { name: 'New', email: 'new@example.com', role: 'admin', password: 'long-enough-pw' } });
    expect(make.statusCode).toBe(403);
    const grant = await app.inject({ method: 'PUT', url: '/api/admin/users/vic', headers, payload: body(viewer, { extraPermissions: ['users.impersonate'] }) });
    expect(grant.statusCode).toBe(403);
    const takeover = await app.inject({ method: 'PUT', url: '/api/admin/users/ada', headers, payload: body(admin, { password: 'a-new-password' }) });
    expect(takeover.statusCode).toBe(403);
    expect(db.writes).toEqual([]);
    const fine = await app.inject({ method: 'PUT', url: '/api/admin/users/vic', headers, payload: body(viewer, { role: 'analyst' }) });
    expect(fine.statusCode).toBe(200);
  });

  it('always leaves someone who can manage users', async () => {
    const app = await build();
    const headers = signIn(admin);
    const demote = await app.inject({ method: 'PUT', url: '/api/admin/users/ada', headers, payload: body(admin, { role: 'manager' }) });
    expect(demote.statusCode).toBe(400);
    const off = await app.inject({ method: 'PUT', url: '/api/admin/users/ada', headers, payload: body(admin, { active: false }) });
    expect(off.statusCode).toBe(400);
    expect(db.writes).toEqual([]);
    // With a second admin in place the first can step down.
    db.users.push(person('bea', 'admin'));
    const ok = await app.inject({ method: 'PUT', url: '/api/admin/users/ada', headers, payload: body(admin, { role: 'manager' }) });
    expect(ok.statusCode).toBe(200);
  });
});

describe('signing in', () => {
  it('needs the setup key to create the first admin, and requires one when hosted', async () => {
    db.users = [];
    process.env.APP_PASSWORD = 'the-setup-key';
    let app = await build();
    const first = { name: 'Ada', email: 'ada@example.com', password: 'long-enough-pw' };
    expect((await app.inject({ url: '/api/auth/me' })).json()).toMatchObject({ setupRequired: true, setupNeedsKey: true });
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: first })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...first, setupKey: 'wrong' } })).statusCode).toBe(403);
    expect(db.writes).toEqual([]);
    const done = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { ...first, setupKey: 'the-setup-key' } });
    expect(done.statusCode).toBe(200);
    expect(String(done.headers['set-cookie'])).toMatch(/^pte_session=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);

    delete process.env.APP_PASSWORD;
    process.env.RENDER = 'true';
    app = await build();
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: first })).statusCode).toBe(403);

    db.users = [admin];
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', payload: first })).statusCode).toBe(409);
  });

  it('checks the password, marks the cookie secure over https, and locks an account after ten wrong tries', async () => {
    const app = await build();
    db.users = [{ ...admin, password_hash: await hashPassword('correct horse battery') }];
    const tryIt = (password: string, email = admin.email) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password }, headers: { 'x-forwarded-proto': 'https' } });
    expect((await tryIt('nope', 'nobody@example.com')).statusCode).toBe(401);
    const good = await tryIt('correct horse battery', ' ADA@example.com ');
    expect(good.statusCode).toBe(200);
    expect(String(good.headers['set-cookie'])).toContain('; Secure');
    expect(db.audit.map((a) => a.action)).toEqual(['login.failed', 'login']);
    for (let i = 0; i < 10; i++) expect((await tryIt('wrong')).statusCode).toBe(401);
    expect((await tryIt('correct horse battery')).statusCode).toBe(429);
    // Another account is not affected.
    expect((await tryIt('x', 'someone@example.com')).statusCode).toBe(401);
  });
});

describe('audit log', () => {
  it('records changes once, by route, and never records reads or calculations', async () => {
    const app = await build();
    const headers = signIn(manager);
    await app.inject({ url: '/api/clients', headers });
    await app.inject({ method: 'POST', url: '/api/calculate', headers, payload: {} });
    await app.inject({ method: 'POST', url: '/api/proposals/9/report-preview', headers, payload: {} });
    expect(db.audit).toEqual([]);
    await app.inject({ method: 'POST', url: '/api/clients', headers, payload: {} });
    await app.inject({ method: 'PATCH', url: '/api/rules/7', headers, payload: {} });
    await app.inject({ method: 'POST', url: '/api/clients', headers: signIn(viewer), payload: {} }); // refused: nothing changed
    expect(db.audit.map((a) => a.action)).toEqual(['POST /api/clients', 'PATCH /api/rules/:id']);
  });
});
