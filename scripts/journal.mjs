#!/usr/bin/env node
/**
 * Buchungsjournal verankern und prüfen (Hash-Kette mit Merkle-Wurzel je Tag).
 *
 *   pnpm journal:anchor [datei]   Kopf der Kette und Tageswurzeln der letzten 7 Tage als JSON ausgeben bzw. schreiben –
 *                                 die Datei gehört an einen Ort, an den das WMS nicht schreiben kann
 *                                 (unveränderbare Sicherung, ERP, Ticket).
 *   pnpm journal:verify [datei]   Kette vollständig prüfen, mit Datei zusätzlich gegen den verankerten Stand.
 *                                 Exit-Code 1 bei jedem Befund.
 *
 * Anmeldung als admin mit WMS_ADMIN_PASSWORD aus der .env; API-Adresse aus WMS_API_URL oder WMS_API_PORT.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url));
const base = (process.env.WMS_API_URL ?? `http://localhost:${process.env.WMS_API_PORT ?? '3000'}`).replace(/\/$/, '');
const [command, file] = process.argv.slice(2);
if (!['anchor', 'verify'].includes(command)) {
  console.error('Aufruf: journal.mjs anchor [datei] | verify [datei]');
  process.exit(2);
}
if (!process.env.WMS_ADMIN_PASSWORD) {
  console.error('WMS_ADMIN_PASSWORD fehlt – pnpm env:init ausführen');
  process.exit(2);
}
const login = await fetch(`${base}/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: process.env.WMS_ADMIN_PASSWORD }),
});
if (login.status !== 200) {
  console.error(`Anmeldung als admin fehlgeschlagen: HTTP ${login.status}`);
  process.exit(2);
}
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

if (command === 'anchor') {
  const head = await call('GET', '/v1/stock-journal/head');
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const d = await call('GET', `/v1/stock-journal/days/${day}`);
    if (d.count) days.push({ day: d.day, root: d.root, count: d.count });
  }
  const anchor = { createdAt: new Date().toISOString(), api: base, anchor: { seq: head.seq, hash: head.hash }, days };
  const text = `${JSON.stringify(anchor, null, 2)}\n`;
  if (file) {
    writeFileSync(file, text);
    console.log(`Anker geschrieben: ${file} (Buchung Nr. ${head.seq}, ${days.length} Tageswurzeln)`);
  } else process.stdout.write(text);
} else {
  const saved = file ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const result = await call('POST', '/v1/stock-journal/verify', saved ? { anchor: saved.anchor, days: saved.days.map(({ day, root }) => ({ day, root })) } : {});
  console.log(`${result.checked} Buchungen geprüft, Kopf Nr. ${result.head.seq}${result.pending ? `, ${result.pending} noch nicht verkettet (laufende Transaktionen)` : ''}`);
  if (result.anchor) console.log(`Anker Nr. ${result.anchor.seq}: ${result.anchor.ok ? 'stimmt' : 'WEICHT AB'}`);
  for (const d of result.days) console.log(`Tageswurzel ${d.day}: ${d.ok ? 'stimmt' : 'WEICHT AB'}`);
  for (const p of result.problems) console.log(`✗ ${p.code}${p.seq != null ? ` bei Nr. ${p.seq}` : ''}: ${p.message}`);
  console.log(result.ok ? 'Journal unverändert.' : 'Journal wurde verändert – Sicherung mit passendem Anker wiederherstellen.');
  process.exit(result.ok ? 0 : 1);
}
