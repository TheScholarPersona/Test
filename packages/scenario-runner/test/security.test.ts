import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Absicherung des MQTT-Brokers in der laufenden Umgebung (`pnpm stack:up`):
 * nur TLS, keine anonymen Zugriffe, Rechte je Topic.
 * Die Zertifizierungsstelle wird aus dem Container geholt (oder aus MQTT_CA_FILE gelesen).
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));
try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  // keine .env – die Prüfung unten meldet fehlende Passwörter
}

const port = Number(process.env['WMS_MQTT_PORT'] ?? '8883');
const password = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} fehlt – pnpm env:init ausführen`);
  return value;
};

let ca: Buffer;
let tmp: string | undefined;

beforeAll(() => {
  if (process.env['MQTT_CA_FILE']) {
    ca = readFileSync(process.env['MQTT_CA_FILE']);
    return;
  }
  tmp = mkdtempSync(join(tmpdir(), 'wms-ca-'));
  execFileSync('docker', ['compose', 'cp', 'mosquitto:/mosquitto/certs/ca.crt', join(tmp, 'ca.crt')], { cwd: root, stdio: 'pipe' });
  ca = readFileSync(join(tmp, 'ca.crt'));
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** Verbindet einmal (ohne Wiederholung); liefert den Client oder die Fehlermeldung. */
function connect(url: string, options: IClientOptions): Promise<{ client?: MqttClient; error?: string }> {
  return new Promise((resolve) => {
    const client = mqtt.connect(url, { reconnectPeriod: 0, connectTimeout: 5000, protocolVersion: 4, ...options });
    const done = (result: { client?: MqttClient; error?: string }) => {
      clearTimeout(timer);
      if (!result.client) client.end(true);
      resolve(result);
    };
    const timer = setTimeout(() => done({ error: 'Zeitüberschreitung' }), 6000);
    client.once('connect', () => done({ client }));
    client.once('error', (error) => done({ error: error.message }));
    client.once('close', () => done({ error: 'Verbindung geschlossen' }));
  });
}

const tls = (extra: IClientOptions = {}): IClientOptions => ({ ca, servername: 'localhost', rejectUnauthorized: true, ...extra });
const url = `mqtts://localhost:${port}`;

describe('MQTT-Absicherung', () => {
  it('verbindet mit Benutzer, Passwort und gültigem Zertifikat', async () => {
    const r = await connect(url, tls({ username: 'health', password: password('WMS_MQTT_HEALTH_PASSWORD') }));
    expect(r.error).toBeUndefined();
    r.client!.end(true);
  });

  it('lehnt Verbindungen ohne TLS ab', async () => {
    const r = await connect(`mqtt://localhost:${port}`, { username: 'health', password: password('WMS_MQTT_HEALTH_PASSWORD') });
    expect(r.client).toBeUndefined();
  });

  it('lehnt anonyme Zugriffe und falsche Passwörter ab', async () => {
    const anonymous = await connect(url, tls());
    const wrong = await connect(url, tls({ username: 'wms-api', password: 'falsch-falsch-falsch' }));
    expect(anonymous.client).toBeUndefined();
    expect(wrong.client).toBeUndefined();
    expect(`${anonymous.error} ${wrong.error}`).toMatch(/Not authorized|Bad username or Password|Connection refused/i);
  });

  it('lehnt einen Server ab, dessen Zertifikat nicht von der eigenen Zertifizierungsstelle stammt', async () => {
    const r = await connect(url, { username: 'health', password: password('WMS_MQTT_HEALTH_PASSWORD'), rejectUnauthorized: true });
    expect(r.client).toBeUndefined();
    expect(r.error).toMatch(/certificate/i);
  });

  it('erlaubt Node-RED nicht, Ereignisse des WMS zu veröffentlichen (Rechte je Topic)', async () => {
    const topic = `wms/acl-test/${Date.now()}`;
    const api = (await connect(url, tls({ username: 'wms-api', password: password('WMS_MQTT_API_PASSWORD') }))).client!;
    const nodeRed = (await connect(url, tls({ username: 'node-red', password: password('WMS_MQTT_NODE_RED_PASSWORD') }))).client!;
    try {
      const received: string[] = [];
      api.on('message', (_t, payload) => received.push(payload.toString()));
      await api.subscribeAsync(`${topic}/#`, { qos: 1 });
      await nodeRed.publishAsync(`${topic}/x`, 'von node-red', { qos: 1 });
      await api.publishAsync(`${topic}/y`, 'von wms-api', { qos: 1 });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(received).toEqual(['von wms-api']);
    } finally {
      api.end(true);
      nodeRed.end(true);
    }
  });
});
