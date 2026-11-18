/**
 * Fährt die Compose-Umgebung herunter und löscht ihre Volumes (`docker compose down -v`).
 *
 * Compose prüft auch beim Herunterfahren die Pflicht-Variablen aus der .env (`${VAR:?…}`). Zum Abbauen
 * werden die Geheimnisse aber nicht gebraucht – fehlende Werte werden hier nur für diesen Aufruf mit
 * einem Platzhalter belegt. Vorhandene Werte (aus der Umgebung oder der .env) bleiben unberührt.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const required = [...new Set([...compose.matchAll(/\$\{(WMS_[A-Z0-9_]+):\?/g)].map((m) => m[1]))];

const fromFile = new Map();
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[2] !== '') fromFile.set(m[1], m[2]);
  }
}

const env = { ...process.env };
for (const name of required) {
  if (!env[name] && !fromFile.has(name)) env[name] = 'nur-zum-herunterfahren';
}

const result = spawnSync('docker', ['compose', 'down', '-v', ...process.argv.slice(2)], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
