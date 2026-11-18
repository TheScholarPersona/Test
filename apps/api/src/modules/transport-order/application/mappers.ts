import type { TransportOrderSnapshotSchema } from '@wms/shared';
import type { z } from 'zod';
import type { Location } from '../../layout/index.js';
import { allowedActions } from '../domain/transport-order-state.js';
import type { TransportOrder } from '../entities/transport-order.entity.js';
import type { TransportOrderDto } from '../http/schemas.js';

const place = (location: Location | null | undefined, coordinate: string) => ({ id: location?.id ?? null, locationId: coordinate });
const historic = (location: Location | null | undefined, coordinate: string) =>
  location ? { id: location.id, locationId: location.locationId, erpCode: location.erpCode ?? null } : { id: null, locationId: coordinate, erpCode: null };

export function toTransportOrderDto(o: TransportOrder): TransportOrderDto {
  return {
    number: o.number,
    barcode: o.barcode,
    state: o.state,
    priority: o.priority,
    source: place(o.source as Location | null, o.sourceCoordinate),
    target: o.targetCoordinate == null ? null : place(o.target as Location | null, o.targetCoordinate),
    targetGroup: o.targetGroup ?? null,
    redirect: o.redirect,
    decisionId: o.decisionId ?? null,
    initiator: o.initiator ?? null,
    problem: o.problemCode && o.problemAt ? { code: o.problemCode, message: o.problemMessage ?? '', at: o.problemAt.toISOString() } : null,
    problems: o.problems ?? [],
    startedAt: o.startedAt?.toISOString() ?? null,
    finished: o.finishedAt && o.finishedCoordinate ? { at: o.finishedAt.toISOString(), locationId: o.finishedCoordinate, deviated: o.deviated } : null,
    ended: o.endedAt ? { at: o.endedAt.toISOString(), reason: o.endReason ?? null } : null,
    allowedActions: allowedActions(o.state),
    version: o.version,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function transportOrderSnapshot(o: TransportOrder): z.infer<typeof TransportOrderSnapshotSchema> {
  return {
    number: o.number,
    barcode: o.barcode,
    state: o.state,
    priority: o.priority,
    source: historic(o.source as Location | null, o.sourceCoordinate),
    target: o.targetCoordinate == null ? null : historic(o.target as Location | null, o.targetCoordinate),
    targetGroup: o.targetGroup ?? null,
    problem: o.problemCode ? { code: o.problemCode, message: o.problemMessage ?? '' } : null,
    initiator: o.initiator ?? null,
  };
}

export const historicRef = historic;
