import { describe, expect, it } from 'vitest';
import { RuleViolationError } from '../../../src/common/domain-error.js';
import { applyLockChanges } from '../../../src/modules/layout/domain/lock-changes.js';
import { effectiveLock, inheritedLockHolder, type LockChainEntry } from '../../../src/modules/layout/domain/lock-state.js';

const group = (name: string, inboundBlocked = false, outboundBlocked = false): LockChainEntry => ({
  kind: 'location-group',
  name,
  inboundBlocked,
  outboundBlocked,
});
const location = (inboundBlocked = false, outboundBlocked = false): LockChainEntry => ({
  kind: 'location',
  name: 'HL01/0001/0001/0001/0000',
  inboundBlocked,
  outboundBlocked,
});

describe('effectiveLock', () => {
  it('ist frei, wenn niemand in der Kette sperrt', () => {
    expect(effectiveLock([location(), group('GASSE-1'), group('HOCHREGAL')], 'inbound')).toEqual({
      own: false,
      blocked: false,
      blockedBy: null,
    });
  });

  it('erbt die Sperre einer übergeordneten Gruppe', () => {
    const chain = [location(), group('GASSE-1'), group('HOCHREGAL', true)];
    expect(effectiveLock(chain, 'inbound')).toEqual({
      own: false,
      blocked: true,
      blockedBy: { kind: 'location-group', name: 'HOCHREGAL' },
    });
    expect(effectiveLock(chain, 'outbound').blocked).toBe(false);
  });

  it('nennt das nächstgelegene sperrende Objekt', () => {
    const chain = [location(false, true), group('GASSE-1', false, true), group('HOCHREGAL', false, true)];
    expect(effectiveLock(chain, 'outbound')).toEqual({
      own: true,
      blocked: true,
      blockedBy: { kind: 'location', name: 'HL01/0001/0001/0001/0000' },
    });
  });

  it('verlangt eine nicht leere Kette', () => {
    expect(() => effectiveLock([], 'inbound')).toThrow();
  });
});

describe('inheritedLockHolder', () => {
  it('berücksichtigt nur übergeordnete Gruppen, nicht das Objekt selbst', () => {
    expect(inheritedLockHolder([group('GASSE-1', true), group('HOCHREGAL')], 'inbound')).toBeNull();
    expect(inheritedLockHolder([group('GASSE-1', true), group('HOCHREGAL', true)], 'inbound')).toEqual({
      kind: 'location-group',
      name: 'HOCHREGAL',
    });
  });
});

describe('applyLockChanges', () => {
  it('setzt Sperren und meldet die Änderung', () => {
    const target = { inboundBlocked: false, outboundBlocked: false };
    const change = applyLockChanges(target, [group('GASSE-1')], { inbound: true });
    expect(change).toEqual({ inbound: { before: false, after: true } });
    expect(target).toEqual({ inboundBlocked: true, outboundBlocked: false });
  });

  it('meldet null, wenn sich nichts ändert', () => {
    const target = { inboundBlocked: true, outboundBlocked: false };
    expect(applyLockChanges(target, [group('GASSE-1', true)], { inbound: true, outbound: false })).toBeNull();
  });

  it('erlaubt zusätzliches Sperren unter einer gesperrten Gruppe', () => {
    const target = { inboundBlocked: false, outboundBlocked: false };
    expect(applyLockChanges(target, [group('GASSE-1'), group('HOCHREGAL', true)], { inbound: true })).toEqual({
      inbound: { before: false, after: true },
    });
  });

  it('verbietet das Entsperren, solange eine übergeordnete Gruppe sperrt', () => {
    const target = { inboundBlocked: true, outboundBlocked: false };
    const chain = [group('GASSE-1', true), group('HOCHREGAL', true)];
    try {
      applyLockChanges(target, chain, { inbound: false });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RuleViolationError);
      expect((error as RuleViolationError).code).toBe('LOCK_INHERITED');
      expect((error as RuleViolationError).details).toEqual({
        direction: 'inbound',
        blockedBy: { kind: 'location-group', name: 'HOCHREGAL' },
      });
    }
    expect(target.inboundBlocked).toBe(true);
  });

  it('ändert nichts, wenn eine von mehreren Änderungen unzulässig ist (alles oder nichts)', () => {
    const target = { inboundBlocked: false, outboundBlocked: true };
    const chain = [group('GASSE-1', false, true), group('HOCHREGAL', false, true)];
    expect(() => applyLockChanges(target, chain, { inbound: true, outbound: false })).toThrow(RuleViolationError);
    expect(target).toEqual({ inboundBlocked: false, outboundBlocked: true });
  });
});
