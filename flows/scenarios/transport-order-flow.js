/**
 * Szenario: Start-Steuerung der Transportaufträge.
 *
 * Erster Auftrag startet und reserviert sein Ziel, ein zweiter für dieselbe
 * TU wartet (O-02) und startet automatisch nach dem Abschluss des ersten
 * (O-06). Ein gesperrtes Ziel verhindert den Start (O-04), nach dem
 * Entsperren startet `start-pending` den Auftrag.
 * Aufträge bleiben als Historie erhalten (kein Löschen).
 * Schrittformat: siehe flows/scenarios/layout-locks.js.
 */
registerScenario({
  id: 'transport-order-flow',
  description: 'Transportaufträge: zweiter Start für dieselbe TU abgelehnt, Folgeauftrag startet nach Abschluss, gesperrtes Ziel verhindert den Start.',
  init: (runId) => {
    const s = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    return {
      locationType: `ST-${s}`,
      group: `ST-${s}-G`,
      unitType: `ST-${s}`,
      tu: `ST-${s}-P`,
      coords: { src: `O${s}/0001/0001/0001/0000`, a: `O${s}/0002/0001/0001/0000`, b: `O${s}/0003/0001/0001/0000` },
      loc: { src: null, a: null, b: null },
      first: null,
      second: null,
      third: null,
    };
  },
  steps: [
    { name: 'Platztyp anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.locationType } }), expectStatus: 201 },
    { name: 'Gruppe anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.group } }), expectStatus: 201 },
    ...['src', 'a', 'b'].map((key) => ({
      name: `Platz ${key} anlegen`,
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.coords[key], typeCode: v.locationType, groupName: v.group, maxTransportUnits: 5 } }),
      expectStatus: 201,
      save: (body, v) => {
        v.loc[key] = body.id;
      },
    })),
    { name: 'TU-Typ anlegen', request: (v) => ({ method: 'POST', path: '/v1/transport-unit-types', body: { code: v.unitType } }), expectStatus: 201 },
    {
      name: 'TU auf Quellplatz anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/transport-units', body: { barcode: v.tu, typeCode: v.unitType, location: { id: v.loc.src } } }),
      expectStatus: 201,
    },
    {
      name: 'Auftrag 1 nach A startet sofort',
      request: (v) => ({ method: 'POST', path: '/v1/transport-orders', body: { barcode: v.tu, target: { location: { id: v.loc.a } }, initiator: 'node-red' } }),
      expectStatus: 201,
      check: (body, v) => (body.state === 'STARTED' && body.target.id === v.loc.a ? null : `Unerwartet: ${JSON.stringify(body)}`),
      save: (body, v) => {
        v.first = body.number;
      },
    },
    { name: 'Event transport-order.started (Auftrag 1)', event: (e, v) => e.type === 'transport-order.started' && e.payload.number === v.first },
    {
      name: 'Auftrag 2 nach B wartet (O-02)',
      request: (v) => ({ method: 'POST', path: '/v1/transport-orders', body: { barcode: v.tu, target: { location: { id: v.loc.b } } } }),
      expectStatus: 201,
      check: (body) => (body.state === 'INITIALIZED' ? null : `Erwartet INITIALIZED, erhalten ${body.state}`),
      save: (body, v) => {
        v.second = body.number;
      },
    },
    {
      name: 'Expliziter Start von Auftrag 2 wird abgelehnt (TRANSPORT_ORDER_ACTIVE)',
      request: (v) => ({ method: 'POST', path: `/v1/transport-orders/${v.second}/start` }),
      expectStatus: 409,
      check: (body) => (body.code === 'TRANSPORT_ORDER_ACTIVE' ? null : `Erwartet TRANSPORT_ORDER_ACTIVE, erhalten ${body.code}`),
    },
    {
      name: 'Auftrag 1 abschließen',
      request: (v) => ({ method: 'POST', path: `/v1/transport-orders/${v.first}/finish`, body: {} }),
      expectStatus: 200,
      check: (body, v) => (body.state === 'FINISHED' && body.finished.locationId === v.coords.a ? null : `Unerwartet: ${JSON.stringify(body)}`),
    },
    { name: 'Event transport-order.started (Auftrag 2 automatisch, O-06)', event: (e, v) => e.type === 'transport-order.started' && e.payload.number === v.second },
    {
      name: 'Auftrag 2 abschließen',
      request: (v) => ({ method: 'POST', path: `/v1/transport-orders/${v.second}/finish`, body: {} }),
      expectStatus: 200,
      check: (body) => (body.state === 'FINISHED' ? null : `Unerwartet: ${body.state}`),
    },
    {
      name: 'Platz A für Einlagerung sperren',
      request: (v) => ({ method: 'PATCH', path: `/v1/locations/${v.loc.a}/locks`, body: { inbound: true, reason: 'Szenario' } }),
      expectStatus: 200,
    },
    {
      name: 'Auftrag 3 nach A wartet wegen Sperre (O-04)',
      request: (v) => ({ method: 'POST', path: '/v1/transport-orders', body: { barcode: v.tu, target: { location: { id: v.loc.a } } } }),
      expectStatus: 201,
      check: (body) => (body.state === 'INITIALIZED' && body.problem && body.problem.code === 'TARGET_LOCKED' ? null : `Unerwartet: ${JSON.stringify(body)}`),
      save: (body, v) => {
        v.third = body.number;
      },
    },
    { name: 'Event transport-order.start-blocked', event: (e, v) => e.type === 'transport-order.start-blocked' && e.payload.number === v.third },
    { name: 'Platz A entsperren', request: (v) => ({ method: 'PATCH', path: `/v1/locations/${v.loc.a}/locks`, body: { inbound: false } }), expectStatus: 200 },
    {
      name: 'start-pending startet Auftrag 3',
      request: () => ({ method: 'POST', path: '/v1/transport-orders/start-pending' }),
      expectStatus: 200,
      check: (body, v) => (body.started.includes(v.third) ? null : `Nicht gestartet: ${JSON.stringify(body)}`),
    },
    {
      name: 'Auftrag 3 stornieren gibt die Reservierung frei',
      request: (v) => ({ method: 'POST', path: `/v1/transport-orders/${v.third}/cancel`, body: { reason: 'Szenario' } }),
      expectStatus: 200,
      check: (body) => (body.state === 'CANCELED' ? null : `Unerwartet: ${body.state}`),
    },
    { name: 'Event transport-order.canceled', event: (e, v) => e.type === 'transport-order.canceled' && e.payload.number === v.third && e.payload.releasedTarget === true },
    ...['first', 'second', 'third'].map((key) => ({
      name: `Aufräumen: Auftrag ${key} stornieren`,
      cleanup: true,
      request: (v) => (v[key] ? { method: 'POST', path: `/v1/transport-orders/${v[key]}/cancel`, body: { reason: 'Aufräumen' } } : null),
    })),
    { name: 'Aufräumen: Platz A entsperren', cleanup: true, request: (v) => (v.loc.a ? { method: 'PATCH', path: `/v1/locations/${v.loc.a}/locks`, body: { inbound: false } } : null) },
    { name: 'Aufräumen: TU löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu}` }), expectStatus: 204 },
    ...['src', 'a', 'b'].map((key) => ({
      name: `Aufräumen: Platz ${key} löschen`,
      cleanup: true,
      request: (v) => (v.loc[key] ? { method: 'DELETE', path: `/v1/locations/${v.loc[key]}` } : null),
      expectStatus: 204,
    })),
    { name: 'Aufräumen: Gruppe löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.group}` }), expectStatus: 204 },
    { name: 'Aufräumen: TU-Typ löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-unit-types/${v.unitType}` }), expectStatus: 204 },
    { name: 'Aufräumen: Platztyp löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-types/${v.locationType}` }), expectStatus: 204 },
  ],
});
