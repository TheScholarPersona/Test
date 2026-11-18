'use strict';
const { decimal, parseCsv, stringifyCsv } = require('./csv');

/**
 * CSV-Austausch mit dem ERP. Spalten (Kopfzeile, Groß-/Kleinschreibung egal, Trennzeichen ; oder ,):
 *
 * Artikel:          sku; description; baseUnit; units (z. B. "KAR=12|PAL=480"); overdeliveryAllowed (ja/nein)
 * Avise:            orderId; supplierCode; supplier; expectedAt; priority; posNo; sku; amount; unit
 * Auslageraufträge: orderId; customerCode; customer; priority; target; shipToName; shipToStreet; shipToPostalCode;
 *                   shipToCity; shipToCountry; sku; amount; unit; lot
 *
 * Eine Zeile je Position; Kopfangaben stehen in jeder Zeile (es gilt die erste). `action` (create/cancel) ist optional.
 * Die Nachrichten-ID ist `<Präfix>:<Auftrag bzw. Artikel>` – dieselbe Datei noch einmal bucht nichts doppelt.
 */

const opt = (v) => (v === undefined || v === '' ? undefined : v);
const bool = (v) => (v === undefined || v === '' ? undefined : /^(ja|j|yes|y|true|1|x)$/i.test(v));

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!k) throw new Error(`Zeile ${row._line}: ${key} fehlt`);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  return groups;
}

const action = (rows) => (rows.some((r) => (r.action ?? '').toLowerCase() === 'cancel') ? 'cancel' : 'create');

/** CSV-Text → kanonische Eingangsnachrichten. `kind`: product | receiving-order | outbound-order. */
function inboundFromCsv(kind, text, options = {}) {
  const prefix = options.messageIdPrefix ?? 'csv';
  const rows = parseCsv(text, options);
  if (kind === 'product') {
    return rows.map((r) => {
      if (!r.sku || !r.baseunit) throw new Error(`Zeile ${r._line}: sku und baseUnit sind Pflicht`);
      const units = opt(r.units)
        ? r.units.split('|').map((u) => {
            const [unit, factor] = u.split('=').map((x) => x.trim());
            if (!unit || !factor) throw new Error(`Zeile ${r._line}: Einheit „${u}“ – erwartet z. B. KAR=12`);
            return { unit: unit.toUpperCase(), factor: decimal(factor, 'Faktor', r._line) };
          })
        : undefined;
      const data = { sku: r.sku, baseUnit: r.baseunit.toUpperCase(), ...(opt(r.description) ? { description: r.description } : {}), ...(units ? { units } : {}) };
      const overdelivery = bool(r.overdeliveryallowed);
      if (overdelivery !== undefined) data.overdeliveryAllowed = overdelivery;
      return { messageId: `${prefix}:${r.sku}`, type: 'product', action: 'upsert', data };
    });
  }
  if (kind === 'receiving-order') {
    return [...groupBy(rows, 'orderid')].map(([orderId, lines]) => {
      const head = lines[0];
      if (action(lines) === 'cancel') return { messageId: `${prefix}:${orderId}:cancel`, type: 'receiving-order', action: 'cancel', data: { orderId } };
      const data = {
        orderId,
        ...(opt(head.suppliercode) ? { supplierCode: head.suppliercode } : {}),
        ...(opt(head.supplier) ? { supplier: head.supplier } : {}),
        ...(opt(head.expectedat) ? { expectedAt: new Date(head.expectedat).toISOString() } : {}),
        ...(opt(head.priority) ? { priority: head.priority.toUpperCase() } : {}),
        positions: lines.map((l) => ({
          ...(opt(l.posno) ? { posNo: Number(l.posno) } : {}),
          sku: l.sku,
          quantity: { amount: decimal(l.amount, 'Menge', l._line), unit: (l.unit || '').toUpperCase() },
        })),
      };
      return { messageId: `${prefix}:${orderId}`, type: 'receiving-order', action: 'create', data };
    });
  }
  if (kind === 'outbound-order') {
    return [...groupBy(rows, 'orderid')].map(([orderId, lines]) => {
      const head = lines[0];
      if (action(lines) === 'cancel') return { messageId: `${prefix}:${orderId}:cancel`, type: 'outbound-order', action: 'cancel', data: { orderId } };
      const shipTo = Object.fromEntries(
        [
          ['name', head.shiptoname],
          ['street', head.shiptostreet],
          ['postalCode', head.shiptopostalcode],
          ['city', head.shiptocity],
          ['country', head.shiptocountry?.toUpperCase()],
        ].filter(([, v]) => opt(v)),
      );
      const data = {
        orderId,
        ...(opt(head.customercode) ? { customerCode: head.customercode } : {}),
        ...(opt(head.customer) ? { customer: head.customer } : {}),
        ...(opt(head.priority) ? { priority: head.priority.toUpperCase() } : {}),
        ...(opt(head.target) ? { target: head.target } : options.target ? { target: options.target } : {}),
        ...(Object.keys(shipTo).length ? { shipTo } : {}),
        lines: lines.map((l) => ({ sku: l.sku, quantity: { amount: decimal(l.amount, 'Menge', l._line), unit: (l.unit || '').toUpperCase() }, ...(opt(l.lot) ? { lot: l.lot } : {}) })),
      };
      return { messageId: `${prefix}:${orderId}`, type: 'outbound-order', action: 'create', data };
    });
  }
  throw new Error(`CSV: unbekannte Art „${kind}“ (erlaubt: product, receiving-order, outbound-order)`);
}

const COLUMNS = {
  'goods-receipt': ['messageId', 'occurredAt', 'orderId', 'posNo', 'sku', 'amount', 'unit', 'barcode', 'blind'],
  'goods-issue': ['messageId', 'occurredAt', 'orderId', 'shipment', 'carrierCode', 'sku', 'amount', 'unit', 'lot', 'bestBefore', 'barcode'],
  'stock-change': ['messageId', 'occurredAt', 'sku', 'barcode', 'delta', 'unit', 'reason', 'reference'],
  'stock-snapshot': ['messageId', 'takenAt', 'sku', 'lot', 'amount', 'unit'],
};

/** Kanonische Rückmeldung → CSV-Datei (eine Datei je Nachricht). Mit `decimalComma` wird „12,5“ geschrieben. */
function outboundToCsv(message, options = {}) {
  const num = (a) => (options.decimalComma ? String(a).replace('.', ',') : a);
  const base = { messageId: message.messageId, occurredAt: message.occurredAt };
  const d = message.data;
  let rows;
  switch (message.type) {
    case 'goods-receipt':
      rows = [{ ...base, orderId: d.orderId, posNo: d.posNo, sku: d.sku, amount: num(d.quantity.amount), unit: d.quantity.unit, barcode: d.barcode, blind: d.blind ? 'ja' : 'nein' }];
      break;
    case 'goods-issue':
      rows = d.lines.map((l) => ({ ...base, orderId: d.orderId, shipment: d.shipment, carrierCode: d.carrierCode, sku: l.sku, amount: num(l.quantity.amount), unit: l.quantity.unit, lot: l.lot, bestBefore: l.bestBefore, barcode: l.barcode }));
      break;
    case 'stock-change':
      rows = [{ ...base, sku: d.sku, barcode: d.barcode, delta: num(d.delta.amount), unit: d.delta.unit, reason: d.reason, reference: d.reference }];
      break;
    case 'stock-snapshot':
      rows = d.items.map((i) => ({ messageId: message.messageId, takenAt: d.takenAt, sku: i.sku, lot: i.lot, amount: num(i.quantity.amount), unit: i.quantity.unit }));
      break;
    default:
      throw new Error(`CSV: unbekannte Rückmeldung „${message.type}“`);
  }
  const stamp = String(message.occurredAt).replace(/[-:]/g, '').replace(/\..*$/, '');
  return { contentType: 'text/csv; charset=utf-8', body: stringifyCsv(rows, COLUMNS[message.type], options), fileName: `${message.type}_${stamp}_${message.messageId.slice(0, 8)}.csv` };
}

module.exports = { inboundFromCsv, outboundToCsv, CSV_COLUMNS: COLUMNS };
