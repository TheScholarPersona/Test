import type { INestApplication } from '@nestjs/common';
import { LocationGroupLockChangedEvent } from '@wms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { LocationRemovalPolicy } from '../../src/modules/layout/index.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

/**
 * Lagerstruktur über die REST-API, gegen echtes PostgreSQL und MQTT.
 *
 * Aufbau im Test:
 *   HOCHREGAL
 *   ├── GASSE-1  → Platz HR01/0001/0001/0001/0000 (A)
 *   └── GASSE-2  → Platz HR01/0002/0001/0001/0000 (B)
 */
describe('Lagerstruktur', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  const ids: Record<'A' | 'B', string> = { A: '', B: '' };

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  describe('Platztypen', () => {
    it('legt einen Typ an und lehnt Duplikate ab', async () => {
      const created = await api.post('/v1/location-types', { code: 'PALETTE', description: 'Euro-Palette', lengthMm: 1200, widthMm: 800 });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code: 'PALETTE', lengthMm: 1200, widthMm: 800, heightMm: null, version: 1 });

      const duplicate = await api.post('/v1/location-types', { code: 'PALETTE' });
      expect(duplicate).toMatchObject({ status: 409, body: { code: 'LOCATION_TYPE_EXISTS' } });
    });

    it('meldet Feldfehler mit Pfad', async () => {
      const response = await api.post('/v1/location-types', { code: 'klein', lengthMm: -5 });
      expect(response.status).toBe(400);
      expect(response.body.issues.map((i: { path: string }) => i.path)).toEqual(['code', 'lengthMm']);
    });

    it('listet alle Platztypen', async () => {
      const list = (await api.get('/v1/location-types')).body;
      expect(list.items.map((t: { code: string }) => t.code)).toContain('PALETTE');
      expect(list.items.find((t: { code: string }) => t.code === 'PALETTE')).toMatchObject({ lengthMm: 1200, widthMm: 800 });
    });

    it('lässt bei gleichzeitigem Anlegen genau eine Anfrage durch', async () => {
      const results = await Promise.all([1, 2, 3].map(() => api.post('/v1/location-types', { code: 'PARALLEL' })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      for (const rejected of results.filter((r) => r.status !== 201)) {
        expect(rejected.status).toBe(409);
        expect(['LOCATION_TYPE_EXISTS', 'DUPLICATE']).toContain(rejected.body.code);
      }
    });
  });

  describe('Gruppen und Plätze', () => {
    it('baut die Hierarchie auf', async () => {
      expect((await api.post('/v1/location-groups', { name: 'HOCHREGAL', groupType: 'BEREICH' })).status).toBe(201);
      const gasse1 = await api.post('/v1/location-groups', { name: 'GASSE-1', parentName: 'HOCHREGAL' });
      expect(gasse1.status).toBe(201);
      expect(gasse1.body).toMatchObject({
        name: 'GASSE-1',
        parentName: 'HOCHREGAL',
        locks: { inbound: { own: false, blocked: false, blockedBy: null } },
      });
      expect((await api.post('/v1/location-groups', { name: 'GASSE-2', parentName: 'HOCHREGAL' })).status).toBe(201);

      const orphan = await api.post('/v1/location-groups', { name: 'WAISE', parentName: 'GIBT-ES-NICHT' });
      expect(orphan).toMatchObject({ status: 404, body: { code: 'LOCATION_GROUP_NOT_FOUND' } });
    });

    it('ändert Beschreibung und Gruppentyp und meldet die Änderung', async () => {
      const changed = await api.patch('/v1/location-groups/GASSE-2', { description: 'Schmalgang', groupType: 'GASSE' });
      expect(changed).toMatchObject({ status: 200, body: { name: 'GASSE-2', description: 'Schmalgang', groupType: 'GASSE', parentName: 'HOCHREGAL' } });
      const event = await collector.waitFor((m) => m.topic === 'wms/location-group/updated' && (m.body['payload'] as { name?: string }).name === 'GASSE-2');
      expect(event.body['type']).toBe('location-group.updated');
      expect(await api.patch('/v1/location-groups/GIBT-ES-NICHT', { description: 'x' })).toMatchObject({ status: 404 });
    });

    it('legt Plätze an', async () => {
      const a = await api.post('/v1/locations', {
        locationId: 'HR01/0001/0001/0001/0000',
        typeCode: 'PALETTE',
        groupName: 'GASSE-1',
        erpCode: 'A-01',
        maxTransportUnits: 2,
        maxWeight: { amount: '1250.500', unit: 'KG' },
      });
      expect(a.status).toBe(201);
      expect(a.body).toMatchObject({
        locationId: 'HR01/0001/0001/0001/0000',
        erpCode: 'A-01',
        typeCode: 'PALETTE',
        groupName: 'GASSE-1',
        capacity: { maxTransportUnits: 2, maxWeight: { amount: '1250.5', unit: 'KG' } },
        locks: { allocation: { blocked: false } },
      });
      ids.A = a.body.id;

      const b = await api.post('/v1/locations', { locationId: 'HR01/0002/0001/0001/0000', typeCode: 'PALETTE', groupName: 'GASSE-2' });
      expect(b.status).toBe(201);
      ids.B = b.body.id;
    });

    it('verhindert doppelte Koordinaten und Codes und unbekannte Typen', async () => {
      const base = { typeCode: 'PALETTE', groupName: 'GASSE-1' };
      expect(await api.post('/v1/locations', { ...base, locationId: 'HR01/0001/0001/0001/0000' })).toMatchObject({
        status: 409,
        body: { code: 'LOCATION_EXISTS' },
      });
      expect(await api.post('/v1/locations', { ...base, locationId: 'HR01/0001/0002/0001/0000', erpCode: 'A-01' })).toMatchObject({
        status: 409,
        body: { code: 'ERP_CODE_IN_USE' },
      });
      expect(
        await api.post('/v1/locations', { ...base, locationId: 'HR01/0001/0002/0001/0000', typeCode: 'UNBEKANNT' }),
      ).toMatchObject({ status: 404, body: { code: 'LOCATION_TYPE_NOT_FOUND' } });
    });

    it('findet Plätze nach Koordinate, ERP-Code und Gruppe einschließlich Untergruppen', async () => {
      const byId = await api.get(`/v1/locations?locationId=${encodeURIComponent('HR01/0002/0001/0001/0000')}`);
      expect(byId.body).toMatchObject({ total: 1, items: [{ id: ids.B }] });
      expect((await api.get('/v1/locations?erpCode=A-01')).body.items[0].id).toBe(ids.A);
      expect((await api.get('/v1/locations?group=HOCHREGAL')).body.total).toBe(0);
      const subtree = await api.get('/v1/locations?group=HOCHREGAL&includeSubgroups=true');
      expect(subtree.body.items.map((l: { id: string }) => l.id)).toEqual([ids.A, ids.B]);
      expect(await api.get('/v1/locations?group=UNBEKANNT')).toMatchObject({ status: 404 });
    });
  });

  describe('Sperren', () => {
    it('vererbt die Sperre einer Gruppe auf Untergruppen und Plätze', async () => {
      const locked = await api.patch('/v1/location-groups/HOCHREGAL/locks', { inbound: true, reason: 'Inventur' });
      expect(locked.status).toBe(200);
      expect(locked.body.locks.inbound).toEqual({ own: true, blocked: true, blockedBy: { kind: 'location-group', name: 'HOCHREGAL' } });

      const gasse = await api.get('/v1/location-groups/GASSE-1');
      expect(gasse.body.locks.inbound).toEqual({ own: false, blocked: true, blockedBy: { kind: 'location-group', name: 'HOCHREGAL' } });

      const place = await api.get(`/v1/locations/${ids.A}`);
      expect(place.body.locks.inbound).toEqual({ own: false, blocked: true, blockedBy: { kind: 'location-group', name: 'HOCHREGAL' } });
      expect(place.body.locks.outbound.blocked).toBe(false);
    });

    it('veröffentlicht die Sperränderung mit Vorher/Nachher und Grund', async () => {
      const message = await collector.waitFor((m) => m.topic === 'wms/location-group/lock-changed' && m.body['payload'] !== undefined);
      const event = LocationGroupLockChangedEvent.parse(message.body);
      expect(event.payload).toMatchObject({
        name: 'HOCHREGAL',
        inboundBlocked: true,
        change: { inbound: { before: false, after: true }, reason: 'Inventur' },
      });
    });

    it('verbietet das Entsperren unterhalb einer sperrenden Gruppe', async () => {
      const group = await api.patch('/v1/location-groups/GASSE-1/locks', { inbound: false });
      expect(group).toMatchObject({
        status: 409,
        body: { code: 'LOCK_INHERITED', details: { direction: 'inbound', blockedBy: { name: 'HOCHREGAL' } } },
      });
      const place = await api.patch(`/v1/locations/${ids.A}/locks`, { inbound: false });
      expect(place).toMatchObject({ status: 409, body: { code: 'LOCK_INHERITED' } });
    });

    it('behält eigene Sperren, wenn die übergeordnete Sperre aufgehoben wird', async () => {
      expect((await api.patch('/v1/location-groups/GASSE-1/locks', { inbound: true })).status).toBe(200);
      expect((await api.patch('/v1/location-groups/HOCHREGAL/locks', { inbound: false })).status).toBe(200);

      const placeA = await api.get(`/v1/locations/${ids.A}`);
      expect(placeA.body.locks.inbound).toEqual({ own: false, blocked: true, blockedBy: { kind: 'location-group', name: 'GASSE-1' } });
      const placeB = await api.get(`/v1/locations/${ids.B}`);
      expect(placeB.body.locks.inbound.blocked).toBe(false);

      expect((await api.patch('/v1/location-groups/GASSE-1/locks', { inbound: false })).status).toBe(200);
      expect((await api.get(`/v1/locations/${ids.A}`)).body.locks.inbound.blocked).toBe(false);
    });

    it('sperrt einzelne Plätze für Auslagerung und Platzvergabe', async () => {
      const response = await api.patch(`/v1/locations/${ids.B}/locks`, { outbound: true, allocation: true });
      expect(response.body.locks).toMatchObject({
        outbound: { own: true, blocked: true, blockedBy: { kind: 'location', name: 'HR01/0002/0001/0001/0000' } },
        allocation: { blocked: true },
      });
      await collector.waitFor(
        (m) => m.topic === 'wms/location/lock-changed' && (m.body['payload'] as { id?: string } | undefined)?.id === ids.B,
      );
    });
  });

  describe('Änderungen', () => {
    it('hält Koordinate und Typ unveränderlich', async () => {
      expect(await api.patch(`/v1/locations/${ids.A}`, { locationId: 'HR01/0009/0001/0001/0000' })).toMatchObject({
        status: 409,
        body: { code: 'LOCATION_ID_IMMUTABLE' },
      });
      expect(await api.patch(`/v1/locations/${ids.A}`, { typeCode: 'PARALLEL' })).toMatchObject({
        status: 409,
        body: { code: 'LOCATION_TYPE_IMMUTABLE' },
      });
      expect(await api.patch(`/v1/locations/${ids.A}`, { typeCode: 'PALETTE', description: 'ok' })).toMatchObject({ status: 200 });
      expect((await api.patch(`/v1/locations/${ids.A}`, { farbe: 'rot' })).status).toBe(400);
    });

    it('verschiebt einen Platz in eine andere Gruppe; geerbte Sperren folgen der neuen Gruppe', async () => {
      await api.patch('/v1/location-groups/GASSE-2/locks', { inbound: true });
      const moved = await api.patch(`/v1/locations/${ids.A}`, { groupName: 'GASSE-2' });
      expect(moved.body).toMatchObject({
        groupName: 'GASSE-2',
        locks: { inbound: { blocked: true, blockedBy: { name: 'GASSE-2' } } },
      });
      await api.patch(`/v1/locations/${ids.A}`, { groupName: 'GASSE-1' });
      await api.patch('/v1/location-groups/GASSE-2/locks', { inbound: false });
    });

    it('zählt die Version bei jeder Änderung hoch', async () => {
      const before = (await api.get('/v1/location-types/PALETTE')).body.version as number;
      const updated = await api.patch('/v1/location-types/PALETTE', { heightMm: 1500 });
      expect(updated.body).toMatchObject({ heightMm: 1500, version: before + 1 });
    });
  });

  describe('Löschen', () => {
    it('verweigert das Löschen benutzter Typen und nicht leerer Gruppen', async () => {
      expect(await api.delete('/v1/location-types/PALETTE')).toMatchObject({ status: 409, body: { code: 'LOCATION_TYPE_IN_USE' } });
      expect(await api.delete('/v1/location-groups/HOCHREGAL')).toMatchObject({
        status: 409,
        body: { code: 'LOCATION_GROUP_NOT_EMPTY', details: { childGroups: 2, locations: 0 } },
      });
    });

    it('berücksichtigt Einwände anderer Module beim Löschen eines Platzes', async () => {
      const policy = app.get(LocationRemovalPolicy);
      policy.register('test-belegt', async (location) => (location.id === ids.A ? 'Testeinwand: Platz belegt' : null));
      expect(await api.delete(`/v1/locations/${ids.A}`)).toMatchObject({
        status: 409,
        body: { code: 'LOCATION_IN_USE', details: { objections: [{ check: 'test-belegt', reason: 'Testeinwand: Platz belegt' }] } },
      });
      policy.register('test-belegt', async () => null);
    });

    it('löscht Plätze, dann leere Gruppen und unbenutzte Typen', async () => {
      expect((await api.delete(`/v1/locations/${ids.A}`)).status).toBe(204);
      expect((await api.delete(`/v1/locations/${ids.B}`)).status).toBe(204);
      expect(await api.get(`/v1/locations/${ids.A}`)).toMatchObject({ status: 404, body: { code: 'LOCATION_NOT_FOUND' } });
      for (const name of ['GASSE-1', 'GASSE-2', 'HOCHREGAL']) {
        expect((await api.delete(`/v1/location-groups/${name}`)).status).toBe(204);
      }
      expect((await api.delete('/v1/location-types/PALETTE')).status).toBe(204);
      expect((await api.get('/v1/location-groups')).body.items).toEqual([]);
    });
  });

  it('beschreibt alle Endpunkte der Lagerstruktur in OpenAPI', async () => {
    const document = (await api.get('/openapi.json')).body as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/v1/location-types',
        '/v1/location-types/{code}',
        '/v1/location-groups',
        '/v1/location-groups/{name}',
        '/v1/location-groups/{name}/locks',
        '/v1/locations',
        '/v1/locations/{id}',
        '/v1/locations/{id}/locks',
      ]),
    );
  });
});
