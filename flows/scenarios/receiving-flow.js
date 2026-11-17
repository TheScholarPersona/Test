/**
 * Szenario: Wareneingang mit Avis.
 *
 * Avis mit einer Mengenposition anlegen, Teilmenge auf eine neue TU erfassen,
 * Überlieferung wird abgelehnt (Produkt erlaubt sie nicht), Restmenge als
 * Fehlmenge schließen, Bestand und Journal prüfen. Zum Aufräumen wird der
 * Bestand per Korrektur ausgebucht, danach sind TU und Plätze löschbar.
 * Produkt und Auftrag bleiben als Stammdaten bzw. Historie erhalten
 * (eindeutige Kennungen je Lauf).
 * Schrittformat: siehe flows/scenarios/layout-locks.js.
 */
registerScenario({
  id: 'receiving-flow',
  description: 'Avis anlegen, Teilmenge erfassen, Überlieferung abgelehnt, Fehlmenge schließen, Bestand prüfen und ausbuchen.',
  init: (runId) => {
    const s = runId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase();
    return {
      locationType: `SR-${s}`,
      inbound: `SR-${s}-WE`,
      unitType: `SR-${s}`,
      sku: `SR-${s}-ART`,
      orderId: `SR-${s}-AVIS`,
      weCoord: `R${s}/0009/0001/0001/0000`,
      we: null,
      tu: null,
      stockItem: null,
    };
  },
  steps: [
    { name: 'Platztyp anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-types', body: { code: v.locationType } }), expectStatus: 201 },
    { name: 'Wareneingang anlegen', request: (v) => ({ method: 'POST', path: '/v1/location-groups', body: { name: v.inbound } }), expectStatus: 201 },
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
      name: 'Produkt anlegen (ohne Überlieferung)',
      request: (v) => ({ method: 'POST', path: '/v1/products', body: { sku: v.sku, description: 'Szenario receiving-flow', baseUnit: 'PCS' } }),
      expectStatus: 201,
    },
    {
      name: 'Avis mit 10 PCS anlegen',
      request: (v) => ({
        method: 'POST',
        path: '/v1/receiving-orders',
        body: { orderId: v.orderId, supplier: 'Szenario', positions: [{ kind: 'quantity', sku: v.sku, quantity: { amount: '10', unit: 'PCS' } }] },
      }),
      expectStatus: 201,
      check: (body) => (body.state === 'OPEN' && body.positions.length === 1 && body.positions[0].open.amount === '10' ? null : `Unerwartet: ${JSON.stringify(body)}`),
    },
    { name: 'Event receiving-order.created empfangen', event: (e, v) => e.type === 'receiving-order.created' && e.payload.orderId === v.orderId },
    {
      name: '6 PCS auf neue TU erfassen',
      request: (v) => ({
        method: 'POST',
        path: `/v1/receiving-orders/${v.orderId}/captures`,
        body: { kind: 'quantity', sku: v.sku, quantity: { amount: '6', unit: 'PCS' }, unit: { typeCode: v.unitType }, location: { id: v.we }, lot: 'L-1' },
      }),
      expectStatus: 201,
      check: (body) =>
        body.posNo === 1 && body.onHand.amount === '6' && body.order.state === 'IN_PROGRESS' && body.order.positions[0].open.amount === '4'
          ? null
          : `Unerwartet: ${JSON.stringify(body)}`,
      save: (body, v) => {
        v.tu = body.barcode;
      },
    },
    { name: 'Event receiving.captured empfangen', event: (e, v) => e.type === 'receiving.captured' && e.payload.orderId === v.orderId && e.payload.barcode === v.tu },
    { name: 'Event stock.received empfangen', event: (e, v) => e.type === 'stock.received' && e.payload.sku === v.sku && e.payload.barcode === v.tu },
    {
      name: 'Überlieferung (5 PCS bei Rest 4) wird abgelehnt',
      request: (v) => ({
        method: 'POST',
        path: `/v1/receiving-orders/${v.orderId}/captures`,
        body: { kind: 'quantity', sku: v.sku, quantity: { amount: '5', unit: 'PCS' }, unit: { barcode: v.tu }, location: { id: v.we }, lot: 'L-1' },
      }),
      expectStatus: 409,
      check: (body) => (body.code === 'OVERDELIVERY_NOT_ALLOWED' ? null : `Erwartet OVERDELIVERY_NOT_ALLOWED, erhalten ${body.code}`),
    },
    {
      name: 'Position mit Fehlmenge schließen',
      request: (v) => ({ method: 'POST', path: `/v1/receiving-orders/${v.orderId}/positions/1/close`, body: { reason: 'Lieferant liefert nach' } }),
      expectStatus: 200,
      check: (body) =>
        body.positions[0].state === 'SHORT' && body.state === 'PARTIALLY_COMPLETED' ? null : `Unerwartet: ${JSON.stringify({ state: body.state, positions: body.positions })}`,
    },
    {
      name: 'Event receiving-order.state-changed (PARTIALLY_COMPLETED)',
      event: (e, v) => e.type === 'receiving-order.state-changed' && e.payload.orderId === v.orderId && e.payload.state === 'PARTIALLY_COMPLETED',
    },
    {
      name: 'Weitere Erfassung auf abgeschlossenen Auftrag wird abgelehnt',
      request: (v) => ({
        method: 'POST',
        path: `/v1/receiving-orders/${v.orderId}/captures`,
        body: { kind: 'quantity', sku: v.sku, quantity: { amount: '1', unit: 'PCS' }, unit: { barcode: v.tu }, location: { id: v.we } },
      }),
      expectStatus: 409,
      check: (body) => (body.code === 'ORDER_CLOSED' ? null : `Erwartet ORDER_CLOSED, erhalten ${body.code}`),
    },
    {
      name: 'Bestand: 6 PCS mit Charge auf der TU am Wareneingangsplatz',
      request: (v) => ({ method: 'GET', path: `/v1/stock?barcode=${v.tu}` }),
      expectStatus: 200,
      check: (body, v) => {
        const [item] = body.items;
        return body.total === 1 && item.sku === v.sku && item.quantity.amount === '6' && item.lot === 'L-1' && item.location.id === v.we
          ? null
          : `Unerwartet: ${JSON.stringify(body)}`;
      },
      save: (body, v) => {
        v.stockItem = body.items[0].id;
      },
    },
    {
      name: 'Journal enthält den Zugang mit Bezug auf die Position',
      request: (v) => ({ method: 'GET', path: `/v1/stock-bookings?barcode=${v.tu}` }),
      expectStatus: 200,
      check: (body, v) =>
        body.total === 1 && body.items[0].type === 'RECEIPT' && body.items[0].reference === `receiving:${v.orderId}/1` ? null : `Unerwartet: ${JSON.stringify(body)}`,
    },
    {
      name: 'TU mit Bestand kann nicht gelöscht werden',
      request: (v) => ({ method: 'DELETE', path: `/v1/transport-units/${v.tu}` }),
      expectStatus: 409,
      check: (body) => (body.code === 'TU_IN_USE' ? null : `Erwartet TU_IN_USE, erhalten ${body.code}`),
    },
    {
      name: 'Ausbuchen von mehr als vorhanden wird abgelehnt',
      request: (v) => ({ method: 'POST', path: `/v1/stock/${v.stockItem}/corrections`, body: { delta: { amount: '-7', unit: 'PCS' }, reason: 'Szenario' } }),
      expectStatus: 409,
      check: (body) => (body.code === 'STOCK_INSUFFICIENT' ? null : `Erwartet STOCK_INSUFFICIENT, erhalten ${body.code}`),
    },
    {
      name: 'Bestand vollständig ausbuchen',
      request: (v) => ({ method: 'POST', path: `/v1/stock/${v.stockItem}/corrections`, body: { delta: { amount: '-6', unit: 'PCS' }, reason: 'Szenario receiving-flow' } }),
      expectStatus: 200,
      check: (body) => (body.removed === true && body.onHand.amount === '0' ? null : `Unerwartet: ${JSON.stringify(body)}`),
      save: (body, v) => {
        v.stockItem = null;
      },
    },
    { name: 'Event stock.corrected empfangen', event: (e, v) => e.type === 'stock.corrected' && e.payload.barcode === v.tu && e.payload.onHand.amount === '0' },
    {
      name: 'Aufräumen: Restbestand ausbuchen',
      cleanup: true,
      request: (v) => (v.stockItem ? { method: 'POST', path: `/v1/stock/${v.stockItem}/corrections`, body: { delta: { amount: '-6', unit: 'PCS' }, reason: 'Aufräumen' } } : null),
    },
    { name: 'Aufräumen: TU löschen', cleanup: true, request: (v) => (v.tu ? { method: 'DELETE', path: `/v1/transport-units/${v.tu}` } : null), expectStatus: 204 },
    { name: 'Aufräumen: Wareneingangsplatz löschen', cleanup: true, request: (v) => (v.we ? { method: 'DELETE', path: `/v1/locations/${v.we}` } : null), expectStatus: 204 },
    { name: 'Aufräumen: Wareneingang löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-groups/${v.inbound}` }), expectStatus: 204 },
    { name: 'Aufräumen: TU-Typ löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/transport-unit-types/${v.unitType}` }), expectStatus: 204 },
    { name: 'Aufräumen: Platztyp löschen', cleanup: true, request: (v) => ({ method: 'DELETE', path: `/v1/location-types/${v.locationType}` }), expectStatus: 204 },
  ],
});
