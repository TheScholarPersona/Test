'use strict';
const { WmsError, handleError } = require('../lib/common.js');
const { fromCanonical } = require('../lib/erp/index.js');

/**
 * WMS → ERP: holt fällige Rückmeldungen ab (`POST /v1/erp/outbound/claim`) und gibt je Rückmeldung eine
 * Nachricht im Zielformat aus: `msg.payload` (Inhalt), `msg.filename`, `msg.headers`, `msg.erp` (für die Quittung).
 * Danach senden (HTTP, Datei …) und mit „ERP quittieren“ bestätigen. Nicht übersetzbare Rückmeldungen werden
 * sofort als Fehlversuch gemeldet.
 */
module.exports = function (RED) {
  function WmsErpOutNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.server = RED.nodes.getNode(config.server);
    node.errorOutput = config.errorOutput === true || config.errorOutput === 'true';
    node.on('input', async (msg, send, done) => {
      try {
        if (!node.server) throw new WmsError('NO_CONFIG', 'Keine WMS-Verbindung konfiguriert', 0);
        const options = config.options ? JSON.parse(config.options) : {};
        const types = String(config.types || '').split(',').map((t) => t.trim()).filter(Boolean);
        const limit = Number(config.limit) || 20;
        const query = `?limit=${limit}${types.length ? `&type=${encodeURIComponent(types.join(','))}` : ''}`;
        const response = await node.server.request('POST', `/v1/erp/outbound/claim${query}`);
        const items = response.body.items ?? [];
        let sent = 0;
        for (const item of items) {
          let file;
          try {
            file = fromCanonical(config.format || 'json', item.message, options);
          } catch (error) {
            await node.server.request('POST', `/v1/erp/messages/${item.id}/nack`, { error: `Übersetzung: ${error.message}` });
            node.warn(`ERP-Rückmeldung ${item.message.type} ${item.id}: ${error.message}`);
            continue;
          }
          const out = RED.util.cloneMessage(msg);
          out.payload = file.body;
          out.filename = config.directory ? `${String(config.directory).replace(/\/$/, '')}/${file.fileName}` : file.fileName;
          out.headers = { 'content-type': file.contentType };
          out.erp = { id: item.id, messageId: item.message.messageId, type: item.message.type, attempts: item.attempts };
          out.erpMessage = item.message;
          send(node.errorOutput ? [out, null] : out);
          sent += 1;
        }
        node.status({ fill: 'green', shape: 'dot', text: `${sent} von ${items.length} ausgegeben` });
        if (config.summary === true || config.summary === 'true') {
          // Zusammenfassung am Ende (ohne msg.erp), z. B. für die Antwort eines HTTP-Endpunkts.
          msg.erpSummary = { claimed: items.length, sent };
          send(node.errorOutput ? [msg, null] : msg);
        }
        done();
      } catch (error) {
        handleError(node, msg, error, send, done);
      }
    });
  }
  RED.nodes.registerType('wms-erp-out', WmsErpOutNode);
};
