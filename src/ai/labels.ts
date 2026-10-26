/** Tags the on-device model can suggest: the Portuguese tag shown to the user, and the English prompt CLIP scores. */
export const LABELS: { tag: string; prompt: string }[] = [
  { tag: 'praia', prompt: 'a beach' },
  { tag: 'montanha', prompt: 'mountains' },
  { tag: 'cidade', prompt: 'a city' },
  { tag: 'natureza', prompt: 'nature' },
  { tag: 'flores', prompt: 'flowers' },
  { tag: 'pôr do sol', prompt: 'a sunset' },
  { tag: 'neve', prompt: 'snow' },
  { tag: 'lago', prompt: 'a lake' },
  { tag: 'floresta', prompt: 'a forest' },
  { tag: 'jardim', prompt: 'a garden' },
  { tag: 'paisagem', prompt: 'a landscape' },
  { tag: 'cachorro', prompt: 'a dog' },
  { tag: 'gato', prompt: 'a cat' },
  { tag: 'pássaro', prompt: 'a bird' },
  { tag: 'cavalo', prompt: 'a horse' },
  { tag: 'bebê', prompt: 'a baby' },
  { tag: 'crianças', prompt: 'children' },
  { tag: 'família', prompt: 'a family' },
  { tag: 'retrato', prompt: 'a portrait of a person' },
  { tag: 'selfie', prompt: 'a selfie' },
  { tag: 'amigos', prompt: 'a group of friends' },
  { tag: 'festa', prompt: 'a party' },
  { tag: 'aniversário', prompt: 'a birthday party with a cake' },
  { tag: 'casamento', prompt: 'a wedding' },
  { tag: 'natal', prompt: 'christmas' },
  { tag: 'comida', prompt: 'food on a plate' },
  { tag: 'bebidas', prompt: 'drinks' },
  { tag: 'carro', prompt: 'a car' },
  { tag: 'bicicleta', prompt: 'a bicycle' },
  { tag: 'avião', prompt: 'an airplane' },
  { tag: 'barco', prompt: 'a boat' },
  { tag: 'piscina', prompt: 'a swimming pool' },
  { tag: 'esporte', prompt: 'people playing sports' },
  { tag: 'futebol', prompt: 'a soccer game' },
  { tag: 'show', prompt: 'a concert' },
  { tag: 'noite', prompt: 'a night scene' },
  { tag: 'arquitetura', prompt: 'architecture' },
  { tag: 'igreja', prompt: 'a church' },
  { tag: 'rua', prompt: 'a street' },
  { tag: 'casa', prompt: 'the inside of a house' },
  { tag: 'escritório', prompt: 'an office' },
  { tag: 'documento', prompt: 'a document' },
  { tag: 'captura de tela', prompt: 'a screenshot' },
  { tag: 'foto antiga', prompt: 'an old vintage photograph' },
];

const LOGIT_SCALE = 100;

/**
 * Picks up to `max` tags for an image embedding. CLIP's similarities are turned into a softmax over the
 * whole vocabulary, so a tag is only suggested when it clearly stands out from the others.
 */
export function suggestTags(image: Float32Array, labelVectors: Float32Array[], max = 3, minProb = 0.12) {
  const logits = labelVectors.map(v => dot(image, v) * LOGIT_SCALE);
  const top = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - top));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps
    .map((e, i) => ({ tag: LABELS[i].tag, p: e / sum }))
    .filter(x => x.p >= minProb)
    .sort((a, b) => b.p - a.p)
    .slice(0, max)
    .map(x => x.tag);
}

/** Baseline similarity of an image to the whole vocabulary, used to normalise search scores. */
export function labelStats(image: Float32Array, labelVectors: Float32Array[]) {
  const sims = labelVectors.map(v => dot(image, v));
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
  const std = Math.sqrt(sims.reduce((a, b) => a + (b - mean) ** 2, 0) / sims.length) || 1;
  return { mean, std };
}

export function dot(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
