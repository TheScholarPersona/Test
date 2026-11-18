import { describe, expect, it } from 'vitest';
import { erpMessagesFor, erpRetryDelayMs, referenceOf } from '../../../src/modules/erp/domain/erp-mapping.js';

const envelope = (type: string, payload: Record<string, unknown>) => ({ id: 'e', type, version: 1, occurredAt: '2026-11-18T08:00:00.000Z', source: 'wms-api', payload });
const q = (amount: string) => ({ amount, unit: 'PCS' });

describe('ERP-Zuordnung der Events', () => {
  it('macht aus einer Erfassung mit Produkt einen Wareneingang, ohne Produkt nichts', () => {
    const [m] = erpMessagesFor(envelope('receiving.captured', { captureId: 'c1', orderId: 'WE-1', posNo: 2, kind: 'quantity', sku: 'A', quantity: q('5'), barcode: 'T1' }));
    expect(m).toEqual({ type: 'goods-receipt', data: { orderId: 'WE-1', posNo: 2, sku: 'A', quantity: q('5'), barcode: 'T1', blind: false, captureId: 'c1' } });
    expect(referenceOf(m!)).toBe('WE-1');
    expect(erpMessagesFor(envelope('receiving.captured', { kind: 'unit', sku: null, quantity: null, barcode: 'T2' }))).toEqual([]);
  });

  it('fasst eine Sendung zu einem Warenausgang mit allen Inhalten zusammen', () => {
    const [m] = erpMessagesFor(
      envelope('shipment.shipped', { number: 'SH1', orderId: 'A-1', carrierCode: 'SP', units: [{ barcode: 'V1', contents: [{ sku: 'A', quantity: q('4'), lot: 'L1', bestBefore: null }] }, { barcode: 'V2', contents: [] }] }),
    );
    expect(m).toEqual({ type: 'goods-issue', data: { orderId: 'A-1', shipment: 'SH1', carrierCode: 'SP', lines: [{ sku: 'A', quantity: q('4'), lot: 'L1', bestBefore: null, barcode: 'V1' }] } });
    expect(referenceOf(m!)).toBe('SH1');
  });

  it('unterscheidet Abgänge nach Bezug: Pick, Versand oder sonstiger Abgang', () => {
    const issued = (reference: string) => erpMessagesFor(envelope('stock.issued', { sku: 'A', barcode: 'T1', quantity: q('3'), reference }));
    expect(issued('outbound:A-1/2')[0]).toMatchObject({ type: 'goods-issue', data: { orderId: 'A-1', shipment: null } });
    expect(issued('shipment:SH1')).toEqual([]);
    expect(issued('Muster')[0]).toEqual({ type: 'stock-change', data: { sku: 'A', barcode: 'T1', delta: q('-3'), reason: 'Abgang', reference: 'Muster' } });
  });

  it('meldet Korrekturen als Bestandsänderung und ignoriert andere Events', () => {
    expect(erpMessagesFor(envelope('stock.corrected', { sku: 'A', barcode: 'T1', delta: q('-1'), reason: 'Inventur' }))[0]).toMatchObject({ type: 'stock-change', data: { delta: q('-1'), reason: 'Inventur' } });
    expect(erpMessagesFor(envelope('transport-unit.moved', {}))).toEqual([]);
  });

  it('wartet zwischen Zustellversuchen immer länger, höchstens eine Stunde', () => {
    expect([1, 2, 3].map(erpRetryDelayMs)).toEqual([30_000, 60_000, 120_000]);
    expect(erpRetryDelayMs(30)).toBe(3_600_000);
  });
});
