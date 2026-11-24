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
  /** Wie ein Zugriff mit psql: ohne die Kennung der Anwendung, optional mit abgeschalteten Triggern. */
  let outside: (query: string, options?: { bypassTriggers?: boolean }) => Promise<unknown>;
  const codes = (r: { problems: { code: string; chain: string }[] }, chain?: string) => r.problems.filter((p) => !chain || p.chain === chain).map((p) => p.code);
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
    outside = (query, { bypassTriggers = false } = {}) =>
      app
        .get(EntityManager)
        .fork()
        .transactional(async (tx) => {
          await tx.execute(`select set_config('wms.source', '', true)`);
          if (bypassTriggers) await tx.execute(`set local session_replication_role = replica`);
          return tx.execute(query);
        });

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

  it('lässt verkettete Buchungen und Protokolleinträge weder ändern noch löschen', async () => {
    await expect(sql(`update "stock_booking" set "quantity" = -50 where "seq" = 3`)).rejects.toThrow(/JOURNAL_IMMUTABLE/);
    await expect(sql(`delete from "stock_booking" where "seq" = 3`)).rejects.toThrow(/JOURNAL_IMMUTABLE/);
    await expect(sql(`update "change_log" set "op" = 'UPDATE' where "seq" = 1`)).rejects.toThrow(/CHANGE_LOG_IMMUTABLE/);
    await expect(sql(`delete from "change_log" where "seq" = 1`)).rejects.toThrow(/CHANGE_LOG_IMMUTABLE/);
  });

  it('erkennt TUs und Bestand, die an der Anwendung vorbei angelegt, geändert oder gelöscht werden', async () => {
    expect(await verify()).toMatchObject({ ok: true, problems: [] });

    // Direkt angelegte TU: das Änderungsprotokoll hält sie fest, aber ohne Herkunft „api“.
    await outside(`insert into "transport_unit" select (jsonb_populate_record(t, jsonb_build_object('id', gen_random_uuid(), 'barcode', 'J-X'))).* from "transport_unit" t where "barcode" = 'J-1'`);
    const created = await verify();
    expect(created.problems).toEqual([expect.objectContaining({ code: 'CHANGE_OUTSIDE_APP', chain: 'changes', ref: expect.stringMatching(/^transport_unit:/) })]);
    // Nach Prüfung des Vorfalls als bekannt quittieren
    expect(await verify({ acceptedOutsideUpTo: created.problems[0].seq })).toMatchObject({ ok: true });

    // Mit abgeschalteten Triggern eine TU anlegen, Bestand erhöhen und eine TU samt Bestand löschen: kein Protokolleintrag.
    await outside(`insert into "transport_unit" select (jsonb_populate_record(t, jsonb_build_object('id', gen_random_uuid(), 'barcode', 'J-Y'))).* from "transport_unit" t where "barcode" = 'J-1'`, { bypassTriggers: true });
    await outside(`update "stock_item" set "quantity" = "quantity" + 500 where "unit_id" = (select "id" from "transport_unit" where "barcode" = 'J-1')`, { bypassTriggers: true });
    await outside(
      `delete from "stock_item" where "unit_id" = (select "id" from "transport_unit" where "barcode" = 'J-2');
       delete from "transport_unit" where "barcode" = 'J-2'`,
      { bypassTriggers: true },
    );
    const hidden = await verify({ acceptedOutsideUpTo: created.problems[0].seq });
    expect(codes(hidden, 'state').sort()).toEqual(['ROW_CHANGED', 'ROW_MISSING', 'ROW_MISSING', 'ROW_UNLOGGED', 'STOCK_MISMATCH', 'STOCK_MISMATCH']);
    expect(hidden.problems.filter((p: { code: string }) => p.code === 'STOCK_MISMATCH').map((p: { ref: string }) => p.ref.split('/')[0]).sort()).toEqual(['J-1', 'J-2']);
    // Die Ketten selbst sind unberührt – den Eingriff zeigt der Abgleich von Zustand, Protokoll und Buchungen.
    expect(codes(hidden, 'journal')).toEqual([]);
  });

  it('erkennt Änderung, Löschung und eine neu berechnete Kette am verankerten Stand', async () => {
    // Verankern: Kopf und Tageswurzel liegen außerhalb des WMS (Sicherung, ERP).
    const anchor = (({ seq, hash }) => ({ seq, hash }))((await api.get('/v1/stock-journal/head')).body);
    const days = [{ day: today, root: (await api.get(`/v1/stock-journal/days/${today}`)).body.root }];
    expect(await verify({ anchor, days })).toMatchObject({ anchor: { ok: true }, days: [{ ok: true }] });

    // Angreifer mit Datenbankrechten schaltet den Schutz ab und ändert eine Buchung.
    await sql(`alter table "stock_booking" disable trigger "stock_booking_guard"`);
    await sql(`update "stock_booking" set "quantity" = -50 where "seq" = 5`);
    const changed = await verify({ anchor, days });
    expect(changed.ok).toBe(false);
    // Der gespeicherte Hash stimmt nicht mehr mit dem Inhalt überein (Tageswurzel und Anker beruhen auf den Hashes).
    expect(changed.problems.filter((p: { chain: string }) => p.chain === 'journal')).toEqual([expect.objectContaining({ code: 'CHAIN_HASH_MISMATCH', seq: 5 })]);

    // … löscht eine Buchung
    await sql(`delete from "stock_booking" where "seq" = 8`);
    expect((await verify()).problems.filter((p: { chain: string }) => p.chain === 'journal').map((p: { code: string; seq: number }) => `${p.code}:${p.seq}`)).toEqual(
      expect.arrayContaining(['CHAIN_GAP:9', 'CHAIN_LINK_BROKEN:9', 'CHAIN_HASH_MISMATCH:5']),
    );

    // … und rechnet die ganze Kette neu: in sich stimmig, aber nicht mehr der verankerte Stand.
    await sql(`update "stock_booking" set "seq" = null, "prev_hash" = null, "hash" = null`);
    await sql(`update "journal_head" set "seq" = 0, "hash" = repeat('0', 64)`);
    await sql(`do $$ declare r stock_booking; begin for r in select * from "stock_booking" order by "created_at", "id" loop perform wms_journal_append(r); end loop; end $$`);
    const rewritten = await verify({ anchor, days });
    expect(codes(rewritten, 'journal').sort()).toEqual(['ANCHOR_MISMATCH', 'DAY_ROOT_MISMATCH']);
    // Die geänderte und die gelöschte Buchung passen nicht mehr zum Bestand.
    expect(codes(rewritten, 'state')).toContain('STOCK_MISMATCH');
    await sql(`alter table "stock_booking" enable trigger "stock_booking_guard"`);
  });
});
