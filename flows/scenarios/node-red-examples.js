/**
 * Szenario: Beispiel-Flows mit den WMS-Nodes.
 *
 * ERP-CSV → Wareneingang: zwei gültige Zeilen werden erfasst, eine Zeile mit
 * unbekanntem Produkt wird mit Fehlercode gemeldet (die anderen laufen weiter).
 * Scan → TU bewegen: erster Scan bucht, zweiter auf den vollen Platz wird
 * abgelehnt – die Regelverletzung kommt als Fehler im Flow an und wird dem
 * Scanner als HTTP 409 mit Code beantwortet.
 * Schrittformat: siehe flows/scenarios/layout-locks.js; `service: 'node-red'` ruft Endpunkte dieses Node-RED.
 */
registerScenario({
  id: 'node-red-examples',
  description: 'Beispiel-Flows: ERP-CSV → Wareneingang (mit Fehlerzeile), Scan → TU bewegen (Regelverletzung als 409).',
  init: (runId) => {
    const s = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    return {
      locationType: `SN-${s}`,
      group: `SN-${s}-G`,
      unitType: `SN-${s}`,
      sku: `SN-${s}-ART`,
      erp: { we: `SN-${s}-WE`, a: `SN-${s}-A` },
      coords: { we: `N${s}/0001/0001/0001/0000`, a: `N${s}/0002/0001/0001/0000` },
      loc: {},
      tu: { t1: `SN-${s}-T1`, t2: `SN-${s}-T2` },
    };
  },
  steps: [
    { name: 'Platztyp anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.locationType } }), expectStatus: 201 },
    { name: 'Gruppe anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.group } }), expectStatus: 201 },
    ...[
      ['we', 10],
      ['a', 1],
    ].map(([key, max]) => ({
      name: `Platz ${key} anlegen (${max} TU)`,
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.coords[key], erpCode: v.erp[key], typeCode: v.locationType, groupName: v.group, maxTransportUnits: max } }),
      expectStatus: 201,
      save: (body, v) => {
        v.loc[key] = body.id;
      },
    })),
    { name: 'TU-Typ anlegen', request: (v) => ({ method: 'POST', path: '/v1/transport-unit-types', body: { code: v.unitType } }), expectStatus: 201 },
    { name: 'Produkt anlegen', request: (v) => ({ method: 'POST', path: '/v1/products', body: { sku: v.sku, baseUnit: 'PCS' } }), expectStatus: 201 },
    {
      name: 'ERP-CSV mit drei Zeilen (eine mit unbekanntem Produkt) senden',
      request: (v) => ({
        service: 'node-red',
        method: 'POST',
        path: '/examples/erp-receipts',
        headers: { 'content-type': 'text/csv' },
        body: [
          'sku;menge;einheit;tu;tu_typ;platz;charge;mhd',
          `${v.sku};10;PCS;${v.tu.t1};${v.unitType};${v.erp.we};L1;`,
          `${v.sku};5;PCS;${v.tu.t2};${v.unitType};${v.erp.we};;`,
          `UNBEKANNT-${v.sku};1;PCS;;${v.unitType};${v.erp.we};;`,
        ].join('\n'),
      }),
      expectStatus: 200,
      check: (body) => {
        const failed = (body.results || []).filter((r) => !r.ok);
        return body.ok === 2 && body.failed === 1 && failed[0].line === 4 && failed[0].code === 'PRODUCT_NOT_FOUND' ? null : `Unerwartet: ${JSON.stringify(body)}`;
      },
    },
    { name: 'Event stock.received für die erste Zeile', event: (e, v) => e.type === 'stock.received' && e.payload.barcode === v.tu.t1 && e.payload.lot === 'L1' },
    {
      name: 'Bestand: 15 PCS auf zwei TUs',
      request: (v) => ({ method: 'GET', path: `/v1/stock/summary?sku=${v.sku}` }),
      expectStatus: 200,
      check: (body) => (body.items[0] && body.items[0].onHand.amount === '15' && body.items[0].units === 2 ? null : `Unerwartet: ${JSON.stringify(body.items)}`),
    },
    {
      name: 'Scan: TU 1 auf Platz A',
      request: (v) => ({ service: 'node-red', method: 'POST', path: '/examples/scan', body: { barcode: v.tu.t1, location: v.erp.a } }),
      expectStatus: 200,
      check: (body, v) => (body.ok === true && body.location.erpCode === v.erp.a ? null : `Unerwartet: ${JSON.stringify(body)}`),
    },
    {
      name: 'Scan: TU 2 auf den vollen Platz A wird abgelehnt (Fehler im Flow → 409)',
      request: (v) => ({ service: 'node-red', method: 'POST', path: '/examples/scan', body: { barcode: v.tu.t2, location: v.erp.a } }),
      expectStatus: 409,
      check: (body) => (body.ok === false && body.code === 'PLACEMENT_REJECTED' ? null : `Unerwartet: ${JSON.stringify(body)}`),
    },
    ...['t1', 't2'].map((t) => ({
      name: `Aufräumen: Bestand auf TU ${t} lesen`,
      cleanup: true,
      request: (v) => ({ method: 'GET', path: `/v1/stock?barcode=${v.tu[t]}` }),
      save: (body, v) => {
        v[`rest_${t}`] = (body.items || [])[0] || null;
      },
    })),
    ...['t1', 't2'].map((t) => ({
      name: `Aufräumen: Bestand auf TU ${t} ausbuchen`,
      cleanup: true,
      request: (v) => {
        const rest = v[`rest_${t}`];
        return rest ? { method: 'POST', path: `/v1/stock/${rest.id}/corrections`, body: { delta: { amount: `-${rest.quantity.amount}`, unit: 'PCS' }, reason: 'Aufräumen' } } : null;
      },
    })),
    ...['t1', 't2'].map((t) => ({ name: `Aufräumen: TU ${t} löschen`, cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu[t]}` }) })),
    ...['we', 'a'].map((key) => ({
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
