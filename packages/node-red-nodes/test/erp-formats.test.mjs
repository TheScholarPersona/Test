import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ErpInboundMessageSchema, ErpOutboundMessageSchema } from '@wms/shared';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { toCanonical, fromCanonical } = require('../lib/erp/index.js');
const { parseCsv, stringifyCsv } = require('../lib/erp/csv.js');
const { parseXml } = require('../lib/erp/xml.js');

const example = (name) => readFileSync(new URL(`../examples/erp/${name}`, import.meta.url), 'utf8');
/** Jede erzeugte Eingangsnachricht muss das kanonische Format erfüllen, das die API annimmt. */
const valid = (messages) => messages.map((m) => ErpInboundMessageSchema.parse(m));

const receipt = { messageId: '0f8e7a6b-1111-4222-8333-944455556666', type: 'goods-receipt', occurredAt: '2026-11-18T09:30:00.000Z', data: { orderId: '4500004711', posNo: 1, sku: '100', quantity: { amount: '1200', unit: 'PCS' }, barcode: 'TU0000000001', blind: false, captureId: '0f8e7a6b-1111-4222-8333-944455550000' } };
const issue = { messageId: '1f8e7a6b-1111-4222-8333-944455556666', type: 'goods-issue', occurredAt: '2026-11-18T10:00:00.000Z', data: { orderId: '80001234', shipment: 'SH00000001', carrierCode: 'SP-3000', lines: [{ sku: '100', quantity: { amount: '24', unit: 'PCS' }, lot: 'CH-7', bestBefore: null, barcode: 'V-1' }] } };
const change = { messageId: '2f8e7a6b-1111-4222-8333-944455556666', type: 'stock-change', occurredAt: '2026-11-18T11:00:00.000Z', data: { sku: '100', barcode: 'TU1', delta: { amount: '-2.5', unit: 'KG' }, reason: 'Bruch', reference: null } };
const snapshot = { messageId: '3f8e7a6b-1111-4222-8333-944455556666', type: 'stock-snapshot', occurredAt: '2026-11-18T23:00:00.000Z', data: { takenAt: '2026-11-18T23:00:00.000Z', items: [{ sku: '100', lot: null, quantity: { amount: '1176', unit: 'PCS' } }] } };

describe('CSV', () => {
  it('liest Anführungszeichen, Trennzeichen im Feld, BOM und erkennt das Trennzeichen', () => {
    expect(parseCsv('﻿a;b\r\n"x;y";"sagt ""hallo"""\r\n\r\n')).toEqual([{ _line: 2, a: 'x;y', b: 'sagt "hallo"' }]);
    expect(parseCsv('a,b\n1,2')).toEqual([{ _line: 2, a: '1', b: '2' }]);
    expect(() => parseCsv('a\n"offen')).toThrow(/nicht geschlossen/);
    expect(stringifyCsv([{ a: 'x;y', b: null }], ['a', 'b'])).toBe('a;b\r\n"x;y";\r\n');
  });

  it('macht aus Artikel-, Avis- und Auftragsdateien kanonische Nachrichten', () => {
    const products = valid(toCanonical('csv', example('artikel.csv'), { kind: 'product', messageIdPrefix: 'artikel.csv' }));
    expect(products[0]).toMatchObject({ messageId: 'artikel.csv:MUSTER-100', type: 'product', data: { sku: 'MUSTER-100', baseUnit: 'PCS', units: [{ unit: 'PAK', factor: '100' }, { unit: 'KAR', factor: '1200' }], overdeliveryAllowed: false } });
    expect(products[1].data.overdeliveryAllowed).toBe(true);

    const [avis] = valid(toCanonical('csv', example('avise.csv'), { kind: 'receiving-order', messageIdPrefix: 'avise.csv' }));
    expect(avis.data).toMatchObject({ orderId: 'BEST-4711', supplierCode: 'L-2000', priority: 'HIGH', expectedAt: '2026-12-01T00:00:00.000Z', positions: [{ posNo: 10, sku: 'MUSTER-100', quantity: { amount: '1200', unit: 'PCS' } }, { posNo: 20, quantity: { amount: '250.5', unit: 'KG' } }] });

    const [order] = valid(toCanonical('csv', example('auslagerauftraege.csv'), { kind: 'outbound-order' }));
    expect(order.data).toMatchObject({ orderId: 'LS-1001', customerCode: 'K-1000', target: 'VS-01', shipTo: { name: 'Musterkunde GmbH', street: 'Musterstraße 1; Hof 2', country: 'DE' }, lines: [{ sku: 'MUSTER-100' }, { sku: 'MUSTER-200', lot: 'CH-7' }] });
  });

  it('meldet fehlerhafte Zeilen mit Zeilennummer und erkennt Stornos', () => {
    expect(() => toCanonical('csv', 'orderId;sku;amount;unit\nA-1;X;zwölf;PCS', { kind: 'receiving-order' })).toThrow(/Zeile 2: Menge „zwölf“/);
    expect(() => toCanonical('csv', 'sku;description\nX;ohne Einheit', { kind: 'product' })).toThrow(/Zeile 2: sku und baseUnit/);
    expect(valid(toCanonical('csv', 'orderId;action\nLS-1;cancel', { kind: 'outbound-order', messageIdPrefix: 'f' }))).toEqual([{ messageId: 'f:LS-1:cancel', type: 'outbound-order', action: 'cancel', data: { orderId: 'LS-1' } }]);
  });

  it('schreibt Rückmeldungen als CSV, auf Wunsch mit Dezimalkomma', () => {
    const csv = fromCanonical('csv', change, { decimalComma: true });
    expect(csv.fileName).toBe('stock-change_20261118T110000_2f8e7a6b.csv');
    expect(parseCsv(csv.body)).toEqual([{ _line: 2, messageid: change.messageId, occurredat: change.occurredAt, sku: '100', barcode: 'TU1', delta: '-2,5', unit: 'KG', reason: 'Bruch', reference: '' }]);
    expect(parseCsv(fromCanonical('csv', issue).body)[0]).toMatchObject({ orderid: '80001234', shipment: 'SH00000001', lot: 'CH-7', amount: '24' });
    expect(parseCsv(fromCanonical('csv', snapshot).body)).toHaveLength(1);
  });
});

describe('SAP IDoc', () => {
  it('liest XML mit Entitäten, CDATA und Kommentaren und lehnt kaputtes XML ab', () => {
    const tree = parseXml('<?xml version="1.0"?><!-- k --><A x="1&amp;2"><B><![CDATA[<roh>]]></B><C/></A>');
    expect(tree).toMatchObject({ name: 'A', attrs: { x: '1&2' }, children: [{ name: 'B', text: '<roh>' }, { name: 'C' }] });
    expect(() => parseXml('<A><B></A>')).toThrow(/passt nicht/);
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><A>&e;</A>')).not.toThrow();
    expect(parseXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><A>&e;</A>').text).toBe('&e;');
  });

  it('übernimmt Materialstamm (MATMAS) mit deutschem Text und Einheiten', () => {
    const [m] = valid(toCanonical('idoc', example('matmas.xml')));
    expect(m).toEqual({ messageId: 'IDOC-100001', type: 'product', action: 'upsert', data: { sku: '100', baseUnit: 'PCS', description: 'Musterschraube & Mutter', units: [{ unit: 'KAR', factor: '1200' }] } });
  });

  it('macht aus einer Bestellung (ORDERS) ein Avis und aus einer Auslieferung (DELVRY) einen Auslagerauftrag', () => {
    const [avis] = valid(toCanonical('idoc', example('orders.xml')));
    expect(avis).toMatchObject({ messageId: 'IDOC-200001', type: 'receiving-order', data: { orderId: '4500004711', supplierCode: '2000', expectedAt: '2026-12-01T00:00:00Z', positions: [{ posNo: 10, sku: '100', quantity: { amount: '1200', unit: 'PCS' } }] } });
    const [order] = valid(toCanonical('idoc', example('delvry.xml'), { target: 'VS-01' }));
    expect(order.data).toEqual({ orderId: '80001234', customerCode: '1000', target: 'VS-01', shipTo: { name: 'Musterkunde GmbH', street: 'Musterstraße 1', postalCode: '12345', city: 'Musterstadt', country: 'DE' }, lines: [{ sku: '100', quantity: { amount: '24', unit: 'PCS' } }] });
    expect(() => toCanonical('idoc', '<INVOIC02><IDOC BEGIN="1"><EDI_DC40><IDOCTYP>INVOIC02</IDOCTYP></EDI_DC40></IDOC></INVOIC02>')).toThrow(/INVOIC02.*nicht unterstützt/);
  });

  it('schreibt Wareneingang, Warenausgang und Bestandsänderung als WMMBXY mit passender Bewegungsart', () => {
    const gr = parseXml(fromCanonical('idoc', receipt, { plant: '1100' }).body);
    const item = (tree) => tree.children[0].children[1].children.filter((c) => c.name === 'E1MBXYI');
    const fields = (node) => Object.fromEntries(node.children.map((c) => [c.name, c.text]));
    expect(gr.name).toBe('WMMBID02');
    expect(fields(item(gr)[0])).toMatchObject({ MATNR: '100', WERKS: '1100', BWART: '101', ERFMG: '1200', ERFME: 'ST', EBELN: '4500004711', EBELP: '00010' });
    expect(fields(item(parseXml(fromCanonical('idoc', issue).body))[0])).toMatchObject({ BWART: '601', CHARG: 'CH-7', ERFMG: '24' });
    expect(fields(item(parseXml(fromCanonical('idoc', change, { movementTypes: { loss: '551' } }).body))[0])).toMatchObject({ BWART: '551', ERFMG: '2.5', ERFME: 'KG' });
    expect(fields(item(parseXml(fromCanonical('idoc', { ...receipt, data: { ...receipt.data, orderId: null, blind: true } }).body))[0])).toMatchObject({ BWART: '501' });
    expect(() => fromCanonical('idoc', snapshot)).toThrow(/CSV oder JSON/);
  });
});

describe('JSON', () => {
  it('nimmt einzelne Nachrichten, Listen und { messages } an und gibt Rückmeldungen unverändert weiter', () => {
    const one = { messageId: 'J-1', type: 'product', data: { sku: 'A', baseUnit: 'PCS' } };
    expect(valid(toCanonical('json', one))).toHaveLength(1);
    expect(toCanonical('json', JSON.stringify({ messages: [one, one] }))).toHaveLength(2);
    expect(() => toCanonical('json', { messageId: 'J-2', type: 'invoice', data: {} })).toThrow(/type „invoice“ unbekannt/);
    const out = fromCanonical('json', receipt);
    expect(ErpOutboundMessageSchema.parse(JSON.parse(out.body))).toEqual(receipt);
  });

  it('kennt nur die drei Formate', () => {
    expect(() => toCanonical('edifact', '')).toThrow(/json, csv, idoc/);
  });
});
