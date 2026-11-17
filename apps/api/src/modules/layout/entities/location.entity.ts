import { defineEntity, p } from '@mikro-orm/postgresql';
import type { LockChainEntry } from '../domain/lock-state.js';
import { LocationGroup } from './location-group.entity.js';
import { LocationType } from './location-type.entity.js';

/**
 * Lagerplatz. Die Koordinate `locationId` (BEREICH/GASSE/X/Y/Z) und der
 * Platztyp sind nach dem Anlegen unveränderlich.
 */
const LocationSchema = defineEntity({
  name: 'Location',
  tableName: 'location',
  properties: {
    id: p.uuid().primary(),
    locationId: p.string().length(54).unique(),
    erpCode: p.string().length(64).nullable().unique(),
    plcCode: p.string().length(64).nullable().unique(),
    description: p.string().length(255).default(''),
    sortOrder: p.integer().default(0),
    type: () => p.manyToOne(LocationType).deleteRule('restrict').index(),
    group: () => p.manyToOne(LocationGroup).deleteRule('restrict').index(),
    /** Höchstzahl gleichzeitig abgestellter Transporteinheiten (geprüft ab Schritt 2). */
    maxTransportUnits: p.integer().default(1),
    /** Höchstgewicht in Kilogramm als Dezimalwert; `null` = unbegrenzt. */
    maxWeightKg: p.decimal('string').precision(12).scale(3).nullable(),
    inboundBlocked: p.boolean().default(false),
    outboundBlocked: p.boolean().default(false),
    /** Platz wird bei der automatischen Platzvergabe nicht berücksichtigt. */
    allocationBlocked: p.boolean().default(false),
    /** Zustand laut Anlage (SPS): 0 = in Ordnung, sonst Störungscode; gestörte Plätze vergibt die Einlagerstrategie nicht. */
    plcState: p.integer().default(0),
    plcStateText: p.string().length(200).nullable(),
    plcStateAt: p.datetime().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});

export class Location extends LocationSchema.class {
  /** Kette `[dieser Platz, Gruppe, …, Wurzel]`; setzt geladene Gruppen voraus. */
  lockChain(): LockChainEntry[] {
    return [
      { kind: 'location', name: this.locationId, inboundBlocked: this.inboundBlocked, outboundBlocked: this.outboundBlocked },
      ...(this.group as LocationGroup).lockChain(),
    ];
  }
}
LocationSchema.setClass(Location);
