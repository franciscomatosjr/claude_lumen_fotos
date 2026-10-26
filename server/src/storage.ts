import { CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { Config } from './config.js';

export type FileKind = 'original' | 'thumb';

export interface Storage {
  put(key: string, body: Readable | Buffer, length: number, type: string): Promise<void>;
  get(key: string): Promise<{ body: Readable; type?: string; length?: number } | null>;
  remove(keys: string[]): Promise<void>;
}

export const fileKey = (userId: string, photoId: string, kind: FileKind) => `u/${userId}/${photoId}/${kind}`;

export async function createStorage(cfg: Config['s3']): Promise<Storage> {
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    // Local S3 servers (SeaweedFS, MinIO) address buckets by path, not subdomain.
    forcePathStyle: !!cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: cfg.bucket }));
  }
  const Bucket = cfg.bucket;
  return {
    async put(key, body, length, type) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentLength: length, ContentType: type }));
    },
    async get(key) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return { body: r.Body as Readable, type: r.ContentType, length: r.ContentLength };
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        if (batch.length) await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: batch.map(Key => ({ Key })), Quiet: true } }));
      }
    },
  };
}
