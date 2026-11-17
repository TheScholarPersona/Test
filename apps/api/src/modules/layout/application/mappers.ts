import type { z } from 'zod';
import type { LocationGroupSnapshotSchema, LocationSnapshotSchema, LocationTypeSnapshotSchema } from '@wms/shared';
import { timestampsOf as timestamps, toWeightKg } from '../../../http/common-schemas.js';
import { effectiveLock } from '../domain/lock-state.js';
import type { LocationGroup } from '../entities/location-group.entity.js';
import type { LocationType } from '../entities/location-type.entity.js';
import type { Location } from '../entities/location.entity.js';
import type { LocationDto, LocationGroupDto, LocationTypeDto } from '../http/schemas.js';

export function toLocationTypeDto(type: LocationType): LocationTypeDto {
  return {
    code: type.code,
    description: type.description,
    lengthMm: type.lengthMm ?? null,
    widthMm: type.widthMm ?? null,
    heightMm: type.heightMm ?? null,
    ...timestamps(type),
  };
}

export function toLocationGroupDto(group: LocationGroup): LocationGroupDto {
  const chain = group.lockChain();
  return {
    name: group.name,
    description: group.description,
    groupType: group.groupType ?? null,
    parentName: (group.parent as LocationGroup | null)?.name ?? null,
    locks: { inbound: effectiveLock(chain, 'inbound'), outbound: effectiveLock(chain, 'outbound') },
    ...timestamps(group),
  };
}

export function toLocationDto(location: Location): LocationDto {
  const chain = location.lockChain();
  return {
    id: location.id,
    locationId: location.locationId,
    erpCode: location.erpCode ?? null,
    plcCode: location.plcCode ?? null,
    description: location.description,
    sortOrder: location.sortOrder,
    typeCode: (location.type as LocationType).code,
    groupName: (location.group as LocationGroup).name,
    capacity: {
      maxTransportUnits: location.maxTransportUnits,
      maxWeight: toWeightKg(location.maxWeightKg),
    },
    locks: {
      inbound: effectiveLock(chain, 'inbound'),
      outbound: effectiveLock(chain, 'outbound'),
      allocation: { blocked: location.allocationBlocked },
    },
    plc: { state: location.plcState, text: location.plcStateText ?? null, changedAt: location.plcStateAt?.toISOString() ?? null },
    ...timestamps(location),
  };
}

// --- Event-Payloads --------------------------------------------------------

export function locationTypeSnapshot(type: LocationType): z.infer<typeof LocationTypeSnapshotSchema> {
  return {
    code: type.code,
    description: type.description,
    lengthMm: type.lengthMm ?? null,
    widthMm: type.widthMm ?? null,
    heightMm: type.heightMm ?? null,
  };
}

export function locationGroupSnapshot(group: LocationGroup): z.infer<typeof LocationGroupSnapshotSchema> {
  return {
    name: group.name,
    description: group.description,
    groupType: group.groupType ?? null,
    parentName: (group.parent as LocationGroup | null)?.name ?? null,
    inboundBlocked: group.inboundBlocked,
    outboundBlocked: group.outboundBlocked,
  };
}

export function locationSnapshot(location: Location): z.infer<typeof LocationSnapshotSchema> {
  return {
    id: location.id,
    locationId: location.locationId,
    erpCode: location.erpCode ?? null,
    plcCode: location.plcCode ?? null,
    typeCode: (location.type as LocationType).code,
    groupName: (location.group as LocationGroup).name,
    inboundBlocked: location.inboundBlocked,
    outboundBlocked: location.outboundBlocked,
    allocationBlocked: location.allocationBlocked,
  };
}
