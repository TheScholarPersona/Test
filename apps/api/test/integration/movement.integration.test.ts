import type { INestApplication } from '@nestjs/common';
import { MovementCompletedEvent } from '@wms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

/**
 * Lagerbewegungen.
 *
 *   LAGER  A1, A2 (je 1 TU)     LEER  L1 (5 TUs)     WE  WE (50 TUs, Ausgangsplatz)
 * Aktiver Regelsatz: Leergut (Bewegungstyp EMPTIES) → LEER, sonst Suchgruppe aus der Anfrage.
 */
describe('Lagerbewegungen', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  const loc: Record<string, string> = {};
  const mv: Record<string, string> = {};
  const coord = (name: string) => `M${name}/0001/0001/0001/0000`;

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);

    await api.post('/v1/location-types', { code: 'REGAL' });
    for (const name of ['LAGER', 'LEER', 'WE']) await api.post('/v1/location-groups', { name });
    for (const [name, groupName, max, sortOrder] of [
      ['A1', 'LAGER', 1, 1],
      ['A2', 'LAGER', 1, 2],
      ['L1', 'LEER', 5, 1],
      ['WE', 'WE', 50, 1],
    ] as const) {
      const r = await api.post('/v1/locations', { locationId: coord(name), erpCode: name, groupName, typeCode: 'REGAL', maxTransportUnits: max, sortOrder });
      expect(r.status).toBe(201);
      loc[name] = r.body.id;
    }
    await api.post('/v1/transport-unit-types', { code: 'EURO' });
    for (const barcode of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']) {
      expect((await api.post('/v1/transport-units', { barcode, typeCode: 'EURO', location: { erpCode: 'WE' } })).status).toBe(201);
    }
    const ruleSet = await api.post('/v1/strategy-rule-sets', {
      decisionPoint: 'putaway',
      rules: [
        { name: 'leergut', when: { field: 'request.movementType', op: 'eq', value: 'EMPTIES' }, strategy: 'first-free', params: { group: 'LEER' } },
        { name: 'anfrage', when: { always: true }, strategy: 'first-free', params: {} },
      ],
    });
    expect((await api.post(`/v1/strategy-rule-sets/${ruleSet.body.id}/activate`)).status).toBe(200);
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  describe('Anlegen', () => {
    it('legt eine Bewegung mit festem Ziel an und reserviert es', async () => {
      const created = await api.post('/v1/movements', { barcode: 'P1', type: 'RELOCATION', target: { location: { erpCode: 'A1' } }, initiator: 'test' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({
        number: expect.stringMatching(/^MV\d{8}$/),
        barcode: 'P1',
        state: 'OPEN',
        priority: 'NORMAL',
        source: { id: loc['WE'], locationId: coord('WE') },
        target: { id: loc['A1'], locationId: coord('A1') },
        decisionId: null,
        allowedActions: ['start', 'complete', 'cancel'],
      });
      mv['P1'] = created.body.number;
      expect((await api.get('/v1/transport-units/P1')).body.target).toMatchObject({ erpCode: 'A1' });
      await collector.waitFor((m) => m.topic === 'wms/movement/created' && (m.body['payload'] as { number: string }).number === mv['P1']);
    });

    it('erlaubt je TU nur eine offene Bewegung', async () => {
      expect(await api.post('/v1/movements', { barcode: 'P1', type: 'RELOCATION', target: { location: { erpCode: 'A2' } } })).toMatchObject({
        status: 409,
        body: { code: 'MOVEMENT_EXISTS', details: { number: mv['P1'] } },
      });
    });

    it('lehnt ein bereits reserviertes Ziel ab', async () => {
      const response = await api.post('/v1/movements', { barcode: 'P2', type: 'RELOCATION', target: { location: { erpCode: 'A1' } } });
      expect(response).toMatchObject({ status: 409, body: { code: 'PLACEMENT_REJECTED' } });
      expect(response.body.details.violations.map((v: { rule: string }) => v.rule)).toEqual(['LOCATION_FULL']);
    });

    it('bestimmt das Ziel aus einer Gruppe über die Einlagerstrategie', async () => {
      const created = await api.post('/v1/movements', { barcode: 'P2', type: 'INBOUND', target: { group: 'LAGER' } });
      expect(created.body).toMatchObject({ targetGroup: 'LAGER', target: { locationId: coord('A2') }, decisionId: expect.any(String) });
      mv['P2'] = created.body.number;
      const decision = await api.get(`/v1/strategy-decisions/${created.body.decisionId}`);
      expect(decision.body).toMatchObject({ rule: { name: 'anfrage' }, facts: { 'request.movementType': 'INBOUND' }, assigned: true });
    });

    it('nutzt den Bewegungstyp in Regelsätzen (Leergut in die Leergutzone)', async () => {
      const created = await api.post('/v1/movements', { barcode: 'P3', type: 'EMPTIES', target: { group: 'LAGER' } });
      expect(created.body.target.locationId).toBe(coord('L1'));
      mv['P3'] = created.body.number;
      expect((await api.get(`/v1/strategy-decisions/${created.body.decisionId}`)).body.rule.name).toBe('leergut');
    });

    it('legt nichts an, wenn kein Zielplatz frei ist', async () => {
      const response = await api.post('/v1/movements', { barcode: 'P4', type: 'INBOUND', target: { group: 'LAGER' } });
      expect(response).toMatchObject({ status: 409, body: { code: 'NO_TARGET_LOCATION', details: { summary: { eligible: 0 } } } });
      expect((await api.get('/v1/transport-units/P4')).body.target).toBeNull();
      expect((await api.get('/v1/movements?barcode=P4')).body.total).toBe(0);
      expect((await api.get('/v1/strategy-decisions?subject=P4')).body.total).toBe(0);
    });
  });

  describe('Zustandsautomat', () => {
    it('beginnt, gibt zurück und beginnt erneut', async () => {
      const started = await api.post(`/v1/movements/${mv['P1']}/start`, { assignedTo: 'staplerfahrer-1' });
      expect(started.body).toMatchObject({ state: 'IN_PROGRESS', assignedTo: 'staplerfahrer-1', startedAt: expect.any(String), allowedActions: ['release', 'complete', 'cancel'] });
      expect(await api.post(`/v1/movements/${mv['P1']}/start`, {})).toMatchObject({
        status: 409,
        body: { code: 'INVALID_STATE_TRANSITION', details: { state: 'IN_PROGRESS', action: 'start' } },
      });
      expect((await api.post(`/v1/movements/${mv['P1']}/release`)).body).toMatchObject({ state: 'OPEN', assignedTo: null, startedAt: null });
      expect((await api.post(`/v1/movements/${mv['P1']}/start`, {})).body.state).toBe('IN_PROGRESS');
    });

    it('schließt ab, bucht die TU und meldet Quelle und Ziel', async () => {
      const done = await api.post(`/v1/movements/${mv['P1']}/complete`, {});
      expect(done).toMatchObject({
        status: 200,
        body: { violations: [], movement: { state: 'DONE', completed: { location: { locationId: coord('A1') }, deviated: false }, allowedActions: [] } },
      });
      const unit = (await api.get('/v1/transport-units/P1')).body;
      expect(unit).toMatchObject({ location: { erpCode: 'A1' }, target: null });
      const event = await collector.waitFor((m) => m.topic === 'wms/movement/completed' && (m.body['payload'] as { number: string }).number === mv['P1']);
      expect(MovementCompletedEvent.parse(event.body).payload).toMatchObject({ from: { erpCode: 'WE' }, to: { erpCode: 'A1' }, deviated: false });
      expect(await api.post(`/v1/movements/${mv['P1']}/complete`, {})).toMatchObject({ status: 409, body: { code: 'INVALID_STATE_TRANSITION' } });
    });

    it('prüft beim Abschluss die Platzregeln und vermerkt Abweichungen vom Ziel', async () => {
      const blocked = await api.post(`/v1/movements/${mv['P2']}/complete`, { location: { erpCode: 'A1' } });
      expect(blocked).toMatchObject({ status: 409, body: { code: 'PLACEMENT_REJECTED' } });
      expect((await api.get(`/v1/movements/${mv['P2']}`)).body.state).toBe('OPEN');

      const deviated = await api.post(`/v1/movements/${mv['P2']}/complete`, { location: { erpCode: 'L1' } });
      expect(deviated.body.movement).toMatchObject({ state: 'DONE', target: { locationId: coord('A2') }, completed: { location: { locationId: coord('L1') }, deviated: true } });
      // Die Reservierung von A2 ist aufgehoben: A2 ist wieder frei.
      expect((await api.get('/v1/transport-units/P2')).body.target).toBeNull();
      expect((await api.post('/v1/putaway/simulations', { barcode: 'P4', group: 'LAGER' })).body.chosen.label).toBe(coord('A2'));
    });

    it('storniert und gibt die Reservierung frei', async () => {
      const cancelled = await api.post(`/v1/movements/${mv['P3']}/cancel`, { reason: 'Falsch angelegt' });
      expect(cancelled.body).toMatchObject({ state: 'CANCELLED', cancelled: { reason: 'Falsch angelegt' } });
      expect((await api.get('/v1/transport-units/P3')).body.target).toBeNull();
      const event = await collector.waitFor((m) => m.topic === 'wms/movement/cancelled' && (m.body['payload'] as { number: string }).number === mv['P3']);
      expect(event.body['payload']).toMatchObject({ reason: 'Falsch angelegt', releasedTarget: true });
      expect(await api.post(`/v1/movements/${mv['P3']}/cancel`, {})).toMatchObject({ status: 409 });
    });
  });

  describe('Löschschutz und Historie', () => {
    it('schützt TUs mit offener Bewegung und Plätze, die Ziel einer offenen Bewegung sind', async () => {
      const created = await api.post('/v1/movements', { barcode: 'P5', type: 'RELOCATION', target: { location: { erpCode: 'A2' } } });
      mv['P5'] = created.body.number;
      const unit = await api.delete('/v1/transport-units/P5');
      expect(unit).toMatchObject({ status: 409, body: { code: 'TU_IN_USE' } });
      expect(unit.body.details.objections[0]).toMatchObject({ check: 'open-movements', reason: `Offene Lagerbewegung ${mv['P5']}` });
      const location = await api.delete(`/v1/locations/${loc['A2']}`);
      expect(location).toMatchObject({ status: 409, body: { code: 'LOCATION_IN_USE' } });
      expect(location.body.details.objections.map((o: { check: string }) => o.check)).toEqual(['open-movements']);
    });

    it('behält die Historie, wenn TU und Platz später gelöscht werden', async () => {
      await api.post(`/v1/movements/${mv['P5']}/cancel`, {});
      expect((await api.delete('/v1/transport-units/P5')).status).toBe(204);
      expect((await api.delete(`/v1/locations/${loc['A2']}`)).status).toBe(204);
      const history = await api.get(`/v1/movements/${mv['P5']}`);
      expect(history.body).toMatchObject({ barcode: 'P5', state: 'CANCELLED', target: { id: null, locationId: coord('A2') } });
    });
  });

  describe('Arbeitsliste und Parallelität', () => {
    it('sortiert nach Priorität, dann nach Alter, und filtert nach Zustand und Typ', async () => {
      const low = await api.post('/v1/movements', { barcode: 'P6', type: 'MANUAL', target: { location: { erpCode: 'L1' } }, priority: 'LOW' });
      const highest = await api.post('/v1/movements', { barcode: 'P7', type: 'MANUAL', target: { location: { erpCode: 'L1' } }, priority: 'HIGHEST' });
      const list = await api.get('/v1/movements?state=OPEN&type=MANUAL');
      expect(list.body.items.map((m: { number: string }) => m.number)).toEqual([highest.body.number, low.body.number]);
      expect((await api.get('/v1/movements?state=DONE')).body.total).toBe(2);
      expect((await api.get('/v1/movements?state=FERTIG')).status).toBe(400);
    });

    it('legt für eine TU auch bei gleichzeitigen Anfragen nur eine offene Bewegung an', async () => {
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => api.post('/v1/movements', { barcode: 'P8', type: 'MANUAL', target: { location: { erpCode: 'L1' } } })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      for (const rejected of results.filter((r) => r.status !== 201)) {
        expect(rejected.status).toBe(409);
        expect(['MOVEMENT_EXISTS', 'DUPLICATE']).toContain(rejected.body.code);
      }
    });
  });

  describe('Bewegungsgruppen', () => {
    let group: string;
    const groupMv: string[] = [];

    beforeAll(async () => {
      expect((await api.post('/v1/locations', { locationId: coord('GZ'), erpCode: 'GZ', groupName: 'LEER', typeCode: 'REGAL', maxTransportUnits: 20 })).status).toBe(201);
      for (const barcode of ['G1', 'G2', 'G3']) {
        expect((await api.post('/v1/transport-units', { barcode, typeCode: 'EURO', location: { erpCode: 'WE' } })).status).toBe(201);
        const m = await api.post('/v1/movements', { barcode, type: 'RELOCATION', target: { location: { erpCode: 'GZ' } } });
        expect(m.status).toBe(201);
        groupMv.push(m.body.number);
      }
    });

    it('bündelt offene Bewegungen zu einer Gruppe und lehnt Doppelzuordnung ab', async () => {
      const r = await api.post('/v1/movement-groups', { description: 'Tour 1', movements: groupMv.slice(0, 2), assignedTo: 'stapler-7' });
      expect(r).toMatchObject({ status: 201, body: { number: expect.stringMatching(/^MG\d{8}$/), state: 'OPEN', assignedTo: 'stapler-7', counts: { open: 2 } } });
      group = r.body.number;
      expect(r.body.movements.map((m: { number: string; groupNumber: string }) => [m.number, m.groupNumber])).toEqual(groupMv.slice(0, 2).map((n) => [n, group]));
      const created = await collector.waitFor((m) => m.topic === 'wms/movement-group/created');
      expect(created.body['payload']).toMatchObject({ number: group, movements: groupMv.slice(0, 2) });

      expect(await api.post('/v1/movement-groups', { movements: [groupMv[0]] })).toMatchObject({ status: 409, body: { code: 'MOVEMENT_GROUPED' } });
      expect(await api.post('/v1/movement-groups', { movements: ['MV99999999'] })).toMatchObject({ status: 404 });
      // Erledigte Bewegung (P1 ist DONE) lässt sich nicht bündeln
      expect(await api.post('/v1/movement-groups', { movements: [mv['P1']] })).toMatchObject({ status: 409, body: { code: 'MOVEMENT_CLOSED' } });
      expect((await api.get(`/v1/movements?group=${group}`)).body.total).toBe(2);
    });

    it('nimmt Bewegungen auf und entfernt sie wieder', async () => {
      const added = await api.patch(`/v1/movement-groups/${group}`, { add: [groupMv[2]] });
      expect(added.body.counts.open).toBe(3);
      const removed = await api.patch(`/v1/movement-groups/${group}`, { remove: [groupMv[2]] });
      expect(removed.body.movements.map((m: { number: string }) => m.number)).toEqual(groupMv.slice(0, 2));
      expect((await api.get(`/v1/movements/${groupMv[2]}`)).body.groupNumber).toBeNull();
      expect(await api.patch(`/v1/movement-groups/${group}`, { remove: [groupMv[2]] })).toMatchObject({ status: 404, body: { code: 'MOVEMENT_NOT_IN_GROUP' } });
    });

    it('beginnt alle Bewegungen für den zugeteilten Bediener und gibt sie zurück', async () => {
      const started = await api.post(`/v1/movement-groups/${group}/start`, {});
      expect(started.body).toMatchObject({ state: 'IN_PROGRESS', counts: { open: 0, inProgress: 2 } });
      expect(started.body.movements.every((m: { assignedTo: string }) => m.assignedTo === 'stapler-7')).toBe(true);
      expect(await api.post(`/v1/movement-groups/${group}/start`, {})).toMatchObject({ status: 409, body: { code: 'NOTHING_TO_START' } });

      const reassigned = await api.post(`/v1/movement-groups/${group}/assign`, { assignedTo: 'stapler-9' });
      expect(reassigned.body.movements.every((m: { assignedTo: string }) => m.assignedTo === 'stapler-9')).toBe(true);
      expect((await api.get('/v1/movement-groups?assignedTo=stapler-9')).body.items.map((g: { number: string }) => g.number)).toEqual([group]);

      const released = await api.post(`/v1/movement-groups/${group}/release`);
      expect(released.body).toMatchObject({ state: 'OPEN', assignedTo: null, counts: { open: 2 } });
      const changed = await collector.waitFor((m) => m.topic === 'wms/movement-group/changed' && (m.body['payload'] as { change: string }).change === 'released');
      expect(changed.body['payload']).toMatchObject({ number: group, state: 'OPEN' });
    });

    it('wird erledigt, wenn alle Bewegungen abgeschlossen sind, und nimmt dann nichts mehr auf', async () => {
      const started = await api.post(`/v1/movement-groups/${group}/start`, { assignedTo: 'stapler-7' });
      expect(started.body.state).toBe('IN_PROGRESS');
      for (const number of groupMv.slice(0, 2)) expect((await api.post(`/v1/movements/${number}/complete`, {})).status).toBe(200);
      const done = (await api.get(`/v1/movement-groups/${group}`)).body;
      expect(done).toMatchObject({ state: 'DONE', counts: { done: 2 } });
      expect((await api.get('/v1/movement-groups?state=DONE')).body.items.map((g: { number: string }) => g.number)).toContain(group);
      expect(await api.patch(`/v1/movement-groups/${group}`, { add: [groupMv[2]] })).toMatchObject({ status: 409, body: { code: 'GROUP_CLOSED' } });
      await api.post(`/v1/movements/${groupMv[2]}/cancel`, {});
    });
  });

  it('beschreibt die Endpunkte in OpenAPI', async () => {
    const paths = Object.keys(((await api.get('/openapi.json')).body as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(
      expect.arrayContaining(['/v1/movements', '/v1/movements/{number}', '/v1/movements/{number}/start', '/v1/movements/{number}/complete', '/v1/movements/{number}/cancel']),
    );
  });
});
