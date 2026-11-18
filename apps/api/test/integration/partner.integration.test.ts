import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

/** Geschäftspartner und ihre Verwendung an Avis und Auslagerauftrag. Alle Daten sind erfunden. */
describe('Geschäftspartner', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;

  const musterkunde = {
    code: 'K-1000',
    name: 'Musterkunde GmbH',
    roles: ['CUSTOMER'],
    address: { street: 'Musterstraße 1', postalCode: '12345', city: 'Musterstadt', country: 'de' },
    email: 'versand@example.com',
  };
  const outbound = (orderId: string, extra: Record<string, unknown>) => api.post('/v1/outbound-orders', { orderId, lines: [{ sku: 'ART', quantity: { amount: '1', unit: 'PCS' } }], ...extra });
  const receiving = (orderId: string, extra: Record<string, unknown>) => api.post('/v1/receiving-orders', { orderId, positions: [{ kind: 'quantity', sku: 'ART', quantity: { amount: '1', unit: 'PCS' } }], ...extra });

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);
    await api.post('/v1/products', { sku: 'ART', baseUnit: 'PCS' });
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  describe('Stammdaten', () => {
    it('legt Partner mit Rollen und Anschrift an und meldet es', async () => {
      const created = await api.post('/v1/partners', musterkunde);
      expect(created).toMatchObject({
        status: 201,
        body: { code: 'K-1000', name: 'Musterkunde GmbH', roles: ['CUSTOMER'], address: { street: 'Musterstraße 1', postalCode: '12345', city: 'Musterstadt', country: 'DE' }, email: 'versand@example.com', phone: null, active: true },
      });
      const event = await collector.waitFor((m) => m.topic === 'wms/partner/created' && (m.body['payload'] as { code: string }).code === 'K-1000');
      expect(event.body['payload']).toMatchObject({ roles: ['CUSTOMER'], address: { country: 'DE' }, active: true });

      expect(await api.post('/v1/partners', { code: 'L-2000', name: 'Musterlieferant AG', roles: ['SUPPLIER', 'CARRIER'] })).toMatchObject({ status: 201, body: { roles: ['SUPPLIER', 'CARRIER'], address: { street: null, city: null } } });
      expect(await api.post('/v1/partners', { code: 'S-3000', name: 'Musterspedition KG', roles: ['CARRIER'], address: { city: 'Beispielhausen' } })).toMatchObject({ status: 201 });
    });

    it('lehnt doppelte Nummern und ungültige Angaben ab', async () => {
      expect(await api.post('/v1/partners', musterkunde)).toMatchObject({ status: 409, body: { code: 'PARTNER_EXISTS' } });
      expect((await api.post('/v1/partners', { code: 'X', name: 'Ohne Rolle', roles: [] })).status).toBe(400);
      expect((await api.post('/v1/partners', { code: 'X', name: 'Land', roles: ['CUSTOMER'], address: { country: 'DEU' } })).status).toBe(400);
      expect((await api.post('/v1/partners', { code: 'X', name: 'Mail', roles: ['CUSTOMER'], email: 'keine-mail' })).status).toBe(400);
    });

    it('filtert nach Rolle, Aktivität und Suchbegriff', async () => {
      const codes = async (query: string) => ((await api.get(`/v1/partners${query}`)).body.items as { code: string }[]).map((p) => p.code);
      expect(await codes('')).toEqual(['K-1000', 'L-2000', 'S-3000']);
      expect(await codes('?role=CARRIER')).toEqual(['L-2000', 'S-3000']);
      expect(await codes('?q=beispielhausen')).toEqual(['S-3000']);
      expect(await codes('?q=muster')).toEqual(['K-1000', 'L-2000', 'S-3000']);
      expect(await codes('?q=100%25')).toEqual([]);
      expect(await api.get('/v1/partners/GIBTSNICHT')).toMatchObject({ status: 404, body: { code: 'PARTNER_NOT_FOUND' } });
    });

    it('ändert Stammdaten, meldet die geänderten Felder und deaktiviert', async () => {
      const changed = await api.patch('/v1/partners/S-3000', { phone: '+49 000 0000', address: { street: 'Beispielweg 2', city: 'Beispielhausen' }, roles: ['CARRIER', 'CUSTOMER'] });
      expect(changed).toMatchObject({ status: 200, body: { phone: '+49 000 0000', roles: ['CUSTOMER', 'CARRIER'], address: { street: 'Beispielweg 2', city: 'Beispielhausen' } } });
      const event = await collector.waitFor((m) => m.topic === 'wms/partner/changed' && (m.body['payload'] as { code: string }).code === 'S-3000');
      expect((event.body['payload'] as { fields: string[] }).fields.sort()).toEqual(['address.street', 'phone', 'roles']);

      expect(await api.patch('/v1/partners/S-3000', { active: false })).toMatchObject({ status: 200, body: { active: false } });
      expect(((await api.get('/v1/partners?active=true')).body.items as { code: string }[]).map((p) => p.code)).toEqual(['K-1000', 'L-2000']);
      expect((await api.patch('/v1/partners/S-3000', {})).status).toBe(400);
    });
  });

  describe('Verwendung', () => {
    it('übernimmt die Kundenanschrift als Lieferadresse in den Auslagerauftrag', async () => {
      const created = await outbound('A-1', { customerCode: 'K-1000' });
      expect(created).toMatchObject({
        status: 201,
        body: { customer: 'K-1000', customerCode: 'K-1000', shipTo: { name: 'Musterkunde GmbH', street: 'Musterstraße 1', postalCode: '12345', city: 'Musterstadt', country: 'DE' } },
      });
      // Momentaufnahme: spätere Änderungen am Partner ändern den Auftrag nicht.
      await api.patch('/v1/partners/K-1000', { address: { street: 'Neue Straße 9' } });
      expect((await api.get('/v1/outbound-orders/A-1')).body.shipTo.street).toBe('Musterstraße 1');
    });

    it('lässt einzelne Felder der Lieferadresse überschreiben und Freitext-Kunden weiter zu', async () => {
      const created = await outbound('A-2', { customerCode: 'K-1000', customer: 'FRISCH', shipTo: { street: 'Lagerhof 3', name: null } });
      expect(created.body).toMatchObject({ customer: 'FRISCH', customerCode: 'K-1000', shipTo: { name: null, street: 'Lagerhof 3', city: 'Musterstadt' } });
      expect((await outbound('A-3', { customer: 'Freitext' })).body).toMatchObject({ customer: 'Freitext', customerCode: null, shipTo: null });
    });

    it('verlangt die passende Rolle und einen aktiven Partner', async () => {
      expect(await outbound('A-4', { customerCode: 'L-2000' })).toMatchObject({ status: 409, body: { code: 'PARTNER_ROLE_MISSING' } });
      expect(await outbound('A-4', { customerCode: 'S-3000' })).toMatchObject({ status: 409, body: { code: 'PARTNER_INACTIVE' } });
      expect(await outbound('A-4', { customerCode: 'NIEMAND' })).toMatchObject({ status: 404, body: { code: 'PARTNER_NOT_FOUND' } });
      expect(await receiving('W-X', { supplierCode: 'K-1000' })).toMatchObject({ status: 409, body: { code: 'PARTNER_ROLE_MISSING' } });
    });

    it('verknüpft das Avis mit dem Lieferanten', async () => {
      expect(await receiving('W-1', { supplierCode: 'L-2000' })).toMatchObject({ status: 201, body: { supplier: 'Musterlieferant AG', supplierCode: 'L-2000' } });
      expect((await receiving('W-2', { supplier: 'Lieferant GmbH' })).body).toMatchObject({ supplier: 'Lieferant GmbH', supplierCode: null });
    });
  });
});
