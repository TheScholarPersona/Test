import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import {
  LocationGroupCreatedEvent,
  LocationGroupDeletedEvent,
  LocationGroupLockChangedEvent,
  LocationGroupUpdatedEvent,
} from '@wms/shared';
import { definedOnly } from '../../../common/defined.js';
import { ConflictError } from '../../../common/domain-error.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { applyLockChanges } from '../domain/lock-changes.js';
import { LocationGroup } from '../entities/location-group.entity.js';
import { Location } from '../entities/location.entity.js';
import type { ChangeGroupLocks, CreateLocationGroup, UpdateLocationGroup } from '../http/schemas.js';
import { GroupHierarchy } from './group-hierarchy.js';
import { locationGroupSnapshot } from './mappers.js';

@Injectable()
export class LocationGroupService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
  ) {}

  async list(): Promise<LocationGroup[]> {
    return (await GroupHierarchy.load(this.em)).all();
  }

  async get(name: string): Promise<LocationGroup> {
    return (await GroupHierarchy.load(this.em)).get(name);
  }

  create(input: CreateLocationGroup): Promise<LocationGroup> {
    return this.em.transactional(async (tx) => {
      const hierarchy = await GroupHierarchy.load(tx);
      if (hierarchy.find(input.name)) {
        throw new ConflictError('LOCATION_GROUP_EXISTS', `Lagerplatzgruppe [${input.name}] existiert bereits`, { name: input.name });
      }
      const parent = input.parentName === null ? null : hierarchy.get(input.parentName);
      const group = tx.create(LocationGroup, {
        id: randomUUID(),
        name: input.name,
        description: input.description,
        groupType: input.groupType,
        parent,
      });
      this.outbox.record(tx, LocationGroupCreatedEvent, locationGroupSnapshot(group));
      return group;
    });
  }

  update(name: string, input: UpdateLocationGroup): Promise<LocationGroup> {
    return this.em.transactional(async (tx) => {
      const group = (await GroupHierarchy.load(tx)).get(name);
      tx.assign(group, definedOnly(input));
      this.outbox.record(tx, LocationGroupUpdatedEvent, locationGroupSnapshot(group));
      return group;
    });
  }

  /**
   * Sperren setzen oder aufheben. Die Änderung wirkt sofort auf alle
   * Untergruppen und Plätze (Sperren werden nicht kopiert, sondern geerbt).
   */
  changeLocks(name: string, input: ChangeGroupLocks): Promise<LocationGroup> {
    return this.em.transactional(async (tx) => {
      const group = (await GroupHierarchy.load(tx)).get(name);
      const change = applyLockChanges(group, group.lockChain(), input);
      if (change) {
        this.outbox.record(tx, LocationGroupLockChangedEvent, {
          ...locationGroupSnapshot(group),
          change: input.reason === undefined ? change : { ...change, reason: input.reason },
        });
      }
      return group;
    });
  }

  /** Nur leere Gruppen (ohne Untergruppen und Plätze) können gelöscht werden. */
  delete(name: string): Promise<void> {
    return this.em.transactional(async (tx) => {
      const hierarchy = await GroupHierarchy.load(tx);
      const group = hierarchy.get(name);
      const childGroups = hierarchy.childrenOf(name).length;
      const locations = await tx.count(Location, { group });
      if (childGroups > 0 || locations > 0) {
        throw new ConflictError(
          'LOCATION_GROUP_NOT_EMPTY',
          `Lagerplatzgruppe [${name}] enthält noch ${childGroups} Untergruppen und ${locations} Lagerplätze`,
          { name, childGroups, locations },
        );
      }
      tx.remove(group);
      this.outbox.record(tx, LocationGroupDeletedEvent, { name });
    });
  }
}
