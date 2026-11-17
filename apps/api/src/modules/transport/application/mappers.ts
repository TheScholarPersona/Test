import type { TransportUnitSnapshotSchema, TransportUnitTypeSnapshotSchema } from '@wms/shared';
import type { z } from 'zod';
import { normalizeDecimal, timestampsOf, toWeightKg } from '../../../http/common-schemas.js';
import type { Location, LocationType } from '../../layout/index.js';
import { KG } from '../domain/placement.js';
import type { TransportUnitPlacementRule, TransportUnitStackingRule, TransportUnitType } from '../entities/transport-unit-type.entity.js';
import type { TransportUnit } from '../entities/transport-unit.entity.js';
import type { TransportUnitDto, TransportUnitTypeDto } from '../http/schemas.js';

export interface TypeRules {
  placement: TransportUnitPlacementRule[];
  stacking: TransportUnitStackingRule[];
}

const placementDto = (rules: TransportUnitPlacementRule[]) =>
  rules
    .map((r) => ({ locationTypeCode: (r.locationType as LocationType).code, privilegeLevel: r.privilegeLevel }))
    .sort((a, b) => a.locationTypeCode.localeCompare(b.locationTypeCode));

const stackingDto = (rules: TransportUnitStackingRule[]) =>
  rules
    .map((r) => ({ allowedTypeCode: (r.allowedType as TransportUnitType).code, maxCount: r.maxCount }))
    .sort((a, b) => a.allowedTypeCode.localeCompare(b.allowedTypeCode));

export function toTransportUnitTypeDto(type: TransportUnitType, rules: TypeRules): TransportUnitTypeDto {
  return {
    code: type.code,
    description: type.description,
    lengthMm: type.lengthMm ?? null,
    widthMm: type.widthMm ?? null,
    heightMm: type.heightMm ?? null,
    tareWeight: toWeightKg(type.tareWeightKg),
    maxPayload: toWeightKg(type.maxPayloadKg),
    placementRules: placementDto(rules.placement),
    stackingRules: stackingDto(rules.stacking),
    ...timestampsOf(type),
  };
}

export function transportUnitTypeSnapshot(type: TransportUnitType, rules: TypeRules): z.infer<typeof TransportUnitTypeSnapshotSchema> {
  return {
    code: type.code,
    description: type.description,
    tareWeightKg: type.tareWeightKg == null ? null : normalizeDecimal(type.tareWeightKg),
    maxPayloadKg: type.maxPayloadKg == null ? null : normalizeDecimal(type.maxPayloadKg),
    placementRules: placementDto(rules.placement),
    stackingRules: stackingDto(rules.stacking),
  };
}

/** Gemessenes Gewicht oder Leergewicht des Typs (Typ muss geladen sein). */
export function effectiveWeight(unit: TransportUnit): ReturnType<typeof KG> {
  return KG(unit.weightKg ?? (unit.type as TransportUnitType).tareWeightKg ?? '0');
}

const locationRef = (location: Location) => ({ id: location.id, locationId: location.locationId, erpCode: location.erpCode ?? null });

export function toTransportUnitDto(unit: TransportUnit): TransportUnitDto {
  const target = unit.target as Location | null;
  return {
    barcode: unit.barcode,
    typeCode: (unit.type as TransportUnitType).code,
    state: unit.state,
    location: locationRef(unit.location as Location),
    target: target ? locationRef(target) : null,
    parentBarcode: (unit.parent as TransportUnit | null)?.barcode ?? null,
    weight: toWeightKg(unit.weightKg),
    effectiveWeight: { amount: effectiveWeight(unit).amount, unit: 'KG' },
    ...timestampsOf(unit),
  };
}

export function transportUnitSnapshot(unit: TransportUnit): z.infer<typeof TransportUnitSnapshotSchema> {
  const target = unit.target as Location | null;
  return {
    barcode: unit.barcode,
    typeCode: (unit.type as TransportUnitType).code,
    state: unit.state,
    location: locationRef(unit.location as Location),
    target: target ? locationRef(target) : null,
    parentBarcode: (unit.parent as TransportUnit | null)?.barcode ?? null,
    weightKg: unit.weightKg == null ? null : normalizeDecimal(unit.weightKg),
  };
}

export { locationRef };
