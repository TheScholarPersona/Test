import type { INestApplication } from '@nestjs/common';
import { StockCorrectedEvent, StockReceivedEvent } from '@wms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

/**
 * Wareneingang und Bestand.
 *
 * Plätze: WE-1 (Wareneingang, 50 TUs), A1 (LAGER, 5 TUs). TU-Typ EURO.
 * Produkte: SKU-A in PCS (keine Überlieferung), SKU-B in KG (Überlieferung erlaubt).
 */
describe('Wareneingang und Bestand', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  const at = { erpCode: 'WE-1' };

  const order = async (orderId: string) => (await api.get(`/v1/receiving-orders/${orderId}`)).body;
  const position = async (orderId: string, posNo: number) => (await order(orderId)).positions.find((p: { posNo: number }) => p.posNo === posNo);
  const stockOn = async (barcode: string) => (await api.get(`/v1/stock?barcode=${barcode}`)).body.items;

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);

    await api.post('/v1/location-types', { code: 'REGAL' });
    for (const name of ['WE', 'LAGER']) await api.post('/v1/location-groups', { name });
    await api.post('/v1/locations', { locationId: 'RWE1/0001/0001/0001/0000', erpCode: 'WE-1', groupName: 'WE', typeCode: 'REGAL', maxTransportUnits: 50 });
    await api.post('/v1/locations', { locationId: 'RA1/0001/0001/0001/0000', erpCode: 'A1', groupName: 'LAGER', typeCode: 'REGAL', maxTransportUnits: 5 });
    await api.post('/v1/transport-unit-types', { code: 'EURO' });
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

  describe('Produkte', () => {
    it('legt Produkte an und prüft Kennung und Einheit', async () => {
      expect((await api.post('/v1/products', { sku: 'SKU-A', description: 'Schrauben', baseUnit: 'PCS' })).body).toMatchObject({
        sku: 'SKU-A',
        baseUnit: 'PCS',
        overdeliveryAllowed: false,
      });
      expect((await api.post('/v1/products', { sku: 'SKU-B', baseUnit: 'KG', overdeliveryAllowed: true })).status).toBe(201);
      expect(await api.post('/v1/products', { sku: 'SKU-A', baseUnit: 'PCS' })).toMatchObject({ status: 409, body: { code: 'PRODUCT_EXISTS' } });
      expect((await api.post('/v1/products', { sku: 'SKU-C', baseUnit: 'stück' })).status).toBe(400);
    });
  });

  describe('Avis', () => {
    it('legt einen Auftrag mit Mengen- und TU-Positionen an', async () => {
      const created = await api.post('/v1/receiving-orders', {
        orderId: 'WE-1',
        supplier: 'Lieferant GmbH',
        positions: [
          { kind: 'quantity', sku: 'SKU-A', quantity: { amount: '10', unit: 'PCS' } },
          { kind: 'quantity', sku: 'SKU-A', quantity: { amount: '5', unit: 'PCS' } },
          { kind: 'quantity', sku: 'SKU-B', quantity: { amount: '2.5', unit: 'KG' } },
          { kind: 'unit', typeCode: 'EURO', barcode: 'SSCC-1' },
          { kind: 'unit', typeCode: 'EURO' },
        ],
      });
      expect(created.status).toBe(201);
      expect(created.body.state).toBe('OPEN');
      expect(created.body.positions.map((p: { posNo: number; state: string }) => [p.posNo, p.state])).toEqual([
        [1, 'OPEN'],
        [2, 'OPEN'],
        [3, 'OPEN'],
        [4, 'OPEN'],
        [5, 'OPEN'],
      ]);
      expect(created.body.positions[0]).toMatchObject({ sku: 'SKU-A', expected: { amount: '10', unit: 'PCS' }, received: { amount: '0' }, open: { amount: '10' } });
    });

    it('prüft Auftragsnummer, Produkte und Einheiten', async () => {
      const position = { kind: 'quantity', sku: 'SKU-A', quantity: { amount: '1', unit: 'PCS' } };
      expect(await api.post('/v1/receiving-orders', { orderId: 'WE-1', positions: [position] })).toMatchObject({ status: 409, body: { code: 'RECEIVING_ORDER_EXISTS' } });
      expect(await api.post('/v1/receiving-orders', { orderId: 'WE-X', positions: [{ ...position, sku: 'GIBTSNICHT' }] })).toMatchObject({ status: 404 });
      expect(await api.post('/v1/receiving-orders', { orderId: 'WE-X', positions: [{ ...position, quantity: { amount: '1', unit: 'KG' } }] })).toMatchObject({
        status: 409,
        body: { code: 'UNIT_MISMATCH' },
      });
      expect((await api.post('/v1/receiving-orders', { orderId: 'WE-X', positions: [{ ...position, quantity: { amount: '0', unit: 'PCS' } }] })).status).toBe(400);
    });
  });

  describe('Erfassung', () => {
    it('erfasst eine Teilmenge auf eine neue TU und bucht Bestand', async () => {
      const r = await api.post('/v1/receiving-orders/WE-1/captures', {
        kind: 'quantity',
        sku: 'SKU-A',
        quantity: { amount: '8', unit: 'PCS' },
        unit: { barcode: 'T1', typeCode: 'EURO' },
        location: at,
        lot: 'L-2026-11',
        capturedBy: 'tester',
      });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ kind: 'quantity', posNo: 1, overdelivered: false, barcode: 'T1', onHand: { amount: '8', unit: 'PCS' }, order: { state: 'IN_PROGRESS' } });
      expect(await position('WE-1', 1)).toMatchObject({ state: 'IN_PROGRESS', received: { amount: '8' }, open: { amount: '2' } });
      expect(await stockOn('T1')).toMatchObject([{ sku: 'SKU-A', quantity: { amount: '8', unit: 'PCS' }, lot: 'L-2026-11', location: { locationId: 'RWE1/0001/0001/0001/0000' } }]);
      const journal = (await api.get('/v1/stock-bookings?barcode=T1')).body.items;
      expect(journal).toMatchObject([{ type: 'RECEIPT', quantity: { amount: '8' }, reference: 'receiving:WE-1/1' }]);
      const event = await collector.waitFor((m) => m.topic === 'wms/stock/received');
      expect(StockReceivedEvent.parse(event.body).payload).toMatchObject({ sku: 'SKU-A', barcode: 'T1', onHand: { amount: '8' } });
    });

    it('nimmt die Position, deren Restmenge reicht, und führt Bestand zusammen', async () => {
      const r = await api.post('/v1/receiving-orders/WE-1/captures', {
        kind: 'quantity', sku: 'SKU-A', quantity: { amount: '3', unit: 'PCS' }, unit: { barcode: 'T1' }, location: at, lot: 'L-2026-11',
      });
      expect(r.body).toMatchObject({ posNo: 2, onHand: { amount: '11' } });
      expect(await stockOn('T1')).toHaveLength(1);
    });

    it('lehnt Überlieferung ab, wenn das Produkt sie nicht erlaubt, und ändert nichts', async () => {
      const r = await api.post('/v1/receiving-orders/WE-1/captures', { kind: 'quantity', sku: 'SKU-A', quantity: { amount: '10', unit: 'PCS' }, unit: { barcode: 'T1' }, location: at });
      expect(r).toMatchObject({ status: 409, body: { code: 'OVERDELIVERY_NOT_ALLOWED', details: { remaining: [{ posNo: 1, remaining: '2' }, { posNo: 2, remaining: '2' }] } } });
      expect((await stockOn('T1'))[0].quantity.amount).toBe('11');
    });

    it('bucht erlaubte Überlieferung und schließt die Position', async () => {
      const r = await api.post('/v1/receiving-orders/WE-1/captures', { kind: 'quantity', sku: 'SKU-B', quantity: { amount: '3', unit: 'KG' }, unit: { barcode: 'T2', typeCode: 'EURO' }, location: at });
      expect(r.body).toMatchObject({ posNo: 3, overdelivered: true });
      expect(await position('WE-1', 3)).toMatchObject({ state: 'COMPLETED', received: { amount: '3' }, open: { amount: '0' } });
    });

    it('erfasst eine avisierte TU per Barcode', async () => {
      const r = await api.post('/v1/receiving-orders/WE-1/captures', { kind: 'unit', barcode: 'SSCC-1', location: at });
      expect(r.body).toMatchObject({ kind: 'unit', posNo: 4, barcode: 'SSCC-1' });
      expect((await api.get('/v1/transport-units/SSCC-1')).body).toMatchObject({ typeCode: 'EURO', location: { erpCode: 'WE-1' } });
    });

    it('legt auf Wunsch direkt die Einlagerbewegung an', async () => {
      const r = await api.post('/v1/receiving-orders/WE-1/captures', { kind: 'unit', barcode: 'P-NEU', location: at, putawayGroup: 'LAGER' });
      expect(r.body).toMatchObject({ posNo: 5, movementNumber: expect.stringMatching(/^MV\d{8}$/) });
      const movement = (await api.get(`/v1/movements/${r.body.movementNumber}`)).body;
      expect(movement).toMatchObject({ type: 'INBOUND', barcode: 'P-NEU', state: 'OPEN', target: { locationId: 'RA1/0001/0001/0001/0000' }, initiator: 'receiving' });
      expect(await api.post('/v1/receiving-orders/WE-1/captures', { kind: 'unit', barcode: 'P-NOCH', location: at })).toMatchObject({ status: 409, body: { code: 'NO_OPEN_POSITION' } });
    });
  });

  describe('Positionen und Auftrag abschließen', () => {
    it('storniert nur unberührte Positionen und schließt teilweise erfasste mit Fehlmenge', async () => {
      expect(await api.post('/v1/receiving-orders/WE-1/positions/1/cancel', {})).toMatchObject({ status: 409, body: { code: 'POSITION_NOT_OPEN' } });
      const closed = await api.post('/v1/receiving-orders/WE-1/positions/1/close', { reason: 'Rest kommt nicht' });
      expect(closed.body).toMatchObject({ state: 'IN_PROGRESS' });
      expect(closed.body.positions[0]).toMatchObject({ state: 'SHORT', closeReason: 'Rest kommt nicht' });
      expect(await api.post('/v1/receiving-orders/WE-1/positions/9/close', {})).toMatchObject({ status: 404, body: { code: 'POSITION_NOT_FOUND' } });
    });

    it('storniert keinen Auftrag mit Erfassungen; Abschluss schließt die restlichen Positionen', async () => {
      expect(await api.post('/v1/receiving-orders/WE-1/cancel', {})).toMatchObject({ status: 409, body: { code: 'CANCELLATION_DENIED' } });
      const completed = await api.post('/v1/receiving-orders/WE-1/complete', {});
      expect(completed.body.state).toBe('PARTIALLY_COMPLETED');
      expect(completed.body.positions.map((p: { state: string }) => p.state)).toEqual(['SHORT', 'SHORT', 'COMPLETED', 'COMPLETED', 'COMPLETED']);
      expect(await api.post('/v1/receiving-orders/WE-1/captures', { kind: 'unit', barcode: 'X', location: at })).toMatchObject({ status: 409, body: { code: 'ORDER_CLOSED' } });
      const event = await collector.waitFor(
        (m) => m.topic === 'wms/receiving-order/state-changed' && (m.body['payload'] as { state: string }).state === 'PARTIALLY_COMPLETED',
      );
      expect(event.body['payload']).toMatchObject({ orderId: 'WE-1', before: 'IN_PROGRESS' });
    });

    it('storniert einen Auftrag ohne Erfassungen vollständig', async () => {
      await api.post('/v1/receiving-orders', { orderId: 'WE-2', positions: [{ kind: 'quantity', sku: 'SKU-A', quantity: { amount: '1', unit: 'PCS' } }] });
      const cancelled = await api.post('/v1/receiving-orders/WE-2/cancel', { reason: 'Lieferung storniert' });
      expect(cancelled.body).toMatchObject({ state: 'CANCELLED', positions: [{ state: 'CANCELLED', closeReason: 'Lieferung storniert' }] });
    });

    it('listet die Erfassungen eines Auftrags', async () => {
      const captures = (await api.get('/v1/receiving-orders/WE-1/captures')).body;
      expect(captures.total).toBe(5);
      expect(captures.items[0]).toMatchObject({ kind: 'quantity', posNo: 1, sku: 'SKU-A', quantity: { amount: '8' }, barcode: 'T1', lot: 'L-2026-11', capturedBy: 'tester' });
    });
  });

  describe('Blind-Erfassung und Löschschutz', () => {
    it('bucht Ware ohne Avis', async () => {
      const r = await api.post('/v1/receiving-blind-captures', { sku: 'SKU-A', quantity: { amount: '4', unit: 'PCS' }, unit: { typeCode: 'EURO' }, location: at });
      expect(r.body).toMatchObject({ kind: 'blind', posNo: null, order: null, onHand: { amount: '4' }, barcode: expect.stringMatching(/^TU\d{10}$/) });
      expect((await api.get(`/v1/stock-bookings?barcode=${r.body.barcode}`)).body.items[0].reference).toBe('receiving:blind');
      expect(await api.post('/v1/receiving-blind-captures', { sku: 'SKU-A', quantity: { amount: '4', unit: 'KG' }, unit: { barcode: 'T1' }, location: at })).toMatchObject({
        status: 409,
        body: { code: 'UNIT_MISMATCH' },
      });
      expect(await api.post('/v1/receiving-blind-captures', { sku: 'SKU-A', quantity: { amount: '1', unit: 'PCS' }, location: at })).toMatchObject({
        status: 409,
        body: { code: 'TU_TYPE_REQUIRED' },
      });
    });

    it('schützt TUs mit Bestand vor dem Löschen und Produkte mit Bestand vor Einheitenwechsel', async () => {
      const r = await api.delete('/v1/transport-units/T1');
      expect(r).toMatchObject({ status: 409, body: { code: 'TU_IN_USE' } });
      expect(r.body.details.objections).toEqual([{ check: 'stock', reason: '1 Bestandsposten auf der TU' }]);
      expect(await api.patch('/v1/products/SKU-A', { baseUnit: 'KG' })).toMatchObject({ status: 409, body: { code: 'PRODUCT_UNIT_IN_USE' } });
    });
  });

  describe('Parallele Erfassungen', () => {
    it('verliert bei gleichzeitigen Erfassungen auf einen Auftrag keine Menge', async () => {
      await api.post('/v1/receiving-orders', { orderId: 'WE-3', positions: [{ kind: 'quantity', sku: 'SKU-A', quantity: { amount: '100', unit: 'PCS' } }] });
      await api.post('/v1/transport-units', { barcode: 'T-PAR', typeCode: 'EURO', location: at });
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          api.post('/v1/receiving-orders/WE-3/captures', { kind: 'quantity', sku: 'SKU-A', quantity: { amount: '5', unit: 'PCS' }, unit: { barcode: 'T-PAR' }, location: at }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
      expect(await position('WE-3', 1)).toMatchObject({ received: { amount: '50' }, state: 'IN_PROGRESS' });
      expect(await stockOn('T-PAR')).toMatchObject([{ quantity: { amount: '50' } }]);
      expect((await api.get('/v1/stock-bookings?barcode=T-PAR')).body.total).toBe(10);
    });
  });

  describe('Bestandskorrektur', () => {
    it('korrigiert mit Grund, verhindert negativen Bestand und entfernt leere Posten', async () => {
      const [item] = await stockOn('T-PAR');
      const correct = (amount: string, unit = 'PCS', reason = 'Inventur') => api.post(`/v1/stock/${item.id}/corrections`, { delta: { amount, unit }, reason });
      expect(await correct('0')).toMatchObject({ status: 400 });
      expect(await correct('-1', 'KG')).toMatchObject({ status: 409, body: { code: 'UNIT_MISMATCH' } });
      expect(await correct('-51')).toMatchObject({ status: 409, body: { code: 'STOCK_INSUFFICIENT' } });
      expect(await api.post('/v1/stock/00000000-0000-4000-8000-000000000000/corrections', { delta: { amount: '1', unit: 'PCS' }, reason: 'x' })).toMatchObject({ status: 404 });

      expect(await correct('-10.5', 'PCS', 'Bruch')).toMatchObject({ status: 200, body: { onHand: { amount: '39.5' }, removed: false } });
      const event = await collector.waitFor((m) => m.topic === 'wms/stock/corrected');
      expect(StockCorrectedEvent.parse(event.body).payload).toMatchObject({ barcode: 'T-PAR', delta: { amount: '-10.5' }, onHand: { amount: '39.5' }, reason: 'Bruch' });

      expect(await correct('-39.5')).toMatchObject({ status: 200, body: { onHand: { amount: '0' }, removed: true } });
      expect(await stockOn('T-PAR')).toEqual([]);
      const journal = (await api.get('/v1/stock-bookings?barcode=T-PAR')).body.items;
      expect(journal.slice(0, 2).map((b: { type: string; quantity: { amount: string } }) => [b.type, b.quantity.amount])).toEqual([
        ['CORRECTION', '-39.5'],
        ['CORRECTION', '-10.5'],
      ]);
      expect((await api.delete('/v1/transport-units/T-PAR')).status).toBe(204);
    });
  });

  it('beschreibt die Endpunkte in OpenAPI', async () => {
    const paths = Object.keys(((await api.get('/openapi.json')).body as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/v1/products',
        '/v1/stock',
        '/v1/stock-bookings',
        '/v1/stock/{id}/corrections',
        '/v1/receiving-orders',
        '/v1/receiving-orders/{orderId}/captures',
        '/v1/receiving-orders/{orderId}/positions/{posNo}/close',
        '/v1/receiving-blind-captures',
      ]),
    );
  });
});
