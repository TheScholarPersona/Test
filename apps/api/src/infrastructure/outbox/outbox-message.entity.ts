import { defineEntity, p } from '@mikro-orm/postgresql';

/**
 * Transactional Outbox: Events werden in derselben Datenbanktransaktion
 * gespeichert wie die fachliche Änderung und danach vom Relay nach MQTT
 * veröffentlicht. So geht bei einem Absturz kein Event verloren.
 */
const OutboxMessageSchema = defineEntity({
  name: 'OutboxMessage',
  tableName: 'outbox_message',
  properties: {
    /** Event-ID aus dem Umschlag; dient Konsumenten zur Duplikaterkennung. */
    id: p.uuid().primary(),
    eventType: p.string().length(120),
    topic: p.string().length(255),
    /** Vollständiger Event-Umschlag (EventEnvelope). */
    envelope: p.json<Record<string, unknown>>(),
    occurredAt: p.datetime(),
    publishedAt: p.datetime().nullable(),
    attempts: p.integer().default(0),
    nextAttemptAt: p.datetime(),
    lastError: p.text().nullable(),
    version: p.integer().version(),
  },
  // Das Relay sucht nur unveröffentlichte Einträge; der Teilindex bleibt dadurch klein.
  indexes: [
    {
      name: 'outbox_message_pending_idx',
      properties: ['nextAttemptAt', 'occurredAt'],
      where: { publishedAt: null },
    },
  ],
});

export class OutboxMessage extends OutboxMessageSchema.class {}
OutboxMessageSchema.setClass(OutboxMessage);
