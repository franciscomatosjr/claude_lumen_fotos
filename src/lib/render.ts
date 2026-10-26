import { zipSync } from 'fflate';
import { db, type Photo } from './db';
import { DEFAULT_EDITS, isIdentity, renderEdited, withDefaults, type EditParams } from './edits';
import { THUMB_SIZE, canvasToBlob, makeThumb } from './import';

export async function loadOriginal(id: string) {
  const file = await db.files.get(id);
  if (!file) throw new Error('Arquivo da foto não encontrado');
  return createImageBitmap(file.original, { imageOrientation: 'from-image' });
}

/** Stores the edit parameters and refreshes the thumbnail; the original stays untouched. */
export async function saveEdits(photo: Photo, edits: EditParams) {
  const bitmap = await loadOriginal(photo.id);
  const identity = isIdentity(edits);
  const thumb = identity
    ? await makeThumb(bitmap, THUMB_SIZE)
    : await canvasToBlob(renderEdited(bitmap, bitmap.width, bitmap.height, edits, THUMB_SIZE), 'image/jpeg', 0.82);
  bitmap.close();
  await db.transaction('rw', db.photos, db.files, async () => {
    await db.photos.update(photo.id, { edits: identity ? undefined : edits, version: photo.version + 1 });
    await db.files.update(photo.id, { thumb });
  });
}

export type ExportMode = 'original' | 'edited' | 'reduced';

export const EXPORT_MODES: { id: ExportMode; label: string; hint: string }[] = [
  { id: 'edited', label: 'Como está', hint: 'Com suas edições, tamanho original (JPEG). Sem localização.' },
  { id: 'original', label: 'Arquivo original', hint: 'Exatamente o arquivo importado, com todos os metadados.' },
  { id: 'reduced', label: 'Reduzida', hint: 'Até 2048 px, ideal para mensagens. Sem localização.' },
];

async function exportOne(photo: Photo, mode: ExportMode): Promise<{ name: string; blob: Blob }> {
  const file = await db.files.get(photo.id);
  if (!file) throw new Error('Arquivo da foto não encontrado');
  if (mode === 'original' || (mode === 'edited' && isIdentity(photo.edits) && !photo.lat)) {
    return { name: photo.name, blob: file.original };
  }
  const bitmap = await createImageBitmap(file.original, { imageOrientation: 'from-image' });
  const canvas = renderEdited(bitmap, bitmap.width, bitmap.height, withDefaults(photo.edits ?? DEFAULT_EDITS), mode === 'reduced' ? 2048 : Infinity);
  bitmap.close();
  const blob = await canvasToBlob(canvas, 'image/jpeg', mode === 'reduced' ? 0.85 : 0.92);
  return { name: photo.name.replace(/\.[^.]+$/, '') + '.jpg', blob };
}

export async function exportPhotos(photos: Photo[], mode: ExportMode, onProgress?: (done: number) => void) {
  if (photos.length === 1) {
    const { name, blob } = await exportOne(photos[0], mode);
    download(blob, name);
    return;
  }
  const entries: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (let i = 0; i < photos.length; i++) {
    const { name, blob } = await exportOne(photos[i], mode);
    entries[uniqueName(name, used)] = new Uint8Array(await blob.arrayBuffer());
    onProgress?.(i + 1);
  }
  // Photos are already compressed; storing them avoids burning CPU for no gain.
  const zip = zipSync(entries, { level: 0 });
  download(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `lumen-fotos-${new Date().toISOString().slice(0, 10)}.zip`);
}

export function uniqueName(name: string, used: Set<string>) {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
