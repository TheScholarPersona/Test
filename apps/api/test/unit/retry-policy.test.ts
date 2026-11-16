import { describe, expect, it } from 'vitest';
import { retryDelayMs, withTimeout } from '../../src/infrastructure/outbox/retry-policy.js';

describe('retryDelayMs', () => {
  it.each([
    [0, 1000],
    [1, 1000],
    [2, 2000],
    [3, 4000],
    [6, 32_000],
    [7, 60_000],
    [100, 60_000],
  ])('nach %i Fehlversuchen %i ms', (attempts, expected) => {
    expect(retryDelayMs(attempts)).toBe(expected);
  });
});

describe('withTimeout', () => {
  it('liefert das Ergebnis, wenn rechtzeitig', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100, 'zu spät')).resolves.toBe('ok');
  });

  it('bricht nach Ablauf mit der Meldung ab', async () => {
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, 20, 'zu spät')).rejects.toThrow('zu spät');
  });
});
