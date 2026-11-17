import { BarcodeSchema, LocationTypeCodeSchema, TransportUnitStateSchema, TransportUnitTypeCodeSchema } from '@wms/shared';
import { z } from 'zod';
import { itemsOf, pageOf, Timestamps, WeightKgSchema } from '../../../http/common-schemas.js';
import { LocationReferenceSchema } from '../../layout/index.js';

export { itemsOf, pageOf };

const Description = z.string().trim().max(255);
const DimensionMm = z.number().int().min(1).max(100_000);
const Reason = z.string().trim().min(1).max(200);

/**
 * `checked`: alle Regeln prüfen, bei Verstoß ablehnen (Standard).
 * `physical`: gemeldete Ist-Position (Scanner, SPS) – wird immer gebucht,
 * Verstöße stehen im Event und in der Antwort.
 */
export const PlacementModeSchema = z.enum(['checked', 'physical']).default('checked');

export const PlacementViolationSchema = z.object({ rule: z.string(), message: z.string() }).meta({ id: 'PlacementViolation' });

// ---------------------------------------------------------------------------
// TU-Typen
// ---------------------------------------------------------------------------

export const TransportUnitTypeCodeParam = z.object({ code: TransportUnitTypeCodeSchema });

export const CreateTransportUnitTypeSchema = z
  .strictObject({
    code: TransportUnitTypeCodeSchema,
    description: Description.default(''),
    lengthMm: DimensionMm.nullable().default(null),
    widthMm: DimensionMm.nullable().default(null),
    heightMm: DimensionMm.nullable().default(null),
    tareWeight: WeightKgSchema.nullable().default(null),
    maxPayload: WeightKgSchema.nullable().default(null),
  })
  .meta({ id: 'CreateTransportUnitType' });
export type CreateTransportUnitType = z.infer<typeof CreateTransportUnitTypeSchema>;

export const UpdateTransportUnitTypeSchema = z
  .strictObject({
    description: Description.optional(),
    lengthMm: DimensionMm.nullable().optional(),
    widthMm: DimensionMm.nullable().optional(),
    heightMm: DimensionMm.nullable().optional(),
    tareWeight: WeightKgSchema.nullable().optional(),
    maxPayload: WeightKgSchema.nullable().optional(),
  })
  .meta({ id: 'UpdateTransportUnitType' });
export type UpdateTransportUnitType = z.infer<typeof UpdateTransportUnitTypeSchema>;

export const PlacementRulesSchema = z
  .array(z.strictObject({ locationTypeCode: LocationTypeCodeSchema, privilegeLevel: z.number().int().min(0).max(1000).default(0) }))
  .max(200)
  .refine((rules) => new Set(rules.map((r) => r.locationTypeCode)).size === rules.length, { message: 'Platztyp mehrfach angegeben' })
  .meta({ id: 'PlacementRules', description: 'Erlaubte Platztypen; leere Liste = überall erlaubt' });
export type PlacementRulesInput = z.infer<typeof PlacementRulesSchema>;

export const StackingRulesSchema = z
  .array(z.strictObject({ allowedTypeCode: TransportUnitTypeCodeSchema, maxCount: z.number().int().min(1).max(100) }))
  .max(200)
  .refine((rules) => new Set(rules.map((r) => r.allowedTypeCode)).size === rules.length, { message: 'TU-Typ mehrfach angegeben' })
  .meta({ id: 'StackingRules', description: 'Welche TU-Typen wie oft auf diesen Typ gestapelt werden dürfen; leer = nicht stapelbar' });
export type StackingRulesInput = z.infer<typeof StackingRulesSchema>;

export const TransportUnitTypeDtoSchema = z
  .object({
    code: z.string(),
    description: z.string(),
    lengthMm: z.number().int().nullable(),
    widthMm: z.number().int().nullable(),
    heightMm: z.number().int().nullable(),
    tareWeight: WeightKgSchema.nullable(),
    maxPayload: WeightKgSchema.nullable(),
    placementRules: z.array(z.object({ locationTypeCode: z.string(), privilegeLevel: z.number().int() })),
    stackingRules: z.array(z.object({ allowedTypeCode: z.string(), maxCount: z.number().int() })),
    ...Timestamps,
  })
  .meta({ id: 'TransportUnitType' });
export type TransportUnitTypeDto = z.infer<typeof TransportUnitTypeDtoSchema>;

// ---------------------------------------------------------------------------
// Transporteinheiten
// ---------------------------------------------------------------------------

export const BarcodeParam = z.object({ barcode: BarcodeSchema });

export const CreateTransportUnitSchema = z
  .strictObject({
    barcode: BarcodeSchema.optional().meta({ description: 'Ohne Angabe wird ein Barcode erzeugt' }),
    typeCode: TransportUnitTypeCodeSchema,
    location: LocationReferenceSchema,
    weight: WeightKgSchema.nullable().default(null),
    state: TransportUnitStateSchema.default('AVAILABLE'),
    mode: PlacementModeSchema,
  })
  .meta({ id: 'CreateTransportUnit' });
export type CreateTransportUnit = z.infer<typeof CreateTransportUnitSchema>;

export const MoveTransportUnitSchema = z
  .strictObject({ to: LocationReferenceSchema, mode: PlacementModeSchema })
  .meta({ id: 'MoveTransportUnit' });
export type MoveTransportUnit = z.infer<typeof MoveTransportUnitSchema>;

export const UpdateTransportUnitSchema = z
  .strictObject({
    weight: WeightKgSchema.nullable().optional(),
    target: LocationReferenceSchema.nullable().optional().meta({ description: 'Geplantes Ziel; null entfernt es' }),
  })
  .meta({ id: 'UpdateTransportUnit' });
export type UpdateTransportUnit = z.infer<typeof UpdateTransportUnitSchema>;

export const ChangeStateSchema = z
  .strictObject({ state: TransportUnitStateSchema, reason: Reason.optional() })
  .meta({ id: 'ChangeTransportUnitState' });
export type ChangeState = z.infer<typeof ChangeStateSchema>;

export const StackSchema = z.strictObject({ onto: BarcodeSchema }).meta({ id: 'StackTransportUnit' });
export type StackInput = z.infer<typeof StackSchema>;

export const UnstackSchema = z.strictObject({ mode: PlacementModeSchema }).meta({ id: 'UnstackTransportUnit' });
export type UnstackInput = z.infer<typeof UnstackSchema>;

export const TransportUnitQuerySchema = z.object({
  location: z.uuid().optional().meta({ description: 'Lagerplatz-ID' }),
  locationId: z.string().optional().meta({ description: 'Koordinate des Lagerplatzes' }),
  parent: BarcodeSchema.optional().meta({ description: 'Nur TUs, die direkt auf dieser TU stehen' }),
  state: TransportUnitStateSchema.optional(),
  type: TransportUnitTypeCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(10_000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TransportUnitQuery = z.infer<typeof TransportUnitQuerySchema>;

const LocationRefDto = z.object({ id: z.uuid(), locationId: z.string(), erpCode: z.string().nullable() });

export const TransportUnitDtoSchema = z
  .object({
    barcode: z.string(),
    typeCode: z.string(),
    state: TransportUnitStateSchema,
    location: LocationRefDto,
    target: LocationRefDto.nullable(),
    parentBarcode: z.string().nullable(),
    weight: WeightKgSchema.nullable().meta({ description: 'Gemessenes Gewicht' }),
    effectiveWeight: WeightKgSchema.meta({ description: 'Gemessenes Gewicht oder Leergewicht des Typs' }),
    ...Timestamps,
  })
  .meta({ id: 'TransportUnit' });
export type TransportUnitDto = z.infer<typeof TransportUnitDtoSchema>;

/** Antwort auf Anlegen/Bewegen/Abstapeln: TU plus festgestellte Regelverstöße (nur bei `physical` möglich). */
export const PlacementResultSchema = z
  .object({ unit: TransportUnitDtoSchema, violations: z.array(PlacementViolationSchema) })
  .meta({ id: 'PlacementResult' });
export type PlacementResult = z.infer<typeof PlacementResultSchema>;

// --- Fehlermeldungen an TUs ---------------------------------------------------------

export const ReportUnitErrorSchema = z
  .strictObject({
    code: z.string().trim().min(1).max(60).meta({ description: 'Fehlercode, z. B. KONTUR oder GEWICHT' }),
    message: z.string().trim().min(1).max(200).optional(),
  })
  .meta({ id: 'ReportTransportUnitError' });
export type ReportUnitError = z.infer<typeof ReportUnitErrorSchema>;

export const ResolveUnitErrorSchema = z
  .strictObject({ resolution: z.string().trim().min(1).max(200).optional().meta({ description: 'Was getan wurde' }) })
  .meta({ id: 'ResolveTransportUnitError' });
export type ResolveUnitError = z.infer<typeof ResolveUnitErrorSchema>;

export const UnitErrorParam = z.object({ barcode: BarcodeSchema, errorId: z.uuid() });

export const UnitErrorStateSchema = z.enum(['open', 'resolved', 'all']);

export const UnitErrorQuerySchema = z.object({
  state: UnitErrorStateSchema.default('open'),
  barcode: BarcodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type UnitErrorQuery = z.infer<typeof UnitErrorQuerySchema>;

export const UnitErrorListQuerySchema = z.object({ state: UnitErrorStateSchema.default('all') });

export const UnitErrorDtoSchema = z
  .object({
    id: z.uuid(),
    barcode: z.string(),
    code: z.string(),
    message: z.string().nullable(),
    locationId: z.string().nullable().meta({ description: 'Platz der TU zum Zeitpunkt der Meldung' }),
    reportedBy: z.string().nullable(),
    reportedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().nullable(),
    resolvedBy: z.string().nullable(),
    resolution: z.string().nullable(),
  })
  .meta({ id: 'TransportUnitError' });
export type UnitErrorDto = z.infer<typeof UnitErrorDtoSchema>;

