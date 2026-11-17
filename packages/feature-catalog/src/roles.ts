/**
 * Rollen je Endpunkt – direkt aus der Rechtetabelle der API (apps/api/src/modules/auth/domain/policy.ts),
 * damit der Katalog keine eigene Kopie der Berechtigungen pflegt.
 */
import { accessFor, ROLES } from '../../../apps/api/src/modules/auth/domain/policy.ts';

export { ROLES };

export interface EndpointAccess {
  /** `public`: ohne Anmeldung; `authenticated`: jede angemeldete Rolle; `roles`: nur die genannten (admin darf immer). */
  kind: 'public' | 'authenticated' | 'roles';
  roles: string[];
}

export function accessOf(method: string, path: string): EndpointAccess {
  // Parameter durch einen Beispielwert ersetzen; die Rechtetabelle prüft nur die Form des Pfads.
  const concrete = path.replace(/\{[^}]+\}/g, 'X1');
  const access = accessFor(method, concrete);
  if (access.kind === 'public') return { kind: 'public', roles: [] };
  if (access.kind === 'authenticated') return { kind: 'authenticated', roles: [...ROLES] };
  return { kind: 'roles', roles: [...new Set(['admin', ...access.roles])] };
}
