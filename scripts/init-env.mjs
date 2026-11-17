#!/usr/bin/env node
/**
 * Legt die .env an bzw. ergänzt sie: fehlende Einträge aus .env.example,
 * leere Geheimnisse (WMS_*_PASSWORD, WMS_*_TOKEN) mit Zufallswerten.
 * Vorhandene Werte werden nie überschrieben. Geheimnisse werden nicht ausgegeben.
 *
 *   pnpm env:init
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const examplePath = new URL('.env.example', root);
const envPath = new URL('.env', root);

const parse = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );

const example = readFileSync(examplePath, 'utf8');
const existingText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const existing = parse(existingText);
const isSecret = (key) => /_(PASSWORD|TOKEN)$/.test(key);
const secret = () => randomBytes(24).toString('base64url'); // 32 Zeichen, ohne Sonderzeichen für Shell und URLs

const added = [];
const generated = [];
let output = existingText.trimEnd();
const missing = [];
for (const line of example.split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!match) continue;
  const [, key, value] = match;
  if (key in existing) {
    if (isSecret(key) && existing[key] === '') {
      existing[key] = secret();
      output = output.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${existing[key]}`);
      generated.push(key);
    }
    continue;
  }
  const v = isSecret(key) && value === '' ? secret() : value;
  if (isSecret(key) && value === '') generated.push(key);
  missing.push(`${key}=${v}`);
  added.push(key);
}
if (missing.length) {
  output = `${output}${output ? '\n\n' : ''}# Ergänzt von pnpm env:init (${new Date().toISOString().slice(0, 10)})\n${missing.join('\n')}`;
}
writeFileSync(envPath, `${output}\n`, { mode: 0o600 });
console.log(existingText ? '.env ergänzt' : '.env angelegt');
if (added.length) console.log(`  neue Einträge: ${added.join(', ')}`);
if (generated.length) console.log(`  Geheimnisse erzeugt: ${generated.join(', ')}`);
if (!added.length && !generated.length) console.log('  nichts zu tun – alle Einträge vorhanden');
console.log('Anmeldung an der Oberfläche: Benutzer admin, Passwort = WMS_ADMIN_PASSWORD in der .env');
