import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Passwort-Hashes mit scrypt (in Node enthalten, keine Abhängigkeit).
 * Format: `scrypt$N$r$p$salt$hash` (Base64url) – Parameter stehen im Hash,
 * damit sie später erhöht werden können.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 10;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number, length: number) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, length, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key))),
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p), expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Vergleich in konstanter Zeit für gleich lange Werte (Token-Hashes). */
export function sameSecret(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
