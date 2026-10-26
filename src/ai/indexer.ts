import { liveQuery } from 'dexie';
import { db, type Embedding } from '../lib/db';
import { getThumbBlob } from '../lib/files';
import { createStore } from '../lib/store';
import { embedImage, embedQuery, embedTexts, onModelProgress } from './client';
import { LABELS, labelStats, suggestTags } from './labels';

export interface AIStatus {
  phase: 'idle' | 'downloading' | 'indexing' | 'ready' | 'error';
  /** 0..1 while models download. */
  download: number;
  pending: number;
  error?: string;
}

export const aiStatus = createStore<AIStatus>({ phase: 'idle', download: 0, pending: 0 });

/** In-memory copy of every image embedding, for fast search. */
export const embeddingCache = new Map<string, Embedding>();

let labelVectors: Float32Array[] | undefined;
let running = false;
/** Photos whose thumbnail wasn't reachable in the last run (synced from elsewhere, not uploaded yet). */
const unavailable = new Set<string>();
let translatorWarm: Promise<unknown> | undefined;
let started = false;

const downloads = new Map<string, { loaded: number; total: number }>();
onModelProgress((file, loaded, total) => {
  downloads.set(file, { loaded, total });
  let l = 0;
  let t = 0;
  downloads.forEach(d => {
    l += d.loaded;
    t += d.total;
  });
  const download = t ? Math.floor((l / t) * 100) / 100 : 0;
  // Progress events arrive hundreds of times a second; only whole-percent changes reach the UI.
  // Later downloads (the search translator) happen quietly once the AI is already up.
  const cur = aiStatus.get();
  if ((cur.phase === 'idle' || cur.phase === 'downloading') && cur.download !== download) aiStatus.set({ ...cur, phase: 'downloading', download });
});

export async function startIndexer() {
  if (started) return;
  started = true;
  const all = await db.embeddings.toArray();
  all.forEach(e => embeddingCache.set(e.id, e));
  liveQuery(() => db.photos.where('indexed').equals(0).count()).subscribe(count => {
    aiStatus.set({ ...aiStatus.get(), pending: count });
    if (count > 0) void run();
    else if (!running && aiStatus.get().phase !== 'error') aiStatus.set({ ...aiStatus.get(), phase: embeddingCache.size ? 'ready' : 'idle' });
  });
}

async function run() {
  if (running) return;
  running = true;
  try {
    if (!labelVectors) aiStatus.set({ ...aiStatus.get(), phase: 'downloading', error: undefined });
    labelVectors ??= await embedTexts(LABELS.map(l => `a photo of ${l.prompt}`));
    aiStatus.set({ ...aiStatus.get(), phase: 'indexing', error: undefined });
    unavailable.clear();
    for (;;) {
      const batch = await db.photos.where('indexed').equals(0).filter(p => !unavailable.has(p.id)).limit(8).toArray();
      if (!batch.length) break;
      for (const photo of batch) {
        if (photo.deleted) {
          await db.photos.update(photo.id, { indexed: 1 });
          continue;
        }
        const thumb = await getThumbBlob(photo).catch(() => undefined);
        if (!thumb) {
          unavailable.add(photo.id);
          continue;
        }
        const vector = await embedImage(thumb);
        const suggestions = suggestTags(vector, labelVectors).filter(t => !photo.tags.includes(t));
        const embedding: Embedding = { id: photo.id, vector, ...labelStats(vector, labelVectors) };
        await db.transaction('rw', db.photos, db.embeddings, async () => {
          await db.embeddings.put(embedding);
          await db.photos.update(photo.id, { indexed: 1, suggestedTags: suggestions });
        });
        embeddingCache.set(photo.id, embedding);
      }
    }
    aiStatus.set({ ...aiStatus.get(), phase: 'ready', pending: unavailable.size });
    // Fetch the query translator now, so the first search doesn't wait for its download.
    translatorWarm ??= embedQuery('foto', true).catch(() => undefined);
  } catch (err) {
    console.error(err);
    aiStatus.set({ ...aiStatus.get(), phase: 'error', error: err instanceof Error ? err.message : String(err) });
  } finally {
    running = false;
  }
  // Photos imported between the last empty batch and `running = false` would otherwise wait for the next change.
  if (aiStatus.get().phase === 'error') return;
  const waiting = await db.photos.where('indexed').equals(0).primaryKeys();
  if (waiting.some(id => !unavailable.has(id))) void run();
}

/** Keeps the search cache in step with embeddings that arrive from the cloud. */
export function rememberEmbedding(e: Embedding) {
  embeddingCache.set(e.id, e);
}

/** Tries again after sync brings thumbnails or embeddings for photos that couldn't be analysed. */
export const kickIndexer = () => void run();

/** Re-runs indexing after a failure (e.g. the model download was interrupted). */
export function retryIndexer() {
  aiStatus.set({ ...aiStatus.get(), phase: 'idle', error: undefined });
  void run();
}
