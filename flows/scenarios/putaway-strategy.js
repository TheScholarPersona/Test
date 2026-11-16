/**
 * Szenario: Einlagerstrategie per Regelsatz-Entwurf simulieren.
 *
 * Aktiviert bewusst keinen Regelsatz – das würde das Verhalten der ganzen
 * Umgebung ändern. Stattdessen wird ein eigener Entwurf angelegt, simuliert
 * und wieder gelöscht; genau so prüfen Bediener neue Regeln vor der Aktivierung.
 *
 * Geprüft: Regelwahl über eine Bedingung, Strategie first-free, harte Regel
 * „Vergabesperre“ als Filter mit Begründung, Ablehnung ungültiger Regelsätze.
 * Schrittformat: siehe flows/scenarios/layout-locks.js.
 */
registerScenario({
  id: 'putaway-strategy',
  description: 'Regelsatz-Entwurf wählt den ersten freien Platz; Vergabesperre schließt ihn begründet aus.',
  init: (runId) => {
    const s = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    return {
      locationType: `SZ-${s}`,
      zone: `SZ-${s}-ZONE`,
      inbound: `SZ-${s}-WE`,
      unitType: `SZ-${s}`,
      tu: `SZ-${s}-P`,
      l1Coord: `S${s}/0001/0001/0001/0000`,
      l2Coord: `S${s}/0001/0002/0001/0000`,
      weCoord: `S${s}/0009/0001/0001/0000`,
      l1: null,
      l2: null,
      we: null,
      draft: null,
    };
  },
  steps: [
    { name: 'Platztyp anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.locationType } }), expectStatus: 201 },
    { name: 'Lagerzone anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.zone } }), expectStatus: 201 },
    { name: 'Wareneingang anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.inbound } }), expectStatus: 201 },
    {
      name: 'Platz L1 anlegen (Sortierung 1)',
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.l1Coord, typeCode: v.locationType, groupName: v.zone, sortOrder: 1 } }),
      expectStatus: 201,
      save: (body, v) => {
        v.l1 = body.id;
      },
    },
    {
      name: 'Platz L2 anlegen (Sortierung 2)',
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.l2Coord, typeCode: v.locationType, groupName: v.zone, sortOrder: 2 } }),
      expectStatus: 201,
      save: (body, v) => {
        v.l2 = body.id;
      },
    },
    {
      name: 'Wareneingangsplatz anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.weCoord, typeCode: v.locationType, groupName: v.inbound, maxTransportUnits: 10 } }),
      expectStatus: 201,
      save: (body, v) => {
        v.we = body.id;
      },
    },
    { name: 'TU-Typ anlegen', request: (v) => ({ method: 'POST', path: '/v1/transport-unit-types', body: { code: v.unitType } }), expectStatus: 201 },
    {
      name: 'TU im Wareneingang anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/transport-units', body: { barcode: v.tu, typeCode: v.unitType, location: { id: v.we } } }),
      expectStatus: 201,
    },
    {
      name: 'Ungültiger Regelsatz wird mit Begründung abgelehnt',
      request: () => ({
        method: 'POST',
        path: '/v1/strategy-rule-sets',
        body: { decisionPoint: 'putaway', rules: [{ name: 'x', when: { field: 'unit.farbe', op: 'eq', value: 'rot' }, strategy: 'first-free' }] },
      }),
      expectStatus: 400,
      check: (body) => {
        const errors = (body.details && body.details.errors) || [];
        return body.code === 'RULE_SET_INVALID' && errors.some((e) => e.includes('unit.farbe')) && errors.some((e) => e.includes('letzte Regel'))
          ? null
          : `Unerwartete Antwort: ${JSON.stringify(body)}`;
      },
    },
    {
      name: 'Regelsatz-Entwurf anlegen',
      request: (v) => ({
        method: 'POST',
        path: '/v1/strategy-rule-sets',
        body: {
          decisionPoint: 'putaway',
          description: 'Szenario putaway-strategy',
          rules: [
            { name: 'szenario-tu', when: { field: 'unit.barcode', op: 'eq', value: v.tu }, strategy: 'first-free', params: { group: v.zone } },
            { name: 'rest', when: { always: true }, strategy: 'first-free', params: {} },
          ],
        },
      }),
      expectStatus: 201,
      check: (body) => (body.status === 'DRAFT' ? null : `Erwartet DRAFT, erhalten ${body.status}`),
      save: (body, v) => {
        v.draft = body.id;
      },
    },
    {
      name: 'Simulation wählt L1 über die Regel szenario-tu',
      request: (v) => ({ method: 'POST', path: '/v1/putaway/simulations', body: { barcode: v.tu, ruleSetId: v.draft } }),
      expectStatus: 200,
      check: (body, v) =>
        body.simulated === true && body.rule.name === 'szenario-tu' && body.chosen && body.chosen.key === v.l1 && body.id === null
          ? null
          : `Unerwartete Entscheidung: ${JSON.stringify({ rule: body.rule, chosen: body.chosen, simulated: body.simulated })}`,
    },
    {
      name: 'L1 für die Platzvergabe sperren',
      request: (v) => ({ method: 'PATCH', path: `/v1/locations/${v.l1}/locks`, body: { allocation: true, reason: 'Szenario putaway-strategy' } }),
      expectStatus: 200,
    },
    {
      name: 'Simulation weicht auf L2 aus und begründet den Ausschluss von L1',
      request: (v) => ({ method: 'POST', path: '/v1/putaway/simulations', body: { barcode: v.tu, ruleSetId: v.draft } }),
      expectStatus: 200,
      check: (body, v) => {
        const l1 = body.candidates.find((c) => c.key === v.l1);
        if (!body.chosen || body.chosen.key !== v.l2) return `Erwartet L2, erhalten ${JSON.stringify(body.chosen)}`;
        if (!l1 || l1.eligible || !l1.violations.some((x) => x.rule === 'ALLOCATION_BLOCKED')) return `L1 nicht begründet ausgeschlossen: ${JSON.stringify(l1)}`;
        return body.summary.excludedByRule.ALLOCATION_BLOCKED === 1 ? null : `Zusammenfassung falsch: ${JSON.stringify(body.summary)}`;
      },
    },
    {
      name: 'Simulation hat nichts gespeichert und nichts zugewiesen',
      request: (v) => ({ method: 'GET', path: `/v1/transport-units/${v.tu}` }),
      expectStatus: 200,
      check: (body) => (body.target === null ? null : `TU hat unerwartet ein Ziel: ${JSON.stringify(body.target)}`),
    },
    { name: 'Aufräumen: Entwurf löschen', cleanup: true, request: (v) => (v.draft ? { method: 'DELETE', path: `/v1/strategy-rule-sets/${v.draft}` } : null), expectStatus: 204 },
    { name: 'Aufräumen: TU löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu}` }) },
    { name: 'Aufräumen: L1 löschen', cleanup: true, request: (v) => (v.l1 ? { method: 'DELETE', path: `/v1/locations/${v.l1}` } : null), expectStatus: 204 },
    { name: 'Aufräumen: L2 löschen', cleanup: true, request: (v) => (v.l2 ? { method: 'DELETE', path: `/v1/locations/${v.l2}` } : null), expectStatus: 204 },
    { name: 'Aufräumen: Wareneingangsplatz löschen', cleanup: true, request: (v) => (v.we ? { method: 'DELETE', path: `/v1/locations/${v.we}` } : null), expectStatus: 204 },
    { name: 'Aufräumen: Lagerzone löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.zone}` }), expectStatus: 204 },
    { name: 'Aufräumen: Wareneingang löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.inbound}` }), expectStatus: 204 },
    { name: 'Aufräumen: TU-Typ löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-unit-types/${v.unitType}` }), expectStatus: 204 },
    { name: 'Aufräumen: Platztyp löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-types/${v.locationType}` }), expectStatus: 204 },
  ],
});
