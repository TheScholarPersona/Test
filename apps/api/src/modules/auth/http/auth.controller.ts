import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../../config.js';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { AuthService, type Identity } from '../application/auth.service.js';
import { ROLE_DESCRIPTIONS, ROLES } from '../domain/policy.js';
import { type AuthRequest, CurrentIdentity, SESSION_COOKIE } from './auth.guard.js';
import { type ChangePasswordInput, ChangePasswordSchema, type LoginInput, LoginSchema, type MeDto, MeSchema, RoleInfoSchema } from './schemas.js';

type Response = { setHeader(name: string, value: string): void };
const TAGS = ['Anmeldung'];

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    docs: ApiDocumentation,
  ) {
    docs.route({ method: 'post', path: '/v1/auth/login', summary: 'Anmelden: setzt das Sitzungs-Cookie (HttpOnly, SameSite=Strict)', tags: TAGS, body: LoginSchema, response: { status: 200, description: 'Angemeldet', schema: MeSchema }, errors: [400], public: true });
    docs.route({ method: 'post', path: '/v1/auth/logout', summary: 'Abmelden (Sitzung beenden)', tags: TAGS, response: { status: 204, description: 'Abgemeldet' } });
    docs.route({ method: 'get', path: '/v1/auth/me', summary: 'Wer bin ich (Benutzer oder Service-Token) und welche Rollen', tags: TAGS, response: { status: 200, description: 'Identität', schema: MeSchema } });
    docs.route({ method: 'post', path: '/v1/auth/password', summary: 'Eigenes Passwort ändern (beendet die anderen Sitzungen)', tags: TAGS, body: ChangePasswordSchema, response: { status: 204, description: 'Geändert' }, errors: [400] });
    docs.route({ method: 'get', path: '/v1/auth/roles', summary: 'Rollen mit Beschreibung', tags: TAGS, response: { status: 200, description: 'Rollen', schema: RoleInfoSchema } });
  }

  private cookie(request: AuthRequest, value: string, maxAgeSeconds: number): string {
    const forwarded = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
    const secure = this.config.auth.cookieSecure === 'true' || (this.config.auth.cookieSecure === 'auto' && forwarded === 'https');
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginInput, @Req() request: AuthRequest, @Res({ passthrough: true }) response: Response): Promise<MeDto> {
    const userAgent = request.headers['user-agent'];
    const { token, identity, expiresAt } = await this.auth.login(body.username, body.password, request.ip ?? 'unbekannt', typeof userAgent === 'string' ? userAgent : null);
    response.setHeader('Set-Cookie', this.cookie(request, token, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    return toMe(identity, expiresAt);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentIdentity() identity: Identity, @Req() request: AuthRequest, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(identity.sessionId);
    response.setHeader('Set-Cookie', this.cookie(request, '', 0));
  }

  @Get('me')
  me(@CurrentIdentity() identity: Identity): MeDto {
    return toMe(identity, null);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async password(@CurrentIdentity() identity: Identity, @Body(new ZodValidationPipe(ChangePasswordSchema)) body: ChangePasswordInput): Promise<void> {
    await this.auth.changeOwnPassword(identity, body.currentPassword, body.newPassword);
  }

  @Get('roles')
  roles(): z.infer<typeof RoleInfoSchema> {
    return { items: ROLES.map((role) => ({ role, description: ROLE_DESCRIPTIONS[role] })) };
  }
}

function toMe(identity: Identity, expiresAt: Date | null): MeDto {
  return { kind: identity.kind, username: identity.name, displayName: identity.displayName, roles: identity.roles, expiresAt: expiresAt?.toISOString() ?? null };
}
