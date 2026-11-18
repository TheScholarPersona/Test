'use strict';
const { WmsError, handleError, resolve } = require('../lib/common.js');

/**
 * Quittiert eine ERP-Rückmeldung (aus „ERP ausgeben“): Erfolg → `ack`, Fehler → `nack` (das WMS versucht es später
 * erneut). Als Fehler gilt `msg.error` (z. B. vom Catch-Node) oder ein HTTP-Status ab 300 (HTTP-Request-Node).
 */
module.exports = function (RED) {
  function WmsErpAckNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.server = RED.nodes.getNode(config.server);
    node.errorOutput = config.errorOutput === true || config.errorOutput === 'true';
    node.on('input', async (msg, send, done) => {
      try {
        if (!node.server) throw new WmsError('NO_CONFIG', 'Keine WMS-Verbindung konfiguriert', 0);
        const id = msg.erp && msg.erp.id;
        if (!id) throw new WmsError('ERP_NO_MESSAGE', 'msg.erp.id fehlt – Nachricht kommt nicht aus „ERP ausgeben“', 0);
        const status = Number(msg.statusCode);
        const failure = msg.error ? String(msg.error.message ?? msg.error) : status >= 300 ? `HTTP ${status}${typeof msg.payload === 'string' ? `: ${msg.payload.slice(0, 500)}` : ''}` : null;
        if (failure) {
          const r = await node.server.request('POST', `/v1/erp/messages/${id}/nack`, { error: failure.slice(0, 2000) });
          msg.payload = r.body;
          node.status({ fill: 'yellow', shape: 'ring', text: `nicht zugestellt (${r.body.state})` });
        } else {
          const reference = resolve(RED, config.erpReference, msg);
          const r = await node.server.request('POST', `/v1/erp/messages/${id}/ack`, reference ? { erpReference: String(reference).slice(0, 100) } : {});
          msg.payload = r.body;
          node.status({ fill: 'green', shape: 'dot', text: 'zugestellt' });
        }
        delete msg.error;
        send(node.errorOutput ? [msg, null] : msg);
        done();
      } catch (error) {
        handleError(node, msg, error, send, done);
      }
    });
  }
  RED.nodes.registerType('wms-erp-ack', WmsErpAckNode);
};
