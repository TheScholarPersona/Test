/**
 * Fachliche Fehler. Fachmodule werfen nur diese Klassen; die HTTP-Schicht
 * übersetzt sie einheitlich (siehe http/api-exception.filter.ts).
 *
 * `code` ist eine stabile, maschinenlesbare Kennung (z. B. für Node-RED-Flows),
 * `message` ein verständlicher Text.
 */
export type DomainErrorKind = 'not-found' | 'conflict' | 'rule-violation' | 'invalid';

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
