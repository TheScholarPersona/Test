import { describe, expect, it } from 'vitest';
import { LoginThrottle } from '../../../src/modules/auth/application/login-throttle.js';
import { hashPassword, verifyPassword } from '../../../src/modules/auth/domain/password.js';
import { parseServiceTokens } from '../../../src/config.js';

describe('Passwörter', () => {
  it('hasht mit Salz und prüft', async () => {
    const a = await hashPassword('geheim-1234');
    const b = await hashPassword('geheim-1234');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('geheim-1234', a)).toBe(true);
    expect(await verifyPassword('geheim-1235', a)).toBe(false);
    expect(await verifyPassword('geheim-1234', 'kaputt')).toBe(false);
  });
});

describe('Login-Bremse', () => {
  it('sperrt nach fünf Fehlversuchen für fünf Minuten', () => {
    let now = 0;
    const throttle = new LoginThrottle(5, 15 * 60_000, 5 * 60_000, () => now);
    for (let i = 0; i < 4; i++) throttle.failure('ip|anna');
    expect(throttle.lockedFor('ip|anna')).toBe(0);
    throttle.failure('ip|anna');
    expect(throttle.lockedFor('ip|anna')).toBe(5 * 60_000);
    expect(throttle.lockedFor('ip|bert')).toBe(0);
    now += 5 * 60_000;
    expect(throttle.lockedFor('ip|anna')).toBe(0);
  });

  it('vergisst alte Fehlversuche und setzt nach Erfolg zurück', () => {
    let now = 0;
    const throttle = new LoginThrottle(3, 1000, 1000, () => now);
    throttle.failure('k');
    throttle.failure('k');
    now = 2000;
    throttle.failure('k');
    expect(throttle.lockedFor('k')).toBe(0);
    throttle.success('k');
    throttle.failure('k');
    throttle.failure('k');
    expect(throttle.lockedFor('k')).toBe(0);
  });
});

describe('Service-Tokens aus der Konfiguration', () => {
  const secret = 'x'.repeat(32);
  it('liest Name, Rollen und Geheimnis (nur als Hash)', () => {
    const [t] = parseServiceTokens(`node-red:admin+anlage:${secret}`);
    expect(t).toMatchObject({ name: 'node-red', roles: ['admin', 'anlage'] });
    expect(t!.hash).toHaveLength(32);
    expect(JSON.stringify(t)).not.toContain(secret);
  });
  it.each([
    [`node-red:chef:${secret}`, 'Rollen ungültig'],
    ['node-red:admin:kurz', 'mindestens 32'],
    [`Node Red:admin:${secret}`, 'Name'],
  ])('lehnt %s ab', (value, message) => {
    expect(() => parseServiceTokens(value)).toThrow(message);
  });
});
