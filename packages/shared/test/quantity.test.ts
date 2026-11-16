import { describe, expect, it } from 'vitest';
import { Quantity, QuantityUnitMismatchError } from '../src/quantity.js';

describe('Quantity', () => {
  it('rechnet exakt dezimal statt mit Gleitkomma', () => {
    const sum = Quantity.of('0.1', 'KG').add(Quantity.of('0.2', 'KG'));
    expect(sum.amount).toBe('0.3');
    expect(sum.equals(Quantity.of('0.3', 'KG'))).toBe(true);
  });

  it('subtrahiert und erkennt negative Mengen', () => {
    const rest = Quantity.of('5', 'PCS').subtract(Quantity.of('7', 'PCS'));
    expect(rest.amount).toBe('-2');
    expect(rest.isNegative()).toBe(true);
    expect(Quantity.zero('PCS').isNegative()).toBe(false);
  });

  it.each([
    ['10', '9.999', 1],
    ['10', '10.000', 0],
    ['3', '12', -1],
  ] as const)('vergleicht %s mit %s → %i', (a, b, expected) => {
    expect(Quantity.of(a, 'PCS').compareTo(Quantity.of(b, 'PCS'))).toBe(expected);
  });

  it('verweigert das Verrechnen unterschiedlicher Einheiten', () => {
    expect(() => Quantity.of('1', 'KG').add(Quantity.of('1', 'PCS'))).toThrow(QuantityUnitMismatchError);
  });

  it.each(['1,5', '1e3', 'abc', '', ' 1'])('lehnt ungültige Menge %j ab', (amount) => {
    expect(() => Quantity.of(amount, 'PCS')).toThrow();
  });

  it('lehnt ungültige Einheiten ab', () => {
    expect(() => Quantity.of('1', 'kg')).toThrow();
  });

  it('serialisiert als Dezimal-String mit Einheit', () => {
    expect(JSON.stringify(Quantity.of('12.50', 'KG'))).toBe('{"amount":"12.5","unit":"KG"}');
    expect(Quantity.fromDto({ amount: '3', unit: Quantity.of('1', 'PCS').unit }).toString()).toBe('3 PCS');
  });
});
