import { Quantity } from '@wms/shared';
import { describe, expect, it } from 'vitest';
import { RuleViolationError } from '../../../src/common/domain-error.js';
import {
  chooseQuantityPosition,
  deriveOrderState,
  type PositionState,
  type QuantityPositionView,
  stateAfterReceipt,
} from '../../../src/modules/receiving/domain/receiving-rules.js';

const q = (amount: string, unit = 'PCS') => Quantity.of(amount, unit);
const pos = (posNo: number, sku: string, expected: string, received = '0', state: PositionState = 'OPEN', unit = 'PCS'): QuantityPositionView => ({
  posNo,
  sku,
  expected: q(expected, unit),
  received: q(received, unit),
  state,
});

describe('Auftragszustand', () => {
  it.each([
    [[], 'OPEN'],
    [['OPEN', 'OPEN'], 'OPEN'],
    [['OPEN', 'CANCELLED'], 'OPEN'],
    [['OPEN', 'IN_PROGRESS'], 'IN_PROGRESS'],
    [['OPEN', 'COMPLETED'], 'IN_PROGRESS'],
    [['COMPLETED', 'COMPLETED'], 'COMPLETED'],
    [['COMPLETED', 'CANCELLED'], 'COMPLETED'],
    [['COMPLETED', 'SHORT'], 'PARTIALLY_COMPLETED'],
    [['SHORT', 'CANCELLED'], 'PARTIALLY_COMPLETED'],
    [['CANCELLED', 'CANCELLED'], 'CANCELLED'],
  ] as [PositionState[], string][])('%j → %s', (states, expected) => {
    expect(deriveOrderState(states)).toBe(expected);
  });

  it('setzt Positionen erst bei voller Menge auf erledigt', () => {
    expect(stateAfterReceipt(q('10'), q('9.999'))).toBe('IN_PROGRESS');
    expect(stateAfterReceipt(q('10'), q('10'))).toBe('COMPLETED');
    expect(stateAfterReceipt(q('10'), q('12'))).toBe('COMPLETED');
  });
});

describe('Zuordnung einer Mengenerfassung', () => {
  const positions = [pos(1, 'A', '10', '8', 'IN_PROGRESS'), pos(2, 'A', '10'), pos(3, 'B', '5')];

  it('nimmt die erste Position, deren Restmenge reicht', () => {
    expect(chooseQuantityPosition(positions, { sku: 'A', quantity: q('2') }, false)).toEqual({ posNo: 1, overdelivered: false });
    // Restmenge von Position 1 ist nur 2 – 3 Stück passen erst auf Position 2.
    expect(chooseQuantityPosition(positions, { sku: 'A', quantity: q('3') }, false)).toEqual({ posNo: 2, overdelivered: false });
  });

  it('bucht Überlieferung nur, wenn das Produkt sie erlaubt', () => {
    expect(chooseQuantityPosition(positions, { sku: 'A', quantity: q('11') }, true)).toEqual({ posNo: 1, overdelivered: true });
    try {
      chooseQuantityPosition(positions, { sku: 'A', quantity: q('11') }, false);
      expect.unreachable();
    } catch (error) {
      expect((error as RuleViolationError).code).toBe('OVERDELIVERY_NOT_ALLOWED');
      expect((error as RuleViolationError).details).toMatchObject({ remaining: [{ posNo: 1, remaining: '2' }, { posNo: 2, remaining: '10' }] });
    }
  });

  it('ignoriert erledigte, stornierte und andere Einheiten', () => {
    const closed = [pos(1, 'A', '10', '10', 'COMPLETED'), pos(2, 'A', '10', '0', 'CANCELLED'), pos(3, 'A', '10', '0', 'OPEN', 'KG')];
    expect(() => chooseQuantityPosition(closed, { sku: 'A', quantity: q('1') }, true)).toThrow(RuleViolationError);
    expect(chooseQuantityPosition(closed, { sku: 'A', quantity: q('1', 'KG') }, false)).toEqual({ posNo: 3, overdelivered: false });
  });

  it('meldet fehlende Positionen für das Produkt', () => {
    expect(() => chooseQuantityPosition(positions, { sku: 'C', quantity: q('1') }, true)).toThrow(/Keine offene Position für C/);
  });
});
