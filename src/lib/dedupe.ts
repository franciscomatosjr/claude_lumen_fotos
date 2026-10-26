import type { Photo } from './db';

const popcount32 = (x: number) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

const split = (hex: string) => [parseInt(hex.slice(0, 8), 16) | 0, parseInt(hex.slice(8, 16), 16) | 0] as const;

/**
 * Groups visually near-identical photos (bursts, re-saved copies, resized versions).
 * Photos are compared with their neighbours in time plus any photo with the very same hash, which keeps
 * the work linear for large libraries.
 */
export function findNearDuplicates(photos: Photo[], maxDistance = 6, window = 40): Photo[][] {
  const sorted = [...photos].sort((a, b) => a.takenAt - b.takenAt);
  const hashes = sorted.map(p => split(p.phash));
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  const byHash = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    const same = byHash.get(sorted[i].phash);
    if (same !== undefined) union(i, same);
    else byHash.set(sorted[i].phash, i);
    for (let j = Math.max(0, i - window); j < i; j++) {
      const d = popcount32(hashes[i][0] ^ hashes[j][0]) + popcount32(hashes[i][1] ^ hashes[j][1]);
      if (d <= maxDistance) union(i, j);
    }
  }

  const groups = new Map<number, Photo[]>();
  sorted.forEach((p, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(p);
    else groups.set(r, [p]);
  });
  return [...groups.values()].filter(g => g.length > 1).map(g => g.sort(byQuality));
}

/** Best first: favourites, then more pixels, then the larger file. */
export const byQuality = (a: Photo, b: Photo) => b.favorite - a.favorite || b.width * b.height - a.width * a.height || b.size - a.size;
