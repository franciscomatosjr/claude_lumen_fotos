import { describe, expect, it } from 'vitest';
import { LABELS, suggestTags } from '../ai/labels';
import { buildRows } from '../components/PhotoGrid';
import { fitAspect } from '../components/CropOverlay';
import type { Photo } from './db';
import { findNearDuplicates } from './dedupe';
import { DEFAULT_EDITS, applyColor, autoEnhance, coverScale, isIdentity, outputSize, withDefaults } from './edits';
import { dhash, hamming } from './hash';
import { uniqueName } from './render';
import { keywords, parseQuery, rankPhotos } from './search';

const photo = (over: Partial<Photo> = {}): Photo => ({
  id: Math.random().toString(36).slice(2),
  hash: Math.random().toString(36),
  phash: '0000000000000000',
  name: 'IMG_0001.jpg',
  type: 'image/jpeg',
  size: 1000,
  width: 100,
  height: 100,
  takenAt: Date.UTC(2023, 6, 10, 12),
  importedAt: 0,
  favorite: 0,
  tags: [],
  albumIds: [],
  suggestedTags: [],
  indexed: 1,
  version: 1,
  ...over,
});

describe('parseQuery', () => {
  it('pulls out the year', () => {
    expect(parseQuery('praia com o cachorro em 2023')).toEqual({ text: 'praia com o cachorro', year: 2023, month: undefined });
  });
  it('pulls out month and year', () => {
    expect(parseQuery('natal em dezembro de 2021')).toEqual({ text: 'natal', year: 2021, month: 11 });
  });
  it('handles accented months', () => {
    expect(parseQuery('festa junina março')).toMatchObject({ text: 'festa junina', month: 2 });
  });
  it('leaves plain text alone', () => {
    expect(parseQuery('aniversário da Laura')).toEqual({ text: 'aniversário da Laura', year: undefined, month: undefined });
  });
  it('accepts a bare year', () => {
    expect(parseQuery('2024')).toMatchObject({ text: '', year: 2024 });
  });
});

describe('rankPhotos', () => {
  const beach = photo({ tags: ['praia'] });
  const dog = photo({ tags: ['cachorro'], takenAt: Date.UTC(2022, 1, 1) });
  const plain = photo();

  it('falls back to keywords without a vector', () => {
    expect(rankPhotos({ photos: [beach, dog, plain], albums: [], query: parseQuery('praia'), embeddings: new Map() })).toEqual([beach]);
  });
  it('filters by date', () => {
    expect(rankPhotos({ photos: [beach, dog, plain], albums: [], query: parseQuery('2022'), embeddings: new Map() })).toEqual([dog]);
  });
  it('matches album names, ignoring accents', () => {
    const inAlbum = photo({ albumIds: ['a1'] });
    const r = rankPhotos({ photos: [inAlbum, plain], albums: [{ id: 'a1', name: 'Férias', createdAt: 0 }], query: parseQuery('ferias'), embeddings: new Map() });
    expect(r).toEqual([inAlbum]);
  });
  it('orders by similarity when a vector is given', () => {
    const v = (x: number, y: number) => new Float32Array([x, y]);
    const base = { mean: 0.2, std: 0.02 };
    const embeddings = new Map([
      [beach.id, { vector: v(0.3, 0), ...base }], // z = 5
      [dog.id, { vector: v(0.25, 0), ...base }], // z = 2.5
      [plain.id, { vector: v(0.22, 0), ...base }], // z = 1, below the cut
    ]);
    const r = rankPhotos({ photos: [plain, dog, beach], albums: [], query: parseQuery('mar'), vector: v(1, 0), embeddings });
    expect(r.map(p => p.id)).toEqual([beach.id, dog.id]);
  });
  it('judges each photo against its own baseline', () => {
    const v = (x: number) => new Float32Array([x]);
    // The hub photo scores higher in absolute terms but is ordinary for itself.
    const embeddings = new Map([
      [beach.id, { vector: v(0.26), mean: 0.2, std: 0.02 }],
      [plain.id, { vector: v(0.28), mean: 0.27, std: 0.02 }],
    ]);
    const r = rankPhotos({ photos: [plain, beach], albums: [], query: parseQuery('mar'), vector: v(1), embeddings });
    expect(r).toEqual([beach]);
  });
  it('drops stopwords from keywords', () => {
    expect(keywords('fotos da praia com o cachorro')).toEqual(['praia', 'cachorro']);
  });
});

describe('perceptual hash', () => {
  it('produces 16 hex chars and measures distance', () => {
    const gradient = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 20);
    const h = dhash(gradient);
    expect(h).toBe('ffffffffffffffff');
    expect(hamming(h, '0000000000000000')).toBe(64);
    expect(hamming(h, h)).toBe(0);
  });
});

describe('findNearDuplicates', () => {
  it('groups close hashes and puts the best first', () => {
    const a = photo({ phash: 'ffffffffffffffff', width: 100, height: 100 });
    const b = photo({ phash: 'fffffffffffffff0', width: 400, height: 300 });
    const c = photo({ phash: '0000000000000000' });
    const groups = findNearDuplicates([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map(p => p.id)).toEqual([b.id, a.id]);
  });
  it('prefers favourites when choosing the best', () => {
    const a = photo({ phash: 'aaaaaaaaaaaaaaaa', favorite: 1 });
    const b = photo({ phash: 'aaaaaaaaaaaaaaaa', width: 4000, height: 3000 });
    expect(findNearDuplicates([a, b])[0][0].id).toBe(a.id);
  });
});

describe('edits', () => {
  it('treats defaults as no edit', () => {
    expect(isIdentity(undefined)).toBe(true);
    expect(isIdentity(withDefaults({}))).toBe(true);
    expect(isIdentity(withDefaults({ exposure: 10 }))).toBe(false);
  });
  it('leaves pixels unchanged with default parameters', () => {
    const data = new Uint8ClampedArray([10, 120, 250, 255, 0, 0, 0, 255]);
    applyColor(data, 2, 1, DEFAULT_EDITS);
    expect(Array.from(data)).toEqual([10, 120, 250, 255, 0, 0, 0, 255]);
  });
  it('mono filter makes pixels grey', () => {
    const data = new Uint8ClampedArray([200, 50, 20, 255]);
    applyColor(data, 1, 1, { ...DEFAULT_EDITS, filter: 'mono' });
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
  });
  it('positive exposure brightens', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    applyColor(data, 1, 1, { ...DEFAULT_EDITS, exposure: 50 });
    expect(data[0]).toBeGreaterThan(130);
  });
  it('computes output size after rotation and crop', () => {
    const p = { ...DEFAULT_EDITS, rotate: 90 as const, crop: { x: 0, y: 0, w: 0.5, h: 1 } };
    expect(outputSize(4000, 3000, p)).toMatchObject({ width: 1500, height: 4000 });
    expect(outputSize(4000, 3000, p, 1000)).toMatchObject({ width: 375, height: 1000 });
  });
  it('scales up enough to hide corners when straightening', () => {
    expect(coverScale(100, 100, 0)).toBe(1);
    expect(coverScale(100, 100, 45)).toBeCloseTo(Math.SQRT2, 5);
  });
  it('auto-enhance stretches a flat, dark image', () => {
    const data = new Uint8ClampedArray(400);
    for (let i = 0; i < 400; i += 4) {
      const v = 40 + (i % 60);
      data.set([v, v, v + 20, 255], i);
    }
    const e = autoEnhance(data);
    expect(e.black).toBe(30); // capped, so a dark photo is never clipped too hard
    expect(e.shadows).toBeGreaterThan(0);
    expect(e.warmth).toBeGreaterThan(0); // the blue cast is warmed up
  });
});

describe('fitAspect', () => {
  it('fits a square inside a landscape frame', () => {
    const c = fitAspect(1, 400, 200);
    expect(c.w).toBeCloseTo(0.5);
    expect(c.h).toBe(1);
    expect(c.x).toBeCloseTo(0.25);
  });
  it('fits a wide crop inside a portrait frame', () => {
    const c = fitAspect(16 / 9, 900, 1600);
    expect(c.w).toBe(1);
    expect(c.h * 1600).toBeCloseTo((900 * 9) / 16);
  });
});

describe('suggestTags', () => {
  it('suggests the label that stands out', () => {
    const dim = 4;
    const labelVectors = LABELS.map((_, i) => {
      const v = new Float32Array(dim);
      v[i % dim] = i === 0 ? 1 : 0.3;
      return v;
    });
    const image = new Float32Array([1, 0, 0, 0]);
    expect(suggestTags(image, labelVectors)[0]).toBe(LABELS[0].tag);
  });
});

describe('uniqueName', () => {
  it('numbers repeated names', () => {
    const used = new Set<string>();
    expect(uniqueName('a.jpg', used)).toBe('a.jpg');
    expect(uniqueName('A.jpg', used)).toBe('A (2).jpg');
    expect(uniqueName('a.jpg', used)).toBe('a (3).jpg');
  });
});

describe('buildRows', () => {
  it('starts a header for each month and wraps rows', () => {
    const july = [1, 2, 3].map(d => photo({ takenAt: new Date(2023, 6, d).getTime() }));
    const june = [photo({ takenAt: new Date(2023, 5, 1).getTime() })];
    const rows = buildRows([...july, ...june], 2, true);
    expect(rows.map(r => r.kind)).toEqual(['header', 'photos', 'photos', 'header', 'photos']);
    expect(rows[0]).toMatchObject({ kind: 'header', label: 'Julho de 2023' });
  });
});
