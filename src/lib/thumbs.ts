import { useEffect, useState } from 'react';
import { db, type Photo } from './db';
import { isIdentity, renderEdited, withDefaults } from './edits';
import { canvasToBlob } from './import';
import { loadOriginal } from './render';

const MAX = 1500;
/** Object URLs for thumbnails, keyed by id:version, evicted oldest-first. */
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | undefined>>();

const keyOf = (p: Pick<Photo, 'id' | 'version'>) => `${p.id}:${p.version}`;

function remember(key: string, url: string) {
  cache.set(key, url);
  if (cache.size > MAX) {
    const [oldKey, oldUrl] = cache.entries().next().value!;
    cache.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
}

export function thumbUrl(p: Pick<Photo, 'id' | 'version'>): Promise<string | undefined> {
  const key = keyOf(p);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let job = inflight.get(key);
  if (!job) {
    job = db.files.get(p.id).then(f => {
      inflight.delete(key);
      if (!f) return undefined;
      const url = URL.createObjectURL(f.thumb);
      remember(key, url);
      return url;
    });
    inflight.set(key, job);
  }
  return job;
}

export function useThumbUrl(p: Pick<Photo, 'id' | 'version'> | undefined) {
  const [url, setUrl] = useState(() => (p ? cache.get(keyOf(p)) : undefined));
  useEffect(() => {
    if (!p) return;
    let alive = true;
    const hit = cache.get(keyOf(p));
    if (hit) setUrl(hit);
    else thumbUrl(p).then(u => alive && setUrl(u));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, p?.version]);
  return url;
}

/**
 * Large image for the viewer: the original file, or a screen-sized render when the photo has edits.
 * The object URL is revoked when the photo or its version changes.
 */
export function useDisplayUrl(p: Photo | undefined) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!p) return;
    let alive = true;
    let created: string | undefined;
    (async () => {
      let blob: Blob | undefined;
      if (isIdentity(p.edits)) {
        blob = (await db.files.get(p.id))?.original;
      } else {
        const bitmap = await loadOriginal(p.id);
        const canvas = renderEdited(bitmap, bitmap.width, bitmap.height, withDefaults(p.edits), 2560);
        bitmap.close();
        blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
      }
      if (!alive || !blob) return;
      created = URL.createObjectURL(blob);
      setUrl(created);
    })().catch(err => console.warn(err));
    return () => {
      alive = false;
      setUrl(undefined);
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, p?.version]);
  return url;
}
