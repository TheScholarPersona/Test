import type { INestApplication } from '@nestjs/common';
import { createApp } from '../../../src/app.factory.js';
import { type AppConfig, loadConfig } from '../../../src/config.js';
import type { TestEnvironment } from './environment.js';

/** Service-Token der Tests (Rolle admin); `httpClient` sendet es automatisch. */
export const TEST_TOKEN = 'test-token-0123456789abcdef0123456789abcdef';
export const authHeaders = { authorization: `Bearer ${TEST_TOKEN}` };

export function configFor(env: TestEnvironment, overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    DATABASE_URL: env.databaseUrl,
    MQTT_URL: env.mqttUrl,
    OUTBOX_POLL_INTERVAL_MS: '100',
    AUTH_SERVICE_TOKENS: `tests:admin:${TEST_TOKEN}`,
    AUTH_ADMIN_PASSWORD: 'admin-passwort-test',
    ...overrides,
  });
}

export async function startApp(config: AppConfig): Promise<{ app: INestApplication; baseUrl: string }> {
  const app = await createApp(config, { logger: process.env['TEST_LOG'] ? ['error', 'warn'] : false });
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

export interface JsonResponse<T = any> {
  status: number;
  body: T;
}

/**
 * Kleiner HTTP-Client für Tests. Standard: angemeldet mit dem Test-Service-Token (admin);
 * `headers` ersetzt die Anmeldung (z. B. Cookie oder anderes Token, `{}` = nicht angemeldet).
 */
export function httpClient(baseUrl: string, headers: Record<string, string> = authHeaders) {
  const call = async <T = any>(method: string, path: string, body?: unknown): Promise<JsonResponse<T>> => {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.headers = { ...headers, 'content-type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`${baseUrl}${path}`, init);
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
  };
  return {
    get: <T = any>(path: string) => call<T>('GET', path),
    post: <T = any>(path: string, body?: unknown) => call<T>('POST', path, body),
    patch: <T = any>(path: string, body?: unknown) => call<T>('PATCH', path, body),
    put: <T = any>(path: string, body?: unknown) => call<T>('PUT', path, body),
    delete: <T = any>(path: string) => call<T>('DELETE', path),
  };
}
