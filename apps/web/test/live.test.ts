import { describe, expect, it } from 'vitest';
import { summarize } from '../src/components/LiveFeed';
import { affectedQueries } from '../src/live/events';

describe('Live-Ereignisse', () => {
  it('ordnet Ereignistypen den Ansichten zu, die neu laden müssen', () => {
    expect(affectedQueries('stock.issued')).toEqual(['stock', 'overview']);
    expect(affectedQueries('outbound-pick.confirmed')).toEqual(['outbound', 'picks', 'stock']);
    expect(affectedQueries('transport-unit.moved')).toContain('units');
    expect(affectedQueries('unbekannt.typ')).toEqual([]);
  });

  it('fasst Ereignisse lesbar zusammen', () => {
    expect(summarize('stock.issued', { quantity: { amount: '12', unit: 'PCS' }, sku: 'MILCH', barcode: 'P1' })).toBe('Abgang 12 PCS MILCH von P1');
    expect(summarize('outbound-order.state-changed', { orderId: 'A-1', before: 'ALLOCATED', state: 'IN_PICKING' })).toBe('A-1: ALLOCATED → IN_PICKING');
    expect(summarize('flow.command', { barcode: 'T1', to: { plcCode: 'CV02', locationId: 'X' } })).toBe('T1 → CV02');
    expect(summarize('movement.created', { number: 'MV00000001' })).toBe('MV00000001');
    expect(summarize('transport-unit.error-reported', { barcode: 'P1', code: 'KONTUR', message: 'Überstand' })).toBe('P1: KONTUR – Überstand');
    expect(summarize('location.plc-state-changed', { plcCode: 'CV02', plcState: 7, text: 'Antrieb' })).toBe('CV02: Störung 7 – Antrieb');
    expect(summarize('location.plc-state-changed', { plcCode: 'CV02', plcState: 0, text: null })).toBe('CV02: in Ordnung');
  });
});
