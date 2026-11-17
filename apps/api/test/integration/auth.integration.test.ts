import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

const ANLAGE_TOKEN = 'anlage-token-0123456789abcdef0123456789';

/** Anmeldung, Sitzung per Cookie, Rollen, Service-Tokens, Akteur in Ereignissen. */
describe('Anmeldung und Rollen', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let baseUrl: string;
  let admin: ReturnType<typeof httpClient>;
  let collector: MessageCollector;

  /** Anmelden; liefert einen Client, der das Sitzungs-Cookie mitschickt. */
  const login = async (username: string, password: string) => {
    const response = await fetch(`${baseUrl}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const body = (await response.json()) as any;
    const cookie = response.headers.get('set-cookie') ?? '';
    return { status: response.status, body, cookie, client: httpClient(baseUrl, { cookie: cookie.split(';')[0]! }) };
  };

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test', AUTH_SERVICE_TOKENS: `tests:admin:test-token-0123456789abcdef0123456789abcdef;plc:anlage:${ANLAGE_TOKEN}` });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    baseUrl = started.baseUrl;
    admin = httpClient(baseUrl);
    await admin.post('/v1/users', { username: 'lena.lager', displayName: 'Lena', password: 'lager-passwort-1', roles: ['lager'] });
    await admin.post('/v1/users', { username: 'leo.lesen', password: 'lesen-passwort-1', roles: ['lesen'] });
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  it('lässt ohne Anmeldung nur Öffentliches zu', async () => {
    const anonymous = httpClient(baseUrl, {});
    expect((await anonymous.get('/health')).status).toBe(200);
    expect((await anonymous.get('/openapi.json')).status).toBe(200);
    expect(await anonymous.get('/v1/stock')).toMatchObject({ status: 401, body: { code: 'UNAUTHENTICATED' } });
    expect((await anonymous.post('/v1/location-groups', { name: 'X' })).status).toBe(401);
    expect((await fetch(`${baseUrl}/v1/events/stream`)).status).toBe(401);
    expect((await httpClient(baseUrl, { authorization: 'Bearer falsch' }).get('/v1/stock')).status).toBe(401);
  });

  it('legt admin aus der Konfiguration an und meldet per Cookie an', async () => {
    const r = await login('Admin', 'admin-passwort-test');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'user', username: 'admin', roles: ['admin'], expiresAt: expect.any(String) });
    expect(r.cookie).toMatch(/^wms_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/);
    expect((await r.client.get('/v1/auth/me')).body).toMatchObject({ username: 'admin', roles: ['admin'] });
    expect((await r.client.get('/v1/users')).body.map((u: { username: string }) => u.username)).toEqual(['admin', 'lena.lager', 'leo.lesen']);
  });

  it('meldet falsche Anmeldedaten einheitlich und bremst nach fünf Fehlversuchen', async () => {
    const wrong = await login('leo.lesen', 'falsch-falsch');
    const unknown = await login('niemand', 'falsch-falsch');
    expect(wrong).toMatchObject({ status: 401, body: { code: 'INVALID_CREDENTIALS' } });
    expect(unknown.body.message).toBe(wrong.body.message);
    for (let i = 0; i < 4; i++) await login('leo.lesen', 'falsch-falsch');
    expect(await login('leo.lesen', 'lesen-passwort-1')).toMatchObject({ status: 429, body: { code: 'LOGIN_LOCKED' } });
  });

  it('erlaubt je Rolle nur, was die Rechtetabelle vorsieht, und vermerkt den Akteur', async () => {
    await admin.post('/v1/location-types', { code: 'R' });
    await admin.post('/v1/location-groups', { name: 'G' });
    await admin.post('/v1/locations', { locationId: 'AA/0001/0001/0001/0000', erpCode: 'A', groupName: 'G', typeCode: 'R', maxTransportUnits: 5 });
    await admin.post('/v1/locations', { locationId: 'AA/0001/0002/0001/0000', erpCode: 'B', groupName: 'G', typeCode: 'R', maxTransportUnits: 5 });
    await admin.post('/v1/transport-unit-types', { code: 'EURO' });
    await admin.post('/v1/transport-units', { barcode: 'P1', typeCode: 'EURO', location: { erpCode: 'A' } });

    const lena = (await login('lena.lager', 'lager-passwort-1')).client;
    expect((await lena.get('/v1/transport-units/P1')).status).toBe(200);
    const moved = await lena.post('/v1/transport-units/P1/move', { to: { erpCode: 'B' } });
    expect(moved.status).toBe(200);
    const event = await collector.waitFor((m) => m.topic === 'wms/transport-unit/moved' && (m.body as { payload: { barcode: string } }).payload.barcode === 'P1');
    expect((event.body as { actor?: string }).actor).toBe('user:lena.lager');

    const forbidden = await lena.post('/v1/locations', { locationId: 'AA/0001/0003/0001/0000', groupName: 'G', typeCode: 'R' });
    expect(forbidden).toMatchObject({ status: 403, body: { code: 'FORBIDDEN', details: { required: ['admin'], roles: ['lager'] } } });
    expect((await lena.get('/v1/users')).status).toBe(403);

    const anlage = httpClient(baseUrl, { authorization: `Bearer ${ANLAGE_TOKEN}` });
    expect((await anlage.get('/v1/auth/me')).body).toMatchObject({ kind: 'service', username: 'plc', roles: ['anlage'] });
    expect((await anlage.post('/v1/transport-units/P1/move', { to: { erpCode: 'A' } })).status).toBe(403);
  });

  it('beendet Sitzungen beim Abmelden, beim Sperren und beim Rollenwechsel', async () => {
    const first = await login('lena.lager', 'lager-passwort-1');
    expect((await first.client.post('/v1/auth/logout')).status).toBe(204);
    expect((await first.client.get('/v1/auth/me')).status).toBe(401);

    const second = await login('lena.lager', 'lager-passwort-1');
    expect((await admin.patch('/v1/users/lena.lager', { roles: ['lager', 'leitstand'] })).body.roles).toEqual(['lager', 'leitstand']);
    expect((await second.client.get('/v1/auth/me')).status).toBe(401);

    const third = await login('lena.lager', 'lager-passwort-1');
    expect(third.body.roles).toEqual(['lager', 'leitstand']);
    await admin.patch('/v1/users/lena.lager', { active: false });
    expect((await third.client.get('/v1/auth/me')).status).toBe(401);
    expect((await login('lena.lager', 'lager-passwort-1')).status).toBe(401);
  });

  it('ändert das eigene Passwort und schützt vor Selbstaussperrung', async () => {
    const leo = await login('leo.lesen', 'lesen-passwort-1').catch(() => null);
    // leo ist aus dem Bremsen-Test noch gesperrt – stattdessen einen frischen Benutzer verwenden.
    expect(leo?.status).toBe(429);
    await admin.post('/v1/users', { username: 'max', password: 'max-passwort-12', roles: ['admin'] });
    const max = (await login('max', 'max-passwort-12')).client;
    expect(await max.post('/v1/auth/password', { currentPassword: 'falsch-123456', newPassword: 'neu-passwort-12' })).toMatchObject({ status: 401 });
    expect(await max.post('/v1/auth/password', { currentPassword: 'max-passwort-12', newPassword: 'kurz' })).toMatchObject({ status: 400, body: { code: 'PASSWORD_TOO_SHORT' } });
    expect((await max.post('/v1/auth/password', { currentPassword: 'max-passwort-12', newPassword: 'neu-passwort-12' })).status).toBe(204);
    expect((await max.get('/v1/auth/me')).status).toBe(200);
    expect((await login('max', 'neu-passwort-12')).status).toBe(200);
    expect(await max.patch('/v1/users/max', { active: false })).toMatchObject({ status: 400, body: { code: 'SELF_LOCKOUT' } });
    expect(await admin.post('/v1/users', { username: 'max', password: 'irgendwas-123', roles: ['lesen'] })).toMatchObject({ status: 409 });
    expect(await admin.post('/v1/users', { username: 'x', password: 'irgendwas-123', roles: ['chef'] })).toMatchObject({ status: 400 });
  });

  it('liefert die Rollen mit Beschreibung', async () => {
    const roles = (await admin.get('/v1/auth/roles')).body.items;
    expect(roles.map((r: { role: string }) => r.role)).toEqual(['admin', 'leitstand', 'lager', 'anlage', 'lesen']);
    expect(roles.every((r: { description: string }) => r.description.length > 0)).toBe(true);
    expect((await httpClient(baseUrl, {}).get('/v1/auth/roles')).status).toBe(401);
  });

  it('beschreibt Anmeldung und Rechte in OpenAPI', async () => {
    const doc = (await admin.get('/openapi.json')).body as { components: { securitySchemes: Record<string, unknown> }; paths: Record<string, Record<string, { security?: unknown[]; responses: Record<string, unknown> }>> };
    expect(Object.keys(doc.components.securitySchemes)).toEqual(['bearer', 'session']);
    expect(doc.paths['/v1/auth/login']!['post']!.security).toEqual([]);
    expect(Object.keys(doc.paths['/v1/stock']!['get']!.responses)).toEqual(expect.arrayContaining(['401', '403']));
  });
});
