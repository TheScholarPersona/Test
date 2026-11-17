/**
 * Szenario: Bestandsführung.
 *
 * Zugang (Blind-Erfassung) in Stück, Reservierung in Kartons, Abgang gegen
 * die Reservierung, Umbuchung auf eine zweite TU, Inventur dieser TU mit
 * Differenz, Inventursperre, Abschluss bucht die Differenz. Zum Aufräumen wird
 * der Restbestand ausgebucht. Das Produkt bleibt als Stammdatum erhalten.
 * Schrittformat: siehe flows/scenarios/layout-locks.js.
 */
registerScenario({
  id: 'stock-flow',
  description: 'Bestand: Reservierung und Abgang in Kartons, Umbuchung zwischen TUs, Inventur mit Sperre und Differenzbuchung.',
  init: (runId) => {
    const s = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    return {
      locationType: `SB-${s}`,
      group: `SB-${s}-G`,
      unitType: `SB-${s}`,
      sku: `SB-${s}-ART`,
      coords: { a: `B${s}/0001/0001/0001/0000`, b: `B${s}/0002/0001/0001/0000` },
      loc: {},
      tu: { a: `SB-${s}-A`, b: `SB-${s}-B` },
      itemA: null,
      itemB: null,
      reservation: null,
      count: null,
    };
  },
  steps: [
    { name: 'Platztyp anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.locationType } }), expectStatus: 201 },
    { name: 'Gruppe anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.group } }), expectStatus: 201 },
    ...['a', 'b'].map((key) => ({
      name: `Platz ${key} anlegen`,
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.coords[key], typeCode: v.locationType, groupName: v.group, maxTransportUnits: 10 } }),
      expectStatus: 201,
      save: (body, v) => {
        v.loc[key] = body.id;
      },
    })),
    { name: 'TU-Typ anlegen', request: (v) => ({ method: 'POST', path: '/v1/transport-unit-types', body: { code: v.unitType } }), expectStatus: 201 },
    {
      name: 'Produkt in PCS mit Karton (12 PCS) anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/products', body: { sku: v.sku, baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '12' }] } }),
      expectStatus: 201,
    },
    {
      name: 'Zugang 60 PCS auf TU A',
      request: (v) => ({
        method: 'POST',
        path: '/v1/receiving-blind-captures',
        body: { sku: v.sku, quantity: { amount: '60', unit: 'PCS' }, unit: { barcode: v.tu.a, typeCode: v.unitType }, location: { id: v.loc.a } },
      }),
      expectStatus: 201,
    },
    {
      name: 'Bestandsposten auf TU A lesen',
      request: (v) => ({ method: 'GET', path: `/v1/stock?barcode=${v.tu.a}` }),
      expectStatus: 200,
      check: (body) => (body.total === 1 && body.items[0].available.amount === '60' ? null : `Unerwartet: ${JSON.stringify(body)}`),
      save: (body, v) => {
        v.itemA = body.items[0].id;
      },
    },
    {
      name: '3 Kartons reservieren (36 PCS)',
      request: (v) => ({ method: 'POST', path: `/v1/stock/${v.itemA}/reservations`, body: { quantity: { amount: '3', unit: 'KAR' }, reference: 'SZ-KOMM' } }),
      expectStatus: 201,
      check: (body) => (body.quantity.amount === '36' ? null : `Unerwartet: ${JSON.stringify(body)}`),
      save: (body, v) => {
        v.reservation = body.id;
      },
    },
    { name: 'Event stock.reserved', event: (e, v) => e.type === 'stock.reserved' && e.payload.reservationId === v.reservation },
    {
      name: 'Abgang über die verfügbare Menge wird abgelehnt (STOCK_RESERVED)',
      request: (v) => ({ method: 'POST', path: `/v1/stock/${v.itemA}/issues`, body: { quantity: { amount: '25', unit: 'PCS' }, reference: 'SZ-X' } }),
      expectStatus: 409,
      check: (body) => (body.code === 'STOCK_RESERVED' ? null : `Erwartet STOCK_RESERVED, erhalten ${body.code}`),
    },
    {
      name: 'Abgang 3 Kartons gegen die Reservierung',
      request: (v) => ({ method: 'POST', path: `/v1/stock/${v.itemA}/issues`, body: { quantity: { amount: '3', unit: 'KAR' }, reference: 'SZ-KOMM', reservationId: v.reservation } }),
      expectStatus: 200,
      check: (body) => (body.onHand.amount === '24' ? null : `Unerwartet: ${JSON.stringify(body)}`),
    },
    { name: 'Event stock.issued', event: (e, v) => e.type === 'stock.issued' && e.payload.reservationId === v.reservation },
    {
      name: 'TU B anlegen',
      request: (v) => ({ method: 'POST', path: '/v1/transport-units', body: { barcode: v.tu.b, typeCode: v.unitType, location: { id: v.loc.b } } }),
      expectStatus: 201,
    },
    {
      name: '1 Karton auf TU B umbuchen',
      request: (v) => ({ method: 'POST', path: `/v1/stock/${v.itemA}/transfers`, body: { to: v.tu.b, quantity: { amount: '1', unit: 'KAR' }, reference: 'SZ-UMPACK' } }),
      expectStatus: 200,
      check: (body) => (body.from.onHand.amount === '12' && body.to.onHand.amount === '12' ? null : `Unerwartet: ${JSON.stringify(body)}`),
      save: (body, v) => {
        v.itemB = body.to.id;
      },
    },
    { name: 'Event stock.transferred', event: (e, v) => e.type === 'stock.transferred' && e.payload.from === v.tu.a && e.payload.to === v.tu.b },
    {
      name: 'Summe je Platz: je 12 PCS auf A und B',
      request: (v) => ({ method: 'GET', path: `/v1/stock/summary?by=location&sku=${v.sku}` }),
      expectStatus: 200,
      check: (body) => (body.total === 2 && body.items.every((r) => r.onHand.amount === '12') ? null : `Unerwartet: ${JSON.stringify(body.items)}`),
    },
    {
      name: 'Inventur für TU B öffnen',
      request: (v) => ({ method: 'POST', path: '/v1/stock-counts', body: { barcode: v.tu.b, reference: 'Szenario' } }),
      expectStatus: 201,
      check: (body) => (body.state === 'OPEN' && body.lines.length === 1 && body.lines[0].expected.amount === '12' ? null : `Unerwartet: ${JSON.stringify(body)}`),
      save: (body, v) => {
        v.count = body.number;
      },
    },
    {
      name: 'Buchung auf TU B während der Inventur wird abgelehnt (COUNT_IN_PROGRESS)',
      request: (v) => ({ method: 'POST', path: `/v1/stock/${v.itemB}/issues`, body: { quantity: { amount: '1', unit: 'PCS' }, reference: 'SZ-X' } }),
      expectStatus: 409,
      check: (body) => (body.code === 'COUNT_IN_PROGRESS' ? null : `Erwartet COUNT_IN_PROGRESS, erhalten ${body.code}`),
    },
    {
      name: 'Gezählt: 10 PCS',
      request: (v) => ({ method: 'POST', path: `/v1/stock-counts/${v.count}/result`, body: { lines: [{ sku: v.sku, quantity: { amount: '10', unit: 'PCS' } }], countedBy: 'node-red' } }),
      expectStatus: 200,
      check: (body) => (body.state === 'COUNTED' && body.lines[0].difference.amount === '-2' ? null : `Unerwartet: ${JSON.stringify(body.lines)}`),
    },
    {
      name: 'Inventur abschließen',
      request: (v) => ({ method: 'POST', path: `/v1/stock-counts/${v.count}/close` }),
      expectStatus: 200,
      check: (body) => (body.state === 'CLOSED' ? null : `Unerwartet: ${body.state}`),
    },
    { name: 'Event stock-count.changed (CLOSED, 1 Differenz)', event: (e, v) => e.type === 'stock-count.changed' && e.payload.number === v.count && e.payload.state === 'CLOSED' && e.payload.differences === 1 },
    {
      name: 'Journal: Differenz -2 mit Bezug auf die Inventur',
      request: (v) => ({ method: 'GET', path: `/v1/stock-bookings?reference=count:${v.count}` }),
      expectStatus: 200,
      check: (body) => (body.total === 1 && body.items[0].type === 'CORRECTION' && body.items[0].quantity.amount === '-2' ? null : `Unerwartet: ${JSON.stringify(body.items)}`),
    },
    {
      name: 'Bestand auf TU B: 10 PCS, wieder buchbar',
      request: (v) => ({ method: 'POST', path: `/v1/stock/${v.itemB}/issues`, body: { quantity: { amount: '10', unit: 'PCS' }, reference: 'SZ-RAUS' } }),
      expectStatus: 200,
      check: (body) => (body.removed === true ? null : `Unerwartet: ${JSON.stringify(body)}`),
      save: (body, v) => {
        v.itemB = null;
      },
    },
    {
      name: 'Aufräumen: Inventur abbrechen (falls offen)',
      cleanup: true,
      request: (v) => (v.count ? { method: 'POST', path: `/v1/stock-counts/${v.count}/cancel` } : null),
    },
    {
      name: 'Aufräumen: Reservierung aufheben (falls noch vorhanden)',
      cleanup: true,
      request: (v) => (v.reservation ? { method: 'DELETE', path: `/v1/stock-reservations/${v.reservation}` } : null),
    },
    ...['a', 'b'].map((key) => ({
      name: `Aufräumen: Bestand auf TU ${key} lesen`,
      cleanup: true,
      request: (v) => ({ method: 'GET', path: `/v1/stock?barcode=${v.tu[key]}` }),
      save: (body, v) => {
        v[`rest_${key}`] = (body.items || []).map((i) => ({ id: i.id, amount: i.quantity.amount }));
      },
    })),
    ...['a', 'b'].flatMap((key) =>
      [0, 1].map((i) => ({
        name: `Aufräumen: Restbestand ${i + 1} auf TU ${key} ausbuchen`,
        cleanup: true,
        request: (v) => {
          const rest = (v[`rest_${key}`] || [])[i];
          return rest ? { method: 'POST', path: `/v1/stock/${rest.id}/corrections`, body: { delta: { amount: `-${rest.amount}`, unit: 'PCS' }, reason: 'Aufräumen' } } : null;
        },
      })),
    ),
    ...['a', 'b'].map((key) => ({ name: `Aufräumen: TU ${key} löschen`, cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu[key]}` }) })),
    ...['a', 'b'].map((key) => ({
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
