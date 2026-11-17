import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { baseFlow, helper, next, nodes, startApi } from './support.mjs';

describe('WMS-Nodes für Node-RED', () => {
  let api;

  beforeAll(async () => {
    await new Promise((resolve) => helper.startServer(resolve));
    api = await startApi({
      'GET /v1/transport-units/P1': { status: 200, body: { barcode: 'P1', state: 'AVAILABLE' } },
      'POST /v1/transport-units/P1/move': (body) => ({ status: 200, body: { unit: { barcode: 'P1' }, echo: body } }),
      'POST /v1/transport-units/P9/move': { status: 409, body: { code: 'PLACEMENT_REJECTED', message: 'Platz ist voll', details: { violations: [{ rule: 'LOCATION_FULL' }] } } },
      'POST /v1/receiving-blind-captures': (body) => ({ status: 201, body: { kind: 'blind', echo: body } }),
      'POST /v1/receiving-orders/WE-1/captures': (body) => ({ status: 201, body: { kind: 'quantity', echo: body } }),
      'POST /v1/flow/events': (body) => ({ status: 200, body: { decision: { outcome: 'COMMAND' }, command: { to: { plcCode: 'CV02' } }, echo: body } }),
    });
  });
  afterEach(async () => {
    await helper.unload();
    api.requests.length = 0;
  });
  afterAll(async () => {
    await api.close();
    await new Promise((resolve) => helper.stopServer(resolve));
  });

  const load = (extra) => helper.load(nodes, baseFlow(api.url, extra));

  describe('Aktions-Nodes', () => {
    it('wms-api füllt Platzhalter und gibt die Antwort aus', async () => {
      await load([{ id: 'n', type: 'wms-api', server: 'cfg', method: 'GET', path: '/v1/transport-units/{barcode}', wires: [['out']] }]);
      const out = next(helper.getNode('out'));
      helper.getNode('n').receive({ params: { barcode: 'P1' } });
      const msg = await out;
      expect(msg).toMatchObject({ statusCode: 200, payload: { barcode: 'P1' } });
      expect(msg.wmsRequestedAt).toBeTypeOf('number');
    });

    it('meldet fachliche Fehler als Node-RED-Fehler mit Code (Catch-Node)', async () => {
      await load([
        { id: 'n', type: 'wms-move-tu', server: 'cfg', barcode: 'msg.payload.barcode', locationKind: 'erpCode', location: 'A1', mode: 'checked', wires: [['out']] },
        { id: 'c1', type: 'catch', scope: ['n'], wires: [['out2']] },
      ]);
      const caught = next(helper.getNode('out2'));
      helper.getNode('n').receive({ payload: { barcode: 'P9' } });
      const msg = await caught;
      expect(msg.wmsError).toEqual({ code: 'PLACEMENT_REJECTED', message: 'Platz ist voll', statusCode: 409, details: { violations: [{ rule: 'LOCATION_FULL' }] } });
      expect(msg.error.message).toContain('PLACEMENT_REJECTED: Platz ist voll');
    });

    it('gibt Fehler mit Fehlerausgang an Ausgang 2', async () => {
      await load([{ id: 'n', type: 'wms-move-tu', server: 'cfg', location: 'A1', errorOutput: true, outputs: 2, wires: [['out'], ['out2']] }]);
      const err = next(helper.getNode('out2'));
      helper.getNode('n').receive({ payload: { barcode: 'P9' } });
      expect((await err).wmsError.code).toBe('PLACEMENT_REJECTED');
    });

    it('wms-move-tu baut den Platzverweis und den Modus', async () => {
      await load([{ id: 'n', type: 'wms-move-tu', server: 'cfg', barcode: 'P1', locationKind: 'plcCode', location: 'msg.payload.scanner', mode: 'physical', wires: [['out']] }]);
      const out = next(helper.getNode('out'));
      helper.getNode('n').receive({ payload: { scanner: 'CV01' } });
      await out;
      expect(api.requests[0]).toMatchObject({ method: 'POST', url: '/v1/transport-units/P1/move', body: { to: { plcCode: 'CV01' }, mode: 'physical' } });
    });

    it('meldet sich mit dem Service-Token aus der Umgebung an', async () => {
      process.env.WMS_API_TOKEN = 'token-aus-der-umgebung';
      try {
        await load([{ id: 'n', type: 'wms-move-tu', server: 'cfg', barcode: 'P1', locationKind: 'plcCode', location: 'CV01', wires: [['out']] }]);
        const out = next(helper.getNode('out'));
        helper.getNode('n').receive({ payload: {} });
        await out;
        expect(api.requests[0].authorization).toBe('Bearer token-aus-der-umgebung');
      } finally {
        delete process.env.WMS_API_TOKEN;
      }
    });

    it('meldet fehlende Eingaben verständlich', async () => {
      await load([
        { id: 'n', type: 'wms-move-tu', server: 'cfg', wires: [['out']] },
        { id: 'c1', type: 'catch', scope: ['n'], wires: [['out2']] },
      ]);
      const caught = next(helper.getNode('out2'));
      helper.getNode('n').receive({ payload: {} });
      expect((await caught).wmsError).toMatchObject({ code: 'INPUT_MISSING', message: expect.stringContaining('Barcode') });
      expect(api.requests).toEqual([]);
    });

    it('wms-receive erfasst blind oder gegen einen Auftrag', async () => {
      await load([
        { id: 'rb', type: 'wms-receive', server: 'cfg', mode: 'blind', typeCode: 'EURO', unitBarcode: '', lot: '', bestBefore: '', wires: [['out']] },
        { id: 'ro', type: 'wms-receive', server: 'cfg', mode: 'order', orderId: 'WE-1', wires: [['out2']] },
      ]);
      const a = next(helper.getNode('out'));
      helper.getNode('rb').receive({ payload: { sku: 'SKU-A', amount: 5, unit: 'PCS', location: 'WE' } });
      await a;
      expect(api.requests[0].body).toEqual({ sku: 'SKU-A', quantity: { amount: '5', unit: 'PCS' }, unit: { typeCode: 'EURO' }, location: { erpCode: 'WE' } });
      const b = next(helper.getNode('out2'));
      helper.getNode('ro').receive({ payload: { sku: 'SKU-A', amount: '2.5', unit: 'KG', barcode: 'P1', location: 'WE', lot: 'L1' } });
      await b;
      expect(api.requests[1]).toMatchObject({ url: '/v1/receiving-orders/WE-1/captures', body: { kind: 'quantity', unit: { barcode: 'P1' }, lot: 'L1', quantity: { amount: '2.5' } } });
    });

    it('wms-device-event meldet ein Geräte-Ereignis über den plcCode', async () => {
      await load([{ id: 'n', type: 'wms-device-event', server: 'cfg', eventType: 'request', deviceId: 'SPS1', wires: [['out']] }]);
      const out = next(helper.getNode('out'));
      helper.getNode('n').receive({ payload: { location: 'CV01', barcode: 'P1' } });
      expect((await out).payload.command).toEqual({ to: { plcCode: 'CV02' } });
      expect(api.requests[0].body).toEqual({ type: 'request', location: { plcCode: 'CV01' }, barcode: 'P1', deviceId: 'SPS1' });
    });
  });

  describe('Ereignisse', () => {
    const event = (id, type, payload) => ({ id, type, version: 1, occurredAt: new Date().toISOString(), source: 'wms-api', payload });

    it('wms-event filtert nach Typ und Feld und verwirft Duplikate', async () => {
      await load([{ id: 'n', type: 'wms-event', server: 'cfg', types: 'stock.*', conditions: [{ path: 'payload.barcode', value: 'P1' }], wires: [['out']] }]);
      const received = [];
      helper.getNode('out').on('input', (m) => received.push(m.payload.id));
      const broker = helper.getNode('broker');
      expect(broker.subscriptions.map((s) => s.topic)).toEqual(['wms/#']);
      broker.publish(event('e1', 'stock.received', { barcode: 'P1' }));
      broker.publish(event('e1', 'stock.received', { barcode: 'P1' }));
      broker.publish(event('e2', 'stock.received', { barcode: 'P2' }));
      broker.publish(event('e3', 'movement.created', { barcode: 'P1' }));
      broker.publish(event('e4', 'stock.issued', { barcode: 'P1' }));
      await new Promise((r) => setTimeout(r, 20));
      expect(received).toEqual(['e1', 'e4']);
    });

    it('wms-wait-event wartet auf das passende Ereignis (Bedingung aus der Nachricht)', async () => {
      await load([{ id: 'n', type: 'wms-wait-event', server: 'cfg', types: 'transport-order.finished', conditions: [{ path: 'payload.number', value: 'msg.payload.number' }], timeout: 1000, wires: [['out'], ['out2']] }]);
      const out = next(helper.getNode('out'));
      helper.getNode('n').receive({ payload: { number: 'TO2' }, test: { steps: [] } });
      const broker = helper.getNode('broker');
      broker.publish(event('a', 'transport-order.finished', { number: 'TO1' }));
      broker.publish(event('b', 'transport-order.finished', { number: 'TO2' }));
      const msg = await out;
      expect(msg.event.id).toBe('b');
      expect(msg.test.steps).toMatchObject([{ passed: true }]);
    });

    it('wms-wait-event zählt ein Ereignis, das schon vor der Nachricht kam', async () => {
      await load([{ id: 'n', type: 'wms-wait-event', server: 'cfg', types: 'stock.received', timeout: 1000, wires: [['out'], ['out2']] }]);
      const requestedAt = Date.now();
      helper.getNode('broker').publish(event('early', 'stock.received', {}));
      const out = next(helper.getNode('out'));
      helper.getNode('n').receive({ wmsRequestedAt: requestedAt });
      expect((await out).event.id).toBe('early');
    });

    it('wms-wait-event gibt nach dem Timeout an Ausgang 2', async () => {
      await load([{ id: 'n', type: 'wms-wait-event', server: 'cfg', types: 'nie.passiert', timeout: 50, wires: [['out'], ['out2']] }]);
      const timeout = next(helper.getNode('out2'));
      helper.getNode('n').receive({ test: { steps: [] } });
      const msg = await timeout;
      expect(msg.wmsError.code).toBe('EVENT_TIMEOUT');
      expect(msg.test.steps).toMatchObject([{ passed: false }]);
    });
  });

  describe('Test-Nodes', () => {
    it('prüft, notiert Schritte und überträgt das Ergebnis ins Testframework', async () => {
      await load([
        { id: 'start', type: 'wms-test-start', name: 'mein-test', wires: [['check']] },
        {
          id: 'check',
          type: 'wms-assert',
          name: 'Zustand',
          checks: [
            { path: 'payload.state', op: 'eq', value: 'STARTED' },
            { path: 'payload.items', op: 'length', value: '2' },
            { path: 'payload.amount', op: 'eq', value: 'msg.expected' },
            { path: 'payload.missing', op: 'notExists', value: '' },
          ],
          wires: [['result'], ['result']],
        },
        { id: 'result', type: 'wms-test-result', wires: [['out']] },
      ]);
      const out = next(helper.getNode('out'));
      const scenario = { id: 'x', runId: 'r1', steps: [] };
      helper.getNode('start').receive({ scenario, expected: '12.5', payload: { state: 'STARTED', items: [1, 2], amount: '12.5' } });
      const msg = await out;
      expect(msg.test).toMatchObject({ name: 'mein-test', runId: 'r1', passed: true, steps: [{ name: 'Zustand', passed: true }] });
      expect(msg.scenario).toMatchObject({ passed: true, steps: [{ name: 'Zustand', passed: true }] });
    });

    it('meldet Abweichungen und Fehler eines WMS-Aufrufs als fehlgeschlagen', async () => {
      await load([
        { id: 'check', type: 'wms-assert', name: 'Status', checks: [{ path: 'statusCode', op: 'eq', value: '201' }], wires: [['out'], ['result']] },
        { id: 'result', type: 'wms-test-result', wires: [['out2']] },
      ]);
      const out = next(helper.getNode('out2'));
      const scenario = { id: 'x', runId: 'r1', steps: [] };
      helper.getNode('check').receive({ scenario, statusCode: 409, wmsError: { code: 'X', message: 'y' } });
      const msg = await out;
      expect(msg.test.passed).toBe(false);
      expect(msg.scenario).toMatchObject({ passed: false, error: expect.stringContaining('statusCode eq "201", ist 409') });
    });
  });

  it('Editor-Dateien sind aktuell (scripts/build-html.mjs)', () => {
    const script = fileURLToPath(new URL('../scripts/build-html.mjs', import.meta.url));
    expect(execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' })).toContain('aktuell');
  });

  it('meldet alle Nodes im package.json an', async () => {
    const { createRequire } = await import('node:module');
    const pkg = createRequire(import.meta.url)('../package.json');
    expect(Object.keys(pkg['node-red'].nodes).sort()).toEqual(
      ['wms-api', 'wms-assert', 'wms-config', 'wms-device-event', 'wms-event', 'wms-move-tu', 'wms-receive', 'wms-test-result', 'wms-test-start', 'wms-wait-event'],
    );
  });
});
