'use strict';
const { WmsError, actionNode, required, resolve } = require('../lib/common.js');

/**
 * Beliebiger Aufruf der WMS-API. Platzhalter `{name}` im Pfad werden aus
 * `msg.params.name`, sonst `msg.payload.name` gefüllt. `msg.method`/`msg.path` überschreiben die Einstellung.
 */
module.exports = function (RED) {
  function WmsApiNode(config) {
    RED.nodes.createNode(this, config);
    actionNode(RED, this, config, (msg) => {
      const method = String(msg.method || config.method || 'GET').toUpperCase();
      const template = required(RED, msg.path || config.path, msg, 'Pfad');
      const path = String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => {
        const value = (msg.params && msg.params[name]) ?? (msg.payload && typeof msg.payload === 'object' ? msg.payload[name] : undefined);
        if (value === undefined) throw new WmsError('INPUT_MISSING', `Platzhalter {${name}} ist weder in msg.params noch in msg.payload`, 0, { placeholder: name });
        return encodeURIComponent(String(value));
      });
      const body = method === 'GET' || method === 'DELETE' ? undefined : (resolve(RED, config.body || 'msg.payload', msg) ?? {});
      return { method, path, body };
    });
  }
  RED.nodes.registerType('wms-api', WmsApiNode);
};
