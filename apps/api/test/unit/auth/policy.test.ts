import { describe, expect, it } from 'vitest';
import { accessFor, allows, type Role, ROLES } from '../../../src/modules/auth/domain/policy.js';

/** Wer darf was – als Tabelle: [Methode, Pfad, Rollen, die dürfen]. `*` = jede angemeldete Rolle, `public` = ohne Anmeldung. */
const MATRIX: [string, string, Role[] | '*' | 'public'][] = [
  ['GET', '/health', 'public'],
  ['PATCH', '/v1/locations/abc/plc-state', ['admin', 'leitstand', 'anlage']],
  ['POST', '/v1/transport-units/P1/errors', ['admin', 'leitstand', 'lager', 'anlage']],
  ['POST', '/v1/transport-units/P1/errors/e1/resolve', ['admin', 'leitstand', 'lager']],
  ['GET', '/v1/transport-unit-errors', '*'],
  ['POST', '/v1/movement-groups', ['admin', 'leitstand']],
  ['PATCH', '/v1/movement-groups/MG1', ['admin', 'leitstand']],
  ['POST', '/v1/movement-groups/MG1/assign', ['admin', 'leitstand']],
  ['POST', '/v1/movement-groups/MG1/start', ['admin', 'leitstand', 'lager']],
  ['POST', '/v1/movement-groups/MG1/release', ['admin', 'leitstand', 'lager']],
  ['GET', '/openapi.json', 'public'],
  ['POST', '/v1/auth/login', 'public'],
  ['POST', '/v1/auth/logout', '*'],
  ['GET', '/v1/stock', '*'],
  ['GET', '/v1/users', ['admin']],
  ['POST', '/v1/users', ['admin']],
  ['POST', '/test/events/ping', ['admin']],
  // Stammdaten
  ['POST', '/v1/locations', ['admin']],
  ['PATCH', '/v1/locations/abc', ['admin']],
  ['DELETE', '/v1/location-groups/LAGER', ['admin']],
  ['POST', '/v1/products', ['admin']],
  ['PUT', '/v1/products/X/units', ['admin']],
  ['POST', '/v1/strategy-rule-sets/1/activate', ['admin']],
  ['PUT', '/v1/flow/routes/R1/steps', ['admin']],
  ['DELETE', '/v1/transport-units/P1', ['admin']],
  // Sperren
  ['PATCH', '/v1/locations/abc/locks', ['admin', 'leitstand']],
  ['PATCH', '/v1/location-groups/LAGER/locks', ['admin', 'leitstand']],
  // Scanner-Arbeit
  ['POST', '/v1/transport-units/P1/move', ['admin', 'leitstand', 'lager']],
  ['POST', '/v1/receiving-blind-captures', ['admin', 'leitstand', 'lager']],
  ['POST', '/v1/receiving-orders/WE-1/captures', ['admin', 'leitstand', 'lager']],
  ['POST', '/v1/outbound-orders/A-1/picks/123/confirm', ['admin', 'leitstand', 'lager']],
  ['POST', '/v1/stock/123/issues', ['admin', 'leitstand', 'lager']],
  ['POST', '/v1/stock-counts/IN00000001/result', ['admin', 'leitstand', 'lager']],
  ['POST', '/v1/movements/MV00000001/complete', ['admin', 'leitstand', 'lager']],
  // Steuerung
  ['POST', '/v1/receiving-orders', ['admin', 'leitstand']],
  ['POST', '/v1/receiving-orders/WE-1/complete', ['admin', 'leitstand']],
  ['POST', '/v1/outbound-orders/A-1/allocate', ['admin', 'leitstand']],
  ['POST', '/v1/stock/123/corrections', ['admin', 'leitstand']],
  ['POST', '/v1/stock-counts', ['admin', 'leitstand']],
  ['POST', '/v1/movements', ['admin', 'leitstand']],
  ['POST', '/v1/movements/MV00000001/cancel', ['admin', 'leitstand']],
  // Anlage
  ['POST', '/v1/flow/events', ['admin', 'leitstand', 'anlage']],
  ['POST', '/v1/transport-orders/TO00000001/finish', ['admin', 'leitstand', 'anlage']],
  // Unbekannt: nur admin
  ['POST', '/v1/irgendwas-neues', ['admin']],
  ['DELETE', '/v1/stock/123', ['admin']],
];

describe('Rechtetabelle', () => {
  it.each(MATRIX)('%s %s', (method, path, expected) => {
    const access = accessFor(method, path);
    if (expected === 'public') return expect(access.kind).toBe('public');
    const allowed = ROLES.filter((r) => allows(access, [r]));
    expect(access.kind).not.toBe('public');
    expect(allowed).toEqual(expected === '*' ? [...ROLES] : ROLES.filter((r) => expected.includes(r)));
  });

  it('lässt die Rolle lesen nichts ändern', () => {
    for (const [method, path] of MATRIX) {
      if (method === 'GET' || path === '/v1/auth/login' || path === '/v1/auth/logout') continue;
      expect(allows(accessFor(method, path), ['lesen']), `${method} ${path}`).toBe(false);
    }
  });
});
