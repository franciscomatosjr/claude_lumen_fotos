import { createStore } from '../lib/store';

export interface Account {
  id: string;
  email: string;
  quotaBytes: number;
  usedBytes: number;
}

export type Session = { state: 'unknown' } | { state: 'signed-out' } | { state: 'signed-in'; account: Account };

export const session = createStore<Session>({ state: 'unknown' });

export const signedIn = () => session.get().state === 'signed-in';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Calls the Lumen API; the session travels in an httpOnly cookie. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (res.status === 401 && path !== '/auth/login') session.set({ state: 'signed-out' });
    throw new ApiError(body.error ?? `Erro ${res.status}`, res.status, body.code);
  }
  return res.json() as Promise<T>;
}
