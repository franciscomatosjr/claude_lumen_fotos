import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptAllSuggestions,
  addTags,
  addToAlbum,
  createAlbum,
  db,
  deleteAlbum,
  moveToTrash,
  purgeExpiredTrash,
  removeFromAlbum,
  restoreFromTrash,
  TRASH_DAYS,
  type Photo,
} from './db';

const photo = (id: string, over: Partial<Photo> = {}): Photo => ({
  id,
  hash: `h-${id}`,
  phash: '0000000000000000',
  name: `${id}.jpg`,
  type: 'image/jpeg',
  size: 1,
  width: 1,
  height: 1,
  takenAt: 0,
  importedAt: 0,
  favorite: 0,
  tags: [],
  albumIds: [],
  suggestedTags: [],
  indexed: 0,
  version: 1,
  ...over,
});

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  await db.photos.bulkAdd([photo('a', { suggestedTags: ['praia', 'mar'] }), photo('b'), photo('c')]);
  await db.files.bulkAdd(['a', 'b', 'c'].map(id => ({ id, original: new Blob(), thumb: new Blob() })));
});

describe('tags', () => {
  it('adds normalized tags in batch without duplicates and clears matching suggestions', async () => {
    await addTags(['a', 'b'], ['  Praia ', 'praia', 'Férias']);
    const [a, b] = await db.photos.bulkGet(['a', 'b']);
    expect(a!.tags).toEqual(['praia', 'férias']);
    expect(a!.suggestedTags).toEqual(['mar']);
    expect(b!.tags).toEqual(['praia', 'férias']);
    expect(await db.photos.where('tags').equals('praia').count()).toBe(2);
  });
  it('accepts all suggestions', async () => {
    await acceptAllSuggestions(['a']);
    const a = await db.photos.get('a');
    expect(a!.tags).toEqual(['praia', 'mar']);
    expect(a!.suggestedTags).toEqual([]);
  });
});

describe('albums', () => {
  it('creates with a cover, and moves the cover when it leaves', async () => {
    const id = await createAlbum('Viagem', ['a', 'b']);
    expect((await db.albums.get(id))!.coverId).toBe('a');
    await removeFromAlbum(id, ['a']);
    expect((await db.albums.get(id))!.coverId).toBe('b');
    await addToAlbum(id, ['b', 'c']);
    expect(await db.photos.where('albumIds').equals(id).count()).toBe(2);
  });
  it('deleting an album keeps its photos', async () => {
    const id = await createAlbum('X', ['a']);
    await deleteAlbum(id);
    expect(await db.albums.count()).toBe(0);
    expect((await db.photos.get('a'))!.albumIds).toEqual([]);
  });
});

describe('trash', () => {
  it('restores, and purges only expired photos', async () => {
    await moveToTrash(['a', 'b']);
    await restoreFromTrash(['b']);
    expect((await db.photos.get('b'))!.trashedAt).toBeUndefined();
    await purgeExpiredTrash(Date.now() + (TRASH_DAYS - 1) * 864e5);
    expect(await db.photos.get('a')).toBeDefined();
    await purgeExpiredTrash(Date.now() + (TRASH_DAYS + 1) * 864e5);
    expect(await db.photos.get('a')).toBeUndefined();
    expect(await db.files.get('a')).toBeUndefined();
    expect(await db.photos.count()).toBe(2);
  });
});
