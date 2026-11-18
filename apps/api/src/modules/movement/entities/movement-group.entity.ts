import { defineEntity, p } from '@mikro-orm/postgresql';

/**
 * Bewegungsgruppe (OpenWMS `MovementGroup`): bündelt Lagerbewegungen, die ein Bediener
 * zusammen abarbeitet. Der Zustand wird aus den Bewegungen abgeleitet und nicht gespeichert.
 */
const MovementGroupSchema = defineEntity({
  name: 'MovementGroup',
  tableName: 'movement_group',
  properties: {
    id: p.uuid().primary(),
    /** Lesbare Nummer, z. B. MG00000003. */
    number: p.string().length(20).unique(),
    description: p.string().length(200).nullable(),
    /** Zugeteilter Bediener (frei wählbare Kennung, z. B. Benutzername oder Staplernummer). */
    assignedTo: p.string().length(100).nullable().index(),
    createdBy: p.string().length(100).nullable(),
    createdAt: p.datetime().onCreate(() => new Date()).index(),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});

export class MovementGroup extends MovementGroupSchema.class {}
MovementGroupSchema.setClass(MovementGroup);
