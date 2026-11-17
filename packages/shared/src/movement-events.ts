import { z } from 'zod';
import { defineEvent } from './events.js';

/** Events der Lagerbewegungen. */

export const MovementTypeSchema = z.enum(['INBOUND', 'RELOCATION', 'REPLENISHMENT', 'OUTBOUND', 'EMPTIES', 'CLEARING', 'MANUAL']);
export type MovementType = z.infer<typeof MovementTypeSchema>;

export const MovementStateSchema = z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const MovementPrioritySchema = z.enum(['HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST']);

const LocationRef = z.object({ id: z.uuid(), locationId: z.string(), erpCode: z.string().nullable() });
/** Platz in der Bewegungshistorie: `id` ist `null`, wenn der Platz inzwischen gelöscht wurde. */
const HistoricLocationRef = z.object({ id: z.uuid().nullable(), locationId: z.string(), erpCode: z.string().nullable() });

export const MovementSnapshotSchema = z.object({
  number: z.string(),
  barcode: z.string(),
  type: MovementTypeSchema,
  state: MovementStateSchema,
  priority: MovementPrioritySchema,
  source: HistoricLocationRef,
  target: HistoricLocationRef.nullable(),
  targetGroup: z.string().nullable(),
  assignedTo: z.string().nullable(),
  initiator: z.string().nullable(),
});

export const MovementCreatedEvent = defineEvent(
  'movement.created',
  1,
  MovementSnapshotSchema.extend({ decisionId: z.uuid().nullable() }),
);
export const MovementStartedEvent = defineEvent('movement.started', 1, MovementSnapshotSchema);
export const MovementReleasedEvent = defineEvent('movement.released', 1, MovementSnapshotSchema);
/**
 * Bewegung abgeschlossen. `from` ist der Platz vor dem Abschluss, `to` der
 * tatsächliche Abstellplatz; `deviated` ist gesetzt, wenn dieser vom Ziel abweicht.
 */
export const MovementCompletedEvent = defineEvent(
  'movement.completed',
  1,
  MovementSnapshotSchema.extend({
    from: LocationRef,
    to: LocationRef,
    deviated: z.boolean(),
    mode: z.enum(['checked', 'physical']),
    violations: z.array(z.object({ rule: z.string(), message: z.string() })),
  }),
);
export const MovementCancelledEvent = defineEvent(
  'movement.cancelled',
  1,
  MovementSnapshotSchema.extend({ reason: z.string().optional(), releasedTarget: z.boolean() }),
);
