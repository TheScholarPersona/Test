import { type EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { ErpCodeSchema, LocationIdSchema } from '@wms/shared';
import { z } from 'zod';
import { NotFoundError } from '../../../common/domain-error.js';
import { effectiveLock, type EffectiveLock } from '../domain/lock-state.js';
import type { LocationGroup } from '../entities/location-group.entity.js';
import type { LocationType } from '../entities/location-type.entity.js';
import { Location } from '../entities/location.entity.js';
import { GroupHierarchy } from './group-hierarchy.js';

/** Verweis auf einen Lagerplatz in Anfragen anderer Module: genau eines der Felder. */
export const LocationReferenceSchema = z
  .union([
    z.strictObject({ id: z.uuid() }),
    z.strictObject({ locationId: LocationIdSchema }),
    z.strictObject({ erpCode: ErpCodeSchema }),
  ])
  .meta({ id: 'LocationReference', description: 'Lagerplatz über id, Koordinate (locationId) oder ERP-Code' });
export type LocationReference = z.infer<typeof LocationReferenceSchema>;

export interface LocationLocks {
  inbound: EffectiveLock;
  outbound: EffectiveLock;
}

/**
 * Lesender Zugriff anderer Module auf Lagerplätze samt wirksamer Sperren.
 * Lädt die Gruppenhierarchie in den übergebenen EntityManager, damit
 * Sperrketten berechnet werden können.
 */
@Injectable()
export class LocationLookup {
  /**
   * @param lock Zeile für die Dauer der Transaktion sperren (`FOR UPDATE`),
   *             z. B. damit zwei parallele Buchungen einen Platz nicht überbelegen.
   */
  async resolve(em: EntityManager, ref: LocationReference, options: { lock?: boolean } = {}): Promise<Location> {
    await GroupHierarchy.load(em);
    const where = 'id' in ref ? { id: ref.id } : 'locationId' in ref ? { locationId: ref.locationId } : { erpCode: ref.erpCode };
    const location = await em.findOne(Location, where, {
      populate: ['type'],
      ...(options.lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
    });
    if (!location) {
      throw new NotFoundError('LOCATION_NOT_FOUND', `Lagerplatz ${JSON.stringify(ref)} existiert nicht`, { ref });
    }
    return location;
  }

  /**
   * Versucht, die Zeile eines Lagerplatzes für die laufende Transaktion zu
   * sperren, ohne zu warten (`FOR UPDATE SKIP LOCKED`). `false`, wenn eine
   * andere Transaktion den Platz gerade gesperrt hat. Da nie gewartet wird,
   * können mehrere solcher Sperren in einer Transaktion keinen Deadlock auslösen.
   */
  async tryLock(em: EntityManager, locationId: string): Promise<boolean> {
    const rows = await em.execute<{ id: string }[]>('select "id" from "location" where "id" = ? for update skip locked', [locationId]);
    return rows.length > 0;
  }

  /**
   * Alle Plätze einer Gruppe (optional mit Untergruppen), mit geladenem Typ
   * und geladener Hierarchie; sortiert nach `sortOrder`, dann Koordinate.
   */
  async inGroup(em: EntityManager, groupName: string, includeSubgroups: boolean): Promise<Location[]> {
    const hierarchy = await GroupHierarchy.load(em);
    const groups = includeSubgroups ? hierarchy.subtree(groupName) : [hierarchy.get(groupName)];
    return em.find(Location, { group: { $in: groups } }, { populate: ['type'], orderBy: { sortOrder: 'asc', locationId: 'asc' } });
  }

  /** Setzt voraus, dass der Platz über `resolve` (oder mit geladener Hierarchie) geladen wurde. */
  locks(location: Location): LocationLocks {
    const chain = location.lockChain();
    return { inbound: effectiveLock(chain, 'inbound'), outbound: effectiveLock(chain, 'outbound') };
  }

  /** Wirksame Sperren einer Gruppe (eigene oder von übergeordneten Gruppen geerbte). */
  async groupLocks(em: EntityManager, groupName: string): Promise<LocationLocks> {
    const chain = (await GroupHierarchy.load(em)).get(groupName).lockChain();
    return { inbound: effectiveLock(chain, 'inbound'), outbound: effectiveLock(chain, 'outbound') };
  }

  /** Gruppe und alle übergeordneten Gruppen, von unten nach oben. Wirft, wenn die Gruppe fehlt. */
  async groupPath(em: EntityManager, groupName: string): Promise<string[]> {
    return (await GroupHierarchy.load(em)).get(groupName).lockChain().map((entry) => entry.name);
  }

  /** Gruppenpfad eines Platzes (eigene Gruppe zuerst); setzt geladene Hierarchie voraus (`resolve`). */
  groupPathOf(location: Location): string[] {
    return (location.group as LocationGroup).lockChain().map((entry) => entry.name);
  }

  typeCode(location: Location): string {
    return (location.type as LocationType).code;
  }

  groupName(location: Location): string {
    return (location.group as LocationGroup).name;
  }
}
