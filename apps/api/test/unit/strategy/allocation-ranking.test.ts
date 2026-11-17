import { Quantity } from '@wms/shared';
import { describe, expect, it } from 'vitest';
import { type AllocationCandidate, rankAllocation, shelfLifeViolation } from '../../../src/modules/strategy/allocation/allocation-ranking.js';

const c = (barcode: string, available: string, receivedAt: string, bestBefore: string | null = null, violations: AllocationCandidate['violations'] = []): AllocationCandidate => ({
  id: `id-${barcode}`,
  barcode,
  locationId: `L-${barcode}`,
  available,
  unit: 'PCS',
  lot: null,
  bestBefore,
  receivedAt: `2026-11-${receivedAt}T08:00:00.000Z`,
  wholeUnit: true,
  violations,
});
const need = (amount: string) => Quantity.of(amount, 'PCS');
const plan = (candidates: AllocationCandidate[], strategy: Parameters<typeof rankAllocation>[1], amount: string) =>
  rankAllocation(candidates, strategy, need(amount)).plan.map((p) => `${p.barcode}:${p.quantity}`);

//          Zugang  MHD          Menge
const A = c('A', '10', '01', '2027-06-01');
const B = c('B', '30', '02', '2027-01-01');
const C = c('C', '5', '03', null);
const D = c('D', '20', '04', '2027-03-01');
const stock = [D, C, B, A];

describe('Auslagerstrategien', () => {
  it('FIFO: ältester Zugang zuerst', () => {
    expect(plan(stock, 'fifo', '35')).toEqual(['A:10', 'B:25']);
  });

  it('FEFO: frühestes MHD zuerst, ohne MHD zuletzt', () => {
    expect(plan(stock, 'fefo', '55')).toEqual(['B:30', 'D:20', 'A:5']);
    expect(plan(stock, 'fefo', '70').at(-1)).toBe('C:5');
  });

  it('LIFO: jüngster Zugang zuerst', () => {
    expect(plan(stock, 'lifo', '30')).toEqual(['D:20', 'C:5', 'B:5']);
  });

  it('Anbruch zuerst: kleinste Restmengen zuerst', () => {
    expect(plan(stock, 'partial-first', '20')).toEqual(['C:5', 'A:10', 'D:5']);
  });

  it('Ganze TU bevorzugen: möglichst ganze Posten, Rest vom kleinsten deckenden', () => {
    expect(plan(stock, 'full-unit', '35')).toEqual(['B:30', 'C:5']);
    expect(plan(stock, 'full-unit', '20')).toEqual(['D:20']);
    expect(plan(stock, 'full-unit', '12')).toEqual(['A:10', 'C:2']);
  });

  it('meldet Fehlmenge und Begründung, ignoriert ungeeignete Posten', () => {
    const blocked = c('X', '100', '01', null, [{ rule: 'SOURCE_OUTBOUND_BLOCKED', message: 'gesperrt' }]);
    const r = rankAllocation([A, blocked], 'fifo', need('15'));
    expect(r).toMatchObject({ allocated: '10', shortfall: '5', note: expect.stringContaining('fehlen 5') });
    expect(r.candidates.map((x) => [x.label, x.eligible, x.details?.['take'] ?? null])).toEqual([
      ['A @ L-A', true, '10'],
      ['X @ L-X', false, null],
    ]);
    expect(rankAllocation([blocked], 'fifo', need('1'))).toMatchObject({ chosen: null, plan: [], note: 'Kein Bestandsposten erfüllt alle harten Regeln' });
    expect(rankAllocation([], 'fifo', need('1')).note).toBe('Kein Bestand des Produkts gefunden');
  });

  it('rechnet exakt dezimal', () => {
    const r = rankAllocation([c('K', '0.3', '01'), c('L', '0.3', '02')], 'fifo', need('0.45'));
    expect(r.plan.map((p) => p.quantity)).toEqual(['0.3', '0.15']);
    expect(r.shortfall).toBe('0');
  });
});

describe('Mindestrestlaufzeit (heute 2026-11-16, 30 Tage → MHD ab 2026-12-16)', () => {
  it.each([
    ['2026-12-01', 30, 'REMAINING_SHELF_LIFE'],
    ['2026-12-15', 30, 'REMAINING_SHELF_LIFE'],
    ['2026-12-16', 30, null],
    [null, 30, null],
    ['2026-11-01', 0, null],
  ] as const)('MHD %s, %i Tage → %s', (bestBefore, days, rule) => {
    expect(shelfLifeViolation(bestBefore, '2026-11-16', days)?.rule ?? null).toBe(rule);
  });
});
