import { z } from 'zod';
import { defineEvent } from './events.js';

/** Events der Geschäftspartner (Kunden, Lieferanten, Spediteure). */

export const PartnerRoleSchema = z.enum(['CUSTOMER', 'SUPPLIER', 'CARRIER']);
export type PartnerRole = z.infer<typeof PartnerRoleSchema>;

/** Postanschrift; `country` als ISO-3166-Alpha-2-Code. */
export const AddressSchema = z.object({
  street: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
});
export type Address = z.infer<typeof AddressSchema>;

export const PartnerSnapshotSchema = z.object({
  code: z.string(),
  name: z.string(),
  roles: z.array(PartnerRoleSchema),
  address: AddressSchema,
  active: z.boolean(),
});

export const PartnerCreatedEvent = defineEvent('partner.created', 1, PartnerSnapshotSchema);
/** Stammdaten geändert; `fields` nennt die geänderten Felder. */
export const PartnerChangedEvent = defineEvent('partner.changed', 1, PartnerSnapshotSchema.extend({ fields: z.array(z.string()) }));
