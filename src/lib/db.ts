import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type { EditParams } from './edits';

export interface Photo {
  id: string;
  /** SHA-256 of the original bytes; used to skip exact duplicates. */
  hash: string;
  /** 64-bit difference hash (hex) used to find near-duplicates. */
  phash: string;
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  /** Capture date (EXIF) or file date, in ms. */
  takenAt: number;
  importedAt: number;
  camera?: string;
  lat?: number;
  lon?: number;
  favorite: 0 | 1;
  /** Set when moved to the trash; purged after TRASH_DAYS. */
  trashedAt?: number;
  tags: string[];
  albumIds: string[];
  /** Tags proposed by the on-device model, waiting for the user to accept or dismiss. */
  suggestedTags: string[];
  edits?: EditParams;
  /** Bumped whenever the thumbnail changes, to bust cached object URLs. */
  version: number;
  /** Deleted for good; kept as a tombstone so other devices learn about it. */
  deleted?: 0 | 1;

  // Sync bookkeeping. `updatedAt` and `dirty` are set by the hooks below on every user change.
  updatedAt: number;
  /** 1 while this record has changes the server hasn't accepted yet. */
  dirty: 0 | 1;

  // Local-only state, never sent to the server.
  /** True once the on-device model has embedded this photo. */
  indexed: 0 | 1;
  /** 1 once this device's original file is stored in the cloud. */
  uploaded?: 0 | 1;
  /** Thumbnail version this device last uploaded. */
  thumbUploaded?: number;
  /** What the cloud holds, for photos whose files aren't on this device. */
  remoteOriginal?: 0 | 1;
  remoteThumb?: number;
}

/** Fields that describe this device's state; changing only these is not a user change to sync. */
const LOCAL_ONLY = new Set(['indexed', 'dirty', 'updatedAt', 'uploaded', 'thumbUploaded', 'remoteOriginal', 'remoteThumb']);

/** Files kept on this device. A photo synced from another device may have neither until it is viewed. */
export interface PhotoFile {
  id: string;
  original?: Blob;
  thumb?: Blob;
}

export interface Embedding {
  id: string;
  vector: Float32Array;
  /**
   * Mean and spread of this photo's similarity to the tag vocabulary. Some photos look a bit like
   * everything; search scores each photo against its own baseline so they don't crowd the results.
   */
  mean: number;
  std: number;
  dirty?: 0 | 1;
}

export interface Album {
  id: string;
  name: string;
  coverId?: string;
  createdAt: number;
  updatedAt: number;
  dirty: 0 | 1;
  deleted?: 0 | 1;
}

export interface Meta {
  key: 'account' | 'cursor';
  value: string | number;
}

export const TRASH_DAYS = 30;

class LumenDB extends Dexie {
  photos!: EntityTable<Photo, 'id'>;
  files!: EntityTable<PhotoFile, 'id'>;
  embeddings!: EntityTable<Embedding, 'id'>;
  albums!: EntityTable<Album, 'id'>;
  meta!: EntityTable<Meta, 'key'>;

  constructor() {
    super('lumen-fotos');
    this.version(1).stores({
      photos: 'id, &hash, takenAt, favorite, trashedAt, indexed, *tags, *albumIds',
      files: 'id',
      embeddings: 'id',
      albums: 'id, name, createdAt',
    });
    // v2: cloud sync. Everything that already exists is pending, so the first sign-in backs it all up.
    this.version(2)
      .stores({
        photos: 'id, hash, takenAt, favorite, trashedAt, indexed, dirty, *tags, *albumIds',
        files: 'id',
        embeddings: 'id, dirty',
        albums: 'id, name, createdAt, dirty',
        meta: 'key',
      })
      .upgrade(async tx => {
        await tx.table('photos').toCollection().modify((p: Photo) => {
          p.updatedAt = p.importedAt;
          p.dirty = 1;
        });
        await tx.table('albums').toCollection().modify((a: Album) => {
          a.updatedAt = a.createdAt;
          a.dirty = 1;
        });
        await tx.table('embeddings').toCollection().modify((e: Embedding) => {
          e.dirty = 1;
        });
      });
  }
}

export const db = new LumenDB();

type Tagged = Transaction & { fromServer?: boolean };

/** Runs `fn` in a transaction whose writes are not marked as local changes (they came from the server). */
export function applyFromServer<T>(tables: Dexie.Table[], fn: () => Promise<T>) {
  return db.transaction('rw', tables, (tx: Tagged) => {
    tx.fromServer = true;
    return fn();
  });
}

// Every user change marks the record pending and stamps it; sync later pushes what is pending.
for (const table of [db.photos, db.albums] as Dexie.Table<{ dirty: 0 | 1; updatedAt: number }, string>[]) {
  table.hook('creating', (_key, obj, tx: Tagged) => {
    if (tx.fromServer) return;
    obj.dirty = 1;
    obj.updatedAt = Date.now();
  });
  table.hook('updating', (mods, _key, obj, tx: Tagged) => {
    if (tx.fromServer) return;
    // Dexie lists array fields as modified even when unchanged, so compare values.
    const current = obj as unknown as Record<string, unknown>;
    const changed = Object.entries(mods as Record<string, unknown>).filter(
      ([k, v]) => !LOCAL_ONLY.has(k.split('.')[0]) && (k.includes('.') || JSON.stringify(v) !== JSON.stringify(current[k])),
    );
    if (!changed.length) return;
    return { dirty: 1, updatedAt: Date.now() };
  });
}
db.embeddings.hook('creating', (_key, obj, tx: Tagged) => {
  if (!tx.fromServer) obj.dirty = 1;
});

export const uid = () => crypto.randomUUID();

export const isLive = (p: Photo) => p.trashedAt === undefined && !p.deleted;

export async function purgeExpiredTrash(now = Date.now()) {
  const limit = now - TRASH_DAYS * 24 * 3600 * 1000;
  const expired = (await db.photos.where('trashedAt').below(limit).toArray()).filter(p => !p.deleted).map(p => p.id);
  if (expired.length) await deletePhotosForever(expired);
}

/** Removes the files; the record stays as a tombstone so the deletion reaches the cloud and other devices. */
export async function deletePhotosForever(ids: string[]) {
  await db.transaction('rw', [db.photos, db.files, db.embeddings, db.albums], async () => {
    await db.photos.where('id').anyOf(ids).modify({ deleted: 1, tags: [], albumIds: [], suggestedTags: [] });
    await db.files.bulkDelete(ids);
    await db.embeddings.bulkDelete(ids);
    const idSet = new Set(ids);
    await db.albums.toCollection().modify(a => {
      if (a.coverId && idSet.has(a.coverId)) delete a.coverId;
    });
  });
}

export async function moveToTrash(ids: string[]) {
  const now = Date.now();
  await db.photos.where('id').anyOf(ids).modify({ trashedAt: now });
}

export async function restoreFromTrash(ids: string[]) {
  await db.photos.where('id').anyOf(ids).modify(p => {
    delete p.trashedAt;
  });
}

export async function setFavorite(ids: string[], favorite: boolean) {
  await db.photos.where('id').anyOf(ids).modify({ favorite: favorite ? 1 : 0 });
}

export const normalizeTag = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

export async function addTags(ids: string[], tags: string[]) {
  const clean = tags.map(normalizeTag).filter(Boolean);
  await db.photos.where('id').anyOf(ids).modify(p => {
    p.tags = [...new Set([...p.tags, ...clean])];
    p.suggestedTags = p.suggestedTags.filter(t => !clean.includes(t));
  });
}

export async function removeTag(ids: string[], tag: string) {
  await db.photos.where('id').anyOf(ids).modify(p => {
    p.tags = p.tags.filter(t => t !== tag);
  });
}

export async function dismissSuggestion(ids: string[], tag: string) {
  await db.photos.where('id').anyOf(ids).modify(p => {
    p.suggestedTags = p.suggestedTags.filter(t => t !== tag);
  });
}

export async function acceptAllSuggestions(ids: string[]) {
  await db.photos.where('id').anyOf(ids).modify(p => {
    p.tags = [...new Set([...p.tags, ...p.suggestedTags])];
    p.suggestedTags = [];
  });
}

export async function createAlbum(name: string, photoIds: string[] = []) {
  const id = uid();
  const now = Date.now();
  await db.albums.add({ id, name: name.trim() || 'Sem título', createdAt: now, updatedAt: now, dirty: 1, coverId: photoIds[0] });
  if (photoIds.length) await addToAlbum(id, photoIds);
  return id;
}

export async function addToAlbum(albumId: string, ids: string[]) {
  await db.photos.where('id').anyOf(ids).modify(p => {
    if (!p.albumIds.includes(albumId)) p.albumIds.push(albumId);
  });
  const album = await db.albums.get(albumId);
  if (album && !album.coverId) await db.albums.update(albumId, { coverId: ids[0] });
}

export async function removeFromAlbum(albumId: string, ids: string[]) {
  await db.photos.where('id').anyOf(ids).modify(p => {
    p.albumIds = p.albumIds.filter(a => a !== albumId);
  });
  const album = await db.albums.get(albumId);
  if (album?.coverId && ids.includes(album.coverId)) {
    const next = await db.photos.where('albumIds').equals(albumId).first();
    await db.albums.update(albumId, { coverId: next?.id });
  }
}

export async function deleteAlbum(albumId: string) {
  await db.transaction('rw', db.photos, db.albums, async () => {
    await db.photos.where('albumIds').equals(albumId).modify(p => {
      p.albumIds = p.albumIds.filter(a => a !== albumId);
    });
    await db.albums.update(albumId, { deleted: 1 });
  });
}
