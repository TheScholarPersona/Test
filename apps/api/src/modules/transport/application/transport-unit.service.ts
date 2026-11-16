import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  Quantity,
  TransportUnitCreatedEvent,
  TransportUnitDeletedEvent,
  TransportUnitMovedEvent,
  TransportUnitStackedEvent,
  TransportUnitStateChangedEvent,
  TransportUnitUnstackedEvent,
  TransportUnitUpdatedEvent,
} from '@wms/shared';
import { ConflictError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import type { WeightKg } from '../../../http/common-schemas.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { type Location, LocationLookup, LocationRemovalPolicy, type LocationType } from '../../layout/index.js';
import { checkPlacement, KG, type PlacementViolation } from '../domain/placement.js';
import { checkStacking } from '../domain/stacking.js';
import { TransportUnitStackingRule, type TransportUnitType } from '../entities/transport-unit-type.entity.js';
import { TransportUnit } from '../entities/transport-unit.entity.js';
import type {
  ChangeState,
  CreateTransportUnit,
  MoveTransportUnit,
  StackInput,
  TransportUnitQuery,
  UnstackInput,
  UpdateTransportUnit,
} from '../http/schemas.js';
import { effectiveWeight, locationRef, transportUnitSnapshot } from './mappers.js';
import { TransportUnitRemovalPolicy } from './transport-unit-removal-policy.js';
import { TransportUnitTypeService } from './transport-unit-type.service.js';

export interface PlacementOutcome {
  unit: TransportUnit;
  violations: PlacementViolation[];
}

const POPULATE = ['type', 'location', 'target', 'parent'] as const;
const BARCODE_PREFIX = 'TU';
const MAX_STACK_DEPTH = 50;

function placementRejected(violations: PlacementViolation[]): RuleViolationError {
  return new RuleViolationError('PLACEMENT_REJECTED', violations.map((v) => v.message).join('; '), { violations });
}

@Injectable()
export class TransportUnitService implements OnModuleInit {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly lookup: LocationLookup,
    private readonly types: TransportUnitTypeService,
    private readonly locationRemoval: LocationRemovalPolicy,
    private readonly unitRemoval: TransportUnitRemovalPolicy,
  ) {}

  /** Lagerplätze mit TUs dürfen nicht gelöscht werden. */
  onModuleInit(): void {
    this.locationRemoval.register('transport-units', async (location) => {
      const count = await this.em.fork().count(TransportUnit, { location: location.id });
      return count > 0 ? `${count} Transporteinheit(en) stehen auf dem Platz` : null;
    });
  }

  async list(query: TransportUnitQuery): Promise<{ items: TransportUnit[]; total: number }> {
    const where: FilterQuery<TransportUnit> = {};
    if (query.location) where.location = query.location;
    if (query.locationId) where.location = { locationId: query.locationId };
    if (query.parent) where.parent = { barcode: query.parent };
    if (query.state) where.state = query.state;
    if (query.type) where.type = { code: query.type };
    const [items, total] = await this.em.findAndCount(TransportUnit, where, {
      populate: POPULATE,
      orderBy: { barcode: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });
    return { items, total };
  }

  get(barcode: string): Promise<TransportUnit> {
    return this.load(this.em, barcode);
  }

  create(input: CreateTransportUnit): Promise<PlacementOutcome> {
    return this.em.transactional(async (tx) => {
      const type = await this.types.load(tx, input.typeCode);
      this.assertPayload(type, input.weight);
      const target = await this.lookup.resolve(tx, input.location, { lock: true });
      const barcode = input.barcode ?? (await this.nextBarcode(tx));
      if ((await tx.count(TransportUnit, { barcode })) > 0) {
        throw new ConflictError('TU_EXISTS', `Transporteinheit [${barcode}] existiert bereits`, { barcode });
      }
      const violations = await this.evaluatePlacement(tx, {
        type,
        stackWeight: KG(input.weight?.amount ?? type.tareWeightKg),
        target,
        source: null,
        excludeIds: [],
      });
      if (input.mode === 'checked' && violations.length > 0) {
        throw placementRejected(violations);
      }
      const unit = tx.create(TransportUnit, {
        id: randomUUID(),
        barcode,
        type,
        state: input.state,
        location: target,
        target: null,
        parent: null,
        weightKg: input.weight?.amount ?? null,
      });
      this.outbox.record(tx, TransportUnitCreatedEvent, { ...transportUnitSnapshot(unit), mode: input.mode, violations });
      return { unit, violations };
    });
  }

  /**
   * Bewegt eine TU samt aufgestapelter TUs. Im Modus `checked` werden alle
   * Regeln geprüft; im Modus `physical` wird immer gebucht und Verstöße werden gemeldet.
   */
  move(barcode: string, input: MoveTransportUnit): Promise<PlacementOutcome> {
    return this.em.transactional(async (tx) => {
      const unit = await this.load(tx, barcode);
      if (unit.parent) {
        throw new RuleViolationError(
          'TU_STACKED',
          `TU ${barcode} steht auf ${(unit.parent as TransportUnit).barcode}; erst abstapeln oder die Basis bewegen`,
          { barcode, parentBarcode: (unit.parent as TransportUnit).barcode },
        );
      }
      const target = await this.lookup.resolve(tx, input.to, { lock: true });
      const source = unit.location as Location;
      if (target.id === source.id) {
        return { unit, violations: [] };
      }
      const stack = await this.descendants(tx, unit);
      const violations = await this.evaluatePlacement(tx, {
        type: unit.type as TransportUnitType,
        stackWeight: [unit, ...stack].reduce((sum, u) => sum.add(effectiveWeight(u)), KG('0')),
        target,
        source,
        excludeIds: [unit.id, ...stack.map((u) => u.id)],
      });
      if (input.mode === 'checked' && violations.length > 0) {
        throw placementRejected(violations);
      }
      for (const moved of [unit, ...stack]) {
        moved.location = target;
      }
      if ((unit.target as Location | null)?.id === target.id) {
        unit.target = null;
      }
      this.outbox.record(tx, TransportUnitMovedEvent, {
        ...transportUnitSnapshot(unit),
        from: locationRef(source),
        mode: input.mode,
        violations,
        movedWith: stack.map((u) => u.barcode),
      });
      return { unit, violations };
    });
  }

  update(barcode: string, input: UpdateTransportUnit): Promise<TransportUnit> {
    return this.em.transactional(async (tx) => {
      const unit = await this.load(tx, barcode);
      if (input.weight !== undefined) {
        this.assertPayload(unit.type as TransportUnitType, input.weight);
        unit.weightKg = input.weight?.amount ?? null;
      }
      if (input.target !== undefined) {
        unit.target = input.target === null ? null : await this.lookup.resolve(tx, input.target);
      }
      this.outbox.record(tx, TransportUnitUpdatedEvent, transportUnitSnapshot(unit));
      return unit;
    });
  }

  changeState(barcode: string, input: ChangeState): Promise<TransportUnit> {
    return this.em.transactional(async (tx) => {
      const unit = await this.load(tx, barcode);
      if (unit.state !== input.state) {
        const before = unit.state;
        unit.state = input.state;
        this.outbox.record(tx, TransportUnitStateChangedEvent, {
          ...transportUnitSnapshot(unit),
          before,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        });
      }
      return unit;
    });
  }

  stack(barcode: string, input: StackInput): Promise<TransportUnit> {
    return this.em.transactional(async (tx) => {
      const child = await this.load(tx, barcode);
      const parent = await this.load(tx, input.onto);
      const childType = child.type as TransportUnitType;
      const parentType = parent.type as TransportUnitType;
      const rule = await tx.findOne(TransportUnitStackingRule, { baseType: parentType, allowedType: childType });
      const violations = checkStacking({
        child: {
          barcode: child.barcode,
          typeCode: childType.code,
          locationId: (child.location as Location).locationId,
          parentBarcode: (child.parent as TransportUnit | null)?.barcode ?? null,
        },
        parent: {
          barcode: parent.barcode,
          typeCode: parentType.code,
          locationId: (parent.location as Location).locationId,
          childCount: await tx.count(TransportUnit, { parent }),
        },
        parentAncestors: await this.ancestorBarcodes(tx, parent),
        rule: rule ? { maxCount: rule.maxCount } : null,
      });
      if (violations.length > 0) {
        throw new RuleViolationError('STACKING_REJECTED', violations.map((v) => v.message).join('; '), { violations });
      }
      child.parent = parent;
      this.outbox.record(tx, TransportUnitStackedEvent, transportUnitSnapshot(child));
      return child;
    });
  }

  /** Nimmt eine TU vom Stapel; sie belegt danach einen eigenen Platz auf demselben Lagerplatz. */
  unstack(barcode: string, input: UnstackInput): Promise<PlacementOutcome> {
    return this.em.transactional(async (tx) => {
      const unit = await this.load(tx, barcode);
      const parent = unit.parent as TransportUnit | null;
      if (!parent) {
        throw new RuleViolationError('TU_NOT_STACKED', `TU ${barcode} steht auf keiner anderen TU`, { barcode });
      }
      const location = await this.lookup.resolve(tx, { id: (unit.location as Location).id }, { lock: true });
      const occupied = await tx.count(TransportUnit, { location, parent: null, id: { $ne: unit.id } });
      const violations: PlacementViolation[] =
        occupied + 1 > location.maxTransportUnits
          ? [{ rule: 'LOCATION_FULL', message: `Platz ${location.locationId} ist voll (${occupied} von ${location.maxTransportUnits} TUs)` }]
          : [];
      if (input.mode === 'checked' && violations.length > 0) {
        throw placementRejected(violations);
      }
      unit.parent = null;
      this.outbox.record(tx, TransportUnitUnstackedEvent, { ...transportUnitSnapshot(unit), previousParentBarcode: parent.barcode });
      return { unit, violations };
    });
  }

  delete(barcode: string): Promise<void> {
    return this.em.transactional(async (tx) => {
      const unit = await this.load(tx, barcode);
      const children = await tx.count(TransportUnit, { parent: unit });
      if (children > 0) {
        throw new ConflictError('TU_HAS_CHILDREN', `Auf TU ${barcode} stehen noch ${children} TUs`, { barcode, children });
      }
      const objections = await this.unitRemoval.objections({ id: unit.id, barcode });
      if (objections.length > 0) {
        throw new ConflictError(
          'TU_IN_USE',
          `TU ${barcode} kann nicht gelöscht werden: ${objections.map((o) => o.reason).join('; ')}`,
          { barcode, objections },
        );
      }
      const locationId = (unit.location as Location).locationId;
      tx.remove(unit);
      this.outbox.record(tx, TransportUnitDeletedEvent, { barcode, locationId });
    });
  }

  // -------------------------------------------------------------------------

  private async load(em: EntityManager, barcode: string): Promise<TransportUnit> {
    const unit = await em.findOne(TransportUnit, { barcode }, { populate: POPULATE });
    if (!unit) {
      throw new NotFoundError('TU_NOT_FOUND', `Transporteinheit [${barcode}] existiert nicht`, { barcode });
    }
    return unit;
  }

  private async evaluatePlacement(
    em: EntityManager,
    args: { type: TransportUnitType; stackWeight: Quantity; target: Location; source: Location | null; excludeIds: string[] },
  ): Promise<PlacementViolation[]> {
    const rules = await this.types.rulesOf(em, args.type);
    const where: FilterQuery<TransportUnit> = { location: args.target };
    if (args.excludeIds.length > 0) where.id = { $nin: args.excludeIds };
    const onTarget = await em.find(TransportUnit, where, { populate: ['type'] });
    const targetLocks = this.lookup.locks(args.target);
    const sourceLocks = args.source ? this.lookup.locks(args.source) : null;
    return checkPlacement({
      unit: {
        typeCode: args.type.code,
        allowedLocationTypes: rules.placement.map((r) => (r.locationType as LocationType).code),
        stackWeight: args.stackWeight,
      },
      source:
        args.source && sourceLocks
          ? {
              locationId: args.source.locationId,
              outboundBlocked: sourceLocks.outbound.blocked,
              outboundBlockedBy: sourceLocks.outbound.blockedBy?.name ?? null,
            }
          : null,
      target: {
        locationId: args.target.locationId,
        typeCode: this.lookup.typeCode(args.target),
        inboundBlocked: targetLocks.inbound.blocked,
        inboundBlockedBy: targetLocks.inbound.blockedBy?.name ?? null,
        maxTransportUnits: args.target.maxTransportUnits,
        maxWeight: args.target.maxWeightKg == null ? null : KG(args.target.maxWeightKg),
        occupiedSlots: onTarget.filter((u) => !u.parent).length,
        currentWeight: onTarget.reduce((sum, u) => sum.add(effectiveWeight(u)), KG('0')),
      },
    });
  }

  /** Alle TUs, die (mittelbar) auf `unit` stehen. */
  private async descendants(em: EntityManager, unit: TransportUnit): Promise<TransportUnit[]> {
    const result: TransportUnit[] = [];
    let frontier = [unit];
    for (let depth = 0; frontier.length > 0 && depth < MAX_STACK_DEPTH; depth++) {
      frontier = await em.find(TransportUnit, { parent: { $in: frontier } }, { populate: ['type'] });
      result.push(...frontier);
    }
    return result;
  }

  /** Barcodes der TUs, auf denen `unit` (mittelbar) steht. */
  private async ancestorBarcodes(em: EntityManager, unit: TransportUnit): Promise<string[]> {
    const result: string[] = [];
    let current = unit.parent as TransportUnit | null;
    for (let depth = 0; current && depth < MAX_STACK_DEPTH; depth++) {
      const loaded: TransportUnit = await em.findOneOrFail(TransportUnit, { id: current.id }, { populate: ['parent'] });
      result.push(loaded.barcode);
      current = loaded.parent as TransportUnit | null;
    }
    return result;
  }

  /** Bruttogewicht minus Leergewicht darf die Zuladung des Typs nicht überschreiten. */
  private assertPayload(type: TransportUnitType, weight: WeightKg | null | undefined): void {
    if (!weight || type.maxPayloadKg == null) {
      return;
    }
    const payload = KG(weight.amount).subtract(KG(type.tareWeightKg));
    if (payload.compareTo(KG(type.maxPayloadKg)) > 0) {
      throw new RuleViolationError(
        'TU_OVERWEIGHT',
        `Zuladung ${payload.amount} KG überschreitet die zulässige Zuladung von ${KG(type.maxPayloadKg).amount} KG für TU-Typ ${type.code}`,
        { weight: weight.amount, maxPayload: KG(type.maxPayloadKg).amount },
      );
    }
  }

  private async nextBarcode(em: EntityManager): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const [row] = await em.execute<{ n: string }[]>(`select nextval('transport_unit_barcode_seq') as n`);
      const barcode = `${BARCODE_PREFIX}${String(row!.n).padStart(10, '0')}`;
      if ((await em.count(TransportUnit, { barcode })) === 0) {
        return barcode;
      }
    }
    throw new ConflictError('BARCODE_GENERATION_FAILED', 'Es konnte kein freier Barcode erzeugt werden');
  }
}
