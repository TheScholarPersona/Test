import type { INestApplication } from '@nestjs/common';
import { PutawayDecidedEvent } from '@wms/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseOptions } from '../../src/database.js';
import { runMigrations } from '../../src/infrastructure/database/migrate.js';
import { configFor, httpClient, startApp } from './support/app.js';
import { MessageCollector, startEnvironment, type TestEnvironment } from './support/environment.js';

/**
 * Strategie-Kern am Beispiel Einlagerung.
 *
 *   LAGER
 *   ├── ZONE-A  A1 (REGAL, 1 TU, sortOrder 1), A2 (REGAL, 1 TU, sortOrder 2)
 *   └── ZONE-B  B1 (BODEN, 2 TUs)
 *   WE          WE (BODEN, 50 TUs) – Wareneingang, Ausgangsplatz aller TUs
 *   PAR         PAR-1, PAR-2 (REGAL, je 1 TU) – für parallele Zuweisungen
 * TU-Typ EURO darf auf REGAL (Vorrang 5) und BODEN (Vorrang 1).
 */
describe('Strategien: Einlagerung', () => {
  let env: TestEnvironment;
  let app: INestApplication;
  let api: ReturnType<typeof httpClient>;
  let collector: MessageCollector;
  const loc: Record<string, string> = {};
  let v1 = '';
  let v2 = '';

  const tu = async (barcode: string, weight?: string) =>
    expect(
      (
        await api.post('/v1/transport-units', {
          barcode,
          typeCode: 'EURO',
          location: { erpCode: 'WE' },
          ...(weight ? { weight: { amount: weight, unit: 'KG' } } : {}),
        })
      ).status,
    ).toBe(201);

  beforeAll(async () => {
    env = await startEnvironment();
    const config = configFor(env, { APP_PROFILE: 'test' });
    await runMigrations(databaseOptions(config));
    collector = await MessageCollector.connect(env.mqttUrl);
    const started = await startApp(config);
    app = started.app;
    api = httpClient(started.baseUrl);

    for (const code of ['REGAL', 'BODEN']) await api.post('/v1/location-types', { code });
    await api.post('/v1/location-groups', { name: 'LAGER' });
    for (const name of ['ZONE-A', 'ZONE-B']) await api.post('/v1/location-groups', { name, parentName: 'LAGER' });
    for (const name of ['WE', 'PAR']) await api.post('/v1/location-groups', { name });
    const places: [string, string, string, number, number][] = [
      ['A1', 'ZONE-A', 'REGAL', 1, 1],
      ['A2', 'ZONE-A', 'REGAL', 1, 2],
      ['B1', 'ZONE-B', 'BODEN', 2, 1],
      ['WE', 'WE', 'BODEN', 50, 1],
      ['PAR-1', 'PAR', 'REGAL', 1, 1],
      ['PAR-2', 'PAR', 'REGAL', 1, 2],
    ];
    for (const [name, groupName, typeCode, maxTransportUnits, sortOrder] of places) {
      const r = await api.post('/v1/locations', {
        locationId: `S${name.replace('-', '')}/0001/0001/0001/0000`,
        erpCode: name,
        groupName,
        typeCode,
        maxTransportUnits,
        sortOrder,
      });
      expect(r.status).toBe(201);
      loc[name] = r.body.id;
    }
    await api.post('/v1/transport-unit-types', { code: 'EURO', tareWeight: { amount: '25', unit: 'KG' } });
    await api.put('/v1/transport-unit-types/EURO/placement-rules', [
      { locationTypeCode: 'REGAL', privilegeLevel: 5 },
      { locationTypeCode: 'BODEN', privilegeLevel: 1 },
    ]);
    for (const barcode of ['P1', 'P2', 'P4', 'P5']) await tu(barcode);
    await tu('P3', '600');
  });

  afterAll(async () => {
    await app?.close();
    await collector?.close();
    await env?.stop();
  });

  it('beschreibt Entscheidungspunkte, Felder und Strategien', async () => {
    const catalog = (await api.get('/v1/strategies')).body;
    const putaway = catalog.items.find((p: { id: string }) => p.id === 'putaway');
    expect(putaway.strategies.map((s: { id: string }) => s.id)).toEqual(['first-free', 'weighted']);
    expect(putaway.fields['unit.weightKg']).toEqual({ type: 'decimal', description: expect.any(String) });
    expect(putaway.strategies[1].paramsSchema.properties.weights).toBeDefined();
  });

  it('verlangt einen aktiven Regelsatz', async () => {
    expect(await api.post('/v1/putaway/decisions', { barcode: 'P1' })).toMatchObject({ status: 409, body: { code: 'NO_ACTIVE_RULE_SET' } });
  });

  it('prüft Regelsätze vollständig beim Speichern', async () => {
    const invalid = await api.post('/v1/strategy-rule-sets', {
      decisionPoint: 'putaway',
      rules: [
        { name: 'a', when: { field: 'unit.farbe', op: 'eq', value: 'rot' }, strategy: 'first-free' },
        { name: 'b', when: { always: true }, strategy: 'zufall' },
        { name: 'c', when: { field: 'unit.weightKg', op: 'gt', value: '1' }, strategy: 'weighted', params: { weights: { privilege: 99 } } },
      ],
    });
    expect(invalid).toMatchObject({ status: 400, body: { code: 'RULE_SET_INVALID' } });
    const errors = invalid.body.details.errors.join('\n');
    expect(errors).toContain('unbekanntes Feld [unit.farbe]');
    expect(errors).toContain('unbekannte Strategie [zufall]');
    expect(errors).toContain('rules[2] (c).params.weights.privilege');
    expect(errors).toContain('Die letzte Regel muss immer greifen');
    expect(await api.post('/v1/strategy-rule-sets', { decisionPoint: 'versand', rules: [{ name: 'x', when: { always: true }, strategy: 'x' }] })).toMatchObject({
      status: 404,
      body: { code: 'DECISION_POINT_NOT_FOUND' },
    });
  });

  it('legt einen Entwurf an und simuliert ihn, ohne etwas zu speichern', async () => {
    const draft = await api.post('/v1/strategy-rule-sets', {
      decisionPoint: 'putaway',
      description: 'Schweres auf den Boden, sonst Zone A',
      rules: [
        { name: 'schwer-auf-boden', when: { field: 'unit.weightKg', op: 'gt', value: '500' }, strategy: 'first-free', params: { group: 'ZONE-B' } },
        { name: 'standard', when: { always: true }, strategy: 'first-free', params: { group: 'ZONE-A' } },
      ],
    });
    expect(draft.body).toMatchObject({ version: 1, status: 'DRAFT' });
    v1 = draft.body.id;

    const simulation = await api.post('/v1/putaway/simulations', { barcode: 'P1', ruleSetId: v1 });
    expect(simulation.body).toMatchObject({
      id: null,
      simulated: true,
      ruleSet: { version: 1, status: 'DRAFT' },
      rule: { name: 'standard', index: 1 },
      strategy: 'first-free',
      chosen: { label: 'SA1/0001/0001/0001/0000' },
      assigned: false,
      facts: { 'unit.typeCode': 'EURO', 'unit.weightKg': '25', 'source.groupName': 'WE', 'request.group': null },
    });
    expect((await api.get('/v1/strategy-decisions?subject=P1')).body.total).toBe(0);
    expect((await api.get('/v1/transport-units/P1')).body.target).toBeNull();
  });

  it('aktiviert den Entwurf; aktive Regelsätze sind unveränderlich', async () => {
    expect((await api.post(`/v1/strategy-rule-sets/${v1}/activate`)).body).toMatchObject({ status: 'ACTIVE', activatedAt: expect.any(String) });
    expect(await api.put(`/v1/strategy-rule-sets/${v1}`, { rules: [{ name: 'x', when: { always: true }, strategy: 'first-free' }] })).toMatchObject({
      status: 409,
      body: { code: 'RULE_SET_NOT_DRAFT' },
    });
    expect(await api.delete(`/v1/strategy-rule-sets/${v1}`)).toMatchObject({ status: 409 });
  });

  it('liest einen Regelsatz einzeln mit allen Regeln', async () => {
    const r = await api.get(`/v1/strategy-rule-sets/${v1}`);
    expect(r).toMatchObject({ status: 200, body: { id: v1, decisionPoint: 'putaway', status: 'ACTIVE' } });
    expect(r.body.rules.length).toBeGreaterThan(0);
    expect(r.body.rules.at(-1).when).toEqual({ always: true });
    expect(await api.get('/v1/strategy-rule-sets/00000000-0000-4000-8000-000000000000')).toMatchObject({ status: 404 });
  });

  it('entscheidet, weist zu und speichert die Begründung', async () => {
    const decision = await api.post('/v1/putaway/decisions', { barcode: 'P1', assign: true });
    expect(decision.status).toBe(201);
    expect(decision.body).toMatchObject({ simulated: false, chosen: { label: 'SA1/0001/0001/0001/0000' }, assigned: true, attempts: 1, summary: { evaluated: 2, eligible: 2 } });
    expect((await api.get('/v1/transport-units/P1')).body.target).toMatchObject({ erpCode: 'A1' });

    const stored = await api.get(`/v1/strategy-decisions/${decision.body.id}`);
    expect(stored.body).toMatchObject({ id: decision.body.id, rule: { name: 'standard' }, chosen: { label: 'SA1/0001/0001/0001/0000' }, facts: { 'unit.barcode': 'P1' } });
    const event = await collector.waitFor((m) => m.topic === 'wms/putaway/decided' && (m.body['payload'] as { barcode: string }).barcode === 'P1');
    expect(PutawayDecidedEvent.parse(event.body).payload).toMatchObject({ ruleSetVersion: 1, chosen: { locationId: expect.any(String) }, assigned: true });
  });

  it('zählt bereits zugewiesene TUs als belegt', async () => {
    const decision = await api.post('/v1/putaway/decisions', { barcode: 'P2', assign: true });
    expect(decision.body.chosen.label).toBe('SA2/0001/0001/0001/0000');
    const a1 = decision.body.candidates.find((c: { label: string }) => c.label === 'SA1/0001/0001/0001/0000');
    expect(a1).toMatchObject({ eligible: false, violations: [{ rule: 'LOCATION_FULL' }] });
  });

  it('vergibt keinen Platz, für den die Anlage eine Störung meldet', async () => {
    const before = (await api.post('/v1/putaway/simulations', { barcode: 'P3' })).body;
    const label = before.chosen.label as string;
    const id = (await api.get(`/v1/locations?locationId=${encodeURIComponent(label)}`)).body.items[0].id;
    expect((await api.patch(`/v1/locations/${id}/plc-state`, { plcState: 3, text: 'Regalbediengerät gestört' })).body.plc).toMatchObject({ state: 3 });
    const after = (await api.post('/v1/putaway/simulations', { barcode: 'P3' })).body;
    expect(after.chosen?.label).not.toBe(label);
    expect(after.candidates.find((c: { label: string }) => c.label === label)).toMatchObject({ eligible: false, violations: expect.arrayContaining([expect.objectContaining({ rule: 'PLC_FAULT' })]) });
    expect((await api.patch(`/v1/locations/${id}/plc-state`, { plcState: 0 })).body.plc).toMatchObject({ state: 0, text: null });
    expect((await api.post('/v1/putaway/simulations', { barcode: 'P3' })).body.chosen.label).toBe(label);
  });

  it('wählt die Regel nach Bedingungen (schwere TU auf den Boden)', async () => {
    const decision = await api.post('/v1/putaway/decisions', { barcode: 'P3', assign: true });
    expect(decision.body).toMatchObject({ rule: { name: 'schwer-auf-boden' }, facts: { 'unit.weightKg': '600' }, assigned: true });
    expect((await api.get('/v1/transport-units/P3')).body.target).toMatchObject({ erpCode: 'B1' });
  });

  it('kann harte Regeln nicht umgehen und erklärt, warum nichts gewählt wurde', async () => {
    await api.patch('/v1/location-groups/LAGER/locks', { inbound: true });
    const blocked = await api.post('/v1/putaway/decisions', { barcode: 'P4', assign: true });
    expect(blocked.body).toMatchObject({
      chosen: null,
      assigned: false,
      note: 'Kein Lagerplatz erfüllt alle harten Regeln',
      summary: { evaluated: 2, eligible: 0, excludedByRule: { TARGET_INBOUND_BLOCKED: 2, LOCATION_FULL: 2 } },
    });
    await api.patch('/v1/location-groups/LAGER/locks', { inbound: false });
    expect((await api.get('/v1/transport-units/P4')).body.target).toBeNull();
  });

  it('prüft einen neuen Entwurf per Simulation, bevor er aktiv wird', async () => {
    const draft = await api.post('/v1/strategy-rule-sets', {
      decisionPoint: 'putaway',
      rules: [
        { name: 'anfrage', when: { field: 'request.group', op: 'exists' }, strategy: 'first-free', params: {} },
        { name: 'standard', when: { always: true }, strategy: 'weighted', params: { group: 'LAGER', weights: { privilege: 5 } } },
      ],
    });
    expect(draft.body.version).toBe(2);
    v2 = draft.body.id;

    // Aktiver Regelsatz v1: Zone A ist vergeben → kein Platz.
    expect((await api.post('/v1/putaway/simulations', { barcode: 'P5' })).body).toMatchObject({ ruleSet: { version: 1 }, chosen: null });
    // Entwurf v2: gewichtete Suche über das ganze LAGER findet B1.
    const withDraft = await api.post('/v1/putaway/simulations', { barcode: 'P5', ruleSetId: v2 });
    expect(withDraft.body).toMatchObject({ ruleSet: { version: 2 }, rule: { name: 'standard' }, strategy: 'weighted', chosen: { label: 'SB1/0001/0001/0001/0000' } });
    expect(withDraft.body.params).toEqual({ group: 'LAGER', includeSubgroups: true, weights: { sortOrder: 1, emptiness: 1, privilege: 5 } });

    expect((await api.post(`/v1/strategy-rule-sets/${v2}/activate`)).body.status).toBe('ACTIVE');
    const sets = (await api.get('/v1/strategy-rule-sets?decisionPoint=putaway')).body.items;
    expect(sets.map((s: { version: number; status: string }) => [s.version, s.status])).toEqual([
      [2, 'ACTIVE'],
      [1, 'ARCHIVED'],
    ]);
  });

  it('vergibt bei parallelen Entscheidungen jeden Platz nur einmal', async () => {
    const barcodes = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'];
    for (const barcode of barcodes) await tu(barcode);
    const results = await Promise.all(barcodes.map((barcode) => api.post('/v1/putaway/decisions', { barcode, group: 'PAR', assign: true })));
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const assigned = results.filter((r) => r.body.assigned);
    expect(assigned).toHaveLength(2);
    expect(new Set(assigned.map((r) => r.body.chosen.label)).size).toBe(2);
    expect(results.every((r) => r.body.rule.name === 'anfrage')).toBe(true);

    const targets = await Promise.all(barcodes.map(async (b) => (await api.get(`/v1/transport-units/${b}`)).body.target?.erpCode ?? null));
    expect(targets.filter(Boolean).sort()).toEqual(['PAR-1', 'PAR-2']);
  });

  it('beschreibt die Strategie-Endpunkte in OpenAPI, inklusive rekursiver Bedingungen', async () => {
    const document = (await api.get('/openapi.json')).body as { paths: Record<string, unknown>; components: { schemas: Record<string, unknown> } };
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/v1/strategies', '/v1/strategy-rule-sets/{id}/activate', '/v1/putaway/decisions', '/v1/putaway/simulations', '/v1/strategy-decisions/{id}']),
    );
    expect(JSON.stringify(document.components.schemas['StrategyCondition'])).toContain('#/components/schemas/StrategyCondition');
  });

  it('listet gespeicherte Entscheidungen je TU', async () => {
    const list = await api.get('/v1/strategy-decisions?subject=P4');
    expect(list.body).toMatchObject({ total: 1, items: [{ subject: 'P4', chosen: null, ruleSet: { version: 1, status: 'ARCHIVED' } }] });
  });

  it('hinterlässt Buchungsjournal, Änderungsprotokoll und Bestand stimmig', async () => {
    expect((await api.post('/v1/stock-journal/verify', {})).body).toMatchObject({ ok: true, problems: [] });
  });
});
