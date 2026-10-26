import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { authRoutes } from './auth.js';
import type { Config } from './config.js';
import type { Sql } from './db.js';
import { fileRoutes } from './files.js';
import type { Storage } from './storage.js';
import { syncRoutes } from './sync.js';

export async function buildApp({ config, sql, storage, logger = true }: { config: Config; sql: Sql; storage: Storage; logger?: boolean }) {
  const app = Fastify({ logger, trustProxy: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // Session cookies are SameSite=Lax; on top of that, writes from a foreign page are refused outright.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    const origin = req.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) return reply.code(403).send({ error: 'Origem não permitida' });
  });

  app.get('/api/health', async () => {
    await sql`select 1`;
    return { ok: true };
  });
  authRoutes(app, sql, config.cookieSecure, config.authRateLimit);
  syncRoutes(app, sql, storage);
  fileRoutes(app, sql, storage);
  return app;
}
