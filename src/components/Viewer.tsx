import { ChevronLeft, ChevronRight, Download, FolderPlus, Heart, Info, Pencil, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { acceptAllSuggestions, addTags, dismissSuggestion, moveToTrash, removeFromAlbum, removeTag, setFavorite, type Album, type Photo } from '../lib/db';
import { useDisplayUrl, useThumbUrl } from '../lib/thumbs';
import { TagInput } from './TagInput';
import { Chip, IconButton, cx } from './ui';

interface Props {
  photos: Photo[];
  index: number;
  albums: Album[];
  allTags: string[];
  /** True while the editor or a dialog is on top, so keys go to them instead. */
  paused?: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
  onEdit: (p: Photo) => void;
  onAddToAlbum: (ids: string[]) => void;
  onExport: (ids: string[]) => void;
}

const formatBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

export function Viewer({ photos, index, albums, allTags, paused, onIndex, onClose, onEdit, onAddToAlbum, onExport }: Props) {
  const photo = photos[index] as Photo | undefined;
  const [showInfo, setShowInfo] = useState(() => window.innerWidth > 1100);
  const thumb = useThumbUrl(photo);
  const full = useDisplayUrl(photo);

  // The list is live: trashing the last photo shifts us to the new last one, or closes when none are left.
  useEffect(() => {
    if (photo) return;
    if (photos.length) onIndex(photos.length - 1);
    else onClose();
  }, [photo, photos.length, onIndex, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!photo || paused || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'f') setFavorite([photo.id], !photo.favorite);
      else if (e.key === 'e') onEdit(photo);
      else if (e.key === 'i') setShowInfo(s => !s);
      else if (e.key === 'Delete' || e.key === 'Backspace') moveToTrash([photo.id]);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo, paused, index, photos.length, onIndex, onClose, onEdit]);

  if (!photo) return null;
  const albumById = new Map(albums.map(a => [a.id, a]));

  return (
    <div className="animate-fade-in fixed inset-0 z-40 flex bg-[#0b0c0f] text-stone-100">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 px-3 py-2">
          <IconButton label="Fechar (Esc)" onClick={onClose} className="hover:bg-white/10">
            <X size={20} />
          </IconButton>
          <span className="ml-2 truncate text-sm text-stone-400">
            {index + 1} de {photos.length}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <IconButton label={photo.favorite ? 'Remover dos favoritos (F)' : 'Favoritar (F)'} onClick={() => setFavorite([photo.id], !photo.favorite)} className="hover:bg-white/10">
              <Heart size={19} className={cx(photo.favorite === 1 && 'fill-red-500 text-red-500')} />
            </IconButton>
            <IconButton label="Editar (E)" onClick={() => onEdit(photo)} className="hover:bg-white/10">
              <Pencil size={18} />
            </IconButton>
            <IconButton label="Adicionar ao álbum" onClick={() => onAddToAlbum([photo.id])} className="hover:bg-white/10">
              <FolderPlus size={19} />
            </IconButton>
            <IconButton label="Exportar" onClick={() => onExport([photo.id])} className="hover:bg-white/10">
              <Download size={19} />
            </IconButton>
            <IconButton label="Mover para a lixeira (Delete)" onClick={() => moveToTrash([photo.id])} className="hover:bg-white/10">
              <Trash2 size={18} />
            </IconButton>
            <IconButton label="Informações (I)" onClick={() => setShowInfo(s => !s)} className={cx('hover:bg-white/10', showInfo && 'bg-white/10')}>
              <Info size={19} />
            </IconButton>
          </div>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
          <img src={full ?? thumb} alt={photo.name} className="size-full object-contain" />
          {index > 0 && (
            <button aria-label="Anterior" onClick={() => onIndex(index - 1)} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 hover:bg-black/70">
              <ChevronLeft />
            </button>
          )}
          {index < photos.length - 1 && (
            <button aria-label="Próxima" onClick={() => onIndex(index + 1)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 hover:bg-black/70">
              <ChevronRight />
            </button>
          )}
        </div>
      </div>

      {showInfo && (
        <aside className="dark w-80 shrink-0 overflow-y-auto border-l border-white/10 bg-stone-900 p-5 text-sm">
          <h2 className="mb-1 break-all text-base font-semibold">{photo.name}</h2>
          <p className="text-stone-400">
            {new Date(photo.takenAt).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}
          </p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-stone-300">
            {photo.camera && (
              <>
                <dt className="text-stone-500">Câmera</dt>
                <dd>{photo.camera}</dd>
              </>
            )}
            <dt className="text-stone-500">Tamanho</dt>
            <dd>
              {photo.width} × {photo.height} · {formatBytes(photo.size)}
            </dd>
            {photo.lat !== undefined && photo.lon !== undefined && (
              <>
                <dt className="text-stone-500">Local</dt>
                <dd>
                  <a className="underline decoration-stone-600 hover:text-white" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${photo.lat}&mlon=${photo.lon}#map=14/${photo.lat}/${photo.lon}`}>
                    {photo.lat.toFixed(4)}, {photo.lon.toFixed(4)}
                  </a>
                </dd>
              </>
            )}
            {photo.edits && (
              <>
                <dt className="text-stone-500">Edição</dt>
                <dd>Editada (original preservado)</dd>
              </>
            )}
          </dl>

          <h3 className="mb-2 mt-6 font-semibold">Tags</h3>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {photo.tags.map(t => (
              <Chip key={t} onRemove={() => removeTag([photo.id], t)}>
                {t}
              </Chip>
            ))}
            {!photo.tags.length && <span className="text-stone-500">Nenhuma tag ainda.</span>}
          </div>
          <TagInput allTags={allTags} onAdd={tags => addTags([photo.id], tags)} />

          {photo.suggestedTags.length > 0 && (
            <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium text-accent">
                  <Sparkles size={15} /> Sugestões da IA
                </span>
                <button onClick={() => acceptAllSuggestions([photo.id])} className="text-xs text-stone-300 hover:text-white">
                  Aceitar todas
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {photo.suggestedTags.map(t => (
                  <Chip key={t} tone="suggested" onClick={() => addTags([photo.id], [t])} onRemove={() => dismissSuggestion([photo.id], t)}>
                    + {t}
                  </Chip>
                ))}
              </div>
              <p className="mt-2 text-xs text-stone-500">Geradas no seu dispositivo. Nada foi enviado.</p>
            </div>
          )}

          <h3 className="mb-2 mt-6 font-semibold">Álbuns</h3>
          <div className="flex flex-wrap gap-1.5">
            {photo.albumIds.map(id => albumById.get(id)).filter((a): a is Album => !!a).map(a => (
              <Chip key={a.id} onRemove={() => removeFromAlbum(a.id, [photo.id])}>
                {a.name}
              </Chip>
            ))}
            <button onClick={() => onAddToAlbum([photo.id])} className="rounded-full px-2.5 py-1 text-xs text-stone-400 ring-1 ring-white/15 hover:text-white">
              + Adicionar
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
