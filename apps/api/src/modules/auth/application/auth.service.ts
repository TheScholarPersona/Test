import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConflictError, DomainError, NotFoundError, TooManyRequestsError, UnauthenticatedError } from '../../../common/domain-error.js';
import { APP_CONFIG, type AppConfig } from '../../../config.js';
import { hashPassword, MIN_PASSWORD_LENGTH, sameSecret, verifyPassword } from '../domain/password.js';
import { ROLES, type Role } from '../domain/policy.js';
import { Session, User } from '../entities/auth.entities.js';
import { LoginThrottle } from './login-throttle.js';

/** Wer eine Anfrage stellt. */
export interface Identity {
  kind: 'user' | 'service';
  name: string;
  displayName: string;
  roles: Role[];
  userId?: string;
  sessionId?: string;
}

export interface UserInput {
  username: string;
  displayName?: string | undefined;
  password: string;
  roles: Role[];
}

export interface UserChange {
  displayName?: string | undefined;
  roles?: Role[] | undefined;
  active?: boolean | undefined;
  password?: string | undefined;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest();
const LAST_SEEN_INTERVAL_MS = 5 * 60_000;
/** Hash für unbekannte Benutzer: gleiche Rechenzeit wie bei bekannten, damit die Antwortzeit nichts verrät. */
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new DomainError('invalid', 'PASSWORD_TOO_SHORT', `Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen`, { min: MIN_PASSWORD_LENGTH });
  }
}

function assertRoles(roles: string[]): asserts roles is Role[] {
  const invalid = roles.filter((r) => !(ROLES as readonly string[]).includes(r));
  if (roles.length === 0 || invalid.length) {
    throw new DomainError('invalid', 'INVALID_ROLES', `Rollen ungültig: ${invalid.join(', ') || 'keine angegeben'}`, { allowed: ROLES });
  }
}

/**
 * Anmeldung: Benutzer mit Passwort (Sitzung als HttpOnly-Cookie oder Bearer)
 * und Service-Tokens für Maschinen (aus der Konfiguration).
 */
@Injectable()
export class AuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthService.name);
  private readonly throttle = new LoginThrottle();

  constructor(
    private readonly em: EntityManager,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Legt `admin` an, wenn ein Startpasswort konfiguriert ist und es den Benutzer noch nicht gibt. */
  async onApplicationBootstrap(): Promise<void> {
    const em = this.em.fork();
    if (this.config.auth.adminPassword) {
      if (!(await em.count(User, { username: 'admin' }))) {
        em.create(User, { id: randomUUID(), username: 'admin', displayName: 'Administrator', passwordHash: await hashPassword(this.config.auth.adminPassword), roles: ['admin'], active: true, lastLoginAt: null });
        await em.flush();
        this.logger.log('Benutzer admin angelegt (Passwort aus AUTH_ADMIN_PASSWORD)');
      }
    } else if (!this.config.auth.serviceTokens.length && !(await em.count(User, { active: true }))) {
      this.logger.warn('Keine Benutzer und keine Service-Tokens: niemand kann sich anmelden. AUTH_ADMIN_PASSWORD setzen.');
    }
  }

  /** Identität aus Bearer-Token (Service-Token oder Sitzung) bzw. Sitzungs-Cookie; `null` = nicht angemeldet. */
  async identify(bearer: string | null, cookieToken: string | null): Promise<Identity | null> {
    if (bearer) {
      const hash = sha256(bearer);
      const service = this.config.auth.serviceTokens.find((t) => sameSecret(t.hash, hash));
      if (service) return { kind: 'service', name: service.name, displayName: service.name, roles: service.roles as Role[] };
      return this.fromSession(hash.toString('hex'));
    }
    return cookieToken ? this.fromSession(sha256(cookieToken).toString('hex')) : null;
  }

  private async fromSession(id: string): Promise<Identity | null> {
    const em = this.em.fork();
    const session = await em.findOne(Session, { id }, { populate: ['user'] });
    if (!session) return null;
    const user = session.user as User;
    const now = new Date();
    if (session.expiresAt <= now || !user.active) {
      await em.nativeDelete(Session, { id });
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS) {
      await em.nativeUpdate(Session, { id }, { lastSeenAt: now });
    }
    return { kind: 'user', name: user.username, displayName: user.displayName || user.username, roles: user.roles as Role[], userId: user.id, sessionId: id };
  }

  /** Prüft Benutzer und Passwort; liefert ein neues Sitzungstoken (nur hier im Klartext). */
  async login(username: string, password: string, client: string, userAgent: string | null): Promise<{ token: string; identity: Identity; expiresAt: Date }> {
    const name = username.trim().toLowerCase();
    const key = `${client}|${name}`;
    const locked = this.throttle.lockedFor(key);
    if (locked > 0) {
      throw new TooManyRequestsError('LOGIN_LOCKED', `Zu viele Fehlversuche; erneut in ${Math.ceil(locked / 60_000)} Minute(n)`, { retryAfterSeconds: Math.ceil(locked / 1000) });
    }
    const em = this.em.fork();
    const user = await em.findOne(User, { username: name });
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid || !user.active) {
      this.throttle.failure(key);
      // Bewusst dieselbe Meldung für unbekannten Benutzer, falsches Passwort und gesperrten Benutzer.
      throw new UnauthenticatedError('INVALID_CREDENTIALS', 'Benutzername oder Passwort ist falsch');
    }
    this.throttle.success(key);
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.auth.sessionHours * 3_600_000);
    em.create(Session, { id: sha256(token).toString('hex'), user, expiresAt, lastSeenAt: now, userAgent: userAgent?.slice(0, 255) ?? null });
    user.lastLoginAt = now;
    // Abgelaufene Sitzungen nebenbei aufräumen.
    await em.nativeDelete(Session, { expiresAt: { $lt: now } });
    await em.flush();
    return { token, expiresAt, identity: { kind: 'user', name: user.username, displayName: user.displayName || user.username, roles: user.roles as Role[], userId: user.id } };
  }

  async logout(sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.em.fork().nativeDelete(Session, { id: sessionId });
  }

  async changeOwnPassword(identity: Identity, current: string, next: string): Promise<void> {
    if (identity.kind !== 'user' || !identity.userId) throw new DomainError('invalid', 'NOT_A_USER', 'Service-Tokens haben kein Passwort');
    assertPassword(next);
    const em = this.em.fork();
    const user = await em.findOneOrFail(User, { id: identity.userId });
    if (!(await verifyPassword(current, user.passwordHash))) throw new UnauthenticatedError('INVALID_CREDENTIALS', 'Das bisherige Passwort ist falsch');
    user.passwordHash = await hashPassword(next);
    // Alle anderen Sitzungen beenden; die aktuelle bleibt.
    await em.nativeDelete(Session, { user: user.id, id: { $ne: identity.sessionId ?? '' } });
    await em.flush();
  }

  // --- Benutzerverwaltung ------------------------------------------------------

  listUsers(): Promise<User[]> {
    return this.em.find(User, {}, { orderBy: { username: 'asc' } });
  }

  async createUser(input: UserInput): Promise<User> {
    assertRoles(input.roles);
    assertPassword(input.password);
    const username = input.username.trim().toLowerCase();
    return this.em.transactional(async (tx) => {
      if (await tx.count(User, { username })) throw new ConflictError('USER_EXISTS', `Benutzer [${username}] existiert bereits`, { username });
      return tx.create(User, {
        id: randomUUID(),
        username,
        displayName: input.displayName ?? '',
        passwordHash: await hashPassword(input.password),
        roles: [...new Set(input.roles)],
        active: true,
        lastLoginAt: null,
      });
    });
  }

  /** Rollen, Anzeigename, Aktiv, Passwort zurücksetzen. Rollenwechsel, Sperre und neues Passwort beenden die Sitzungen des Benutzers. */
  async updateUser(username: string, change: UserChange, actor: Identity): Promise<User> {
    return this.em.transactional(async (tx) => {
      const user = await tx.findOne(User, { username: username.toLowerCase() });
      if (!user) throw new NotFoundError('USER_NOT_FOUND', `Benutzer [${username}] existiert nicht`, { username });
      if (change.roles) assertRoles(change.roles);
      const self = actor.userId === user.id;
      if (self && (change.active === false || (change.roles && !change.roles.includes('admin')))) {
        throw new DomainError('invalid', 'SELF_LOCKOUT', 'Sie können sich nicht selbst sperren oder die eigene Admin-Rolle entziehen');
      }
      if (change.displayName !== undefined) user.displayName = change.displayName;
      let endSessions = false;
      if (change.roles) {
        user.roles = [...new Set(change.roles)];
        endSessions = true;
      }
      if (change.active !== undefined) {
        user.active = change.active;
        endSessions ||= !change.active;
      }
      if (change.password !== undefined) {
        assertPassword(change.password);
        user.passwordHash = await hashPassword(change.password);
        endSessions = true;
      }
      if (endSessions && !self) await tx.nativeDelete(Session, { user: user.id });
      return user;
    });
  }
}
