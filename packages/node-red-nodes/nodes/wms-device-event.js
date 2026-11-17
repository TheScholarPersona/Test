'use strict';
const { actionNode, locationRef, required, resolve, spec } = require('../lib/common.js');

/** Geräte-Ereignis an den Materialfluss melden (Protokoll-Adapter einer Anlage); `msg.payload` ist die Entscheidung samt Fahrbefehl. */
module.exports = function (RED) {
  function WmsDeviceEventNode(config) {
    RED.nodes.createNode(this, config);
    actionNode(RED, this, config, (msg) => {
      const barcode = resolve(RED, spec(config.barcode, 'msg.payload.barcode'), msg);
      const code = resolve(RED, config.code, msg);
      const message = resolve(RED, config.message, msg);
      const type = String(resolve(RED, config.eventType, msg) || 'request');
      return {
        method: 'POST',
        path: '/v1/flow/events',
        body: {
          type,
          location: locationRef(config.locationKind || 'plcCode', required(RED, config.location || 'msg.payload.location', msg, 'Platz')),
          ...(barcode ? { barcode: String(barcode) } : {}),
          ...(config.deviceId ? { deviceId: String(config.deviceId) } : {}),
          ...(code ? { code: String(code) } : {}),
          ...(message ? { message: String(message) } : {}),
          ...(config.dryRun ? { dryRun: true } : {}),
        },
      };
    });
  }
  RED.nodes.registerType('wms-device-event', WmsDeviceEventNode);
};
