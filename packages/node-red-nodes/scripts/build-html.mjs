#!/usr/bin/env node
/**
 * Erzeugt die Editor-Dateien nodes/*.html aus einer Beschreibung je Node.
 * Ändern: hier anpassen, dann `node scripts/build-html.mjs` (der Test prüft, dass die Dateien aktuell sind).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../nodes/', import.meta.url));
const COLOR = '#7FB7DF';
const TEST_COLOR = '#C7E9C0';

const SPEC_HINT = 'Fester Wert oder <code>msg.…</code> (z. B. <code>msg.payload.barcode</code>)';
const LOCATION_KINDS = [
  ['erpCode', 'ERP-Code'],
  ['plcCode', 'Anlagen-Code (plcCode)'],
  ['locationId', 'Koordinate'],
  ['id', 'Platz-id'],
];

/** Feldbeschreibung → HTML-Zeile im Editor. */
function row(f, prefix = 'node-input') {
  const id = `${prefix}-${f.name}`;
  if (f.type === 'select') {
    return `<div class="form-row"><label for="${id}">${f.label}</label><select id="${id}">${f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`;
  }
  if (f.type === 'checkbox') {
    return `<div class="form-row"><label for="${id}">${f.label}</label><input type="checkbox" id="${id}" style="width:auto"></div>`;
  }
  if (f.type === 'config') {
    return `<div class="form-row"><label for="${id}">${f.label}</label><input type="text" id="${id}"></div>`;
  }
  if (f.type === 'password') {
    return `<div class="form-row"><label for="${id}">${f.label}</label><input type="password" id="${id}" placeholder="${f.placeholder ?? ''}"></div>`;
  }
  if (f.type === 'list') {
    return `<div class="form-row ${id}-row"><label>${f.label}</label><ol id="${id}-list"></ol></div>`;
  }
  return `<div class="form-row"><label for="${id}">${f.label}</label><input type="text" id="${id}" placeholder="${f.placeholder ?? ''}"></div>`;
}

const listScript = (name, columns) => `
      const list = $('#node-input-${name}-list').css('min-height', '120px').editableList({
        addItem: function (container, i, item) {
          ${columns
            .map((c) =>
              c.options
                ? `$('<select class="col-${c.key}" style="width:${c.width}">${c.options.map((o) => `<option value="${o}">${o}</option>`).join('')}</select>').val(item.${c.key} || '${c.options[0]}').appendTo(container);`
                : `$('<input type="text" class="col-${c.key}" placeholder="${c.placeholder}" style="width:${c.width}; margin-right:4px">').val(item.${c.key} || '').appendTo(container);`,
            )
            .join('\n          ')}
        },
        removable: true,
        sortable: true,
      });
      (this.${name} || []).forEach((item) => list.editableList('addItem', item));`;

const listSave = (name, columns) => `
      const items = [];
      $('#node-input-${name}-list').editableList('items').each(function () {
        const item = {};
        ${columns.map((c) => `item.${c.key} = $(this).find('.col-${c.key}').val();`).join(' ')}
        if (item.path) items.push(item);
      });
      this.${name} = items;`;

function html(n) {
  const prefix = n.category === 'config' ? 'node-config-input' : 'node-input';
  const fields = n.fields.map((f) => row(f, prefix)).join('\n    ');
  const defaults = JSON.stringify(n.defaults, null, 6).replace(/\n}/, '\n    }');
  const lists = n.fields.filter((f) => f.type === 'list');
  return `<!-- Generiert von scripts/build-html.mjs – dort ändern. -->
<script type="text/javascript">
  RED.nodes.registerType('${n.type}', {
    category: ${n.category ? `'${n.category}'` : "'WMS'"},
    color: '${n.test ? TEST_COLOR : COLOR}',
    defaults: ${defaults},${n.credentials ? `\n    credentials: ${JSON.stringify(n.credentials)},` : ''}
    inputs: ${n.inputs},
    outputs: ${n.outputs},
    ${n.outputLabels ? `outputLabels: ${JSON.stringify(n.outputLabels)},` : ''}
    icon: '${n.icon}',
    paletteLabel: '${n.palette}',
    label: function () {
      return this.name || ${n.label};
    },
    oneditprepare: function () {${lists.map((f) => listScript(f.name, f.columns)).join('')}
    },
    oneditsave: function () {${lists.map((f) => listSave(f.name, f.columns)).join('')}${
      n.errorOutput ? `\n      this.outputs = $('#node-input-errorOutput').is(':checked') ? 2 : 1;` : ''
    }
    },
  });
</script>

<script type="text/html" data-template-name="${n.type}">
    ${fields}
    <div class="form-row"><label for="${prefix}-name">Name</label><input type="text" id="${prefix}-name"></div>
</script>

<script type="text/html" data-help-name="${n.type}">
${n.help.trim()}
</script>
`;
}

const server = { name: 'server', label: 'Verbindung', type: 'config' };
const errorOutput = { name: 'errorOutput', label: 'Fehlerausgang', type: 'checkbox' };
const action = { server: { value: '', type: 'wms-config', required: true }, errorOutput: { value: false }, outputs: { value: 1 } };
const ERRORS_HELP = `
<h3>Fehler</h3>
<p>Antwortet das WMS mit einem Fehler (z. B. <code>409 PLACEMENT_REJECTED</code>), steht er in <code>msg.wmsError</code>
(<code>code</code>, <code>message</code>, <code>statusCode</code>, <code>details</code>). Ohne <i>Fehlerausgang</i> ist er ein
Node-RED-Fehler, den ein <b>Catch</b>-Node abfängt; mit <i>Fehlerausgang</i> geht die Nachricht an Ausgang 2.</p>`;
const OUT = { outputs: 1, outputLabels: ['Erfolg', 'Fehler'] };

const nodes = [
  {
    type: 'wms-config',
    category: 'config',
    palette: 'WMS-Verbindung',
    icon: 'bridge.svg',
    label: "'WMS ' + this.url",
    inputs: 0,
    outputs: 0,
    defaults: {
      name: { value: '' },
      url: { value: '${WMS_API_URL}', required: true },
      broker: { value: '', type: 'mqtt-broker', required: false },
      prefix: { value: 'wms' },
      timeout: { value: 10000 },
      tokenEnv: { value: 'WMS_API_TOKEN' },
    },
    credentials: { token: { type: 'password' } },
    fields: [
      { name: 'url', label: 'URL', placeholder: '${WMS_API_URL} oder http://api:3000' },
      { name: 'token', label: 'API-Token', type: 'password', placeholder: 'leer: aus Umgebungsvariable' },
      { name: 'tokenEnv', label: 'Token-Variable', placeholder: 'WMS_API_TOKEN' },
      { name: 'broker', label: 'MQTT-Broker', type: 'config' },
      { name: 'prefix', label: 'Topic-Präfix', placeholder: 'wms' },
      { name: 'timeout', label: 'Timeout (ms)', placeholder: '10000' },
    ],
    help: `<p>Verbindung zum WMS: REST-API und (optional) MQTT-Broker für Ereignisse.</p>
<p>Die URL darf Umgebungsvariablen enthalten, z. B. <code>\${WMS_API_URL}</code>. Ereignisse kommen über den gewählten
MQTT-Broker unter <code>&lt;Präfix&gt;/#</code>; doppelt gelieferte Ereignisse (gleiche <code>id</code>) werden verworfen.</p>
<p>Anmeldung an der API mit einem Service-Token (<code>Authorization: Bearer …</code>): entweder hier als <i>API-Token</i>
(verschlüsselt in den Credentials) oder – empfohlen – aus der Umgebungsvariable unter <i>Token-Variable</i>
(Standard <code>WMS_API_TOKEN</code>). Das Token wird in der API über <code>AUTH_SERVICE_TOKENS</code> mit Rollen versehen.</p>`,
  },
  {
    type: 'wms-api',
    palette: 'WMS-API',
    icon: 'white-globe.svg',
    label: "(this.method || 'GET') + ' ' + (this.path || '')",
    inputs: 1,
    ...OUT,
    errorOutput: true,
    defaults: { name: { value: '' }, ...action, method: { value: 'GET' }, path: { value: '' }, body: { value: 'msg.payload' } },
    fields: [
      server,
      { name: 'method', label: 'Methode', type: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => [m, m]) },
      { name: 'path', label: 'Pfad', placeholder: '/v1/transport-units/{barcode}' },
      { name: 'body', label: 'Body', placeholder: 'msg.payload' },
      errorOutput,
    ],
    help: `<p>Beliebiger Aufruf der WMS-API (siehe <code>/openapi.json</code>).</p>
<h3>Eingabe</h3><dl class="message-properties">
<dt class="optional">params <span class="property-type">object</span></dt><dd>Werte für Platzhalter <code>{name}</code> im Pfad (sonst aus <code>msg.payload</code>)</dd>
<dt class="optional">method, path</dt><dd>überschreiben die Einstellungen</dd></dl>
<h3>Ausgabe</h3><dl class="message-properties"><dt>payload</dt><dd>Antwort der API</dd><dt>statusCode</dt><dd>HTTP-Status</dd></dl>${ERRORS_HELP}`,
  },
  {
    type: 'wms-move-tu',
    palette: 'TU bewegen',
    icon: 'arrow-in.svg',
    label: "'TU bewegen'",
    inputs: 1,
    ...OUT,
    errorOutput: true,
    defaults: { name: { value: '' }, ...action, barcode: { value: 'msg.payload.barcode' }, locationKind: { value: 'erpCode' }, location: { value: 'msg.payload.location' }, mode: { value: 'checked' } },
    fields: [
      server,
      { name: 'barcode', label: 'Barcode', placeholder: 'msg.payload.barcode' },
      { name: 'locationKind', label: 'Platz über', type: 'select', options: LOCATION_KINDS },
      { name: 'location', label: 'Platz', placeholder: 'msg.payload.location' },
      { name: 'mode', label: 'Modus', type: 'select', options: [['checked', 'geprüft (Regeln durchsetzen)'], ['physical', 'physisch (Tatsache buchen, Verstöße melden)']] },
      errorOutput,
    ],
    help: `<p>Bewegt eine TU (samt Stapel) auf einen Platz, z. B. nach einem Scan. Alle Felder: ${SPEC_HINT}.</p>
<p>Im Modus <i>geprüft</i> lehnt das WMS Regelverletzungen ab (Kapazität, Sperre, Platzierung); im Modus <i>physisch</i> bucht es und meldet sie.</p>${ERRORS_HELP}`,
  },
  {
    type: 'wms-receive',
    palette: 'Wareneingang',
    icon: 'inject.svg',
    label: "this.mode === 'order' ? 'Wareneingang (Avis)' : 'Wareneingang (blind)'",
    inputs: 1,
    ...OUT,
    errorOutput: true,
    defaults: {
      name: { value: '' },
      ...action,
      mode: { value: 'blind' },
      orderId: { value: 'msg.payload.orderId' },
      sku: { value: 'msg.payload.sku' },
      amount: { value: 'msg.payload.amount' },
      unit: { value: 'msg.payload.unit' },
      unitBarcode: { value: 'msg.payload.barcode' },
      typeCode: { value: 'msg.payload.typeCode' },
      locationKind: { value: 'erpCode' },
      location: { value: 'msg.payload.location' },
      lot: { value: 'msg.payload.lot' },
      bestBefore: { value: 'msg.payload.bestBefore' },
    },
    fields: [
      server,
      { name: 'mode', label: 'Art', type: 'select', options: [['blind', 'ohne Avis'], ['order', 'gegen Auftrag (Avis)']] },
      { name: 'orderId', label: 'Auftrag', placeholder: 'msg.payload.orderId' },
      { name: 'sku', label: 'SKU', placeholder: 'msg.payload.sku' },
      { name: 'amount', label: 'Menge', placeholder: 'msg.payload.amount' },
      { name: 'unit', label: 'Einheit', placeholder: 'msg.payload.unit' },
      { name: 'unitBarcode', label: 'TU-Barcode', placeholder: 'msg.payload.barcode' },
      { name: 'typeCode', label: 'TU-Typ (neue TU)', placeholder: 'EURO' },
      { name: 'locationKind', label: 'Platz über', type: 'select', options: LOCATION_KINDS },
      { name: 'location', label: 'Platz', placeholder: 'msg.payload.location' },
      { name: 'lot', label: 'Charge', placeholder: 'msg.payload.lot' },
      { name: 'bestBefore', label: 'MHD', placeholder: 'msg.payload.bestBefore' },
      errorOutput,
    ],
    help: `<p>Erfasst Ware im Wareneingang – gegen einen Auftrag (Avis) oder ohne Avis. Ohne TU-Barcode legt das WMS eine neue TU
des angegebenen Typs an. Alle Felder: ${SPEC_HINT}; leere Charge/MHD werden weggelassen.</p>
<p>Überlieferung ohne Freigabe, unbekannte Einheit u. ä. kommen als Fehler (z. B. <code>OVERDELIVERY_NOT_ALLOWED</code>).</p>${ERRORS_HELP}`,
  },
  {
    type: 'wms-device-event',
    palette: 'Geräte-Ereignis',
    icon: 'serial.svg',
    label: "'Gerät: ' + (this.eventType || 'request')",
    inputs: 1,
    ...OUT,
    errorOutput: true,
    defaults: {
      name: { value: '' },
      ...action,
      eventType: { value: 'request' },
      locationKind: { value: 'plcCode' },
      location: { value: 'msg.payload.location' },
      barcode: { value: 'msg.payload.barcode' },
      deviceId: { value: '' },
      code: { value: '' },
      message: { value: '' },
      plcState: { value: '' },
      dryRun: { value: false },
    },
    fields: [
      server,
      { name: 'eventType', label: 'Ereignis', type: 'select', options: [['request', 'request (Zielanfrage)'], ['arrived', 'arrived (angekommen)'], ['location-status', 'location-status'], ['error', 'error (Störung)']] },
      { name: 'locationKind', label: 'Platz über', type: 'select', options: [LOCATION_KINDS[1], LOCATION_KINDS[0], LOCATION_KINDS[2], LOCATION_KINDS[3]] },
      { name: 'location', label: 'Platz', placeholder: 'msg.payload.location' },
      { name: 'barcode', label: 'Barcode', placeholder: 'msg.payload.barcode' },
      { name: 'deviceId', label: 'Geräte-ID', placeholder: 'SPS1' },
      { name: 'code', label: 'Fehlercode', placeholder: 'msg.payload.code' },
      { name: 'message', label: 'Meldung', placeholder: 'msg.payload.message' },
      { name: 'plcState', label: 'Anlagenzustand', placeholder: 'msg.payload.plcState (0 = in Ordnung)' },
      { name: 'dryRun', label: 'Probelauf', type: 'checkbox' },
    ].concat([errorOutput]),
    help: `<p>Meldet ein Geräte-Ereignis an den Materialfluss (Protokoll-Adapter einer Anlage). Die Antwort in <code>msg.payload</code>
enthält die Entscheidung mit Begründung (<code>decision.trace</code>) und ggf. den Fahrbefehl (<code>command</code>).</p>
<p>Bei <code>location-status</code> setzt <i>Anlagenzustand</i> den Zustand des Platzes (0 = in Ordnung, sonst Störungscode).
Bei <code>error</code> mit Barcode wird die Störung als Fehlermeldung an der TU erfasst.</p>${ERRORS_HELP}`,
  },
  {
    type: 'wms-event',
    palette: 'WMS-Ereignis',
    icon: 'bridge.svg',
    label: "'Ereignis ' + (this.types || '*')",
    inputs: 0,
    outputs: 1,
    defaults: { name: { value: '' }, server: { value: '', type: 'wms-config', required: true }, types: { value: '*' }, conditions: { value: [] } },
    fields: [
      server,
      { name: 'types', label: 'Typen', placeholder: 'stock.*, transport-order.finished' },
      { name: 'conditions', label: 'Bedingungen', type: 'list', columns: [{ key: 'path', placeholder: 'payload.barcode', width: '45%' }, { key: 'value', placeholder: 'Wert', width: '45%' }] },
    ],
    help: `<p>Gibt WMS-Ereignisse aus (über den MQTT-Broker der Verbindung). <i>Typen</i>: kommagetrennt, <code>*</code> als Platzhalter.
<i>Bedingungen</i>: Feld des Ereignisses (z. B. <code>payload.barcode</code>) muss dem Wert entsprechen.</p>
<h3>Ausgabe</h3><dl class="message-properties"><dt>payload</dt><dd>Ereignis (<code>id</code>, <code>type</code>, <code>occurredAt</code>, <code>payload</code>)</dd><dt>topic</dt><dd>MQTT-Topic</dd></dl>`,
  },
  {
    type: 'wms-wait-event',
    test: true,
    palette: 'Auf Ereignis warten',
    icon: 'watch.svg',
    label: "'warte auf ' + (this.types || '*')",
    inputs: 1,
    outputs: 2,
    outputLabels: ['Ereignis', 'Timeout'],
    defaults: {
      name: { value: '' },
      server: { value: '', type: 'wms-config', required: true },
      types: { value: '' , required: true },
      conditions: { value: [] },
      timeout: { value: 10000 },
      lookbackMs: { value: 5000 },
    },
    fields: [
      server,
      { name: 'types', label: 'Typen', placeholder: 'transport-order.finished' },
      { name: 'conditions', label: 'Bedingungen', type: 'list', columns: [{ key: 'path', placeholder: 'payload.number', width: '45%' }, { key: 'value', placeholder: 'msg.payload.number', width: '45%' }] },
      { name: 'timeout', label: 'Timeout (ms)', placeholder: '10000' },
      { name: 'lookbackMs', label: 'Rückblick (ms)', placeholder: '5000' },
    ],
    help: `<p>Wartet auf ein passendes Ereignis – mit Timeout statt fester Pause. Bedingungswerte dürfen auf die Nachricht verweisen
(<code>msg.payload.number</code>), so lässt sich ein Ereignis einem Aufruf zuordnen.</p>
<p>Ereignisse seit dem letzten WMS-Aufruf dieser Nachricht (<code>msg.wmsRequestedAt</code>, sonst im <i>Rückblick</i>) zählen mit,
damit ein schnelles Ereignis nicht verloren geht.</p>
<h3>Ausgaben</h3><ol class="node-ports"><li>Ereignis in <code>msg.event</code></li><li>Timeout, <code>msg.wmsError.code</code> = <code>EVENT_TIMEOUT</code></li></ol>
<p>Mit <code>msg.test</code> (siehe <i>Test starten</i>) wird ein Testschritt notiert.</p>`,
  },
  {
    type: 'wms-test-start',
    test: true,
    palette: 'Test starten',
    icon: 'trigger.svg',
    label: "'Test ' + (this.name || '')",
    inputs: 1,
    outputs: 1,
    defaults: { name: { value: '' } },
    fields: [],
    help: `<p>Beginnt einen Test: <code>msg.test = { name, runId, startedAt, steps: [] }</code>. Folgende Prüf- und Warte-Nodes notieren
ihre Schritte dort; <i>Testergebnis</i> wertet aus. Läuft der Test als Szenario im Testframework, wird <code>msg.scenario</code> mitgeführt.</p>`,
  },
  {
    type: 'wms-assert',
    test: true,
    palette: 'Prüfen',
    icon: 'switch.svg',
    label: "'prüfe ' + ((this.checks || []).map((c) => c.path).join(', ') || '…')",
    inputs: 1,
    outputs: 2,
    outputLabels: ['bestanden', 'nicht bestanden'],
    defaults: { name: { value: '' }, checks: { value: [{ path: 'statusCode', op: 'eq', value: '200' }] } },
    fields: [
      {
        name: 'checks',
        label: 'Bedingungen',
        type: 'list',
        columns: [
          { key: 'path', placeholder: 'payload.state', width: '38%' },
          { key: 'op', options: ['eq', 'neq', 'exists', 'notExists', 'contains', 'gt', 'lt', 'length'], width: '18%' },
          { key: 'value', placeholder: 'Wert oder msg.…', width: '36%' },
        ],
      },
    ],
    help: `<p>Prüft Felder der Nachricht, z. B. <code>statusCode</code> eq <code>201</code> oder <code>payload.state</code> eq <code>STARTED</code>.
Verglichen wird als Text (Dezimalwerte), <code>gt</code>/<code>lt</code> numerisch. Werte dürfen <code>msg.…</code> sein.</p>
<h3>Ausgaben</h3><ol class="node-ports"><li>bestanden</li><li>nicht bestanden (Schritt mit Abweichung in <code>msg.test.steps</code>)</li></ol>`,
  },
  {
    type: 'wms-test-result',
    test: true,
    palette: 'Testergebnis',
    icon: 'debug.svg',
    label: "'Testergebnis'",
    inputs: 1,
    outputs: 1,
    defaults: { name: { value: '' } },
    fields: [],
    help: `<p>Wertet <code>msg.test</code> aus: <code>passed</code> (alle Schritte bestanden) und <code>durationMs</code>. Ein Fehler eines
WMS-Nodes (<code>msg.wmsError</code>) zählt als fehlgeschlagener Schritt.</p>
<p>Im Testframework werden Schritte und Ergebnis in <code>msg.scenario</code> übertragen; danach mit einem <code>link out</code> („return“) antworten.</p>`,
  },
  {
    type: 'wms-erp-in',
    palette: 'ERP einlesen',
    icon: 'file-in.svg',
    label: "'ERP einlesen (' + (this.format || 'json') + ')'",
    inputs: 1,
    ...OUT,
    errorOutput: true,
    defaults: {
      name: { value: '' },
      ...action,
      format: { value: 'json' },
      kind: { value: 'outbound-order' },
      target: { value: '' },
      messageIdPrefix: { value: 'msg.filename' },
      options: { value: '' },
    },
    fields: [
      server,
      { name: 'format', label: 'Format', type: 'select', options: [['json', 'JSON (kanonisch)'], ['csv', 'CSV'], ['idoc', 'SAP IDoc (XML)']] },
      { name: 'kind', label: 'CSV-Inhalt', type: 'select', options: [['product', 'Artikel'], ['receiving-order', 'Avise'], ['outbound-order', 'Auslageraufträge']] },
      { name: 'target', label: 'Packplatz (ERP-Code)', placeholder: 'z. B. VS-01 – für Auslageraufträge ohne Ziel' },
      { name: 'messageIdPrefix', label: 'Nachrichten-ID', placeholder: 'msg.filename' },
      { name: 'options', label: 'Optionen (JSON)', placeholder: '{"units":{"ST":"PCS"},"delimiter":";"}' },
      errorOutput,
    ],
    help: `<p>Übersetzt Daten aus dem ERP ins kanonische Format und übergibt sie dem WMS (<code>POST /v1/erp/inbound</code>).
<code>msg.payload</code>: Text oder Buffer (CSV, IDoc-XML) bzw. Objekt (JSON).</p>
<ul><li><b>JSON</b>: kanonische Nachricht, Liste oder <code>{ messages: [...] }</code></li>
<li><b>CSV</b>: Artikel, Avise oder Auslageraufträge (eine Zeile je Position); Nachrichten-ID = Dateiname + Auftrag bzw. Artikel</li>
<li><b>SAP IDoc</b>: MATMAS (Artikel), ORDERS (Avis), DELVRY (Auslagerauftrag); Nachrichten-ID = IDoc-Nummer</li></ul>
<p>Die Art einer CSV-Datei lässt sich je Nachricht mit <code>msg.erpKind</code> setzen (product, receiving-order, outbound-order).</p>
<p>Dieselbe Nachrichten-ID verarbeitet das WMS nur einmal. Ergebnis in <code>msg.payload</code>: <code>total</code>, <code>processed</code>,
<code>failed</code>, <code>duplicates</code>, <code>results</code>. Fachliche Fehler stehen im ERP-Protokoll (Seite <b>ERP</b>).
Optionen: <code>units</code> (SAP-Einheit → WMS-Einheit), <code>delimiter</code>, <code>language</code>, <code>keepLeadingZeros</code>.</p>${ERRORS_HELP}`,
  },
  {
    type: 'wms-erp-out',
    palette: 'ERP ausgeben',
    icon: 'file-out.svg',
    label: "'ERP ausgeben (' + (this.format || 'json') + ')'",
    inputs: 1,
    ...OUT,
    errorOutput: true,
    defaults: {
      name: { value: '' },
      ...action,
      format: { value: 'json' },
      types: { value: '' },
      limit: { value: '20' },
      directory: { value: '' },
      options: { value: '' },
      summary: { value: false },
    },
    fields: [
      server,
      { name: 'format', label: 'Format', type: 'select', options: [['json', 'JSON (kanonisch)'], ['csv', 'CSV'], ['idoc', 'SAP IDoc WMMBXY (XML)']] },
      { name: 'summary', label: 'Zusammenfassung', type: 'checkbox' },
      { name: 'types', label: 'Nur Arten', placeholder: 'leer = alle, z. B. goods-receipt,goods-issue' },
      { name: 'limit', label: 'Höchstens', placeholder: '20' },
      { name: 'directory', label: 'Verzeichnis', placeholder: 'für msg.filename, z. B. /data/erp/out' },
      { name: 'options', label: 'Optionen (JSON)', placeholder: '{"plant":"1000","storageLocation":"0001","decimalComma":true}' },
      errorOutput,
    ],
    help: `<p>Holt fällige Rückmeldungen ans ERP ab (Wareneingang, Warenausgang, Bestandsänderung, Bestandsabgleich) und gibt
je Rückmeldung eine Nachricht aus: <code>msg.payload</code> (Inhalt im Zielformat), <code>msg.filename</code>, <code>msg.headers</code>
und <code>msg.erp</code>. Mit einem Inject-Node zyklisch auslösen (z. B. alle 30 s).</p>
<p>Danach senden (HTTP-Request, Datei schreiben …) und mit <b>ERP quittieren</b> bestätigen. Ohne Quittung liefert das WMS die Rückmeldung
nach 5 Minuten erneut aus. Nicht übersetzbare Rückmeldungen (z. B. Bestandsabgleich als IDoc) werden sofort als Fehlversuch gemeldet.</p>
<p>IDoc-Optionen: <code>plant</code>, <code>storageLocation</code>, <code>client</code>, <code>senderPartner</code>, <code>receiverPartner</code>,
<code>movementTypes</code> (z. B. <code>{"loss":"551"}</code>), <code>units</code>. CSV: <code>delimiter</code>, <code>decimalComma</code>.</p>
<p><i>Zusammenfassung</i>: Am Ende zusätzlich eine Nachricht ohne <code>msg.erp</code> mit <code>msg.erpSummary = { claimed, sent }</code>
(z. B. für die Antwort eines HTTP-Endpunkts; mit einem Switch-Node von den Rückmeldungen trennen).</p>${ERRORS_HELP}`,
  },
  {
    type: 'wms-erp-ack',
    palette: 'ERP quittieren',
    icon: 'status.svg',
    label: "'ERP quittieren'",
    inputs: 1,
    ...OUT,
    errorOutput: true,
    defaults: {
      name: { value: '' },
      ...action,
      erpReference: { value: '' },
    },
    fields: [
      server,
      { name: 'erpReference', label: 'ERP-Beleg', placeholder: 'z. B. msg.payload.documentNumber (optional)' },
      errorOutput,
    ],
    help: `<p>Bestätigt eine Rückmeldung aus <b>ERP ausgeben</b> (<code>msg.erp.id</code>). Ist <code>msg.error</code> gesetzt (z. B. über einen
Catch-Node) oder <code>msg.statusCode</code> ≥ 300 (HTTP-Request), wird ein Fehlversuch gemeldet – das WMS versucht es mit wachsender
Wartezeit erneut und meldet nach zu vielen Versuchen <code>erp-message.failed</code>. Sonst gilt die Rückmeldung als zugestellt;
optional mit Belegnummer des ERP.</p>${ERRORS_HELP}`,
  },
];

// Mit --check nur vergleichen (Test/CI): Abweichung = Fehler.
const check = process.argv.includes('--check');
const stale = [];
for (const n of nodes) {
  const file = `${dir}${n.type}.html`;
  const content = html(n);
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) stale.push(n.type);
  } else {
    writeFileSync(file, content);
  }
}
if (check && stale.length) {
  console.error(`Veraltet: ${stale.join(', ')} – node scripts/build-html.mjs ausführen`);
  process.exit(1);
}
console.log(check ? 'Editor-Dateien aktuell' : `${nodes.length} Editor-Dateien geschrieben`);
