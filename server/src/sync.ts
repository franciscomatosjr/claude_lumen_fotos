import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth.js';
import { lockUser, type Sql } from './db.js';
import { fileKey, type Storage } from './storage.js';

const DIM = 512;
const PAGE = 500;

const ms = z.number().int().nonnegative();
const tag = z.string().min(1).max(100);

export const photoSchema = z.object({
  id: z.uuid(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  phash: z.string().regex(/^[0-9a-f]{16}$/),
  name: z.string().min(1).max(500),
  type: z.string().max(100),
  size: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  takenAt: ms,
  importedAt: ms,
  camera: z.string().max(200).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lon: z.number().min(-180).max(180).nullish(),
  favorite: z.boolean(),
  trashedAt: ms.nullish(),
  tags: z.array(tag).max(500),
  albumIds: z.array(z.uuid()).max(1000),
  suggestedTags: z.array(tag).max(50),
  edits: z.record(z.string(), z.unknown()).nullish(),
  version: z.number().int().positive(),
  updatedAt: ms,
  deleted: z.boolean(),
});

export const albumSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(200),
  coverId: z.uuid().nullish(),
  createdAt: ms,
  updatedAt: ms,
  deleted: z.boolean(),
});

export const embeddingSchema = z.object({
  id: z.uuid(),
  /** 512 little-endian float32 values, base64-encoded. */
  vector: z.string().length(Math.ceil((DIM * 4) / 3) * 4),
  mean: z.number(),
  std: z.number().positive(),
});

const pushSchema = z.object({
  photos: z.array(photoSchema).max(PAGE).default([]),
  albums: z.array(albumSchema).max(PAGE).default([]),
  embeddings: z.array(embeddingSchema).max(PAGE).default([]),
});

export type PhotoDTO = z.infer<typeof photoSchema>;

export const decodeVector = (b64: string) => {
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length !== DIM * 4) throw new Error('vector must have 512 float32 values');
  return Array.from(new Float32Array(new Uint8Array(bytes).buffer));
};
export const encodeVector = (values: number[]) => Buffer.from(new Float32Array(values).buffer).toString('base64');

export function syncRoutes(app: FastifyInstance, sql: Sql, storage: Storage) {
  const auth = { preHandler: requireUser(sql), bodyLimit: 20 * 1024 * 1024 };

  /**
   * Applies a client's changes. Each record wins only if its `updatedAt` is not older than the stored
   * one (last writer wins). Records owned by someone else are never touched.
   */
  app.post('/api/sync/push', auth, async (req, reply) => {
    const body = pushSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Dados de sincronização inválidos', issues: body.error.issues.slice(0, 5) });
    const uid = req.user!.id;
    const result = { photos: [] as string[], albums: [] as string[], embeddings: [] as string[], duplicates: [] as { id: string; existingId: string }[] };
    const removed: string[] = [];

    await sql.begin(async tx => {
      await lockUser(tx, uid);

      for (const p of body.data.photos) {
        if (!p.deleted) {
          const [dup] = await tx<{ id: string }[]>`select id from photos where user_id = ${uid} and hash = ${p.hash} and not deleted and id <> ${p.id}`;
          if (dup) {
            result.duplicates.push({ id: p.id, existingId: dup.id });
            continue;
          }
        }
        const rows = await tx`
          insert into photos (id, user_id, hash, phash, name, type, size, width, height, taken_at, imported_at, camera, lat, lon,
            favorite, trashed_at, tags, album_ids, suggested_tags, edits, version, updated_at, deleted)
          values (${p.id}, ${uid}, ${p.hash}, ${p.phash}, ${p.name}, ${p.type}, ${p.size}, ${p.width}, ${p.height}, ${p.takenAt}, ${p.importedAt},
            ${p.camera ?? null}, ${p.lat ?? null}, ${p.lon ?? null}, ${p.favorite}, ${p.trashedAt ?? null}, ${tx.array(p.tags)},
            ${tx.array(p.albumIds)}::uuid[], ${tx.array(p.suggestedTags)}, ${p.edits ? tx.json(p.edits as never) : null}, ${p.version}, ${p.updatedAt}, ${p.deleted})
          on conflict (id) do update set
            name = excluded.name, taken_at = excluded.taken_at, camera = excluded.camera, lat = excluded.lat, lon = excluded.lon,
            favorite = excluded.favorite, trashed_at = excluded.trashed_at, tags = excluded.tags, album_ids = excluded.album_ids,
            suggested_tags = excluded.suggested_tags, edits = excluded.edits, version = excluded.version,
            updated_at = excluded.updated_at, deleted = excluded.deleted,
            has_original = photos.has_original and not excluded.deleted,
            thumb_version = case when excluded.deleted then 0 else photos.thumb_version end,
            rev = nextval('rev_seq')
          where photos.user_id = excluded.user_id and excluded.updated_at >= photos.updated_at
          returning id`;
        const [owner] = rows.length ? [{ user_id: uid }] : await tx<{ user_id: string }[]>`select user_id from photos where id = ${p.id}`;
        // Stale writes count as handled: the newer server copy reaches the client on its next pull.
        if (owner?.user_id === uid) result.photos.push(p.id);
        if (rows.length && p.deleted) {
          removed.push(p.id);
          await tx`delete from embeddings where photo_id = ${p.id}`;
        }
      }

      for (const a of body.data.albums) {
        const rows = await tx`
          insert into albums (id, user_id, name, cover_id, created_at, updated_at, deleted)
          values (${a.id}, ${uid}, ${a.name}, ${a.coverId ?? null}, ${a.createdAt}, ${a.updatedAt}, ${a.deleted})
          on conflict (id) do update set
            name = excluded.name, cover_id = excluded.cover_id, updated_at = excluded.updated_at, deleted = excluded.deleted,
            rev = nextval('rev_seq')
          where albums.user_id = excluded.user_id and excluded.updated_at >= albums.updated_at
          returning id`;
        const [owner] = rows.length ? [{ user_id: uid }] : await tx<{ user_id: string }[]>`select user_id from albums where id = ${a.id}`;
        if (owner?.user_id === uid) result.albums.push(a.id);
      }

      for (const e of body.data.embeddings) {
        const vector = `[${decodeVector(e.vector).join(',')}]`;
        const rows = await tx`
          insert into embeddings (photo_id, user_id, vector, mean, std)
          select ${e.id}, ${uid}, ${vector}::vector, ${e.mean}, ${e.std}
          where exists (select 1 from photos where id = ${e.id} and user_id = ${uid} and not deleted)
          on conflict (photo_id) do update set vector = excluded.vector, mean = excluded.mean, std = excluded.std, rev = nextval('rev_seq')
          where embeddings.user_id = excluded.user_id
          returning photo_id`;
        if (rows.length) result.embeddings.push(e.id);
      }
    });

    if (removed.length) {
      await storage.remove(removed.flatMap(id => [fileKey(uid, id, 'original'), fileKey(uid, id, 'thumb')])).catch(err => req.log.warn({ err }, 'falha ao apagar arquivos'));
    }
    return result;
  });

  /** Everything that changed for this user after `since`, oldest first, in pages. */
  app.get('/api/sync/pull', auth, async req => {
    const since = Math.max(0, Number((req.query as { since?: string }).since) || 0);
    const uid = req.user!.id;
    return sql.begin(async tx => {
      await lockUser(tx, uid);
      const changes = await tx<{ kind: 'p' | 'a' | 'e'; id: string; rev: number }[]>`
        select kind, id, rev from (
          select 'p' as kind, id, rev from photos where user_id = ${uid} and rev > ${since}
          union all select 'a', id, rev from albums where user_id = ${uid} and rev > ${since}
          union all select 'e', photo_id, rev from embeddings where user_id = ${uid} and rev > ${since}
        ) c order by rev limit ${PAGE}`;
      const ids = (k: string) => changes.filter(c => c.kind === k).map(c => c.id);
      const [photos, albums, embeddings] = await Promise.all([
        tx`select * from photos where id = any(${tx.array(ids('p'))}::uuid[])`,
        tx`select * from albums where id = any(${tx.array(ids('a'))}::uuid[])`,
        tx`select photo_id, vector::text as vector, mean, std from embeddings where photo_id = any(${tx.array(ids('e'))}::uuid[])`,
      ]);
      return {
        photos: photos.map(photoOut),
        albums: albums.map(r => ({ id: r.id, name: r.name, coverId: r.cover_id, createdAt: r.created_at, updatedAt: r.updated_at, deleted: r.deleted })),
        embeddings: embeddings.map(r => ({ id: r.photo_id, vector: encodeVector(JSON.parse(r.vector)), mean: r.mean, std: r.std })),
        cursor: changes.length ? changes[changes.length - 1].rev : since,
        more: changes.length === PAGE,
      };
    });
  });
}

function photoOut(r: Record<string, any>) {
  return {
    id: r.id,
    hash: r.hash,
    phash: r.phash,
    name: r.name,
    type: r.type,
    size: r.size,
    width: r.width,
    height: r.height,
    takenAt: r.taken_at,
    importedAt: r.imported_at,
    camera: r.camera,
    lat: r.lat,
    lon: r.lon,
    favorite: r.favorite,
    trashedAt: r.trashed_at,
    tags: r.tags,
    albumIds: r.album_ids,
    suggestedTags: r.suggested_tags,
    edits: r.edits,
    version: r.version,
    updatedAt: r.updated_at,
    deleted: r.deleted,
    hasOriginal: r.has_original,
    thumbVersion: r.thumb_version,
  };
}
