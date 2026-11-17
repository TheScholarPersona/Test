import { defineEntity, p } from '@mikro-orm/postgresql';
import { Location } from '../../layout/index.js';

export const DEVICE_EVENT_TYPES = ['request', 'arrived', 'location-status', 'error'] as const;
export const FLOW_OUTCOMES = ['COMMAND', 'FINISHED', 'HANDLED', 'DELEGATED', 'NO_ACTION', 'NO_NEXT_STEP', 'FAILED'] as const;
export type FlowOutcome = (typeof FLOW_OUTCOMES)[number];

/**
 * Route von einer Quelle (Platz oder Gruppe) zu einem Ziel (Platz oder Gruppe).
 * Gesucht wird mit Quelle und Ziel des laufenden Transportauftrags.
 */
const FlowRouteSchema = defineEntity({
  name: 'FlowRoute',
  tableName: 'flow_route',
  properties: {
    id: p.uuid().primary(),
    routeId: p.string().length(40).unique(),
    description: p.string().length(255).default(''),
    sourceLocation: () => p.manyToOne(Location).nullable().deleteRule('restrict').index(),
    sourceGroup: p.string().length(40).nullable().index(),
    targetLocation: () => p.manyToOne(Location).nullable().deleteRule('restrict').index(),
    targetGroup: p.string().length(40).nullable().index(),
    enabled: p.boolean().default(true),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});
export class FlowRoute extends FlowRouteSchema.class {}
FlowRouteSchema.setClass(FlowRoute);

/** Nächster-Schritt-Tabelle: Steht die TU auf `from`, schicke sie nach `next` (optional nur für einen TU-Typ). */
const FlowRouteStepSchema = defineEntity({
  name: 'FlowRouteStep',
  tableName: 'flow_route_step',
  properties: {
    id: p.uuid().primary(),
    route: () => p.manyToOne(FlowRoute).deleteRule('cascade').index(),
    pos: p.integer(),
    from: () => p.manyToOne(Location).deleteRule('restrict').index(),
    next: () => p.manyToOne(Location).deleteRule('restrict').index(),
    unitType: p.string().length(20).nullable(),
    enabled: p.boolean().default(true),
  },
  uniques: [{ name: 'flow_route_step_pos_unique', properties: ['route', 'pos'] }],
});
export class FlowRouteStep extends FlowRouteStepSchema.class {}
FlowRouteStepSchema.setClass(FlowRouteStep);

/**
 * Action-Matrix: (Ereignistyp, Route, Platz/Gruppe) → Programm mit Parametern.
 * `route` bzw. Ort leer bedeutet „jede Route“ bzw. „überall“.
 */
const FlowActionSchema = defineEntity({
  name: 'FlowAction',
  tableName: 'flow_action',
  properties: {
    id: p.uuid().primary(),
    name: p.string().length(60).unique(),
    description: p.string().length(255).default(''),
    eventType: p.enum(DEVICE_EVENT_TYPES).index(),
    route: () => p.manyToOne(FlowRoute).nullable().deleteRule('restrict').index(),
    location: () => p.manyToOne(Location).nullable().deleteRule('restrict').index(),
    group: p.string().length(40).nullable(),
    program: p.string().length(40),
    params: p.json<Record<string, unknown>>(),
    enabled: p.boolean().default(true),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
});
export class FlowAction extends FlowActionSchema.class {}
FlowActionSchema.setClass(FlowAction);

/** Protokoll jeder Verarbeitung eines Geräte-Ereignisses mit Begründung (Decision Trace). */
const FlowDecisionSchema = defineEntity({
  name: 'FlowDecision',
  tableName: 'flow_decision',
  properties: {
    id: p.uuid().primary(),
    eventType: p.enum(DEVICE_EVENT_TYPES),
    barcode: p.string().length(64).nullable().index(),
    deviceId: p.string().length(64).nullable(),
    locationCoordinate: p.string().length(54),
    orderNumber: p.string().length(20).nullable(),
    routeId: p.string().length(40).nullable(),
    actionName: p.string().length(60).nullable(),
    program: p.string().length(40).nullable(),
    outcome: p.enum(FLOW_OUTCOMES),
    nextCoordinate: p.string().length(54).nullable(),
    trace: p.json<string[]>(),
    createdAt: p.datetime().onCreate(() => new Date()).index(),
  },
});
export class FlowDecision extends FlowDecisionSchema.class {}
FlowDecisionSchema.setClass(FlowDecision);
