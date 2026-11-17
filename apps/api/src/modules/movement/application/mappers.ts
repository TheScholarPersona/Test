import type { MovementSnapshotSchema } from '@wms/shared';
import type { z } from 'zod';
import type { Location } from '../../layout/index.js';
import { allowedActions } from '../domain/movement-state.js';
import type { Movement } from '../entities/movement.entity.js';
import type { MovementDto } from '../http/schemas.js';

const place = (location: Location | null | undefined, coordinate: string) => ({ id: location?.id ?? null, locationId: coordinate });

const ref = (location: Location | null | undefined) =>
  location ? { id: location.id, locationId: location.locationId, erpCode: location.erpCode ?? null } : null;

export function toMovementDto(m: Movement): MovementDto {
  const target = m.target as Location | null;
  return {
    number: m.number,
    barcode: m.barcode,
    type: m.type,
    state: m.state,
    priority: m.priority,
    source: place(m.source as Location | null, m.sourceCoordinate),
    target: m.targetCoordinate == null ? null : place(target, m.targetCoordinate),
    targetGroup: m.targetGroup ?? null,
    decisionId: m.decisionId ?? null,
    initiator: m.initiator ?? null,
    assignedTo: m.assignedTo ?? null,
    dueAt: m.dueAt?.toISOString() ?? null,
    startedAt: m.startedAt?.toISOString() ?? null,
    completed:
      m.completedAt && m.completedCoordinate
        ? { at: m.completedAt.toISOString(), location: place(m.completedLocation as Location | null, m.completedCoordinate), deviated: m.deviated }
        : null,
    cancelled: m.cancelledAt ? { at: m.cancelledAt.toISOString(), reason: m.cancelReason ?? null } : null,
    allowedActions: allowedActions(m.state),
    version: m.version,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

const historic = (location: Location | null | undefined, coordinate: string) =>
  ref(location) ?? { id: null, locationId: coordinate, erpCode: null };

/** Payload für Events. */
export function movementSnapshot(m: Movement): z.infer<typeof MovementSnapshotSchema> {
  return {
    number: m.number,
    barcode: m.barcode,
    type: m.type,
    state: m.state,
    priority: m.priority,
    source: historic(m.source as Location | null, m.sourceCoordinate),
    target: m.targetCoordinate == null ? null : historic(m.target as Location | null, m.targetCoordinate),
    targetGroup: m.targetGroup ?? null,
    assignedTo: m.assignedTo ?? null,
    initiator: m.initiator ?? null,
  };
}
