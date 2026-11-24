import type { INestApplication } from '@nestjs/common';
import { StockTransferredEvent } from '@wms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

/**
 * Bestandsführung.
 *
 *   LAGER › REGAL-A  A1, A2      LAGER › REGAL-B  B1        (je 50 TUs)
 * Produkte: SCHRAUBE in PCS (1 KAR = 12 PCS, 1 PAL = 480 PCS), MEHL in KG (1 SACK = 25 KG).
 * Bestand entsteht über Blind-Erfassungen im Wareneingang.
 */
describe('Bestandsführung', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  const loc: Record<string, string> = {};

  const receive = (barcode: string, sku: string, amount: string, unit: string, extra: Record<string, unknown> = {}, at = 'A1') =>
    api.post('/v1/receiving-blind-captures', { sku, quantity: { amount, unit }, unit: { barcode, typeCode: 'EURO' }, location: { erpCode: at }, ...extra });
  const itemsOn = async (barcode: string) => (await api.get(`/v1/stock?barcode=${barcode}`)).body.items;
  const itemOn = async (barcode: string, sku?: string) => (await itemsOn(barcode)).find((i: { sku: string }) => !sku || i.sku === sku);
  const post = (id: string, action: string, body: unknown) => api.post(`/v1/stock/${id}/${action}`, body);

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);

    await api.post('/v1/location-types', { code: 'REGAL' });
    await api.post('/v1/location-groups', { name: 'LAGER' });
    for (const name of ['REGAL-A', 'REGAL-B']) await api.post('/v1/location-groups', { name, parentName: 'LAGER' });
    for (const [name, groupName] of [
      ['A1', 'REGAL-A'],
      ['A2', 'REGAL-A'],
      ['B1', 'REGAL-B'],
    ] as const) {
      const r = await api.post('/v1/locations', { locationId: `S${name}/0001/0001/0001/0000`, erpCode: name, groupName, typeCode: 'REGAL', maxTransportUnits: 50 });
      loc[name] = r.body.id;
    }
    await api.post('/v1/transport-unit-types', { code: 'EURO' });
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  describe('Produkte und Einheiten', () => {
    it('legt Produkte mit alternativen Einheiten an und prüft sie', async () => {
      const r = await api.post('/v1/products', { sku: 'SCHRAUBE', baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '12' }, { unit: 'PAL', factor: '480' }] });
      expect(r.status).toBe(201);
      expect(r.body.units).toEqual([{ unit: 'KAR', factor: '12' }, { unit: 'PAL', factor: '480' }]);
      expect(await api.post('/v1/products', { sku: 'X1', baseUnit: 'PCS', units: [{ unit: 'PCS', factor: '2' }] })).toMatchObject({ status: 400, body: { code: 'UNIT_CONFLICT' } });
      expect(await api.post('/v1/products', { sku: 'X2', baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '0' }] })).toMatchObject({ status: 400 });
      expect((await api.post('/v1/products', { sku: 'MEHL', baseUnit: 'KG' })).status).toBe(201);
      expect((await api.put('/v1/products/MEHL/units', { units: [{ unit: 'SACK', factor: '25' }] })).body.units).toEqual([{ unit: 'SACK', factor: '25' }]);
    });

    it('liest Produkte einzeln und als Liste', async () => {
      expect((await api.get('/v1/products/SCHRAUBE')).body).toMatchObject({ sku: 'SCHRAUBE', baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '12' }, { unit: 'PAL', factor: '480' }] });
      expect(await api.get('/v1/products/GIBT-ES-NICHT')).toMatchObject({ status: 404 });
      const list = (await api.get('/v1/products?limit=1')).body;
      expect(list.items).toHaveLength(1);
      expect(list.total).toBeGreaterThanOrEqual(2);
      expect((await api.get('/v1/products?limit=1000')).body.items.map((p: { sku: string }) => p.sku)).toEqual(expect.arrayContaining(['SCHRAUBE', 'MEHL']));
    });
  });

  describe('Abgang und Korrektur', () => {
    it('bucht einen Abgang in einer alternativen Einheit um', async () => {
      expect((await receive('S1', 'SCHRAUBE', '100', 'PCS')).status).toBe(201);
      const item = await itemOn('S1');
      const r = await post(item.id, 'issues', { quantity: { amount: '2', unit: 'KAR' }, reference: 'AUF-1' });
      expect(r).toMatchObject({ status: 200, body: { onHand: { amount: '76', unit: 'PCS' }, removed: false } });
      const [booking] = (await api.get('/v1/stock-bookings?barcode=S1')).body.items;
      expect(booking).toMatchObject({ type: 'ISSUE', quantity: { amount: '-24', unit: 'PCS' }, reference: 'AUF-1' });
    });

    it('lehnt unbekannte Einheiten, zu viel und unzulässige Genauigkeit ab', async () => {
      const item = await itemOn('S1');
      expect(await post(item.id, 'issues', { quantity: { amount: '1', unit: 'KG' }, reference: 'x' })).toMatchObject({
        status: 409,
        body: { code: 'UNIT_MISMATCH', details: { units: ['KAR', 'PAL'] } },
      });
      expect(await post(item.id, 'issues', { quantity: { amount: '77', unit: 'PCS' }, reference: 'x' })).toMatchObject({ status: 409, body: { code: 'STOCK_INSUFFICIENT' } });
      expect(await post(item.id, 'issues', { quantity: { amount: '-1', unit: 'PCS' }, reference: 'x' })).toMatchObject({ status: 409, body: { code: 'INVALID_QUANTITY' } });
      expect(await post(item.id, 'issues', { quantity: { amount: '0.0001', unit: 'KAR' }, reference: 'x' })).toMatchObject({ status: 409, body: { code: 'INVALID_QUANTITY' } });
    });

    it('entfernt den Posten, wenn der Abgang alles verbraucht', async () => {
      await receive('S2', 'MEHL', '50', 'KG');
      const item = await itemOn('S2');
      expect((await post(item.id, 'issues', { quantity: { amount: '2', unit: 'SACK' }, reference: 'AUF-2' })).body).toMatchObject({ onHand: { amount: '0' }, removed: true });
      expect(await itemsOn('S2')).toEqual([]);
    });

    it('korrigiert in alternativer Einheit, negativ und positiv', async () => {
      const item = await itemOn('S1');
      expect((await post(item.id, 'corrections', { delta: { amount: '-1', unit: 'KAR' }, reason: 'Bruch' })).body.onHand).toMatchObject({ amount: '64' });
      expect((await post(item.id, 'corrections', { delta: { amount: '4', unit: 'PCS' }, reason: 'Fund' })).body.onHand).toMatchObject({ amount: '68' });
    });
  });

  describe('Reservierung', () => {
    let item: { id: string };
    let reservation: string;

    it('reserviert verfügbaren Bestand und schützt ihn vor Abgang, Umbuchung und Korrektur', async () => {
      item = await itemOn('S1');
      const r = await post(item.id, 'reservations', { quantity: { amount: '5', unit: 'KAR' }, reference: 'KOMM-1' });
      expect(r).toMatchObject({ status: 201, body: { quantity: { amount: '60', unit: 'PCS' }, reference: 'KOMM-1', barcode: 'S1' } });
      reservation = r.body.id;
      expect(await itemOn('S1')).toMatchObject({ quantity: { amount: '68' }, reserved: { amount: '60' }, available: { amount: '8' } });
      expect(await post(item.id, 'reservations', { quantity: { amount: '9', unit: 'PCS' }, reference: 'KOMM-2' })).toMatchObject({ status: 409, body: { code: 'STOCK_NOT_AVAILABLE', details: { available: '8' } } });
      expect(await post(item.id, 'issues', { quantity: { amount: '9', unit: 'PCS' }, reference: 'x' })).toMatchObject({ status: 409, body: { code: 'STOCK_RESERVED' } });
      expect(await post(item.id, 'corrections', { delta: { amount: '-9', unit: 'PCS' }, reason: 'x' })).toMatchObject({ status: 409, body: { code: 'STOCK_RESERVED' } });
      await receive('S3', 'SCHRAUBE', '1', 'PCS');
      expect(await post(item.id, 'transfers', { to: 'S3', quantity: { amount: '9', unit: 'PCS' } })).toMatchObject({ status: 409, body: { code: 'STOCK_RESERVED' } });
    });

    it('verbraucht die Reservierung mit einem Abgang', async () => {
      expect(await post(item.id, 'issues', { quantity: { amount: '61', unit: 'PCS' }, reference: 'KOMM-1', reservationId: reservation })).toMatchObject({
        status: 409,
        body: { code: 'EXCEEDS_RESERVATION' },
      });
      expect((await post(item.id, 'issues', { quantity: { amount: '2', unit: 'KAR' }, reference: 'KOMM-1', reservationId: reservation })).body.onHand).toMatchObject({ amount: '44' });
      expect((await api.get('/v1/stock-reservations?reference=KOMM-1')).body.items).toMatchObject([{ quantity: { amount: '36' } }]);
      expect(await itemOn('S1')).toMatchObject({ reserved: { amount: '36' }, available: { amount: '8' } });
    });

    it('hebt eine Reservierung auf', async () => {
      expect((await api.delete(`/v1/stock-reservations/${reservation}`)).status).toBe(204);
      expect(await itemOn('S1')).toMatchObject({ reserved: { amount: '0' }, available: { amount: '44' } });
      expect((await api.delete(`/v1/stock-reservations/${reservation}`)).status).toBe(404);
    });
  });

  describe('Umbuchung', () => {
    it('bucht eine Teilmenge mit Charge und MHD auf eine andere TU und führt dort zusammen', async () => {
      await receive('U1', 'MEHL', '100', 'KG', { lot: 'L7', bestBefore: '2027-03-01' });
      await receive('U2', 'MEHL', '10', 'KG', { lot: 'L7', bestBefore: '2027-03-01' }, 'B1');
      const from = await itemOn('U1');
      const r = await post(from.id, 'transfers', { to: 'U2', quantity: { amount: '1', unit: 'SACK' }, reference: 'UMPACK-1' });
      expect(r).toMatchObject({ status: 200, body: { from: { onHand: { amount: '75' }, removed: false }, to: { onHand: { amount: '35' } } } });
      expect(await itemsOn('U2')).toMatchObject([{ quantity: { amount: '35' }, lot: 'L7', bestBefore: '2027-03-01' }]);
      const event = await collector.waitFor((m) => m.topic === 'wms/stock/transferred' && (m.body as { payload: { reference: string } }).payload.reference === 'UMPACK-1');
      expect(StockTransferredEvent.parse(event.body).payload).toMatchObject({ from: 'U1', to: 'U2', quantity: { amount: '25', unit: 'KG' }, lot: 'L7' });
      const types = (await api.get('/v1/stock-bookings?reference=UMPACK-1')).body.items.map((b: { type: string; barcode: string }) => `${b.type}:${b.barcode}`).sort();
      expect(types).toEqual(['TRANSFER_IN:U2', 'TRANSFER_OUT:U1']);
      expect(await post(from.id, 'transfers', { to: 'U1', quantity: { amount: '1', unit: 'KG' } })).toMatchObject({ status: 409, body: { code: 'SAME_UNIT' } });
      expect(await post(from.id, 'transfers', { to: 'NOPE', quantity: { amount: '1', unit: 'KG' } })).toMatchObject({ status: 404 });
    });

    it('legt auf einer leeren TU einen neuen Posten an und entfernt den leeren', async () => {
      await api.post('/v1/transport-units', { barcode: 'LEER', typeCode: 'EURO', location: { erpCode: 'A2' } });
      const from = await itemOn('U2');
      const r = await post(from.id, 'transfers', { to: 'LEER', quantity: { amount: '35', unit: 'KG' } });
      expect(r.body).toMatchObject({ from: { removed: true }, to: { onHand: { amount: '35' } } });
      expect(await itemsOn('U2')).toEqual([]);
      expect(await itemsOn('LEER')).toMatchObject([{ location: { id: loc['A2'] }, lot: 'L7' }]);
    });
  });

  describe('Abfragen', () => {
    it('filtert nach Gruppe (mit Untergruppen), Platz und Charge', async () => {
      expect((await api.get('/v1/stock?group=REGAL-A')).body.items.every((i: { location: { id: string } }) => i.location.id !== loc['B1'])).toBe(true);
      expect((await api.get(`/v1/stock?location=${loc['A2']}`)).body.items.map((i: { barcode: string }) => i.barcode)).toEqual(['LEER']);
      expect((await api.get('/v1/stock?lot=L7')).body.total).toBe(2);
    });

    it('summiert je Produkt und je Platz', async () => {
      const byProduct = (await api.get('/v1/stock/summary')).body;
      expect(byProduct.items).toEqual([
        { sku: 'MEHL', location: null, onHand: { amount: '110', unit: 'KG' }, reserved: { amount: '0', unit: 'KG' }, available: { amount: '110', unit: 'KG' }, items: 2, units: 2 },
        { sku: 'SCHRAUBE', location: null, onHand: { amount: '45', unit: 'PCS' }, reserved: { amount: '0', unit: 'PCS' }, available: { amount: '45', unit: 'PCS' }, items: 2, units: 2 },
      ]);
      const byLocation = (await api.get('/v1/stock/summary?by=location&sku=MEHL')).body.items;
      expect(byLocation.map((r: { location: { id: string }; onHand: { amount: string } }) => [r.location.id, r.onHand.amount])).toEqual([
        [loc['A1'], '75'],
        [loc['A2'], '35'],
      ]);
      expect((await api.get('/v1/stock/summary?group=REGAL-B')).body).toEqual({ items: [], total: 0 });
    });
  });

  describe('Inventur', () => {
    let number: string;

    it('öffnet eine Inventur mit Soll-Bestand und sperrt die TU', async () => {
      await receive('INV', 'SCHRAUBE', '20', 'PCS', { lot: 'A' });
      await receive('INV', 'SCHRAUBE', '5', 'PCS', { lot: 'B' });
      const r = await api.post('/v1/stock-counts', { barcode: 'INV', reference: 'Jahresinventur' });
      expect(r).toMatchObject({ status: 201, body: { number: expect.stringMatching(/^IN\d{8}$/), state: 'OPEN' } });
      number = r.body.number;
      expect(r.body.lines.map((l: { lot: string; expected: { amount: string }; counted: unknown }) => [l.lot, l.expected.amount, l.counted])).toEqual([
        ['A', '20', null],
        ['B', '5', null],
      ]);
      expect(await receive('INV', 'SCHRAUBE', '1', 'PCS', { lot: 'A' })).toMatchObject({ status: 409, body: { code: 'COUNT_IN_PROGRESS' } });
      const item = await itemOn('INV');
      expect(await post(item.id, 'issues', { quantity: { amount: '1', unit: 'PCS' }, reference: 'x' })).toMatchObject({ status: 409, body: { code: 'COUNT_IN_PROGRESS' } });
      expect(await api.post('/v1/stock-counts', { barcode: 'INV' })).toMatchObject({ status: 409, body: { code: 'COUNT_IN_PROGRESS' } });
      expect(await api.post(`/v1/stock-counts/${number}/close`)).toMatchObject({ status: 409, body: { code: 'COUNT_NOT_COUNTED' } });
    });

    it('erfasst das Zählergebnis mit Differenzen, nicht Gezähltem und Fund', async () => {
      const r = await api.post(`/v1/stock-counts/${number}/result`, {
        countedBy: 'inventur-team',
        lines: [
          { sku: 'SCHRAUBE', lot: 'A', quantity: { amount: '2', unit: 'KAR' } },
          { sku: 'MEHL', quantity: { amount: '3', unit: 'KG' } },
        ],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const lines = r.body.lines.map((l: { sku: string; lot: string | null; counted: { amount: string }; difference: { amount: string } }) => [l.sku, l.lot, l.counted.amount, l.difference.amount]);
      expect(lines).toEqual([
        ['MEHL', null, '3', '3'],
        ['SCHRAUBE', 'A', '24', '4'],
        ['SCHRAUBE', 'B', '0', '-5'],
      ]);
      expect(r.body.state).toBe('COUNTED');
      expect(await api.post(`/v1/stock-counts/${number}/result`, { lines: [{ sku: 'MEHL', quantity: { amount: '1', unit: 'KG' } }, { sku: 'MEHL', quantity: { amount: '1', unit: 'KG' } }] })).toMatchObject({
        status: 400,
        body: { code: 'DUPLICATE_LINE' },
      });
    });

    it('bucht beim Abschluss die Differenzen und hebt die Sperre auf', async () => {
      const r = await api.post(`/v1/stock-counts/${number}/close`);
      expect(r.body.state).toBe('CLOSED');
      const stock = (await itemsOn('INV')).map((i: { sku: string; lot: string | null; quantity: { amount: string } }) => `${i.sku}/${i.lot}:${i.quantity.amount}`).sort();
      expect(stock).toEqual(['MEHL/null:3', 'SCHRAUBE/A:24']);
      const bookings = (await api.get(`/v1/stock-bookings?reference=count:${number}`)).body.items.map((b: { type: string; quantity: { amount: string } }) => `${b.type}:${b.quantity.amount}`).sort();
      expect(bookings).toEqual(['CORRECTION:-5', 'CORRECTION:3', 'CORRECTION:4']);
      expect((await receive('INV', 'SCHRAUBE', '1', 'PCS', { lot: 'A' })).status).toBe(201);
      expect(await api.post(`/v1/stock-counts/${number}/cancel`)).toMatchObject({ status: 409, body: { code: 'COUNT_CLOSED' } });
    });

    it('liest eine abgeschlossene Inventur mit Soll, Ist und Differenz', async () => {
      const r = await api.get(`/v1/stock-counts/${number}`);
      expect(r.body).toMatchObject({ number, barcode: 'INV', state: 'CLOSED' });
      expect(r.body.lines.map((l: { sku: string; difference: { amount: string } }) => `${l.sku}:${l.difference.amount}`).sort()).toEqual(['MEHL:3', 'SCHRAUBE:-5', 'SCHRAUBE:4']);
      expect(await api.get('/v1/stock-counts/IN99999999')).toMatchObject({ status: 404 });
    });

    it('bricht eine Inventur ohne Buchung ab', async () => {
      const r = await api.post('/v1/stock-counts', { barcode: 'INV' });
      expect((await api.post(`/v1/stock-counts/${r.body.number}/cancel`)).body.state).toBe('CANCELLED');
      expect((await api.get(`/v1/stock-counts?barcode=INV&state=CANCELLED`)).body.total).toBe(1);
    });
  });

  describe('Parallelität', () => {
    it('vergibt bei gleichzeitigen Abgängen und Reservierungen nie mehr als vorhanden', async () => {
      await receive('PAR', 'SCHRAUBE', '50', 'PCS');
      const item = await itemOn('PAR');
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          i % 2 ? post(item.id, 'issues', { quantity: { amount: '5', unit: 'PCS' }, reference: `P${i}` }) : post(item.id, 'reservations', { quantity: { amount: '5', unit: 'PCS' }, reference: `P${i}` }),
        ),
      );
      const ok = results.filter((r) => r.status === 200 || r.status === 201).length;
      expect(ok).toBe(10);
      expect(results.filter((r) => r.status === 409).length).toBe(2);
      const after = await itemOn('PAR');
      const issued = results.filter((r, i) => i % 2 === 1 && r.status === 200).length * 5;
      const reserved = results.filter((r, i) => i % 2 === 0 && r.status === 201).length * 5;
      expect(after).toMatchObject({ quantity: { amount: String(50 - issued) }, reserved: { amount: String(reserved) }, available: { amount: '0' } });
    });

    it('verklemmt sich bei gegenläufigen Umbuchungen nicht', async () => {
      await receive('X1', 'MEHL', '100', 'KG');
      await receive('X2', 'MEHL', '100', 'KG');
      const a = await itemOn('X1');
      const b = await itemOn('X2');
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => (i % 2 ? post(a.id, 'transfers', { to: 'X2', quantity: { amount: '1', unit: 'KG' } }) : post(b.id, 'transfers', { to: 'X1', quantity: { amount: '1', unit: 'KG' } }))),
      );
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect([(await itemOn('X1')).quantity.amount, (await itemOn('X2')).quantity.amount]).toEqual(['100', '100']);
    });
  });

  it('beschreibt die Endpunkte in OpenAPI', async () => {
    const paths = Object.keys(((await api.get('/openapi.json')).body as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/v1/stock/summary',
        '/v1/stock/{id}/issues',
        '/v1/stock/{id}/transfers',
        '/v1/stock/{id}/reservations',
        '/v1/stock-reservations/{id}',
        '/v1/products/{sku}/units',
        '/v1/stock-counts',
        '/v1/stock-counts/{number}/close',
      ]),
    );
  });

  it('hinterlässt Buchungsjournal, Änderungsprotokoll und Bestand stimmig', async () => {
    expect((await api.post('/v1/stock-journal/verify', {})).body).toMatchObject({ ok: true, problems: [] });
  });
});
