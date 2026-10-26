import { Copy, FolderOpen, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createAlbum, deleteAlbum, db, moveToTrash, type Album, type Photo } from '../lib/db';
import { findNearDuplicates } from '../lib/dedupe';
import { useThumbUrl } from '../lib/thumbs';
import { AlbumCover } from './Dialogs';
import { Button, Empty, IconButton, Modal, cx } from './ui';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const formatMB = (bytes: number) =>
  bytes < 1e6
    ? `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1e3))} KB`
    : bytes < 1e9
      ? `${(bytes / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
      : `${(bytes / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;

export function AlbumsView({ albums, photos, onOpen }: { albums: Album[]; photos: Photo[]; onOpen: (id: string) => void }) {
  const [creating, setCreating] = useState(false);
  const byId = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    photos.forEach(p => p.albumIds.forEach(a => m.set(a, (m.get(a) ?? 0) + 1)));
    return m;
  }, [photos]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Álbuns</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Novo álbum
        </Button>
      </div>
      {!albums.length ? (
        <Empty icon={<FolderOpen size={48} />} title="Nenhum álbum ainda">
          <p className="max-w-sm text-sm">Selecione fotos na biblioteca e escolha “Adicionar ao álbum”, ou crie um álbum vazio.</p>
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-5">
          {albums.map(a => (
            <button key={a.id} onClick={() => onOpen(a.id)} className="group text-left">
              <AlbumCover photo={a.coverId ? byId.get(a.coverId) : undefined} className="aspect-square w-full rounded-xl transition-transform group-hover:scale-[1.02]" />
              <p className="mt-2 truncate font-medium">{a.name}</p>
              <p className="text-sm text-stone-500">{count(counts.get(a.id) ?? 0, 'foto', 'fotos')}</p>
            </button>
          ))}
        </div>
      )}
      {creating && <NameDialog title="Novo álbum" onClose={() => setCreating(false)} onSave={name => createAlbum(name)} />}
    </div>
  );
}

export function AlbumHeader({ album, count, onDeleted }: { album: Album; count: number; onDeleted: () => void }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className="flex items-center gap-2 px-4 pb-2 pt-5">
      <div>
        <h1 className="text-2xl font-semibold">{album.name}</h1>
        <p className="text-sm text-stone-500">{count === 1 ? '1 foto' : `${count} fotos`}</p>
      </div>
      <IconButton label="Renomear álbum" onClick={() => setRenaming(true)} className="ml-2">
        <Pencil size={16} />
      </IconButton>
      <IconButton
        label="Apagar álbum (as fotos continuam na biblioteca)"
        onClick={async () => {
          if (!confirm(`Apagar o álbum “${album.name}”? As fotos continuam na biblioteca.`)) return;
          await deleteAlbum(album.id);
          onDeleted();
        }}
      >
        <Trash2 size={16} />
      </IconButton>
      {renaming && <NameDialog title="Renomear álbum" initial={album.name} onClose={() => setRenaming(false)} onSave={name => db.albums.update(album.id, { name: name.trim() })} />}
    </div>
  );
}

function NameDialog({ title, initial = '', onClose, onSave }: { title: string; initial?: string; onClose: () => void; onSave: (name: string) => unknown }) {
  const [name, setName] = useState(initial);
  const submit = async () => {
    if (!name.trim()) return;
    await onSave(name);
    onClose();
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={submit} disabled={!name.trim()}>
          Salvar
        </Button>
      }
    >
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="Nome do álbum"
        className="w-full rounded-lg border border-stone-300 bg-transparent px-3 py-2 outline-none focus:border-accent dark:border-white/15"
      />
    </Modal>
  );
}

export function TagsView({ photos, onOpen }: { photos: Photo[]; onOpen: (tag: string) => void }) {
  const tags = useMemo(() => {
    const m = new Map<string, Photo[]>();
    photos.forEach(p => p.tags.forEach(t => m.set(t, [...(m.get(t) ?? []), p])));
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [photos]);
  const untagged = photos.filter(p => !p.tags.length).length;
  const withSuggestions = photos.filter(p => p.suggestedTags.length).length;

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">Tags</h1>
      <p className="mb-6 text-sm text-stone-500">
        {count(untagged, 'foto', 'fotos')} sem tags{withSuggestions > 0 && ` · ${count(withSuggestions, 'foto', 'fotos')} com sugestões da IA esperando você`}
      </p>
      {!tags.length ? (
        <Empty icon={<Tag size={48} />} title="Nenhuma tag ainda">
          <p className="max-w-sm text-sm">Selecione fotos e use “Tags”, ou aceite as sugestões da IA no painel de informações de cada foto.</p>
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
          {tags.map(([t, list]) => (
            <TagCard key={t} tag={t} photos={list} onClick={() => onOpen(t)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TagCard({ tag, photos, onClick }: { tag: string; photos: Photo[]; onClick: () => void }) {
  const url = useThumbUrl(photos[0]);
  return (
    <button onClick={onClick} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-stone-200 text-left dark:bg-white/10">
      {url && <img src={url} alt="" className="size-full object-cover transition-transform group-hover:scale-105" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
      <div className="absolute bottom-2 left-3 text-white">
        <p className="font-semibold">{tag}</p>
        <p className="text-xs opacity-80">{count(photos.length, 'foto', 'fotos')}</p>
      </div>
    </button>
  );
}

export function CleanupView({ photos, onOpenPhoto }: { photos: Photo[]; onOpenPhoto: (list: Photo[], index: number) => void }) {
  const groups = useMemo(() => findNearDuplicates(photos), [photos]);
  const extra = groups.reduce((n, g) => n + g.length - 1, 0);
  const bytes = groups.reduce((n, g) => n + g.slice(1).reduce((s, p) => s + p.size, 0), 0);

  const keepBest = (group: Photo[]) => moveToTrash(group.slice(1).map(p => p.id));
  const keepBestAll = () => moveToTrash(groups.flatMap(g => g.slice(1).map(p => p.id)));

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Limpeza</h1>
          <p className="text-sm text-stone-500">
            {groups.length
              ? `${count(groups.length, 'grupo', 'grupos')} de fotos quase iguais · ${count(extra, 'cópia', 'cópias')} · ${formatMB(bytes)} a liberar`
              : 'Nenhuma foto quase igual encontrada. Duplicatas exatas já são descartadas na importação.'}
          </p>
        </div>
        {groups.length > 0 && (
          <Button variant="primary" onClick={keepBestAll}>
            Manter a melhor de cada grupo
          </Button>
        )}
      </div>
      {!groups.length && <Empty icon={<Copy size={48} />} title="Tudo limpo" />}
      <div className="space-y-6">
        {groups.map(g => (
          <div key={g[0].id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200 dark:bg-white/5 dark:ring-white/10">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-stone-500">{g.length} fotos parecidas · a marcada como “Melhor” fica</p>
              <Button onClick={() => keepBest(g)}>Manter só a melhor</Button>
            </div>
            <div className="flex gap-3 overflow-x-auto">
              {g.map((p, i) => (
                <DupTile key={p.id} photo={p} best={i === 0} onClick={() => onOpenPhoto(g, i)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DupTile({ photo, best, onClick }: { photo: Photo; best: boolean; onClick: () => void }) {
  const url = useThumbUrl(photo);
  return (
    <button onClick={onClick} className="w-40 shrink-0 text-left">
      <div className={cx('relative aspect-square overflow-hidden rounded-lg bg-stone-200 ring-2 dark:bg-white/10', best ? 'ring-accent' : 'ring-transparent')}>
        {url && <img src={url} alt="" className="size-full object-cover" />}
        {best && <span className="absolute left-1.5 top-1.5 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-stone-950">Melhor</span>}
      </div>
      <p className="mt-1 truncate text-xs text-stone-500">
        {photo.width}×{photo.height} · {formatMB(photo.size)}
      </p>
    </button>
  );
}
