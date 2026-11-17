import { describe, expect, it } from 'vitest';
import { RuleViolationError } from '../../../src/common/domain-error.js';
import {
  allowedActions,
  isFinal,
  MOVEMENT_STATES,
  type MovementAction,
  type MovementState,
  transition,
} from '../../../src/modules/movement/domain/movement-state.js';

const ALLOWED: [MovementState, MovementAction, MovementState][] = [
  ['OPEN', 'start', 'IN_PROGRESS'],
  ['IN_PROGRESS', 'release', 'OPEN'],
  ['OPEN', 'complete', 'DONE'],
  ['IN_PROGRESS', 'complete', 'DONE'],
  ['OPEN', 'cancel', 'CANCELLED'],
  ['IN_PROGRESS', 'cancel', 'CANCELLED'],
];

describe('Zustandsautomat Lagerbewegung', () => {
  it.each(ALLOWED)('%s --%s--> %s', (from, action, to) => {
    expect(transition(from, action, 'MV1')).toBe(to);
  });

  // Alle übrigen Kombinationen müssen abgelehnt werden.
  const actions: MovementAction[] = ['start', 'release', 'complete', 'cancel'];
  const forbidden = MOVEMENT_STATES.flatMap((state) => actions.map((action) => [state, action] as const)).filter(
    ([state, action]) => !ALLOWED.some(([from, a]) => from === state && a === action),
  );

  it.each(forbidden)('lehnt %s --%s--> ab', (state, action) => {
    try {
      transition(state, action, 'MV1');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RuleViolationError);
      expect((error as RuleViolationError).code).toBe('INVALID_STATE_TRANSITION');
      expect((error as RuleViolationError).details).toMatchObject({ state, action });
    }
  });

  it('kennt Endzustände und erlaubte Aktionen', () => {
    expect(isFinal('DONE')).toBe(true);
    expect(isFinal('CANCELLED')).toBe(true);
    expect(isFinal('OPEN')).toBe(false);
    expect(allowedActions('OPEN')).toEqual(['start', 'complete', 'cancel']);
    expect(allowedActions('IN_PROGRESS')).toEqual(['release', 'complete', 'cancel']);
    expect(allowedActions('DONE')).toEqual([]);
  });
});
