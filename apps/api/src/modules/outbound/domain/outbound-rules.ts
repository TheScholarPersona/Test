import { Quantity } from '@wms/shared';

/**
 * Zustände eines Auslagerauftrags. Positionen leiten ihren Zustand aus den
 * Mengen ab (Bedarf, zugeteilt, entnommen); der Auftrag aus den Positionen.
 *
 *   Position: OPEN → PARTIALLY_ALLOCATED → ALLOCATED → PICKED
 *             (SHORT: mit Fehlmenge geschlossen, CANCELLED: storniert)
 *   Auftrag:  CREATED → PARTIALLY_ALLOCATED → ALLOCATED → IN_PICKING → COMPLETED
 *             (CANCELLED)
 */
export const LINE_STATES = ['OPEN', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'PICKED', 'SHORT', 'CANCELLED'] as const;
export type LineState = (typeof LINE_STATES)[number];
export const ORDER_STATES = ['CREATED', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'IN_PICKING', 'COMPLETED', 'CANCELLED'] as const;
export type OrderState = (typeof ORDER_STATES)[number];
export const PICK_STATES = ['OPEN', 'PICKED', 'SHORT', 'CANCELLED'] as const;
export type PickState = (typeof PICK_STATES)[number];

export interface LineAmounts {
  state: LineState;
  quantity: Quantity;
  /** Offen zugeteilt (offene Picks) plus entnommen. */
  allocated: Quantity;
  picked: Quantity;
}

export const isClosed = (state: LineState) => state === 'SHORT' || state === 'CANCELLED' || state === 'PICKED';

/** Zustand einer Position aus ihren Mengen; geschlossene Positionen bleiben, wie sie sind. */
export function deriveLineState(line: LineAmounts): LineState {
  if (line.state === 'SHORT' || line.state === 'CANCELLED') return line.state;
  if (line.picked.compareTo(line.quantity) >= 0) return 'PICKED';
  if (line.allocated.compareTo(line.quantity) >= 0) return 'ALLOCATED';
  if (!line.allocated.isZero()) return 'PARTIALLY_ALLOCATED';
  return 'OPEN';
}

/** Noch zuzuteilende Menge einer Position (0 bei geschlossenen Positionen). */
export function openDemand(line: LineAmounts): Quantity {
  if (isClosed(line.state)) return Quantity.zero(line.quantity.unit);
  const rest = line.quantity.subtract(line.allocated);
  return rest.isNegative() ? Quantity.zero(line.quantity.unit) : rest;
}

/** Zustand des Auftrags aus den Positionen; CANCELLED und COMPLETED sind endgültig. */
export function deriveOrderState(current: OrderState, lines: LineAmounts[]): OrderState {
  if (current === 'CANCELLED' || current === 'COMPLETED') return current;
  const states = lines.map((l) => l.state);
  if (states.length > 0 && states.every((s) => s === 'PICKED' || s === 'SHORT' || s === 'CANCELLED') && states.some((s) => s !== 'CANCELLED')) {
    return 'COMPLETED';
  }
  if (lines.some((l) => !l.picked.isZero())) return 'IN_PICKING';
  const active = states.filter((s) => s !== 'CANCELLED');
  if (active.length > 0 && active.every((s) => s === 'ALLOCATED')) return 'ALLOCATED';
  if (active.some((s) => s === 'ALLOCATED' || s === 'PARTIALLY_ALLOCATED')) return 'PARTIALLY_ALLOCATED';
  return 'CREATED';
}

export const OUTBOUND_PRIORITIES = ['HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST'] as const;
