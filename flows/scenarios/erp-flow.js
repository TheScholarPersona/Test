/**
 * Szenario: ERP-Anbindung über den Beispiel-Flow „ERP-Anbindung“.
 *
 * Artikel kommen als JSON (zweimal – das zweite Mal als Duplikat erkannt), ein Auslagerauftrag als CSV und
 * eine Bestellung als SAP-IDoc (ORDERS) → Avis. Die Erfassung gegen das Avis erzeugt eine Rückmeldung, die
 * der Flow abholt, an den ERP-Simulator schickt und quittiert. Alle Daten sind erfunden.
 * Schrittformat: siehe flows/scenarios/layout-locks.js; `service: 'node-red'` ruft Endpunkte dieses Node-RED.
 */
registerScenario({
  id: 'erp-flow',
  description: 'ERP-Anbindung: Artikel (JSON, idempotent), Auslagerauftrag (CSV), Bestellung (SAP IDoc) → Avis; Wareneingang als Rückmeldung zugestellt und quittiert.',
  init: (runId) => {
    const s = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    const docnum = String(Date.now()).slice(-12);
    return {
      s,
      docnum,
      locationType: `SE-${s}`,
      group: `SE-${s}-G`,
      unitType: `SE-${s}`,
      sku: `SE-${s}-ART`,
      po: `SE${s}PO`,
      order: `SE-${s}-LS`,
      tu: `SE-${s}-T1`,
      erp: { we: `SE-${s}-WE`, vs: `SE-${s}-VS` },
      coords: { we: `E${s}/0001/0001/0001/0000`, vs: `E${s}/0002/0001/0001/0000` },
      loc: {},
    };
  },
  steps: [
    { name: 'Platztyp anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.locationType } }), expectStatus: 201 },
    { name: 'Gruppe anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.group } }), expectStatus: 201 },
    ...['we', 'vs'].map((key) => ({
      name: `Platz ${key} anlegen`,
      request: (v) => ({ method: 'POST', path: '/v1/locations', body: { locationId: v.coords[key], erpCode: v.erp[key], typeCode: v.locationType, groupName: v.group, maxTransportUnits: 10 } }),
      expectStatus: 201,
      save: (body, v) => {
        v.loc[key] = body.id;
      },
    })),
    { name: 'TU-Typ anlegen', request: (v) => ({ method: 'POST', path: '/v1/transport-unit-types', body: { code: v.unitType } }), expectStatus: 201 },
    ...[1, 2].map((n) => ({
      name: n === 1 ? 'Artikel als JSON vom ERP' : 'Dieselbe Nachricht noch einmal: Duplikat, nichts doppelt',
      request: (v) => ({
        service: 'node-red',
        method: 'POST',
        path: '/examples/erp/json',
        body: { messageId: `SE-${v.s}-MAT`, type: 'product', data: { sku: v.sku, description: 'Musterartikel ERP', baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '6' }] } },
      }),
      expectStatus: 200,
      check: (body) => (body.processed === 1 && body.duplicates === (n === 1 ? 0 : 1) ? null : `Unerwartet: ${JSON.stringify(body)}`),
    })),
    {
      name: 'Auslagerauftrag als CSV vom ERP',
      request: (v) => ({
        service: 'node-red',
        method: 'POST',
        path: '/examples/erp/csv/outbound-order',
        headers: { 'content-type': 'text/csv', 'x-filename': `auftraege-${v.s}.csv` },
        body: ['orderId;customer;target;shipToName;shipToCity;sku;amount;unit', `${v.order};Musterkunde;${v.erp.vs};Musterkunde GmbH;Musterstadt;${v.sku};2;KAR`].join('\n'),
      }),
      expectStatus: 200,
      check: (body) => (body.processed === 1 && body.results[0].messageId.endsWith(`:${body.results[0].reference}`) ? null : `Unerwartet: ${JSON.stringify(body)}`),
    },
    {
      name: 'Auslagerauftrag im WMS: Packplatz, Lieferadresse, 12 PCS',
      request: (v) => ({ method: 'GET', path: `/v1/outbound-orders/${v.order}` }),
      expectStatus: 200,
      check: (body, v) =>
        body.target && body.target.locationId === v.coords.vs && body.shipTo && body.shipTo.name === 'Musterkunde GmbH' && body.lines[0].quantity.amount === '12' ? null : `Unerwartet: ${JSON.stringify(body)}`,
    },
    {
      name: 'Bestellung als SAP-IDoc (ORDERS05) vom ERP',
      request: (v) => ({
        service: 'node-red',
        method: 'POST',
        path: '/examples/erp/idoc',
        headers: { 'content-type': 'application/xml' },
        body: `<?xml version="1.0"?><ORDERS05><IDOC BEGIN="1"><EDI_DC40 SEGMENT="1"><DOCNUM>${v.docnum}</DOCNUM><IDOCTYP>ORDERS05</IDOCTYP></EDI_DC40><E1EDK01 SEGMENT="1"><BELNR>${v.po}</BELNR></E1EDK01><E1EDP01 SEGMENT="1"><POSEX>00010</POSEX><MENGE>6.000</MENGE><MENEE>ST</MENEE><E1EDP19 SEGMENT="1"><QUALF>002</QUALF><IDTNR>${v.sku}</IDTNR></E1EDP19></E1EDP01></IDOC></ORDERS05>`,
      }),
      expectStatus: 200,
      check: (body) => (body.processed === 1 ? null : `Unerwartet: ${JSON.stringify(body)}`),
    },
    {
      name: 'Avis im WMS mit Position 10',
      request: (v) => ({ method: 'GET', path: `/v1/receiving-orders/${v.po}` }),
      expectStatus: 200,
      check: (body, v) => (body.positions[0].posNo === 10 && body.positions[0].sku === v.sku ? null : `Unerwartet: ${JSON.stringify(body.positions)}`),
    },
    {
      name: 'Ware gegen das Avis erfassen',
      request: (v) => ({ method: 'POST', path: `/v1/receiving-orders/${v.po}/captures`, body: { kind: 'quantity', sku: v.sku, quantity: { amount: '6', unit: 'PCS' }, unit: { barcode: v.tu, typeCode: v.unitType }, location: { erpCode: v.erp.we } } }),
      expectStatus: 201,
    },
    {
      name: 'Rückmeldungen abholen, an den ERP-Simulator senden und quittieren',
      request: () => ({ service: 'node-red', method: 'POST', path: '/examples/erp/export', body: {} }),
      expectStatus: 200,
      check: (body) => (typeof body.claimed === 'number' ? null : `Unerwartet: ${JSON.stringify(body)}`),
    },
    { name: 'Event erp-message.sent für den Wareneingang', event: (e, v) => e.type === 'erp-message.sent' && e.payload.reference === v.po && e.payload.type === 'goods-receipt' },
    {
      name: 'ERP-Simulator hat den Wareneingang mit Bestellbezug erhalten',
      request: () => ({ service: 'node-red', method: 'GET', path: '/examples/erp/simulator?type=goods-receipt' }),
      expectStatus: 200,
      check: (body, v) => {
        const hit = body.items.find((r) => r.message.data.orderId === v.po);
        return hit && hit.message.data.posNo === 10 && hit.message.data.quantity.amount === '6' ? null : `Nicht angekommen: ${JSON.stringify(body.items.slice(-3))}`;
      },
    },
    {
      name: 'Im WMS-Protokoll zugestellt, mit Beleg des ERP',
      request: (v) => ({ method: 'GET', path: `/v1/erp/messages?direction=OUT&reference=${v.po}` }),
      expectStatus: 200,
      check: (body) => {
        const m = body.items[0];
        return m && m.type === 'goods-receipt' && m.state === 'SENT' && m.result && /^50\d{8}$/.test(m.result.erpReference) ? null : `Unerwartet: ${JSON.stringify(body.items)}`;
      },
    },
    { name: 'Aufräumen: Auslagerauftrag stornieren', cleanup: true, request: (v) => ({ method: 'POST', path: `/v1/outbound-orders/${v.order}/cancel`, body: {} }) },
    {
      name: 'Aufräumen: Bestand der TU lesen',
      cleanup: true,
      request: (v) => ({ method: 'GET', path: `/v1/stock?barcode=${v.tu}` }),
      save: (body, v) => {
        v.stockItem = body.items && body.items[0] ? body.items[0].id : null;
      },
    },
    {
      name: 'Aufräumen: Bestand ausbuchen',
      cleanup: true,
      request: (v) => (v.stockItem ? { method: 'POST', path: `/v1/stock/${v.stockItem}/corrections`, body: { delta: { amount: '-6', unit: 'PCS' }, reason: 'Aufräumen' } } : null),
    },
    { name: 'Aufräumen: Avis abschließen', cleanup: true, request: (v) => ({ method: 'POST', path: `/v1/receiving-orders/${v.po}/complete`, body: {} }) },
    { name: 'Aufräumen: TU löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu}` }) },
    ...['we', 'vs'].map((key) => ({ name: `Aufräumen: Platz ${key} löschen`, cleanup: true, request: (v) => (v.loc[key] ? { method: 'DELETE', path: `/v1/locations/${v.loc[key]}` } : null), expectStatus: 204 })),
    { name: 'Aufräumen: Gruppe löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.group}` }), expectStatus: 204 },
    { name: 'Aufräumen: TU-Typ löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-unit-types/${v.unitType}` }), expectStatus: 204 },
    { name: 'Aufräumen: Platztyp löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-types/${v.locationType}` }), expectStatus: 204 },
  ],
});
