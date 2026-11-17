/**
 * Node-RED-Einstellungen der WMS-Umgebung. Alle Geheimnisse kommen aus
 * Umgebungsvariablen (.env, siehe `pnpm env:init`); ohne sie startet Node-RED nicht.
 *
 * - Editor und Admin-API: Benutzer `admin` (WMS_NODE_RED_ADMIN_PASSWORD)
 * - HTTP-Endpunkte der Flows (/test, /sim, /examples): Benutzer `wms` (WMS_NODE_RED_HTTP_PASSWORD)
 * - MQTT-Zugangsdaten des Brokers: werden beim Start in flows_cred.json geschrieben
 */
const fs = require('fs');
const path = require('path');
// bcryptjs gehört zu Node-RED; settings.js liegt in /data, deshalb über das Arbeitsverzeichnis von Node-RED laden.
const bcrypt = (() => {
  try {
    return require('bcryptjs');
  } catch {
    return require(path.join(process.cwd(), 'node_modules', 'bcryptjs'));
  }
})();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} fehlt – pnpm env:init ausführen und die Umgebung neu starten`);
  return value;
}

const userDir = '/data';
const flowFile = 'flows.json';

// Zugangsdaten des MQTT-Broker-Nodes (id aus flows/scripts/build-flows.mjs) bei jedem Start
// aus der Umgebung setzen. Klartext ist hier vertretbar: die Werte stehen ohnehin in der Umgebung.
fs.writeFileSync(
  path.join(userDir, 'flows_cred.json'),
  JSON.stringify({ b0000000000000b1: { user: 'node-red', password: required('MQTT_NODE_RED_PASSWORD') } }, null, 2),
  { mode: 0o600 },
);

module.exports = {
  flowFile,
  userDir,
  credentialSecret: false,
  uiPort: 1880,
  adminAuth: {
    type: 'credentials',
    users: [{ username: 'admin', password: bcrypt.hashSync(required('NODE_RED_ADMIN_PASSWORD'), 10), permissions: '*' }],
  },
  httpNodeAuth: { user: 'wms', pass: bcrypt.hashSync(required('NODE_RED_HTTP_PASSWORD'), 10) },
  editorTheme: { projects: { enabled: false } },
  logging: { console: { level: 'info', metrics: false, audit: false } },
  functionExternalModules: false,
  diagnostics: { enabled: false },
  telemetry: { enabled: false },
};
