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
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../node-red/flows.json', import.meta.url));
const scenarioDir = fileURLToPath(new URL('../scenarios/', import.meta.url));

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
    const steps = global.get('stepScenarios') || {};
    msg.payload = {
      scenarios: [
        ...(global.get('scenarioCatalog') || []),
        ...Object.values(steps).map((def) => ({ id: def.id, description: def.description })),
      ],
    };
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
    const steps = global.get('stepScenarios') || {};
    const id = msg.req.params.id;
    const isStepScenario = Object.prototype.hasOwnProperty.call(steps, id);
    if (!isStepScenario && !catalog.some((entry) => entry.id === id)) {
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
    // Schritt-Szenarien laufen in der gemeinsamen Engine, eigene Szenarien in ihrem Tab.
    msg.target = isStepScenario ? 'engine:steps' : `scenario:${id}`;
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
// Tab: Schritt-Engine (führt Szenarien aus flows/scenarios/*.js aus)
// ---------------------------------------------------------------------------
const TAB_ENGINE = 'f000000000000004';
const ENGINE_NEXT = 'f400000000000002';
const ENGINE_HTTP = 'f400000000000003';
const ENGINE_CHECK = 'f400000000000004';
const ENGINE_WAIT = 'f400000000000005';
const ENGINE_RETURN = 'f400000000000007';
add({
  id: TAB_ENGINE,
  type: 'tab',
  label: 'Schritt-Engine',
  disabled: false,
  info:
    'Führt Szenarien aus, die als Schrittliste definiert sind (flows/scenarios/*.js).\n\n' +
    'Ablauf je Schritt: „Nächster Schritt“ → HTTP-Aufruf → „Antwort prüfen“ → zurück, ' +
    'oder „Auf Event warten“ (MQTT `wms/#`). Nach einem Fehler laufen nur noch Aufräumschritte (`cleanup: true`).',
});
add({
  id: 'f400000000000001',
  type: 'link in',
  z: TAB_ENGINE,
  name: 'engine:steps',
  links: [],
  x: 120,
  y: 100,
  wires: [[ENGINE_NEXT]],
});
add({
  id: ENGINE_NEXT,
  type: 'function',
  z: TAB_ENGINE,
  name: 'Nächster Schritt',
  func: body(function () {
    const s = msg.scenario;
    const def = (global.get('stepScenarios') || {})[s.id];
    const fail = (name, detail) => {
      s.steps.push({ name, passed: false, detail });
      if (!s.failed) {
        s.failed = true;
        s.error = `${name}: ${detail}`;
      }
    };
    if (!def) {
      fail('Szenario laden', `Szenario [${s.id}] ist nicht definiert`);
      s.passed = false;
      return [null, null, msg];
    }
    if (s.vars === undefined) {
      s.vars = def.init ? def.init(s.runId) : {};
      s.idx = 0;
      s.failed = false;
    }
    for (;;) {
      // Nach einem Fehler nur noch Aufräumschritte ausführen.
      while (s.idx < def.steps.length && s.failed && !def.steps[s.idx].cleanup) {
        s.idx++;
      }
      if (s.idx >= def.steps.length) {
        s.passed = !s.failed && s.steps.every((step) => step.passed === true);
        return [null, null, msg];
      }
      const step = def.steps[s.idx];
      if (step.event) {
        return [null, msg, null];
      }
      try {
        const request = step.request(s.vars);
        if (request === null) {
          // Schritt bewusst übersprungen, z. B. Aufräumen eines nie angelegten Objekts.
          s.steps.push({ name: step.name, passed: true, detail: 'übersprungen' });
          s.idx++;
          continue;
        }
        msg.method = request.method;
        // service: 'simulator' spricht die Endpunkte des Anlagensimulators in diesem Node-RED an.
        const base = request.service === 'simulator' ? `http://127.0.0.1:${env.get('PORT') || 1880}` : env.get('WMS_API_URL');
        msg.url = `${base}${request.path}`;
        msg.headers = { 'content-type': 'application/json' };
        msg.payload = request.body === undefined ? '' : request.body;
        return [msg, null, null];
      } catch (error) {
        fail(step.name, `Anfrage konnte nicht erstellt werden: ${error.message}`);
        s.idx++;
      }
    }
  }),
  outputs: 3,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 330,
  y: 100,
  wires: [[ENGINE_HTTP], [ENGINE_WAIT], [ENGINE_RETURN]],
});
add({
  id: ENGINE_HTTP,
  type: 'http request',
  z: TAB_ENGINE,
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
  x: 550,
  y: 60,
  wires: [[ENGINE_CHECK]],
});
add({
  id: ENGINE_CHECK,
  type: 'function',
  z: TAB_ENGINE,
  name: 'Antwort prüfen',
  func: body(function () {
    const s = msg.scenario;
    const step = global.get('stepScenarios')[s.id].steps[s.idx];
    let error = null;
    if (step.expectStatus !== undefined && msg.statusCode !== step.expectStatus) {
      error = `HTTP ${msg.statusCode} statt ${step.expectStatus}: ${JSON.stringify(msg.payload)}`;
    }
    if (!error && step.check) {
      try {
        error = step.check(msg.payload, s.vars) || null;
      } catch (e) {
        error = `Prüfung fehlgeschlagen: ${e.message}`;
      }
    }
    if (!error && step.save) {
      try {
        step.save(msg.payload, s.vars);
      } catch (e) {
        error = `Ergebnis konnte nicht übernommen werden: ${e.message}`;
      }
    }
    if (error) {
      s.steps.push({ name: step.name, passed: false, detail: error });
      if (!s.failed) {
        s.failed = true;
        s.error = `${step.name}: ${error}`;
      }
    } else {
      s.steps.push({ name: step.name, passed: true, detail: `HTTP ${msg.statusCode}` });
    }
    s.idx++;
    return msg;
  }),
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 760,
  y: 60,
  wires: [[ENGINE_NEXT]],
});
add({
  id: 'f400000000000006',
  type: 'mqtt in',
  z: TAB_ENGINE,
  name: 'wms/#',
  topic: 'wms/#',
  qos: '1',
  datatype: 'json',
  broker: BROKER,
  nl: false,
  rap: true,
  rh: 0,
  inputs: 0,
  x: 550,
  y: 200,
  wires: [[ENGINE_WAIT]],
});
add({
  id: ENGINE_WAIT,
  type: 'function',
  z: TAB_ENGINE,
  name: 'Auf Event warten',
  func: body(function () {
    // Eingänge: wartender Schritt (mit msg.scenario) und alle MQTT-Events unter wms/#.
    const timeoutMs = Number(env.get('SCENARIO_EVENT_TIMEOUT_MS') || 10000);
    const recent = context.get('recent') || [];
    const pending = context.get('pending') || [];
    const stepOf = (waiting) => global.get('stepScenarios')[waiting.scenario.id].steps[waiting.scenario.idx];
    const matches = (waiting, event) => {
      try {
        return stepOf(waiting).event(event, waiting.scenario.vars) === true;
      } catch (e) {
        return false;
      }
    };
    const complete = (waiting, event) => {
      const s = waiting.scenario;
      s.steps.push({ name: stepOf(waiting).name, passed: true, detail: `Event ${event.type} ${event.id}` });
      s.idx++;
      node.send(waiting);
    };

    if (msg.scenario === undefined) {
      const event = msg.payload;
      if (!event || typeof event !== 'object') {
        return null;
      }
      recent.push({ event, receivedAt: Date.now() });
      while (recent.length > 500) {
        recent.shift();
      }
      context.set('recent', recent);
      for (const entry of [...pending]) {
        if (matches(entry.msg, event)) {
          clearTimeout(entry.timer);
          pending.splice(pending.indexOf(entry), 1);
          complete(entry.msg, event);
        }
      }
      context.set('pending', pending);
      return null;
    }

    const s = msg.scenario;
    // Event kann schon vor diesem Schritt eingetroffen sein (nur Events seit Start des Laufs).
    const earlier = recent.find((r) => r.receivedAt >= s.startedAt && matches(msg, r.event));
    if (earlier) {
      complete(msg, earlier.event);
      return null;
    }
    const entry = { msg };
    entry.timer = setTimeout(() => {
      const open = context.get('pending') || [];
      const index = open.indexOf(entry);
      if (index < 0) {
        return;
      }
      open.splice(index, 1);
      context.set('pending', open);
      const name = stepOf(msg).name;
      const detail = `Kein passendes Event innerhalb von ${timeoutMs} ms`;
      s.steps.push({ name, passed: false, detail });
      if (!s.failed) {
        s.failed = true;
        s.error = `${name}: ${detail}`;
      }
      s.idx++;
      node.send(msg);
    }, timeoutMs);
    pending.push(entry);
    context.set('pending', pending);
    return null;
  }),
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 770,
  y: 160,
  wires: [[ENGINE_NEXT]],
});
add({
  id: ENGINE_RETURN,
  type: 'link out',
  z: TAB_ENGINE,
  name: 'Ergebnis zurück',
  mode: 'return',
  links: [],
  x: 560,
  y: 280,
  wires: [],
});

// ---------------------------------------------------------------------------
// Tabs: Schritt-Szenarien aus flows/scenarios/*.js
// ---------------------------------------------------------------------------
const REGISTER_PRELUDE =
  'const registerScenario = (definition) => {\n' +
  "  const all = global.get('stepScenarios') || {};\n" +
  '  all[definition.id] = definition;\n' +
  "  global.set('stepScenarios', all);\n" +
  '};\n';

readdirSync(scenarioDir)
  .filter((file) => file.endsWith('.js'))
  .sort()
  .forEach((file, index) => {
    const id = file.replace(/\.js$/, '');
    const n = String(index + 1).padStart(2, '0');
    const tab = `f5${n}000000000000`;
    add({
      id: tab,
      type: 'tab',
      label: `Szenario: ${id}`,
      disabled: false,
      info: `Schrittliste aus flows/scenarios/${file}; ausgeführt vom Tab „Schritt-Engine“.`,
    });
    add({
      id: `f5${n}000000000001`,
      type: 'comment',
      z: tab,
      name: `Definition: flows/scenarios/${file} (im Repository bearbeiten, dann Flows neu erzeugen)`,
      info: '',
      x: 380,
      y: 40,
      wires: [],
    });
    add({
      id: `f5${n}000000000002`,
      type: 'function',
      z: tab,
      name: `Szenario ${id} anmelden`,
      func: 'return msg;\n',
      outputs: 0,
      timeout: 0,
      noerr: 0,
      initialize: REGISTER_PRELUDE + readFileSync(`${scenarioDir}${file}`, 'utf8'),
      finalize: '',
      libs: [],
      x: 200,
      y: 100,
      wires: [],
    });
  });

// ---------------------------------------------------------------------------
// Tab: Anlagensimulator (Fördertechnik, Regalbediengerät)
// ---------------------------------------------------------------------------
const simConfig = JSON.parse(readFileSync(fileURLToPath(new URL('../simulator/config.json', import.meta.url)), 'utf8'));
delete simConfig.$comment;
const TAB_SIM = 'f000000000000003';
const SIM_DRIVE = 'f300000000000003';
const SIM_HTTP = 'f300000000000004';
const SIM_LOG = 'f300000000000005';
const SIM_STATE = 'f300000000000007';
add({
  id: TAB_SIM,
  type: 'tab',
  label: 'Anlagensimulator',
  disabled: false,
  info:
    'Simuliert die Anlage: Auf jeden Fahrbefehl (`wms/flow/command`) fährt die TU mit der konfigurierten Fahrzeit zum Ziel ' +
    'und meldet dort `request` (Entscheidungspunkt) bzw. `arrived` (Platz passt zu `arrivedPatterns`) an `POST /v1/flow/events`.\n\n' +
    'Konfiguration: `flows/simulator/config.json` (Fahrzeiten je plcCode). Aktiv nur mit `SIMULATOR_ENABLED=true`.\n\n' +
    '- `GET /sim/state` – Konfiguration, Protokoll, eingespeiste Störungen\n' +
    '- `POST /sim/faults` `{ plcCode, code?, message? }` – nächste Fahrt zu diesem Platz endet mit einer Störung (`error`)\n' +
    '- `DELETE /sim/faults` – Störungen entfernen',
});
add({
  id: 'f300000000000001',
  type: 'function',
  z: TAB_SIM,
  name: 'Konfiguration laden',
  func: 'return msg;\n',
  outputs: 0,
  timeout: 0,
  noerr: 0,
  initialize: `// Aus flows/simulator/config.json (vom Generator eingebettet).\nglobal.set('simConfig', ${JSON.stringify(simConfig)});\nglobal.set('simFaults', {});\nglobal.set('simLog', []);\n`,
  finalize: '',
  libs: [],
  x: 170,
  y: 40,
  wires: [],
});
add({
  id: 'f300000000000002',
  type: 'mqtt in',
  z: TAB_SIM,
  name: 'wms/flow/command',
  topic: 'wms/flow/command',
  qos: '1',
  datatype: 'json',
  broker: BROKER,
  nl: false,
  rap: true,
  rh: 0,
  inputs: 0,
  x: 150,
  y: 100,
  wires: [[SIM_DRIVE]],
});
add({
  id: SIM_DRIVE,
  type: 'function',
  z: TAB_SIM,
  name: 'Fahren',
  func: body(function () {
    if (String(env.get('SIMULATOR_ENABLED')) !== 'true') {
      return null;
    }
    const cfg = global.get('simConfig');
    const event = msg.payload;
    if (!event || event.type !== 'flow.command') {
      return null;
    }
    // Events kommen mindestens einmal: Duplikate über die Event-ID erkennen.
    const seen = context.get('seen') || [];
    if (seen.includes(event.id)) {
      return null;
    }
    seen.push(event.id);
    while (seen.length > 1000) {
      seen.shift();
    }
    context.set('seen', seen);

    const c = event.payload;
    const toRef = c.to.plcCode ? { plcCode: c.to.plcCode } : { locationId: c.to.locationId };
    const key = c.to.plcCode || c.to.locationId;
    const travelMs = Number(cfg.travelMs[key] ?? cfg.defaultTravelMs);
    const faults = global.get('simFaults') || {};
    const fault = faults[key];
    let body;
    if (fault) {
      // Störung: die TU bleibt am Ausgangsplatz liegen, die Anlage meldet einen Fehler.
      delete faults[key];
      global.set('simFaults', faults);
      const fromRef = c.from.plcCode ? { plcCode: c.from.plcCode } : { locationId: c.from.locationId };
      body = { type: 'error', location: fromRef, barcode: c.barcode, deviceId: cfg.deviceId, code: fault.code || 'SIM_FAULT', message: fault.message || `Störung auf dem Weg nach ${key}` };
    } else {
      const arrived = (cfg.arrivedPatterns || []).some((p) => new RegExp(p).test(key));
      body = { type: arrived ? 'arrived' : 'request', location: toRef, barcode: c.barcode, deviceId: cfg.deviceId };
    }
    setTimeout(() => {
      node.send({
        method: 'POST',
        url: `${env.get('WMS_API_URL')}/v1/flow/events`,
        headers: { 'content-type': 'application/json' },
        payload: body,
        sim: { barcode: c.barcode, to: key, type: body.type, travelMs, commandId: event.id },
      });
    }, travelMs);
    return null;
  }),
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 350,
  y: 100,
  wires: [[SIM_HTTP]],
});
add({
  id: SIM_HTTP,
  type: 'http request',
  z: TAB_SIM,
  name: 'Geräte-Ereignis an WMS',
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
  x: 560,
  y: 100,
  wires: [[SIM_LOG]],
});
add({
  id: SIM_LOG,
  type: 'function',
  z: TAB_SIM,
  name: 'Protokollieren',
  func: body(function () {
    const cfg = global.get('simConfig');
    const log = global.get('simLog') || [];
    const decision = msg.payload && msg.payload.decision;
    log.push({
      at: new Date().toISOString(),
      barcode: msg.sim.barcode,
      to: msg.sim.to,
      reported: msg.sim.type,
      status: msg.statusCode,
      outcome: decision ? decision.outcome : null,
      next: msg.payload && msg.payload.command ? msg.payload.command.to.plcCode || msg.payload.command.to.locationId : null,
      error: msg.statusCode >= 400 ? msg.payload : undefined,
    });
    while (log.length > (cfg.logSize || 200)) {
      log.shift();
    }
    global.set('simLog', log);
    node.status({ fill: msg.statusCode < 400 ? 'green' : 'red', shape: 'dot', text: `${msg.sim.barcode} → ${msg.sim.to}: ${decision ? decision.outcome : msg.statusCode}` });
    return null;
  }),
  outputs: 0,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 770,
  y: 100,
  wires: [],
});
for (const [i, [method, url, name]] of [
  ['get', '/sim/state', 'GET /sim/state'],
  ['post', '/sim/faults', 'POST /sim/faults'],
  ['delete', '/sim/faults', 'DELETE /sim/faults'],
].entries()) {
  add({ id: `f30000000000001${i}`, type: 'http in', z: TAB_SIM, name, url, method, upload: false, swaggerDoc: '', x: 150, y: 200 + i * 50, wires: [[SIM_STATE]] });
}
add({
  id: SIM_STATE,
  type: 'function',
  z: TAB_SIM,
  name: 'Simulator steuern',
  func: body(function () {
    const method = msg.req.method;
    const faults = global.get('simFaults') || {};
    msg.headers = { 'content-type': 'application/json' };
    msg.statusCode = 200;
    if (method === 'POST') {
      const f = msg.payload || {};
      if (!f.plcCode) {
        msg.statusCode = 400;
        msg.payload = { message: 'plcCode fehlt' };
        return msg;
      }
      faults[f.plcCode] = { code: f.code, message: f.message };
      global.set('simFaults', faults);
    } else if (method === 'DELETE') {
      global.set('simFaults', {});
    }
    msg.payload = {
      enabled: String(env.get('SIMULATOR_ENABLED')) === 'true',
      config: global.get('simConfig'),
      faults: global.get('simFaults') || {},
      log: (global.get('simLog') || []).slice(-100),
    };
    return msg;
  }),
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 380,
  y: 250,
  wires: [['f300000000000008']],
});
add({ id: 'f300000000000008', type: 'http response', z: TAB_SIM, name: 'Antwort', statusCode: '', headers: {}, x: 580, y: 250, wires: [] });

// ---------------------------------------------------------------------------
// Tab: Node-RED-Programm „send-to-plc“ (Beispiel für das Programm node-red)
// ---------------------------------------------------------------------------
const TAB_PROGRAM = 'f000000000000006';
add({
  id: TAB_PROGRAM,
  type: 'tab',
  label: 'Programm: send-to-plc',
  disabled: false,
  info:
    'Beispiel für ein Materialfluss-Programm in Node-RED. Eine Action mit `program: node-red` und ' +
    '`params: { flow: "send-to-plc", toPlc: "<plcCode>" }` veröffentlicht `wms/flow/program-requested`; ' +
    'dieser Flow antwortet mit einem Fahrbefehl über `POST /v1/flow/commands`.',
});
add({
  id: 'f600000000000001',
  type: 'mqtt in',
  z: TAB_PROGRAM,
  name: 'wms/flow/program-requested',
  topic: 'wms/flow/program-requested',
  qos: '1',
  datatype: 'json',
  broker: BROKER,
  nl: false,
  rap: true,
  rh: 0,
  inputs: 0,
  x: 180,
  y: 80,
  wires: [['f600000000000002']],
});
add({
  id: 'f600000000000002',
  type: 'function',
  z: TAB_PROGRAM,
  name: 'Ziel bestimmen',
  func: body(function () {
    const e = msg.payload;
    if (!e || e.type !== 'flow.program-requested' || e.payload.flow !== 'send-to-plc') {
      return null;
    }
    const seen = context.get('seen') || [];
    if (seen.includes(e.id)) {
      return null;
    }
    seen.push(e.id);
    while (seen.length > 1000) {
      seen.shift();
    }
    context.set('seen', seen);
    const p = e.payload;
    if (!p.barcode || !p.params.toPlc) {
      node.warn(`send-to-plc: Barcode oder toPlc fehlt (${e.id})`);
      return null;
    }
    msg.method = 'POST';
    msg.url = `${env.get('WMS_API_URL')}/v1/flow/commands`;
    msg.headers = { 'content-type': 'application/json' };
    msg.payload = { barcode: p.barcode, to: { plcCode: p.params.toPlc }, deviceId: p.deviceId || undefined, reason: `node-red:send-to-plc (${p.decisionId})` };
    return msg;
  }),
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 420,
  y: 80,
  wires: [['f600000000000003']],
});
add({
  id: 'f600000000000003',
  type: 'http request',
  z: TAB_PROGRAM,
  name: 'Fahrbefehl an WMS',
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
  x: 630,
  y: 80,
  wires: [['f600000000000004']],
});
add({
  id: 'f600000000000004',
  type: 'function',
  z: TAB_PROGRAM,
  name: 'Ergebnis',
  func: body(function () {
    node.status({ fill: msg.statusCode < 400 ? 'green' : 'red', shape: 'dot', text: `HTTP ${msg.statusCode}` });
    if (msg.statusCode >= 400) {
      node.warn(`Fahrbefehl abgelehnt: ${JSON.stringify(msg.payload)}`);
    }
    return null;
  }),
  outputs: 0,
  timeout: 0,
  noerr: 0,
  initialize: '',
  finalize: '',
  libs: [],
  x: 820,
  y: 80,
  wires: [],
});

// Syntaxprüfung aller Funktions-Nodes: Fehler fallen beim Erzeugen auf, nicht erst in Node-RED.
const SANDBOX = ['msg', 'node', 'context', 'flow', 'global', 'env', 'RED'];
for (const n of nodes.filter((x) => x.type === 'function')) {
  for (const key of ['func', 'initialize', 'finalize']) {
    if (n[key]) {
      try {
        new Function(...SANDBOX, `return (async () => {\n${n[key]}\n})`);
      } catch (error) {
        console.error(`Syntaxfehler in Node "${n.name}" (${key}): ${error.message}`);
        process.exit(1);
      }
    }
  }
}

writeFileSync(out, `${JSON.stringify(nodes, null, 2)}\n`);
console.log(`${nodes.length} Nodes nach ${out} geschrieben`);
