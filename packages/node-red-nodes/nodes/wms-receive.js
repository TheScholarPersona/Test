'use strict';
const { actionNode, locationRef, required, resolve, spec } = require('../lib/common.js');

/**
 * Wareneingang erfassen: gegen einen Auftrag (Avis) oder ohne Avis (blind).
 * Die TU wird per Barcode bebucht oder mit TU-Typ neu angelegt.
 */
module.exports = function (RED) {
  function WmsReceiveNode(config) {
    RED.nodes.createNode(this, config);
    actionNode(RED, this, config, (msg) => {
      const unitBarcode = resolve(RED, spec(config.unitBarcode, 'msg.payload.barcode'), msg);
      const typeCode = resolve(RED, spec(config.typeCode, 'msg.payload.typeCode'), msg);
      const lot = resolve(RED, spec(config.lot, 'msg.payload.lot'), msg);
      const bestBefore = resolve(RED, spec(config.bestBefore, 'msg.payload.bestBefore'), msg);
      const body = {
        sku: String(required(RED, config.sku || 'msg.payload.sku', msg, 'SKU')),
        quantity: { amount: String(required(RED, config.amount || 'msg.payload.amount', msg, 'Menge')), unit: String(required(RED, config.unit || 'msg.payload.unit', msg, 'Einheit')) },
        unit: { ...(unitBarcode ? { barcode: String(unitBarcode) } : {}), ...(typeCode ? { typeCode: String(typeCode) } : {}) },
        location: locationRef(config.locationKind || 'erpCode', required(RED, config.location || 'msg.payload.location', msg, 'Platz')),
        ...(lot ? { lot: String(lot) } : {}),
        ...(bestBefore ? { bestBefore: String(bestBefore) } : {}),
      };
      if (config.mode === 'order') {
        const orderId = required(RED, config.orderId || 'msg.payload.orderId', msg, 'Auftrag');
        return { method: 'POST', path: `/v1/receiving-orders/${encodeURIComponent(String(orderId))}/captures`, body: { kind: 'quantity', ...body } };
      }
      return { method: 'POST', path: '/v1/receiving-blind-captures', body };
    });
  }
  RED.nodes.registerType('wms-receive', WmsReceiveNode);
};
