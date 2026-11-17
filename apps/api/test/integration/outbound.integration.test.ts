import type { INestApplication } from '@nestjs/common';
import { OutboundOrderAllocatedEvent } from '@wms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

/** Datum relativ zu heute (JJJJ-MM-TT), damit die Mindestrestlaufzeit unabhängig vom Testtag ist. */
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Auslagerung.
 *
 *   LAGER  A1 … A4 (je 20 TUs)      VERSAND  V1 (50 TUs)
 * Produkt MILCH in PCS (1 KAR = 6 PCS). Bestand in Zugangsreihenfolge:
 *   M1 20 PCS, MHD +120 Tage (A1)   M2 30 PCS, MHD +60 Tage (A2)
 *   M3 10 PCS, MHD +10 Tage (A3)    M4 15 PCS, ohne MHD (A4)
 * Auslager-Regelsatz: Kunde FRISCH → FEFO mit 30 Tagen Mindestrestlaufzeit, sonst FIFO.
 */
describe('Auslagerung', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  const loc: Record<string, string> = {};

  const order = async (orderId: string) => (await api.get(`/v1/outbound-orders/${orderId}`)).body;
  const create = (orderId: string, amount: string, unit = 'PCS', extra: Record<string, unknown> = {}) =>
    api.post('/v1/outbound-orders', { orderId, lines: [{ sku: 'MILCH', quantity: { amount, unit } }], ...extra });
  const allocate = (orderId: string, transport = 'none') => api.post(`/v1/outbound-orders/${orderId}/allocate`, { transport });
  const confirm = (orderId: string, pickId: string, body: Record<string, unknown> = {}) => api.post(`/v1/outbound-orders/${orderId}/picks/${pickId}/confirm`, body);
  const plan = (picks: { barcode: string; quantity: { amount: string } }[]) => picks.map((p) => `${p.barcode}:${p.quantity.amount}`);
  const stockOf = async (barcode: string) => (await api.get(`/v1/stock?barcode=${barcode}`)).body.items[0];
  const allStock = async () =>
    Object.fromEntries(((await api.get('/v1/stock?sku=MILCH')).body.items as { barcode: string; quantity: { amount: string }; reserved: { amount: string } }[]).map((i) => [i.barcode, `${i.quantity.amount}/${i.reserved.amount}`]));

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);

    await api.post('/v1/location-types', { code: 'REGAL' });
    for (const name of ['LAGER', 'VERSAND']) await api.post('/v1/location-groups', { name });
    for (const [name, groupName, max] of [
      ['A1', 'LAGER', 20],
      ['A2', 'LAGER', 20],
      ['A3', 'LAGER', 20],
      ['A4', 'LAGER', 20],
      ['V1', 'VERSAND', 50],
    ] as const) {
      loc[name] = (await api.post('/v1/locations', { locationId: `O${name}/0001/0001/0001/0000`, erpCode: name, groupName, typeCode: 'REGAL', maxTransportUnits: max })).body.id;
    }
    await api.post('/v1/transport-unit-types', { code: 'EURO' });
    await api.post('/v1/products', { sku: 'MILCH', baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '6' }] });
    for (const [barcode, amount, bestBefore, at] of [
      ['M1', '20', inDays(120), 'A1'],
      ['M2', '30', inDays(60), 'A2'],
      ['M3', '10', inDays(10), 'A3'],
      ['M4', '15', null, 'A4'],
    ] as const) {
      const r = await api.post('/v1/receiving-blind-captures', {
        sku: 'MILCH',
        quantity: { amount, unit: 'PCS' },
        unit: { barcode, typeCode: 'EURO' },
        location: { erpCode: at },
        ...(bestBefore ? { bestBefore } : {}),
      });
      expect(r.status).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 5)); // eindeutige Zugangsreihenfolge
    }
    const ruleSet = await api.post('/v1/strategy-rule-sets', {
      decisionPoint: 'allocation',
      rules: [
        { name: 'frische', when: { field: 'order.customer', op: 'eq', value: 'FRISCH' }, strategy: 'fefo', params: { minRemainingDays: 30 } },
        { name: 'standard', when: { always: true }, strategy: 'fifo', params: {} },
      ],
    });
    expect(ruleSet.status, JSON.stringify(ruleSet.body)).toBe(201);
    await api.post(`/v1/strategy-rule-sets/${ruleSet.body.id}/activate`);
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  describe('Strategien und Simulation', () => {
    it('listet den Entscheidungspunkt mit allen Auslagerstrategien', async () => {
      const point = (await api.get('/v1/strategies')).body.items.find((p: { id: string }) => p.id === 'allocation');
      expect(point.strategies.map((s: { id: string }) => s.id)).toEqual(['fifo', 'fefo', 'lifo', 'partial-first', 'full-unit']);
    });

    it('simuliert mit Begründung, ohne zu reservieren', async () => {
      const fifo = await api.post('/v1/allocation/simulations', { sku: 'MILCH', quantity: { amount: '5', unit: 'KAR' } });
      expect(fifo.status, JSON.stringify(fifo.body)).toBe(200);
      expect(fifo.body).toMatchObject({ requested: { amount: '30' }, allocated: { amount: '30' }, shortfall: { amount: '0' }, decision: { strategy: 'fifo', rule: { name: 'standard' }, simulated: true } });
      expect(fifo.body.plan.map((p: { barcode: string; quantity: string }) => `${p.barcode}:${p.quantity}`)).toEqual(['M1:20', 'M2:10']);

      const fresh = await api.post('/v1/allocation/simulations', { sku: 'MILCH', quantity: { amount: '40', unit: 'PCS' }, customer: 'FRISCH' });
      expect(fresh.body.decision).toMatchObject({ strategy: 'fefo', rule: { name: 'frische' }, summary: { excludedByRule: { REMAINING_SHELF_LIFE: 1 } } });
      expect(fresh.body.plan.map((p: { barcode: string; quantity: string }) => `${p.barcode}:${p.quantity}`)).toEqual(['M2:30', 'M1:10']);
      expect(await allStock()).toEqual({ M1: '20/0', M2: '30/0', M3: '10/0', M4: '15/0' });
    });
  });

  describe('Auftrag, Zuteilung, Pick', () => {
    it('legt einen Auftrag an und prüft Produkt und Nummer', async () => {
      const r = await create('A-1', '4', 'KAR', { customer: 'FRISCH' });
      expect(r).toMatchObject({ status: 201, body: { state: 'CREATED', lines: [{ lineNo: 1, quantity: { amount: '24', unit: 'PCS' }, open: { amount: '24' }, state: 'OPEN' }] } });
      expect(await create('A-1', '1')).toMatchObject({ status: 409, body: { code: 'OUTBOUND_ORDER_EXISTS' } });
      expect(await api.post('/v1/outbound-orders', { orderId: 'X', lines: [{ sku: 'NOPE', quantity: { amount: '1', unit: 'PCS' } }] })).toMatchObject({ status: 404 });
    });

    it('listet Aufträge, neueste zuerst, gefiltert nach Zustand', async () => {
      const list = (await api.get('/v1/outbound-orders?state=CREATED')).body;
      expect(list.items.map((o: { orderId: string }) => o.orderId)).toContain('A-1');
      expect(list.items.every((o: { state: string }) => o.state === 'CREATED')).toBe(true);
      expect((await api.get('/v1/outbound-orders?state=COMPLETED')).body.items.map((o: { orderId: string }) => o.orderId)).not.toContain('A-1');
    });

    it('teilt per FEFO mit Mindestrestlaufzeit zu und reserviert', async () => {
      const r = await allocate('A-1');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toMatchObject({ state: 'ALLOCATED', lines: [{ state: 'ALLOCATED', allocated: { amount: '24' }, open: { amount: '0' } }] });
      expect(plan(r.body.picks)).toEqual(['M2:24']);
      expect(await stockOf('M2')).toMatchObject({ reserved: { amount: '24' }, available: { amount: '6' } });
      const decision = (await api.get(`/v1/strategy-decisions/${r.body.picks[0].decisionId}`)).body;
      expect(decision).toMatchObject({ decisionPoint: 'allocation', subject: 'A-1/1', strategy: 'fefo', assigned: true });
      const event = await collector.waitFor((m) => m.topic === 'wms/outbound-order/allocated' && (m.body as { payload: { orderId: string } }).payload.orderId === 'A-1');
      expect(OutboundOrderAllocatedEvent.parse(event.body).payload).toMatchObject({ state: 'ALLOCATED', shortfalls: [] });
      expect((await allocate('A-1')).body.picks).toHaveLength(1);
    });

    it('bucht bei der Quittung den Abgang und schließt den Auftrag', async () => {
      const pick = (await order('A-1')).picks[0];
      expect((await api.get('/v1/outbound-picks?orderId=A-1')).body.items.map((p: { id: string }) => p.id)).toEqual([pick.id]);
      const r = await confirm('A-1', pick.id, { pickedBy: 'picker-1' });
      expect(r.body).toMatchObject({ state: 'COMPLETED', lines: [{ state: 'PICKED', picked: { amount: '24' } }], picks: [{ state: 'PICKED', pickedBy: 'picker-1' }] });
      expect(await stockOf('M2')).toMatchObject({ quantity: { amount: '6' }, reserved: { amount: '0' } });
      expect((await api.get('/v1/stock-bookings?reference=outbound:A-1/1')).body.items).toMatchObject([{ type: 'ISSUE', quantity: { amount: '-24' }, barcode: 'M2' }]);
      expect(await allocate('A-1')).toMatchObject({ status: 409, body: { code: 'ORDER_CLOSED' } });
    });
  });

  describe('Fehlmengen, Nachzuteilung, Storno', () => {
    it('teilt per FIFO über mehrere Posten zu', async () => {
      await create('B-1', '40');
      const r = await allocate('B-1');
      expect(plan(r.body.picks)).toEqual(['M1:20', 'M2:6', 'M3:10', 'M4:4']);
      expect(await allStock()).toEqual({ M1: '20/20', M2: '6/6', M3: '10/10', M4: '15/4' });
    });

    it('gibt bei einer Fehlmenge den Rest frei und teilt ihn neu zu', async () => {
      const m1 = (await order('B-1')).picks.find((p: { barcode: string }) => p.barcode === 'M1');
      expect(await confirm('B-1', m1.id, { quantity: { amount: '21', unit: 'PCS' } })).toMatchObject({ status: 409, body: { code: 'EXCEEDS_PICK' } });
      const r = await confirm('B-1', m1.id, { quantity: { amount: '2', unit: 'KAR' } });
      expect(r.body).toMatchObject({ state: 'IN_PICKING', lines: [{ state: 'PARTIALLY_ALLOCATED', picked: { amount: '12' }, allocated: { amount: '32' }, open: { amount: '8' } }] });
      expect(r.body.picks.find((p: { id: string }) => p.id === m1.id)).toMatchObject({ state: 'SHORT', picked: { amount: '12' } });
      expect(await stockOf('M1')).toMatchObject({ quantity: { amount: '8' }, reserved: { amount: '0' } });
      // Nachzuteilung nimmt den freigegebenen Rest (FIFO: M1 zuerst).
      const again = await allocate('B-1');
      expect(plan(again.body.picks.filter((p: { state: string }) => p.state === 'OPEN'))).toEqual(['M2:6', 'M3:10', 'M4:4', 'M1:8']);
      expect(again.body.lines[0]).toMatchObject({ state: 'ALLOCATED', open: { amount: '0' } });
    });

    it('verlangt vor dem Abschluss quittierte Picks und gibt beim Storno alles frei', async () => {
      expect(await api.post('/v1/outbound-orders/B-1/complete', {})).toMatchObject({ status: 409, body: { code: 'PICKS_OPEN' } });
      const r = await api.post('/v1/outbound-orders/B-1/cancel', { reason: 'Kunde storniert' });
      expect(r.body).toMatchObject({ state: 'CANCELLED', closeReason: 'Kunde storniert', lines: [{ state: 'CANCELLED', picked: { amount: '12' } }] });
      expect(r.body.picks.filter((p: { state: string }) => p.state === 'OPEN')).toEqual([]);
      expect(await allStock()).toEqual({ M1: '8/0', M2: '6/0', M3: '10/0', M4: '15/0' });
      expect((await api.get('/v1/stock-reservations')).body.total).toBe(0);
    });

    it('teilt bei zu wenig Bestand zu, was geht, und meldet die Fehlmenge', async () => {
      await create('C-1', '100');
      const r = await allocate('C-1');
      expect(r.body).toMatchObject({ state: 'PARTIALLY_ALLOCATED', lines: [{ allocated: { amount: '39' }, open: { amount: '61' } }] });
      const event = await collector.waitFor((m) => m.topic === 'wms/outbound-order/allocated' && (m.body as { payload: { orderId: string } }).payload.orderId === 'C-1');
      expect(OutboundOrderAllocatedEvent.parse(event.body).payload.shortfalls).toEqual([{ lineNo: 1, sku: 'MILCH', missing: { amount: '61', unit: 'PCS' } }]);
      for (const pick of r.body.picks) await confirm('C-1', pick.id, { quantity: { amount: '0', unit: 'PCS' } });
      const done = await api.post('/v1/outbound-orders/C-1/complete', { reason: 'Rest nicht lieferbar' });
      expect(done.body).toMatchObject({ state: 'COMPLETED', lines: [{ state: 'SHORT', picked: { amount: '0' } }] });
      expect(await allStock()).toEqual({ M1: '8/0', M2: '6/0', M3: '10/0', M4: '15/0' });
    });
  });

  describe('Harte Regeln', () => {
    it('nimmt keinen Bestand von gesperrten Plätzen, gesperrten TUs oder aus laufender Inventur', async () => {
      await api.patch(`/v1/locations/${loc['A1']}/locks`, { outbound: true });
      await api.post('/v1/transport-units/M2/state', { state: 'BLOCKED' });
      const count = await api.post('/v1/stock-counts', { barcode: 'M3' });
      const r = await api.post('/v1/allocation/simulations', { sku: 'MILCH', quantity: { amount: '30', unit: 'PCS' } });
      expect(r.body.decision.summary.excludedByRule).toEqual({ SOURCE_OUTBOUND_BLOCKED: 1, UNIT_NOT_AVAILABLE: 1, COUNT_IN_PROGRESS: 1 });
      expect(r.body).toMatchObject({ allocated: { amount: '15' }, shortfall: { amount: '15' } });
      await api.patch(`/v1/locations/${loc['A1']}/locks`, { outbound: false });
      await api.post('/v1/transport-units/M2/state', { state: 'AVAILABLE' });
      await api.post(`/v1/stock-counts/${count.body.number}/cancel`);
    });
  });

  describe('Transport zum Versandplatz', () => {
    it('legt je TU eine Lagerbewegung zum Ziel an', async () => {
      await create('D-1', '10', 'PCS', { target: { erpCode: 'V1' } });
      expect(await allocate('D-1', 'movement')).toMatchObject({ status: 200 });
      const picks = (await order('D-1')).picks;
      expect(picks).toMatchObject([{ barcode: 'M1', movementNumber: expect.stringMatching(/^MV/) }, { barcode: 'M2', movementNumber: expect.stringMatching(/^MV/) }]);
      const movement = (await api.get(`/v1/movements/${picks[0].movementNumber}`)).body;
      expect(movement).toMatchObject({ type: 'OUTBOUND', target: { id: loc['V1'] }, initiator: 'outbound:D-1' });
    });

    it('legt Transportaufträge an und vermerkt belegte TUs', async () => {
      await create('D-2', '20', 'PCS', { target: { erpCode: 'V1' } });
      expect(await allocate('D-2', 'transport-order')).toMatchObject({ status: 200 });
      const picks = (await order('D-2')).picks;
      // M2 (Rest 4) hat noch die Bewegung aus D-1 → Pick ohne Transport mit Vermerk; M3 und M4 bekommen Transportaufträge.
      expect(picks.map((p: { barcode: string; transportOrderNumber: string | null; transportNote: string | null }) => [p.barcode, !!p.transportOrderNumber, p.transportNote?.slice(0, 15) ?? null])).toEqual([
        ['M2', false, 'Kein Transport:'],
        ['M3', true, null],
        ['M4', true, null],
      ]);
      expect(picks[0].transportNote).toContain('offene Lagerbewegung');
      const to = (await api.get(`/v1/transport-orders/${picks[1].transportOrderNumber}`)).body;
      expect(to).toMatchObject({ state: 'STARTED', target: { id: loc['V1'] } });
      expect(await api.post('/v1/outbound-orders/D-1/allocate', { transport: 'movement' })).toMatchObject({ status: 200 });
      expect(await create('D-3', '1', 'PCS')).toMatchObject({ status: 201 });
      expect(await allocate('D-3', 'movement')).toMatchObject({ status: 400, body: { code: 'TARGET_REQUIRED' } });
    });
  });

  describe('Parallelität', () => {
    it('vergibt bei gleichzeitigen Zuteilungen nie mehr als verfügbar', async () => {
      for (const id of ['D-1', 'D-2', 'D-3']) await api.post(`/v1/outbound-orders/${id}/cancel`, {});
      const ids = Array.from({ length: 6 }, (_, i) => `P-${i}`);
      for (const id of ids) await create(id, '9');
      const results = await Promise.all(ids.map((id) => allocate(id)));
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      const allocated = results.reduce((sum, r) => sum + Number(r.body.lines[0].allocated.amount), 0);
      expect(allocated).toBe(39);
      const stock = (await api.get('/v1/stock?sku=MILCH')).body.items as { quantity: { amount: string }; reserved: { amount: string } }[];
      expect(stock.every((i) => Number(i.reserved.amount) <= Number(i.quantity.amount))).toBe(true);
      expect(stock.reduce((s, i) => s + Number(i.reserved.amount), 0)).toBe(39);
    });
  });

  it('beschreibt die Endpunkte in OpenAPI', async () => {
    const paths = Object.keys(((await api.get('/openapi.json')).body as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(
      expect.arrayContaining(['/v1/outbound-orders', '/v1/outbound-orders/{orderId}/allocate', '/v1/outbound-orders/{orderId}/picks/{pickId}/confirm', '/v1/outbound-picks', '/v1/allocation/simulations']),
    );
  });
});
