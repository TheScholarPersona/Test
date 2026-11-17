import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { startEnvironment, type TestEnvironment } from './support/environment.js';

/** OpenAPI-Beschreibung für die Oberfläche (apps/web erzeugt daraus seine Typen). */
const OPENAPI_FILE = fileURLToPath(new URL('../../../web/src/api/openapi.json', import.meta.url));

/** Liest Server-Sent Events, bis `until` passt oder die Zeit abläuft. */
async function readEvents(url: string, until: (events: { event: string; data: any }[]) => boolean, start: () => Promise<unknown>, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events: { event: string; data: any }[] = [];
  const response = await fetch(url, { headers: { accept: 'text/event-stream' }, signal: controller.signal });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  await start();
  try {
    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (data) events.push({ event, data: JSON.parse(data) });
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
}

describe('Live-Ereignisse und Oberfläche', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let baseUrl: string;
  let api: ReturnType<typeof httpClient>;
  let webDir: string;

  beforeAll(async () => {
    env = await startEnvironment();
    webDir = mkdtempSync(join(tmpdir(), 'wms-web-'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>WMS</title><div id="root"></div>');
    writeFileSync(join(webDir, 'app.js'), 'console.log("wms")');
    const config = configFor(env, { APP_PROFILE: 'test', WEB_DIST_DIR: webDir });
    await runMigrations(databaseOptions(config));
    const started = await startApp(config);
    app = started.app;
    baseUrl = started.baseUrl;
    api = httpClient(baseUrl);
  });

  afterAll(async () => {
    await app?.close();
    await env?.stop();
    rmSync(webDir, { recursive: true, force: true });
  });

  it('liefert Ereignisse als Server-Sent Events, gefiltert nach Typ', async () => {
    const events = await readEvents(
      `${baseUrl}/v1/events/stream?types=system.*`,
      (list) => list.some((e) => e.event === 'wms' && e.data.payload?.message === 'live-1'),
      async () => {
        // Erst nach dem Abonnement am Broker auslösen.
        await new Promise((resolve) => setTimeout(resolve, 500));
        await api.post('/v1/location-groups', { name: 'LIVE-NICHT-GEFILTERT' });
        await api.post('/test/events/ping', { message: 'live-1', correlationId: 'live-1' });
      },
    );
    const wms = events.filter((e) => e.event === 'wms');
    expect(wms.map((e) => e.data.type)).toEqual(['system.ping']);
    expect(wms[0]!.data).toMatchObject({ id: expect.any(String), source: 'wms-api', payload: { message: 'live-1' } });
  });

  it('liefert die Oberfläche unter /ui/ aus, ohne die API zu verdecken', async () => {
    const root = await fetch(`${baseUrl}/`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('/ui/');
    const page = await fetch(`${baseUrl}/ui/bestand`, { headers: { accept: 'text/html' } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<div id="root">');
    expect((await fetch(`${baseUrl}/ui/app.js`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/ui/fehlt.js`)).status).toBe(404);
    expect((await api.get('/health')).status).toBe(200);
    expect((await api.get('/v1/location-groups')).status).toBe(200);
  });

  /**
   * Die Oberfläche erzeugt ihre Typen aus apps/web/src/api/openapi.json.
   * Weicht die API davon ab, schlägt der Test fehl; `UPDATE_OPENAPI=1` schreibt die Datei neu.
   */
  it('stimmt mit der OpenAPI-Beschreibung der Oberfläche überein', async () => {
    const spec = `${JSON.stringify((await api.get('/openapi.json')).body, null, 2)}\n`;
    if (process.env['UPDATE_OPENAPI']) writeFileSync(OPENAPI_FILE, spec);
    let committed = '';
    try {
      committed = readFileSync(OPENAPI_FILE, 'utf8');
    } catch {
      // fehlt noch
    }
    expect(committed === spec, 'apps/web/src/api/openapi.json ist veraltet – mit UPDATE_OPENAPI=1 pnpm test:integration neu schreiben').toBe(true);
  });
});
