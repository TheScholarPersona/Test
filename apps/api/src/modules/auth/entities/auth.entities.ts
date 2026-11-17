import { defineEntity, p } from '@mikro-orm/postgresql';

/** Benutzer der Oberfläche. Passwort nur als scrypt-Hash. */
const UserSchema = defineEntity({
  name: 'User',
  tableName: 'app_user',
  properties: {
    id: p.uuid().primary(),
    /** Kleingeschrieben, eindeutig. */
    username: p.string().length(60).unique(),
    displayName: p.string().length(120).default(''),
    passwordHash: p.string().length(255),
    roles: p.json<string[]>(),
    active: p.boolean().default(true),
    lastLoginAt: p.datetime().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});
export class User extends UserSchema.class {}
UserSchema.setClass(User);

/**
 * Sitzung nach der Anmeldung. Gespeichert wird nur der SHA-256 des Tokens;
 * das Token selbst kennt nur der Browser (HttpOnly-Cookie).
 */
const SessionSchema = defineEntity({
  name: 'Session',
  tableName: 'app_session',
  properties: {
    id: p.string().length(64).primary(),
    user: () => p.manyToOne(User).deleteRule('cascade').index(),
    createdAt: p.datetime().onCreate(() => new Date()),
    expiresAt: p.datetime().index(),
    lastSeenAt: p.datetime(),
    userAgent: p.string().length(255).nullable(),
  },
});
export class Session extends SessionSchema.class {}
SessionSchema.setClass(Session);
