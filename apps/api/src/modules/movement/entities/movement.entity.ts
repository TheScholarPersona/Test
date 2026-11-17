import { defineEntity, p } from '@mikro-orm/postgresql';
import { Location } from '../../layout/index.js';
import { TransportUnit } from '../../transport/index.js';
import { MOVEMENT_STATES } from '../domain/movement-state.js';

export const MOVEMENT_TYPES = ['INBOUND', 'RELOCATION', 'REPLENISHMENT', 'OUTBOUND', 'EMPTIES', 'CLEARING', 'MANUAL'] as const;
export const MOVEMENT_PRIORITIES = ['HIGHEST', 'HIGH', 'NORMAL', 'LOW', 'LOWEST'] as const;
export type MovementPriority = (typeof MOVEMENT_PRIORITIES)[number];
/** Sortierrang zur Priorität (1 = dringend); als Spalte, damit die Datenbank richtig sortiert und blättert. */
export const priorityRank = (priority: MovementPriority): number => MOVEMENT_PRIORITIES.indexOf(priority) + 1;

/**
 * Lagerbewegung: Auftrag, eine Transporteinheit (samt Stapel) von ihrem Platz
 * auf ein Ziel zu bringen. Das Ziel ist ein Platz, ggf. über eine
 * Einlagerentscheidung aus einer Zielgruppe bestimmt.
 */
const MovementSchema = defineEntity({
  name: 'Movement',
  tableName: 'movement',
  properties: {
    id: p.uuid().primary(),
    /** Lesbare Nummer, z. B. MV00000012. */
    number: p.string().length(20).unique(),
    /** Barcode der TU – bleibt als Historie erhalten, auch wenn die TU später gelöscht wird. */
    barcode: p.string().length(64).index(),
    /** `null`, sobald die TU gelöscht wurde (nur für abgeschlossene Bewegungen möglich). */
    unit: () => p.manyToOne(TransportUnit).nullable().deleteRule('set null').index(),
    type: p.enum(MOVEMENT_TYPES),
    state: p.enum(MOVEMENT_STATES).default('OPEN'),
    priority: p.enum(MOVEMENT_PRIORITIES).default('NORMAL'),
    priorityRank: p.integer().default(3),
    /**
     * Plätze als Verweis (`null`, wenn der Platz später gelöscht wird) und als
     * Koordinate für die Historie.
     */
    source: () => p.manyToOne(Location).nullable().deleteRule('set null').index(),
    sourceCoordinate: p.string().length(54),
    target: () => p.manyToOne(Location).nullable().deleteRule('set null').index(),
    targetCoordinate: p.string().length(54).nullable(),
    /** Angefragte Zielgruppe, falls das Ziel über eine Einlagerentscheidung bestimmt wurde. */
    targetGroup: p.string().length(40).nullable(),
    /** Gespeicherte Einlagerentscheidung, aus der das Ziel stammt. */
    decisionId: p.uuid().nullable(),
    initiator: p.string().length(100).nullable(),
    assignedTo: p.string().length(100).nullable(),
    dueAt: p.datetime().nullable(),
    /** Tatsächlicher Abstellplatz nach Abschluss. */
    completedAt: p.datetime().nullable(),
    completedLocation: () => p.manyToOne(Location).nullable().deleteRule('set null'),
    completedCoordinate: p.string().length(54).nullable(),
    deviated: p.boolean().default(false),
    startedAt: p.datetime().nullable(),
    cancelledAt: p.datetime().nullable(),
    cancelReason: p.string().length(200).nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
  uniques: [
    // Höchstens eine nicht abgeschlossene Bewegung je TU – auch bei gleichzeitigen Anfragen.
    { name: 'movement_one_active_per_unit', properties: ['unit'], where: { state: { $in: ['OPEN', 'IN_PROGRESS'] } } },
  ],
  indexes: [{ name: 'movement_state_priority_idx', properties: ['state', 'priorityRank', 'createdAt'] }],
});

export class Movement extends MovementSchema.class {}
MovementSchema.setClass(Movement);
