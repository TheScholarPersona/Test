import { EntityManager } from '@mikro-orm/postgresql';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { verifyMerkleProof } from '../../src/modules/inventory/domain/journal-chain.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { startEnvironment, type TestEnvironment } from './support/environment.js';

/**
 * Buchungsjournal als Hash-Kette mit Merkle-Wurzel je Tag. Die Manipulationen am Ende gehen direkt an die Datenbank –
 * so, wie es ein Angreifer mit Datenbankzugriff täte. Alle Daten sind erfunden.
 */
describe('Buchungsjournal mit Hash-Kette', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let sql: (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  const today = new Date().toISOString().slice(0, 10);
  const verify = async (body: Record<string, unknown> = {}) => (await api.post('/v1/stock-journal/verify', body)).body;
  const issue = async (barcode: string, amount: string) => {
    const [item] = (await api.get(`/v1/stock?barcode=${barcode}`)).body.items;
    return api.post(`/v1/stock/${item.id}/issues`, { quantity: { amount, unit: 'PCS' }, reference: 'TEST' });
  };

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);
    sql = (query, params = []) => app.get(EntityManager).fork().execute(query, params);

    await api.post('/v1/location-types', { code: 'REGAL' });
    await api.post('/v1/location-groups', { name: 'LAGER' });
    await api.post('/v1/locations', { locationId: 'SJ01/0001/0001/0001/0000', erpCode: 'J1', groupName: 'LAGER', typeCode: 'REGAL', maxTransportUnits: 50 });
    await api.post('/v1/transport-unit-types', { code: 'EURO' });
    await api.post('/v1/products', { sku: 'ART', baseUnit: 'PCS' });
    for (const barcode of ['J-1', 'J-2']) {
      expect((await api.post('/v1/receiving-blind-captures', { sku: 'ART', quantity: { amount: '100', unit: 'PCS' }, unit: { barcode, typeCode: 'EURO' }, location: { erpCode: 'J1' } })).status).toBe(201);
    }
  });

  afterAll(async () => {
    await app?.close();
    await env?.stop();
  });

  it('verkettet jede Buchung beim Commit lückenlos, auch bei gleichzeitigen Buchungen', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => issue(i % 2 ? 'J-1' : 'J-2', '1')));
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(200));
    const journal = (await api.get('/v1/stock-bookings?limit=100')).body.items as { seq: number; hash: string }[];
    const seqs = journal.map((b) => b.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(journal.every((b) => /^[0-9a-f]{64}$/.test(b.hash))).toBe(true);

    const result = await verify();
    expect(result).toMatchObject({ ok: true, checked: 14, pending: 0, problems: [] });
    expect((await api.get('/v1/stock-journal/head')).body).toMatchObject({ seq: 14, hash: journal.find((b) => b.seq === 14)!.hash });
  });

  it('belegt eine einzelne Buchung per Merkle-Beweis gegen die Tageswurzel', async () => {
    const [latest] = (await api.get('/v1/stock-bookings?limit=1')).body.items;
    const proof = (await api.get(`/v1/stock-bookings/${latest.id}/proof`)).body;
    const day = (await api.get(`/v1/stock-journal/days/${today}`)).body;
    expect(day).toMatchObject({ day: today, count: 14, firstSeq: 1, lastSeq: 14, root: proof.root });
    expect(proof).toMatchObject({ seq: latest.seq, hash: latest.hash, size: 14 });
    expect(proof.proof.length).toBeLessThanOrEqual(4);
    expect(verifyMerkleProof(proof.hash, proof.index, proof.size, proof.proof, day.root)).toBe(true);
    expect(verifyMerkleProof(proof.hash, proof.index, proof.size, proof.proof, '0'.repeat(64))).toBe(false);
    expect((await api.get('/v1/stock-bookings/00000000-0000-0000-0000-000000000000/proof')).body.code).toBe('BOOKING_NOT_FOUND');
  });

  it('lässt verkettete Buchungen weder ändern noch löschen', async () => {
    await expect(sql(`update "stock_booking" set "quantity" = -50 where "seq" = 3`)).rejects.toThrow(/JOURNAL_IMMUTABLE/);
    await expect(sql(`delete from "stock_booking" where "seq" = 3`)).rejects.toThrow(/JOURNAL_IMMUTABLE/);
  });

  it('erkennt Änderung, Löschung und eine neu berechnete Kette am verankerten Stand', async () => {
    // Verankern: Kopf und Tageswurzel liegen außerhalb des WMS (Sicherung, ERP).
    const anchor = (({ seq, hash }) => ({ seq, hash }))((await api.get('/v1/stock-journal/head')).body);
    const days = [{ day: today, root: (await api.get(`/v1/stock-journal/days/${today}`)).body.root }];
    expect(await verify({ anchor, days })).toMatchObject({ ok: true, anchor: { ok: true }, days: [{ ok: true }] });

    // Angreifer mit Datenbankrechten schaltet den Schutz ab und ändert eine Buchung.
    await sql(`alter table "stock_booking" disable trigger "stock_booking_guard"`);
    await sql(`update "stock_booking" set "quantity" = -50 where "seq" = 5`);
    const changed = await verify({ anchor, days });
    expect(changed.ok).toBe(false);
    // Der gespeicherte Hash stimmt nicht mehr mit dem Inhalt überein (Tageswurzel und Anker beruhen auf den Hashes).
    expect(changed.problems).toEqual([expect.objectContaining({ code: 'CHAIN_HASH_MISMATCH', seq: 5 })]);

    // … löscht eine Buchung
    await sql(`delete from "stock_booking" where "seq" = 8`);
    expect((await verify()).problems.map((p: { code: string; seq: number }) => `${p.code}:${p.seq}`)).toEqual(
      expect.arrayContaining(['CHAIN_GAP:9', 'CHAIN_LINK_BROKEN:9', 'CHAIN_HASH_MISMATCH:5']),
    );

    // … und rechnet die ganze Kette neu: in sich stimmig, aber nicht mehr der verankerte Stand.
    await sql(`update "stock_booking" set "seq" = null, "prev_hash" = null, "hash" = null`);
    await sql(`update "journal_head" set "seq" = 0, "hash" = repeat('0', 64)`);
    await sql(`do $$ declare r stock_booking; begin for r in select * from "stock_booking" order by "created_at", "id" loop perform wms_journal_append(r); end loop; end $$`);
    const rewritten = await verify({ anchor, days });
    expect(rewritten.problems.map((p: { code: string }) => p.code).sort()).toEqual(['ANCHOR_MISMATCH', 'DAY_ROOT_MISMATCH']);
    await sql(`alter table "stock_booking" enable trigger "stock_booking_guard"`);
  });
});
