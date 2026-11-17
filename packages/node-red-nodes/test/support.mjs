/** Testhilfen: Node-RED-Test-Helper, ein Test-WMS (HTTP) und ein nachgebildeter MQTT-Broker-Config-Node. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const helper = require('node-red-node-test-helper');
helper.init(require.resolve('node-red'));

const nodeFiles = ['wms-config', 'wms-api', 'wms-move-tu', 'wms-receive', 'wms-device-event', 'wms-event', 'wms-wait-event', 'wms-test-start', 'wms-assert', 'wms-test-result'];

/**
 * Gleiche Schnittstelle wie der MQTT-Broker-Node von Node-RED (register,
 * subscribe, unsubscribe, deregister); `publish` liefert eine Nachricht aus.
 */
function FakeBroker(RED) {
  function Broker(config) {
    RED.nodes.createNode(this, config);
    this.subscriptions = [];
    this.registered = new Set();
    this.register = (n) => this.registered.add(n.id);
    this.deregister = (n, done) => {
      this.registered.delete(n.id);
      done();
    };
    this.subscribe = (topic, options, callback, ref) => this.subscriptions.push({ topic, options, callback, ref });
    this.unsubscribe = (topic, ref) => (this.subscriptions = this.subscriptions.filter((s) => !(s.topic === topic && s.ref === ref)));
    this.publish = (event) => this.subscriptions.forEach((s) => s.callback(`wms/${String(event.type).replace('.', '/')}`, Buffer.from(JSON.stringify(event)), {}));
  }
  RED.nodes.registerType('mqtt-broker', Broker);
}

export const nodes = [FakeBroker, ...nodeFiles.map((f) => require(`../nodes/${f}.js`))];

/** Test-WMS: beantwortet Anfragen über `routes` (`'POST /v1/x'` → `{ status, body }` oder Funktion) und merkt sie sich. */
export async function startApi(routes) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const key = `${req.method} ${req.url}`;
      requests.push({ method: req.method, url: req.url, body });
      const route = routes[key];
      const answer = typeof route === 'function' ? route(body) : (route ?? { status: 404, body: { code: 'NOT_FOUND', message: `Keine Route ${key}` } });
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Grundflow: Broker, Verbindung und Hilfsknoten `out`/`err` zum Auffangen. */
export function baseFlow(url, extra) {
  // Fluss-Nodes brauchen einen Tab (`z`), sonst behandelt Node-RED sie als Config-Nodes.
  return [
    { id: 'tab', type: 'tab', label: 'Test' },
    { id: 'broker', type: 'mqtt-broker', name: 'test' },
    { id: 'cfg', type: 'wms-config', url, broker: 'broker', prefix: 'wms', timeout: 2000 },
    { id: 'out', type: 'helper', z: 'tab' },
    { id: 'out2', type: 'helper', z: 'tab' },
    ...extra.map((n) => ({ z: 'tab', ...n })),
  ];
}

/** Erste Nachricht an einem Helper-Node. */
export const next = (node) => new Promise((resolve) => node.once('input', resolve));
