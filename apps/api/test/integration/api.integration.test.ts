import { MikroORM } from '@mikro-orm/postgresql';
import type { INestApplication } from '@nestjs/common';
import { SystemPingEvent } from '@wms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.factory.js';
import { type AppConfig, loadConfig } from '../../src/config.js';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import type { EventPublisher } from '../../src/infrastructure/messaging/event-publisher.js';
import { MetricsService } from '../../src/infrastructure/metrics/metrics.service.js';
import { OutboxCleanupService } from '../../src/infrastructure/outbox/outbox-cleanup.service.js';
import { OutboxMessage } from '../../src/infrastructure/outbox/outbox-message.entity.js';
import { OutboxRelayService } from '../../src/infrastructure/outbox/outbox-relay.service.js';
import { OutboxService } from '../../src/infrastructure/outbox/outbox.service.js';
import { authHeaders, TEST_TOKEN } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

let env: TestEnvironment;

beforeAll(async () => {
  env = await startEnvironment();
});

afterAll(async () => {
  await env?.stop();
});

function configFor(overrides: Record<string, string>): AppConfig {
  return loadConfig({
    DATABASE_URL: env.databaseUrl,
    MQTT_URL: env.mqttUrl,
    OUTBOX_POLL_INTERVAL_MS: '100',
    AUTH_SERVICE_TOKENS: `tests:admin:${TEST_TOKEN}`,
    ...overrides,
  });
}

async function startApp(config: AppConfig): Promise<{ app: INestApplication; baseUrl: string }> {
  const app = await createApp(config, { logger: false });
  await app.listen(0, '127.0.0.1');
  return { app, baseUrl: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { ...authHeaders, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('Migrationen', () => {
  it('legen das Schema an und sind wiederholbar', async () => {
    const config = configFor({});
    expect(await runMigrations(databaseOptions(config))).toEqual(expect.arrayContaining(['Migration20261116000000_outbox']));
    expect(await runMigrations(databaseOptions(config))).toEqual([]);
  });
});

describe('API im Testprofil mit laufendem Relay', () => {
  let app: INestApplication;
  let baseUrl: string;
  let collector: MessageCollector;

  beforeAll(async () => {
    collector = await MessageCollector.connect(env.mqttUrl);
    ({ app, baseUrl } = await startApp(configFor({ APP_PROFILE: 'test' })));
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
  });

  it('meldet Datenbank und MQTT als erreichbar', async () => {
    // Der MQTT-Client verbindet sich im Hintergrund; kurz warten, bis er steht.
    await expect.poll(async () => (await (await fetch(`${baseUrl}/health`)).json()) as unknown, { timeout: 10_000 }).toEqual({
      status: 'ok',
      checks: { database: 'up', mqtt: 'up' },
    });
  });

  it('veröffentlicht ein Ping-Event über Outbox und MQTT', async () => {
    const response = await fetch(`${baseUrl}/test/events/ping`, json({ message: 'integration', correlationId: 'it-1' }));
    expect(response.status).toBe(201);
    const { eventId, topic } = (await response.json()) as { eventId: string; topic: string };
    expect(topic).toBe('wms/system/ping');

    const received = await collector.waitFor((m) => m.body['id'] === eventId);
    expect(received.topic).toBe('wms/system/ping');
    const event = SystemPingEvent.parse(received.body);
    expect(event).toMatchObject({ source: 'wms-api', correlationId: 'it-1', payload: { message: 'integration' } });

    const orm = app.get(MikroORM);
    await expect
      .poll(async () => (await orm.em.fork().findOneOrFail(OutboxMessage, eventId)).publishedAt, { timeout: 5000 })
      .toBeInstanceOf(Date);
  });

  it('liefert Metriken im Prometheus-Format nur mit Anmeldung', async () => {
    expect((await fetch(`${baseUrl}/metrics`)).status).toBe(401);
    await expect
      .poll(async () => (await (await fetch(`${baseUrl}/metrics`, { headers: authHeaders })).text()).includes('wms_outbox_published_total{type="system.ping"}'), { timeout: 5000 })
      .toBe(true);
    const response = await fetch(`${baseUrl}/metrics`, { headers: authHeaders });
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
    const text = await response.text();
    expect(text).toContain('wms_http_request_duration_seconds_count{method="POST",route="/test/events/ping",status="201"} 1');
    expect(text).toMatch(/^wms_outbox_pending \d+$/m);
    expect(text).toMatch(/^wms_outbox_oldest_pending_seconds [\d.]+$/m);
    expect(text).toContain('# TYPE wms_outbound_orders gauge');
    expect(text).toContain('wms_process_cpu_user_seconds_total');
  });

  it('lehnt ungültige Anfragen mit Feldangaben ab', async () => {
    const response = await fetch(`${baseUrl}/test/events/ping`, json({ message: '' }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { path: string }[] };
    expect(body.issues.map((issue) => issue.path)).toEqual(['message']);
  });

  it('beschreibt die Endpunkte als OpenAPI 3.1', async () => {
    const document = (await (await fetch(`${baseUrl}/openapi.json`)).json()) as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toEqual(expect.arrayContaining(['/health', '/test/events/ping']));
  });
});

describe('Outbox-Relay ohne laufenden Hintergrund-Durchlauf (Profil production)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let orm: MikroORM;
  let outbox: OutboxService;
  let config: AppConfig;

  beforeAll(async () => {
    config = configFor({ APP_PROFILE: 'production', OUTBOX_RELAY_ENABLED: 'false' });
    ({ app, baseUrl } = await startApp(config));
    orm = app.get(MikroORM);
    outbox = app.get(OutboxService);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function recordPings(count: number): Promise<string[]> {
    await orm.em.fork().nativeDelete(OutboxMessage, {});
    const ids: string[] = [];
    await orm.em.fork().transactional((tx) => {
      for (let i = 0; i < count; i++) {
        ids.push(outbox.record(tx, SystemPingEvent, { message: `nr-${i}` }).id);
      }
      return Promise.resolve();
    });
    return ids;
  }
  it('löscht veröffentlichte Einträge nach der Aufbewahrungsfrist, unveröffentlichte nie', async () => {
    const [oldPublished, oldPending, recentPublished] = await recordPings(3);
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
    const em = orm.em.fork();
    await em.nativeUpdate(OutboxMessage, { id: oldPublished! }, { publishedAt: hoursAgo(200), occurredAt: hoursAgo(200) });
    await em.nativeUpdate(OutboxMessage, { id: oldPending! }, { occurredAt: hoursAgo(200) });
    await em.nativeUpdate(OutboxMessage, { id: recentPublished! }, { publishedAt: hoursAgo(1) });
    const cleanup = new OutboxCleanupService(orm, config, new MetricsService(orm));
    expect(await cleanup.runOnce()).toBe(1);
    const left = (await orm.em.fork().find(OutboxMessage, {})).map((m) => m.id).sort();
    expect(left).toEqual([oldPending, recentPublished].sort());
    expect(await new OutboxCleanupService(orm, { ...config, outbox: { ...config.outbox, retentionHours: 0 } }, new MetricsService(orm)).runOnce()).toBe(0);
  });


  const load = (id: string) => orm.em.fork().findOneOrFail(OutboxMessage, id);

  it('bietet im Profil production keine Test-Endpunkte an', async () => {
    const response = await fetch(`${baseUrl}/test/events/ping`, json({ message: 'x' }));
    expect(response.status).toBe(404);
  });

  it('zählt Fehlversuche, wartet ab und veröffentlicht später', async () => {
    const [id] = await recordPings(1);
    const failing: EventPublisher = {
      isConnected: () => true,
      publish: () => Promise.reject(new Error('Broker weg')),
    };
    const relay = new OutboxRelayService(orm, failing, config, new MetricsService(orm));

    expect(await relay.runOnce()).toEqual({ published: 0, failed: 1, skipped: false });
    const afterFailure = await load(id!);
    expect(afterFailure).toMatchObject({ attempts: 1, lastError: 'Broker weg', publishedAt: null });
    expect(afterFailure.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Wartezeit noch nicht abgelaufen: kein neuer Versuch.
    expect(await relay.runOnce()).toEqual({ published: 0, failed: 0, skipped: false });

    await orm.em.fork().nativeUpdate(OutboxMessage, { id: id! }, { nextAttemptAt: new Date(Date.now() - 1000) });
    const sent: string[] = [];
    const working: EventPublisher = {
      isConnected: () => true,
      publish: (topic) => {
        sent.push(topic);
        return Promise.resolve();
      },
    };
    expect(await new OutboxRelayService(orm, working, config, new MetricsService(orm)).runOnce()).toEqual({ published: 1, failed: 0, skipped: false });
    expect(sent).toEqual(['wms/system/ping']);
    expect(await load(id!)).toMatchObject({ attempts: 1, lastError: null, publishedAt: expect.any(Date) });
  });

  it('überspringt den Durchlauf ohne Broker-Verbindung, ohne Versuche zu zählen', async () => {
    const [id] = await recordPings(1);
    const offline: EventPublisher = { isConnected: () => false, publish: () => Promise.resolve() };
    expect(await new OutboxRelayService(orm, offline, config, new MetricsService(orm)).runOnce()).toEqual({ published: 0, failed: 0, skipped: true });
    expect(await load(id!)).toMatchObject({ attempts: 0, publishedAt: null });
  });

  it('veröffentlicht jedes Event genau einmal, auch mit zwei parallelen Relays', async () => {
    const ids = await recordPings(20);
    const published: string[] = [];
    const slow: EventPublisher = {
      isConnected: () => true,
      publish: async (_topic, message) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        published.push(String(message['id']));
      },
    };
    const smallBatches = { ...config, outbox: { ...config.outbox, batchSize: 5 } };
    const relays = [new OutboxRelayService(orm, slow, smallBatches, new MetricsService(orm)), new OutboxRelayService(orm, slow, smallBatches, new MetricsService(orm))];

    const perRelay = [0, 0];
    while (published.length < ids.length) {
      const results = await Promise.all(relays.map((relay) => relay.runOnce()));
      results.forEach((result, index) => (perRelay[index]! += result.published));
      if (results.every((result) => result.published === 0)) {
        break;
      }
    }
    // Beide Relays haben gearbeitet, keines hat einen Eintrag des anderen erneut gesendet.
    expect(perRelay.every((count) => count > 0)).toBe(true);
    expect(published).toHaveLength(ids.length);
    expect(new Set(published)).toEqual(new Set(ids));
  });
});
