import { z } from 'zod';
import { ROLES } from '../domain/policy.js';

const Username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,60}$/, 'Benutzername: 2–60 Zeichen a-z, 0-9, . _ -');
const Password = z.string().min(1).max(200);
export const RoleSchema = z.enum(ROLES);

export const LoginSchema = z.strictObject({ username: z.string().trim().min(1).max(60), password: Password }).meta({ id: 'Login' });
export type LoginInput = z.infer<typeof LoginSchema>;

export const ChangePasswordSchema = z.strictObject({ currentPassword: Password, newPassword: Password }).meta({ id: 'ChangePassword' });
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const MeSchema = z
  .object({
    kind: z.enum(['user', 'service']),
    username: z.string(),
    displayName: z.string(),
    roles: z.array(RoleSchema),
    expiresAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Me' });
export type MeDto = z.infer<typeof MeSchema>;

export const RoleInfoSchema = z.object({ items: z.array(z.object({ role: RoleSchema, description: z.string() })) }).meta({ id: 'Roles' });

export const UsernameParam = z.object({ username: Username });

export const CreateUserSchema = z
  .strictObject({ username: Username, displayName: z.string().trim().max(120).optional(), password: Password, roles: z.array(RoleSchema).min(1) })
  .meta({ id: 'CreateUser' });
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .strictObject({
    displayName: z.string().trim().max(120).optional(),
    roles: z.array(RoleSchema).min(1).optional(),
    active: z.boolean().optional(),
    password: Password.optional().meta({ description: 'Neues Passwort setzen (beendet die Sitzungen des Benutzers)' }),
  })
  .meta({ id: 'UpdateUser' });
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export const UserDtoSchema = z
  .object({
    username: z.string(),
    displayName: z.string(),
    roles: z.array(RoleSchema),
    active: z.boolean(),
    lastLoginAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'User' });
export type UserDto = z.infer<typeof UserDtoSchema>;
