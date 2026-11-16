import { defineEntity, p } from '@mikro-orm/postgresql';

/** Art eines Lagerplatzes, z. B. Euro-Palettenplatz; Maße in Millimetern. */
const LocationTypeSchema = defineEntity({
  name: 'LocationType',
  tableName: 'location_type',
  properties: {
    id: p.uuid().primary(),
    code: p.string().length(40).unique(),
    description: p.string().length(255).default(''),
    lengthMm: p.integer().nullable(),
    widthMm: p.integer().nullable(),
    heightMm: p.integer().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});

export class LocationType extends LocationTypeSchema.class {}
LocationTypeSchema.setClass(LocationType);
