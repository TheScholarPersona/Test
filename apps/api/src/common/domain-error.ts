/**
 * Fachliche Fehler. Fachmodule werfen nur diese Klassen; die HTTP-Schicht
 * übersetzt sie einheitlich (siehe http/api-exception.filter.ts).
 *
 * `code` ist eine stabile, maschinenlesbare Kennung (z. B. für Node-RED-Flows),
 * `message` ein verständlicher Text.
 */
export type DomainErrorKind = 'not-found' | 'conflict' | 'rule-violation' | 'invalid' | 'unauthenticated' | 'forbidden' | 'too-many-requests';

export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Gesuchtes Objekt existiert nicht → HTTP 404. */
export class NotFoundError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('not-found', code, message, details);
  }
}

/** Widerspruch zum aktuellen Datenbestand, z. B. Kennung schon vergeben → HTTP 409. */
export class ConflictError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('conflict', code, message, details);
  }
}

/** Geschäftsregel verletzt, z. B. Entsperren trotz geerbter Sperre → HTTP 409. */
export class RuleViolationError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('rule-violation', code, message, details);
  }
}

/** Nicht angemeldet oder Anmeldung ungültig → HTTP 401. */
export class UnauthenticatedError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('unauthenticated', code, message, details);
  }
}

/** Angemeldet, aber die Rolle erlaubt die Aktion nicht → HTTP 403. */
export class ForbiddenError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('forbidden', code, message, details);
  }
}

/** Zu viele Versuche (z. B. Anmeldung) → HTTP 429. */
export class TooManyRequestsError extends DomainError {
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super('too-many-requests', code, message, details);
  }
}
