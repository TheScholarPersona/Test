import { BarcodeSchema, LocationGroupNameSchema, MovementPrioritySchema, MovementStateSchema, MovementTypeSchema } from '@wms/shared';
import { z } from 'zod';
import { pageOf } from '../../../http/common-schemas.js';
import { LocationReferenceSchema } from '../../layout/index.js';

export { pageOf };

export const MovementNumberParam = z.object({ number: z.string().regex(/^MV\d{8}$/, 'Bewegungsnummer im Format MV00000001') });

const Actor = z.string().trim().min(1).max(100);

export const MovementTargetSchema = z
  .union([
    z.strictObject({ location: LocationReferenceSchema }),
    z.strictObject({ group: LocationGroupNameSchema }),
  ])
  .meta({ id: 'MovementTarget', description: 'Fester Zielplatz oder Zielgruppe (Platz wird per Einlagerstrategie bestimmt und reserviert)' });

export const CreateMovementSchema = z
  .strictObject({
    barcode: BarcodeSchema,
    type: MovementTypeSchema,
    target: MovementTargetSchema,
    priority: MovementPrioritySchema.default('NORMAL'),
    initiator: Actor.optional().meta({ description: 'Auslöser, z. B. erp, node-red, Benutzername' }),
    dueAt: z.iso.datetime({ offset: true }).optional(),
  })
  .meta({ id: 'CreateMovement' });
export type CreateMovement = z.infer<typeof CreateMovementSchema>;

export const StartMovementSchema = z.strictObject({ assignedTo: Actor.optional() }).meta({ id: 'StartMovement' });
export type StartMovement = z.infer<typeof StartMovementSchema>;

export const CompleteMovementSchema = z
  .strictObject({
    location: LocationReferenceSchema.optional().meta({ description: 'Tatsächlicher Abstellplatz; ohne Angabe das Ziel' }),
    mode: z.enum(['checked', 'physical']).default('checked'),
  })
  .meta({ id: 'CompleteMovement' });
export type CompleteMovement = z.infer<typeof CompleteMovementSchema>;

export const CancelMovementSchema = z.strictObject({ reason: z.string().trim().min(1).max(200).optional() }).meta({ id: 'CancelMovement' });
export type CancelMovement = z.infer<typeof CancelMovementSchema>;

const splitCsv = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean);

export const MovementQuerySchema = z.object({
  state: z.string().transform(splitCsv).pipe(z.array(MovementStateSchema).min(1)).optional().meta({ description: 'Kommagetrennt, z. B. OPEN,IN_PROGRESS' }),
  type: z.string().transform(splitCsv).pipe(z.array(MovementTypeSchema).min(1)).optional().meta({ description: 'Kommagetrennt, z. B. INBOUND,RELOCATION' }),
  barcode: BarcodeSchema.optional(),
  assignedTo: Actor.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type MovementQuery = z.infer<typeof MovementQuerySchema>;

const PlaceSchema = z.object({ id: z.uuid().nullable().meta({ description: 'null, wenn der Platz inzwischen gelöscht wurde' }), locationId: z.string() });

export const MovementDtoSchema = z
  .object({
    number: z.string(),
    barcode: z.string(),
    type: MovementTypeSchema,
    state: MovementStateSchema,
    priority: MovementPrioritySchema,
    source: PlaceSchema,
    target: PlaceSchema.nullable(),
    targetGroup: z.string().nullable(),
    decisionId: z.uuid().nullable(),
    initiator: z.string().nullable(),
    assignedTo: z.string().nullable(),
    dueAt: z.iso.datetime().nullable(),
    startedAt: z.iso.datetime().nullable(),
    completed: z.object({ at: z.iso.datetime(), location: PlaceSchema, deviated: z.boolean() }).nullable(),
    cancelled: z.object({ at: z.iso.datetime(), reason: z.string().nullable() }).nullable(),
    allowedActions: z.array(z.enum(['start', 'release', 'complete', 'cancel'])),
    version: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Movement' });
export type MovementDto = z.infer<typeof MovementDtoSchema>;

export const CompletionResultSchema = z
  .object({ movement: MovementDtoSchema, violations: z.array(z.object({ rule: z.string(), message: z.string() })) })
  .meta({ id: 'MovementCompletion', description: 'Verstöße nur bei mode physical möglich' });
