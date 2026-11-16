import type { INestApplication } from '@nestjs/common';
import { createApp } from '../../../src/app.factory.js';
import { type AppConfig, loadConfig } from '../../../src/config.js';
import type { TestEnvironment } from './environment.js';

export function configFor(env: TestEnvironment, overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    DATABASE_URL: env.databaseUrl,
    MQTT_URL: env.mqttUrl,
    OUTBOX_POLL_INTERVAL_MS: '100',
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

/** Kleiner HTTP-Client für Tests: liefert Status und geparsten Body. */
export function httpClient(baseUrl: string) {
  const call = async <T = any>(method: string, path: string, body?: unknown): Promise<JsonResponse<T>> => {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'content-type': 'application/json' };
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
