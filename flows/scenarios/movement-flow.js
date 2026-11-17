/**
 * Szenario: Ablauf einer Lagerbewegung.
 *
 * Anlegen mit Zielreservierung, Bearbeitung beginnen, ungültiger Übergang,
 * Löschschutz der TU, Abschluss auf einem abweichenden Platz (wie bei einer
 * Scanner-Quittung), Storno mit Freigabe der Reservierung.
 * Bewegungen bleiben als Historie erhalten (kein Löschen).
 * Schrittformat: siehe flows/scenarios/layout-locks.js.
 */
registerScenario({
  id: 'movement-flow',
  description: 'Bewegung anlegen, beginnen, mit Abweichung abschließen und stornieren; ungültige Übergänge werden abgelehnt.',
  init: (runId) => {
    const s = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    return {
      locationType: `SZ-${s}`,
      zone: `SZ-${s}-ZONE`,
      inbound: `SZ-${s}-WE`,
      unitType: `SZ-${s}`,
      tu: `SZ-${s}-P`,
      z1Coord: `S${s}/0001/0001/0001/0000`,
      z2Coord: `S${s}/0001/0002/0001/0000`,
      weCoord: `S${s}/0009/0001/0001/0000`,
      z1: null,
      z2: null,
      we: null,
      first: null,
      second: null,
    };
  },
  steps: [
    { name: 'Platztyp anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.locationType } }), expectStatus: 201 },
    { name: 'Lagerzone anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.zone } }), expectStatus: 201 },
    { name: 'Wareneingang anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.inbound } }), expectStatus: 201 },
    {
      name: 'Platz Z1 anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.z1Coord, typeCode: v.locationType, groupName: v.zone } }),
      expectStatus: 201,
      save: (body, v) => {
        v.z1 = body.id;
      },
    },
    {
      name: 'Platz Z2 anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.z2Coord, typeCode: v.locationType, groupName: v.zone } }),
      expectStatus: 201,
      save: (body, v) => {
        v.z2 = body.id;
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
      name: 'Bewegung nach Z1 anlegen',
      request: (v) => ({
        method: 'POST',
        path: '/v1/movements',
        body: { barcode: v.tu, type: 'INBOUND', target: { location: { id: v.z1 } }, initiator: 'node-red' },
      }),
      expectStatus: 201,
      check: (body, v) => (body.state === 'OPEN' && body.target.id === v.z1 ? null : `Unerwartet: ${JSON.stringify(body)}`),
      save: (body, v) => {
        v.first = body.number;
      },
    },
    { name: 'Event movement.created empfangen', event: (e, v) => e.type === 'movement.created' && e.payload.number === v.first },
    {
      name: 'Ziel Z1 ist für die TU reserviert',
      request: (v) => ({ method: 'GET', path: `/v1/transport-units/${v.tu}` }),
      expectStatus: 200,
      check: (body, v) => (body.target && body.target.id === v.z1 ? null : `Ziel nicht reserviert: ${JSON.stringify(body.target)}`),
    },
    {
      name: 'Bearbeitung beginnen',
      request: (v) => ({ method: 'POST', path: `/v1/movements/${v.first}/start`, body: { assignedTo: 'node-red' } }),
      expectStatus: 200,
      check: (body) => (body.state === 'IN_PROGRESS' ? null : `Erwartet IN_PROGRESS, erhalten ${body.state}`),
    },
    {
      name: 'Erneutes Beginnen wird abgelehnt (INVALID_STATE_TRANSITION)',
      request: (v) => ({ method: 'POST', path: `/v1/movements/${v.first}/start`, body: {} }),
      expectStatus: 409,
      check: (body) => (body.code === 'INVALID_STATE_TRANSITION' ? null : `Erwartet INVALID_STATE_TRANSITION, erhalten ${body.code}`),
    },
    {
      name: 'TU mit offener Bewegung kann nicht gelöscht werden',
      request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu}` }),
      expectStatus: 409,
      check: (body) => (body.code === 'TU_IN_USE' ? null : `Erwartet TU_IN_USE, erhalten ${body.code}`),
    },
    {
      name: 'Abschluss auf Z2 statt Z1 (Abweichung)',
      request: (v) => ({ method: 'POST', path: `/v1/movements/${v.first}/complete`, body: { location: { id: v.z2 } } }),
      expectStatus: 200,
      check: (body, v) =>
        body.movement.state === 'DONE' && body.movement.completed.deviated === true && body.movement.completed.location.id === v.z2
          ? null
          : `Unerwartet: ${JSON.stringify(body.movement)}`,
    },
    {
      name: 'Event movement.completed mit Quelle, Ziel und Abweichung',
      event: (e, v) => e.type === 'movement.completed' && e.payload.number === v.first && e.payload.deviated === true && e.payload.from.id === v.we && e.payload.to.id === v.z2,
    },
    {
      name: 'TU steht auf Z2, die Reservierung von Z1 ist aufgehoben',
      request: (v) => ({ method: 'GET', path: `/v1/transport-units/${v.tu}` }),
      expectStatus: 200,
      check: (body, v) => (body.location.id === v.z2 && body.target === null ? null : `Unerwartet: ${JSON.stringify({ location: body.location, target: body.target })}`),
    },
    {
      name: 'Zweite Bewegung nach Z1 anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/movements', body: { barcode: v.tu, type: 'RELOCATION', target: { location: { id: v.z1 } } } }),
      expectStatus: 201,
      save: (body, v) => {
        v.second = body.number;
      },
    },
    {
      name: 'Zweite Bewegung stornieren',
      request: (v) => ({ method: 'POST', path: `/v1/movements/${v.second}/cancel`, body: { reason: 'Szenario movement-flow' } }),
      expectStatus: 200,
      check: (body) => (body.state === 'CANCELLED' && body.cancelled.reason === 'Szenario movement-flow' ? null : `Unerwartet: ${JSON.stringify(body)}`),
    },
    {
      name: 'Storno hat die Reservierung freigegeben',
      request: (v) => ({ method: 'GET', path: `/v1/transport-units/${v.tu}` }),
      expectStatus: 200,
      check: (body) => (body.target === null ? null : `Ziel noch gesetzt: ${JSON.stringify(body.target)}`),
    },
    {
      name: 'Aufräumen: offene Bewegung stornieren',
      cleanup: true,
      request: (v) => (v.first ? { method: 'POST', path: `/v1/movements/${v.first}/cancel`, body: { reason: 'Aufräumen' } } : null),
    },
    { name: 'Aufräumen: TU löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu}` }) },
    { name: 'Aufräumen: Z1 löschen', cleanup: true, request: (v) => (v.z1 ? { method: 'DELETE', path: `/v1/locations/${v.z1}` } : null), expectStatus: 204 },
    { name: 'Aufräumen: Z2 löschen', cleanup: true, request: (v) => (v.z2 ? { method: 'DELETE', path: `/v1/locations/${v.z2}` } : null), expectStatus: 204 },
    { name: 'Aufräumen: Wareneingangsplatz löschen', cleanup: true, request: (v) => (v.we ? { method: 'DELETE', path: `/v1/locations/${v.we}` } : null), expectStatus: 204 },
    { name: 'Aufräumen: Lagerzone löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.zone}` }), expectStatus: 204 },
    { name: 'Aufräumen: Wareneingang löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.inbound}` }), expectStatus: 204 },
    { name: 'Aufräumen: TU-Typ löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-unit-types/${v.unitType}` }), expectStatus: 204 },
    { name: 'Aufräumen: Platztyp löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-types/${v.locationType}` }), expectStatus: 204 },
  ],
});
