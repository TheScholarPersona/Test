import { z } from 'zod';
import { defineEvent } from './events.js';

/** Events der Transportaufträge (automatischer Materialfluss). */

export const TransportOrderStateSchema = z.enum(['INITIALIZED', 'STARTED', 'INTERRUPTED', 'FINISHED', 'CANCELED', 'ONFAILURE']);
export type TransportOrderState = z.infer<typeof TransportOrderStateSchema>;
export const TransportOrderPrioritySchema = z.enum(['HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST']);
export type TransportOrderPriority = z.infer<typeof TransportOrderPrioritySchema>;

/** Platz in der Auftragshistorie: `id` ist `null`, wenn der Platz inzwischen gelöscht wurde. */
const HistoricLocationRef = z.object({ id: z.uuid().nullable(), locationId: z.string(), erpCode: z.string().nullable() });
const Problem = z.object({ code: z.string(), message: z.string() });

export const TransportOrderSnapshotSchema = z.object({
  number: z.string(),
  barcode: z.string(),
  state: TransportOrderStateSchema,
  priority: TransportOrderPrioritySchema,
  source: HistoricLocationRef,
  target: HistoricLocationRef.nullable(),
  targetGroup: z.string().nullable(),
  problem: Problem.nullable(),
  initiator: z.string().nullable(),
});

export const TransportOrderCreatedEvent = defineEvent('transport-order.created', 1, TransportOrderSnapshotSchema);
/** Gestartet; `redirectedFrom` ist gesetzt, wenn das ursprüngliche Ziel gesperrt war und umgeleitet wurde. */
export const TransportOrderStartedEvent = defineEvent(
  'transport-order.started',
  1,
  TransportOrderSnapshotSchema.extend({ redirectedFrom: HistoricLocationRef.nullable(), decisionId: z.uuid().nullable() }),
);
/** Automatischer Start nicht möglich; der Auftrag bleibt INITIALIZED, `problem` nennt den Grund. */
export const TransportOrderStartBlockedEvent = defineEvent('transport-order.start-blocked', 1, TransportOrderSnapshotSchema);
export const TransportOrderInterruptedEvent = defineEvent('transport-order.interrupted', 1, TransportOrderSnapshotSchema);
export const TransportOrderResumedEvent = defineEvent('transport-order.resumed', 1, TransportOrderSnapshotSchema);
export const TransportOrderFinishedEvent = defineEvent(
  'transport-order.finished',
  1,
  TransportOrderSnapshotSchema.extend({ to: HistoricLocationRef, deviated: z.boolean() }),
);
export const TransportOrderCanceledEvent = defineEvent(
  'transport-order.canceled',
  1,
  TransportOrderSnapshotSchema.extend({ reason: z.string().nullable(), releasedTarget: z.boolean() }),
);
export const TransportOrderFailedEvent = defineEvent(
  'transport-order.failed',
  1,
  TransportOrderSnapshotSchema.extend({ releasedTarget: z.boolean() }),
);
