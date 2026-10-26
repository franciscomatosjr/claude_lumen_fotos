/**
 * Non-destructive edits: a photo stores only these parameters; the original bytes never change.
 * The same pipeline renders the editor preview, the thumbnail and the exported file.
 */

export type FilterId = 'none' | 'vivid' | 'mono' | 'sepia' | 'retro' | 'cool' | 'drama';

export interface Crop {
  /** Normalized (0..1) rectangle inside the oriented, straightened frame. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EditParams {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  /** Fine rotation in degrees, -45..45; the image is scaled up so no empty corners show. */
  straighten: number;
  crop: Crop;
  /** Levels, 0..255; set by "Melhorar". */
  black: number;
  white: number;
  /** All sliders below are -100..100. */
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  warmth: number;
  /** 0..100 */
  vignette: number;
  filter: FilterId;
  /** 0..100 */
  filterAmount: number;
}

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 };

export const DEFAULT_EDITS: EditParams = {
  rotate: 0,
  flipH: false,
  straighten: 0,
  crop: FULL_CROP,
  black: 0,
  white: 255,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  warmth: 0,
  vignette: 0,
  filter: 'none',
  filterAmount: 100,
};

export const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'none', label: 'Original' },
  { id: 'vivid', label: 'Vivo' },
  { id: 'drama', label: 'Drama' },
  { id: 'retro', label: 'Retrô' },
  { id: 'cool', label: 'Frio' },
  { id: 'mono', label: 'P&B' },
  { id: 'sepia', label: 'Sépia' },
];

export const withDefaults = (p?: Partial<EditParams>): EditParams => ({ ...DEFAULT_EDITS, ...p, crop: { ...FULL_CROP, ...p?.crop } });

export function isIdentity(p?: EditParams) {
  if (!p) return true;
  return JSON.stringify(withDefaults(p)) === JSON.stringify(DEFAULT_EDITS);
}

/** Size of the frame after 90° rotations (before crop). */
export function orientedSize(w: number, h: number, rotate: number) {
  return rotate % 180 === 0 ? { w, h } : { w: h, h: w };
}

/** Scale needed so an image rotated by `deg` still covers its own W×H frame. */
export function coverScale(W: number, H: number, deg: number) {
  const t = Math.abs((deg * Math.PI) / 180);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return Math.max((W * c + H * s) / W, (W * s + H * c) / H);
}

/** Output pixel size for the edited image, capped so its longest side is at most `maxSize`. */
export function outputSize(srcW: number, srcH: number, p: EditParams, maxSize = Infinity) {
  const { w: W, h: H } = orientedSize(srcW, srcH, p.rotate);
  const cw = Math.max(1, p.crop.w * W);
  const ch = Math.max(1, p.crop.h * H);
  const k = Math.min(1, maxSize / Math.max(cw, ch));
  return { width: Math.max(1, Math.round(cw * k)), height: Math.max(1, Math.round(ch * k)), scale: k, W, H };
}

type Canvas2D = OffscreenCanvas | HTMLCanvasElement;

export function makeCanvas(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

export function ctx2d(c: Canvas2D) {
  return c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

/** Draws `src` with geometry and colour edits applied into a new canvas. */
export function renderEdited(src: ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas, srcW: number, srcH: number, p: EditParams, maxSize = Infinity) {
  const { width, height, scale, W, H } = outputSize(srcW, srcH, p, maxSize);
  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas);
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-p.crop.x * W, -p.crop.y * H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate((p.straighten * Math.PI) / 180);
  const s = coverScale(W, H, p.straighten);
  ctx.scale(p.flipH ? -s : s, s);
  ctx.rotate((p.rotate * Math.PI) / 180);
  ctx.drawImage(src, -srcW / 2, -srcH / 2, srcW, srcH);
  ctx.restore();
  if (hasColorEdits(p)) {
    const img = ctx.getImageData(0, 0, width, height);
    applyColor(img.data, width, height, p);
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}

export function hasColorEdits(p: EditParams) {
  return (
    p.black !== 0 ||
    p.white !== 255 ||
    p.exposure !== 0 ||
    p.contrast !== 0 ||
    p.highlights !== 0 ||
    p.shadows !== 0 ||
    p.saturation !== 0 ||
    p.warmth !== 0 ||
    p.vignette !== 0 ||
    (p.filter !== 'none' && p.filterAmount > 0)
  );
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Applies colour adjustments in place to RGBA pixel data. */
export function applyColor(data: Uint8ClampedArray, width: number, height: number, p: EditParams) {
  const black = p.black / 255;
  const range = Math.max(1, p.white - p.black) / 255;
  const gain = Math.pow(2, p.exposure / 100);
  const contrast = 1 + p.contrast / 100;
  const sat = 1 + p.saturation / 100;
  const warm = (p.warmth / 100) * 0.08;
  const shadows = (p.shadows / 100) * 0.5;
  const highlights = (p.highlights / 100) * 0.5;
  const vig = p.vignette / 100;
  const fAmt = p.filter === 'none' ? 0 : p.filterAmount / 100;
  const cx = width / 2;
  const cy = height / 2;
  const maxD = Math.hypot(cx, cy);

  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;

    r = ((r - black) / range) * gain + warm;
    g = ((g - black) / range) * gain;
    b = ((b - black) / range) * gain - warm;

    let L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (shadows !== 0 || highlights !== 0) {
      const l = clamp01(L);
      // Shadows move the dark tones, highlights the bright ones; both leave pure black and white alone.
      const target = l + 4 * l * (1 - l) * (shadows * (1 - l) + highlights * l);
      const k = l > 0.001 ? target / l : 1;
      r *= k;
      g *= k;
      b *= k;
      L = target;
    }

    r = (r - 0.5) * contrast + 0.5;
    g = (g - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;

    L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = L + (r - L) * sat;
    g = L + (g - L) * sat;
    b = L + (b - L) * sat;

    if (fAmt > 0) {
      const [fr, fg, fb] = applyFilter(p.filter, clamp01(r), clamp01(g), clamp01(b));
      r += (fr - r) * fAmt;
      g += (fg - g) * fAmt;
      b += (fb - b) * fAmt;
    }

    if (vig > 0) {
      const x = px % width;
      const y = (px - x) / width;
      const d = Math.hypot(x - cx, y - cy) / maxD;
      const v = 1 - vig * 0.7 * smoothstep(0.45, 1, d);
      r *= v;
      g *= v;
      b *= v;
    }

    data[i] = clamp01(r) * 255;
    data[i + 1] = clamp01(g) * 255;
    data[i + 2] = clamp01(b) * 255;
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function applyFilter(f: FilterId, r: number, g: number, b: number): [number, number, number] {
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  switch (f) {
    case 'mono': {
      const m = (L - 0.5) * 1.1 + 0.5;
      return [m, m, m];
    }
    case 'sepia':
      return [L * 1.07 + 0.08, L * 0.95 + 0.04, L * 0.75];
    case 'vivid': {
      const s = 1.35;
      return [((L + (r - L) * s) - 0.5) * 1.08 + 0.5, ((L + (g - L) * s) - 0.5) * 1.08 + 0.5, ((L + (b - L) * s) - 0.5) * 1.08 + 0.5];
    }
    case 'drama': {
      const c = (v: number) => (v - 0.5) * 1.35 + 0.5;
      const s = 0.8;
      return [c(L + (r - L) * s), c(L + (g - L) * s), c(L + (b - L) * s)];
    }
    case 'retro':
      // Faded blacks, warm mids, softer saturation.
      return [0.1 + 0.85 * (L + (r - L) * 0.75) + 0.04, 0.08 + 0.85 * (L + (g - L) * 0.75), 0.12 + 0.75 * (L + (b - L) * 0.75)];
    case 'cool':
      return [r * 0.92, g * 0.99 + 0.01, b * 1.08 + 0.03];
    default:
      return [r, g, b];
  }
}

/**
 * "Melhorar" in one click: stretches levels, neutralises colour casts, lifts dark images and adds a
 * little punch. Returns only the colour parameters it sets.
 */
export function autoEnhance(data: Uint8ClampedArray): Partial<EditParams> {
  const hist = new Uint32Array(256);
  let lumSum = 0;
  let n = 0;
  // Colour cast is judged only on near-neutral pixels (greys, whites): green grass or blue sky
  // would otherwise be mistaken for a cast.
  let greyR = 0;
  let greyB = 0;
  let greys = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    hist[Math.round(lum)]++;
    lumSum += lum;
    n++;
    if (Math.max(r, g, b) - Math.min(r, g, b) < 28 && lum > 60 && lum < 245) {
      greyR += r;
      greyB += b;
      greys++;
    }
  }
  if (!n) return {};
  const pct = (q: number) => {
    const target = n * q;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  const mean = lumSum / n / 255;
  const cast = greys > n * 0.02 ? (greyB - greyR) / greys / 255 : 0;
  const round = (v: number) => Math.round(v);
  return {
    black: Math.min(pct(0.005), 30),
    white: Math.max(pct(0.995), 225),
    warmth: round(Math.max(-15, Math.min(15, cast * 150))),
    shadows: mean < 0.35 ? round((0.35 - mean) * 100) : 0,
    exposure: mean < 0.25 ? round((0.25 - mean) * 100) : 0,
    contrast: 6,
    saturation: 8,
  };
}
