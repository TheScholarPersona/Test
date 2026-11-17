'use strict';
const { conditionsMatch, typeMatches } = require('../lib/common.js');

/**
 * Wartet auf ein passendes WMS-Ereignis (mit Timeout statt fester Pause).
 * Bedingungswerte dürfen auf die Nachricht verweisen (`msg.payload.number`).
 * Ereignisse, die kurz vor der Nachricht ankamen (seit `msg.wmsRequestedAt`,
 * sonst in den letzten Sekunden), zählen mit – sonst ginge ein schnelles
 * Ereignis verloren. Ausgang 1: Ereignis in `msg.event`; Ausgang 2: Timeout.
 */
module.exports = function (RED) {
  function WmsWaitEventNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const server = RED.nodes.getNode(config.server);
    const timeout = Number(config.timeout) || 10000;
    const recent = [];
    const pending = new Set();
    if (!server) {
      node.status({ fill: 'red', shape: 'ring', text: 'keine Verbindung' });
      return;
    }
    const matches = (entry, event) => typeMatches(config.types, event.type) && conditionsMatch(RED, config.conditions, event, entry.msg);
    const finish = (entry, event) => {
      clearTimeout(entry.timer);
      pending.delete(entry);
      entry.msg.event = event;
      if (entry.msg.test) entry.msg.test.steps.push({ name: config.name || `Ereignis ${config.types}`, passed: true, detail: `${event.type} ${event.id}` });
      node.status({ fill: 'green', shape: 'dot', text: event.type });
      entry.send([entry.msg, null]);
      entry.done();
    };
    let off;
    try {
      off = server.onEvent((event) => {
        recent.push({ event, at: Date.now() });
        while (recent.length > 500 || (recent.length && Date.now() - recent[0].at > 60000)) recent.shift();
        for (const entry of [...pending]) if (matches(entry, event)) finish(entry, event);
      });
    } catch (error) {
      node.status({ fill: 'red', shape: 'ring', text: error.code || 'Fehler' });
      node.error(error.message);
      return;
    }
    node.on('input', (msg, send, done) => {
      const entry = { msg, send, done, timer: null };
      const since = Number(msg.wmsRequestedAt) || Date.now() - (Number(config.lookbackMs) || 5000);
      const earlier = recent.find((r) => r.at >= since && matches(entry, r.event));
      if (earlier) {
        finish(entry, earlier.event);
        return;
      }
      entry.timer = setTimeout(() => {
        pending.delete(entry);
        msg.wmsError = { code: 'EVENT_TIMEOUT', message: `Kein passendes Ereignis (${config.types}) innerhalb von ${timeout} ms`, statusCode: 0, details: null };
        if (msg.test) msg.test.steps.push({ name: config.name || `Ereignis ${config.types}`, passed: false, detail: msg.wmsError.message });
        node.status({ fill: 'yellow', shape: 'ring', text: 'Timeout' });
        send([null, msg]);
        done();
      }, timeout);
      pending.add(entry);
      node.status({ fill: 'blue', shape: 'ring', text: `warte auf ${config.types}` });
    });
    node.on('close', () => {
      for (const entry of pending) clearTimeout(entry.timer);
      pending.clear();
      if (off) off();
    });
  }
  RED.nodes.registerType('wms-wait-event', WmsWaitEventNode);
};
