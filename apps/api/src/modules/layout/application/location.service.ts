import { randomUUID } from 'node:crypto';
import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { LocationCreatedEvent, LocationDeletedEvent, LocationLockChangedEvent, LocationUpdatedEvent } from '@wms/shared';
import { ConflictError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { applyLockChanges, type LockChange } from '../domain/lock-changes.js';
import { LocationType } from '../entities/location-type.entity.js';
import { Location } from '../entities/location.entity.js';
import type { ChangeLocationLocks, CreateLocation, LocationQuery, UpdateLocation } from '../http/schemas.js';
import { GroupHierarchy } from './group-hierarchy.js';
import { LocationRemovalPolicy } from './location-removal-policy.js';
import { locationSnapshot } from './mappers.js';

@Injectable()
export class LocationService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly removalPolicy: LocationRemovalPolicy,
  ) {}

  async list(query: LocationQuery): Promise<{ items: Location[]; total: number }> {
    const hierarchy = await GroupHierarchy.load(this.em);
    const where: FilterQuery<Location> = {};
    if (query.locationId) where.locationId = query.locationId;
    if (query.erpCode) where.erpCode = query.erpCode;
    if (query.plcCode) where.plcCode = query.plcCode;
    if (query.group) {
      where.group = query.includeSubgroups ? { $in: hierarchy.subtree(query.group) } : hierarchy.get(query.group);
    }
    const [items, total] = await this.em.findAndCount(Location, where, {
      populate: ['type'],
      orderBy: { sortOrder: 'asc', locationId: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });
    return { items, total };
  }

  async get(id: string): Promise<Location> {
    await GroupHierarchy.load(this.em);
    return this.load(this.em, id);
  }

  create(input: CreateLocation): Promise<Location> {
    return this.em.transactional(async (tx) => {
      const hierarchy = await GroupHierarchy.load(tx);
      const group = hierarchy.get(input.groupName);
      const type = await tx.findOne(LocationType, { code: input.typeCode });
      if (!type) {
        throw new NotFoundError('LOCATION_TYPE_NOT_FOUND', `Lagerplatztyp [${input.typeCode}] existiert nicht`, { code: input.typeCode });
      }
      if ((await tx.count(Location, { locationId: input.locationId })) > 0) {
        throw new ConflictError('LOCATION_EXISTS', `Lagerplatz [${input.locationId}] existiert bereits`, { locationId: input.locationId });
      }
      await this.assertCodesFree(tx, input.erpCode, input.plcCode);
      const location = tx.create(Location, {
        id: randomUUID(),
        locationId: input.locationId,
        erpCode: input.erpCode,
        plcCode: input.plcCode,
        description: input.description,
        sortOrder: input.sortOrder,
        type,
        group,
        maxTransportUnits: input.maxTransportUnits,
        maxWeightKg: input.maxWeight?.amount ?? null,
      });
      this.outbox.record(tx, LocationCreatedEvent, locationSnapshot(location));
      return location;
    });
  }

  update(id: string, input: UpdateLocation): Promise<Location> {
    return this.em.transactional(async (tx) => {
      const hierarchy = await GroupHierarchy.load(tx);
      const location = await this.load(tx, id);
      if (input.locationId !== undefined && input.locationId !== location.locationId) {
        throw new RuleViolationError('LOCATION_ID_IMMUTABLE', 'Die Koordinate eines Lagerplatzes kann nicht geändert werden', {
          current: location.locationId,
          requested: input.locationId,
        });
      }
      const currentType = (location.type as LocationType).code;
      if (input.typeCode !== undefined && input.typeCode !== currentType) {
        throw new RuleViolationError('LOCATION_TYPE_IMMUTABLE', 'Der Typ eines Lagerplatzes kann nicht geändert werden', {
          current: currentType,
          requested: input.typeCode,
        });
      }
      await this.assertCodesFree(
        tx,
        input.erpCode !== undefined && input.erpCode !== location.erpCode ? input.erpCode : null,
        input.plcCode !== undefined && input.plcCode !== location.plcCode ? input.plcCode : null,
      );
      if (input.groupName !== undefined) location.group = hierarchy.get(input.groupName);
      if (input.erpCode !== undefined) location.erpCode = input.erpCode;
      if (input.plcCode !== undefined) location.plcCode = input.plcCode;
      if (input.description !== undefined) location.description = input.description;
      if (input.sortOrder !== undefined) location.sortOrder = input.sortOrder;
      if (input.maxTransportUnits !== undefined) location.maxTransportUnits = input.maxTransportUnits;
      if (input.maxWeight !== undefined) location.maxWeightKg = input.maxWeight?.amount ?? null;
      this.outbox.record(tx, LocationUpdatedEvent, locationSnapshot(location));
      return location;
    });
  }

  changeLocks(id: string, input: ChangeLocationLocks): Promise<Location> {
    return this.em.transactional((tx) => this.changeLocksIn(tx, id, input));
  }

  /** Wie `changeLocks`, aber innerhalb einer bestehenden Transaktion (z. B. Platzmeldung einer Anlage). */
  async changeLocksIn(tx: EntityManager, id: string, input: ChangeLocationLocks): Promise<Location> {
    {
      await GroupHierarchy.load(tx);
      const location = await this.load(tx, id);
      const change: LockChange & { allocation?: { before: boolean; after: boolean } } =
        applyLockChanges(location, location.lockChain(), input) ?? {};
      if (input.allocation !== undefined && input.allocation !== location.allocationBlocked) {
        change.allocation = { before: location.allocationBlocked, after: input.allocation };
        location.allocationBlocked = input.allocation;
      }
      if (Object.keys(change).length > 0) {
        this.outbox.record(tx, LocationLockChangedEvent, {
          ...locationSnapshot(location),
          change: input.reason === undefined ? change : { ...change, reason: input.reason },
        });
      }
      return location;
    }
  }

  /** Löschen nur, wenn kein anderes Modul widerspricht (z. B. Transporteinheit auf dem Platz). */
  delete(id: string): Promise<void> {
    return this.em.transactional(async (tx) => {
      await GroupHierarchy.load(tx);
      const location = await this.load(tx, id);
      const objections = await this.removalPolicy.objections({ id: location.id, locationId: location.locationId });
      if (objections.length > 0) {
        throw new ConflictError(
          'LOCATION_IN_USE',
          `Lagerplatz [${location.locationId}] kann nicht gelöscht werden: ${objections.map((o) => o.reason).join('; ')}`,
          { locationId: location.locationId, objections },
        );
      }
      tx.remove(location);
      this.outbox.record(tx, LocationDeletedEvent, { id: location.id, locationId: location.locationId });
    });
  }

  private async load(em: EntityManager, id: string): Promise<Location> {
    const location = await em.findOne(Location, { id }, { populate: ['type'] });
    if (!location) {
      throw new NotFoundError('LOCATION_NOT_FOUND', `Lagerplatz [${id}] existiert nicht`, { id });
    }
    return location;
  }

  private async assertCodesFree(em: EntityManager, erpCode: string | null, plcCode: string | null): Promise<void> {
    if (erpCode !== null && (await em.count(Location, { erpCode })) > 0) {
      throw new ConflictError('ERP_CODE_IN_USE', `ERP-Code [${erpCode}] ist bereits einem anderen Lagerplatz zugeordnet`, { erpCode });
    }
    if (plcCode !== null && (await em.count(Location, { plcCode })) > 0) {
      throw new ConflictError('PLC_CODE_IN_USE', `SPS-Code [${plcCode}] ist bereits einem anderen Lagerplatz zugeordnet`, { plcCode });
    }
  }
}
