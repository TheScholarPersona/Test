import type { INestApplication } from '@nestjs/common';
import { TransportOrderStartedEvent } from '@wms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

/**
 * Transportaufträge.
 *
 *   WE    WE (100 TUs, Ausgangsplatz)
 *   LAGER A1, A2 (je 5 TUs)
 *   ZIEL  Z1, Z2 (je 1 TU) – für Sperre und Umleitung
 * Aktiver Einlager-Regelsatz: erster freier Platz in der angefragten Gruppe.
 */
describe('Transportaufträge', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  const loc: Record<string, string> = {};
  const coord = (name: string) => `T${name}/0001/0001/0001/0000`;

  const order = async (number: string) => (await api.get(`/v1/transport-orders/${number}`)).body;
  const unit = async (barcode: string) => (await api.get(`/v1/transport-units/${barcode}`)).body;
  const create = (barcode: string, target: unknown, extra: Record<string, unknown> = {}) =>
    api.post('/v1/transport-orders', { barcode, target, ...extra });
  const lockLocation = (name: string, inbound: boolean) => api.patch(`/v1/locations/${loc[name]}/locks`, { inbound });

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);

    await api.post('/v1/location-types', { code: 'REGAL' });
    for (const name of ['WE', 'LAGER', 'ZIEL']) await api.post('/v1/location-groups', { name });
    for (const [name, groupName, max, sortOrder] of [
      ['WE', 'WE', 100, 1],
      ['A1', 'LAGER', 5, 1],
      ['A2', 'LAGER', 5, 2],
      ['Z1', 'ZIEL', 1, 1],
      ['Z2', 'ZIEL', 1, 2],
    ] as const) {
      const r = await api.post('/v1/locations', { locationId: coord(name), erpCode: name, groupName, typeCode: 'REGAL', maxTransportUnits: max, sortOrder });
      expect(r.status).toBe(201);
      loc[name] = r.body.id;
    }
    await api.post('/v1/transport-unit-types', { code: 'EURO' });
    for (let i = 1; i <= 12; i++) {
      expect((await api.post('/v1/transport-units', { barcode: `K${i}`, typeCode: 'EURO', location: { erpCode: 'WE' } })).status).toBe(201);
    }
    const ruleSet = await api.post('/v1/strategy-rule-sets', {
      decisionPoint: 'putaway',
      rules: [{ name: 'anfrage', when: { always: true }, strategy: 'first-free', params: {} }],
    });
    await api.post(`/v1/strategy-rule-sets/${ruleSet.body.id}/activate`);
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  describe('Anlegen und Start (O-01, O-02, O-06)', () => {
    let first: string;
    let second: string;

    it('legt einen Auftrag an, startet ihn und reserviert das Ziel', async () => {
      const r = await create('K1', { location: { erpCode: 'A1' } }, { initiator: 'test' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        number: expect.stringMatching(/^TO\d{8}$/),
        barcode: 'K1',
        state: 'STARTED',
        source: { id: loc['WE'] },
        target: { id: loc['A1'], locationId: coord('A1') },
        problem: null,
        allowedActions: ['interrupt', 'finish', 'cancel', 'fail'],
      });
      first = r.body.number;
      expect((await unit('K1')).target).toMatchObject({ erpCode: 'A1' });
      const event = await collector.waitFor((m) => m.topic === 'wms/transport-order/started' && (m.body as { payload: { number: string } }).payload.number === first);
      expect(TransportOrderStartedEvent.parse(event.body).payload).toMatchObject({ barcode: 'K1', redirectedFrom: null });
    });

    it('prüft TU und Ziel beim Anlegen', async () => {
      expect(await create('NOPE', { location: { erpCode: 'A1' } })).toMatchObject({ status: 404, body: { code: 'TU_NOT_FOUND' } });
      expect(await create('K2', { location: { erpCode: 'NOPE' } })).toMatchObject({ status: 404, body: { code: 'LOCATION_NOT_FOUND' } });
      expect(await create('K2', { group: 'NOPE' })).toMatchObject({ status: 404, body: { code: 'LOCATION_GROUP_NOT_FOUND' } });
      expect(await create('K2', { location: { erpCode: 'WE' } })).toMatchObject({ status: 409, body: { code: 'TARGET_IS_SOURCE' } });
      expect(await api.post('/v1/transport-orders', { barcode: 'K2' })).toMatchObject({ status: 400 });
    });

    it('lässt einen zweiten Auftrag derselben TU warten (O-02)', async () => {
      const r = await create('K1', { location: { erpCode: 'A2' } });
      expect(r.body).toMatchObject({ state: 'INITIALIZED', problem: null });
      second = r.body.number;
      expect(await api.post(`/v1/transport-orders/${second}/start`)).toMatchObject({ status: 409, body: { code: 'TRANSPORT_ORDER_ACTIVE', details: { active: first } } });
      expect(await api.post(`/v1/transport-orders/${second}/finish`, {})).toMatchObject({ status: 409, body: { code: 'INVALID_STATE_TRANSITION' } });
    });

    it('bucht beim Abschluss und startet den nächsten Auftrag der TU (O-06)', async () => {
      const r = await api.post(`/v1/transport-orders/${first}/finish`, {});
      expect(r).toMatchObject({ status: 200, body: { state: 'FINISHED', finished: { locationId: coord('A1'), deviated: false }, allowedActions: [] } });
      expect((await unit('K1')).location).toMatchObject({ erpCode: 'A1' });
      expect(await order(second)).toMatchObject({ state: 'STARTED', source: { id: loc['WE'] } });
      expect((await unit('K1')).target).toMatchObject({ erpCode: 'A2' });
      expect(await api.post(`/v1/transport-orders/${first}/cancel`, {})).toMatchObject({ status: 409, body: { code: 'INVALID_STATE_TRANSITION' } });
    });

    it('meldet eine Abweichung beim Abschluss auf einem anderen Platz', async () => {
      const r = await api.post(`/v1/transport-orders/${second}/finish`, { location: { erpCode: 'A1' } });
      expect(r.body).toMatchObject({ state: 'FINISHED', finished: { locationId: coord('A1'), deviated: true } });
      expect((await unit('K1')).target).toBeNull();
    });
  });

  describe('Startreihenfolge (O-05)', () => {
    it('startet wartende Aufträge nach Priorität, dann Alter', async () => {
      const normal = (await create('K2', { location: { erpCode: 'A1' } }, { autoStart: false })).body.number;
      const high = (await create('K2', { location: { erpCode: 'A2' } }, { autoStart: false, priority: 'HIGH' })).body.number;
      const list = (await api.get('/v1/transport-orders?state=INITIALIZED&barcode=K2')).body.items.map((o: { number: string }) => o.number);
      expect(list).toEqual([high, normal]);
      const r = await api.post('/v1/transport-orders/start-pending');
      expect(r.body.started).toContain(high);
      expect(await order(high)).toMatchObject({ state: 'STARTED' });
      expect(await order(normal)).toMatchObject({ state: 'INITIALIZED' });
      await api.post(`/v1/transport-orders/${high}/cancel`, { reason: 'Test' });
      expect(await order(normal)).toMatchObject({ state: 'STARTED' });
      await api.post(`/v1/transport-orders/${normal}/cancel`, {});
    });
  });

  describe('Gesperrte Ziele (O-04) und Umleitung (O-07)', () => {
    it('startet nicht auf einen gesperrten Zielplatz und nennt den Grund', async () => {
      await lockLocation('Z1', true);
      const r = await create('K3', { location: { erpCode: 'Z1' } });
      expect(r.body).toMatchObject({ state: 'INITIALIZED', problem: { code: 'TARGET_LOCKED' } });
      await collector.waitFor((m) => m.topic === 'wms/transport-order/start-blocked' && (m.body as { payload: { number: string } }).payload.number === r.body.number);
      expect(await api.post(`/v1/transport-orders/${r.body.number}/start`)).toMatchObject({ status: 409, body: { code: 'TARGET_LOCKED' } });
      expect((await unit('K3')).target).toBeNull();

      await lockLocation('Z1', false);
      expect((await api.post('/v1/transport-orders/start-pending')).body.started).toContain(r.body.number);
      expect(await order(r.body.number)).toMatchObject({ state: 'STARTED', problem: null });
      await api.post(`/v1/transport-orders/${r.body.number}/cancel`, {});
      expect((await unit('K3')).target).toBeNull();
    });

    it('startet nicht in eine gesperrte Zielgruppe', async () => {
      await api.patch('/v1/location-groups/ZIEL/locks', { inbound: true });
      const r = await create('K4', { group: 'ZIEL' });
      expect(r.body).toMatchObject({ state: 'INITIALIZED', target: null, targetGroup: 'ZIEL', problem: { code: 'TARGET_LOCKED' } });
      await api.patch('/v1/location-groups/ZIEL/locks', { inbound: false });
      await api.post(`/v1/transport-orders/${r.body.number}/cancel`, {});
    });

    it('lehnt einen vollen Zielplatz ab (harte Platzregeln)', async () => {
      const a = await create('K5', { location: { erpCode: 'Z2' } });
      expect(a.body.state).toBe('STARTED');
      const b = await create('K6', { location: { erpCode: 'Z2' } });
      expect(b.body).toMatchObject({ state: 'INITIALIZED', problem: { code: 'PLACEMENT_REJECTED' } });
      for (const n of [a.body.number, b.body.number]) await api.post(`/v1/transport-orders/${n}/cancel`, {});
    });

    it('leitet bei gesperrtem Ziel auf einen Ersatzplatz der Gruppe um, wenn erlaubt', async () => {
      await lockLocation('Z1', true);
      const r = await create('K7', { location: { erpCode: 'Z1' } }, { redirect: true });
      expect(r.body).toMatchObject({ state: 'STARTED', target: { id: loc['Z2'] }, decisionId: expect.any(String) });
      expect((await unit('K7')).target).toMatchObject({ erpCode: 'Z2' });
      const event = await collector.waitFor((m) => m.topic === 'wms/transport-order/started' && (m.body as { payload: { number: string } }).payload.number === r.body.number);
      expect(TransportOrderStartedEvent.parse(event.body).payload.redirectedFrom).toMatchObject({ id: loc['Z1'] });

      // Kein Ersatzplatz mehr frei: Auftrag wartet mit Begründung.
      const blocked = await create('K8', { location: { erpCode: 'Z1' } }, { redirect: true });
      expect(blocked.body).toMatchObject({ state: 'INITIALIZED', problem: { code: 'TARGET_LOCKED', message: expect.stringContaining('keine Umleitung') } });
      for (const n of [r.body.number, blocked.body.number]) await api.post(`/v1/transport-orders/${n}/cancel`, {});
      await lockLocation('Z1', false);
    });
  });

  describe('Zielgruppe, Unterbrechung, Scheitern', () => {
    it('schließt einen Auftrag mit Zielgruppe auf einem Platz der Gruppe ab', async () => {
      const r = await create('K9', { group: 'LAGER' });
      expect(r.body).toMatchObject({ state: 'STARTED', target: null, targetGroup: 'LAGER' });
      expect(await api.post(`/v1/transport-orders/${r.body.number}/finish`, { location: { erpCode: 'A2' } })).toMatchObject({
        body: { state: 'FINISHED', finished: { locationId: coord('A2'), deviated: false } },
      });
    });

    it('unterbricht, setzt fort und lässt scheitern', async () => {
      const r = await create('K10', { location: { erpCode: 'A1' } });
      const n = r.body.number;
      expect(await api.post(`/v1/transport-orders/${n}/interrupt`, { reason: 'Störung Förderer' })).toMatchObject({
        body: { state: 'INTERRUPTED', problem: { code: 'INTERRUPTED', message: 'Störung Förderer' }, allowedActions: ['resume', 'cancel', 'fail'] },
      });
      // Auch unterbrochen belegt der Auftrag die TU.
      expect((await create('K10', { location: { erpCode: 'A2' } })).body.state).toBe('INITIALIZED');
      expect(await api.post(`/v1/transport-orders/${n}/resume`)).toMatchObject({ body: { state: 'STARTED', problem: null } });
      const failed = await api.post(`/v1/transport-orders/${n}/fail`, { code: 'DEVICE_ERROR', reason: 'Lichtschranke' });
      expect(failed.body).toMatchObject({ state: 'ONFAILURE', problem: { code: 'DEVICE_ERROR' }, ended: { reason: 'Lichtschranke' } });
      // Die Problemhistorie behält auch das bereits aufgehobene Problem der Unterbrechung.
      const history = (await api.get(`/v1/transport-orders/${n}`)).body.problems as { code: string; message: string; at: string }[];
      expect(history.map((h) => [h.code, h.message])).toEqual([
        ['INTERRUPTED', 'Störung Förderer'],
        ['DEVICE_ERROR', 'Lichtschranke'],
      ]);
      expect(Date.parse(history[0]!.at)).toBeLessThanOrEqual(Date.parse(history[1]!.at));
      // Der wartende Auftrag startet nach dem Scheitern.
      const next = (await api.get('/v1/transport-orders?barcode=K10&state=STARTED')).body.items;
      expect(next).toHaveLength(1);
      await api.post(`/v1/transport-orders/${next[0].number}/cancel`, {});
    });
  });

  describe('Belegung, Löschschutz und Parallelität', () => {
    it('trennt Lagerbewegung und Transportauftrag derselben TU', async () => {
      const movement = await api.post('/v1/movements', { barcode: 'K11', type: 'RELOCATION', target: { location: { erpCode: 'A1' } } });
      expect(movement.status).toBe(201);
      const r = await create('K11', { location: { erpCode: 'A2' } });
      expect(r.body).toMatchObject({ state: 'INITIALIZED', problem: { code: 'TU_CLAIMED' } });
      await api.post(`/v1/movements/${movement.body.number}/cancel`, {});
      expect(await api.post(`/v1/transport-orders/${r.body.number}/start`)).toMatchObject({ body: { state: 'STARTED' } });
      expect(await api.post('/v1/movements', { barcode: 'K11', type: 'RELOCATION', target: { location: { erpCode: 'A1' } } })).toMatchObject({
        status: 409,
        body: { code: 'TU_CLAIMED' },
      });
    });

    it('schützt TU und Zielplatz offener Aufträge vor dem Löschen', async () => {
      const r = await api.delete('/v1/transport-units/K11');
      expect(r).toMatchObject({ status: 409, body: { code: 'TU_IN_USE' } });
      expect(r.body.details.objections).toContainEqual({ check: 'transport-orders', reason: expect.stringContaining('offene') });
      const l = await api.delete(`/v1/locations/${loc['A2']}`);
      expect(l.status).toBe(409);
      expect(JSON.stringify(l.body)).toContain('transport-orders');
    });

    it('startet bei gleichzeitigen Aufträgen für eine TU genau einen', async () => {
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => create('K12', { location: { erpCode: i % 2 ? 'A1' : 'A2' } })));
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
      const states = results.map((r) => r.body.state).sort();
      expect(states.filter((s) => s === 'STARTED')).toHaveLength(1);
      expect(states.filter((s) => s === 'INITIALIZED')).toHaveLength(7);
    });
  });

  it('beschreibt die Endpunkte in OpenAPI', async () => {
    const paths = Object.keys(((await api.get('/openapi.json')).body as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(
      expect.arrayContaining(['/v1/transport-orders', '/v1/transport-orders/start-pending', '/v1/transport-orders/{number}/finish', '/v1/transport-orders/{number}/interrupt']),
    );
  });

  it('hinterlässt Buchungsjournal, Änderungsprotokoll und Bestand stimmig', async () => {
    expect((await api.post('/v1/stock-journal/verify', {})).body).toMatchObject({ ok: true, problems: [] });
  });
});
