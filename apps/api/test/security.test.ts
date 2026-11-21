import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, registerSecurityHeaders, workGate } from '../src/security.js';

describe('security headers', () => {
  const build = async () => {
    const app = Fastify();
    registerSecurityHeaders(app);
    app.get('/api/clients', async () => ({ ok: true }));
    app.get('/api/public/reports/:slug', async (_req, reply) => { reply.header('cache-control', 'no-store'); return { ok: true }; });
    app.get('/*', async (_req, reply) => { reply.header('cache-control', 'no-cache').type('text/html'); return '<html></html>'; });
    await app.ready();
    return app;
  };

  it('every page and answer forbids framing, sniffing and leaking the address, and allows only our own scripts', async () => {
    const app = await build();
    for (const url of ['/', '/r/some-client-abc123', '/api/clients', '/api/public/reports/x']) {
      const h = (await app.inject({ url })).headers;
      expect(h['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['x-content-type-options']).toBe('nosniff');
      // A client link is the only key to its page, so it is never sent to another site.
      expect(h['referrer-policy']).toBe('same-origin');
    }
    expect(CONTENT_SECURITY_POLICY).toMatch(/script-src 'self'(;|$)/);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-eval/);
    expect(CONTENT_SECURITY_POLICY).toMatch(/frame-ancestors 'none'/);
  });

  it('API answers are never cached, the app page keeps its own rule, and HTTPS gets HSTS', async () => {
    const app = await build();
    expect((await app.inject({ url: '/api/clients' })).headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/' })).headers['cache-control']).toBe('no-cache');
    expect((await app.inject({ url: '/' })).headers['strict-transport-security']).toBeUndefined();
    expect((await app.inject({ url: '/', headers: { 'x-forwarded-proto': 'https' } })).headers['strict-transport-security']).toMatch(/max-age=\d+/);
  });
});

describe('heavy work gate', () => {
  it('runs two at a time, queues the rest in order, and turns work away when the queue is full', async () => {
    const gate = workGate(2, 2);
    const order: string[] = [];
    const opened: (() => void)[] = [];
    const job = (name: string) => gate.run(() => new Promise<string>((resolve) => { order.push(`start ${name}`); opened.push(() => resolve(name)); }));
    const a = job('a'), b = job('b'), c = job('c'), d = job('d');
    await Promise.resolve();
    expect(gate.running).toBe(2);
    expect(gate.waiting).toBe(2);
    await expect(job('e')).rejects.toMatchObject({ statusCode: 503 });
    opened[0](); await a;
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['start a', 'start b', 'start c']);
    opened[1](); opened[2](); await Promise.all([b, c]);
    await new Promise((r) => setTimeout(r, 0));
    opened[3](); expect(await d).toBe('d');
    expect(gate.running).toBe(0);
  });

  it('frees its place when a job fails', async () => {
    const gate = workGate(1, 0);
    await expect(gate.run(async () => { throw new Error('bad file'); })).rejects.toThrow('bad file');
    expect(await gate.run(async () => 'next')).toBe('next');
  });
});
