'use strict';
const { WmsError } = require('../lib/common.js');

/**
 * Verbindung zum WMS: REST-Basis-URL und optional ein MQTT-Broker für Ereignisse.
 * Ereignis-Nodes melden sich hier an; die Verbindung abonniert `<prefix>/#`
 * einmal und verteilt die Ereignisse (Duplikate über die Event-ID erkannt –
 * das WMS liefert mindestens einmal).
 */
module.exports = function (RED) {
  function WmsConfigNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.url = String(config.url || '').replace(/\/+$/, '');
    node.prefix = config.prefix || 'wms';
    node.timeout = Number(config.timeout) || 10000;
    node.brokerConn = config.broker ? RED.nodes.getNode(config.broker) : null;
    const listeners = new Set();
    const seen = [];
    let subscribed = false;

    /** REST-Aufruf; Antworten ab HTTP 400 werden zu `WmsError` mit dem fachlichen Code der API. */
    node.request = async (method, path, body) => {
      if (!node.url) throw new WmsError('NO_URL', 'In der WMS-Verbindung fehlt die URL', 0);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), node.timeout);
      let response;
      try {
        response = await fetch(`${node.url}${path}`, {
          method,
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        throw new WmsError('UNREACHABLE', `WMS nicht erreichbar (${method} ${path}): ${error.message}`, 0);
      } finally {
        clearTimeout(timer);
      }
      const text = await response.text();
      let parsed = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // Kein JSON – Text weitergeben.
      }
      if (response.status >= 400) {
        const b = parsed && typeof parsed === 'object' ? parsed : {};
        throw new WmsError(b.code || `HTTP_${response.status}`, b.message || `HTTP ${response.status}`, response.status, b.details ?? b.issues ?? null);
      }
      return { statusCode: response.status, body: parsed };
    };

    /** Ereignisse empfangen; liefert eine Abmeldefunktion. */
    node.onEvent = (listener) => {
      if (!node.brokerConn) throw new WmsError('NO_BROKER', 'In der WMS-Verbindung ist kein MQTT-Broker gewählt', 0);
      listeners.add(listener);
      if (!subscribed) {
        subscribed = true;
        node.brokerConn.register(node);
        node.brokerConn.subscribe(
          `${node.prefix}/#`,
          { qos: 1 },
          (topic, payload) => {
            let event;
            try {
              event = JSON.parse(payload.toString());
            } catch {
              return;
            }
            if (!event || typeof event.type !== 'string') return;
            if (event.id) {
              if (seen.includes(event.id)) return;
              seen.push(event.id);
              if (seen.length > 1000) seen.shift();
            }
            for (const l of [...listeners]) {
              try {
                l(event, topic);
              } catch (error) {
                node.warn(`Ereignis-Empfänger fehlgeschlagen: ${error.message}`);
              }
            }
          },
          node.id,
        );
      }
      return () => listeners.delete(listener);
    };

    node.on('close', (removed, done) => {
      listeners.clear();
      if (subscribed && node.brokerConn) {
        node.brokerConn.unsubscribe(`${node.prefix}/#`, node.id, removed);
        node.brokerConn.deregister(node, done, removed);
      } else {
        done();
      }
    });
  }
  RED.nodes.registerType('wms-config', WmsConfigNode);
};
