/**
 * Response headers that keep browsers strict, and a gate that keeps heavy proposal work from running all at once.
 *
 * The headers apply to every response: the app, its API and the client pages under /r/. The page may load only its own
 * scripts and the Google font, may not be put inside another site's frame, and does not pass its address (which, for
 * a client page, is the only key to it) to other sites.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // React writes style attributes, so inline styles stay allowed; inline scripts do not.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const isHttps = (req: FastifyRequest) => req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';

export function registerSecurityHeaders(app: FastifyInstance) {
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'same-origin');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (isHttps(req)) reply.header('strict-transport-security', 'max-age=31536000');
    // Signed-in API answers hold client payroll data: never keep them in a shared or browser cache.
    const route = req.routeOptions?.url ?? '';
    if (route.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });
}

/**
 * Lets at most `max` jobs run at once and queues up to `queue` more; past that it refuses with a 503 so a burst of
 * large proposals cannot run the server out of memory (the hosting plan has 512 MB).
 */
export function workGate(max: number, queue: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    running--;
    const next = waiting.shift();
    if (next) { running++; next(); }
  };
  return {
    get running() { return running; },
    get waiting() { return waiting.length; },
    async run<T>(job: () => Promise<T>): Promise<T> {
      if (running >= max) {
        if (waiting.length >= queue) throw Object.assign(new Error('The server is busy with other large proposals. Try again in a minute.'), { statusCode: 503 });
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else running++;
      try { return await job(); } finally { release(); }
    },
  };
}
