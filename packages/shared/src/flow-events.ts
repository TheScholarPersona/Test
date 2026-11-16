import { z } from 'zod';
import { defineEvent } from './events.js';

/** Events des Materialfluss-Moduls (Anlagensteuerung). */

export const DeviceEventTypeSchema = z.enum(['request', 'arrived', 'location-status', 'error']);
export type DeviceEventType = z.infer<typeof DeviceEventTypeSchema>;

const Place = z.object({ id: z.uuid(), locationId: z.string(), plcCode: z.string().nullable() });

/**
 * Fahrbefehl an die Anlage: TU `barcode` von `from` nach `to` bringen.
 * Node-RED übersetzt ihn in das Protokoll der Anlage (oder der Simulator fährt).
 */
export const FlowCommandEvent = defineEvent(
  'flow.command',
  1,
  z.object({
    decisionId: z.uuid(),
    barcode: z.string(),
    deviceId: z.string().nullable(),
    orderNumber: z.string().nullable(),
    routeId: z.string().nullable(),
    from: Place,
    to: Place,
  }),
);

/** Für einen laufenden Transportauftrag gibt es keine passende Route (in OpenWMS still ignoriert, R4). */
export const FlowNoRouteEvent = defineEvent(
  'flow.no-route',
  1,
  z.object({ decisionId: z.uuid(), barcode: z.string(), orderNumber: z.string(), location: Place, source: z.string(), target: z.string() }),
);

/** Geräte-Ereignis ohne passende Action oder ohne nächsten Schritt – die Anlage bekommt keine Antwort. */
export const FlowUnhandledEvent = defineEvent(
  'flow.unhandled',
  1,
  z.object({
    decisionId: z.uuid(),
    eventType: DeviceEventTypeSchema,
    barcode: z.string().nullable(),
    location: Place,
    outcome: z.enum(['NO_ACTION', 'NO_NEXT_STEP', 'FAILED']),
    reason: z.string(),
  }),
);

/** Programm `node-red`: Node-RED führt den Flow `flow` aus und antwortet über die API (z. B. `POST /v1/flow/commands`). */
export const FlowProgramRequestedEvent = defineEvent(
  'flow.program-requested',
  1,
  z.object({
    decisionId: z.uuid(),
    flow: z.string(),
    params: z.record(z.string(), z.unknown()),
    eventType: DeviceEventTypeSchema,
    barcode: z.string().nullable(),
    deviceId: z.string().nullable(),
    location: Place,
    orderNumber: z.string().nullable(),
    routeId: z.string().nullable(),
  }),
);

export const FlowConfigChangedEvent = defineEvent(
  'flow.config-changed',
  1,
  z.object({ kind: z.enum(['route', 'action']), key: z.string(), change: z.enum(['created', 'updated', 'deleted']) }),
);
