'use strict';
const { child, childrenOf, parseXml, textOf, toXml } = require('./xml');

/**
 * SAP-IDoc im XML-Format (wie per Port-Typ „XML-Datei“ oder SAP PI/CPI geliefert).
 *
 * Eingang:
 *   MATMAS (Materialstamm)        → Artikel (product, upsert)
 *   ORDERS (Bestellung)           → Avis (receiving-order)
 *   DELVRY (Auslieferung)         → Auslagerauftrag (outbound-order)
 * Ausgang:
 *   WMMBXY (Warenbewegung, WMMBID02): Wareneingang (BWART 101 mit Bestellbezug bzw. 501 ohne Avis),
 *   Warenausgang (601), Bestandsänderung (701 Zugang / 702 Abgang). Bewegungsarten, Werk, Lagerort
 *   und Einheiten-Zuordnung sind einstellbar, weil sie vom SAP-Customizing abhängen.
 *
 * Nur die üblichen Segmente und Felder werden ausgewertet; unbekannte Segmente werden ignoriert.
 */

/** SAP-Einheit → WMS-Einheit (z. B. ST → PCS) und zurück. */
const DEFAULT_UNITS = { ST: 'PCS', KAR: 'KAR', KG: 'KG', G: 'G', L: 'L', M: 'M', PAL: 'PAL', PAK: 'PAK', SAK: 'SACK' };

function unitMaps(options) {
  const toWms = { ...DEFAULT_UNITS, ...(options.units ?? {}) };
  const toSap = Object.fromEntries(Object.entries(toWms).map(([sap, wms]) => [wms, sap]));
  return { toWms: (u) => toWms[u] ?? u, toSap: (u) => toSap[u] ?? u };
}

const stripZeros = (s, options) => (options.keepLeadingZeros ? s : s.replace(/^0+(?=.)/, ''));
const num = (s) => {
  const v = String(s).trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`IDoc: Menge „${s}“ ist keine Zahl`);
  return v.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};
const sapDate = (d) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00Z` : undefined);

/** IDoc-XML → kanonische Eingangsnachrichten (ein IDoc-Dokument kann mehrere IDOC-Elemente enthalten). */
function inboundFromIdoc(xml, options = {}) {
  const root = parseXml(xml);
  const units = unitMaps(options);
  const idocs = childrenOf(root, 'IDOC');
  if (!idocs.length) throw new Error(`IDoc: kein <IDOC> unter <${root.name}>`);
  const basicType = (root.name.match(/^[A-Z]+\d*/) ?? [''])[0];
  return idocs.map((idoc) => {
    const control = child(idoc, 'EDI_DC40');
    const type = textOf(control, 'IDOCTYP') || basicType;
    const docnum = stripZeros(textOf(control, 'DOCNUM'), {}) || `${Date.now()}`;
    const messageId = `IDOC-${docnum}`;
    if (/^MATMAS/.test(type)) return { messageId, type: 'product', action: 'upsert', data: matmas(idoc, units, options) };
    if (/^ORDERS/.test(type)) return { messageId, type: 'receiving-order', action: 'create', data: orders(idoc, units, options) };
    if (/^DELVRY/.test(type)) return { messageId, type: 'outbound-order', action: 'create', data: delvry(idoc, units, options) };
    throw new Error(`IDoc: Basistyp „${type}“ wird nicht unterstützt (MATMAS, ORDERS, DELVRY)`);
  });
}

function matmas(idoc, units, options) {
  const mara = child(idoc, 'E1MARAM');
  if (!mara) throw new Error('MATMAS: Segment E1MARAM fehlt');
  const sku = stripZeros(textOf(mara, 'MATNR'), options);
  const baseUnit = units.toWms(textOf(mara, 'MEINS'));
  const texts = childrenOf(mara, 'E1MAKTM');
  const lang = options.language ?? 'D';
  const description = textOf(texts.find((t) => textOf(t, 'SPRAS') === lang || textOf(t, 'SPRAS_ISO') === 'DE') ?? texts[0], 'MAKTX');
  const alt = childrenOf(mara, 'E1MARMM')
    .map((m) => ({ unit: units.toWms(textOf(m, 'MEINH')), umrez: Number(textOf(m, 'UMREZ') || 1), umren: Number(textOf(m, 'UMREN') || 1) }))
    .filter((m) => m.unit && m.unit !== baseUnit)
    .map((m) => ({ unit: m.unit, factor: num(String(m.umrez / m.umren)) }));
  return { sku, baseUnit, ...(description ? { description } : {}), ...(alt.length ? { units: alt } : {}) };
}

function orders(idoc, units, options) {
  const head = child(idoc, 'E1EDK01');
  const orderId = textOf(head, 'BELNR');
  if (!orderId) throw new Error('ORDERS: Bestellnummer (E1EDK01/BELNR) fehlt');
  const supplier = childrenOf(idoc, 'E1EDKA1').find((p) => textOf(p, 'PARVW') === 'LF');
  const delivery = childrenOf(idoc, 'E1EDK03').find((d) => textOf(d, 'IDDAT') === '002');
  const positions = childrenOf(idoc, 'E1EDP01').map((p) => {
    const material = childrenOf(p, 'E1EDP19').find((m) => textOf(m, 'QUALF') === '002') ?? child(p, 'E1EDP19');
    const sku = stripZeros(textOf(material, 'IDTNR'), options);
    if (!sku) throw new Error(`ORDERS ${orderId}: Material fehlt in Position ${textOf(p, 'POSEX')}`);
    return { posNo: Number(textOf(p, 'POSEX')) || undefined, sku, quantity: { amount: num(textOf(p, 'MENGE')), unit: units.toWms(textOf(p, 'MENEE')) } };
  });
  if (!positions.length) throw new Error(`ORDERS ${orderId}: keine Positionen (E1EDP01)`);
  return {
    orderId,
    ...(supplier ? { supplierCode: stripZeros(textOf(supplier, 'PARTN'), options) } : {}),
    ...(delivery && sapDate(textOf(delivery, 'DATUM')) ? { expectedAt: sapDate(textOf(delivery, 'DATUM')) } : {}),
    positions: positions.map((p) => (p.posNo ? p : { sku: p.sku, quantity: p.quantity })),
  };
}

function delvry(idoc, units, options) {
  const head = child(idoc, 'E1EDL20');
  if (!head) throw new Error('DELVRY: Segment E1EDL20 fehlt');
  const orderId = stripZeros(textOf(head, 'VBELN'), options);
  const shipTo = childrenOf(head, 'E1ADRM1').find((a) => textOf(a, 'PARTNER_Q') === 'WE');
  const lines = childrenOf(head, 'E1EDL24').map((l) => {
    const amount = textOf(l, 'LFIMG');
    const lot = textOf(l, 'CHARG');
    return { sku: stripZeros(textOf(l, 'MATNR'), options), quantity: { amount: num(amount), unit: units.toWms(textOf(l, 'VRKME') || textOf(l, 'MEINS')) }, ...(lot ? { lot } : {}) };
  }).filter((l) => Number(l.quantity.amount) > 0);
  if (!lines.length) throw new Error(`DELVRY ${orderId}: keine Positionen mit Menge (E1EDL24)`);
  const address = shipTo
    ? Object.fromEntries(
        [
          ['name', textOf(shipTo, 'NAME1')],
          ['street', textOf(shipTo, 'STREET1')],
          ['postalCode', textOf(shipTo, 'POSTL_COD1')],
          ['city', textOf(shipTo, 'CITY1')],
          ['country', textOf(shipTo, 'COUNTRY1').toUpperCase()],
        ].filter(([, v]) => v),
      )
    : {};
  return {
    orderId,
    ...(shipTo && textOf(shipTo, 'PARTNER_ID') ? { customerCode: stripZeros(textOf(shipTo, 'PARTNER_ID'), options) } : {}),
    ...(options.target ? { target: options.target } : {}),
    ...(Object.keys(address).length ? { shipTo: address } : {}),
    lines,
  };
}

const MOVEMENT_TYPES = { receipt: '101', blindReceipt: '501', issue: '601', gain: '701', loss: '702' };
const field = (name, text) => ({ name, text: text === null || text === undefined ? '' : String(text) });
const ymd = (iso) => String(iso).slice(0, 10).replace(/-/g, '');
const pad = (n, len) => String(n).padStart(len, '0');

/** Kanonische Rückmeldung → WMMBXY-IDoc (XML). Bestandsabgleich wird nicht als IDoc geliefert (Fehler). */
function outboundToIdoc(message, options = {}) {
  const units = unitMaps(options);
  const bwart = { ...MOVEMENT_TYPES, ...(options.movementTypes ?? {}) };
  const plant = options.plant ?? '1000';
  const storageLocation = options.storageLocation ?? '0001';
  const d = message.data;
  const item = (sku, quantity, extra = {}) => ({
    name: 'E1MBXYI',
    attrs: { SEGMENT: '1' },
    children: [
      field('MATNR', sku),
      field('WERKS', plant),
      field('LGORT', storageLocation),
      field('CHARG', extra.lot),
      field('BWART', extra.bwart),
      field('ERFMG', String(quantity.amount).replace(/^-/, '')),
      field('ERFME', units.toSap(quantity.unit)),
      field('EBELN', extra.ebeln),
      field('EBELP', extra.ebelp),
      field('SGTXT', extra.text),
    ],
  });
  let reference;
  let items;
  switch (message.type) {
    case 'goods-receipt':
      reference = d.orderId ?? d.barcode;
      items = [item(d.sku, d.quantity, d.orderId && !d.blind ? { bwart: bwart.receipt, ebeln: d.orderId, ebelp: d.posNo ? pad(d.posNo * 10, 5) : undefined } : { bwart: bwart.blindReceipt, text: `TU ${d.barcode}` })];
      break;
    case 'goods-issue':
      reference = d.shipment ?? d.orderId;
      items = d.lines.map((l) => item(l.sku, l.quantity, { bwart: bwart.issue, lot: l.lot, text: d.orderId ? `Auftrag ${d.orderId}` : undefined }));
      break;
    case 'stock-change':
      reference = d.reference ?? d.barcode;
      items = [item(d.sku, d.delta, { bwart: String(d.delta.amount).startsWith('-') ? bwart.loss : bwart.gain, text: d.reason })];
      break;
    case 'stock-snapshot':
      throw new Error('IDoc: Der Bestandsabgleich wird nicht als WMMBXY geliefert – dafür CSV oder JSON verwenden');
    default:
      throw new Error(`IDoc: unbekannte Rückmeldung „${message.type}“`);
  }
  const docnum = pad(String(message.messageId).replace(/\D/g, '').slice(0, 16) || '0', 16);
  const control = {
    name: 'EDI_DC40',
    attrs: { SEGMENT: '1' },
    children: [
      field('TABNAM', 'EDI_DC40'),
      field('MANDT', options.client ?? '100'),
      field('DOCNUM', docnum),
      field('DIRECT', '2'),
      field('IDOCTYP', 'WMMBID02'),
      field('MESTYP', 'WMMBXY'),
      field('SNDPOR', options.senderPort ?? 'WMS'),
      field('SNDPRT', 'LS'),
      field('SNDPRN', options.senderPartner ?? 'WMS'),
      field('RCVPOR', options.receiverPort ?? 'SAPERP'),
      field('RCVPRT', 'LS'),
      field('RCVPRN', options.receiverPartner ?? 'SAPERP'),
      field('CREDAT', ymd(message.occurredAt)),
      field('REFINT', message.messageId),
    ],
  };
  const header = {
    name: 'E1MBXYH',
    attrs: { SEGMENT: '1' },
    children: [field('BLDAT', ymd(message.occurredAt)), field('BUDAT', ymd(message.occurredAt)), field('XBLNR', String(reference ?? '').slice(0, 16)), field('BKTXT', `WMS ${message.type}`.slice(0, 25)), ...items],
  };
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n${toXml({ name: 'WMMBID02', children: [{ name: 'IDOC', attrs: { BEGIN: '1' }, children: [control, header] }] })}\n`;
  return { contentType: 'application/xml', body, fileName: `WMMBXY_${ymd(message.occurredAt)}_${message.messageId.slice(0, 8)}.xml` };
}

module.exports = { inboundFromIdoc, outboundToIdoc, DEFAULT_UNITS, MOVEMENT_TYPES };
