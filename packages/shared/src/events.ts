import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Einheitliches Format aller Domain-Events, die das WMS nach außen
 * (MQTT, Node-RED) veröffentlicht.
 *
 * Konsumenten müssen Duplikate tolerieren: Die Outbox garantiert
 * „mindestens einmal“, die Event-`id` dient zur Erkennung.
 */

/** Event-Typ in Punktnotation, z. B. `transport-unit.moved`. */
export const EventTypeSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/,
    'Event-Typ muss aus kleingeschriebenen, durch Punkte getrennten Teilen bestehen, z. B. transport-unit.moved',
  );

export const EventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: EventTypeSchema,
  version: z.number().int().min(1),
  occurredAt: z.iso.datetime({ offset: true }),
  source: z.string().min(1),
  correlationId: z.string().min(1).optional(),
  payload: z.unknown(),
});
export type EventEnvelope<P = unknown> = Omit<z.infer<typeof EventEnvelopeSchema>, 'payload'> & { payload: P };

/** MQTT-Präfix aller WMS-Events. */
export const EVENT_TOPIC_PREFIX = 'wms';

/** `transport-unit.moved` → `wms/transport-unit/moved` */
export function topicForEventType(type: string): string {
  EventTypeSchema.parse(type);
  return `${EVENT_TOPIC_PREFIX}/${type.split('.').join('/')}`;
}

export interface EventMeta {
  source: string;
  correlationId?: string | undefined;
  occurredAt?: Date | undefined;
  id?: string | undefined;
}

export interface EventDefinition<P> {
  readonly type: string;
  readonly version: number;
  readonly topic: string;
  readonly payloadSchema: z.ZodType<P>;
  create(payload: P, meta: EventMeta): EventEnvelope<P>;
  parse(envelope: unknown): EventEnvelope<P>;
}

/**
 * Definiert einen Event-Typ mit Version und Payload-Schema.
 * Dasselbe Schema wird beim Erzeugen, in Vertragstests und in Node-RED genutzt.
 */
export function defineEvent<P>(type: string, version: number, payloadSchema: z.ZodType<P>): EventDefinition<P> {
  const topic = topicForEventType(type);
  return {
    type,
    version,
    topic,
    payloadSchema,
    create(payload, meta) {
      const envelope: EventEnvelope<P> = {
        id: meta.id ?? randomUUID(),
        type,
        version,
        occurredAt: (meta.occurredAt ?? new Date()).toISOString(),
        source: meta.source,
        payload: payloadSchema.parse(payload),
      };
      if (meta.correlationId !== undefined) {
        envelope.correlationId = meta.correlationId;
      }
      return envelope;
    },
    parse(envelope) {
      const base = EventEnvelopeSchema.parse(envelope);
      if (base.type !== type || base.version !== version) {
        throw new Error(`Erwartet Event [${type}] v${version}, erhalten [${base.type}] v${base.version}`);
      }
      return { ...base, payload: payloadSchema.parse(base.payload) };
    },
  };
}

// ---------------------------------------------------------------------------
// Event-Katalog
// ---------------------------------------------------------------------------

/** Technisches Test-Event: prüft die Kette API → Outbox → MQTT → Konsument. */
export const SystemPingEvent = defineEvent(
  'system.ping',
  1,
  z.object({
    message: z.string().min(1).max(200),
  }),
);
