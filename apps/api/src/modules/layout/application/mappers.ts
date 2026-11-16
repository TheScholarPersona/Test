import type { z } from 'zod';
import type { LocationGroupSnapshotSchema, LocationSnapshotSchema, LocationTypeSnapshotSchema } from '@wms/shared';
import { effectiveLock } from '../domain/lock-state.js';
import type { LocationGroup } from '../entities/location-group.entity.js';
import type { LocationType } from '../entities/location-type.entity.js';
import type { Location } from '../entities/location.entity.js';
import type { LocationDto, LocationGroupDto, LocationTypeDto } from '../http/schemas.js';

const timestamps = (entity: { version: number; createdAt: Date; updatedAt: Date }) => ({
  version: entity.version,
  createdAt: entity.createdAt.toISOString(),
  updatedAt: entity.updatedAt.toISOString(),
});

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
      maxWeight: location.maxWeightKg == null ? null : { amount: normalizeDecimal(location.maxWeightKg), unit: 'KG' },
    },
    locks: {
      inbound: effectiveLock(chain, 'inbound'),
      outbound: effectiveLock(chain, 'outbound'),
      allocation: { blocked: location.allocationBlocked },
    },
    ...timestamps(location),
  };
}

/** PostgreSQL liefert NUMERIC mit fester Nachkommazahl ("1250.500"); ohne überflüssige Nullen zurückgeben. */
function normalizeDecimal(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
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
