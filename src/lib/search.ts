import { dot } from '../ai/labels';
import type { Album, Embedding, Photo } from './db';

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export interface ParsedQuery {
  /** What is left to match by meaning, once dates are pulled out. */
  text: string;
  year?: number;
  /** 0-based */
  month?: number;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Pulls dates out of a query: "praia com o cachorro em julho de 2023" → text "praia com o cachorro", month 6, year 2023. */
export function parseQuery(q: string): ParsedQuery {
  let text = ` ${q.trim()} `;
  let year: number | undefined;
  let month: number | undefined;

  const y = text.match(/\s(?:(?:em|de|no ano de)\s+)?((?:19|20)\d{2})(?=\s)/i);
  if (y) {
    year = Number(y[1]);
    text = text.replace(y[0], ' ');
  }
  const folded = fold(text);
  for (let i = 0; i < MONTHS.length; i++) {
    const m = folded.match(new RegExp(`\\s(?:(?:em|de|no mes de)\\s+)?${fold(MONTHS[i])}(?:\\s+de)?(?=\\s)`));
    if (m && m.index !== undefined) {
      month = i;
      text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length);
      break;
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim(), year, month };
}

export function matchesDate(p: Photo, q: ParsedQuery) {
  if (q.year === undefined && q.month === undefined) return true;
  const d = new Date(p.takenAt);
  return (q.year === undefined || d.getFullYear() === q.year) && (q.month === undefined || d.getMonth() === q.month);
}

const STOPWORDS = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'com', 'um', 'uma', 'para', 'por', 'foto', 'fotos']);

/** Words of the query that can match a tag, album, file or camera name. */
export const keywords = (text: string) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !STOPWORDS.has(w));

function keywordScore(p: Photo, words: string[], albumNames: Map<string, string>) {
  if (!words.length) return 0;
  const hay = fold([p.name, p.camera ?? '', ...p.tags, ...p.albumIds.map(a => albumNames.get(a) ?? '')].join(' '));
  return words.filter(w => hay.includes(w)).length / words.length;
}

export interface SearchInput {
  photos: Photo[];
  albums: Album[];
  query: ParsedQuery;
  /** CLIP text vector for the query; absent when the model is not available. */
  vector?: Float32Array;
  embeddings: Map<string, Pick<Embedding, 'vector' | 'mean' | 'std'>>;
}

/** How many standard deviations above its own baseline a photo must score to count as a match. */
export const MIN_Z = 2.2;

/**
 * Ranks photos by meaning (CLIP similarity) plus exact keyword hits on tags, albums and names.
 * Similarity is measured against each photo's own baseline (z-score), because raw CLIP scores differ
 * by only a few hundredths between a match and a miss. Without a vector it degrades to keyword search.
 */
export function rankPhotos({ photos, albums, query, vector, embeddings }: SearchInput): Photo[] {
  const albumNames = new Map(albums.map(a => [a.id, a.name]));
  const words = keywords(query.text);
  const candidates = photos.filter(p => matchesDate(p, query));
  if (!words.length && !vector) return candidates;

  const scored = candidates.map(p => {
    const kw = keywordScore(p, words, albumNames);
    const e = vector ? embeddings.get(p.id) : undefined;
    const z = e && vector ? (dot(e.vector, vector) - e.mean) / e.std : 0;
    return { p, kw, z, score: z + kw * 2 };
  });

  if (!vector) return scored.filter(s => s.kw > 0).sort((a, b) => b.kw - a.kw).map(s => s.p);

  return scored
    .filter(s => s.kw > 0 || s.z >= MIN_Z)
    .sort((a, b) => b.score - a.score)
    .slice(0, 300)
    .map(s => s.p);
}
