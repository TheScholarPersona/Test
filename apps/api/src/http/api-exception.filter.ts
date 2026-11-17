import {
  ForeignKeyConstraintViolationException,
  OptimisticLockError,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { DomainError, type DomainErrorKind } from '../common/domain-error.js';

/** Einheitliches Fehlerformat aller fachlichen Fehler. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

const STATUS: Record<DomainErrorKind, HttpStatus> = {
  'not-found': HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  'rule-violation': HttpStatus.CONFLICT,
  invalid: HttpStatus.BAD_REQUEST,
  unauthenticated: HttpStatus.UNAUTHORIZED,
  forbidden: HttpStatus.FORBIDDEN,
  'too-many-requests': HttpStatus.TOO_MANY_REQUESTS,
};

const REASON: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
};

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Übersetzt fachliche Fehler und Datenbank-Konflikte in HTTP-Antworten.
 * Datenbank-Konflikte sind die letzte Absicherung, falls zwei Anfragen
 * gleichzeitig dieselbe Kennung anlegen oder dasselbe Objekt ändern.
 */
@Catch(DomainError, UniqueConstraintViolationException, ForeignKeyConstraintViolationException, OptimisticLockError)
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: Error, host: ArgumentsHost): void {
    const body = this.toBody(exception);
    if (!(exception instanceof DomainError)) {
      this.logger.warn(`${exception.name}: ${exception.message}`);
    }
    host.switchToHttp().getResponse<JsonResponse>().status(body.statusCode).json(body);
  }

  private toBody(exception: Error): ApiErrorBody {
    if (exception instanceof DomainError) {
      const statusCode = STATUS[exception.kind];
      const body: ApiErrorBody = { statusCode, error: REASON[statusCode] ?? 'Error', code: exception.code, message: exception.message };
      if (exception.details) {
        body.details = exception.details;
      }
      return body;
    }
    if (exception instanceof UniqueConstraintViolationException) {
      return { statusCode: 409, error: 'Conflict', code: 'DUPLICATE', message: 'Ein Eintrag mit dieser Kennung existiert bereits' };
    }
    if (exception instanceof ForeignKeyConstraintViolationException) {
      return { statusCode: 409, error: 'Conflict', code: 'IN_USE', message: 'Der Eintrag wird noch verwendet' };
    }
    return {
      statusCode: 409,
      error: 'Conflict',
      code: 'CONCURRENT_MODIFICATION',
      message: 'Der Eintrag wurde zwischenzeitlich geändert; bitte neu laden und wiederholen',
    };
  }
}
