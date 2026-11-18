'use strict';
const { WmsError, handleError, resolve } = require('../lib/common.js');
const { toCanonical } = require('../lib/erp/index.js');

/**
 * ERP → WMS: übersetzt eine Datei bzw. einen Webhook-Body (JSON, CSV, SAP IDoc) ins kanonische Format und
 * übergibt jede Nachricht an `POST /v1/erp/inbound`. Fachliche Fehler stehen im ERP-Protokoll des WMS.
 */
module.exports = function (RED) {
  function WmsErpInNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.server = RED.nodes.getNode(config.server);
    node.errorOutput = config.errorOutput === true || config.errorOutput === 'true';
    node.on('input', async (msg, send, done) => {
      try {
        if (!node.server) throw new WmsError('NO_CONFIG', 'Keine WMS-Verbindung konfiguriert', 0);
        let options = {};
        if (config.options) {
          try {
            options = JSON.parse(config.options);
          } catch {
            throw new WmsError('ERP_CONFIG', 'Optionen sind kein gültiges JSON', 0);
          }
        }
        const input = Buffer.isBuffer(msg.payload) ? msg.payload.toString('utf8') : msg.payload;
        const prefix = resolve(RED, config.messageIdPrefix || 'msg.filename', msg);
        const target = resolve(RED, config.target, msg);
        let messages;
        try {
          messages = toCanonical(config.format || 'json', input, {
            ...options,
            kind: msg.erpKind || config.kind || options.kind,
            ...(prefix ? { messageIdPrefix: String(prefix).split(/[\\/]/).pop() } : {}),
            ...(target ? { target: String(target) } : {}),
          });
        } catch (error) {
          throw new WmsError('ERP_FORMAT', error.message, 0);
        }
        node.status({ fill: 'blue', shape: 'dot', text: `${messages.length} Nachricht(en)` });
        const results = [];
        for (const message of messages) {
          const response = await node.server.request('POST', '/v1/erp/inbound', message);
          const m = response.body.message;
          results.push({ messageId: m.messageId, type: m.type, reference: m.reference, state: m.state, duplicate: response.body.duplicate, lastError: m.lastError });
        }
        const failed = results.filter((r) => r.state === 'FAILED').length;
        msg.payload = { total: results.length, processed: results.filter((r) => r.state === 'PROCESSED').length, failed, duplicates: results.filter((r) => r.duplicate).length, results };
        node.status({ fill: failed ? 'yellow' : 'green', shape: 'dot', text: `${results.length} übergeben${failed ? `, ${failed} fehlerhaft` : ''}` });
        send(node.errorOutput ? [msg, null] : msg);
        done();
      } catch (error) {
        handleError(node, msg, error, send, done);
      }
    });
  }
  RED.nodes.registerType('wms-erp-in', WmsErpInNode);
};
