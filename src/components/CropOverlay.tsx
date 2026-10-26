import { useRef } from 'react';
import type { Crop } from '../lib/edits';

/** Largest centred crop with the given pixel aspect ratio inside a W×H frame, normalized. */
export function fitAspect(ratio: number, W: number, H: number): Crop {
  const frameRatio = W / H;
  if (ratio > frameRatio) {
    const h = frameRatio / ratio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = ratio / frameRatio;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';
const MIN = 0.05;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Draggable crop box over the preview. Coordinates are normalized to the element it covers.
 * `aspect` is the locked w/h ratio in normalized units, if any.
 */
export function CropOverlay({ crop, aspect, onChange, onCommit }: { crop: Crop; aspect?: number; onChange: (c: Crop) => void; onCommit: (c: Crop) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; start: Crop; x: number; y: number; last: Crop } | null>(null);

  const onDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { handle, start: crop, x: e.clientX, y: e.clientY, last: crop };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const box = ref.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.x) / box.width;
    const dy = (e.clientY - d.y) / box.height;
    const s = d.start;
    let next: Crop;
    if (d.handle === 'move') {
      next = { ...s, x: clamp(s.x + dx, 0, 1 - s.w), y: clamp(s.y + dy, 0, 1 - s.h) };
    } else {
      // The corner opposite the dragged one stays fixed.
      const right = s.x + s.w;
      const bottom = s.y + s.h;
      const west = d.handle.includes('w');
      const north = d.handle.includes('n');
      let x0 = west ? clamp(s.x + dx, 0, right - MIN) : s.x;
      let x1 = west ? right : clamp(right + dx, s.x + MIN, 1);
      let y0 = north ? clamp(s.y + dy, 0, bottom - MIN) : s.y;
      let y1 = north ? bottom : clamp(bottom + dy, s.y + MIN, 1);
      if (aspect) {
        let w = x1 - x0;
        let h = w / aspect;
        const maxH = north ? bottom : 1 - s.y;
        if (h > maxH) {
          h = maxH;
          w = h * aspect;
        }
        if (west) x0 = x1 - w;
        else x1 = x0 + w;
        if (north) y0 = y1 - h;
        else y1 = y0 + h;
      }
      next = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    d.last = next;
    onChange(next);
  };

  const onUp = () => {
    if (drag.current) onCommit(drag.current.last);
    drag.current = null;
  };

  const pct = (v: number) => `${v * 100}%`;
  const corner = 'absolute size-4 border-white';

  return (
    <div ref={ref} className="absolute inset-0 touch-none select-none" onPointerMove={onMove} onPointerUp={onUp}>
      {/* Dim everything outside the crop with one huge shadow. */}
      <div
        className="absolute cursor-move border border-white/90"
        style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h), boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }}
        onPointerDown={onDown('move')}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="border border-white/20" />
          ))}
        </div>
        <div className={`${corner} -left-1 -top-1 cursor-nwse-resize border-l-4 border-t-4`} onPointerDown={onDown('nw')} />
        <div className={`${corner} -right-1 -top-1 cursor-nesw-resize border-r-4 border-t-4`} onPointerDown={onDown('ne')} />
        <div className={`${corner} -bottom-1 -left-1 cursor-nesw-resize border-b-4 border-l-4`} onPointerDown={onDown('sw')} />
        <div className={`${corner} -bottom-1 -right-1 cursor-nwse-resize border-b-4 border-r-4`} onPointerDown={onDown('se')} />
      </div>
    </div>
  );
}
