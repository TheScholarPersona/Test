import type { INestApplication } from '@nestjs/common';
import { FlowCommandEvent, FlowProgramRequestedEvent } from '@wms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

/**
 * Materialfluss.
 *
 *   FT   (Fördertechnik)  I1 = IP01 (Identifikationspunkt), C1 = CV01, C2 = CV02, C3 = CV03
 *   HRL  (Hochregal)      H1 = HRL01
 *   NIO  (Klärplatz)      K1 = NIO1
 *
 * Route IP-HRL von I1 in die Gruppe HRL: I1 → C1 → C2 → H1; für TU-Typ BOX C1 → C3 → H1.
 * Actions: Anfrage an I1 legt TU und Auftrag an, Anfragen in FT fahren weiter,
 * Ankunft in HRL schließt ab, Platzmeldungen sperren, Störungen unterbrechen.
 */
describe('Materialfluss', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  const loc: Record<string, string> = {};
  const coord = (name: string) => `F${name}/0001/0001/0001/0000`;

  const event = (body: Record<string, unknown>) => api.post('/v1/flow/events', body);
  const request = (plcCode: string, barcode: string, extra: Record<string, unknown> = {}) => event({ type: 'request', location: { plcCode }, barcode, deviceId: 'SPS1', ...extra });
  const unit = async (barcode: string) => (await api.get(`/v1/transport-units/${barcode}`)).body;
  const steps = (...pairs: [string, string, string?][]) => pairs.map(([from, next, unitType]) => ({ from: { plcCode: from }, next: { plcCode: next }, ...(unitType ? { unitType } : {}) }));
  const MAIN = steps(['IP01', 'CV01'], ['CV01', 'CV03', 'BOX'], ['CV01', 'CV02'], ['CV02', 'HRL01'], ['CV03', 'HRL01']);

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);

    await api.post('/v1/location-types', { code: 'FOERDER' });
    for (const name of ['FT', 'HRL', 'NIO']) await api.post('/v1/location-groups', { name });
    for (const [name, groupName, plcCode] of [
      ['I1', 'FT', 'IP01'],
      ['C1', 'FT', 'CV01'],
      ['C2', 'FT', 'CV02'],
      ['C3', 'FT', 'CV03'],
      ['H1', 'HRL', 'HRL01'],
      ['K1', 'NIO', 'NIO1'],
    ] as const) {
      const r = await api.post('/v1/locations', { locationId: coord(name), plcCode, groupName, typeCode: 'FOERDER', maxTransportUnits: 20 });
      expect(r.status).toBe(201);
      loc[name] = r.body.id;
    }
    for (const code of ['EURO', 'BOX']) await api.post('/v1/transport-unit-types', { code });

    const route = await api.post('/v1/flow/routes', { routeId: 'IP-HRL', description: 'I-Punkt ins Hochregal', source: { location: { plcCode: 'IP01' } }, target: { group: 'HRL' }, steps: MAIN });
    expect(route.status).toBe(201);
    for (const action of [
      { name: 'ip-anfrage', eventType: 'request', place: { location: { plcCode: 'IP01' } }, program: 'create-order', params: { target: { group: 'HRL' }, typeCode: 'EURO' } },
      { name: 'ft-anfrage', eventType: 'request', place: { group: 'FT' }, program: 'route-next' },
      { name: 'hrl-ankunft', eventType: 'arrived', place: { group: 'HRL' }, program: 'route-next' },
      { name: 'platzmeldung', eventType: 'location-status', program: 'lock-location' },
      { name: 'stoerung', eventType: 'error', program: 'interrupt-order' },
      { name: 'klaerung', eventType: 'request', place: { group: 'NIO' }, program: 'node-red', params: { flow: 'klaerplatz', hinweis: 'manuell prüfen' } },
    ]) {
      const r = await api.post('/v1/flow/actions', action);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  describe('Konfiguration', () => {
    it('prüft Programmparameter, Ereignistyp und Verweise', async () => {
      expect(await api.post('/v1/flow/actions', { name: 'x', eventType: 'request', program: 'send-to', params: {} })).toMatchObject({
        status: 400,
        body: { code: 'INVALID_PARAMS', details: { issues: [expect.objectContaining({ path: 'location' })] } },
      });
      expect(await api.post('/v1/flow/actions', { name: 'x', eventType: 'arrived', program: 'interrupt-order' })).toMatchObject({ status: 400, body: { code: 'PROGRAM_EVENT_MISMATCH' } });
      expect(await api.post('/v1/flow/actions', { name: 'x', eventType: 'request', program: 'send-to', params: { location: { plcCode: 'NOPE' } } })).toMatchObject({ status: 404 });
      expect(await api.post('/v1/flow/actions', { name: 'x', eventType: 'request', routeId: 'NOPE', program: 'route-next' })).toMatchObject({ status: 404, body: { code: 'ROUTE_NOT_FOUND' } });
      expect(await api.post('/v1/flow/actions', { name: 'ft-anfrage', eventType: 'request', program: 'route-next' })).toMatchObject({ status: 409, body: { code: 'ACTION_EXISTS' } });
      expect(await api.post('/v1/flow/routes', { routeId: 'IP-HRL', source: { group: 'FT' }, target: { group: 'HRL' } })).toMatchObject({ status: 409 });
      expect(await api.post('/v1/flow/routes', { routeId: 'Y', source: { group: 'NOPE' }, target: { group: 'HRL' } })).toMatchObject({ status: 404 });
      expect(await api.post('/v1/flow/routes', { routeId: 'Y', source: { group: 'FT' }, target: { group: 'HRL' }, steps: steps(['CV01', 'CV01']) })).toMatchObject({
        status: 400,
        body: { code: 'STEP_LOOP' },
      });
    });

    it('listet Programme mit Parameter-Schema und die Route mit Schritten', async () => {
      const programs = (await api.get('/v1/flow/programs')).body.items;
      expect(programs.map((p: { key: string }) => p.key)).toEqual(expect.arrayContaining(['route-next', 'create-order', 'node-red']));
      const route = (await api.get('/v1/flow/routes/IP-HRL')).body;
      expect(route).toMatchObject({ source: { location: { plcCode: 'IP01' } }, target: { group: 'HRL' } });
      expect(route.steps.map((s: { pos: number; from: { plcCode: string } }) => `${s.pos}:${s.from.plcCode}`)).toEqual(['1:IP01', '2:CV01', '3:CV01', '4:CV02', '5:CV03']);
    });
  });

  describe('Fahrt über die Route', () => {
    it('legt am I-Punkt TU und Auftrag an und schickt die TU zum ersten Schritt', async () => {
      const r = await request('IP01', 'F1');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({
        decision: { outcome: 'COMMAND', action: 'ip-anfrage', program: 'create-order', routeId: 'IP-HRL', next: coord('C1'), orderNumber: expect.stringMatching(/^TO/) },
        command: { barcode: 'F1', from: { plcCode: 'IP01' }, to: { plcCode: 'CV01' } },
      });
      expect(r.body.decision.trace).toEqual(
        expect.arrayContaining([expect.stringContaining('TU F1 ist unbekannt'), expect.stringContaining('angelegt und gestartet'), expect.stringContaining('Route IP-HRL')]),
      );
      const event = await collector.waitFor((m) => m.topic === 'wms/flow/command' && (m.body as { payload: { barcode: string } }).payload.barcode === 'F1');
      expect(FlowCommandEvent.parse(event.body).payload).toMatchObject({ deviceId: 'SPS1', routeId: 'IP-HRL', to: { plcCode: 'CV01' } });
    });

    it('fährt Schritt für Schritt und schließt bei Ankunft in der Zielgruppe ab', async () => {
      expect((await request('CV01', 'F1')).body).toMatchObject({ decision: { outcome: 'COMMAND', action: 'ft-anfrage' }, command: { to: { plcCode: 'CV02' } } });
      expect((await unit('F1')).location).toMatchObject({ id: loc['C1'] });
      expect((await request('CV02', 'F1')).body.command).toMatchObject({ to: { plcCode: 'HRL01' } });
      const done = await event({ type: 'arrived', location: { plcCode: 'HRL01' }, barcode: 'F1' });
      expect(done.body).toMatchObject({ decision: { outcome: 'FINISHED', action: 'hrl-ankunft' }, command: null });
      expect((await unit('F1')).location).toMatchObject({ id: loc['H1'] });
      const orders = (await api.get('/v1/transport-orders?barcode=F1')).body.items;
      expect(orders).toMatchObject([{ state: 'FINISHED', finished: { locationId: coord('H1'), deviated: false } }]);
      const decisions = (await api.get('/v1/flow/decisions?barcode=F1')).body;
      expect(decisions.items.map((d: { outcome: string }) => d.outcome)).toEqual(['FINISHED', 'COMMAND', 'COMMAND', 'COMMAND']);
    });

    it('nimmt für den TU-Typ den speziellen Schritt', async () => {
      await api.post('/v1/transport-units', { barcode: 'F2', typeCode: 'BOX', location: { plcCode: 'IP01' } });
      expect((await request('IP01', 'F2')).body.command).toMatchObject({ to: { plcCode: 'CV01' } });
      expect((await request('CV01', 'F2')).body.command).toMatchObject({ to: { plcCode: 'CV03' } });
    });

    it('wendet geänderte Schritte sofort an', async () => {
      await api.post('/v1/transport-units', { barcode: 'F3', typeCode: 'EURO', location: { plcCode: 'IP01' } });
      await request('IP01', 'F3');
      expect((await api.put('/v1/flow/routes/IP-HRL/steps', { steps: steps(['IP01', 'CV01'], ['CV01', 'CV03'], ['CV03', 'HRL01']) })).status).toBe(200);
      expect((await request('CV01', 'F3')).body.command).toMatchObject({ to: { plcCode: 'CV03' } });
      await api.put('/v1/flow/routes/IP-HRL/steps', { steps: MAIN });
      expect((await request('CV01', 'F3', { dryRun: true })).body.command).toMatchObject({ to: { plcCode: 'CV02' } });
    });

    it('bucht und sendet im Probelauf nichts, begründet aber', async () => {
      await api.post('/v1/transport-units', { barcode: 'F4', typeCode: 'EURO', location: { plcCode: 'IP01' } });
      await request('IP01', 'F4');
      const r = await request('CV01', 'F4', { dryRun: true });
      expect(r.body).toMatchObject({ decision: { outcome: 'COMMAND', dryRun: true }, command: { to: { plcCode: 'CV02' } } });
      expect(r.body.decision.trace).toEqual(expect.arrayContaining([expect.stringContaining('TU gebucht')]));
      expect((await unit('F4')).location).toMatchObject({ id: loc['I1'] });
      expect((await api.get('/v1/flow/decisions?barcode=F4')).body.total).toBe(1);
    });
  });

  describe('Keine Route, keine Action, Störungen', () => {
    it('meldet „keine Route“ für einen Auftrag ohne passende Route (R4)', async () => {
      await api.post('/v1/transport-units', { barcode: 'F5', typeCode: 'EURO', location: { plcCode: 'CV02' } });
      const order = await api.post('/v1/transport-orders', { barcode: 'F5', target: { location: { plcCode: 'NIO1' } } });
      expect(order.body.state).toBe('STARTED');
      const r = await request('CV02', 'F5');
      expect(r.body).toMatchObject({ decision: { outcome: 'NO_NEXT_STEP', routeId: null, orderNumber: order.body.number }, command: null });
      expect(r.body.decision.trace).toEqual(expect.arrayContaining([expect.stringContaining('Keine Route')]));
      await collector.waitFor((m) => m.topic === 'wms/flow/no-route' && (m.body as { payload: { barcode: string } }).payload.barcode === 'F5');
      await collector.waitFor((m) => m.topic === 'wms/flow/unhandled' && (m.body as { payload: { barcode: string | null } }).payload.barcode === 'F5');
    });

    it('meldet „keine Action“, wenn nichts konfiguriert ist', async () => {
      const r = await event({ type: 'arrived', location: { plcCode: 'CV01' }, barcode: 'F3' });
      expect(r.body).toMatchObject({ decision: { outcome: 'NO_ACTION', action: null }, command: null });
    });

    it('übernimmt Platzmeldungen der Anlage als Sperren', async () => {
      const r = await event({ type: 'location-status', location: { plcCode: 'CV02' }, state: { inbound: true }, code: 'E42', message: 'Förderer voll' });
      expect(r.body.decision).toMatchObject({ outcome: 'HANDLED', action: 'platzmeldung' });
      const l = (await api.get(`/v1/locations/${loc['C2']}`)).body;
      expect(JSON.stringify(l)).toMatch(/"inbound":\{[^}]*"own":true/);
      await event({ type: 'location-status', location: { plcCode: 'CV02' }, state: { inbound: false } });
    });

    it('unterbricht bei einer Störung den laufenden Auftrag', async () => {
      const r = await event({ type: 'error', location: { plcCode: 'CV01' }, barcode: 'F2', code: 'LS1', message: 'Lichtschranke' });
      expect(r.body.decision).toMatchObject({ outcome: 'HANDLED', action: 'stoerung' });
      expect((await api.get('/v1/transport-orders?barcode=F2')).body.items[0]).toMatchObject({ state: 'INTERRUPTED', problem: { message: 'LS1: Lichtschranke' } });
      // Unterbrochen fährt nichts weiter.
      expect((await request('CV03', 'F2')).body.decision).toMatchObject({ outcome: 'NO_NEXT_STEP' });
    });

    it('übergibt an Node-RED, das per Fahrbefehl antwortet', async () => {
      await api.post('/v1/transport-units', { barcode: 'F6', typeCode: 'EURO', location: { plcCode: 'NIO1' } });
      const r = await request('NIO1', 'F6');
      expect(r.body.decision).toMatchObject({ outcome: 'DELEGATED', program: 'node-red' });
      const requested = await collector.waitFor((m) => m.topic === 'wms/flow/program-requested' && (m.body as { payload: { barcode: string } }).payload.barcode === 'F6');
      expect(FlowProgramRequestedEvent.parse(requested.body).payload).toMatchObject({ flow: 'klaerplatz', params: { hinweis: 'manuell prüfen' }, decisionId: r.body.decision.id });
      const answer = await api.post('/v1/flow/commands', { barcode: 'F6', to: { plcCode: 'CV01' }, reason: 'klaerplatz' });
      expect(answer.body).toMatchObject({ decision: { outcome: 'COMMAND', program: 'command' }, command: { from: { plcCode: 'NIO1' }, to: { plcCode: 'CV01' } } });
    });

    it('findet keine Route, wenn sie abgeschaltet ist', async () => {
      await api.patch('/v1/flow/routes/IP-HRL', { enabled: false });
      const r = await request('CV01', 'F3', { dryRun: true });
      expect(r.body.decision).toMatchObject({ routeId: null, outcome: 'NO_NEXT_STEP' });
      await api.patch('/v1/flow/routes/IP-HRL', { enabled: true });
    });
  });

  describe('Schutz der Konfiguration', () => {
    it('schützt verwendete Plätze und Routen vor dem Löschen', async () => {
      const l = await api.delete(`/v1/locations/${loc['C3']}`);
      expect(l.status).toBe(409);
      expect(JSON.stringify(l.body)).toContain('Materialfluss');
      await api.post('/v1/flow/actions', { name: 'nur-route', eventType: 'request', routeId: 'IP-HRL', program: 'route-next' });
      expect(await api.delete('/v1/flow/routes/IP-HRL')).toMatchObject({ status: 409, body: { code: 'ROUTE_IN_USE' } });
      expect((await api.delete('/v1/flow/actions/nur-route')).status).toBe(204);
    });
  });

  it('beschreibt die Endpunkte in OpenAPI', async () => {
    const paths = Object.keys(((await api.get('/openapi.json')).body as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(expect.arrayContaining(['/v1/flow/events', '/v1/flow/commands', '/v1/flow/routes/{routeId}/steps', '/v1/flow/actions', '/v1/flow/decisions']));
  });
});
