import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { requireUser } from './auth.js';
import { lockUser, type Sql } from './db.js';
import { fileKey, type FileKind, type Storage } from './storage.js';

const MAX_UPLOAD = 200 * 1024 * 1024;
const params = z.object({ id: z.uuid(), kind: z.enum(['original', 'thumb']) });

/**
 * Photo bytes travel through the API so the browser never needs storage credentials or bucket CORS.
 * Uploads are streamed straight to object storage.
 */
export function fileRoutes(app: FastifyInstance, sql: Sql, storage: Storage) {
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));
  const auth = requireUser(sql);

  app.put('/api/photos/:id/:kind', { preHandler: auth }, async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'Não encontrado' });
    const { id, kind } = p.data;
    const uid = req.user!.id;
    const length = Number(req.headers['content-length']);
    if (!length || length > MAX_UPLOAD) return reply.code(413).send({ error: 'Arquivo vazio ou maior que 200 MB' });
    const thumbVersion = Number((req.query as { version?: string }).version) || 1;

    const [photo] = await sql<{ size: number; type: string; has_original: boolean }[]>`
      select size, type, has_original from photos where id = ${id} and user_id = ${uid} and not deleted`;
    if (!photo) return reply.code(404).send({ error: 'Foto não encontrada; sincronize os dados antes do arquivo' });

    if (kind === 'original' && !photo.has_original) {
      const [{ used, quota }] = await sql<{ used: number; quota: number }[]>`
        select coalesce(sum(size), 0)::bigint as used, (select quota_bytes from users where id = ${uid}) as quota
        from photos where user_id = ${uid} and has_original and not deleted`;
      if (used + photo.size > quota) return reply.code(507).send({ error: 'Seu espaço na nuvem acabou', code: 'quota' });
    }

    const type = kind === 'original' ? photo.type : 'image/jpeg';
    await storage.put(fileKey(uid, id, kind as FileKind), req.body as Readable, length, type);
    await sql.begin(async tx => {
      await lockUser(tx, uid);
      if (kind === 'original') await tx`update photos set has_original = true, rev = nextval('rev_seq') where id = ${id} and user_id = ${uid}`;
      else await tx`update photos set thumb_version = greatest(thumb_version, ${thumbVersion}), rev = nextval('rev_seq') where id = ${id} and user_id = ${uid}`;
    });
    return { ok: true };
  });

  app.get('/api/photos/:id/:kind', { preHandler: auth }, async (req, reply) => {
    const p = params.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'Não encontrado' });
    const { id, kind } = p.data;
    const uid = req.user!.id;
    const [photo] = await sql`select 1 from photos where id = ${id} and user_id = ${uid} and not deleted`;
    if (!photo) return reply.code(404).send({ error: 'Foto não encontrada' });
    const obj = await storage.get(fileKey(uid, id, kind));
    if (!obj) return reply.code(404).send({ error: 'Arquivo ainda não enviado' });
    reply.header('content-type', obj.type ?? 'application/octet-stream');
    if (obj.length) reply.header('content-length', obj.length);
    // Thumbnails are requested with ?v=<version>, so a given URL never changes content.
    reply.header('cache-control', kind === 'thumb' ? 'private, max-age=31536000, immutable' : 'private, max-age=3600');
    return reply.send(obj.body);
  });
}
