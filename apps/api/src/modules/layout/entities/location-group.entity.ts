import { defineEntity, p } from '@mikro-orm/postgresql';
import type { LockChainEntry } from '../domain/lock-state.js';

/**
 * Gruppe von Lagerplätzen (Bereich, Gasse, Zone, …), beliebig verschachtelt.
 * Die übergeordnete Gruppe wird beim Anlegen festgelegt; Umhängen ist im
 * ersten Ausbau nicht vorgesehen, dadurch sind Zyklen ausgeschlossen.
 */
const LocationGroupSchema = defineEntity({
  name: 'LocationGroup',
  tableName: 'location_group',
  properties: {
    id: p.uuid().primary(),
    name: p.string().length(40).unique(),
    description: p.string().length(255).default(''),
    groupType: p.string().length(40).nullable(),
    parent: () => p.manyToOne(LocationGroup).nullable().deleteRule('restrict').index(),
    /** Eigene Einlagersperre (wirksame Sperre: siehe domain/lock-state.ts). */
    inboundBlocked: p.boolean().default(false),
    /** Eigene Auslagersperre. */
    outboundBlocked: p.boolean().default(false),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});

export class LocationGroup extends LocationGroupSchema.class {
  /** Kette `[diese Gruppe, Eltern, …, Wurzel]`; setzt geladene Eltern voraus. */
  lockChain(): LockChainEntry[] {
    const chain: LockChainEntry[] = [];
    let current: LocationGroup | null | undefined = this;
    while (current) {
      chain.push({
        kind: 'location-group',
        name: current.name,
        inboundBlocked: current.inboundBlocked,
        outboundBlocked: current.outboundBlocked,
      });
      current = current.parent as LocationGroup | null | undefined;
    }
    return chain;
  }
}
LocationGroupSchema.setClass(LocationGroup);
