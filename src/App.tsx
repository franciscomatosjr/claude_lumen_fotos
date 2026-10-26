import { useLiveQuery } from 'dexie-react-hooks';
import { Heart, Search as SearchIcon, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { embedQuery } from './ai/client';
import { aiStatus, embeddingCache, startIndexer } from './ai/indexer';
import { startSync } from './sync/engine';
import { DropOverlay, ImportToast, SearchBox, SelectionBar, Sidebar, Toast, TopBar, Welcome, type View } from './components/Chrome';
import { AlbumPicker, ExportDialog, TagDialog } from './components/Dialogs';
import { Editor } from './components/Editor';
import { PhotoGrid } from './components/PhotoGrid';
import { Viewer } from './components/Viewer';
import { AlbumHeader, AlbumsView, CleanupView, TagsView } from './components/Views';
import { Button, Empty } from './components/ui';
import { db, deletePhotosForever, isLive, moveToTrash, purgeExpiredTrash, removeFromAlbum, restoreFromTrash, setFavorite, TRASH_DAYS, type Photo } from './lib/db';
import { filesFromDataTransfer, importFiles, type ImportProgress } from './lib/import';
import { parseQuery, rankPhotos } from './lib/search';
import { useStore } from './lib/store';

type Dialog = { kind: 'album' | 'tags' | 'export'; ids: string[] } | null;

const readPref = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writePref = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: preferences just don't persist.
  }
};

const byNewest = (a: Photo, b: Photo) => b.takenAt - a.takenAt;

export default function App() {
  const allPhotos = useLiveQuery(() => db.photos.toArray(), []);
  const albums = useLiveQuery(() => db.albums.orderBy('createdAt').reverse().filter(a => !a.deleted).toArray(), []) ?? [];
  const ai = useStore(aiStatus);

  const [view, setView] = useState<View>({ kind: 'library' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ ids: string[]; query: string; hint?: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const lastPicked = useRef<number | null>(null);
  const [viewer, setViewer] = useState<{ ids: string[]; index: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dark, setDark] = useState(() => (readPref('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark');
  const [tileSize, setTileSize] = useState(() => Number(readPref('tileSize')) || 190);

  const searchRef = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    writePref('theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => writePref('tileSize', String(tileSize)), [tileSize]);

  useEffect(() => {
    void purgeExpiredTrash().then(startIndexer);
    void startSync();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const live = useMemo(() => (allPhotos ?? []).filter(isLive).sort(byNewest), [allPhotos]);
  const trashed = useMemo(() => (allPhotos ?? []).filter(p => !isLive(p) && !p.deleted).sort((a, b) => b.trashedAt! - a.trashedAt!), [allPhotos]);
  const byId = useMemo(() => new Map((allPhotos ?? []).map(p => [p.id, p])), [allPhotos]);
  const allTags = useMemo(() => [...new Set(live.flatMap(p => p.tags))].sort(), [live]);

  const scope = useMemo(() => {
    switch (view.kind) {
      case 'favorites':
        return live.filter(p => p.favorite);
      case 'album':
        return live.filter(p => p.albumIds.includes(view.id));
      case 'tag':
        return live.filter(p => p.tags.includes(view.tag));
      case 'trash':
        return trashed;
      default:
        return live;
    }
  }, [view, live, trashed]);

  const searchable = view.kind === 'library' || view.kind === 'favorites' || view.kind === 'album' || view.kind === 'tag';

  // Debounced search: dates are filtered exactly, the rest is matched by meaning on-device.
  useEffect(() => {
    if (!query.trim() || !searchable) {
      setResults(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const parsed = parseQuery(query);
      let vector: Float32Array | undefined;
      let hint: string | undefined;
      setSearching(true);
      if (parsed.text && embeddingCache.size > 0) {
        try {
          const r = await embedQuery(parsed.text, true);
          vector = r.vector;
          hint = `Entendido como: “${r.english}”`;
        } catch {
          hint = 'A IA não está disponível agora; buscando por tags e nomes.';
        }
      } else if (parsed.text) {
        hint = 'A IA ainda está analisando suas fotos; buscando por tags e nomes.';
      }
      if (!alive) return;
      const ranked = rankPhotos({ photos: scope, albums, query: parsed, vector, embeddings: embeddingCache });
      setResults({ ids: ranked.map(p => p.id), query, hint });
      setSearching(false);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // Re-run when the library changes size or the AI finishes, not on every tag edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, view, scope.length, ai.phase, searchable]);

  const list = useMemo(() => (results && searchable ? results.ids.map(id => byId.get(id)).filter((p): p is Photo => !!p && isLive(p)) : scope), [results, searchable, scope, byId]);

  useEffect(() => {
    setSelection(new Set());
    lastPicked.current = null;
  }, [view]);

  const runImport = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setView({ kind: 'library' });
    setQuery('');
    await importFiles(files, setImporting);
  }, []);

  // Drag and drop anywhere on the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      await runImport(await filesFromDataTransfer(e.dataTransfer));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [runImport]);

  // Global shortcuts; the viewer and editor handle their own keys while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewer || editing || dialog) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && selection.size) {
        setSelection(new Set());
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !typing) {
        e.preventDefault();
        setSelection(new Set(list.map(p => p.id)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer, editing, dialog, selection.size, list]);

  const onSelect = (index: number, mode: 'toggle' | 'range') => {
    const next = new Set(selection);
    if (mode === 'range' && lastPicked.current !== null) {
      const [a, b] = [lastPicked.current, index].sort((x, y) => x - y);
      list.slice(a, b + 1).forEach(p => next.add(p.id));
    } else {
      const id = list[index].id;
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
    lastPicked.current = index;
    setSelection(next);
  };

  const selectedIds = [...selection];
  const selectedPhotos = selectedIds.map(id => byId.get(id)).filter((p): p is Photo => !!p);
  const done = (msg: string) => {
    setToast(msg);
    setSelection(new Set());
  };
  const plural = (n: number) => `${n} ${n === 1 ? 'foto' : 'fotos'}`;

  const viewerPhotos = viewer ? viewer.ids.map(id => byId.get(id)).filter((p): p is Photo => !!p && isLive(p)) : [];
  const openViewer = useCallback((photos: Photo[], index: number) => setViewer({ ids: photos.map(p => p.id), index }), []);
  const closeViewer = useCallback(() => setViewer(null), []);
  const setViewerIndex = useCallback((index: number) => setViewer(v => v && { ...v, index }), []);
  const editPhoto = useCallback((p: Photo) => setEditing(p.id), []);
  const editingPhoto = editing ? byId.get(editing) : undefined;
  const closeImport = useCallback(() => setImporting(null), []);

  if (!allPhotos) return null;

  const isGrid = view.kind === 'library' || view.kind === 'favorites' || view.kind === 'album' || view.kind === 'tag' || view.kind === 'trash';
  const album = view.kind === 'album' ? albums.find(a => a.id === view.id) : undefined;

  let content;
  if (!live.length && !trashed.length) {
    content = <Welcome onPickFiles={() => fileInput.current?.click()} onPickFolder={() => folderInput.current?.click()} />;
  } else if (view.kind === 'albums') {
    content = <AlbumsView albums={albums} photos={live} onOpen={id => setView({ kind: 'album', id })} />;
  } else if (view.kind === 'tags') {
    content = <TagsView photos={live} onOpen={tag => setView({ kind: 'tag', tag })} />;
  } else if (view.kind === 'cleanup') {
    content = <CleanupView photos={live} onOpenPhoto={openViewer} />;
  } else if (isGrid) {
    const header =
      view.kind === 'album' && album ? (
        <AlbumHeader album={album} count={scope.length} onDeleted={() => setView({ kind: 'albums' })} />
      ) : view.kind === 'tag' ? (
        <div className="px-4 pb-2 pt-5">
          <h1 className="text-2xl font-semibold">#{view.tag}</h1>
          <p className="text-sm text-stone-500">{plural(scope.length)}</p>
        </div>
      ) : view.kind === 'trash' ? (
        <div className="flex items-center justify-between gap-4 px-4 pb-2 pt-5">
          <div>
            <h1 className="text-2xl font-semibold">Lixeira</h1>
            <p className="text-sm text-stone-500">Fotos aqui são apagadas para sempre após {TRASH_DAYS} dias.</p>
          </div>
          {trashed.length > 0 && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm(`Apagar ${plural(trashed.length)} para sempre? Isso não pode ser desfeito.`)) return;
                await deletePhotosForever(trashed.map(p => p.id));
              }}
            >
              Esvaziar lixeira
            </Button>
          )}
        </div>
      ) : results ? (
        <p className="px-4 pb-2 pt-4 text-sm text-stone-500">
          {searching ? 'Buscando…' : `${plural(list.length)} para “${results.query}”`}
        </p>
      ) : null;

    const empty =
      view.kind === 'trash' ? (
        <Empty icon={<Trash2 size={48} />} title="A lixeira está vazia" />
      ) : results ? (
        <Empty icon={<SearchIcon size={48} />} title="Nada encontrado">
          <p className="max-w-sm text-sm">Tente descrever de outro jeito, por exemplo “pessoas sorrindo na praia” ou só “2024”.</p>
        </Empty>
      ) : view.kind === 'favorites' ? (
        <Empty icon={<Heart size={48} />} title="Nenhum favorito ainda">
          <p className="text-sm">Toque no coração de uma foto (ou aperte F no visualizador).</p>
        </Empty>
      ) : (
        <Empty icon={<SearchIcon size={48} />} title="Nenhuma foto aqui" />
      );

    content = (
      <div className="flex h-full flex-col">
        {header}
        <div className="min-h-0 flex-1">
          {list.length ? (
            <PhotoGrid
              photos={list}
              grouped={!results && view.kind !== 'trash'}
              tileSize={tileSize}
              selection={selection}
              onSelect={onSelect}
              onSelectMany={ids => setSelection(new Set([...selection, ...ids]))}
              onOpen={i => openViewer(list, i)}
            />
          ) : (
            empty
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar view={view} onView={setView} albums={albums} counts={{ library: live.length, favorites: live.filter(p => p.favorite).length, trash: trashed.length }} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          search={<SearchBox ref={searchRef} value={query} onChange={setQuery} busy={searching} hint={results?.hint} />}
          onImport={() => fileInput.current?.click()}
          dark={dark}
          onToggleDark={() => setDark(d => !d)}
          tileSize={tileSize}
          onTileSize={setTileSize}
        />
        <div className="min-h-0 flex-1">{content}</div>
      </main>

      <input ref={fileInput} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={e => runImport(Array.from(e.target.files ?? [])).finally(() => (e.target.value = ''))} />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        // @ts-expect-error webkitdirectory is supported by all major browsers but missing from React's types.
        webkitdirectory=""
        onChange={e => runImport(Array.from(e.target.files ?? [])).finally(() => (e.target.value = ''))}
      />

      <SelectionBar
        count={selection.size}
        inTrash={view.kind === 'trash'}
        inAlbum={view.kind === 'album'}
        allFavorite={selectedPhotos.length > 0 && selectedPhotos.every(p => p.favorite)}
        onClear={() => setSelection(new Set())}
        actions={{
          favorite: () => setFavorite(selectedIds, !selectedPhotos.every(p => p.favorite)),
          album: () => setDialog({ kind: 'album', ids: selectedIds }),
          tags: () => setDialog({ kind: 'tags', ids: selectedIds }),
          export: () => setDialog({ kind: 'export', ids: selectedIds }),
          trash: async () => {
            await moveToTrash(selectedIds);
            done(`${plural(selectedIds.length)} na lixeira`);
          },
          restore: async () => {
            await restoreFromTrash(selectedIds);
            done(`${plural(selectedIds.length)} restauradas`);
          },
          deleteForever: async () => {
            if (!confirm(`Apagar ${plural(selectedIds.length)} para sempre? Isso não pode ser desfeito.`)) return;
            await deletePhotosForever(selectedIds);
            done(`${plural(selectedIds.length)} apagadas`);
          },
          removeFromAlbum: async () => {
            if (view.kind !== 'album') return;
            await removeFromAlbum(view.id, selectedIds);
            done(`${plural(selectedIds.length)} tiradas do álbum`);
          },
        }}
      />

      {viewer && viewerPhotos.length > 0 && (
        <Viewer
          photos={viewerPhotos}
          index={Math.min(viewer.index, viewerPhotos.length - 1)}
          albums={albums}
          allTags={allTags}
          paused={!!editing || !!dialog}
          onIndex={setViewerIndex}
          onClose={closeViewer}
          onEdit={editPhoto}
          onAddToAlbum={ids => setDialog({ kind: 'album', ids })}
          onExport={ids => setDialog({ kind: 'export', ids })}
        />
      )}
      {editingPhoto && <Editor photo={editingPhoto} onClose={() => setEditing(null)} />}

      {dialog?.kind === 'album' && <AlbumPicker ids={dialog.ids} albums={albums} covers={byId} onClose={() => setDialog(null)} onDone={msg => { setDialog(null); done(msg); }} />}
      {dialog?.kind === 'tags' && <TagDialog photos={dialog.ids.map(id => byId.get(id)).filter((p): p is Photo => !!p)} allTags={allTags} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'export' && <ExportDialog photos={dialog.ids.map(id => byId.get(id)).filter((p): p is Photo => !!p)} onClose={() => setDialog(null)} />}

      {importing && <ImportToast progress={importing} onClose={closeImport} />}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {dragging && <DropOverlay />}
    </div>
  );
}
