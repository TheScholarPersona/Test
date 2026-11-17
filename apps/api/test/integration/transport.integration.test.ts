import type { INestApplication } from '@nestjs/common';
import { TransportUnitMovedEvent } from '@wms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

/**
 * Transporteinheiten über die REST-API.
 *
 * Stammdaten: Platztypen REGAL und BODEN, TU-Typen EURO (Leergewicht 25 kg,
 * Zuladung 1000 kg, nur auf REGAL, darauf bis zu 2 BOX stapelbar) und BOX (2 kg).
 */
describe('Transporteinheiten', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  const loc: Record<string, string> = {};

  const at = (name: string) => ({ id: loc[name]! });
  const rulesOf = (response: { body: { details?: { violations?: { rule: string }[] } } }) =>
    response.body.details?.violations?.map((v) => v.rule);

  async function location(name: string, typeCode: string, maxTransportUnits: number, maxWeight?: string) {
    const response = await api.post('/v1/locations', {
      locationId: `T${name}/0001/0001/0001/0000`,
      typeCode,
      groupName: 'LAGER',
      erpCode: name,
      maxTransportUnits,
      ...(maxWeight ? { maxWeight: { amount: maxWeight, unit: 'KG' } } : {}),
    });
    expect(response.status).toBe(201);
    loc[name] = response.body.id;
  }

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);

    for (const code of ['REGAL', 'BODEN']) {
      expect((await api.post('/v1/location-types', { code })).status).toBe(201);
    }
    expect((await api.post('/v1/location-groups', { name: 'LAGER' })).status).toBe(201);
    await location('R1', 'REGAL', 1, '1000');
    await location('R2', 'REGAL', 2, '600');
    await location('B1', 'BODEN', 5);
    await location('S1', 'REGAL', 1);
    await location('S2', 'REGAL', 1);
    await location('C1', 'REGAL', 1);
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  describe('TU-Typen und Regeln', () => {
    it('legt Typen mit Gewichten an', async () => {
      const euro = await api.post('/v1/transport-unit-types', {
        code: 'EURO',
        lengthMm: 1200,
        widthMm: 800,
        tareWeight: { amount: '25', unit: 'KG' },
        maxPayload: { amount: '1000', unit: 'KG' },
      });
      expect(euro.status).toBe(201);
      expect(euro.body).toMatchObject({ tareWeight: { amount: '25', unit: 'KG' }, placementRules: [], stackingRules: [] });
      expect((await api.post('/v1/transport-unit-types', { code: 'BOX', tareWeight: { amount: '2', unit: 'KG' } })).status).toBe(201);
      expect(await api.post('/v1/transport-unit-types', { code: 'EURO' })).toMatchObject({ status: 409, body: { code: 'TU_TYPE_EXISTS' } });
    });

    it('ersetzt Platzierungs- und Stapelregeln', async () => {
      const placement = await api.put('/v1/transport-unit-types/EURO/placement-rules', [{ locationTypeCode: 'REGAL', privilegeLevel: 10 }]);
      expect(placement.body.placementRules).toEqual([{ locationTypeCode: 'REGAL', privilegeLevel: 10 }]);
      const stacking = await api.put('/v1/transport-unit-types/EURO/stacking-rules', [{ allowedTypeCode: 'BOX', maxCount: 2 }]);
      expect(stacking.body.stackingRules).toEqual([{ allowedTypeCode: 'BOX', maxCount: 2 }]);

      expect(await api.put('/v1/transport-unit-types/EURO/placement-rules', [{ locationTypeCode: 'GIBTSNICHT' }])).toMatchObject({
        status: 404,
        body: { code: 'LOCATION_TYPE_NOT_FOUND' },
      });
      expect((await api.put('/v1/transport-unit-types/EURO/placement-rules', [{ locationTypeCode: 'REGAL' }, { locationTypeCode: 'REGAL' }])).status).toBe(400);
      expect((await api.get('/v1/transport-unit-types/EURO')).body.placementRules).toHaveLength(1);
    });
  });

  describe('TU-Typen lesen und ändern', () => {
    it('listet Typen mit Regeln und ändert Maße und Beschreibung', async () => {
      const list = (await api.get('/v1/transport-unit-types')).body;
      expect(list.items.find((t: { code: string }) => t.code === 'EURO')).toMatchObject({ placementRules: [{ locationTypeCode: 'REGAL' }] });
      const changed = await api.patch('/v1/transport-unit-types/BOX', { description: 'Kleinladungsträger', heightMm: 300 });
      expect(changed).toMatchObject({ status: 200, body: { code: 'BOX', description: 'Kleinladungsträger', heightMm: 300, tareWeight: { amount: '2', unit: 'KG' } } });
      await collector.waitFor((m) => m.topic === 'wms/transport-unit-type/updated' && (m.body['payload'] as { code?: string }).code === 'BOX');
      expect(await api.patch('/v1/transport-unit-types/GIBT-ES-NICHT', { description: 'x' })).toMatchObject({ status: 404 });
    });
  });

  describe('Anlegen und Platzierungsregeln', () => {
    let generated = '';

    it('erzeugt einen Barcode und rechnet mit dem Leergewicht', async () => {
      const created = await api.post('/v1/transport-units', { typeCode: 'EURO', location: { erpCode: 'R1' } });
      expect(created.status).toBe(201);
      generated = created.body.unit.barcode;
      expect(generated).toMatch(/^TU\d{10}$/);
      expect(created.body).toMatchObject({
        violations: [],
        unit: { typeCode: 'EURO', state: 'AVAILABLE', location: { erpCode: 'R1' }, weight: null, effectiveWeight: { amount: '25', unit: 'KG' } },
      });
      await collector.waitFor((m) => m.topic === 'wms/transport-unit/created' && (m.body['payload'] as { barcode: string }).barcode === generated);
    });

    it('lehnt einen vollen Platz ab und nennt die Regel', async () => {
      const full = await api.post('/v1/transport-units', { barcode: 'P-VOLL', typeCode: 'BOX', location: { erpCode: 'R1' } });
      expect(full.status).toBe(409);
      expect(full.body.code).toBe('PLACEMENT_REJECTED');
      expect(rulesOf(full)).toEqual(['LOCATION_FULL']);
    });

    it('verhindert doppelte Barcodes', async () => {
      expect(await api.post('/v1/transport-units', { barcode: generated, typeCode: 'BOX', location: { erpCode: 'B1' } })).toMatchObject({
        status: 409,
        body: { code: 'TU_EXISTS' },
      });
    });

    it('setzt Platzierungsregeln durch', async () => {
      const response = await api.post('/v1/transport-units', { barcode: 'P-BODEN', typeCode: 'EURO', location: { erpCode: 'B1' } });
      expect(rulesOf(response)).toEqual(['PLACEMENT_NOT_ALLOWED']);
    });

    it('prüft Platzgewicht und Zuladung', async () => {
      expect((await api.post('/v1/transport-units', { barcode: 'P2', typeCode: 'EURO', location: { erpCode: 'R2' }, weight: { amount: '500', unit: 'KG' } })).status).toBe(201);
      const heavy = await api.post('/v1/transport-units', { barcode: 'P3', typeCode: 'EURO', location: { erpCode: 'R2' }, weight: { amount: '100.5', unit: 'KG' } });
      expect(rulesOf(heavy)).toEqual(['WEIGHT_EXCEEDED']);
      expect(heavy.body.message).toContain('600.5');
      const overweight = await api.post('/v1/transport-units', { barcode: 'P4', typeCode: 'EURO', location: { erpCode: 'B1' }, weight: { amount: '1100', unit: 'KG' } });
      expect(overweight).toMatchObject({ status: 409, body: { code: 'TU_OVERWEIGHT' } });
    });
  });

  describe('Bewegen', () => {
    it('bewegt regelkonform und veröffentlicht Quelle und Ziel', async () => {
      const moved = await api.post('/v1/transport-units/P2/move', { to: at('R1') });
      expect(moved.status).toBe(409);
      expect(rulesOf(moved)).toEqual(['LOCATION_FULL']);

      const ok = await api.post('/v1/transport-units/P2/move', { to: { erpCode: 'S1' } });
      expect(ok).toMatchObject({ status: 200, body: { violations: [], unit: { location: { erpCode: 'S1' } } } });
      const message = await collector.waitFor((m) => m.topic === 'wms/transport-unit/moved' && (m.body['payload'] as { barcode: string }).barcode === 'P2');
      expect(TransportUnitMovedEvent.parse(message.body).payload).toMatchObject({
        from: { erpCode: 'R2' },
        location: { erpCode: 'S1' },
        mode: 'checked',
        violations: [],
      });
    });

    it('beachtet geerbte Sperren und bucht gemeldete Ist-Positionen trotzdem', async () => {
      await api.patch('/v1/location-groups/LAGER/locks', { inbound: true });
      const blocked = await api.post('/v1/transport-units/P2/move', { to: { erpCode: 'R2' } });
      expect(blocked.body.details.violations).toEqual([
        { rule: 'TARGET_INBOUND_BLOCKED', message: expect.stringContaining('LAGER') },
      ]);

      const physical = await api.post('/v1/transport-units/P2/move', { to: { erpCode: 'R2' }, mode: 'physical' });
      expect(physical).toMatchObject({ status: 200, body: { unit: { location: { erpCode: 'R2' } }, violations: [{ rule: 'TARGET_INBOUND_BLOCKED' }] } });
      const event = await collector.waitFor(
        (m) =>
          m.topic === 'wms/transport-unit/moved' &&
          (m.body['payload'] as { barcode: string; mode: string }).barcode === 'P2' &&
          (m.body['payload'] as { mode: string }).mode === 'physical',
      );
      expect((event.body['payload'] as { violations: { rule: string }[] }).violations.map((v) => v.rule)).toEqual(['TARGET_INBOUND_BLOCKED']);
      await api.patch('/v1/location-groups/LAGER/locks', { inbound: false });
    });

    it('behandelt Bewegen auf den aktuellen Platz als Leerlauf', async () => {
      const before = (await api.get('/v1/transport-units/P2')).body.version;
      const same = await api.post('/v1/transport-units/P2/move', { to: { erpCode: 'R2' } });
      expect(same.body.unit.version).toBe(before);
    });

    it('löscht das geplante Ziel, sobald es erreicht ist', async () => {
      expect((await api.patch('/v1/transport-units/P2', { target: { erpCode: 'S1' } })).body.target).toMatchObject({ erpCode: 'S1' });
      const arrived = await api.post('/v1/transport-units/P2/move', { to: { erpCode: 'S1' } });
      expect(arrived.body.unit.target).toBeNull();
    });
  });

  describe('Stapeln', () => {
    it('stapelt BOX auf EURO bis zur Höchstzahl', async () => {
      // P2 steht auf S1 (Höchstzahl 1). BOX-Einheiten werden dort physisch gemeldet und dann gestapelt.
      for (const barcode of ['K1', 'K2', 'K3']) {
        const created = await api.post('/v1/transport-units', { barcode, typeCode: 'BOX', location: { erpCode: 'S1' }, mode: 'physical' });
        expect(created.body.violations.map((v: { rule: string }) => v.rule)).toEqual(['LOCATION_FULL']);
      }
      expect((await api.post('/v1/transport-units/K1/stack', { onto: 'P2' })).body.parentBarcode).toBe('P2');
      expect((await api.post('/v1/transport-units/K2/stack', { onto: 'P2' })).status).toBe(200);
      const third = await api.post('/v1/transport-units/K3/stack', { onto: 'P2' });
      expect(third).toMatchObject({ status: 409, body: { code: 'STACKING_REJECTED' } });
      expect(rulesOf(third)).toEqual(['STACK_FULL']);
      expect((await api.get('/v1/transport-units?parent=P2')).body.items.map((u: { barcode: string }) => u.barcode)).toEqual(['K1', 'K2']);
    });

    it('verhindert unzulässige Stapel', async () => {
      expect(rulesOf(await api.post('/v1/transport-units/P2/stack', { onto: 'K3' }))).toEqual(['STACKING_NOT_ALLOWED']);
      expect(rulesOf(await api.post('/v1/transport-units/P2/stack', { onto: 'P2' }))).toEqual(['STACK_ONTO_SELF']);
      expect(await api.post('/v1/transport-units/K1/move', { to: { erpCode: 'B1' } })).toMatchObject({ status: 409, body: { code: 'TU_STACKED' } });
    });

    it('bewegt den ganzen Stapel und zählt das Gewicht des Stapels', async () => {
      expect((await api.delete('/v1/transport-units/K3')).status).toBe(204);
      const moved = await api.post('/v1/transport-units/P2/move', { to: { erpCode: 'S2' } });
      expect(moved.status).toBe(200);
      for (const barcode of ['K1', 'K2']) {
        expect((await api.get(`/v1/transport-units/${barcode}`)).body.location.erpCode).toBe('S2');
      }
      const event = await collector.waitFor(
        (m) =>
          m.topic === 'wms/transport-unit/moved' &&
          (m.body['payload'] as { from: { erpCode: string } }).from.erpCode === 'S1' &&
          (m.body['payload'] as { location: { erpCode: string } }).location.erpCode === 'S2',
      );
      expect((event.body['payload'] as { movedWith: string[] }).movedWith.sort()).toEqual(['K1', 'K2']);

      // R2: 600 kg, P2 (500) + K1/K2 (je 2) = 504; mit P-LEICHT (25 Leergewicht) auf R2 wären es 529 → erlaubt,
      // mit 97 kg Zusatzgewicht nicht mehr.
      expect((await api.post('/v1/transport-units', { barcode: 'P-LEICHT', typeCode: 'EURO', location: { erpCode: 'R2' }, weight: { amount: '97', unit: 'KG' } })).status).toBe(201);
      expect(rulesOf(await api.post('/v1/transport-units/P2/move', { to: { erpCode: 'R2' } }))).toEqual(['WEIGHT_EXCEEDED']);
      expect((await api.delete('/v1/transport-units/P-LEICHT')).status).toBe(204);
      expect((await api.post('/v1/transport-units/P2/move', { to: { erpCode: 'R2' } })).status).toBe(200);
    });

    it('nimmt vom Stapel nur, wenn auf dem Platz Raum ist', async () => {
      await api.post('/v1/transport-units/P2/move', { to: { erpCode: 'S2' } });
      const rejected = await api.post('/v1/transport-units/K1/unstack', {});
      expect(rulesOf(rejected)).toEqual(['LOCATION_FULL']);
      const physical = await api.post('/v1/transport-units/K1/unstack', { mode: 'physical' });
      expect(physical.body).toMatchObject({ unit: { parentBarcode: null }, violations: [{ rule: 'LOCATION_FULL' }] });
      expect(await api.post('/v1/transport-units/K1/unstack', {})).toMatchObject({ status: 409, body: { code: 'TU_NOT_STACKED' } });
      expect(await api.delete('/v1/transport-units/P2')).toMatchObject({ status: 409, body: { code: 'TU_HAS_CHILDREN' } });
    });
  });

  describe('Fehlermeldungen', () => {
    it('erfasst, listet und erledigt Fehlermeldungen an einer TU und behält die Historie', async () => {
      const reported = await api.post('/v1/transport-units/K1/errors', { code: 'KONTUR', message: 'Überstand links' });
      expect(reported).toMatchObject({ status: 201, body: { barcode: 'K1', code: 'KONTUR', message: 'Überstand links', reportedBy: 'service:tests', resolvedAt: null } });
      const event = await collector.waitFor((m) => m.topic === 'wms/transport-unit/error-reported');
      expect(event.body['payload']).toMatchObject({ barcode: 'K1', code: 'KONTUR', reportedBy: 'service:tests' });
      await api.post('/v1/transport-units/K1/errors', { code: 'GEWICHT' });

      expect((await api.get('/v1/transport-units/K1/errors')).body.items.map((e: { code: string }) => e.code)).toEqual(['GEWICHT', 'KONTUR']);
      const open = (await api.get('/v1/transport-unit-errors')).body;
      expect(open.items.map((e: { code: string }) => e.code)).toEqual(['KONTUR', 'GEWICHT']);

      const resolved = await api.post(`/v1/transport-units/K1/errors/${reported.body.id}/resolve`, { resolution: 'Ware nachgeschoben' });
      expect(resolved.body).toMatchObject({ resolvedAt: expect.any(String), resolvedBy: 'service:tests', resolution: 'Ware nachgeschoben' });
      await collector.waitFor((m) => m.topic === 'wms/transport-unit/error-resolved');
      expect(await api.post(`/v1/transport-units/K1/errors/${reported.body.id}/resolve`, {})).toMatchObject({ status: 409, body: { code: 'UNIT_ERROR_RESOLVED' } });
      expect((await api.get('/v1/transport-unit-errors')).body.items.map((e: { code: string }) => e.code)).toEqual(['GEWICHT']);
      expect((await api.get('/v1/transport-units/K1/errors?state=resolved')).body.items.map((e: { code: string }) => e.code)).toEqual(['KONTUR']);
      // Eine Meldung ändert den Zustand der TU nicht.
      expect((await api.get('/v1/transport-units/K1')).body.state).toBe('AVAILABLE');
    });

    it('meldet unbekannte TUs und Meldungen', async () => {
      expect(await api.post('/v1/transport-units/GIBT-ES-NICHT/errors', { code: 'X' })).toMatchObject({ status: 404 });
      expect(await api.post('/v1/transport-units/K1/errors/00000000-0000-4000-8000-000000000000/resolve', {})).toMatchObject({ status: 404, body: { code: 'UNIT_ERROR_NOT_FOUND' } });
      expect(await api.post('/v1/transport-units/K1/errors', { code: '' })).toMatchObject({ status: 400 });
    });
  });

  describe('Zustand und Löschschutz', () => {
    it('ändert den Zustand und veröffentlicht vorher/nachher', async () => {
      const changed = await api.post('/v1/transport-units/K1/state', { state: 'QUALITY_CHECK', reason: 'Sichtprüfung' });
      expect(changed.body.state).toBe('QUALITY_CHECK');
      const event = await collector.waitFor((m) => m.topic === 'wms/transport-unit/state-changed');
      expect(event.body['payload']).toMatchObject({ barcode: 'K1', before: 'AVAILABLE', state: 'QUALITY_CHECK', reason: 'Sichtprüfung' });
      expect((await api.post('/v1/transport-units/K1/state', { state: 'KAPUTT' })).status).toBe(400);
    });

    it('schützt Lagerplätze mit TUs und benutzte Typen vor dem Löschen', async () => {
      const response = await api.delete(`/v1/locations/${loc['S2']}`);
      expect(response).toMatchObject({ status: 409, body: { code: 'LOCATION_IN_USE' } });
      expect(response.body.details.objections[0]).toMatchObject({ check: 'transport-units', reason: expect.stringContaining('3 Transporteinheit') });
      expect(await api.delete('/v1/transport-unit-types/EURO')).toMatchObject({ status: 409, body: { code: 'TU_TYPE_IN_USE' } });
      expect(await api.delete('/v1/location-types/REGAL')).toMatchObject({ status: 409 });
    });

    it('findet TUs nach Platz, Typ und Zustand', async () => {
      const onS2 = await api.get(`/v1/transport-units?location=${loc['S2']}`);
      expect(onS2.body.items.map((u: { barcode: string }) => u.barcode)).toEqual(['K1', 'K2', 'P2']);
      expect((await api.get('/v1/transport-units?state=QUALITY_CHECK')).body.total).toBe(1);
      expect((await api.get('/v1/transport-units?type=BOX&locationId=TS2/0001/0001/0001/0000')).body.total).toBe(2);
    });
  });

  describe('Parallele Buchungen', () => {
    it('belegt einen Platz mit Höchstzahl 1 bei gleichzeitigen Anfragen genau einmal', async () => {
      const results = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((n) => api.post('/v1/transport-units', { barcode: `PAR-${n}`, typeCode: 'EURO', location: { erpCode: 'C1' } })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      for (const rejected of results.filter((r) => r.status !== 201)) {
        expect(rejected.status).toBe(409);
        expect(rulesOf(rejected)).toEqual(['LOCATION_FULL']);
      }
      expect((await api.get(`/v1/transport-units?location=${loc['C1']}`)).body.total).toBe(1);
    });
  });

  it('beschreibt die Endpunkte in OpenAPI', async () => {
    const paths = Object.keys(((await api.get('/openapi.json')).body as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/v1/transport-unit-types/{code}/placement-rules',
        '/v1/transport-unit-types/{code}/stacking-rules',
        '/v1/transport-units',
        '/v1/transport-units/{barcode}/move',
        '/v1/transport-units/{barcode}/stack',
        '/v1/transport-units/{barcode}/unstack',
      ]),
    );
  });
});
