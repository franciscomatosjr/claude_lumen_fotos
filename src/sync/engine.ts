import { liveQuery } from 'dexie';
import { kickIndexer, rememberEmbedding } from '../ai/indexer';
import { applyFromServer, db, type Album, type Embedding, type Photo } from '../lib/db';
import type { EditParams } from '../lib/edits';
import { refreshLocalThumb } from '../lib/render';
import { createStore } from '../lib/store';
import { api, ApiError, session, signedIn, type Account } from './api';

export interface SyncStatus {
  state: 'off' | 'idle' | 'syncing' | 'offline' | 'quota' | 'error';
  /** Records with changes not yet accepted by the server. */
  pending: number;
  /** Files still waiting to be uploaded in the current run. */
  uploading: number;
  lastSync?: number;
  error?: string;
}

export const syncStatus = createStore<SyncStatus>({ state: 'off', pending: 0, uploading: 0 });
const setStatus = (patch: Partial<SyncStatus>) => syncStatus.set({ ...syncStatus.get(), ...patch });

// ---- Wire format -------------------------------------------------------------------------------

interface PhotoDTO {
  id: string;
  hash: string;
  phash: string;
  name: string;
  type: string;
  size: number;
  width: number;
  height: number;
  takenAt: number;
  importedAt: number;
  camera: string | null;
  lat: number | null;
  lon: number | null;
  favorite: boolean;
  trashedAt: number | null;
  tags: string[];
  albumIds: string[];
  suggestedTags: string[];
  edits: EditParams | null;
  version: number;
  updatedAt: number;
  deleted: boolean;
  hasOriginal?: boolean;
  thumbVersion?: number;
}

interface AlbumDTO {
  id: string;
  name: string;
  coverId: string | null;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

interface EmbeddingDTO {
  id: string;
  vector: string;
  mean: number;
  std: number;
}

export const photoToDTO = (p: Photo): PhotoDTO => ({
  id: p.id,
  hash: p.hash,
  phash: p.phash,
  name: p.name,
  type: p.type,
  size: p.size,
  width: p.width,
  height: p.height,
  takenAt: Math.round(p.takenAt),
  importedAt: Math.round(p.importedAt),
  camera: p.camera ?? null,
  lat: p.lat ?? null,
  lon: p.lon ?? null,
  favorite: !!p.favorite,
  trashedAt: p.trashedAt ?? null,
  tags: p.tags,
  albumIds: p.albumIds,
  suggestedTags: p.suggestedTags,
  edits: p.edits ?? null,
  version: p.version,
  updatedAt: p.updatedAt,
  deleted: !!p.deleted,
});

/** Server record → local record, keeping what only this device knows. */
export const photoFromDTO = (d: PhotoDTO, local?: Photo): Photo => ({
  id: d.id,
  hash: d.hash,
  phash: d.phash,
  name: d.name,
  type: d.type,
  size: d.size,
  width: d.width,
  height: d.height,
  takenAt: d.takenAt,
  importedAt: d.importedAt,
  camera: d.camera ?? undefined,
  lat: d.lat ?? undefined,
  lon: d.lon ?? undefined,
  favorite: d.favorite ? 1 : 0,
  trashedAt: d.trashedAt ?? undefined,
  tags: d.tags,
  albumIds: d.albumIds,
  suggestedTags: d.suggestedTags,
  edits: d.edits ?? undefined,
  version: d.version,
  deleted: d.deleted ? 1 : undefined,
  updatedAt: d.updatedAt,
  dirty: 0,
  indexed: local?.indexed ?? 0,
  uploaded: d.hasOriginal ? 1 : local?.uploaded,
  thumbUploaded: Math.max(local?.thumbUploaded ?? 0, d.thumbVersion ?? 0),
  remoteOriginal: d.hasOriginal ? 1 : 0,
  remoteThumb: d.thumbVersion ?? 0,
});

const albumToDTO = (a: Album): AlbumDTO => ({ id: a.id, name: a.name, coverId: a.coverId ?? null, createdAt: a.createdAt, updatedAt: a.updatedAt, deleted: !!a.deleted });

export function vectorToBase64(v: Float32Array) {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function vectorFromBase64(b64: string) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

// ---- Sync run ----------------------------------------------------------------------------------

const BATCH = 200;
let running = false;
let again = false;

/** Pushes local changes, pulls remote ones, then uploads files. Safe to call often. */
export async function syncNow() {
  if (!signedIn()) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  setStatus({ state: 'syncing', error: undefined });
  try {
    do {
      again = false;
      await push();
      await pull();
      await uploadFiles();
    } while (again);
    setStatus({ state: 'idle', lastSync: Date.now(), uploading: 0 });
    void refreshAccount();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) setStatus({ state: 'off' });
    else if (err instanceof ApiError && err.code === 'quota') setStatus({ state: 'quota', uploading: 0 });
    else if (err instanceof TypeError) setStatus({ state: 'offline' });
    else setStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
}

async function push() {
  for (;;) {
    const [photos, albums, embeddings] = await Promise.all([
      db.photos.where('dirty').equals(1).limit(BATCH).toArray(),
      db.albums.where('dirty').equals(1).limit(BATCH).toArray(),
      db.embeddings.where('dirty').equals(1).limit(BATCH).toArray(),
    ]);
    if (!photos.length && !albums.length && !embeddings.length) return;
    const res = await api<{ photos: string[]; albums: string[]; embeddings: string[]; duplicates: { id: string; existingId: string }[] }>('/sync/push', {
      method: 'POST',
      json: {
        photos: photos.map(photoToDTO),
        albums: albums.map(albumToDTO),
        embeddings: embeddings.map(e => ({ id: e.id, vector: vectorToBase64(e.vector), mean: e.mean, std: e.std })),
      },
    });

    const sentAt = new Map(photos.map(p => [p.id, p.updatedAt]));
    const albumSentAt = new Map(albums.map(a => [a.id, a.updatedAt]));
    await db.transaction('rw', [db.photos, db.albums, db.embeddings, db.files], async () => {
      // Only clear the flag if nothing changed while the request was in flight.
      for (const id of res.photos) await db.photos.where('id').equals(id).filter(p => p.updatedAt === sentAt.get(id)).modify({ dirty: 0 });
      for (const id of res.albums) await db.albums.where('id').equals(id).filter(a => a.updatedAt === albumSentAt.get(id)).modify({ dirty: 0 });
      if (res.embeddings.length) await db.embeddings.where('id').anyOf(res.embeddings).modify({ dirty: 0 });
      // The same file is already in the cloud under another id: keep that one, hand it our local files.
      for (const { id, existingId } of res.duplicates) {
        const file = await db.files.get(id);
        if (file && !(await db.files.get(existingId))) await db.files.put({ ...file, id: existingId });
        await db.photos.delete(id);
        await db.files.delete(id);
        await db.embeddings.delete(id);
      }
    });
    if (!res.photos.length && !res.albums.length && !res.embeddings.length && !res.duplicates.length) return;
  }
}

async function pull() {
  let cursor = Number((await db.meta.get('cursor'))?.value ?? 0);
  for (;;) {
    const page = await api<{ photos: PhotoDTO[]; albums: AlbumDTO[]; embeddings: EmbeddingDTO[]; cursor: number; more: boolean }>(`/sync/pull?since=${cursor}`);
    const refresh: Photo[] = [];
    const embedded: Embedding[] = [];
    await applyFromServer([db.photos, db.albums, db.embeddings, db.files, db.meta], async () => {
      for (const d of page.photos) {
        const local = await db.photos.get(d.id);
        if (local?.dirty && local.updatedAt > d.updatedAt) {
          // Our pending change is newer and will be pushed; only learn what the cloud holds.
          await db.photos.update(d.id, { remoteOriginal: d.hasOriginal ? 1 : 0, remoteThumb: d.thumbVersion ?? 0 });
          continue;
        }
        if (d.deleted) {
          if (local) {
            await db.photos.put(photoFromDTO(d, local));
            await db.files.delete(d.id);
            await db.embeddings.delete(d.id);
          }
          continue;
        }
        const next = photoFromDTO(d, local);
        if (local && local.version !== next.version) refresh.push(next);
        await db.photos.put(next);
      }
      for (const d of page.albums) {
        const local = await db.albums.get(d.id);
        if (local?.dirty && local.updatedAt > d.updatedAt) continue;
        await db.albums.put({ id: d.id, name: d.name, coverId: d.coverId ?? undefined, createdAt: d.createdAt, updatedAt: d.updatedAt, dirty: 0, deleted: d.deleted ? 1 : undefined });
      }
      for (const d of page.embeddings) {
        const e: Embedding = { id: d.id, vector: vectorFromBase64(d.vector), mean: d.mean, std: d.std, dirty: 0 };
        await db.embeddings.put(e);
        await db.photos.update(d.id, { indexed: 1 });
        embedded.push(e);
      }
      await db.meta.put({ key: 'cursor', value: page.cursor });
    });
    embedded.forEach(rememberEmbedding);
    for (const p of refresh) await refreshLocalThumb(p).catch(err => console.warn('miniatura', err));
    if (page.photos.length) kickIndexer();
    cursor = page.cursor;
    if (!page.more) return;
  }
}

async function uploadFiles() {
  const queue = (await db.photos.filter(p => !p.deleted && p.dirty === 0 && (p.uploaded !== 1 || (p.thumbUploaded ?? 0) < p.version)).toArray()).map(p => p.id);
  setStatus({ uploading: queue.length });
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const [p, file] = await Promise.all([db.photos.get(id), db.files.get(id)]);
      if (p && file?.original && p.uploaded !== 1) {
        if (await put(`/api/photos/${id}/original`, file.original)) await db.photos.update(id, { uploaded: 1, remoteOriginal: 1 });
      }
      if (p && file?.thumb && (p.thumbUploaded ?? 0) < p.version) {
        if (await put(`/api/photos/${id}/thumb?version=${p.version}`, file.thumb)) await db.photos.update(id, { thumbUploaded: p.version, remoteThumb: p.version });
      }
      setStatus({ uploading: queue.length });
    }
  };
  await Promise.all([worker(), worker()]);
}

/** Uploads a file; false when the server no longer has the photo (deleted or merged elsewhere). */
async function put(url: string, blob: Blob) {
  const res = await fetch(url, { method: 'PUT', body: blob, credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' } });
  if (res.status === 404) return false;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new ApiError(body.error ?? `Erro ${res.status}`, res.status, body.code);
  }
  return true;
}

// ---- Account -----------------------------------------------------------------------------------

async function refreshAccount() {
  try {
    const { user } = await api<{ user: Account | null }>('/auth/me');
    if (!user) {
      session.set({ state: 'signed-out' });
      setStatus({ state: 'off' });
      return;
    }
    session.set({ state: 'signed-in', account: user });
  } catch {
    // Keeps the last known numbers.
  }
}

/** The library on this device belongs to one account; signing into another starts from a clean slate. */
async function adopt(account: Account) {
  const owner = (await db.meta.get('account'))?.value;
  if (owner && owner !== account.id) {
    await Promise.all(db.tables.map(t => t.clear()));
  }
  await db.meta.put({ key: 'account', value: account.id });
  session.set({ state: 'signed-in', account });
  setStatus({ state: 'idle' });
  void syncNow();
}

export async function signIn(mode: 'login' | 'signup', email: string, password: string) {
  const { user } = await api<{ user: Account }>(`/auth/${mode}`, { method: 'POST', json: { email, password } });
  await adopt(user);
}

/** Ends the session and removes this device's copy; everything already synced stays in the cloud. */
export async function signOut() {
  await api('/auth/logout', { method: 'POST', json: {} }).catch(() => undefined);
  await db.delete();
  location.reload();
}

let started = false;

/** Restores the session, then keeps syncing on changes, on an interval and when the network returns. */
export async function startSync() {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), 1500);
  };
  liveQuery(async () => {
    const [p, a, e] = await Promise.all([db.photos.where('dirty').equals(1).count(), db.albums.where('dirty').equals(1).count(), db.embeddings.where('dirty').equals(1).count()]);
    return p + a + e;
  }).subscribe(pending => {
    setStatus({ pending });
    if (pending) soon();
  });
  setInterval(() => void syncNow(), 60_000);
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void syncNow());

  try {
    const { user } = await api<{ user: Account | null }>('/auth/me');
    if (user) await adopt(user);
    else session.set({ state: 'signed-out' });
  } catch (err) {
    session.set({ state: 'signed-out' });
    if (!(err instanceof ApiError)) setStatus({ state: 'offline' });
  }
}
