import { Crop as CropIcon, FlipHorizontal, Loader2, Redo2, RotateCcw, RotateCw, SlidersHorizontal, Sparkles, Undo2, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from '../lib/db';
import {
  DEFAULT_EDITS,
  FILTERS,
  FULL_CROP,
  autoEnhance,
  ctx2d,
  makeCanvas,
  orientedSize,
  renderEdited,
  withDefaults,
  type Crop,
  type EditParams,
} from '../lib/edits';
import { loadOriginal, saveEdits } from '../lib/render';
import { CropOverlay, fitAspect } from './CropOverlay';
import { Button, IconButton, cx } from './ui';

type Tab = 'adjust' | 'filters' | 'crop';

const SLIDERS: { key: keyof EditParams; label: string; min?: number }[] = [
  { key: 'exposure', label: 'Exposição' },
  { key: 'contrast', label: 'Contraste' },
  { key: 'highlights', label: 'Realces' },
  { key: 'shadows', label: 'Sombras' },
  { key: 'saturation', label: 'Saturação' },
  { key: 'warmth', label: 'Temperatura' },
  { key: 'vignette', label: 'Vinheta', min: 0 },
];

const ASPECTS: { label: string; value?: number }[] = [
  { label: 'Livre' },
  { label: 'Original', value: -1 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
];

const PREVIEW_MAX = 1600;

export function Editor({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const [base, setBase] = useState<HTMLCanvasElement | OffscreenCanvas>();
  const [small, setSmall] = useState<HTMLCanvasElement | OffscreenCanvas>();
  const [history, setHistory] = useState<EditParams[]>(() => [withDefaults(photo.edits)]);
  const [cursor, setCursor] = useState(0);
  const [live, setLive] = useState<EditParams>(() => withDefaults(photo.edits));
  const [tab, setTab] = useState<Tab>('adjust');
  const [aspect, setAspect] = useState<number | undefined>();
  const [comparing, setComparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [pixels, setPixels] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Downscale the original once; every preview renders from this copy.
  useEffect(() => {
    let alive = true;
    loadOriginal(photo.id).then(bitmap => {
      if (!alive) return;
      const k = Math.min(1, PREVIEW_MAX / Math.max(bitmap.width, bitmap.height));
      const c = makeCanvas(Math.round(bitmap.width * k), Math.round(bitmap.height * k));
      ctx2d(c).drawImage(bitmap, 0, 0, c.width, c.height);
      const k2 = 180 / Math.max(bitmap.width, bitmap.height);
      const s = makeCanvas(Math.round(bitmap.width * k2), Math.round(bitmap.height * k2));
      ctx2d(s).drawImage(bitmap, 0, 0, s.width, s.height);
      bitmap.close();
      setBase(c);
      setSmall(s);
    });
    return () => {
      alive = false;
    };
  }, [photo.id]);

  const commit = useCallback(
    (next: EditParams) => {
      setLive(next);
      setHistory(h => [...h.slice(0, cursor + 1), next]);
      setCursor(c => c + 1);
    },
    [cursor],
  );

  const undo = () => {
    if (cursor === 0) return;
    setCursor(cursor - 1);
    setLive(history[cursor - 1]);
  };
  const redo = () => {
    if (cursor >= history.length - 1) return;
    setCursor(cursor + 1);
    setLive(history[cursor + 1]);
  };

  // While cropping, show the whole frame with the crop box on top of it.
  const shown = comparing ? DEFAULT_EDITS : tab === 'crop' ? { ...live, crop: FULL_CROP } : live;

  useEffect(() => {
    if (!base || !canvasRef.current) return;
    const id = requestAnimationFrame(() => {
      const out = renderEdited(base, base.width, base.height, shown, PREVIEW_MAX);
      const c = canvasRef.current!;
      c.width = out.width;
      c.height = out.height;
      c.getContext('2d')!.drawImage(out, 0, 0);
      setPixels(p => (p.w === out.width && p.h === out.height ? p : { w: out.width, h: out.height }));
    });
    return () => cancelAnimationFrame(id);
  }, [base, shown]);

  const filterPreviews = useMemo(() => {
    if (!small) return {};
    const out: Record<string, string> = {};
    for (const f of FILTERS) {
      const c = renderEdited(small, small.width, small.height, { ...live, crop: FULL_CROP, filter: f.id, filterAmount: 100, vignette: 0 }, 180);
      const view = document.createElement('canvas');
      view.width = c.width;
      view.height = c.height;
      view.getContext('2d')!.drawImage(c, 0, 0);
      out[f.id] = view.toDataURL('image/jpeg', 0.7);
    }
    return out;
    // Only the colour settings that change how filters look matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [small, live.rotate, live.flipH, live.exposure, live.contrast, live.saturation, live.warmth, live.black, live.white]);

  const enhance = () => {
    if (!base) return;
    const img = ctx2d(base).getImageData(0, 0, base.width, base.height);
    commit({ ...live, ...autoEnhance(img.data) });
  };

  const rotate = (dir: 1 | -1) => {
    const r = (((live.rotate + dir * 90) % 360) + 360) % 360;
    commit({ ...live, rotate: r as EditParams['rotate'], crop: FULL_CROP });
  };

  const frame = base ? orientedSize(base.width, base.height, live.rotate) : { w: 1, h: 1 };

  const chooseAspect = (value?: number) => {
    setAspect(value);
    if (value === undefined) return;
    const ratio = value === -1 ? frame.w / frame.h : value;
    commit({ ...live, crop: fitAspect(ratio, frame.w, frame.h) });
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveEdits(photo, live);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const ratioForOverlay = aspect === undefined ? undefined : aspect === -1 ? frame.w / frame.h : aspect;

  return (
    <div className="dark animate-fade-in fixed inset-0 z-50 flex flex-col bg-[#0b0c0f] text-stone-100">
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <div className="mx-auto flex items-center gap-1">
          <IconButton label="Desfazer (⌘Z)" onClick={undo} disabled={cursor === 0}>
            <Undo2 size={18} />
          </IconButton>
          <IconButton label="Refazer (⇧⌘Z)" onClick={redo} disabled={cursor >= history.length - 1}>
            <Redo2 size={18} />
          </IconButton>
          <button
            onPointerDown={() => setComparing(true)}
            onPointerUp={() => setComparing(false)}
            onPointerLeave={() => setComparing(false)}
            className="rounded-lg px-3 py-2 text-sm hover:bg-white/10"
            title="Segure para ver o original"
          >
            Segure: antes
          </button>
          <Button variant="ghost" onClick={() => commit(DEFAULT_EDITS)}>
            Voltar ao original
          </Button>
        </div>
        <Button variant="primary" onClick={save} disabled={saving || !base}>
          {saving && <Loader2 size={16} className="animate-spin" />} Salvar
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div ref={stageRef} className="relative m-6 flex min-w-0 flex-1 items-center justify-center">
          {!base && <Loader2 className="animate-spin text-stone-500" />}
          {/* Fit the preview to the stage, scaling small photos up; the crop box overlays this exact rect. */}
          <div className="relative overflow-hidden" style={fit(pixels, stage)}>
            <canvas ref={canvasRef} className={cx('block size-full', !base && 'hidden')} />
            {tab === 'crop' && base && !comparing && (
              <CropOverlay
                crop={live.crop}
                aspect={ratioForOverlay && ratioForOverlay * (frame.h / frame.w)}
                onChange={(c: Crop) => setLive({ ...live, crop: c })}
                onCommit={(c: Crop) => commit({ ...live, crop: c })}
              />
            )}
          </div>
        </div>

        <aside className="flex w-80 shrink-0 flex-col border-l border-white/10 bg-stone-900">
          <div className="p-4">
            <Button variant="primary" className="w-full" onClick={enhance} disabled={!base}>
              <Wand2 size={16} /> Melhorar automaticamente
            </Button>
            <p className="mt-1.5 flex items-center justify-center gap-1 text-xs text-stone-500">
              <Sparkles size={12} /> Roda no seu dispositivo
            </p>
          </div>
          <div role="tablist" className="mx-4 grid grid-cols-3 rounded-lg bg-white/5 p-1 text-sm">
            {(
              [
                ['adjust', 'Ajustes', SlidersHorizontal],
                ['filters', 'Filtros', Sparkles],
                ['crop', 'Cortar', CropIcon],
              ] as const
            ).map(([id, label, Icon]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cx('flex items-center justify-center gap-1.5 rounded-md py-1.5', tab === id ? 'bg-white/15 font-medium' : 'text-stone-400 hover:text-white')}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'adjust' &&
              SLIDERS.map(s => (
                <Slider
                  key={s.key}
                  label={s.label}
                  min={s.min ?? -100}
                  value={live[s.key] as number}
                  onChange={v => setLive({ ...live, [s.key]: v })}
                  onCommit={v => commit({ ...live, [s.key]: v })}
                />
              ))}

            {tab === 'filters' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {FILTERS.map(f => (
                    <button key={f.id} onClick={() => commit({ ...live, filter: f.id, filterAmount: live.filter === f.id ? live.filterAmount : 100 })} className="text-left text-sm">
                      <div className={cx('aspect-square overflow-hidden rounded-lg ring-2', live.filter === f.id ? 'ring-accent' : 'ring-transparent')}>
                        {filterPreviews[f.id] && <img src={filterPreviews[f.id]} alt="" className="size-full object-cover" />}
                      </div>
                      <span className={cx('mt-1 block', live.filter === f.id ? 'text-accent' : 'text-stone-300')}>{f.label}</span>
                    </button>
                  ))}
                </div>
                {live.filter !== 'none' && (
                  <div className="mt-4">
                    <Slider label="Intensidade" min={0} value={live.filterAmount} onChange={v => setLive({ ...live, filterAmount: v })} onCommit={v => commit({ ...live, filterAmount: v })} />
                  </div>
                )}
              </>
            )}

            {tab === 'crop' && (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-sm text-stone-400">Proporção</p>
                  <div className="grid grid-cols-3 gap-2">
                    {ASPECTS.map(a => (
                      <button key={a.label} onClick={() => chooseAspect(a.value)} className={cx('rounded-lg py-1.5 text-sm ring-1', aspect === a.value ? 'bg-accent/15 text-accent ring-accent' : 'ring-white/15 hover:bg-white/10')}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" onClick={() => rotate(-1)}>
                    <RotateCcw size={16} /> Girar
                  </Button>
                  <Button className="flex-1" onClick={() => rotate(1)}>
                    <RotateCw size={16} /> Girar
                  </Button>
                  <IconButton label="Espelhar" onClick={() => commit({ ...live, flipH: !live.flipH })} className="bg-white/10">
                    <FlipHorizontal size={16} />
                  </IconButton>
                </div>
                <Slider label="Endireitar" min={-45} max={45} unit="°" value={live.straighten} onChange={v => setLive({ ...live, straighten: v })} onCommit={v => commit({ ...live, straighten: v })} />
                <Button variant="ghost" className="w-full" onClick={() => commit({ ...live, crop: FULL_CROP, straighten: 0 })}>
                  Restaurar corte
                </Button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function fit(img: { w: number; h: number }, box: { w: number; h: number }) {
  if (!img.w || !box.w) return { width: 0, height: 0 };
  const k = Math.min(box.w / img.w, box.h / img.h);
  return { width: img.w * k, height: img.h * k };
}

function Slider({ label, value, min = -100, max = 100, unit = '', onChange, onCommit }: { label: string; value: number; min?: number; max?: number; unit?: string; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  return (
    <label className="mb-4 block text-sm">
      <span className="mb-1 flex justify-between">
        <span className="text-stone-300">{label}</span>
        <button type="button" onDoubleClick={() => onCommit(min < 0 ? 0 : min)} title="Clique duas vezes para zerar" className="tabular-nums text-stone-500">
          {value > 0 && min < 0 ? '+' : ''}
          {Math.round(value)}
          {unit}
        </button>
      </span>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        onPointerUp={e => onCommit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={e => onCommit(Number((e.target as HTMLInputElement).value))}
        onDoubleClick={() => onCommit(min < 0 ? 0 : min)}
      />
    </label>
  );
}
