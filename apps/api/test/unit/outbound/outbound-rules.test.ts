import { Quantity } from '@wms/shared';
import { describe, expect, it } from 'vitest';
import { deriveLineState, deriveOrderState, type LineAmounts, type LineState, openDemand } from '../../../src/modules/outbound/domain/outbound-rules.js';

const line = (quantity: string, allocated: string, picked: string, state: LineState = 'OPEN'): LineAmounts => ({
  state,
  quantity: Quantity.of(quantity, 'PCS'),
  allocated: Quantity.of(allocated, 'PCS'),
  picked: Quantity.of(picked, 'PCS'),
});
const derived = (q: string, a: string, p: string, s: LineState = 'OPEN') => {
  const l = line(q, a, p, s);
  return { ...l, state: deriveLineState(l) };
};

describe('Position', () => {
  it.each([
    ['10', '0', '0', 'OPEN'],
    ['10', '4', '0', 'PARTIALLY_ALLOCATED'],
    ['10', '10', '0', 'ALLOCATED'],
    ['10', '10', '6', 'ALLOCATED'],
    ['10', '10', '10', 'PICKED'],
  ] as const)('Bedarf %s, zugeteilt %s, entnommen %s → %s', (q, a, p, state) => {
    expect(deriveLineState(line(q, a, p))).toBe(state);
  });

  it('lässt geschlossene Positionen geschlossen und hat dann keinen Bedarf mehr', () => {
    expect(deriveLineState(line('10', '0', '3', 'SHORT'))).toBe('SHORT');
    expect(openDemand(line('10', '3', '3', 'SHORT')).amount).toBe('0');
    expect(openDemand(line('10', '4', '0')).amount).toBe('6');
  });
});

describe('Auftrag', () => {
  it.each([
    [[derived('10', '0', '0')], 'CREATED'],
    [[derived('10', '5', '0'), derived('5', '0', '0')], 'PARTIALLY_ALLOCATED'],
    [[derived('10', '10', '0'), derived('5', '5', '0')], 'ALLOCATED'],
    [[derived('10', '10', '2'), derived('5', '5', '0')], 'IN_PICKING'],
    [[derived('10', '10', '10'), derived('5', '0', '2', 'SHORT')], 'COMPLETED'],
    [[derived('10', '10', '10'), derived('5', '0', '0', 'CANCELLED')], 'COMPLETED'],
    [[derived('10', '10', '0'), derived('5', '0', '0', 'CANCELLED')], 'ALLOCATED'],
  ] as const)('%# → %s', (lines, state) => {
    expect(deriveOrderState('CREATED', [...lines])).toBe(state);
  });

  it('Storno und Abschluss sind endgültig', () => {
    expect(deriveOrderState('CANCELLED', [derived('1', '1', '1')])).toBe('CANCELLED');
    expect(deriveOrderState('COMPLETED', [derived('1', '0', '0')])).toBe('COMPLETED');
  });
});
