import { MikroORM } from '@mikro-orm/postgresql';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

type Claimed = { id: string; attempts: number; message: { messageId: string; type: string; data: Record<string, any> } };

/** ERP-Anbindung im kanonischen Format. Alle Daten sind erfunden. */
describe('ERP-Anbindung', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  let orm: MikroORM;

  const inbound = (body: Record<string, unknown>) => api.post('/v1/erp/inbound', body);
  const claim = async (type?: string): Promise<Claimed[]> => (await api.post(type ? `/v1/erp/outbound/claim?type=${type}` : '/v1/erp/outbound/claim')).body.items;
  /** Wartezeit bzw. Abholfrist verstreichen lassen. */
  const due = (id: string) => orm.em.fork().getConnection().execute(`update erp_message set next_attempt_at = now() - interval '1 second', lease_until = now() - interval '1 second' where id = ?`, [id]);
  const ackAll = async () => {
    for (const c of await claim()) await api.post(`/v1/erp/messages/${c.id}/ack`, {});
  };

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test', ERP_EXPORT_ENABLED: 'true', ERP_MAX_ATTEMPTS: '2' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);
    orm = app.get(MikroORM);

    await api.post('/v1/location-types', { code: 'REGAL' });
    for (const name of ['WE', 'LAGER', 'VERSAND']) await api.post('/v1/location-groups', { name });
    for (const [erpCode, groupName] of [['WE-1', 'WE'], ['A1', 'LAGER'], ['VS-1', 'VERSAND']] as const) {
      await api.post('/v1/locations', { locationId: `E${erpCode.replace('-', '')}/0001/0001/0001/0000`, erpCode, groupName, typeCode: 'REGAL', maxTransportUnits: 20 });
    }
    await api.post('/v1/transport-unit-types', { code: 'EURO' });
    const ruleSet = await api.post('/v1/strategy-rule-sets', { decisionPoint: 'allocation', rules: [{ name: 'standard', when: { always: true }, strategy: 'fifo', params: {} }] });
    await api.post(`/v1/strategy-rule-sets/${ruleSet.body.id}/activate`);
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  describe('Eingang', () => {
    it('legt Artikel an und aktualisiert sie; dieselbe Nachrichten-ID wird nur einmal verarbeitet', async () => {
      const first = await inbound({ messageId: 'MAT-1', type: 'product', data: { sku: 'ERP-ART', description: 'Musterartikel', baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '6' }] } });
      expect(first).toMatchObject({ status: 200, body: { duplicate: false, message: { direction: 'IN', state: 'PROCESSED', type: 'product', reference: 'ERP-ART', result: { sku: 'ERP-ART', created: true } } } });
      expect(await inbound({ messageId: 'MAT-1', type: 'product', data: { sku: 'ERP-ART', description: 'anders', baseUnit: 'PCS' } })).toMatchObject({ body: { duplicate: true, message: { id: first.body.message.id } } });
      expect((await api.get('/v1/products/ERP-ART')).body.description).toBe('Musterartikel');

      const update = await inbound({ messageId: 'MAT-2', type: 'product', data: { sku: 'ERP-ART', description: 'Musterartikel neu', baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '12' }] } });
      expect(update.body.message).toMatchObject({ state: 'PROCESSED', result: { created: false } });
      expect((await api.get('/v1/products/ERP-ART')).body).toMatchObject({ description: 'Musterartikel neu', units: [{ unit: 'KAR', factor: '12' }] });
    });

    it('lehnt formal ungültige Nachrichten ab, ohne sie zu protokollieren', async () => {
      expect((await inbound({ messageId: 'X-1', type: 'product', data: { sku: 'OHNE-EINHEIT' } })).status).toBe(400);
      expect((await inbound({ messageId: 'X-2', type: 'unbekannt', data: {} })).status).toBe(400);
      expect((await api.get('/v1/erp/messages?reference=OHNE-EINHEIT')).body.total).toBe(0);
    });

    it('protokolliert fachliche Fehler, meldet sie und verarbeitet nach Korrektur erneut', async () => {
      const avis = { messageId: 'BEST-1', type: 'receiving-order', data: { orderId: 'ERP-WE-1', priority: 'HIGH', details: { bestellung: '4500001' }, positions: [{ sku: 'ERP-NEU', quantity: { amount: '10', unit: 'PCS' } }] } };
      const failed = await inbound(avis);
      expect(failed.body.message).toMatchObject({ state: 'FAILED', reference: 'ERP-WE-1' });
      expect(failed.body.message.lastError).toMatch(/^PRODUCT_NOT_FOUND/);
      const event = await collector.waitFor((m) => m.topic === 'wms/erp-message/failed' && (m.body['payload'] as { messageId: string }).messageId === 'BEST-1');
      expect(event.body['payload']).toMatchObject({ direction: 'IN', type: 'receiving-order', reference: 'ERP-WE-1' });
      expect((await api.get('/v1/erp/messages?state=FAILED&direction=IN')).body.items.map((m: { messageId: string }) => m.messageId)).toEqual(['BEST-1']);
      expect((await api.get(`/v1/erp/messages/${failed.body.message.id}`)).body).toMatchObject({ payload: { messageId: 'BEST-1', type: 'receiving-order' } });

      await inbound({ messageId: 'MAT-3', type: 'product', data: { sku: 'ERP-NEU', baseUnit: 'PCS' } });
      const retried = await api.post(`/v1/erp/messages/${failed.body.message.id}/retry`);
      expect(retried.body).toMatchObject({ state: 'PROCESSED', attempts: 2, lastError: null });
      expect((await api.get('/v1/receiving-orders/ERP-WE-1')).body).toMatchObject({ priority: 'HIGH', details: { bestellung: '4500001' } });
      expect((await api.post(`/v1/erp/messages/${failed.body.message.id}/retry`)).body.code).toBe('ERP_NOT_FAILED');
    });

    it('legt Auslageraufträge mit Packplatz an und storniert Aufträge auf Anweisung', async () => {
      const created = await inbound({ messageId: 'AUF-1', type: 'outbound-order', data: { orderId: 'ERP-AUF-1', customer: 'Musterkunde', target: 'VS-1', shipTo: { name: 'Musterkunde GmbH', city: 'Musterstadt' }, lines: [{ sku: 'ERP-ART', quantity: { amount: '1', unit: 'KAR' } }] } });
      expect(created.body.message.state).toBe('PROCESSED');
      expect((await api.get('/v1/outbound-orders/ERP-AUF-1')).body).toMatchObject({ target: { locationId: 'EVS1/0001/0001/0001/0000' }, shipTo: { name: 'Musterkunde GmbH' }, lines: [{ quantity: { amount: '12', unit: 'PCS' } }] });
      const avis = await inbound({ messageId: 'BEST-2', type: 'receiving-order', data: { orderId: 'ERP-WE-2', positions: [{ sku: 'ERP-ART', quantity: { amount: '5', unit: 'PCS' } }] } });
      expect(avis.body.message.state).toBe('PROCESSED');
      expect((await inbound({ messageId: 'BEST-2-STORNO', type: 'receiving-order', action: 'cancel', data: { orderId: 'ERP-WE-2' } })).body.message).toMatchObject({ state: 'PROCESSED', result: { cancelled: true } });
      expect((await api.get('/v1/receiving-orders/ERP-WE-2')).body.state).toBe('CANCELLED');
    });
  });

  describe('Ausgang', () => {
    it('meldet den Wareneingang, liefert ihn einmal aus und bestätigt die Zustellung', async () => {
      await ackAll();
      const capture = await api.post('/v1/receiving-orders/ERP-WE-1/captures', { kind: 'quantity', sku: 'ERP-NEU', quantity: { amount: '10', unit: 'PCS' }, unit: { barcode: 'E-T1', typeCode: 'EURO' }, location: { erpCode: 'WE-1' } });
      expect(capture.status).toBe(201);
      const [receipt, ...rest] = await claim();
      expect(rest).toEqual([]);
      expect(receipt!.message).toMatchObject({ type: 'goods-receipt', data: { orderId: 'ERP-WE-1', posNo: 1, sku: 'ERP-NEU', quantity: { amount: '10', unit: 'PCS' }, barcode: 'E-T1', blind: false } });
      expect(receipt!.message.messageId).toBe(receipt!.id);
      expect(await claim()).toEqual([]);
      expect((await api.post(`/v1/erp/messages/${receipt!.id}/ack`, { erpReference: '5000000001' })).body).toMatchObject({ state: 'SENT', result: { erpReference: '5000000001' } });
      const sent = await collector.waitFor((m) => m.topic === 'wms/erp-message/sent' && (m.body['payload'] as { id: string }).id === receipt!.id);
      expect(sent.body['payload']).toMatchObject({ type: 'goods-receipt', reference: 'ERP-WE-1', erpReference: '5000000001' });
      expect((await api.post(`/v1/erp/messages/${receipt!.id}/ack`, {})).body.state).toBe('SENT');
    });

    it('meldet Warenausgang am Pick und Bestandskorrekturen', async () => {
      await api.post('/v1/receiving-blind-captures', { sku: 'ERP-ART', quantity: { amount: '30', unit: 'PCS' }, unit: { barcode: 'E-T2', typeCode: 'EURO' }, location: { erpCode: 'A1' } });
      await ackAll();
      const allocated = await api.post('/v1/outbound-orders/ERP-AUF-1/allocate', { transport: 'none' });
      await api.post(`/v1/outbound-orders/ERP-AUF-1/picks/${allocated.body.picks[0].id}/confirm`, {});
      const item = (await api.get('/v1/stock?barcode=E-T2')).body.items[0];
      await api.post(`/v1/stock/${item.id}/corrections`, { delta: { amount: '-2', unit: 'PCS' }, reason: 'Bruch' });
      const messages = await claim();
      expect(messages.map((m) => m.message.type)).toEqual(['goods-issue', 'stock-change']);
      expect(messages[0]!.message.data).toMatchObject({ orderId: 'ERP-AUF-1', shipment: null, lines: [{ sku: 'ERP-ART', quantity: { amount: '12', unit: 'PCS' }, barcode: 'E-T2' }] });
      expect(messages[1]!.message.data).toMatchObject({ sku: 'ERP-ART', barcode: 'E-T2', delta: { amount: '-2', unit: 'PCS' }, reason: 'Bruch' });
      for (const m of messages) await api.post(`/v1/erp/messages/${m.id}/ack`, {});
    });

    it('stellt einen Bestandsabgleich je Artikel und Charge bereit', async () => {
      const snapshot = await api.post('/v1/erp/stock-snapshots');
      expect(snapshot).toMatchObject({ status: 201, body: { direction: 'OUT', type: 'stock-snapshot', state: 'PENDING' } });
      const [claimed] = await claim('stock-snapshot');
      expect(claimed!.message.data['items']).toEqual([
        { sku: 'ERP-ART', lot: null, quantity: { amount: '16', unit: 'PCS' } },
        { sku: 'ERP-NEU', lot: null, quantity: { amount: '10', unit: 'PCS' } },
      ]);
      await api.post(`/v1/erp/messages/${claimed!.id}/ack`, {});
    });

    it('wiederholt nach Fehlschlag mit Wartezeit, gibt nach zu vielen Versuchen auf und lässt sich erneut anstoßen', async () => {
      const snapshot = (await api.post('/v1/erp/stock-snapshots')).body;
      let [c] = await claim();
      const nacked = await api.post(`/v1/erp/messages/${c!.id}/nack`, { error: 'ERP nicht erreichbar' });
      expect(nacked.body).toMatchObject({ state: 'PENDING', attempts: 1, lastError: 'ERP nicht erreichbar' });
      expect(new Date(nacked.body.nextAttemptAt).getTime()).toBeGreaterThan(Date.now() + 20_000);
      expect(await claim()).toEqual([]);

      await due(snapshot.id);
      [c] = await claim();
      expect(c!.id).toBe(snapshot.id);
      expect((await api.post(`/v1/erp/messages/${c!.id}/nack`, { error: 'ERP lehnt ab' })).body).toMatchObject({ state: 'FAILED', attempts: 2 });
      const event = await collector.waitFor((m) => m.topic === 'wms/erp-message/failed' && (m.body['payload'] as { id: string }).id === snapshot.id);
      expect(event.body['payload']).toMatchObject({ direction: 'OUT', type: 'stock-snapshot', error: 'ERP lehnt ab' });
      expect(await claim()).toEqual([]);

      expect((await api.post(`/v1/erp/messages/${snapshot.id}/retry`)).body).toMatchObject({ state: 'PENDING', attempts: 0 });
      [c] = await claim();
      expect(c!.id).toBe(snapshot.id);
      await api.post(`/v1/erp/messages/${c!.id}/ack`, {});
    });

    it('liefert abgeholte, aber nicht quittierte Nachrichten nach Ablauf der Frist erneut aus', async () => {
      const snapshot = (await api.post('/v1/erp/stock-snapshots')).body;
      expect((await claim()).map((c) => c.id)).toEqual([snapshot.id]);
      expect(await claim()).toEqual([]);
      await due(snapshot.id);
      const [again] = await claim();
      expect(again).toMatchObject({ id: snapshot.id, attempts: 1 });
      expect((await api.post(`/v1/erp/messages/${snapshot.id}/nack`, { error: 'x' })).status).toBe(200);
      expect((await api.post(`/v1/erp/messages/${snapshot.id}/ack`, {})).body.code).toBe('ERP_NOT_IN_DELIVERY');
    });

    it('zählt Nachrichten je Richtung und Zustand', async () => {
      const counts = (await api.get('/v1/erp/counts')).body.items as { direction: string; state: string; count: number }[];
      expect(counts).toEqual(expect.arrayContaining([expect.objectContaining({ direction: 'IN', state: 'PROCESSED' }), expect.objectContaining({ direction: 'OUT', state: 'SENT' })]));
    });
  });
});
