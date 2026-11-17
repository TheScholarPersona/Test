import { type CanActivate, createParamDecorator, type ExecutionContext, Injectable } from '@nestjs/common';
import { ForbiddenError, UnauthenticatedError } from '../../../common/domain-error.js';
import { requestContext } from '../../../common/request-context.js';
import { AuthService, type Identity } from '../application/auth.service.js';
import { accessFor, allows } from '../domain/policy.js';

export const SESSION_COOKIE = 'wms_session';

export interface AuthRequest {
  method: string;
  path: string;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  identity?: Identity | null;
}

export function readCookie(header: string | string[] | undefined, name: string): string | null {
  const raw = Array.isArray(header) ? header.join(';') : (header ?? '');
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function bearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)$/i.exec(value ?? '');
  return match?.[1] ?? null;
}

/**
 * Prüft jede Anfrage an einen Controller gegen die Rechtetabelle
 * (`domain/policy.ts`). Die Identität steht danach in `request.identity`
 * und als Akteur im Anfragekontext (für die Ereignisse).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const access = accessFor(request.method, request.path);
    if (access.kind === 'public') return true;
    const identity = await this.auth.identify(bearer(request.headers['authorization']), readCookie(request.headers['cookie'], SESSION_COOKIE));
    request.identity = identity;
    if (!identity) throw new UnauthenticatedError('UNAUTHENTICATED', 'Bitte anmelden');
    requestContext.setActor(`${identity.kind}:${identity.name}`);
    if (!allows(access, identity.roles)) {
      const required = access.kind === 'roles' ? access.roles : [];
      throw new ForbiddenError('FORBIDDEN', `${identity.name} (${identity.roles.join(', ')}) darf ${request.method} ${request.path} nicht – nötig: ${required.join(' oder ')}`, {
        required,
        roles: identity.roles,
      });
    }
    return true;
  }
}

/** Identität der laufenden Anfrage im Controller. */
export const CurrentIdentity = createParamDecorator((_data: unknown, context: ExecutionContext): Identity => {
  const identity = context.switchToHttp().getRequest<AuthRequest>().identity;
  if (!identity) throw new UnauthenticatedError('UNAUTHENTICATED', 'Bitte anmelden');
  return identity;
});
