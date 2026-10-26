/// <reference lib="webworker" />
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  env,
  pipeline,
  type ProgressInfo,
} from '@huggingface/transformers';
import type { WorkerRequest, WorkerResponse } from './protocol';

// Models are downloaded once from the Hugging Face Hub and cached by the browser (Cache Storage).
env.allowLocalModels = false;

const CLIP = 'Xenova/clip-vit-base-patch32';
const TRANSLATOR = 'Xenova/opus-mt-ROMANCE-en';
const opts = { dtype: 'q8' as const, device: 'wasm' as const };

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

const onProgress = (p: ProgressInfo) => {
  if (p.status === 'progress' && 'file' in p && p.file.endsWith('.onnx')) {
    post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total });
  }
};

const once = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= fn().catch(err => {
    p = undefined;
    throw err;
  }));
};

const vision = once(async () => {
  const [processor, model] = await Promise.all([
    AutoProcessor.from_pretrained(CLIP),
    CLIPVisionModelWithProjection.from_pretrained(CLIP, { ...opts, progress_callback: onProgress }),
  ]);
  return { processor, model };
});

const text = once(async () => {
  const [tokenizer, model] = await Promise.all([
    AutoTokenizer.from_pretrained(CLIP),
    CLIPTextModelWithProjection.from_pretrained(CLIP, { ...opts, progress_callback: onProgress }),
  ]);
  return { tokenizer, model };
});

const translator = once(() => pipeline('translation', TRANSLATOR, { ...opts, progress_callback: onProgress }));

function normalize(v: Float32Array) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Splits a [batch, dim] tensor into normalized rows. */
function rows(data: Float32Array, batch: number) {
  const dim = data.length / batch;
  return Array.from({ length: batch }, (_, i) => normalize(data.subarray(i * dim, (i + 1) * dim)));
}

async function embedImage(blob: Blob) {
  const { processor, model } = await vision();
  const image = await RawImage.fromBlob(blob);
  const inputs = await processor(image);
  const { image_embeds } = await model(inputs);
  return rows(image_embeds.data as Float32Array, 1)[0];
}

async function embedTexts(texts: string[]) {
  const { tokenizer, model } = await text();
  const inputs = tokenizer(texts, { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  return rows(text_embeds.data as Float32Array, texts.length);
}

async function translate(input: string) {
  const t = await translator();
  const out = (await t(input)) as { translation_text: string }[];
  return out[0]?.translation_text?.trim() || input;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    switch (req.type) {
      case 'warmup':
        await Promise.all([vision(), text()]);
        post({ id: req.id, type: 'ok' });
        break;
      case 'embedImage': {
        const vector = await embedImage(req.blob);
        post({ id: req.id, type: 'vectors', vectors: [vector] }, [vector.buffer]);
        break;
      }
      case 'embedTexts': {
        const vectors = await embedTexts(req.texts);
        post({ id: req.id, type: 'vectors', vectors }, vectors.map(v => v.buffer));
        break;
      }
      case 'embedQuery': {
        const english = req.translate ? await translate(req.text) : req.text;
        const [vector] = await embedTexts([`a photo of ${english}`]);
        post({ id: req.id, type: 'query', vector, english }, [vector.buffer]);
        break;
      }
    }
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
