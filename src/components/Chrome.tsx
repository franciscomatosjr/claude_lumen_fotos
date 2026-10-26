import { AlertCircle, Copy, Download, FolderOpen, FolderPlus, Heart, HeartOff, ImagePlus, Images, Loader2, Moon, RotateCcw, Search, ShieldCheck, Sparkles, Sun, Tag, Trash2, Upload, X } from 'lucide-react';
import { forwardRef, useEffect, type ReactNode } from 'react';
import { aiStatus, retryIndexer } from '../ai/indexer';
import type { Album } from '../lib/db';
import type { ImportProgress } from '../lib/import';
import { useStore } from '../lib/store';
import { session } from '../sync/api';
import { AccountCard } from './Account';
import { Button, IconButton, cx } from './ui';

export type View =
  | { kind: 'library' }
  | { kind: 'favorites' }
  | { kind: 'albums' }
  | { kind: 'album'; id: string }
  | { kind: 'tags' }
  | { kind: 'tag'; tag: string }
  | { kind: 'cleanup' }
  | { kind: 'trash' };

export function Sidebar({ view, onView, albums, counts }: { view: View; onView: (v: View) => void; albums: Album[]; counts: { library: number; favorites: number; trash: number } }) {
  const item = (v: View, icon: ReactNode, label: string, count?: number) => {
    const active = view.kind === v.kind && (v.kind !== 'album' || (view.kind === 'album' && view.id === v.id));
    return (
      <button
        key={v.kind === 'album' ? v.id : v.kind}
        onClick={() => onView(v)}
        className={cx(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
          active ? 'bg-accent/15 font-medium text-stone-950 dark:text-white' : 'text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-white/5',
        )}
      >
        <span className={cx(active && 'text-accent-strong dark:text-accent')}>{icon}</span>
        <span className="flex-1 truncate text-left">{label}</span>
        {count !== undefined && count > 0 && <span className="text-xs text-stone-400">{count}</span>}
      </button>
    );
  };
  return (
    <nav className="flex h-full w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-stone-200 p-3 dark:border-white/10" aria-label="Navegação">
      <div className="mb-4 flex items-center gap-2 px-2 pt-1">
        <img src="/icon.svg" alt="" className="size-7" />
        <span className="text-lg font-semibold tracking-tight">Lumen Fotos</span>
      </div>
      {item({ kind: 'library' }, <Images size={18} />, 'Biblioteca', counts.library)}
      {item({ kind: 'favorites' }, <Heart size={18} />, 'Favoritos', counts.favorites)}
      {item({ kind: 'albums' }, <FolderOpen size={18} />, 'Álbuns')}
      {item({ kind: 'tags' }, <Tag size={18} />, 'Tags')}
      {item({ kind: 'cleanup' }, <Copy size={18} />, 'Limpeza')}
      {item({ kind: 'trash' }, <Trash2 size={18} />, 'Lixeira', counts.trash)}
      {albums.length > 0 && <p className="mb-1 mt-5 px-3 text-xs font-medium uppercase tracking-wide text-stone-400">Álbuns</p>}
      {albums.slice(0, 12).map(a => item({ kind: 'album', id: a.id }, <FolderOpen size={16} />, a.name))}
      <div className="mt-auto flex flex-col gap-2 pt-4">
        <AccountCard />
        <AIStatusCard />
      </div>
    </nav>
  );
}

function AIStatusCard() {
  const s = useStore(aiStatus);
  const signedIn = useStore(session).state === 'signed-in';
  let body: ReactNode;
  if (s.phase === 'downloading')
    body = (
      <>
        <p className="flex items-center gap-1.5">
          <Loader2 size={14} className="animate-spin" /> Baixando a IA ({Math.round(s.download * 100)}%)
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded bg-stone-200 dark:bg-white/10">
          <div className="h-full bg-accent transition-all" style={{ width: `${s.download * 100}%` }} />
        </div>
        <p className="mt-1.5 text-stone-400">Só na primeira vez, cerca de 150 MB.</p>
      </>
    );
  else if (s.phase === 'indexing')
    body = (
      <p className="flex items-center gap-1.5">
        <Loader2 size={14} className="animate-spin" /> Analisando {s.pending} fotos…
      </p>
    );
  else if (s.phase === 'error')
    body = (
      <>
        <p className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
          <AlertCircle size={14} /> A IA não carregou
        </p>
        <button onClick={retryIndexer} className="mt-1 underline">
          Tentar de novo
        </button>
      </>
    );
  else if (s.phase === 'idle' && s.pending > 0)
    body = (
      <p className="flex items-center gap-1.5">
        <Loader2 size={14} className="animate-spin" /> Preparando a IA…
      </p>
    );
  else
    body = (
      <p className="flex items-center gap-1.5">
        <Sparkles size={14} className="text-accent" /> IA pronta
      </p>
    );
  return (
    <div className="rounded-xl bg-stone-100 p-3 text-xs text-stone-600 dark:bg-white/5 dark:text-stone-300">
      {body}
      <p className="mt-2 flex items-center gap-1.5 text-stone-400">
        <ShieldCheck size={13} /> {signedIn ? 'A IA analisa tudo neste dispositivo' : 'Suas fotos ficam neste dispositivo'}
      </p>
    </div>
  );
}

export const SearchBox = forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void; busy: boolean; hint?: string }>(function SearchBox({ value, onChange, busy, hint }, ref) {
  return (
    <div className="relative max-w-xl flex-1">
      <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            onChange('');
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Busque com suas palavras: “praia com o cachorro em 2023”"
        aria-label="Buscar fotos"
        className="w-full rounded-xl border border-transparent bg-stone-200/70 py-2.5 pl-10 pr-10 text-sm outline-none transition-colors placeholder:text-stone-500 focus:border-accent focus:bg-white dark:bg-white/10 dark:focus:bg-white/5"
      />
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2 text-stone-400">
        {busy && <Loader2 size={15} className="animate-spin" />}
        {value ? (
          <button aria-label="Limpar busca" onClick={() => onChange('')}>
            <X size={15} />
          </button>
        ) : (
          <kbd className="rounded border border-stone-300 px-1.5 text-[11px] dark:border-white/20">/</kbd>
        )}
      </div>
      {hint && <p className="absolute -bottom-5 left-3 text-[11px] text-stone-400">{hint}</p>}
    </div>
  );
});

export function TopBar({ search, onImport, dark, onToggleDark, tileSize, onTileSize }: { search: ReactNode; onImport: () => void; dark: boolean; onToggleDark: () => void; tileSize: number; onTileSize: (n: number) => void }) {
  return (
    <header className="flex items-center gap-3 border-b border-stone-200 px-4 py-3 dark:border-white/10">
      {search}
      <div className="ml-auto flex items-center gap-1">
        <input type="range" min={100} max={320} value={tileSize} onChange={e => onTileSize(Number(e.target.value))} aria-label="Tamanho das miniaturas" className="mr-2 hidden w-24 md:block" />
        <IconButton label={dark ? 'Tema claro' : 'Tema escuro'} onClick={onToggleDark}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
        <Button variant="primary" onClick={onImport}>
          <Upload size={16} /> Importar
        </Button>
      </div>
    </header>
  );
}

export function SelectionBar({ count, inTrash, inAlbum, allFavorite, onClear, actions }: {
  count: number;
  inTrash: boolean;
  inAlbum: boolean;
  allFavorite: boolean;
  onClear: () => void;
  actions: { favorite: () => void; album: () => void; tags: () => void; export: () => void; trash: () => void; restore: () => void; deleteForever: () => void; removeFromAlbum: () => void };
}) {
  if (!count) return null;
  return (
    <div role="toolbar" aria-label="Ações da seleção" className="animate-fade-in fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-2xl bg-stone-900 px-2 py-2 text-white shadow-2xl ring-1 ring-white/10">
      <IconButton label="Limpar seleção (Esc)" onClick={onClear} className="hover:bg-white/10">
        <X size={18} />
      </IconButton>
      <span className="mr-2 text-sm font-medium tabular-nums">{count} selecionadas</span>
      {inTrash ? (
        <>
          <Button variant="ghost" className="hover:bg-white/10" onClick={actions.restore}>
            <RotateCcw size={16} /> Restaurar
          </Button>
          <Button variant="danger" onClick={actions.deleteForever}>
            <Trash2 size={16} /> Apagar para sempre
          </Button>
        </>
      ) : (
        <>
          <IconButton label={allFavorite ? 'Remover dos favoritos' : 'Favoritar'} onClick={actions.favorite} className="hover:bg-white/10">
            {allFavorite ? <HeartOff size={18} /> : <Heart size={18} />}
          </IconButton>
          <Button variant="ghost" className="hover:bg-white/10" onClick={actions.album}>
            <FolderPlus size={16} /> Álbum
          </Button>
          <Button variant="ghost" className="hover:bg-white/10" onClick={actions.tags}>
            <Tag size={16} /> Tags
          </Button>
          <IconButton label="Exportar" onClick={actions.export} className="hover:bg-white/10">
            <Download size={18} />
          </IconButton>
          {inAlbum && (
            <Button variant="ghost" className="hover:bg-white/10" onClick={actions.removeFromAlbum}>
              Tirar do álbum
            </Button>
          )}
          <IconButton label="Mover para a lixeira" onClick={actions.trash} className="hover:bg-white/10">
            <Trash2 size={18} />
          </IconButton>
        </>
      )}
    </div>
  );
}

export function ImportToast({ progress, onClose }: { progress: ImportProgress; onClose: () => void }) {
  const finished = progress.done >= progress.total;
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [finished, onClose]);
  const pct = progress.total ? (progress.done / progress.total) * 100 : 100;
  const notes = [
    progress.duplicates && (progress.duplicates === 1 ? '1 duplicata ignorada' : `${progress.duplicates} duplicatas ignoradas`),
    progress.failed && `${progress.failed} com erro (formato não suportado por este navegador?)`,
    progress.unsupported && (progress.unsupported === 1 ? '1 arquivo não é foto' : `${progress.unsupported} arquivos não são fotos`),
  ].filter(Boolean);
  return (
    <div className="animate-fade-in fixed bottom-5 right-5 z-30 w-80 rounded-2xl bg-white p-4 shadow-2xl ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-white/10">
      <div className="flex items-start justify-between">
        <p className="flex items-center gap-2 text-sm font-medium">
          {finished ? <ImagePlus size={16} className="text-accent" /> : <Loader2 size={16} className="animate-spin" />}
          {finished ? (progress.added === 1 ? '1 foto importada' : `${progress.added} fotos importadas`) : `Importando ${progress.done} de ${progress.total}…`}
        </p>
        {finished && (
          <IconButton label="Fechar" onClick={onClose} className="-mr-2 -mt-2 size-7">
            <X size={14} />
          </IconButton>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded bg-stone-200 dark:bg-white/10">
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      {notes.length > 0 && <p className="mt-2 text-xs text-stone-500">{notes.join(' · ')}</p>}
      {finished && progress.added > 0 && <p className="mt-1 text-xs text-stone-500">A IA vai analisar as fotos em segundo plano.</p>}
    </div>
  );
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div role="status" className="animate-fade-in fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-stone-900 px-4 py-2.5 text-sm text-white shadow-xl">
      {message}
      <button onClick={onClose} aria-label="Fechar" className="opacity-60 hover:opacity-100">
        <X size={14} />
      </button>
    </div>
  );
}

export function Welcome({ onPickFiles, onPickFolder }: { onPickFiles: () => void; onPickFolder: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-6 flex size-20 items-center justify-center rounded-3xl bg-accent/15 text-accent">
        <ImagePlus size={40} />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Todas as suas fotos, organizadas sozinhas</h1>
      <p className="mt-3 max-w-lg text-stone-500">
        Arraste fotos ou pastas para cá. O Lumen remove duplicatas, organiza por data, sugere tags e deixa você achar qualquer foto descrevendo-a.
      </p>
      <div className="mt-8 flex gap-3">
        <Button variant="primary" className="px-5 py-2.5 text-base" onClick={onPickFiles}>
          <Upload size={18} /> Escolher fotos
        </Button>
        <Button className="px-5 py-2.5 text-base" onClick={onPickFolder}>
          <FolderOpen size={18} /> Escolher pasta
        </Button>
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-sm text-stone-400">
        <ShieldCheck size={15} /> Tudo fica no seu navegador. A IA roda no seu dispositivo.
      </p>
    </div>
  );
}

export function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent/10 backdrop-blur-[2px]">
      <div className="rounded-3xl border-4 border-dashed border-accent bg-white/90 px-16 py-12 text-center shadow-2xl dark:bg-stone-900/90">
        <Upload size={40} className="mx-auto text-accent" />
        <p className="mt-3 text-xl font-semibold">Solte para importar</p>
        <p className="text-sm text-stone-500">Fotos e pastas inteiras</p>
      </div>
    </div>
  );
}
