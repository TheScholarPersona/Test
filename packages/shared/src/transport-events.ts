import { z } from 'zod';
import { defineEvent } from './events.js';
import { TransportUnitStateSchema } from './identifiers.js';

/** Events der Transporteinheiten (TU) und ihrer Typen. */

const LocationRefSnapshotSchema = z.object({
  id: z.uuid(),
  locationId: z.string(),
  erpCode: z.string().nullable(),
});

/** Verletzte Regel bei einer Platzierung, z. B. LOCATION_FULL. */
export const PlacementViolationSchema = z.object({
  rule: z.string(),
  message: z.string(),
});

export const TransportUnitSnapshotSchema = z.object({
  barcode: z.string(),
  typeCode: z.string(),
  state: TransportUnitStateSchema,
  location: LocationRefSnapshotSchema,
  target: LocationRefSnapshotSchema.nullable(),
  parentBarcode: z.string().nullable(),
  weightKg: z.string().nullable(),
});

export const TransportUnitTypeSnapshotSchema = z.object({
  code: z.string(),
  description: z.string(),
  tareWeightKg: z.string().nullable(),
  maxPayloadKg: z.string().nullable(),
  placementRules: z.array(z.object({ locationTypeCode: z.string(), privilegeLevel: z.number().int() })),
  stackingRules: z.array(z.object({ allowedTypeCode: z.string(), maxCount: z.number().int() })),
});

export const TransportUnitTypeCreatedEvent = defineEvent('transport-unit-type.created', 1, TransportUnitTypeSnapshotSchema);
export const TransportUnitTypeUpdatedEvent = defineEvent('transport-unit-type.updated', 1, TransportUnitTypeSnapshotSchema);
export const TransportUnitTypeDeletedEvent = defineEvent('transport-unit-type.deleted', 1, z.object({ code: z.string() }));

export const TransportUnitCreatedEvent = defineEvent(
  'transport-unit.created',
  1,
  TransportUnitSnapshotSchema.extend({ mode: z.enum(['checked', 'physical']), violations: z.array(PlacementViolationSchema) }),
);
/**
 * TU wurde bewegt. Bei `mode: physical` (gemeldete Ist-Position) enthält
 * `violations` die Regeln, gegen die die Buchung verstößt; die Buchung
 * selbst wurde trotzdem ausgeführt.
 */
export const TransportUnitMovedEvent = defineEvent(
  'transport-unit.moved',
  1,
  TransportUnitSnapshotSchema.extend({
    from: LocationRefSnapshotSchema,
    mode: z.enum(['checked', 'physical']),
    violations: z.array(PlacementViolationSchema),
    movedWith: z.array(z.string()),
  }),
);
export const TransportUnitStateChangedEvent = defineEvent(
  'transport-unit.state-changed',
  1,
  TransportUnitSnapshotSchema.extend({ before: TransportUnitStateSchema, reason: z.string().optional() }),
);
export const TransportUnitUpdatedEvent = defineEvent('transport-unit.updated', 1, TransportUnitSnapshotSchema);
export const TransportUnitStackedEvent = defineEvent('transport-unit.stacked', 1, TransportUnitSnapshotSchema);
export const TransportUnitUnstackedEvent = defineEvent(
  'transport-unit.unstacked',
  1,
  TransportUnitSnapshotSchema.extend({ previousParentBarcode: z.string() }),
);
export const TransportUnitDeletedEvent = defineEvent('transport-unit.deleted', 1, z.object({ barcode: z.string(), locationId: z.string() }));
