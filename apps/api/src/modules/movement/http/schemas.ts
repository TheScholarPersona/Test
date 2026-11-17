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
  group: z.string().trim().min(1).max(20).optional().meta({ description: 'Nummer der Bewegungsgruppe' }),
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
    groupNumber: z.string().nullable().meta({ description: 'Bewegungsgruppe, falls zugeordnet' }),
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

// --- Bewegungsgruppen ------------------------------------------------------------------

const MovementNumber = z.string().trim().min(1).max(20);
const MovementGroupState = z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']);

export const CreateMovementGroupSchema = z
  .strictObject({
    description: z.string().trim().min(1).max(200).optional(),
    movements: z.array(MovementNumber).min(1).max(100).meta({ description: 'Nummern offener Lagerbewegungen' }),
    assignedTo: Actor.optional(),
  })
  .meta({ id: 'CreateMovementGroup' });
export type CreateMovementGroup = z.infer<typeof CreateMovementGroupSchema>;

export const ChangeMovementGroupSchema = z
  .strictObject({
    description: z.string().trim().min(1).max(200).nullable().optional(),
    add: z.array(MovementNumber).max(100).optional(),
    remove: z.array(MovementNumber).max(100).optional(),
  })
  .refine((v) => v.description !== undefined || v.add?.length || v.remove?.length, { message: 'description, add oder remove angeben' })
  .meta({ id: 'ChangeMovementGroup' });
export type ChangeMovementGroup = z.infer<typeof ChangeMovementGroupSchema>;

export const AssignMovementGroupSchema = z
  .strictObject({ assignedTo: Actor.nullable().meta({ description: 'Bediener; null hebt die Zuteilung auf' }) })
  .meta({ id: 'AssignMovementGroup' });
export type AssignMovementGroup = z.infer<typeof AssignMovementGroupSchema>;

export const StartMovementGroupSchema = z
  .strictObject({ assignedTo: Actor.optional().meta({ description: 'Ohne Angabe: zugeteilter Bediener, sonst der Angemeldete' }) })
  .meta({ id: 'StartMovementGroup' });
export type StartMovementGroup = z.infer<typeof StartMovementGroupSchema>;

export const MovementGroupParam = z.object({ number: z.string().trim().min(1).max(20) });

export const MovementGroupQuerySchema = z.object({
  state: z.string().transform(splitCsv).pipe(z.array(MovementGroupState).min(1)).optional().meta({ description: 'Kommagetrennt, z. B. OPEN,IN_PROGRESS' }),
  assignedTo: Actor.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type MovementGroupQuery = z.infer<typeof MovementGroupQuerySchema>;

export const MovementGroupDtoSchema = z
  .object({
    number: z.string(),
    description: z.string().nullable(),
    assignedTo: z.string().nullable(),
    state: MovementGroupState.meta({ description: 'Abgeleitet: IN_PROGRESS, sobald eine Bewegung läuft; DONE/CANCELLED, wenn alle beendet sind' }),
    counts: z.object({ open: z.number().int(), inProgress: z.number().int(), done: z.number().int(), cancelled: z.number().int() }),
    movements: z.array(MovementDtoSchema),
    createdBy: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'MovementGroup' });
export type MovementGroupDto = z.infer<typeof MovementGroupDtoSchema>;

