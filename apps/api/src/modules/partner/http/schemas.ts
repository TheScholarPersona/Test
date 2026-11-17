import { AddressSchema, PartnerRoleSchema } from '@wms/shared';
import { z } from 'zod';
import { pageOf } from '../../../http/common-schemas.js';

export { pageOf };

export const PartnerCodeSchema = z.string().trim().regex(/^[A-Za-z0-9_.\-/]{1,40}$/, 'Partnernummer: Buchstaben, Ziffern, _ . - / (max. 40)');
export const PartnerParam = z.object({ code: PartnerCodeSchema });

const text = (max: number) => z.string().trim().min(1).max(max);

/** Anschrift in Eingaben: alle Felder optional, `null` löscht beim Ändern. */
export const AddressInputSchema = z
  .strictObject({
    street: text(100).nullable().optional(),
    postalCode: text(20).nullable().optional(),
    city: text(100).nullable().optional(),
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, 'Land: ISO-3166-Alpha-2, z. B. DE')
      .transform((c) => c.toUpperCase())
      .nullable()
      .optional(),
  })
  .meta({ id: 'AddressInput' });
export type AddressInput = z.infer<typeof AddressInputSchema>;

const Roles = z.array(PartnerRoleSchema).min(1).max(3).meta({ description: 'Mindestens eine Rolle: CUSTOMER, SUPPLIER, CARRIER' });

export const CreatePartnerSchema = z
  .strictObject({
    code: PartnerCodeSchema,
    name: text(100),
    roles: Roles,
    address: AddressInputSchema.optional(),
    email: z.email().max(200).optional(),
    phone: text(50).optional(),
  })
  .meta({ id: 'CreatePartner' });
export type CreatePartner = z.infer<typeof CreatePartnerSchema>;

export const ChangePartnerSchema = z
  .strictObject({
    name: text(100).optional(),
    roles: Roles.optional(),
    address: AddressInputSchema.optional(),
    email: z.email().max(200).nullable().optional(),
    phone: text(50).nullable().optional(),
    active: z.boolean().optional().meta({ description: 'false deaktiviert: neue Aufträge können den Partner nicht mehr verwenden' }),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Mindestens ein Feld angeben' })
  .meta({ id: 'ChangePartner' });
export type ChangePartner = z.infer<typeof ChangePartnerSchema>;

export const PartnerQuerySchema = z.object({
  role: PartnerRoleSchema.optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .meta({ description: 'Ohne Angabe: aktive und inaktive' }),
  q: z.string().trim().min(1).max(100).optional().meta({ description: 'Sucht in Nummer, Name und Ort' }),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PartnerQuery = z.infer<typeof PartnerQuerySchema>;

export const PartnerDtoSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    roles: z.array(PartnerRoleSchema),
    address: AddressSchema,
    email: z.string().nullable(),
    phone: z.string().nullable(),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Partner' });
export type PartnerDto = z.infer<typeof PartnerDtoSchema>;
