/**
 * Öffentliche Schnittstelle des Moduls Anmeldung.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { Session, User } from './entities/auth.entities.js';

export { AuthModule } from './auth.module.js';
export { AuthService, type Identity } from './application/auth.service.js';
export { ROLES, type Role } from './domain/policy.js';

export const authEntities = [User, Session];
