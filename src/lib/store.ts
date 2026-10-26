import { useSyncExternalStore } from 'react';

/** A tiny observable value, readable from React with `useStore`. */
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach(l => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export type Store<T> = ReturnType<typeof createStore<T>>;

export const useStore = <T,>(store: Store<T>) => useSyncExternalStore(store.subscribe, store.get);
