import { defineEntity, p } from '@mikro-orm/postgresql';
import { Location } from '../../layout/index.js';
import { TransportUnit } from '../../transport/index.js';
import { TRANSPORT_ORDER_PRIORITIES, TRANSPORT_ORDER_STATES } from '../domain/transport-order-state.js';

/**
 * Transportauftrag: automatischer Transport einer TU zu einem Zielplatz oder
 * in eine Zielgruppe (z. B. über Fördertechnik). Das Materialfluss-Modul
 * steuert die TU anhand des gestarteten Auftrags.
 */
const TransportOrderSchema = defineEntity({
  name: 'TransportOrder',
  tableName: 'transport_order',
  properties: {
    id: p.uuid().primary(),
    /** Lesbare Nummer, z. B. TO00000012. */
    number: p.string().length(20).unique(),
    barcode: p.string().length(64).index(),
    /** `null`, sobald die TU gelöscht wurde (nur für abgeschlossene Aufträge möglich). */
    unit: () => p.manyToOne(TransportUnit).nullable().deleteRule('set null').index(),
    state: p.enum(TRANSPORT_ORDER_STATES).default('INITIALIZED'),
    priority: p.enum(TRANSPORT_ORDER_PRIORITIES).default('NORMAL'),
    priorityRank: p.integer().default(3),
    /** Platz der TU beim Anlegen. */
    source: () => p.manyToOne(Location).nullable().deleteRule('set null').index(),
    sourceCoordinate: p.string().length(54),
    /** Zielplatz (bei Zielgruppe erst nach Abschluss bekannt). */
    target: () => p.manyToOne(Location).nullable().deleteRule('set null').index(),
    targetCoordinate: p.string().length(54).nullable(),
    targetGroup: p.string().length(40).nullable(),
    /** Darf bei gesperrtem Zielplatz auf einen Ersatzplatz der Gruppe umgeleitet werden (O-07)? */
    redirect: p.boolean().default(false),
    /** Einlagerentscheidung der Umleitung. */
    decisionId: p.uuid().nullable(),
    initiator: p.string().length(100).nullable(),
    problemCode: p.string().length(60).nullable(),
    problemMessage: p.string().length(500).nullable(),
    problemAt: p.datetime().nullable(),
    startedAt: p.datetime().nullable(),
    finishedAt: p.datetime().nullable(),
    finishedCoordinate: p.string().length(54).nullable(),
    deviated: p.boolean().default(false),
    endedAt: p.datetime().nullable(),
    endReason: p.string().length(200).nullable(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
  uniques: [
    // O-02: höchstens ein gestarteter (oder unterbrochener) Auftrag je TU – auch bei gleichzeitigen Anfragen.
    { name: 'transport_order_one_active_per_unit', properties: ['unit'], where: { state: { $in: ['STARTED', 'INTERRUPTED'] } } },
  ],
  indexes: [{ name: 'transport_order_start_order_idx', properties: ['state', 'priorityRank', 'createdAt'] }],
});

export class TransportOrder extends TransportOrderSchema.class {}
TransportOrderSchema.setClass(TransportOrder);
