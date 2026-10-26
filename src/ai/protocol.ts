export type WorkerRequest =
  | { id: number; type: 'warmup' }
  | { id: number; type: 'embedImage'; blob: Blob }
  | { id: number; type: 'embedTexts'; texts: string[] }
  | { id: number; type: 'embedQuery'; text: string; translate: boolean };

export type WorkerResponse =
  | { id: number; type: 'ok' }
  | { id: number; type: 'vectors'; vectors: Float32Array[] }
  | { id: number; type: 'query'; vector: Float32Array; english: string }
  | { id: number; type: 'error'; message: string }
  | { id?: undefined; type: 'progress'; file: string; loaded: number; total: number };
