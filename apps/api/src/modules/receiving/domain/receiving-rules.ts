import type { Quantity } from '@wms/shared';
import { RuleViolationError } from '../../../common/domain-error.js';

export const POSITION_STATES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'SHORT', 'CANCELLED'] as const;
export type PositionState = (typeof POSITION_STATES)[number];

export const ORDER_STATES = ['OPEN', 'IN_PROGRESS', 'COMPLETED', 'PARTIALLY_COMPLETED', 'CANCELLED'] as const;
export const ORDER_PRIORITIES = ['HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];
/** 1 = HIGHEST … 5 = LOWEST. */
export const priorityRankOf = (priority: OrderPriority): number => ORDER_PRIORITIES.indexOf(priority) + 1;
export type OrderState = (typeof ORDER_STATES)[number];

/** Positionen, auf die noch erfasst werden kann. */
export const isOpen = (state: PositionState): boolean => state === 'OPEN' || state === 'IN_PROGRESS';

/**
 * Auftragszustand, immer aus den Positionen abgeleitet:
 * - offen, solange nichts erfasst wurde
 * - in Arbeit, sobald erfasst wurde und noch Positionen offen sind
 * - nach Abschluss aller Positionen: storniert (alle storniert),
 *   teilweise erledigt (mindestens eine mit Fehlmenge geschlossen) oder erledigt
 */
export function deriveOrderState(states: readonly PositionState[]): OrderState {
  if (states.some(isOpen)) {
    return states.some((s) => s === 'IN_PROGRESS' || s === 'COMPLETED' || s === 'SHORT') ? 'IN_PROGRESS' : 'OPEN';
  }
  if (states.length === 0 || states.every((s) => s === 'CANCELLED')) {
    return states.length === 0 ? 'OPEN' : 'CANCELLED';
  }
  return states.includes('SHORT') ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
}

/** Zustand einer Mengenposition nach einer Erfassung. */
export const stateAfterReceipt = (expected: Quantity, received: Quantity): PositionState =>
  received.compareTo(expected) >= 0 ? 'COMPLETED' : 'IN_PROGRESS';

export interface QuantityPositionView {
  posNo: number;
  sku: string;
  expected: Quantity;
  received: Quantity;
  state: PositionState;
}

export interface PositionChoice {
  posNo: number;
  /** Erfassung übersteigt die Restmenge der Position. */
  overdelivered: boolean;
}

/**
 * Ordnet eine Mengenerfassung einer Avisposition zu.
 *
 * 1. Erste offene Position desselben Produkts und derselben Einheit, deren
 *    *Restmenge* (avisiert − erfasst) die erfasste Menge aufnimmt.
 * 2. Sonst die erste offene Position des Produkts – nur, wenn das Produkt
 *    Überlieferung erlaubt.
 * Positionen in Nummernfolge.
 */
export function chooseQuantityPosition(
  positions: readonly QuantityPositionView[],
  capture: { sku: string; quantity: Quantity },
  overdeliveryAllowed: boolean,
): PositionChoice {
  const candidates = positions
    .filter((p) => p.sku === capture.sku && isOpen(p.state) && p.expected.unit === capture.quantity.unit)
    .sort((a, b) => a.posNo - b.posNo);
  if (candidates.length === 0) {
    throw new RuleViolationError('NO_OPEN_POSITION', `Keine offene Position für ${capture.sku} in ${capture.quantity.unit}`, {
      sku: capture.sku,
      unit: capture.quantity.unit,
    });
  }
  const fitting = candidates.find((p) => p.expected.subtract(p.received).compareTo(capture.quantity) >= 0);
  if (fitting) {
    return { posNo: fitting.posNo, overdelivered: false };
  }
  if (!overdeliveryAllowed) {
    const remaining = candidates.map((p) => ({ posNo: p.posNo, remaining: p.expected.subtract(p.received).amount }));
    throw new RuleViolationError(
      'OVERDELIVERY_NOT_ALLOWED',
      `Erfasste Menge ${capture.quantity.toString()} übersteigt die offene Restmenge; Überlieferung ist für ${capture.sku} nicht erlaubt`,
      { sku: capture.sku, quantity: capture.quantity.amount, remaining },
    );
  }
  return { posNo: candidates[0]!.posNo, overdelivered: true };
}
