import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connect, migrate, type Sql } from './db.js';
import { createStorage } from './storage.js';
import { encodeVector, type PhotoDTO } from './sync.js';

// Runs against the docker compose services, in a separate database and bucket.
const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgres://lumen:lumen@localhost:5433/lumen';
const TEST_URL = ADMIN_URL.replace(/\/[^/]+$/, '/lumen_test');
const ORIGIN = 'http://localhost:5173';

let app: FastifyInstance;
let sql: Sql;

beforeAll(async () => {
  const admin = connect(ADMIN_URL);
  const [exists] = await admin`select 1 from pg_database where datname = 'lumen_test'`;
  if (!exists) await admin`create database lumen_test`;
  await admin.end();
  const config = loadConfig({
    DATABASE_URL: TEST_URL,
    S3_ENDPOINT: 'http://localhost:8333',
    S3_BUCKET: 'lumen-photos-test',
    S3_ACCESS_KEY: 'lumen',
    S3_SECRET_KEY: 'lumen-secret',
    APP_ORIGIN: ORIGIN,
    AUTH_RATE_LIMIT: '1000',
  });
  sql = connect(TEST_URL);
  await migrate(sql);
  app = await buildApp({ config, sql, storage: await createStorage(config.s3), logger: false });
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

async function signup() {
  const email = `t-${randomUUID()}@example.com`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password: 'senha-forte-123' }, headers: { origin: ORIGIN } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find(c => c.name === 'lumen_session')!;
  return { email, headers: { cookie: `lumen_session=${cookie.value}`, origin: ORIGIN }, user: res.json().user };
}

const photo = (over: Partial<PhotoDTO> = {}): PhotoDTO => ({
  id: randomUUID(),
  hash: randomBytes(32).toString('hex'),
  phash: 'ffffffff00000000',
  name: 'IMG_1.jpg',
  type: 'image/jpeg',
  size: 1000,
  width: 10,
  height: 10,
  takenAt: 1_700_000_000_000,
  importedAt: 1_700_000_000_000,
  favorite: false,
  tags: ['praia'],
  albumIds: [],
  suggestedTags: [],
  version: 1,
  updatedAt: 1_700_000_000_000,
  deleted: false,
  ...over,
});

const push = (headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url: '/api/sync/push', headers, payload });
const pull = async (headers: Record<string, string>, since = 0) => (await app.inject({ method: 'GET', url: `/api/sync/pull?since=${since}`, headers })).json();

describe('auth', () => {
  it('signs up, reads the profile, logs out', async () => {
    const { email, headers, user } = await signup();
    expect(user).toMatchObject({ email, usedBytes: 0, quotaBytes: 15_000_000_000 });
    expect((await app.inject({ url: '/api/auth/me', headers })).json().user.email).toBe(email);
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
    expect((await app.inject({ url: '/api/auth/me', headers })).json()).toEqual({ user: null });
  });

  it('rejects a duplicate e-mail, a wrong password and a short password', async () => {
    const { email } = await signup();
    const again = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: email.toUpperCase(), password: 'outra-senha-123' } });
    expect(again.statusCode).toBe(409);
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'errada-123' } });
    expect(wrong.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'senha-forte-123' } });
    expect(ok.statusCode).toBe(200);
    const short = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: 'x@example.com', password: '123' } });
    expect(short.statusCode).toBe(400);
  });

  it('requires a session and refuses foreign origins', async () => {
    expect((await app.inject({ url: '/api/sync/pull' })).statusCode).toBe(401);
    const { headers } = await signup();
    const foreign = await push({ ...headers, origin: 'https://evil.example' }, { photos: [] });
    expect(foreign.statusCode).toBe(403);
  });
});

describe('sync', () => {
  it('round-trips photos, albums and embeddings with a cursor', async () => {
    const { headers } = await signup();
    const p = photo();
    const albumId = randomUUID();
    const vector = encodeVector(Array.from({ length: 512 }, (_, i) => i / 512));
    const res = await push(headers, {
      photos: [{ ...p, albumIds: [albumId], edits: { exposure: 10 } }],
      albums: [{ id: albumId, name: 'Férias', coverId: p.id, createdAt: 1, updatedAt: 1, deleted: false }],
      embeddings: [{ id: p.id, vector, mean: 0.2, std: 0.02 }],
    });
    expect(res.json()).toMatchObject({ photos: [p.id], albums: [albumId], embeddings: [p.id], duplicates: [] });

    const first = await pull(headers);
    expect(first.photos[0]).toMatchObject({ id: p.id, tags: ['praia'], albumIds: [albumId], edits: { exposure: 10 }, hasOriginal: false });
    expect(first.albums[0]).toMatchObject({ id: albumId, name: 'Férias' });
    expect(first.embeddings[0]).toMatchObject({ id: p.id, vector, mean: expect.closeTo(0.2, 5) });
    expect((await pull(headers, first.cursor)).photos).toEqual([]);
  });

  it('keeps the newest write', async () => {
    const { headers } = await signup();
    const p = photo({ updatedAt: 2000 });
    await push(headers, { photos: [p] });
    await push(headers, { photos: [{ ...p, tags: ['antiga'], updatedAt: 1000 }] });
    expect((await pull(headers)).photos[0].tags).toEqual(['praia']);
    await push(headers, { photos: [{ ...p, tags: ['nova'], updatedAt: 3000 }] });
    expect((await pull(headers)).photos[0].tags).toEqual(['nova']);
  });

  it('never lets one account overwrite or read another account’s photo', async () => {
    const a = await signup();
    const b = await signup();
    const p = photo();
    await push(a.headers, { photos: [p] });
    const res = await push(b.headers, { photos: [{ ...p, tags: ['invasor'], updatedAt: p.updatedAt + 1 }] });
    expect(res.json().photos).toEqual([]);
    expect((await pull(a.headers)).photos[0].tags).toEqual(['praia']);
    expect((await pull(b.headers)).photos).toEqual([]);
    expect((await app.inject({ url: `/api/photos/${p.id}/thumb`, headers: b.headers })).statusCode).toBe(404);
  });

  it('reports the same file imported under another id as a duplicate', async () => {
    const { headers } = await signup();
    const p = photo();
    await push(headers, { photos: [p] });
    const res = await push(headers, { photos: [{ ...p, id: randomUUID() }] });
    expect(res.json().duplicates).toEqual([{ id: expect.any(String), existingId: p.id }]);
  });
});

describe('files', () => {
  const bytes = randomBytes(5000);
  const upload = (headers: Record<string, string>, id: string, kind: string, body: Buffer) =>
    app.inject({ method: 'PUT', url: `/api/photos/${id}/${kind}?version=2`, headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: body });

  it('stores and serves originals and thumbnails, and counts usage', async () => {
    const { headers } = await signup();
    const p = photo({ size: bytes.length });
    await push(headers, { photos: [p] });
    expect((await upload(headers, p.id, 'original', bytes)).statusCode).toBe(200);
    expect((await upload(headers, p.id, 'thumb', bytes.subarray(0, 100))).statusCode).toBe(200);

    const got = await app.inject({ url: `/api/photos/${p.id}/original`, headers });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(got.rawPayload, bytes)).toBe(0);
    expect((await pull(headers)).photos[0]).toMatchObject({ hasOriginal: true, thumbVersion: 2 });
    expect((await app.inject({ url: '/api/auth/me', headers })).json().user.usedBytes).toBe(bytes.length);
  });

  it('refuses uploads for unknown photos and over quota', async () => {
    const { headers, user } = await signup();
    expect((await upload(headers, randomUUID(), 'original', bytes)).statusCode).toBe(404);
    await sql`update users set quota_bytes = 100 where id = ${user.id}`;
    const p = photo({ size: bytes.length });
    await push(headers, { photos: [p] });
    const res = await upload(headers, p.id, 'original', bytes);
    expect(res.statusCode).toBe(507);
    expect(res.json().code).toBe('quota');
  });

  it('deletes stored files when a photo is deleted for good', async () => {
    const { headers } = await signup();
    const p = photo({ size: bytes.length });
    await push(headers, { photos: [p] });
    await upload(headers, p.id, 'original', bytes);
    await push(headers, { photos: [{ ...p, deleted: true, updatedAt: p.updatedAt + 1 }] });
    expect((await app.inject({ url: `/api/photos/${p.id}/original`, headers })).statusCode).toBe(404);
    const after = await pull(headers);
    expect(after.photos[0]).toMatchObject({ deleted: true, hasOriginal: false });
  });
});
