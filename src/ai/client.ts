import type { WorkerRequest, WorkerResponse } from './protocol';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();
const progressListeners = new Set<(file: string, loaded: number, total: number) => void>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        progressListeners.forEach(l => l(msg.file, msg.loaded, msg.total));
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
  }
  return worker;
}

function call(req: DistributiveOmit<WorkerRequest, 'id'>) {
  const id = nextId++;
  return new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...req, id });
  });
}

export const onModelProgress = (l: (file: string, loaded: number, total: number) => void) => {
  progressListeners.add(l);
  return () => progressListeners.delete(l);
};

export async function warmup() {
  await call({ type: 'warmup' });
}

export async function embedImage(blob: Blob) {
  const r = await call({ type: 'embedImage', blob });
  if (r.type !== 'vectors') throw new Error('resposta inesperada');
  return r.vectors[0];
}

export async function embedTexts(texts: string[]) {
  const r = await call({ type: 'embedTexts', texts });
  if (r.type !== 'vectors') throw new Error('resposta inesperada');
  return r.vectors;
}

export async function embedQuery(text: string, translate: boolean) {
  const r = await call({ type: 'embedQuery', text, translate });
  if (r.type !== 'query') throw new Error('resposta inesperada');
  return r;
}
