/**
 * Szenario: Platzierungsregeln für Transporteinheiten.
 *
 * Prüft Kapazität und Höchstgewicht eines Platzes (L-06), die Meldung aller
 * Verstöße, die physische Buchung (Ist-Position wird trotz Verstoß gebucht
 * und im Event gemeldet) und den Löschschutz für belegte Plätze (L-05).
 * Schrittformat: siehe flows/scenarios/layout-locks.js.
 */
registerScenario({
  id: 'tu-placement',
  description: 'Voller oder zu schwerer Platz wird abgelehnt; physische Buchung wird mit Verstößen gemeldet.',
  init: (runId) => {
    const s = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    return {
      locationType: `SZ-${s}`,
      group: `SZ-${s}-TU`,
      unitType: `SZ-${s}`,
      tu1: `SZ-${s}-1`,
      tu2: `SZ-${s}-2`,
      l1Coord: `S${s}/0001/0001/0001/0000`,
      l2Coord: `S${s}/0001/0002/0001/0000`,
      l1: null,
      l2: null,
    };
  },
  steps: [
    {
      name: 'Platztyp anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.locationType } }),
      expectStatus: 201,
    },
    {
      name: 'Gruppe anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.group } }),
      expectStatus: 201,
    },
    {
      name: 'Platz L1 anlegen (1 TU, höchstens 100 kg)',
      request: (v) => ({
        method: 'POST',
        path: '/v1/locations',
        body: { locationId: v.l1Coord, typeCode: v.locationType, groupName: v.group, maxTransportUnits: 1, maxWeight: { amount: '100', unit: 'KG' } },
      }),
      expectStatus: 201,
      save: (body, v) => {
        v.l1 = body.id;
      },
    },
    {
      name: 'Platz L2 anlegen (2 TUs, ohne Gewichtsgrenze)',
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.l2Coord, typeCode: v.locationType, groupName: v.group, maxTransportUnits: 2 } }),
      expectStatus: 201,
      save: (body, v) => {
        v.l2 = body.id;
      },
    },
    {
      name: 'TU-Typ anlegen (Leergewicht 20 kg)',
      request: (v) => ({ method: 'POST', path: '/v1/transport-unit-types', body: { code: v.unitType, tareWeight: { amount: '20', unit: 'KG' } } }),
      expectStatus: 201,
    },
    {
      name: 'TU 1 auf L1 anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/transport-units', body: { barcode: v.tu1, typeCode: v.unitType, location: { id: v.l1 } } }),
      expectStatus: 201,
    },
    {
      name: 'Event transport-unit.created für TU 1 empfangen',
      event: (e, v) => e.type === 'transport-unit.created' && e.payload.barcode === v.tu1,
    },
    {
      name: 'TU 2 auf dem vollen Platz L1 wird abgelehnt',
      request: (v) => ({ method: 'POST', path: '/v1/transport-units', body: { barcode: v.tu2, typeCode: v.unitType, location: { id: v.l1 } } }),
      expectStatus: 409,
      check: (body) => {
        const rules = ((body.details && body.details.violations) || []).map((x) => x.rule);
        return body.code === 'PLACEMENT_REJECTED' && rules.join() === 'LOCATION_FULL' ? null : `Erwartet LOCATION_FULL, erhalten ${JSON.stringify(body)}`;
      },
    },
    {
      name: 'TU 2 mit 120 kg auf L2 anlegen',
      request: (v) => ({
        method: 'POST',
        path: '/v1/transport-units',
        body: { barcode: v.tu2, typeCode: v.unitType, location: { id: v.l2 }, weight: { amount: '120', unit: 'KG' } },
      }),
      expectStatus: 201,
    },
    {
      name: 'Bewegen nach L1 meldet beide Verstöße (voll und zu schwer)',
      request: (v) => ({ method: 'POST', path: `/v1/transport-units/${v.tu2}/move`, body: { to: { id: v.l1 } } }),
      expectStatus: 409,
      check: (body) => {
        const rules = ((body.details && body.details.violations) || []).map((x) => x.rule).sort();
        return rules.join() === 'LOCATION_FULL,WEIGHT_EXCEEDED' ? null : `Erwartet LOCATION_FULL und WEIGHT_EXCEEDED, erhalten ${rules.join()}`;
      },
    },
    {
      name: 'Gemeldete Ist-Position wird trotzdem gebucht (mode physical)',
      request: (v) => ({ method: 'POST', path: `/v1/transport-units/${v.tu2}/move`, body: { to: { id: v.l1 }, mode: 'physical' } }),
      expectStatus: 200,
      check: (body, v) =>
        body.unit.location.id === v.l1 && body.violations.length === 2 ? null : `Unerwartetes Ergebnis: ${JSON.stringify(body)}`,
    },
    {
      name: 'Event transport-unit.moved mit Verstößen empfangen',
      event: (e, v) => e.type === 'transport-unit.moved' && e.payload.barcode === v.tu2 && e.payload.mode === 'physical' && e.payload.violations.length === 2,
    },
    {
      name: 'Belegter Platz L1 kann nicht gelöscht werden',
      request: (v) => ({ method: 'DELETE', path: `/v1/locations/${v.l1}` }),
      expectStatus: 409,
      check: (body) => (body.code === 'LOCATION_IN_USE' ? null : `Erwartet LOCATION_IN_USE, erhalten ${body.code}`),
    },
    {
      name: 'Aufräumen: TU 2 löschen',
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu2}` }),
    },
    {
      name: 'Aufräumen: TU 1 löschen',
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu1}` }),
    },
    {
      name: 'Aufräumen: Platz L1 löschen',
      cleanup: true,
      request: (v) => (v.l1 ? { method: 'DELETE', path: `/v1/locations/${v.l1}` } : null),
      expectStatus: 204,
    },
    {
      name: 'Aufräumen: Platz L2 löschen',
      cleanup: true,
      request: (v) => (v.l2 ? { method: 'DELETE', path: `/v1/locations/${v.l2}` } : null),
      expectStatus: 204,
    },
    {
      name: 'Aufräumen: Gruppe löschen',
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.group}` }),
      expectStatus: 204,
    },
    {
      name: 'Aufräumen: TU-Typ löschen',
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/transport-unit-types/${v.unitType}` }),
      expectStatus: 204,
    },
    {
      name: 'Aufräumen: Platztyp löschen',
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/location-types/${v.locationType}` }),
      expectStatus: 204,
    },
  ],
});
