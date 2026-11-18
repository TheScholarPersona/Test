import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

const minimal = { DATABASE_URL: 'postgresql://wms:wms@localhost:5432/wms' };

describe('loadConfig', () => {
  it('setzt sinnvolle Standardwerte', () => {
    const config = loadConfig(minimal);
    expect(config).toMatchObject({
      profile: 'development',
      serviceName: 'wms-api',
      port: 3000,
      dbMigrateOnStart: false,
      mqttUrl: 'mqtt://localhost:1883',
      outbox: { relayEnabled: true, pollIntervalMs: 500, batchSize: 50, publishTimeoutMs: 5000, retentionHours: 168, cleanupIntervalMs: 3_600_000 },
    });
  });

  it('liest Zahlen und Wahrheitswerte aus Zeichenketten', () => {
    const config = loadConfig({
      ...minimal,
      APP_PROFILE: 'test',
      PORT: '8080',
      DB_MIGRATE_ON_START: 'true',
      OUTBOX_RELAY_ENABLED: 'false',
      OUTBOX_BATCH_SIZE: '10',
    });
    expect(config.profile).toBe('test');
    expect(config.port).toBe(8080);
    expect(config.dbMigrateOnStart).toBe(true);
    expect(config.outbox.relayEnabled).toBe(false);
    expect(config.outbox.batchSize).toBe(10);
  });

  it('verlangt eine PostgreSQL-URL', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/wms' })).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['APP_PROFILE', 'staging'],
    ['PORT', 'abc'],
    ['DB_MIGRATE_ON_START', 'ja'],
    ['MQTT_URL', 'http://localhost:1883'],
    ['OUTBOX_POLL_INTERVAL_MS', '10'],
  ])('lehnt ungültigen Wert für %s ab', (key, value) => {
    expect(() => loadConfig({ ...minimal, [key]: value })).toThrow(new RegExp(key));
  });
});
