import exifr from 'exifr';
import { db, uid, type Photo } from './db';
import { ctx2d, makeCanvas } from './edits';
import { dhash, sha256Hex } from './hash';

export const THUMB_SIZE = 512;

export interface ImportProgress {
  total: number;
  done: number;
  added: number;
  duplicates: number;
  failed: number;
  unsupported: number;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i;

export const isImageFile = (f: File) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);

/** Collects files from a drop, walking into folders. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .map(i => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return Array.from(dt.files);
  const out: File[] = [];
  await Promise.all(entries.map(e => walk(e, out)));
  return out;
}

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push(file);
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns results in batches until it returns an empty list.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      await Promise.all(batch.map(e => walk(e, out)));
    }
  }
}

/** Asks the browser not to evict our storage under pressure. */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Not supported; storage stays best-effort.
  }
}

export async function importFiles(files: File[], onProgress: (p: ImportProgress) => void) {
  const images = files.filter(isImageFile);
  const progress: ImportProgress = {
    total: images.length,
    done: 0,
    added: 0,
    duplicates: 0,
    failed: 0,
    unsupported: files.length - images.length,
  };
  onProgress({ ...progress });
  await requestPersistentStorage();

  // Hashes seen in this batch, so the same file dropped twice is caught before it reaches the DB.
  const seen = new Set<string>();
  let next = 0;
  const worker = async () => {
    while (next < images.length) {
      const file = images[next++];
      try {
        const result = await importOne(file, seen);
        progress[result]++;
      } catch (err) {
        console.warn('Falha ao importar', file.name, err);
        progress.failed++;
      }
      progress.done++;
      onProgress({ ...progress });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return progress;
}

async function importOne(file: File, seen: Set<string>): Promise<'added' | 'duplicates'> {
  const buf = await file.arrayBuffer();
  const hash = await sha256Hex(buf);
  if (seen.has(hash)) return 'duplicates';
  // Claim the hash before awaiting, so a parallel worker holding the same bytes sees it.
  seen.add(hash);
  if (await db.photos.where('hash').equals(hash).filter(p => !p.deleted).count()) return 'duplicates';

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = bitmap;
  const thumb = await makeThumb(bitmap, THUMB_SIZE);
  const phash = perceptualHash(bitmap);
  bitmap.close();

  const meta = await readExif(buf);
  const photo: Photo = {
    id: uid(),
    hash,
    phash,
    name: file.name,
    type: file.type || 'image/jpeg',
    size: file.size,
    width,
    height,
    takenAt: meta.takenAt ?? file.lastModified ?? Date.now(),
    importedAt: Date.now(),
    camera: meta.camera,
    lat: meta.lat,
    lon: meta.lon,
    favorite: 0,
    tags: [],
    albumIds: [],
    suggestedTags: [],
    indexed: 0,
    version: 1,
    updatedAt: Date.now(),
    dirty: 1,
  };
  await db.transaction('rw', db.photos, db.files, async () => {
    await db.photos.add(photo);
    await db.files.add({ id: photo.id, original: file, thumb });
  });
  return 'added';
}

export async function makeThumb(src: ImageBitmap | OffscreenCanvas | HTMLCanvasElement, max: number) {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = makeCanvas(Math.round(src.width * k), Math.round(src.height * k));
  const ctx = ctx2d(c);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return canvasToBlob(c, 'image/jpeg', 0.82);
}

export function canvasToBlob(c: OffscreenCanvas | HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality });
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob falhou'))), type, quality));
}

function perceptualHash(src: ImageBitmap) {
  const c = makeCanvas(9, 8);
  const ctx = ctx2d(c);
  ctx.drawImage(src, 0, 0, 9, 8);
  const { data } = ctx.getImageData(0, 0, 9, 8);
  const gray = new Array<number>(72);
  for (let i = 0; i < 72; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return dhash(gray);
}

async function readExif(buf: ArrayBuffer): Promise<{ takenAt?: number; camera?: string; lat?: number; lon?: number }> {
  try {
    const e = await exifr.parse(buf, { tiff: true, exif: true, gps: true, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false });
    if (!e) return {};
    const date: unknown = e.DateTimeOriginal ?? e.CreateDate ?? e.ModifyDate;
    const camera = [e.Make, e.Model].filter(Boolean).join(' ').trim() || undefined;
    return {
      takenAt: date instanceof Date && !isNaN(date.getTime()) ? date.getTime() : undefined,
      camera,
      lat: typeof e.latitude === 'number' ? e.latitude : undefined,
      lon: typeof e.longitude === 'number' ? e.longitude : undefined,
    };
  } catch {
    return {};
  }
}
