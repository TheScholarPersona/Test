import { describe, expect, it } from 'vitest';
import { RuleViolationError } from '../../../src/common/domain-error.js';
import {
  ACTIVE_STATES,
  allowedActions,
  isFinal,
  priorityRank,
  TRANSPORT_ORDER_STATES,
  type TransportOrderAction,
  type TransportOrderState,
  transition,
} from '../../../src/modules/transport-order/domain/transport-order-state.js';

const ALLOWED: [TransportOrderState, TransportOrderAction, TransportOrderState][] = [
  ['INITIALIZED', 'start', 'STARTED'],
  ['STARTED', 'interrupt', 'INTERRUPTED'],
  ['INTERRUPTED', 'resume', 'STARTED'],
  ['STARTED', 'finish', 'FINISHED'],
  ['INITIALIZED', 'cancel', 'CANCELED'],
  ['STARTED', 'cancel', 'CANCELED'],
  ['INTERRUPTED', 'cancel', 'CANCELED'],
  ['INITIALIZED', 'fail', 'ONFAILURE'],
  ['STARTED', 'fail', 'ONFAILURE'],
  ['INTERRUPTED', 'fail', 'ONFAILURE'],
];
const ACTIONS: TransportOrderAction[] = ['start', 'interrupt', 'resume', 'finish', 'cancel', 'fail'];

describe('Zustandsautomat Transportauftrag', () => {
  it.each(ALLOWED)('%s --%s--> %s', (from, action, to) => {
    expect(transition(from, action, 'TO1')).toBe(to);
  });

  const forbidden = TRANSPORT_ORDER_STATES.flatMap((state) => ACTIONS.map((action) => [state, action] as const)).filter(
    ([state, action]) => !ALLOWED.some(([from, a]) => from === state && a === action),
  );

  it.each(forbidden)('lehnt %s --%s--> ab', (state, action) => {
    try {
      transition(state, action, 'TO1');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RuleViolationError);
      expect((error as RuleViolationError).code).toBe('INVALID_STATE_TRANSITION');
      expect((error as RuleViolationError).details).toMatchObject({ state, action });
    }
  });

  it('Endzustände sind final und erlauben keine Aktion (O-03)', () => {
    for (const state of ['FINISHED', 'CANCELED', 'ONFAILURE'] as const) {
      expect(isFinal(state)).toBe(true);
      expect(allowedActions(state)).toEqual([]);
    }
    for (const state of ['INITIALIZED', 'STARTED', 'INTERRUPTED'] as const) expect(isFinal(state)).toBe(false);
  });

  it('INTERRUPTED ist vollständig behandelt und belegt die TU weiter', () => {
    expect(allowedActions('INTERRUPTED')).toEqual(['resume', 'cancel', 'fail']);
    expect(ACTIVE_STATES).toEqual(['STARTED', 'INTERRUPTED']);
  });

  it('sortiert Prioritäten dringend zuerst (O-05)', () => {
    expect(['LOW', 'HIGHEST', 'NORMAL'].map((p) => priorityRank(p as never))).toEqual([4, 1, 3]);
  });
});
