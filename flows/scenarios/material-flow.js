/**
 * Szenario: Materialfluss mit Anlagensimulator.
 *
 * Fördertechnik I-Punkt → C1 → C2 → Hochregal. Das WMS beantwortet jede
 * Anfrage mit einem Fahrbefehl, der Simulator (Tab „Anlagensimulator“) fährt
 * und meldet am nächsten Platz – bis der Auftrag im Hochregal abgeschlossen ist.
 * Danach: geänderte Route wirkt sofort, Auftrag ohne Route meldet „keine
 * Route“ (R4), eine eingespeiste Störung unterbricht den Auftrag, und ein
 * Node-RED-Programm beantwortet eine Anfrage mit einem Fahrbefehl.
 * Aufträge und Entscheidungen bleiben als Historie erhalten.
 * Schrittformat: siehe flows/scenarios/layout-locks.js.
 */
registerScenario({
  id: 'material-flow',
  description: 'Simulator fährt TUs über die Route ins Hochregal; Routenänderung wirkt sofort; keine Route, Störung und Node-RED-Programm.',
  init: (runId) => {
    const s = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    const plc = { ip: `${s}-IP`, c1: `${s}-C1`, c2: `${s}-C2`, h1: `${s}-HRL1`, k1: `${s}-K1` };
    return {
      s,
      locationType: `SM-${s}`,
      ft: `SM-${s}-FT`,
      hrl: `SM-${s}-HRL`,
      nio: `SM-${s}-NIO`,
      unitType: `SM-${s}`,
      route: `SM-${s}`,
      plc,
      coords: { ip: `Q${s}/0001/0001/0001/0000`, c1: `Q${s}/0002/0001/0001/0000`, c2: `Q${s}/0003/0001/0001/0000`, h1: `Q${s}/0009/0001/0001/0000`, k1: `Q${s}/0008/0001/0001/0000` },
      groupOf: { ip: 'ft', c1: 'ft', c2: 'ft', h1: 'hrl', k1: 'nio' },
      loc: {},
      tu: { t1: `${s}-T1`, t2: `${s}-T2`, t3: `${s}-T3`, t4: `${s}-T4`, t5: `${s}-T5` },
      actions: [`sm-${s}-ip`, `sm-${s}-ft`, `sm-${s}-hrl`, `sm-${s}-err`, `sm-${s}-nio`],
      orders: [],
    };
  },
  steps: [
    { name: 'Platztyp anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.locationType } }), expectStatus: 201 },
    ...['ft', 'hrl', 'nio'].map((g) => ({ name: `Gruppe ${g} anlegen`, request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v[g] } }), expectStatus: 201 })),
    ...['ip', 'c1', 'c2', 'h1', 'k1'].map((key) => ({
      name: `Platz ${key} anlegen`,
      request: (v) => ({
        method: 'POST',
        path: '/v1/locations',
        body: { locationId: v.coords[key], plcCode: v.plc[key], typeCode: v.locationType, groupName: v[v.groupOf[key]], maxTransportUnits: 20 },
      }),
      expectStatus: 201,
      save: (body, v) => {
        v.loc[key] = body.id;
      },
    })),
    { name: 'TU-Typ anlegen', request: (v) => ({ method: 'POST', path: '/v1/transport-unit-types', body: { code: v.unitType } }), expectStatus: 201 },
    {
      name: 'Route I-Punkt → Hochregal mit Schritten anlegen',
      request: (v) => ({
        method: 'POST',
        path: '/v1/flow/routes',
        body: {
          routeId: v.route,
          source: { location: { plcCode: v.plc.ip } },
          target: { group: v.hrl },
          steps: [
            { from: { plcCode: v.plc.ip }, next: { plcCode: v.plc.c1 } },
            { from: { plcCode: v.plc.c1 }, next: { plcCode: v.plc.c2 } },
            { from: { plcCode: v.plc.c2 }, next: { plcCode: v.plc.h1 } },
          ],
        },
      }),
      expectStatus: 201,
    },
    {
      name: 'Action: Anfrage am I-Punkt legt TU und Auftrag an',
      request: (v) => ({
        method: 'POST',
        path: '/v1/flow/actions',
        body: { name: v.actions[0], eventType: 'request', place: { location: { plcCode: v.plc.ip } }, program: 'create-order', params: { target: { group: v.hrl }, typeCode: v.unitType } },
      }),
      expectStatus: 201,
    },
    {
      name: 'Action: Anfragen in der Fördertechnik fahren weiter',
      request: (v) => ({ method: 'POST', path: '/v1/flow/actions', body: { name: v.actions[1], eventType: 'request', place: { group: v.ft }, program: 'route-next' } }),
      expectStatus: 201,
    },
    {
      name: 'Action: Ankunft im Hochregal schließt ab',
      request: (v) => ({ method: 'POST', path: '/v1/flow/actions', body: { name: v.actions[2], eventType: 'arrived', place: { group: v.hrl }, program: 'route-next' } }),
      expectStatus: 201,
    },
    {
      name: 'Action: Störung in der Fördertechnik unterbricht den Auftrag',
      request: (v) => ({ method: 'POST', path: '/v1/flow/actions', body: { name: v.actions[3], eventType: 'error', place: { group: v.ft }, program: 'interrupt-order' } }),
      expectStatus: 201,
    },
    {
      name: 'Action: Anfrage am Klärplatz geht an das Node-RED-Programm send-to-plc',
      request: (v) => ({
        method: 'POST',
        path: '/v1/flow/actions',
        body: { name: v.actions[4], eventType: 'request', place: { group: v.nio }, program: 'node-red', params: { flow: 'send-to-plc', toPlc: v.plc.c2 } },
      }),
      expectStatus: 201,
    },
    {
      name: 'Simulator ist aktiv',
      request: () => ({ service: 'simulator', method: 'DELETE', path: '/sim/faults' }),
      expectStatus: 200,
      check: (body) => (body.enabled === true ? null : 'Simulator ist deaktiviert (SIMULATOR_ENABLED)'),
    },

    // --- 1. Fahrt über die Route ----------------------------------------------
    {
      name: 'Anfrage am I-Punkt (unbekannte TU) → Fahrbefehl nach C1',
      request: (v) => ({ method: 'POST', path: '/v1/flow/events', body: { type: 'request', location: { plcCode: v.plc.ip }, barcode: v.tu.t1, deviceId: 'SIM' } }),
      expectStatus: 200,
      check: (body, v) =>
        body.decision.outcome === 'COMMAND' && body.command.to.plcCode === v.plc.c1 && body.decision.routeId === v.route ? null : `Unerwartet: ${JSON.stringify(body.decision)}`,
      save: (body, v) => {
        v.orders.push(body.decision.orderNumber);
      },
    },
    { name: 'Simulator fährt; Auftrag im Hochregal abgeschlossen', event: (e, v) => e.type === 'transport-order.finished' && e.payload.barcode === v.tu.t1 },
    {
      name: 'TU steht im Hochregal',
      request: (v) => ({ method: 'GET', path: `/v1/transport-units/${v.tu.t1}` }),
      expectStatus: 200,
      check: (body, v) => (body.location.id === v.loc.h1 && body.target === null ? null : `Unerwartet: ${JSON.stringify(body.location)}`),
    },
    {
      name: 'Entscheidungsprotokoll: I-Punkt, C1, C2 → Fahrbefehle, Hochregal → abgeschlossen',
      request: (v) => ({ method: 'GET', path: `/v1/flow/decisions?barcode=${v.tu.t1}` }),
      expectStatus: 200,
      check: (body, v) => {
        const seen = body.items.map((d) => `${d.outcome}:${d.next || '-'}`).reverse().join(' ');
        const expected = `COMMAND:${v.coords.c1} COMMAND:${v.coords.c2} COMMAND:${v.coords.h1} FINISHED:-`;
        return seen === expected ? null : `Erwartet ${expected}, erhalten ${seen}`;
      },
    },

    // --- 2. Routenänderung wirkt sofort ---------------------------------------
    {
      name: 'Route ändern: C1 fährt direkt ins Hochregal',
      request: (v) => ({
        method: 'PUT',
        path: `/v1/flow/routes/${v.route}/steps`,
        body: {
          steps: [
            { from: { plcCode: v.plc.ip }, next: { plcCode: v.plc.c1 } },
            { from: { plcCode: v.plc.c1 }, next: { plcCode: v.plc.h1 } },
          ],
        },
      }),
      expectStatus: 200,
    },
    {
      name: 'Zweite TU am I-Punkt anmelden',
      request: (v) => ({ method: 'POST', path: '/v1/flow/events', body: { type: 'request', location: { plcCode: v.plc.ip }, barcode: v.tu.t2, deviceId: 'SIM' } }),
      expectStatus: 200,
      save: (body, v) => {
        v.orders.push(body.decision.orderNumber);
      },
    },
    { name: 'Zweite TU im Hochregal angekommen', event: (e, v) => e.type === 'transport-order.finished' && e.payload.barcode === v.tu.t2 },
    {
      name: 'Zweite TU fuhr ohne C2',
      request: (v) => ({ method: 'GET', path: `/v1/flow/decisions?barcode=${v.tu.t2}` }),
      expectStatus: 200,
      check: (body, v) => {
        const nexts = body.items.map((d) => d.next).filter(Boolean);
        return nexts.includes(v.coords.c2) || !nexts.includes(v.coords.h1) ? `Unerwartete Fahrt: ${JSON.stringify(nexts)}` : null;
      },
    },

    // --- 3. Keine Route (R4) --------------------------------------------------
    {
      name: 'TU auf C2 anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/transport-units', body: { barcode: v.tu.t3, typeCode: v.unitType, location: { id: v.loc.c2 } } }),
      expectStatus: 201,
    },
    {
      name: 'Auftrag C2 → Klärplatz (keine Route konfiguriert)',
      request: (v) => ({ method: 'POST', path: '/v1/transport-orders', body: { barcode: v.tu.t3, target: { location: { id: v.loc.k1 } } } }),
      expectStatus: 201,
      save: (body, v) => {
        v.orders.push(body.number);
      },
    },
    {
      name: 'Anfrage an C2 liefert keinen Fahrbefehl',
      request: (v) => ({ method: 'POST', path: '/v1/flow/events', body: { type: 'request', location: { plcCode: v.plc.c2 }, barcode: v.tu.t3 } }),
      expectStatus: 200,
      check: (body) => (body.command === null && body.decision.outcome === 'NO_NEXT_STEP' && body.decision.routeId === null ? null : `Unerwartet: ${JSON.stringify(body.decision)}`),
    },
    { name: 'Event flow.no-route empfangen', event: (e, v) => e.type === 'flow.no-route' && e.payload.barcode === v.tu.t3 },

    // --- 4. Störung -----------------------------------------------------------
    {
      name: 'Störung auf dem Weg nach C1 einspeisen',
      request: (v) => ({ service: 'simulator', method: 'POST', path: '/sim/faults', body: { plcCode: v.plc.c1, code: 'LS1', message: 'Lichtschranke verdeckt' } }),
      expectStatus: 200,
    },
    {
      name: 'Vierte TU am I-Punkt anmelden',
      request: (v) => ({ method: 'POST', path: '/v1/flow/events', body: { type: 'request', location: { plcCode: v.plc.ip }, barcode: v.tu.t4, deviceId: 'SIM' } }),
      expectStatus: 200,
      save: (body, v) => {
        v.orders.push(body.decision.orderNumber);
      },
    },
    { name: 'Auftrag wegen Störung unterbrochen', event: (e, v) => e.type === 'transport-order.interrupted' && e.payload.barcode === v.tu.t4 },

    // --- 5. Node-RED-Programm -------------------------------------------------
    {
      name: 'TU auf dem Klärplatz anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/transport-units', body: { barcode: v.tu.t5, typeCode: v.unitType, location: { id: v.loc.k1 } } }),
      expectStatus: 201,
    },
    {
      name: 'Anfrage am Klärplatz wird an Node-RED übergeben',
      request: (v) => ({ method: 'POST', path: '/v1/flow/events', body: { type: 'request', location: { plcCode: v.plc.k1 }, barcode: v.tu.t5 } }),
      expectStatus: 200,
      check: (body) => (body.decision.outcome === 'DELEGATED' ? null : `Unerwartet: ${body.decision.outcome}`),
    },
    { name: 'Node-RED-Programm sendet Fahrbefehl nach C2', event: (e, v) => e.type === 'flow.command' && e.payload.barcode === v.tu.t5 && e.payload.to.plcCode === v.plc.c2 },

    // --- Aufräumen --------------------------------------------------------------
    ...[0, 1, 2, 3].map((i) => ({
      name: `Aufräumen: Auftrag ${i + 1} stornieren`,
      cleanup: true,
      request: (v) => (v.orders[i] ? { method: 'POST', path: `/v1/transport-orders/${v.orders[i]}/cancel`, body: { reason: 'Aufräumen' } } : null),
    })),
    { name: 'Aufräumen: Störungen entfernen', cleanup: true, request: () => ({ service: 'simulator', method: 'DELETE', path: '/sim/faults' }) },
    ...[0, 1, 2, 3, 4].map((i) => ({
      name: `Aufräumen: Action ${i + 1} löschen`,
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/flow/actions/${v.actions[i]}` }),
    })),
    { name: 'Aufräumen: Route löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/flow/routes/${v.route}` }) },
    // Der Simulator meldet T5 nach dem Fahrbefehl noch an C2. Kommt die Meldung nach dem Löschen an,
    // antwortet das WMS mit 404 – unschädlich, sie steht nur im Simulatorprotokoll.
    ...['t1', 't2', 't3', 't4', 't5'].map((t) => ({
      name: `Aufräumen: TU ${t} löschen`,
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu[t]}` }),
    })),
    ...['ip', 'c1', 'c2', 'h1', 'k1'].map((key) => ({
      name: `Aufräumen: Platz ${key} löschen`,
      cleanup: true,
      request: (v) => (v.loc[key] ? { method: 'DELETE', path: `/v1/locations/${v.loc[key]}` } : null),
      expectStatus: 204,
    })),
    ...['ft', 'hrl', 'nio'].map((g) => ({
      name: `Aufräumen: Gruppe ${g} löschen`,
      cleanup: true,
      request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v[g]}` }),
      expectStatus: 204,
    })),
    { name: 'Aufräumen: TU-Typ löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-unit-types/${v.unitType}` }), expectStatus: 204 },
    { name: 'Aufräumen: Platztyp löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-types/${v.locationType}` }), expectStatus: 204 },
  ],
});
