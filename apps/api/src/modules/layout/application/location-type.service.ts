import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { LocationTypeCreatedEvent, LocationTypeDeletedEvent, LocationTypeUpdatedEvent } from '@wms/shared';
import { definedOnly } from '../../../common/defined.js';
import { ConflictError, NotFoundError } from '../../../common/domain-error.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { LocationType } from '../entities/location-type.entity.js';
import { Location } from '../entities/location.entity.js';
import type { CreateLocationType, UpdateLocationType } from '../http/schemas.js';
import { locationTypeSnapshot } from './mappers.js';

@Injectable()
export class LocationTypeService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
  ) {}

  list(): Promise<LocationType[]> {
    return this.em.find(LocationType, {}, { orderBy: { code: 'asc' } });
  }

  get(code: string): Promise<LocationType> {
    return this.load(this.em, code);
  }

  create(input: CreateLocationType): Promise<LocationType> {
    return this.em.transactional(async (tx) => {
      if ((await tx.count(LocationType, { code: input.code })) > 0) {
        throw new ConflictError('LOCATION_TYPE_EXISTS', `Lagerplatztyp [${input.code}] existiert bereits`, { code: input.code });
      }
      const type = tx.create(LocationType, { id: randomUUID(), ...input });
      this.outbox.record(tx, LocationTypeCreatedEvent, locationTypeSnapshot(type));
      return type;
    });
  }

  update(code: string, input: UpdateLocationType): Promise<LocationType> {
    return this.em.transactional(async (tx) => {
      const type = await this.load(tx, code);
      tx.assign(type, definedOnly(input));
      this.outbox.record(tx, LocationTypeUpdatedEvent, locationTypeSnapshot(type));
      return type;
    });
  }

  delete(code: string): Promise<void> {
    return this.em.transactional(async (tx) => {
      const type = await this.load(tx, code);
      const usage = await tx.count(Location, { type });
      if (usage > 0) {
        throw new ConflictError('LOCATION_TYPE_IN_USE', `Lagerplatztyp [${code}] wird von ${usage} Lagerplätzen verwendet`, {
          code,
          locations: usage,
        });
      }
      tx.remove(type);
      this.outbox.record(tx, LocationTypeDeletedEvent, { code });
    });
  }

  private async load(em: EntityManager, code: string): Promise<LocationType> {
    const type = await em.findOne(LocationType, { code });
    if (!type) {
      throw new NotFoundError('LOCATION_TYPE_NOT_FOUND', `Lagerplatztyp [${code}] existiert nicht`, { code });
    }
    return type;
  }
}
