'use strict';
/**
 * Gemeinsame Bausteine der WMS-Nodes. Keine Laufzeitabhängigkeiten: HTTP über
 * das eingebaute fetch, MQTT über den Broker-Config-Node von Node-RED.
 */

/** Fachlicher Fehler der WMS-API (z. B. Regelverletzung, HTTP 409). */
class WmsError extends Error {
  constructor(code, message, statusCode, details) {
    super(message);
    this.name = 'WmsError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Wert aus einer Angabe: `msg.a.b` liest aus der Nachricht, sonst ist es ein fester Text. Leer → undefined. */
function resolve(RED, spec, msg) {
  if (spec === undefined || spec === null || spec === '') return undefined;
  if (typeof spec !== 'string') return spec;
  if (spec.startsWith('msg.')) return RED.util.getMessageProperty(msg, spec.slice(4));
  return spec;
}

/** Angabe mit Standard: fehlt das Feld (`undefined`), gilt `fallback`; ein leerer Text bedeutet „nicht verwenden“. */
const spec = (value, fallback) => (value === undefined ? fallback : value);

/** Wie `resolve`, aber Pflicht: fehlt der Wert, gibt es einen verständlichen Fehler. */
function required(RED, spec, msg, label) {
  const value = resolve(RED, spec, msg);
  if (value === undefined || value === null || value === '') {
    throw new WmsError('INPUT_MISSING', `${label} fehlt (Angabe: ${spec || 'leer'})`, 0, { field: label, spec });
  }
  return value;
}

/** Wert unter einem Punkt-Pfad (`payload.items.0.id`). */
function getPath(obj, path) {
  if (!path) return obj;
  return String(path)
    .split('.')
    .reduce((current, key) => (current === undefined || current === null ? undefined : current[key]), obj);
}

/** Platzverweis für die API aus Art (`erpCode`, `plcCode`, `locationId`, `id`) und Wert. */
function locationRef(kind, value) {
  const allowed = ['erpCode', 'plcCode', 'locationId', 'id'];
  if (!allowed.includes(kind)) throw new WmsError('INPUT_INVALID', `Unbekannte Platzangabe ${kind}`, 0, { kind });
  return { [kind]: String(value) };
}

/** Ereignistyp gegen eine kommagetrennte Liste mit `*` als Platzhalter (`stock.*, transport-order.finished`). */
function typeMatches(patterns, type) {
  const list = String(patterns || '*')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return list.some((p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(type));
}

/**
 * Bedingungen `[{ path, value }]` gegen ein Ereignis; `value` darf `msg.…` sein.
 * Verglichen wird als Text, damit Dezimalwerte ("12.5") und Zahlen zusammenpassen.
 */
function conditionsMatch(RED, conditions, event, msg) {
  return (conditions || []).every((c) => {
    if (!c || !c.path) return true;
    const expected = resolve(RED, c.value, msg || {});
    return String(getPath(event, c.path)) === String(expected);
  });
}

/** Fehler für den Flow aufbereiten: `msg.wmsError` trägt Code und Details (Catch-Node). */
function describeError(error) {
  if (error instanceof WmsError) {
    return { code: error.code, message: error.message, statusCode: error.statusCode, details: error.details ?? null };
  }
  return { code: 'NODE_ERROR', message: String(error && error.message ? error.message : error), statusCode: 0, details: null };
}

/**
 * Fehlerbehandlung der Aktions-Nodes: Standard ist ein Node-RED-Fehler (vom
 * Catch-Node abfangbar); mit „Fehlerausgang“ geht die Nachricht an Ausgang 2.
 */
function handleError(node, msg, error, send, done) {
  msg.wmsError = describeError(error);
  node.status({ fill: 'red', shape: 'ring', text: msg.wmsError.code });
  if (node.errorOutput) {
    send([null, msg]);
    done();
  } else {
    done(new Error(`${msg.wmsError.code}: ${msg.wmsError.message}`));
  }
}

/** Gemeinsamer Ablauf der Aktions-Nodes: Anfrage bauen, senden, Antwort oder Fehler weitergeben. */
function actionNode(RED, node, config, build) {
  node.server = RED.nodes.getNode(config.server);
  node.errorOutput = config.errorOutput === true || config.errorOutput === 'true';
  node.on('input', async (msg, send, done) => {
    if (!node.server) {
      handleError(node, msg, new WmsError('NO_CONFIG', 'Keine WMS-Verbindung konfiguriert', 0), send, done);
      return;
    }
    try {
      const request = build(msg);
      node.status({ fill: 'blue', shape: 'dot', text: `${request.method} ${request.path}` });
      msg.wmsRequestedAt = Date.now();
      const response = await node.server.request(request.method, request.path, request.body);
      msg.statusCode = response.statusCode;
      msg.payload = response.body;
      node.status({ fill: 'green', shape: 'dot', text: `HTTP ${response.statusCode}` });
      send(node.errorOutput ? [msg, null] : msg);
      done();
    } catch (error) {
      handleError(node, msg, error, send, done);
    }
  });
}

module.exports = { WmsError, spec, resolve, required, getPath, locationRef, typeMatches, conditionsMatch, describeError, handleError, actionNode };
