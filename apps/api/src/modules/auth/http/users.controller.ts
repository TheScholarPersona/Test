import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { AuthService, type Identity } from '../application/auth.service.js';
import type { Role } from '../domain/policy.js';
import type { User } from '../entities/auth.entities.js';
import { CurrentIdentity } from './auth.guard.js';
import { type CreateUserInput, CreateUserSchema, type UpdateUserInput, UpdateUserSchema, type UserDto, UserDtoSchema, UsernameParam } from './schemas.js';

const TAGS = ['Benutzer'];

const toUserDto = (u: User): UserDto => ({
  username: u.username,
  displayName: u.displayName,
  roles: u.roles as Role[],
  active: u.active,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

/** Benutzerverwaltung (nur admin, siehe Rechtetabelle). Benutzer werden nicht gelöscht, sondern deaktiviert. */
@Controller('v1/users')
export class UsersController {
  constructor(
    private readonly auth: AuthService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Benutzer', schema: UserDtoSchema };
    docs.route({ method: 'get', path: '/v1/users', summary: 'Benutzer', tags: TAGS, response: { status: 200, description: 'Liste', schema: UserDtoSchema.array() } });
    docs.route({ method: 'post', path: '/v1/users', summary: 'Benutzer anlegen', tags: TAGS, body: CreateUserSchema, response: { ...one, status: 201 }, errors: [400, 409] });
    docs.route({ method: 'patch', path: '/v1/users/{username}', summary: 'Rollen, Anzeigename, aktiv, Passwort (beendet die Sitzungen des Benutzers)', tags: TAGS, params: UsernameParam, body: UpdateUserSchema, response: one, errors: [400, 404] });
  }

  @Get()
  async list(): Promise<UserDto[]> {
    return (await this.auth.listUsers()).map(toUserDto);
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateUserSchema)) body: CreateUserInput): Promise<UserDto> {
    return toUserDto(await this.auth.createUser(body));
  }

  @Patch(':username')
  async update(
    @Param(new ZodValidationPipe(UsernameParam)) { username }: { username: string },
    @Body(new ZodValidationPipe(UpdateUserSchema)) body: UpdateUserInput,
    @CurrentIdentity() actor: Identity,
  ): Promise<UserDto> {
    return toUserDto(await this.auth.updateUser(username, body, actor));
  }
}
