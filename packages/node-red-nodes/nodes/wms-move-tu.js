'use strict';
const { actionNode, locationRef, required } = require('../lib/common.js');

/** TU auf einen Platz bewegen (z. B. nach einem Scan). Regelverletzungen kommen als Fehler (Catch-Node). */
module.exports = function (RED) {
  function WmsMoveTuNode(config) {
    RED.nodes.createNode(this, config);
    actionNode(RED, this, config, (msg) => {
      const barcode = required(RED, config.barcode || 'msg.payload.barcode', msg, 'Barcode');
      const location = required(RED, config.location || 'msg.payload.location', msg, 'Platz');
      return {
        method: 'POST',
        path: `/v1/transport-units/${encodeURIComponent(String(barcode))}/move`,
        body: { to: locationRef(config.locationKind || 'erpCode', location), mode: config.mode || 'checked' },
      };
    });
  }
  RED.nodes.registerType('wms-move-tu', WmsMoveTuNode);
};
