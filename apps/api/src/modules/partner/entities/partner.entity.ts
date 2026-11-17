import { defineEntity, p } from '@mikro-orm/postgresql';

/**
 * Geschäftspartner (OpenWMS: Partner-Stammdaten): Kunde, Lieferant und/oder Spediteur mit Anschrift.
 * Partner werden nicht gelöscht, sondern deaktiviert, weil Aufträge auf sie verweisen.
 */
const PartnerSchema = defineEntity({
  name: 'Partner',
  tableName: 'partner',
  properties: {
    id: p.uuid().primary(),
    /** Fachliche Kennung, z. B. Kundennummer aus dem ERP. */
    code: p.string().length(40).unique(),
    name: p.string().length(100),
    customer: p.boolean().default(false),
    supplier: p.boolean().default(false),
    carrier: p.boolean().default(false),
    street: p.string().length(100).nullable(),
    postalCode: p.string().length(20).nullable(),
    city: p.string().length(100).nullable(),
    /** ISO 3166-1 Alpha-2, z. B. DE. */
    country: p.string().length(2).nullable(),
    email: p.string().length(200).nullable(),
    phone: p.string().length(50).nullable(),
    active: p.boolean().default(true),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});

export class Partner extends PartnerSchema.class {}
PartnerSchema.setClass(Partner);
