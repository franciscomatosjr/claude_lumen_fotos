export async function sha256Hex(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return toHex(new Uint8Array(digest));
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

/**
 * Difference hash from a 9×8 grayscale image (72 values, row-major): each bit says whether a pixel is
 * brighter than its right neighbour. Similar pictures produce hashes a few bits apart.
 */
export function dhash(gray: ArrayLike<number>) {
  if (gray.length !== 72) throw new Error('dhash expects 9×8 = 72 grayscale values');
  const bytes = new Uint8Array(8);
  for (let y = 0; y < 8; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) {
      byte = (byte << 1) | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0);
    }
    bytes[y] = byte;
  }
  return toHex(bytes);
}

export function hamming(a: string, b: string) {
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}
