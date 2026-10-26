import { signedIn } from '../sync/api';
import { db, type Photo } from './db';

/** URL of the cloud thumbnail, for photos whose thumbnail isn't on this device. */
export const remoteThumbUrl = (p: Pick<Photo, 'id' | 'remoteThumb'>) => (p.remoteThumb ? `/api/photos/${p.id}/thumb?v=${p.remoteThumb}` : undefined);

async function download(url: string) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Não foi possível baixar a foto (${res.status})`);
  return res.blob();
}

/** The original file, from this device or, failing that, from the cloud (kept here afterwards). */
export async function getOriginalBlob(p: Pick<Photo, 'id' | 'remoteOriginal'>) {
  const local = await db.files.get(p.id);
  if (local?.original) return local.original;
  if (!p.remoteOriginal || !signedIn()) throw new Error('O arquivo original desta foto não está neste aparelho');
  const original = await download(`/api/photos/${p.id}/original`);
  await db.files.put({ ...(await db.files.get(p.id)), id: p.id, original });
  return original;
}

export async function getThumbBlob(p: Pick<Photo, 'id' | 'remoteThumb'>) {
  const local = await db.files.get(p.id);
  if (local?.thumb) return local.thumb;
  const url = remoteThumbUrl(p);
  if (!url || !signedIn()) return undefined;
  return download(url);
}
