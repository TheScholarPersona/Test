import { RuleViolationError } from '../../../common/domain-error.js';

/**
 * Zustandsautomat eines Transportauftrags.
 *
 *   INITIALIZED ──start──▶ STARTED ──finish──▶ FINISHED
 *        │                  │  ▲
 *        │          interrupt│  │resume
 *        │                  ▼  │
 *        │               INTERRUPTED
 *        └── cancel ──▶ CANCELED   (aus INITIALIZED, STARTED, INTERRUPTED)
 *        └── fail ────▶ ONFAILURE  (aus INITIALIZED, STARTED, INTERRUPTED)
 *
 * `CREATED` aus OpenWMS entfällt: Ein Auftrag ohne TU und Ziel kann gar nicht
 * angelegt werden (O-01 über das Eingabeschema), er beginnt deshalb INITIALIZED.
 * `INTERRUPTED` ist vollständig definiert (in OpenWMS fehlte die Behandlung).
 * Endzustände sind final, es gibt keine Rückwärtsübergänge außer `resume` (O-03).
 */
export const TRANSPORT_ORDER_STATES = ['INITIALIZED', 'STARTED', 'INTERRUPTED', 'FINISHED', 'CANCELED', 'ONFAILURE'] as const;
export type TransportOrderState = (typeof TRANSPORT_ORDER_STATES)[number];

export type TransportOrderAction = 'start' | 'interrupt' | 'resume' | 'finish' | 'cancel' | 'fail';

const OPEN: readonly TransportOrderState[] = ['INITIALIZED', 'STARTED', 'INTERRUPTED'];

const TRANSITIONS: Record<TransportOrderAction, { from: readonly TransportOrderState[]; to: TransportOrderState }> = {
  start: { from: ['INITIALIZED'], to: 'STARTED' },
  interrupt: { from: ['STARTED'], to: 'INTERRUPTED' },
  resume: { from: ['INTERRUPTED'], to: 'STARTED' },
  finish: { from: ['STARTED'], to: 'FINISHED' },
  cancel: { from: OPEN, to: 'CANCELED' },
  fail: { from: OPEN, to: 'ONFAILURE' },
};

/** Nicht abgeschlossen. */
export const OPEN_STATES = OPEN;
/** Steuert die TU gerade: höchstens ein solcher Auftrag je TU (O-02). */
export const ACTIVE_STATES: readonly TransportOrderState[] = ['STARTED', 'INTERRUPTED'];

export const isFinal = (state: TransportOrderState): boolean => !OPEN.includes(state);

export function transition(current: TransportOrderState, action: TransportOrderAction, number: string): TransportOrderState {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw new RuleViolationError(
      'INVALID_STATE_TRANSITION',
      `Transportauftrag ${number} ist ${current}; „${action}“ ist nur aus ${rule.from.join(' oder ')} möglich`,
      { number, state: current, action, allowedFrom: rule.from },
    );
  }
  return rule.to;
}

export function allowedActions(state: TransportOrderState): TransportOrderAction[] {
  return (Object.keys(TRANSITIONS) as TransportOrderAction[]).filter((action) => TRANSITIONS[action].from.includes(state));
}

export const TRANSPORT_ORDER_PRIORITIES = ['HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST'] as const;
export type TransportOrderPriority = (typeof TRANSPORT_ORDER_PRIORITIES)[number];
/** Sortierrang (1 = dringend) als Spalte, damit die Datenbank nach Priorität sortiert (O-05). */
export const priorityRank = (priority: TransportOrderPriority): number => TRANSPORT_ORDER_PRIORITIES.indexOf(priority) + 1;
