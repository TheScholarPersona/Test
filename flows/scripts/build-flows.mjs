#!/usr/bin/env node
/**
 * Erzeugt flows/node-red/flows.json aus lesbaren Bausteinen.
 *
 * Warum ein Generator? Funktionscode in Node-RED-Flows steht als JSON-String
 * in der Datei und ist so kaum zu prüfen. Hier liegt er als normaler
 * JavaScript-Code vor; das Ergebnis ist trotzdem eine gewöhnliche
 * flows.json, die Node-RED direkt lädt und im Editor anzeigt.
 *
 * Ändern: Bausteine hier anpassen, dann `node flows/scripts/build-flows.mjs`.
 * Wer Flows lieber im Node-RED-Editor ändert, exportiert sie anschließend
 * nach flows/node-red/flows.json; dann ist dieses Skript nachzuziehen.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../node-red/flows.json', import.meta.url));

/** Funktionsquelltext aus einer JS-Funktion lesen (nur der Rumpf). */
const body = (fn) => {
  const src = fn.toString();
  return src.slice(src.indexOf('{') + 1, src.lastIndexOf('}')).replace(/^\n/, '').replace(/\n\s*$/, '\n');
};

const nodes = [];
const add = (node) => {
  nodes.push(node);
  return node.id;
};

// ---------------------------------------------------------------------------
// Konfiguration
// ---------------------------------------------------------------------------
const BROKER = 'b0000000000000b1';
add({
  id: BROKER,
  type: 'mqtt-broker',
  name: 'WMS-Broker',
  broker: '${MQTT_HOST}',
  port: '${MQTT_PORT}',
  clientid: '',
  autoConnect: true,
  usetls: false,
  protocolVersion: '4',
  keepalive: '60',
  cleansession: true,
  autoUnsubscribe: true,
  birthTopic: '',
  closeTopic: '',
  willTopic: '',
});

// ---------------------------------------------------------------------------
// Tab: Test-Framework
// ---------------------------------------------------------------------------
const TAB_FRAMEWORK = 'f000000000000001';
add({
  id: TAB_FRAMEWORK,
  type: 'tab',
  label: 'Test-Framework',
  disabled: false,
  info:
    'Steuert die Szenario-Tests.\n\n' +
    '- `GET /test/scenarios` listet alle Szenarien.\n' +
    '- `POST /test/scenarios/:id/run` führt ein Szenario aus und antwortet mit dem Ergebnis.\n\n' +
    'Ein Szenario ist ein eigener Tab mit einem `link in`-Node namens `scenario:<id>` ' +
    'und endet mit einem `link out` im Modus „return“. Neue Szenarien im Katalog eintragen.',
});

add({
  id: 'f100000000000001',
  type: 'comment',
  z: TAB_FRAMEWORK,
  name: 'Szenario-Katalog – neue Szenarien hier eintragen',
  info: '',
  x: 230,
  y: 40,
  wires: [],
});

add({
  id: 'f100000000000002',
  type: 'function',
  z: TAB_FRAMEWORK,
  name: 'Szenario-Katalog',
  func: 'return msg;\n',
  outputs: 0,
  timeout: 0,
  noerr: 0,
  initialize: body(function () {
    // Jedes Szenario: id = Name des link-in-Nodes ohne Präfix "scenario:".
    global.set('scenarioCatalog', [
      {
        id: 'system-ping',
        description: 'API erzeugt ein system.ping-Event; es kommt über Outbox und MQTT in Node-RED an.',
      },
    ]);
  }),
  finalize: '',
  libs: [],
  x: 200,
  y: 80,
  wires: [],
});

// GET /test/scenarios
const LIST_RESPONSE = 'f100000000000013';
add({
  id: 'f100000000000011',
  type: 'http in',
  z: TAB_FRAMEWORK,
  name: 'GET /test/scenarios',
  url: '/test/scenarios',
  method: 'get',
  upload: false,
  swaggerDoc: '',
  x: 160,
  y: 140,
  wires: [['f100000000000012']],
});
add({
  id: 'f100000000000012',
  type: 'function',
  z: TAB_FRAMEWORK,
  name: 'Szenarien auflisten',
  func: body(function () {
    msg.statusCode = 200;
    msg.headers = { 'content-type': 'application/json' };
    msg.payload = { scenarios: global.get('scenarioCatalog') || [] };
    return msg;
  }),
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 390,
  y: 140,
  wires: [[LIST_RESPONSE]],
});
add({
  id: LIST_RESPONSE,
  type: 'http response',
  z: TAB_FRAMEWORK,
  name: '',
  statusCode: '',
  headers: {},
  x: 590,
  y: 140,
  wires: [],
});

// POST /test/scenarios/:id/run
const RUN_RESPONSE = 'f100000000000025';
const LINK_CALL = 'f100000000000023';
add({
  id: 'f100000000000021',
  type: 'http in',
  z: TAB_FRAMEWORK,
  name: 'POST /test/scenarios/:id/run',
  url: '/test/scenarios/:id/run',
  method: 'post',
  upload: false,
  swaggerDoc: '',
  x: 180,
  y: 220,
  wires: [['f100000000000022']],
});
add({
  id: 'f100000000000022',
  type: 'function',
  z: TAB_FRAMEWORK,
  name: 'Szenario wählen',
  func: body(function () {
    const catalog = global.get('scenarioCatalog') || [];
    const id = msg.req.params.id;
    if (!catalog.some((entry) => entry.id === id)) {
      msg.statusCode = 404;
      msg.headers = { 'content-type': 'application/json' };
      msg.payload = { scenario: id, passed: false, error: `Unbekanntes Szenario [${id}]` };
      return [null, msg];
    }
    const requested = msg.payload && typeof msg.payload.runId === 'string' ? msg.payload.runId : undefined;
    msg.scenario = {
      id,
      runId: requested || `${id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      startedAt: Date.now(),
      steps: [],
      passed: false,
    };
    msg.target = `scenario:${id}`;
    return [msg, null];
  }),
  outputs: 2,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 420,
  y: 220,
  wires: [[LINK_CALL], [RUN_RESPONSE]],
});
add({
  id: LINK_CALL,
  type: 'link call',
  z: TAB_FRAMEWORK,
  name: 'Szenario ausführen',
  links: [],
  linkType: 'dynamic',
  timeout: '60',
  x: 640,
  y: 200,
  wires: [['f100000000000024']],
});
add({
  id: 'f100000000000024',
  type: 'function',
  z: TAB_FRAMEWORK,
  name: 'Ergebnis senden',
  func: body(function () {
    const s = msg.scenario;
    // Antwort-Header der API aus dem Szenario nicht weiterreichen.
    msg.headers = { 'content-type': 'application/json' };
    msg.statusCode = 200;
    msg.payload = {
      scenario: s.id,
      runId: s.runId,
      passed: s.passed === true && s.steps.length > 0 && s.steps.every((step) => step.passed === true),
      durationMs: Date.now() - s.startedAt,
      steps: s.steps,
      error: s.error,
    };
    return msg;
  }),
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 850,
  y: 200,
  wires: [[RUN_RESPONSE]],
});
add({
  id: RUN_RESPONSE,
  type: 'http response',
  z: TAB_FRAMEWORK,
  name: '',
  statusCode: '',
  headers: {},
  x: 1050,
  y: 220,
  wires: [],
});
add({
  id: 'f100000000000026',
  type: 'catch',
  z: TAB_FRAMEWORK,
  name: 'Fehler im Szenario',
  scope: [LINK_CALL],
  uncaught: false,
  x: 650,
  y: 280,
  wires: [['f100000000000027']],
});
add({
  id: 'f100000000000027',
  type: 'function',
  z: TAB_FRAMEWORK,
  name: 'Fehler melden',
  func: body(function () {
    const s = msg.scenario || { id: 'unbekannt', runId: '', startedAt: Date.now(), steps: [] };
    msg.headers = { 'content-type': 'application/json' };
    msg.statusCode = 200;
    msg.payload = {
      scenario: s.id,
      runId: s.runId,
      passed: false,
      durationMs: Date.now() - s.startedAt,
      steps: s.steps,
      error: `Szenario abgebrochen: ${msg.error && msg.error.message}`,
    };
    return msg;
  }),
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 850,
  y: 280,
  wires: [[RUN_RESPONSE]],
});

// ---------------------------------------------------------------------------
// Tab: Szenario system-ping
// ---------------------------------------------------------------------------
const TAB_PING = 'f000000000000002';
add({
  id: TAB_PING,
  type: 'tab',
  label: 'Szenario: system-ping',
  disabled: false,
  info:
    'Prüft die Kette API → Outbox → MQTT → Node-RED.\n\n' +
    '1. Ping über `POST /test/events/ping` anfordern (HTTP 201 erwartet).\n' +
    '2. Auf `wms/system/ping` mit passender `correlationId` warten (Timeout `SCENARIO_EVENT_TIMEOUT_MS`, Standard 10 s).',
});
const WAIT = 'f200000000000004';
add({
  id: 'f200000000000001',
  type: 'link in',
  z: TAB_PING,
  name: 'scenario:system-ping',
  links: [],
  x: 140,
  y: 80,
  wires: [['f200000000000002']],
});
add({
  id: 'f200000000000002',
  type: 'function',
  z: TAB_PING,
  name: 'Ping anfordern',
  func: body(function () {
    const s = msg.scenario;
    s.steps.push({ name: 'Ping-Event über die API anfordern', passed: null });
    msg.url = `${env.get('WMS_API_URL')}/test/events/ping`;
    msg.method = 'POST';
    msg.headers = { 'content-type': 'application/json' };
    msg.payload = { message: s.runId, correlationId: s.runId };
    return msg;
  }),
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 350,
  y: 80,
  wires: [['f200000000000003']],
});
add({
  id: 'f200000000000003',
  type: 'http request',
  z: TAB_PING,
  name: 'WMS-API',
  method: 'use',
  ret: 'obj',
  paytoqs: 'ignore',
  url: '',
  tls: '',
  persist: false,
  proxy: '',
  insecureHTTPParser: false,
  authType: '',
  senderr: false,
  headers: [],
  x: 540,
  y: 80,
  wires: [[WAIT]],
});
add({
  id: 'f200000000000005',
  type: 'mqtt in',
  z: TAB_PING,
  name: 'wms/system/ping',
  topic: 'wms/system/ping',
  qos: '1',
  datatype: 'json',
  broker: BROKER,
  nl: false,
  rap: true,
  rh: 0,
  inputs: 0,
  x: 540,
  y: 160,
  wires: [[WAIT]],
});
add({
  id: WAIT,
  type: 'function',
  z: TAB_PING,
  name: 'Auf Event warten',
  func: body(function () {
    // Zwei Eingänge: HTTP-Antwort der API (mit msg.scenario) und MQTT-Events.
    const STEP = 'Event system.ping über MQTT empfangen';
    const timeoutMs = Number(env.get('SCENARIO_EVENT_TIMEOUT_MS') || 10000);
    const pending = context.get('pending') || {};
    const recent = context.get('recent') || {};

    const complete = (waiting, event) => {
      const s = waiting.scenario;
      const ok = event.type === 'system.ping' && event.id === s.eventId && event.payload && event.payload.message === s.runId;
      s.steps.push({ name: STEP, passed: ok, detail: ok ? `Event ${event.id}` : `Unerwartetes Event: ${JSON.stringify(event)}` });
      s.passed = ok;
      if (!ok) {
        s.error = 'Event entspricht nicht der Erwartung';
      }
      return waiting;
    };

    if (msg.scenario === undefined) {
      const event = msg.payload;
      const runId = event && event.correlationId;
      if (!runId) {
        return null;
      }
      const entry = pending[runId];
      if (!entry) {
        // Event kam vor der HTTP-Antwort an: kurz merken.
        recent[runId] = event;
        const keys = Object.keys(recent);
        if (keys.length > 100) {
          delete recent[keys[0]];
        }
        context.set('recent', recent);
        return null;
      }
      clearTimeout(entry.timer);
      delete pending[runId];
      context.set('pending', pending);
      return complete(entry.msg, event);
    }

    const s = msg.scenario;
    const step = s.steps[s.steps.length - 1];
    step.passed = msg.statusCode === 201;
    step.detail = `HTTP ${msg.statusCode}`;
    if (!step.passed) {
      s.passed = false;
      s.error = `API antwortete mit HTTP ${msg.statusCode}: ${JSON.stringify(msg.payload)}`;
      return msg;
    }
    s.eventId = msg.payload.eventId;

    if (recent[s.runId]) {
      const event = recent[s.runId];
      delete recent[s.runId];
      context.set('recent', recent);
      return complete(msg, event);
    }

    const timer = setTimeout(() => {
      const open = context.get('pending') || {};
      if (!open[s.runId]) {
        return;
      }
      delete open[s.runId];
      context.set('pending', open);
      s.steps.push({ name: STEP, passed: false, detail: `Kein Event innerhalb von ${timeoutMs} ms` });
      s.passed = false;
      s.error = 'Event nicht empfangen';
      node.send(msg);
    }, timeoutMs);
    pending[s.runId] = { msg, timer };
    context.set('pending', pending);
    return null;
  }),
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 760,
  y: 120,
  wires: [['f200000000000006']],
});
add({
  id: 'f200000000000006',
  type: 'link out',
  z: TAB_PING,
  name: 'Ergebnis zurück',
  mode: 'return',
  links: [],
  x: 960,
  y: 120,
  wires: [],
});

// ---------------------------------------------------------------------------
// Tab: Anlagensimulator (folgt in Schritt 5)
// ---------------------------------------------------------------------------
const TAB_SIM = 'f000000000000003';
add({
  id: TAB_SIM,
  type: 'tab',
  label: 'Anlagensimulator',
  disabled: false,
  info: 'Platzhalter. Ab Schritt 5 simuliert dieser Tab Fördertechnik und Scanner (siehe docs/openwms-analyse.md, Kap. 5.1d).',
});
add({
  id: 'f300000000000001',
  type: 'comment',
  z: TAB_SIM,
  name: 'Anlagensimulator – folgt in Schritt 5 (Materialfluss)',
  info: '',
  x: 260,
  y: 60,
  wires: [],
});

writeFileSync(out, `${JSON.stringify(nodes, null, 2)}\n`);
console.log(`${nodes.length} Nodes nach ${out} geschrieben`);
