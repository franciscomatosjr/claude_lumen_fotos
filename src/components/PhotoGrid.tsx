import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Heart, Sparkles } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from '../lib/db';
import { useThumbUrl } from '../lib/thumbs';
import { cx } from './ui';

type Row = { kind: 'header'; label: string; ids: string[] } | { kind: 'photos'; items: { photo: Photo; index: number }[] };

const GAP = 4;
const HEADER = 52;

const monthLabel = (t: number) => {
  const s = new Date(t).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export function buildRows(photos: Photo[], columns: number, grouped: boolean): Row[] {
  const rows: Row[] = [];
  const push = (items: { photo: Photo; index: number }[]) => {
    for (let i = 0; i < items.length; i += columns) rows.push({ kind: 'photos', items: items.slice(i, i + columns) });
  };
  if (!grouped) {
    push(photos.map((photo, index) => ({ photo, index })));
    return rows;
  }
  let current: { label: string; items: { photo: Photo; index: number }[] } | undefined;
  const flush = () => {
    if (!current) return;
    rows.push({ kind: 'header', label: current.label, ids: current.items.map(i => i.photo.id) });
    push(current.items);
  };
  photos.forEach((photo, index) => {
    const label = monthLabel(photo.takenAt);
    if (current?.label !== label) {
      flush();
      current = { label, items: [] };
    }
    current.items.push({ photo, index });
  });
  flush();
  return rows;
}

interface Props {
  photos: Photo[];
  grouped?: boolean;
  tileSize: number;
  selection: Set<string>;
  onSelect: (index: number, mode: 'toggle' | 'range') => void;
  onSelectMany: (ids: string[]) => void;
  onOpen: (index: number) => void;
}

export function PhotoGrid({ photos, grouped = true, tileSize, selection, onSelect, onSelectMany, onOpen }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inner = Math.max(0, width - 32);
  const columns = Math.max(2, Math.floor((inner + GAP) / (tileSize + GAP)));
  const tile = (inner - GAP * (columns - 1)) / columns;
  const rows = useMemo(() => buildRows(photos, columns, grouped), [photos, columns, grouped]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: i => (rows[i].kind === 'header' ? HEADER : tile + GAP),
    overscan: 6,
  });

  useEffect(() => virtualizer.measure(), [tile, rows, virtualizer]);

  const selecting = selection.size > 0;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-4 pb-24">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(v => {
          const row = rows[v.index];
          return (
            <div key={v.key} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)`, height: v.size }}>
              {row.kind === 'header' ? (
                <div className="group flex h-full items-end justify-between pb-3">
                  <h3 className="text-base font-semibold">{row.label}</h3>
                  <button
                    onClick={() => onSelectMany(row.ids)}
                    className={cx('text-sm text-stone-500 hover:text-stone-900 dark:hover:text-white', !selecting && 'opacity-0 group-hover:opacity-100 focus:opacity-100')}
                  >
                    Selecionar mês
                  </button>
                </div>
              ) : (
                <div className="flex" style={{ gap: GAP }}>
                  {row.items.map(({ photo, index }) => (
                    <Tile
                      key={photo.id}
                      photo={photo}
                      size={tile}
                      selected={selection.has(photo.id)}
                      selecting={selecting}
                      onClick={e => {
                        if (e.shiftKey && selecting) onSelect(index, 'range');
                        else if (selecting || e.metaKey || e.ctrlKey) onSelect(index, 'toggle');
                        else onOpen(index);
                      }}
                      onCheck={e => onSelect(index, e.shiftKey ? 'range' : 'toggle')}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Tile = memo(function Tile({
  photo,
  size,
  selected,
  selecting,
  onClick,
  onCheck,
}: {
  photo: Photo;
  size: number;
  selected: boolean;
  selecting: boolean;
  onClick: (e: React.MouseEvent) => void;
  onCheck: (e: React.MouseEvent) => void;
}) {
  const url = useThumbUrl(photo);
  return (
    <div className="group relative overflow-hidden rounded-md bg-stone-200 dark:bg-white/5" style={{ width: size, height: size }}>
      <button onClick={onClick} className="block size-full" aria-label={`Abrir ${photo.name}`}>
        {url && (
          <img
            src={url}
            alt=""
            draggable={false}
            className={cx('size-full object-cover transition-transform duration-200', selected ? 'scale-[0.88] rounded-md' : 'group-hover:scale-[1.02]')}
          />
        )}
      </button>
      <button
        onClick={onCheck}
        aria-label={selected ? 'Desmarcar' : 'Selecionar'}
        className={cx(
          'absolute left-2 top-2 flex size-6 items-center justify-center rounded-full border-2 transition-opacity',
          selected ? 'border-accent bg-accent text-stone-950' : 'border-white/90 bg-black/20 text-transparent',
          selected || selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
        )}
      >
        <Check size={14} strokeWidth={3} />
      </button>
      <div className="pointer-events-none absolute bottom-1.5 left-1.5 flex gap-1">
        {photo.favorite === 1 && <Heart size={16} className="fill-white text-white drop-shadow" />}
        {photo.suggestedTags.length > 0 && <Sparkles size={16} className="text-white opacity-0 drop-shadow group-hover:opacity-90" />}
      </div>
    </div>
  );
});
