import createClient from 'openapi-fetch';
import type { paths } from './schema';

/** Typisierter Client für die WMS-API (Typen aus src/api/openapi.json). */
export const api = createClient<paths>({ baseUrl: '' });

/** Fachlicher Fehler der API: `code` ist stabil (z. B. PLACEMENT_REJECTED), `message` verständlich. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Result<T> = { data?: T; error?: unknown; response: Response };

/** Antwort entpacken: Daten zurückgeben oder einen `ApiError` werfen. */
export async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await request;
  if (error !== undefined || !response.ok) {
    const e = (error ?? {}) as { code?: string; message?: string; details?: unknown; issues?: unknown };
    throw new ApiError(response.status, e.code ?? `HTTP_${response.status}`, e.message ?? response.statusText, e.details ?? e.issues);
  }
  return data as T;
}

/** Text für Fehlermeldungen in der Oberfläche. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (${error.code})`;
  return error instanceof Error ? error.message : String(error);
}
