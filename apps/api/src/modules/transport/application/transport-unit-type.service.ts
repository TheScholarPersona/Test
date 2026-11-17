import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { TransportUnitTypeCreatedEvent, TransportUnitTypeDeletedEvent, TransportUnitTypeUpdatedEvent } from '@wms/shared';
import { ConflictError, NotFoundError } from '../../../common/domain-error.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { LocationType } from '../../layout/index.js';
import { TransportUnitPlacementRule, TransportUnitStackingRule, TransportUnitType } from '../entities/transport-unit-type.entity.js';
import { TransportUnit } from '../entities/transport-unit.entity.js';
import type { CreateTransportUnitType, PlacementRulesInput, StackingRulesInput, UpdateTransportUnitType } from '../http/schemas.js';
import { transportUnitTypeSnapshot, type TypeRules } from './mappers.js';

export interface TypeWithRules {
  type: TransportUnitType;
  rules: TypeRules;
}

@Injectable()
export class TransportUnitTypeService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
  ) {}

  async list(): Promise<TypeWithRules[]> {
    const types = await this.em.find(TransportUnitType, {}, { orderBy: { code: 'asc' } });
    return Promise.all(types.map(async (type) => ({ type, rules: await this.rulesOf(this.em, type) })));
  }

  async get(code: string): Promise<TypeWithRules> {
    const type = await this.load(this.em, code);
    return { type, rules: await this.rulesOf(this.em, type) };
  }

  create(input: CreateTransportUnitType): Promise<TypeWithRules> {
    return this.em.transactional(async (tx) => {
      if ((await tx.count(TransportUnitType, { code: input.code })) > 0) {
        throw new ConflictError('TU_TYPE_EXISTS', `TU-Typ [${input.code}] existiert bereits`, { code: input.code });
      }
      const type = tx.create(TransportUnitType, {
        id: randomUUID(),
        code: input.code,
        description: input.description,
        lengthMm: input.lengthMm,
        widthMm: input.widthMm,
        heightMm: input.heightMm,
        tareWeightKg: input.tareWeight?.amount ?? null,
        maxPayloadKg: input.maxPayload?.amount ?? null,
      });
      const rules: TypeRules = { placement: [], stacking: [] };
      this.outbox.record(tx, TransportUnitTypeCreatedEvent, transportUnitTypeSnapshot(type, rules));
      return { type, rules };
    });
  }

  update(code: string, input: UpdateTransportUnitType): Promise<TypeWithRules> {
    return this.em.transactional(async (tx) => {
      const type = await this.load(tx, code);
      if (input.description !== undefined) type.description = input.description;
      if (input.lengthMm !== undefined) type.lengthMm = input.lengthMm;
      if (input.widthMm !== undefined) type.widthMm = input.widthMm;
      if (input.heightMm !== undefined) type.heightMm = input.heightMm;
      if (input.tareWeight !== undefined) type.tareWeightKg = input.tareWeight?.amount ?? null;
      if (input.maxPayload !== undefined) type.maxPayloadKg = input.maxPayload?.amount ?? null;
      return this.publishUpdated(tx, type);
    });
  }

  /** Ersetzt alle Platzierungsregeln des Typs. */
  replacePlacementRules(code: string, input: PlacementRulesInput): Promise<TypeWithRules> {
    return this.em.transactional(async (tx) => {
      const type = await this.load(tx, code);
      const locationTypes = await tx.find(LocationType, { code: { $in: input.map((r) => r.locationTypeCode) } });
      const byCode = new Map(locationTypes.map((t) => [t.code, t]));
      const missing = input.map((r) => r.locationTypeCode).filter((c) => !byCode.has(c));
      if (missing.length > 0) {
        throw new NotFoundError('LOCATION_TYPE_NOT_FOUND', `Platztyp(en) existieren nicht: ${missing.join(', ')}`, { codes: missing });
      }
      await tx.nativeDelete(TransportUnitPlacementRule, { unitType: type });
      for (const rule of input) {
        tx.create(TransportUnitPlacementRule, {
          id: randomUUID(),
          unitType: type,
          locationType: byCode.get(rule.locationTypeCode)!,
          privilegeLevel: rule.privilegeLevel,
        });
      }
      type.updatedAt = new Date();
      return this.publishUpdated(tx, type);
    });
  }

  /** Ersetzt alle Stapelregeln mit diesem Typ als Basis. */
  replaceStackingRules(code: string, input: StackingRulesInput): Promise<TypeWithRules> {
    return this.em.transactional(async (tx) => {
      const type = await this.load(tx, code);
      const allowed = await tx.find(TransportUnitType, { code: { $in: input.map((r) => r.allowedTypeCode) } });
      const byCode = new Map(allowed.map((t) => [t.code, t]));
      const missing = input.map((r) => r.allowedTypeCode).filter((c) => !byCode.has(c));
      if (missing.length > 0) {
        throw new NotFoundError('TU_TYPE_NOT_FOUND', `TU-Typ(en) existieren nicht: ${missing.join(', ')}`, { codes: missing });
      }
      await tx.nativeDelete(TransportUnitStackingRule, { baseType: type });
      for (const rule of input) {
        tx.create(TransportUnitStackingRule, { id: randomUUID(), baseType: type, allowedType: byCode.get(rule.allowedTypeCode)!, maxCount: rule.maxCount });
      }
      type.updatedAt = new Date();
      return this.publishUpdated(tx, type);
    });
  }

  delete(code: string): Promise<void> {
    return this.em.transactional(async (tx) => {
      const type = await this.load(tx, code);
      const units = await tx.count(TransportUnit, { type });
      const usedInStacking = await tx.count(TransportUnitStackingRule, { allowedType: type, baseType: { $ne: type } });
      if (units > 0 || usedInStacking > 0) {
        throw new ConflictError(
          'TU_TYPE_IN_USE',
          `TU-Typ [${code}] wird noch verwendet (${units} TUs, ${usedInStacking} Stapelregeln anderer Typen)`,
          { code, transportUnits: units, stackingRules: usedInStacking },
        );
      }
      await tx.nativeDelete(TransportUnitStackingRule, { allowedType: type });
      tx.remove(type);
      this.outbox.record(tx, TransportUnitTypeDeletedEvent, { code });
    });
  }

  /** Platzierungs- und Stapelregeln eines Typs (für Prüfungen und Antworten). */
  async rulesOf(em: EntityManager, type: TransportUnitType): Promise<TypeRules> {
    const [placement, stacking] = await Promise.all([
      em.find(TransportUnitPlacementRule, { unitType: type }, { populate: ['locationType'] }),
      em.find(TransportUnitStackingRule, { baseType: type }, { populate: ['allowedType'] }),
    ]);
    return { placement, stacking };
  }

  async load(em: EntityManager, code: string): Promise<TransportUnitType> {
    const type = await em.findOne(TransportUnitType, { code });
    if (!type) {
      throw new NotFoundError('TU_TYPE_NOT_FOUND', `TU-Typ [${code}] existiert nicht`, { code });
    }
    return type;
  }

  private async publishUpdated(tx: EntityManager, type: TransportUnitType): Promise<TypeWithRules> {
    await tx.flush();
    const rules = await this.rulesOf(tx, type);
    this.outbox.record(tx, TransportUnitTypeUpdatedEvent, transportUnitTypeSnapshot(type, rules));
    return { type, rules };
  }
}
