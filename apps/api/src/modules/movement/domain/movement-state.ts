import { RuleViolationError } from '../../../common/domain-error.js';

/**
 * Zustandsautomat einer Lagerbewegung.
 *
 *   OPEN ──start──▶ IN_PROGRESS ──complete──▶ DONE
 *    │  ◀─release──      │
 *    │                   └──cancel──▶ CANCELLED
 *    ├──complete──▶ DONE        (direkte Quittung, z. B. per Scanner)
 *    └──cancel────▶ CANCELLED
 *
 * Erlaubte Übergänge stehen explizit in der Tabelle – keine Ordinal-Vergleiche
 * und kein direktes Setzen eines Zustands von außen.
 */
export const MOVEMENT_STATES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type MovementState = (typeof MOVEMENT_STATES)[number];

export type MovementAction = 'start' | 'release' | 'complete' | 'cancel';

const TRANSITIONS: Record<MovementAction, { from: readonly MovementState[]; to: MovementState }> = {
  start: { from: ['OPEN'], to: 'IN_PROGRESS' },
  release: { from: ['IN_PROGRESS'], to: 'OPEN' },
  complete: { from: ['OPEN', 'IN_PROGRESS'], to: 'DONE' },
  cancel: { from: ['OPEN', 'IN_PROGRESS'], to: 'CANCELLED' },
};

/** Nicht abgeschlossene Zustände: höchstens eine solche Bewegung je TU. */
export const ACTIVE_STATES: readonly MovementState[] = ['OPEN', 'IN_PROGRESS'];

export const isFinal = (state: MovementState): boolean => state === 'DONE' || state === 'CANCELLED';

/** Zielzustand einer Aktion; wirft, wenn sie im aktuellen Zustand nicht erlaubt ist. */
export function transition(current: MovementState, action: MovementAction, number: string): MovementState {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw new RuleViolationError(
      'INVALID_STATE_TRANSITION',
      `Bewegung ${number} ist ${current}; „${action}“ ist nur aus ${rule.from.join(' oder ')} möglich`,
      { number, state: current, action, allowedFrom: rule.from },
    );
  }
  return rule.to;
}

/** Aktionen, die im Zustand erlaubt sind (für Antworten und Oberflächen). */
export function allowedActions(state: MovementState): MovementAction[] {
  return (Object.keys(TRANSITIONS) as MovementAction[]).filter((action) => TRANSITIONS[action].from.includes(state));
}
