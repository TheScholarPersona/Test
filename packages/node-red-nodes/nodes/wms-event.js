'use strict';
const { conditionsMatch, typeMatches } = require('../lib/common.js');

/** Gibt WMS-Ereignisse aus, gefiltert nach Typ (`stock.*`) und optional nach Feldern (`payload.barcode` = `P1`). */
module.exports = function (RED) {
  function WmsEventNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const server = RED.nodes.getNode(config.server);
    if (!server) {
      node.status({ fill: 'red', shape: 'ring', text: 'keine Verbindung' });
      return;
    }
    try {
      const off = server.onEvent((event, topic) => {
        if (!typeMatches(config.types, event.type)) return;
        if (!conditionsMatch(RED, config.conditions, event, {})) return;
        node.status({ fill: 'green', shape: 'dot', text: event.type });
        node.send({ topic, payload: event });
      });
      node.status({ fill: 'grey', shape: 'dot', text: config.types || '*' });
      node.on('close', () => off());
    } catch (error) {
      node.status({ fill: 'red', shape: 'ring', text: error.code || 'Fehler' });
      node.error(error.message);
    }
  }
  RED.nodes.registerType('wms-event', WmsEventNode);
};
