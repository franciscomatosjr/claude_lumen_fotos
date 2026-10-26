import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Sql } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = 'lumen_session';
const SESSION_DAYS = 30;

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, n, salt, key] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
  return timingSafeEqual(actual, expected);
}

// Compared against when the e-mail is unknown, so a miss takes as long as a wrong password.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

const sha256 = (s: string) => createHash('sha256').update(s).digest();

export interface User {
  id: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(254),
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').max(200),
});

export function authRoutes(app: FastifyInstance, sql: Sql, cookieSecure: boolean, rateLimit: number) {
  const startSession = async (reply: FastifyReply, userId: string) => {
    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
    await sql`insert into sessions (token_hash, user_id, expires_at) values (${sha256(token)}, ${userId}, ${expires})`;
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/', expires });
  };

  const limited = { config: { rateLimit: { max: rateLimit, timeWindow: '1 minute' } } };

  app.post('/api/auth/signup', limited, async (req, reply) => {
    const body = credentials.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });
    const hash = await hashPassword(body.data.password);
    const [user] = await sql<User[]>`
      insert into users (email, password_hash) values (${body.data.email}, ${hash})
      on conflict (email) do nothing
      returning id, email`;
    if (!user) return reply.code(409).send({ error: 'Já existe uma conta com este e-mail' });
    await startSession(reply, user.id);
    return { user: await profile(sql, user.id) };
  });

  app.post('/api/auth/login', limited, async (req, reply) => {
    const body = credentials.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });
    const [row] = await sql<{ id: string; password_hash: string }[]>`select id, password_hash from users where email = ${body.data.email}`;
    const ok = await verifyPassword(body.data.password, row?.password_hash ?? (await DUMMY_HASH));
    if (!row || !ok) return reply.code(401).send({ error: 'E-mail ou senha incorretos' });
    await startSession(reply, row.id);
    return { user: await profile(sql, row.id) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await sql`delete from sessions where token_hash = ${sha256(token)}`;
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Answers 200 even when signed out: the app asks on every start, and most people never sign in.
  app.get('/api/auth/me', async req => {
    const user = await sessionUser(sql, req.cookies[SESSION_COOKIE]);
    return { user: user ? await profile(sql, user.id) : null };
  });
}

/** Account details the app shows: who is signed in and how much of the quota is used. */
export async function profile(sql: Sql, userId: string) {
  const [u] = await sql<{ id: string; email: string; quota_bytes: number; used_bytes: number }[]>`
    select u.id, u.email, u.quota_bytes,
      coalesce((select sum(size) from photos p where p.user_id = u.id and p.has_original and not p.deleted), 0)::bigint as used_bytes
    from users u where u.id = ${userId}`;
  return { id: u.id, email: u.email, quotaBytes: u.quota_bytes, usedBytes: u.used_bytes };
}

async function sessionUser(sql: Sql, token: string | undefined) {
  if (!token) return undefined;
  const [user] = await sql<User[]>`
    select u.id, u.email from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)} and s.expires_at > now()`;
  return user;
}

export function requireUser(sql: Sql) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await sessionUser(sql, req.cookies[SESSION_COOKIE]);
    if (user) {
      req.user = user;
      return;
    }
    return reply.code(401).send({ error: 'Faça login para continuar' });
  };
}
