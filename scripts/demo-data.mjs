#!/usr/bin/env node
/**
 * Legt Demo-Daten über die öffentliche API an, damit Leitstand und Scanner
 * etwas zeigen. Wiederholbar: Vorhandenes (409) wird übersprungen.
 * Nur synthetische Daten, keine realen Kunden.
 *
 *   node scripts/demo-data.mjs            # API aus .env (WMS_API_PORT) oder http://localhost:3000
 *   WMS_API_URL=http://localhost:13000 node scripts/demo-data.mjs
 */
import { existsSync } from 'node:fs';

if (existsSync(new URL('../.env', import.meta.url))) process.loadEnvFile(new URL('../.env', import.meta.url));
const base = (process.env.WMS_API_URL ?? `http://localhost:${process.env.WMS_API_PORT ?? '3000'}`).replace(/\/$/, '');
const inDays = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

let created = 0;
let skipped = 0;
async function call(method, path, body, { allowConflict = true } = {}) {
  const res = await fetch(`${base}${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 409 && allowConflict) {
    skipped++;
    return null;
  }
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text}`);
  created++;
  return data;
}

console.log(`Demo-Daten für ${base}`);
await call('GET', '/health', undefined, { allowConflict: false });

// Lagerstruktur
await call('POST', '/v1/location-types', { code: 'REGAL', description: 'Fachbodenregal' });
await call('POST', '/v1/location-types', { code: 'BODEN', description: 'Bodenplatz' });
await call('POST', '/v1/location-types', { code: 'FOERDER', description: 'Fördertechnik' });
for (const [name, parentName, description] of [
  ['LAGER', null, 'Gesamtes Lager'],
  ['WE', 'LAGER', 'Wareneingang'],
  ['REGAL-A', 'LAGER', 'Regalgasse A'],
  ['REGAL-B', 'LAGER', 'Regalgasse B'],
  ['VERSAND', 'LAGER', 'Versandzone'],
  ['FT', 'LAGER', 'Fördertechnik'],
  ['HRL', 'LAGER', 'Hochregal'],
]) await call('POST', '/v1/location-groups', { name, parentName, description });

const locations = [
  ['DWE/0001/0001/0001/0000', 'WE-01', null, 'WE', 'BODEN', 20],
  ['DWE/0001/0002/0001/0000', 'WE-02', null, 'WE', 'BODEN', 20],
  ['DVS/0001/0001/0001/0000', 'VS-01', null, 'VERSAND', 'BODEN', 20],
  ['DFT/0001/0001/0001/0000', 'IP-01', 'IP01', 'FT', 'FOERDER', 5],
  ['DFT/0001/0002/0001/0000', 'CV-01', 'CV01', 'FT', 'FOERDER', 5],
  ['DFT/0001/0003/0001/0000', 'CV-02', 'CV02', 'FT', 'FOERDER', 5],
  ['DHR/0001/0001/0001/0000', 'HRL-01', 'HRL01', 'HRL', 'REGAL', 10],
];
for (const aisle of ['A', 'B']) {
  for (let x = 1; x <= 4; x++) {
    locations.push([`DR${aisle}/0001/000${x}/0001/0000`, `${aisle}-0${x}`, null, `REGAL-${aisle}`, 'REGAL', 4]);
  }
}
let sortOrder = 0;
for (const [locationId, erpCode, plcCode, groupName, typeCode, maxTransportUnits] of locations) {
  await call('POST', '/v1/locations', { locationId, erpCode, plcCode, groupName, typeCode, maxTransportUnits, sortOrder: sortOrder++ });
}
await call('POST', '/v1/transport-unit-types', { code: 'EURO', description: 'Europalette' });
await call('POST', '/v1/transport-unit-types', { code: 'BOX', description: 'Kleinladungsträger' });

// Regelsätze: Einlagerung erster freier Platz, Auslagerung FEFO (Kunde FRISCH) sonst FIFO – nur falls keiner aktiv
for (const [decisionPoint, rules] of [
  ['putaway', [{ name: 'standard', when: { always: true }, strategy: 'first-free', params: { group: 'REGAL-A' } }]],
  [
    'allocation',
    [
      { name: 'frische', when: { field: 'order.customer', op: 'eq', value: 'FRISCH' }, strategy: 'fefo', params: { minRemainingDays: 14 } },
      { name: 'standard', when: { always: true }, strategy: 'fifo', params: {} },
    ],
  ],
]) {
  const existing = await call('GET', `/v1/strategy-rule-sets?decisionPoint=${decisionPoint}`);
  if (!existing.items.some((r) => r.status === 'ACTIVE')) {
    const draft = await call('POST', '/v1/strategy-rule-sets', { decisionPoint, description: 'Demo', rules });
    await call('POST', `/v1/strategy-rule-sets/${draft.id}/activate`);
  }
}

// Produkte und Bestand
await call('POST', '/v1/products', { sku: 'MILCH-1L', description: 'Milch 1 l', baseUnit: 'PCS', units: [{ unit: 'KAR', factor: '12' }] });
await call('POST', '/v1/products', { sku: 'MEHL-25', description: 'Mehl Typ 405', baseUnit: 'KG', units: [{ unit: 'SACK', factor: '25' }] });
await call('POST', '/v1/products', { sku: 'SCHRAUBE-M6', description: 'Schraube M6x20', baseUnit: 'PCS', units: [{ unit: 'PAK', factor: '100' }] });
const stock = [
  ['D-P001', 'EURO', 'A-01', 'MILCH-1L', '240', 'PCS', 'L2611', inDays(40)],
  ['D-P002', 'EURO', 'A-02', 'MILCH-1L', '120', 'PCS', 'L2612', inDays(10)],
  ['D-P003', 'EURO', 'A-03', 'MEHL-25', '500', 'KG', 'M77', inDays(300)],
  ['D-B001', 'BOX', 'B-01', 'SCHRAUBE-M6', '2500', 'PCS', null, null],
  ['D-B002', 'BOX', 'B-02', 'SCHRAUBE-M6', '800', 'PCS', null, null],
];
for (const [barcode, typeCode, at, sku, amount, unit, lot, bestBefore] of stock) {
  const have = await call('GET', `/v1/stock?barcode=${barcode}`);
  if (have.total > 0) continue;
  await call('POST', '/v1/receiving-blind-captures', {
    sku, quantity: { amount, unit }, unit: { barcode, typeCode }, location: { erpCode: at }, ...(lot ? { lot } : {}), ...(bestBefore ? { bestBefore } : {}),
  });
}

// Offener Wareneingang
await call('POST', '/v1/receiving-orders', {
  orderId: 'DEMO-WE-1',
  supplier: 'Musterlieferant',
  positions: [
    { kind: 'quantity', sku: 'MILCH-1L', quantity: { amount: '480', unit: 'PCS' } },
    { kind: 'quantity', sku: 'MEHL-25', quantity: { amount: '250', unit: 'KG' } },
  ],
});

// Auslagerauftrag, zugeteilt mit Lagerbewegungen zum Versand
const outbound = await call('POST', '/v1/outbound-orders', {
  orderId: 'DEMO-AUF-1', customer: 'FRISCH', target: { erpCode: 'VS-01' }, lines: [{ sku: 'MILCH-1L', quantity: { amount: '10', unit: 'KAR' } }, { sku: 'SCHRAUBE-M6', quantity: { amount: '3', unit: 'PAK' } }],
});
if (outbound) await call('POST', '/v1/outbound-orders/DEMO-AUF-1/allocate', { transport: 'movement' });

// Materialfluss: I-Punkt → CV01 → CV02 → Hochregal
await call('POST', '/v1/flow/routes', {
  routeId: 'DEMO-IP-HRL', description: 'I-Punkt ins Hochregal', source: { location: { plcCode: 'IP01' } }, target: { group: 'HRL' },
  steps: [
    { from: { plcCode: 'IP01' }, next: { plcCode: 'CV01' } },
    { from: { plcCode: 'CV01' }, next: { plcCode: 'CV02' } },
    { from: { plcCode: 'CV02' }, next: { plcCode: 'HRL01' } },
  ],
});
for (const action of [
  { name: 'demo-ip', eventType: 'request', place: { location: { plcCode: 'IP01' } }, program: 'create-order', params: { target: { group: 'HRL' }, typeCode: 'EURO' } },
  { name: 'demo-ft', eventType: 'request', place: { group: 'FT' }, program: 'route-next' },
  { name: 'demo-hrl', eventType: 'arrived', place: { group: 'HRL' }, program: 'route-next' },
]) await call('POST', '/v1/flow/actions', action);

console.log(`Fertig: ${created} Aufrufe ausgeführt, ${skipped} bereits vorhanden.`);
console.log('Tipp: Materialfluss → Geräte-Ereignis „request“ an IP01 mit neuem Barcode (ohne Probelauf) – der Simulator in Node-RED fährt die TU ins Hochregal.');
