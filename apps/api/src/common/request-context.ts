import { AsyncLocalStorage } from 'node:async_hooks';

/** Daten der laufenden Anfrage, ohne sie durch alle Aufrufe reichen zu müssen. */
export interface RequestContext {
  /** Angemeldeter Akteur, z. B. `user:anna` oder `service:node-red`. */
  actor?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  /** Führt `fn` mit einem neuen, leeren Kontext aus (je HTTP-Anfrage). */
  run<T>(fn: () => T): T {
    return storage.run({}, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  setActor(actor: string): void {
    const store = storage.getStore();
    if (store) store.actor = actor;
  },
};
