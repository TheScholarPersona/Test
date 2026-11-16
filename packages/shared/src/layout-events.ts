import { z } from 'zod';
import { defineEvent } from './events.js';

/**
 * Events der Lagerstruktur. Payloads enthalten den Zustand nach der Änderung
 * und die eigenen Sperren; wirksame (geerbte) Sperren ergeben sich aus der
 * Gruppenhierarchie und werden über die API abgefragt.
 */

export const LocationTypeSnapshotSchema = z.object({
  code: z.string(),
  description: z.string(),
  lengthMm: z.number().int().nullable(),
  widthMm: z.number().int().nullable(),
  heightMm: z.number().int().nullable(),
});

export const LocationGroupSnapshotSchema = z.object({
  name: z.string(),
  description: z.string(),
  groupType: z.string().nullable(),
  parentName: z.string().nullable(),
  inboundBlocked: z.boolean(),
  outboundBlocked: z.boolean(),
});

export const LocationSnapshotSchema = z.object({
  id: z.uuid(),
  locationId: z.string(),
  erpCode: z.string().nullable(),
  plcCode: z.string().nullable(),
  typeCode: z.string(),
  groupName: z.string(),
  inboundBlocked: z.boolean(),
  outboundBlocked: z.boolean(),
  allocationBlocked: z.boolean(),
});

const LockChangeSchema = z.object({
  inbound: z.object({ before: z.boolean(), after: z.boolean() }).optional(),
  outbound: z.object({ before: z.boolean(), after: z.boolean() }).optional(),
  allocation: z.object({ before: z.boolean(), after: z.boolean() }).optional(),
  reason: z.string().optional(),
});

export const LocationTypeCreatedEvent = defineEvent('location-type.created', 1, LocationTypeSnapshotSchema);
export const LocationTypeUpdatedEvent = defineEvent('location-type.updated', 1, LocationTypeSnapshotSchema);
export const LocationTypeDeletedEvent = defineEvent('location-type.deleted', 1, z.object({ code: z.string() }));

export const LocationGroupCreatedEvent = defineEvent('location-group.created', 1, LocationGroupSnapshotSchema);
export const LocationGroupUpdatedEvent = defineEvent('location-group.updated', 1, LocationGroupSnapshotSchema);
export const LocationGroupDeletedEvent = defineEvent('location-group.deleted', 1, z.object({ name: z.string() }));
/** Sperre einer Gruppe geändert; betrifft auch alle untergeordneten Gruppen und Plätze. */
export const LocationGroupLockChangedEvent = defineEvent(
  'location-group.lock-changed',
  1,
  LocationGroupSnapshotSchema.extend({ change: LockChangeSchema }),
);

export const LocationCreatedEvent = defineEvent('location.created', 1, LocationSnapshotSchema);
export const LocationUpdatedEvent = defineEvent('location.updated', 1, LocationSnapshotSchema);
export const LocationDeletedEvent = defineEvent('location.deleted', 1, z.object({ id: z.uuid(), locationId: z.string() }));
export const LocationLockChangedEvent = defineEvent(
  'location.lock-changed',
  1,
  LocationSnapshotSchema.extend({ change: LockChangeSchema }),
);
