import { RuleViolationError } from '../../../common/domain-error.js';
import { inheritedLockHolder, LOCK_DIRECTIONS, type LockChainEntry, type LockDirection } from './lock-state.js';

export interface Lockable {
  inboundBlocked: boolean;
  outboundBlocked: boolean;
}

export interface LockChangeRequest {
  inbound?: boolean | undefined;
  outbound?: boolean | undefined;
}

export type LockChange = Partial<Record<LockDirection, { before: boolean; after: boolean }>>;

const FIELD: Record<LockDirection, 'inboundBlocked' | 'outboundBlocked'> = {
  inbound: 'inboundBlocked',
  outbound: 'outboundBlocked',
};

const LABEL: Record<LockDirection, string> = {
  inbound: 'Einlagersperre',
  outbound: 'Auslagersperre',
};

/**
 * Wendet gewünschte Sperränderungen an und gibt die tatsächlichen Änderungen
 * zurück (`null`, wenn sich nichts geändert hat).
 *
 * Regel: Eine Richtung kann nicht entsperrt werden, solange eine
 * übergeordnete Gruppe sie sperrt – sonst sähe der Aufrufer „entsperrt“,
 * obwohl die Sperre weiter wirkt. Sperren ist immer erlaubt.
 * Alle Prüfungen laufen vor der ersten Änderung (alles oder nichts).
 */
export function applyLockChanges(target: Lockable, chain: readonly LockChainEntry[], request: LockChangeRequest): LockChange | null {
  for (const direction of LOCK_DIRECTIONS) {
    if (request[direction] === false) {
      const holder = inheritedLockHolder(chain, direction);
      if (holder) {
        throw new RuleViolationError(
          'LOCK_INHERITED',
          `${LABEL[direction]} kann nicht aufgehoben werden, solange die übergeordnete Gruppe [${holder.name}] sperrt`,
          { direction, blockedBy: holder },
        );
      }
    }
  }
  const change: LockChange = {};
  for (const direction of LOCK_DIRECTIONS) {
    const wanted = request[direction];
    const field = FIELD[direction];
    if (wanted !== undefined && target[field] !== wanted) {
      change[direction] = { before: target[field], after: wanted };
      target[field] = wanted;
    }
  }
  return Object.keys(change).length > 0 ? change : null;
}
