import { ErpCodeSchema, LocationGroupNameSchema, LocationIdSchema, LocationTypeCodeSchema } from '@wms/shared';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

const Description = z.string().trim().max(255);
const DimensionMm = z.number().int().min(1).max(100_000);
const PlcCode = z.string().trim().min(1).max(64);
const LockReason = z.string().trim().min(1).max(200);

/** Gewicht in Kilogramm, höchstens 9 Vor- und 3 Nachkommastellen (Spalte NUMERIC(12,3)). */
export const WeightKgSchema = z
  .object({
    amount: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, 'Gewicht: nicht negativ, höchstens 9 Vor- und 3 Nachkommastellen, z. B. "1250.5"'),
    unit: z.literal('KG'),
  })
  .meta({ id: 'WeightKg' });

const Timestamps = {
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const LockHolderSchema = z.object({
  kind: z.enum(['location', 'location-group']),
  name: z.string(),
});

export const LockStateSchema = z
  .object({
    own: z.boolean().meta({ description: 'Eigene Sperre' }),
    blocked: z.boolean().meta({ description: 'Wirksame Sperre (eigene oder von einer übergeordneten Gruppe geerbte)' }),
    blockedBy: LockHolderSchema.nullable().meta({ description: 'Nächstgelegenes Objekt, das sperrt' }),
  })
  .meta({ id: 'LockState' });

// ---------------------------------------------------------------------------
// Lagerplatztypen
// ---------------------------------------------------------------------------

export const LocationTypeCodeParam = z.object({ code: LocationTypeCodeSchema });

export const CreateLocationTypeSchema = z
  .strictObject({
    code: LocationTypeCodeSchema,
    description: Description.default(''),
    lengthMm: DimensionMm.nullable().default(null),
    widthMm: DimensionMm.nullable().default(null),
    heightMm: DimensionMm.nullable().default(null),
  })
  .meta({ id: 'CreateLocationType' });
export type CreateLocationType = z.infer<typeof CreateLocationTypeSchema>;

export const UpdateLocationTypeSchema = z
  .strictObject({
    description: Description.optional(),
    lengthMm: DimensionMm.nullable().optional(),
    widthMm: DimensionMm.nullable().optional(),
    heightMm: DimensionMm.nullable().optional(),
  })
  .meta({ id: 'UpdateLocationType' });
export type UpdateLocationType = z.infer<typeof UpdateLocationTypeSchema>;

export const LocationTypeDtoSchema = z
  .object({
    code: z.string(),
    description: z.string(),
    lengthMm: z.number().int().nullable(),
    widthMm: z.number().int().nullable(),
    heightMm: z.number().int().nullable(),
    ...Timestamps,
  })
  .meta({ id: 'LocationType' });
export type LocationTypeDto = z.infer<typeof LocationTypeDtoSchema>;

// ---------------------------------------------------------------------------
// Lagerplatzgruppen
// ---------------------------------------------------------------------------

export const LocationGroupNameParam = z.object({ name: LocationGroupNameSchema });

export const CreateLocationGroupSchema = z
  .strictObject({
    name: LocationGroupNameSchema,
    description: Description.default(''),
    groupType: z.string().trim().min(1).max(40).nullable().default(null),
    parentName: LocationGroupNameSchema.nullable().default(null),
  })
  .meta({ id: 'CreateLocationGroup' });
export type CreateLocationGroup = z.infer<typeof CreateLocationGroupSchema>;

export const UpdateLocationGroupSchema = z
  .strictObject({
    description: Description.optional(),
    groupType: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .meta({ id: 'UpdateLocationGroup' });
export type UpdateLocationGroup = z.infer<typeof UpdateLocationGroupSchema>;

export const ChangeGroupLocksSchema = z
  .strictObject({
    inbound: z.boolean().optional(),
    outbound: z.boolean().optional(),
    reason: LockReason.optional(),
  })
  .refine((v) => v.inbound !== undefined || v.outbound !== undefined, { message: 'inbound oder outbound angeben' })
  .meta({ id: 'ChangeGroupLocks', description: 'true = sperren, false = entsperren; nicht angegebene Richtungen bleiben unverändert' });
export type ChangeGroupLocks = z.infer<typeof ChangeGroupLocksSchema>;

export const LocationGroupDtoSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    groupType: z.string().nullable(),
    parentName: z.string().nullable(),
    locks: z.object({ inbound: LockStateSchema, outbound: LockStateSchema }),
    ...Timestamps,
  })
  .meta({ id: 'LocationGroup' });
export type LocationGroupDto = z.infer<typeof LocationGroupDtoSchema>;

// ---------------------------------------------------------------------------
// Lagerplätze
// ---------------------------------------------------------------------------

export const LocationIdParam = z.object({ id: z.uuid() });

export const CreateLocationSchema = z
  .strictObject({
    locationId: LocationIdSchema,
    typeCode: LocationTypeCodeSchema,
    groupName: LocationGroupNameSchema,
    erpCode: ErpCodeSchema.nullable().default(null),
    plcCode: PlcCode.nullable().default(null),
    description: Description.default(''),
    sortOrder: z.number().int().default(0),
    maxTransportUnits: z.number().int().min(0).max(10_000).default(1),
    maxWeight: WeightKgSchema.nullable().default(null),
  })
  .meta({ id: 'CreateLocation' });
export type CreateLocation = z.infer<typeof CreateLocationSchema>;

export const UpdateLocationSchema = z
  .strictObject({
    /** Nur zur Klarstellung erlaubt: muss der bestehenden Koordinate entsprechen. */
    locationId: LocationIdSchema.optional(),
    /** Nur zur Klarstellung erlaubt: muss dem bestehenden Typ entsprechen. */
    typeCode: LocationTypeCodeSchema.optional(),
    groupName: LocationGroupNameSchema.optional(),
    erpCode: ErpCodeSchema.nullable().optional(),
    plcCode: PlcCode.nullable().optional(),
    description: Description.optional(),
    sortOrder: z.number().int().optional(),
    maxTransportUnits: z.number().int().min(0).max(10_000).optional(),
    maxWeight: WeightKgSchema.nullable().optional(),
  })
  .meta({ id: 'UpdateLocation', description: 'Koordinate und Typ sind unveränderlich' });
export type UpdateLocation = z.infer<typeof UpdateLocationSchema>;

export const ChangeLocationLocksSchema = z
  .strictObject({
    inbound: z.boolean().optional(),
    outbound: z.boolean().optional(),
    allocation: z.boolean().optional(),
    reason: LockReason.optional(),
  })
  .refine((v) => v.inbound !== undefined || v.outbound !== undefined || v.allocation !== undefined, {
    message: 'inbound, outbound oder allocation angeben',
  })
  .meta({ id: 'ChangeLocationLocks' });
export type ChangeLocationLocks = z.infer<typeof ChangeLocationLocksSchema>;

export const LocationQuerySchema = z.object({
  locationId: LocationIdSchema.optional(),
  erpCode: ErpCodeSchema.optional(),
  plcCode: PlcCode.optional(),
  group: LocationGroupNameSchema.optional(),
  includeSubgroups: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(10_000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
});
export type LocationQuery = z.infer<typeof LocationQuerySchema>;

export const LocationDtoSchema = z
  .object({
    id: z.uuid(),
    locationId: z.string(),
    erpCode: z.string().nullable(),
    plcCode: z.string().nullable(),
    description: z.string(),
    sortOrder: z.number().int(),
    typeCode: z.string(),
    groupName: z.string(),
    capacity: z.object({
      maxTransportUnits: z.number().int(),
      maxWeight: WeightKgSchema.nullable(),
    }),
    locks: z.object({
      inbound: LockStateSchema,
      outbound: LockStateSchema,
      allocation: z.object({ blocked: z.boolean() }),
    }),
    ...Timestamps,
  })
  .meta({ id: 'Location' });
export type LocationDto = z.infer<typeof LocationDtoSchema>;

export const itemsOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });
export const pageOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: z.number().int() });
