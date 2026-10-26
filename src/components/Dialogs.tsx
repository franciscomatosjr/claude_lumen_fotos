import { Check, FolderPlus, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { acceptAllSuggestions, addTags, addToAlbum, createAlbum, removeTag, type Album, type Photo } from '../lib/db';
import { EXPORT_MODES, exportPhotos, type ExportMode } from '../lib/render';
import { useThumbUrl } from '../lib/thumbs';
import { TagInput } from './TagInput';
import { Button, Chip, Modal, cx } from './ui';

export function AlbumPicker({ ids, albums, covers, onClose, onDone }: { ids: string[]; albums: Album[]; covers: Map<string, Photo>; onClose: () => void; onDone: (msg: string) => void }) {
  const [name, setName] = useState('');
  const add = async (album: Album) => {
    await addToAlbum(album.id, ids);
    onDone(`${ids.length} ${ids.length === 1 ? 'foto adicionada' : 'fotos adicionadas'} a “${album.name}”`);
  };
  const create = async () => {
    if (!name.trim()) return;
    await createAlbum(name, ids);
    onDone(`Álbum “${name.trim()}” criado com ${ids.length} ${ids.length === 1 ? 'foto' : 'fotos'}`);
  };
  return (
    <Modal title={`Adicionar ${ids.length} ${ids.length === 1 ? 'foto' : 'fotos'} a um álbum`} onClose={onClose}>
      <form
        className="mb-4 flex gap-2"
        onSubmit={e => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Novo álbum, ex.: Férias 2026"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent dark:border-white/15"
        />
        <Button variant="primary" type="submit" disabled={!name.trim()}>
          <FolderPlus size={16} /> Criar
        </Button>
      </form>
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {albums.map(a => (
          <button key={a.id} onClick={() => add(a)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-stone-100 dark:hover:bg-white/5">
            <AlbumCover photo={a.coverId ? covers.get(a.coverId) : undefined} className="size-10 rounded-md" />
            <span className="text-sm font-medium">{a.name}</span>
          </button>
        ))}
        {!albums.length && <p className="py-4 text-center text-sm text-stone-500">Você ainda não tem álbuns. Crie o primeiro acima.</p>}
      </div>
    </Modal>
  );
}

export function AlbumCover({ photo, className }: { photo?: Photo; className?: string }) {
  const url = useThumbUrl(photo);
  return <div className={cx('shrink-0 overflow-hidden bg-stone-200 dark:bg-white/10', className)}>{url && <img src={url} alt="" className="size-full object-cover" />}</div>;
}

export function TagDialog({ photos, allTags, onClose }: { photos: Photo[]; allTags: string[]; onClose: () => void }) {
  const ids = photos.map(p => p.id);
  const count = (list: (p: Photo) => string[]) => {
    const m = new Map<string, number>();
    photos.forEach(p => list(p).forEach(t => m.set(t, (m.get(t) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const tags = count(p => p.tags);
  const suggestions = count(p => p.suggestedTags);
  return (
    <Modal title={`Tags de ${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}`} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Concluir</Button>}>
      <TagInput autoFocus allTags={allTags} onAdd={t => addTags(ids, t)} placeholder="Digite tags separadas por vírgula" />
      <div className="mt-4 flex flex-wrap gap-1.5">
        {tags.map(([t, n]) => (
          <Chip key={t} onRemove={() => removeTag(ids, t)}>
            {t}
            {photos.length > 1 && <span className="opacity-50"> {n}</span>}
          </Chip>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div className="mt-5 rounded-xl border border-accent/30 bg-accent/5 p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium text-accent-strong dark:text-accent">
              <Sparkles size={15} /> Sugestões da IA
            </span>
            <button onClick={() => acceptAllSuggestions(ids)} className="text-xs hover:underline">
              Aceitar todas
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map(([t, n]) => (
              <Chip key={t} tone="suggested" onClick={() => addTags(photos.filter(p => p.suggestedTags.includes(t)).map(p => p.id), [t])}>
                + {t} <span className="opacity-60">{n}</span>
              </Chip>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ExportDialog({ photos, onClose }: { photos: Photo[]; onClose: () => void }) {
  const [mode, setMode] = useState<ExportMode>('edited');
  const [done, setDone] = useState<number | null>(null);
  const run = async () => {
    setDone(0);
    try {
      await exportPhotos(photos, mode, setDone);
      onClose();
    } catch (err) {
      console.error(err);
      setDone(null);
      alert('Não foi possível exportar. Tente novamente.');
    }
  };
  return (
    <Modal
      title={`Exportar ${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={run} disabled={done !== null}>
            {done !== null && <Loader2 size={16} className="animate-spin" />}
            {done !== null && photos.length > 1 ? `${done}/${photos.length}` : photos.length > 1 ? 'Baixar ZIP' : 'Baixar'}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {EXPORT_MODES.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} className={cx('flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1', mode === m.id ? 'bg-accent/10 ring-accent' : 'ring-stone-200 hover:bg-stone-50 dark:ring-white/10 dark:hover:bg-white/5')}>
            <span className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2', mode === m.id ? 'border-accent bg-accent text-stone-950' : 'border-stone-300 dark:border-white/30')}>
              {mode === m.id && <Check size={12} strokeWidth={3} />}
            </span>
            <span>
              <span className="block text-sm font-medium">{m.label}</span>
              <span className="text-xs text-stone-500">{m.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
