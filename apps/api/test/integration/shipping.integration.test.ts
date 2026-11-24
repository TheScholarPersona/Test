import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';
import { fetchPdf, pdfText } from './support/pdf.js';

/**
 * Packen am Packplatz, Sendungen mit Ladekontrolle und Warenausgang. Alle Daten sind erfunden.
 *
 *   LAGER  A1 – S1: 10 PCS ART           PACKPLATZ  P1 – S3: 6 PCS ART2 (ganze Palette), V-1/V-2 leer
 *   Auftrag AUF-1: 4 PCS ART → P1, Kunde K-1   Auftrag AUF-2: 6 PCS ART2 → P1   Auftrag AUF-3: ohne Ziel
 *   Nach der Zuteilung: S4 (2 PCS ART2) und S5 (3 PCS ART) auf P1 für Ladekontrolle und Sperren beim Warenausgang
 */
describe('Versand', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  const picks: Record<string, string> = {};
  let sh1 = '';
  let baseUrl = '';

  const stock = async (barcode: string) => ((await api.get(`/v1/stock?barcode=${barcode}`)).body.items as { sku: string; quantity: { amount: string }; reserved: { amount: string } }[]).map((i) => `${i.sku}:${i.quantity.amount}/${i.reserved.amount}`);
  const confirm = (orderId: string, body: Record<string, unknown>) => api.post(`/v1/outbound-orders/${orderId}/picks/${picks[orderId]}/confirm`, body);

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);
    baseUrl = started.baseUrl;

    await api.post('/v1/location-types', { code: 'REGAL' });
    for (const name of ['LAGER', 'PACK']) await api.post('/v1/location-groups', { name });
    for (const [name, groupName] of [['A1', 'LAGER'], ['P1', 'PACK']] as const) {
      await api.post('/v1/locations', { locationId: `S${name}/0001/0001/0001/0000`, erpCode: name, groupName, typeCode: 'REGAL', maxTransportUnits: 20 });
    }
    await api.post('/v1/transport-unit-types', { code: 'EURO' });
    for (const sku of ['ART', 'ART2']) await api.post('/v1/products', { sku, baseUnit: 'PCS', description: `Musterartikel ${sku}` });
    for (const [barcode, sku, amount, at] of [['S1', 'ART', '10', 'A1'], ['S3', 'ART2', '6', 'P1']] as const) {
      expect((await api.post('/v1/receiving-blind-captures', { sku, quantity: { amount, unit: 'PCS' }, unit: { barcode, typeCode: 'EURO' }, location: { erpCode: at } })).status).toBe(201);
    }
    for (const [barcode, at] of [['V-1', 'P1'], ['V-2', 'P1'], ['V-X', 'A1']] as const) {
      expect((await api.post('/v1/transport-units', { barcode, typeCode: 'EURO', location: { erpCode: at } })).status).toBe(201);
    }
    const ruleSet = await api.post('/v1/strategy-rule-sets', { decisionPoint: 'allocation', rules: [{ name: 'standard', when: { always: true }, strategy: 'fifo', params: {} }] });
    await api.post(`/v1/strategy-rule-sets/${ruleSet.body.id}/activate`);
    await api.post('/v1/partners', { code: 'K-1', name: 'Musterkunde GmbH', roles: ['CUSTOMER'], address: { street: 'Musterstraße 1', postalCode: '12345', city: 'Musterstadt', country: 'DE' } });
    await api.post('/v1/partners', { code: 'SP-1', name: 'Musterspedition KG', roles: ['CARRIER'] });

    for (const [orderId, sku, amount, extra] of [
      ['AUF-1', 'ART', '4', { target: { erpCode: 'P1' }, customerCode: 'K-1' }],
      ['AUF-2', 'ART2', '6', { target: { erpCode: 'P1' } }],
      ['AUF-3', 'ART', '1', {}],
    ] as const) {
      expect((await api.post('/v1/outbound-orders', { orderId, lines: [{ sku, quantity: { amount, unit: 'PCS' } }], ...extra })).status).toBe(201);
      const allocated = await api.post(`/v1/outbound-orders/${orderId}/allocate`, { transport: 'none' });
      picks[orderId] = allocated.body.picks[0].id;
    }
    for (const [barcode, sku, amount] of [['S4', 'ART2', '2'], ['S5', 'ART', '3']] as const) {
      expect((await api.post('/v1/receiving-blind-captures', { sku, quantity: { amount, unit: 'PCS' }, unit: { barcode, typeCode: 'EURO' }, location: { erpCode: 'P1' } })).status).toBe(201);
    }
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  describe('Packen am Packplatz', () => {
    it('lehnt Versand-TUs außerhalb des Packplatzes und Aufträge ohne Packplatz ab', async () => {
      expect(await confirm('AUF-1', { packInto: 'V-X' })).toMatchObject({ status: 409, body: { code: 'PACK_UNIT_NOT_AT_STATION' } });
      expect(await confirm('AUF-3', { packInto: 'V-1' })).toMatchObject({ status: 409, body: { code: 'PACK_STATION_MISSING' } });
      expect(await stock('S1')).toEqual(['ART:10/5']);
    });

    it('bucht die entnommene Menge aus der Reservierung auf die Versand-TU um', async () => {
      const confirmed = await confirm('AUF-1', { packInto: 'V-1' });
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      expect(confirmed.body.picks[0]).toMatchObject({ state: 'PICKED', packedInto: 'V-1' });
      expect(confirmed.body.state).toBe('COMPLETED');
      expect(await stock('S1')).toEqual(['ART:6/1']);
      expect(await stock('V-1')).toEqual(['ART:4/0']);
      const types = ((await api.get('/v1/stock-bookings?reference=outbound:AUF-1/1')).body.items as { type: string; barcode: string }[]).map((b) => `${b.type}:${b.barcode}`).sort();
      expect(types).toEqual(['TRANSFER_IN:V-1', 'TRANSFER_OUT:S1']);
    });

    it('versendet eine ganze Palette an Ort und Stelle, aber nur vollständig', async () => {
      expect(await confirm('AUF-2', { packInto: 'S3', quantity: { amount: '5', unit: 'PCS' } })).toMatchObject({ status: 409, body: { code: 'PACK_IN_PLACE_PARTIAL' } });
      const confirmed = await confirm('AUF-2', { packInto: 'S3' });
      expect(confirmed.body.picks[0]).toMatchObject({ state: 'PICKED', packedInto: 'S3' });
      expect(await stock('S3')).toEqual(['ART2:6/0']);
    });
  });

  describe('Sendungen und Ladekontrolle', () => {
    it('legt eine Sendung mit Lieferadresse und Spediteur an und prüft die TUs', async () => {
      const created = await api.post('/v1/shipments', { orderId: 'AUF-1', carrierCode: 'SP-1', units: ['V-1'] });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body).toMatchObject({
        orderId: 'AUF-1',
        customerCode: 'K-1',
        carrierCode: 'SP-1',
        state: 'OPEN',
        shipTo: { name: 'Musterkunde GmbH', city: 'Musterstadt' },
        units: [{ barcode: 'V-1', loaded: false, contents: null }],
      });
      sh1 = created.body.number;
      expect(sh1).toMatch(/^SH\d{8}$/);
      await collector.waitFor((m) => m.topic === 'wms/shipment/created' && (m.body['payload'] as { number: string }).number === sh1);

      expect(await api.post(`/v1/shipments/${sh1}/units`, { barcode: 'S1' })).toMatchObject({ status: 409, body: { code: 'UNIT_NOT_AT_STATION' } });
      expect(await api.post(`/v1/shipments/${sh1}/units`, { barcode: 'V-2' })).toMatchObject({ status: 409, body: { code: 'UNIT_EMPTY' } });
      expect(await api.post(`/v1/shipments/${sh1}/units`, { barcode: 'V-1' })).toMatchObject({ status: 409, body: { code: 'UNIT_IN_SHIPMENT' } });
      expect(await api.post('/v1/shipments', { orderId: 'AUF-2', units: ['V-1'] })).toMatchObject({ status: 409, body: { code: 'UNIT_IN_OTHER_SHIPMENT' } });
      expect(await api.post('/v1/shipments', { orderId: 'AUF-1', carrierCode: 'K-1' })).toMatchObject({ status: 409, body: { code: 'PARTNER_ROLE_MISSING' } });
      expect(await api.post('/v1/shipments', { orderId: 'GIBTSNICHT' })).toMatchObject({ status: 404 });
    });

    it('lehnt beim Verladen eine falsche TU ab und ist verladen, wenn alle TUs gescannt sind', async () => {
      expect(await api.post(`/v1/shipments/${sh1}/ship`, {})).toMatchObject({ status: 409, body: { code: 'SHIPMENT_STATE' } });
      expect(await api.post(`/v1/shipments/${sh1}/load`, { barcode: 'S3' })).toMatchObject({ status: 409, body: { code: 'WRONG_UNIT' } });
      const loaded = await api.post(`/v1/shipments/${sh1}/load`, { barcode: 'V-1', loadedBy: 'tor-3' });
      expect(loaded.body).toMatchObject({ state: 'LOADED', counts: { units: 1, loaded: 1 }, units: [{ barcode: 'V-1', loaded: true, loadedBy: 'tor-3' }] });
      await collector.waitFor((m) => m.topic === 'wms/shipment/changed' && (m.body['payload'] as { change: string }).change === 'loaded');
      expect(await api.post(`/v1/shipments/${sh1}/load`, { barcode: 'V-1' })).toMatchObject({ status: 409, body: { code: 'SHIPMENT_STATE' } });
    });

    it('meldet eine doppelt gescannte TU und bleibt offen, bis alle TUs verladen sind', async () => {
      const created = await api.post('/v1/shipments', { orderId: 'AUF-2', units: ['S3', 'S4'] });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const number = created.body.number as string;
      expect((await api.post(`/v1/shipments/${number}/load`, { barcode: 'S3' })).body).toMatchObject({ state: 'OPEN', counts: { units: 2, loaded: 1 } });
      expect(await api.post(`/v1/shipments/${number}/load`, { barcode: 'S3' })).toMatchObject({ status: 409, body: { code: 'UNIT_ALREADY_LOADED' } });
      expect((await api.get(`/v1/shipments/${number}`)).body).toMatchObject({ state: 'OPEN', counts: { units: 2, loaded: 1 } });
      expect((await api.post(`/v1/shipments/${number}/cancel`, {})).body.state).toBe('CANCELLED');
    });
  });

  describe('Warenausgang', () => {
    it('bucht den Bestand aus, löscht die TUs und behält den Inhalt in der Sendung', async () => {
      const shipped = await api.post(`/v1/shipments/${sh1}/ship`, {});
      expect(shipped.status, JSON.stringify(shipped.body)).toBe(200);
      expect(shipped.body).toMatchObject({ state: 'SHIPPED', units: [{ barcode: 'V-1', contents: [{ sku: 'ART', quantity: { amount: '4', unit: 'PCS' }, lot: null }] }] });
      expect(shipped.body.shippedAt).not.toBeNull();
      expect((await api.get('/v1/transport-units/V-1')).status).toBe(404);
      expect(await stock('S1')).toEqual(['ART:6/1']);
      const [booking] = (await api.get(`/v1/stock-bookings?reference=shipment:${sh1}`)).body.items;
      expect(booking).toMatchObject({ type: 'SHIP', barcode: 'V-1', sku: 'ART', quantity: { amount: '-4' } });
      const event = await collector.waitFor((m) => m.topic === 'wms/shipment/shipped');
      expect(event.body['payload']).toMatchObject({ number: sh1, orderId: 'AUF-1', carrierCode: 'SP-1', units: [{ barcode: 'V-1' }] });
      // Historie bleibt lesbar
      expect((await api.get(`/v1/shipments/${sh1}`)).body.units[0].contents).toHaveLength(1);
      expect((await api.post(`/v1/shipments/${sh1}/cancel`, {})).body.code).toBe('SHIPMENT_STATE');
    });

    it('bucht nicht aus, solange Bestand reserviert ist, TUs daraufstehen oder eine Bewegung offen ist', async () => {
      const created = await api.post('/v1/shipments', { orderId: 'AUF-1', units: ['S5'] });
      const number = created.body.number as string;
      expect((await api.post(`/v1/shipments/${number}/load`, { barcode: 'S5' })).body.state).toBe('LOADED');
      const ship = () => api.post(`/v1/shipments/${number}/ship`, {});

      const [item] = (await api.get('/v1/stock?barcode=S5')).body.items;
      const reservation = await api.post(`/v1/stock/${item.id}/reservations`, { quantity: { amount: '1', unit: 'PCS' }, reference: 'TEST-1' });
      expect(reservation.status, JSON.stringify(reservation.body)).toBe(201);
      expect(await ship()).toMatchObject({ status: 409, body: { code: 'STOCK_RESERVED' } });
      expect((await api.delete(`/v1/stock-reservations/${reservation.body.id}`)).status).toBe(204);

      await api.put('/v1/transport-unit-types/EURO/stacking-rules', [{ allowedTypeCode: 'EURO', maxCount: 1 }]);
      expect((await api.post('/v1/transport-units/V-2/stack', { onto: 'S5' })).status).toBe(200);
      expect(await ship()).toMatchObject({ status: 409, body: { code: 'TU_HAS_CHILDREN' } });
      expect((await api.post('/v1/transport-units/V-2/unstack', {})).status).toBe(200);

      const movement = await api.post('/v1/movements', { barcode: 'S5', type: 'RELOCATION', target: { location: { erpCode: 'A1' } } });
      expect(movement.status, JSON.stringify(movement.body)).toBe(201);
      expect(await ship()).toMatchObject({ status: 409, body: { code: 'TU_IN_USE' } });
      expect((await api.post(`/v1/movements/${movement.body.number}/cancel`, {})).status).toBe(200);

      // Nichts wurde gebucht: Sendung verladen, TU und Bestand unverändert
      expect((await api.get(`/v1/shipments/${number}`)).body.state).toBe('LOADED');
      expect(await stock('S5')).toEqual(['ART:3/0']);
      expect((await api.get(`/v1/stock-bookings?reference=shipment:${number}`)).body.items).toEqual([]);
      expect((await api.post(`/v1/shipments/${number}/cancel`, {})).body.state).toBe('CANCELLED');
    });

    it('lässt TUs und Bestand beim Storno stehen und gibt die TU für eine neue Sendung frei', async () => {
      const created = await api.post('/v1/shipments', { orderId: 'AUF-2', units: ['S3'] });
      expect((await api.post(`/v1/shipments/${created.body.number}/cancel`, { reason: 'Spedition kommt morgen' })).body).toMatchObject({ state: 'CANCELLED', cancelReason: 'Spedition kommt morgen' });
      expect(await stock('S3')).toEqual(['ART2:6/0']);
      const again = await api.post('/v1/shipments', { orderId: 'AUF-2', units: ['S3'] });
      expect(again.status).toBe(201);
      expect(((await api.get('/v1/shipments?state=OPEN')).body.items as { number: string }[]).map((s) => s.number)).toEqual([again.body.number]);
      expect((await api.delete(`/v1/shipments/${again.body.number}/units/S3`)).body.units).toEqual([]);
    });
  });
  describe('Dokumente', () => {
    const documents = { get: (path: string) => fetchPdf(baseUrl, path) };
    const text = async (response: ReturnType<typeof fetchPdf>) => {
      const pdf = await response;
      expect(pdf.status, pdf.body.toString('utf8').slice(0, 300)).toBe(200);
      expect(pdf.type).toBe('application/pdf');
      expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
      return pdfText(pdf.body).join('\n');
    };

    it('druckt ein Palettenetikett mit Inhalt', async () => {
      const pdf = await documents.get('/v1/documents/unit-label/S1');
      expect(pdf.disposition).toBe('inline; filename="palettenetikett-S1.pdf"');
      const t = pdfText(pdf.body).join('\n');
      expect(t).toContain('Palettenetikett');
      expect(t).toContain('EURO');
      expect(t).toContain('A1');
      expect(t).toContain('6 PCS');
      expect((await documents.get('/v1/documents/unit-label/GIBTSNICHT')).status).toBe(404);
    });

    it('druckt die Pickliste mit offenen Picks in Platzreihenfolge', async () => {
      const t = await text(documents.get('/v1/documents/pick-list/AUF-3'));
      expect(t).toContain('Pickliste AUF-3');
      expect(t).toContain('SA1/0001/0001/0001/0000');
      expect(t).toContain('Musterartikel ART');
      expect(t).toContain('1 PCS');
    });

    it('druckt Lieferschein, Ladeliste und Versandetiketten einer versendeten Sendung aus der Historie', async () => {
      const note = await text(documents.get(`/v1/documents/delivery-note/${sh1}`));
      for (const expected of ['Lieferschein', 'Musterkunde GmbH', 'Musterstraße 1', '12345 Musterstadt', 'AUF-1', 'Musterspedition KG (SP-1)', 'Musterartikel ART', '4 PCS', 'V-1']) expect(note).toContain(expected);
      expect(note).not.toContain('Hinweis');
      const list = await text(documents.get(`/v1/documents/loading-list/${sh1}`));
      for (const expected of [`Ladeliste ${sh1}`, 'V-1', '(tor-3)', 'SHIPPED']) expect(list).toContain(expected);
      const labels = await text(documents.get(`/v1/documents/shipping-labels/${sh1}`));
      for (const expected of ['Versandetikett', 'Musterkunde GmbH', '1 von 1']) expect(labels).toContain(expected);
      const foreign = await documents.get(`/v1/documents/shipping-labels/${sh1}?unit=S3`);
      expect(foreign.status).toBe(404);
      expect(JSON.parse(foreign.body.toString('utf8'))).toMatchObject({ code: 'UNIT_NOT_IN_SHIPMENT' });
    });

    it('nimmt für offene Sendungen den aktuellen Bestand', async () => {
      const open = await api.post('/v1/shipments', { orderId: 'AUF-2', units: ['S3'] });
      const note = await text(documents.get(`/v1/documents/delivery-note/${open.body.number}`));
      expect(note).toContain('6 PCS');
      expect(note).toContain('Inhalt nach aktuellem Bestand');
      expect(await text(documents.get(`/v1/documents/shipping-labels/${open.body.number}?unit=S3`))).toContain('Spediteur: \n–');
      await api.post(`/v1/shipments/${open.body.number}/cancel`, {});
    });
  });

  it('hinterlässt Buchungsjournal, Änderungsprotokoll und Bestand stimmig', async () => {
    expect((await api.post('/v1/stock-journal/verify', {})).body).toMatchObject({ ok: true, problems: [] });
  });
});
