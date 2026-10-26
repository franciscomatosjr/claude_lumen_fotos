import Dexie, { type EntityTable } from 'dexie';
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
  /** True once the on-device model has embedded this photo. */
  indexed: 0 | 1;
  /** Bumped whenever the thumbnail changes, to bust cached object URLs. */
  version: number;
}

export interface PhotoFile {
  id: string;
  original: Blob;
  thumb: Blob;
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
}

export interface Album {
  id: string;
  name: string;
  coverId?: string;
  createdAt: number;
}

export const TRASH_DAYS = 30;

class LumenDB extends Dexie {
  photos!: EntityTable<Photo, 'id'>;
  files!: EntityTable<PhotoFile, 'id'>;
  embeddings!: EntityTable<Embedding, 'id'>;
  albums!: EntityTable<Album, 'id'>;

  constructor() {
    super('lumen-fotos');
    this.version(1).stores({
      photos: 'id, &hash, takenAt, favorite, trashedAt, indexed, *tags, *albumIds',
      files: 'id',
      embeddings: 'id',
      albums: 'id, name, createdAt',
    });
  }
}

export const db = new LumenDB();

export const uid = () => crypto.randomUUID();

export const isLive = (p: Photo) => p.trashedAt === undefined;

export async function purgeExpiredTrash(now = Date.now()) {
  const limit = now - TRASH_DAYS * 24 * 3600 * 1000;
  const expired = await db.photos.where('trashedAt').below(limit).primaryKeys();
  if (expired.length) await deletePhotosForever(expired);
}

export async function deletePhotosForever(ids: string[]) {
  await db.transaction('rw', [db.photos, db.files, db.embeddings, db.albums], async () => {
    await db.photos.bulkDelete(ids);
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
  await db.albums.add({ id, name: name.trim() || 'Sem título', createdAt: Date.now(), coverId: photoIds[0] });
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
    await db.albums.delete(albumId);
  });
}
