import { defineEntity, p } from '@mikro-orm/postgresql';

export const ERP_DIRECTIONS = ['IN', 'OUT'] as const;
/**
 * Eingang: PROCESSED oder FAILED. Ausgang: PENDING → IN_DELIVERY (abgeholt, Frist läuft) → SENT;
 * nach zu vielen Fehlversuchen FAILED. FAILED lässt sich im Leitstand erneut anstoßen.
 */
export const ERP_STATES = ['PENDING', 'IN_DELIVERY', 'SENT', 'PROCESSED', 'FAILED'] as const;

/** Protokoll aller Nachrichten zwischen WMS und ERP (Ein- und Ausgang). */
const ErpMessageSchema = defineEntity({
  name: 'ErpMessage',
  tableName: 'erp_message',
  properties: {
    id: p.uuid().primary(),
    direction: p.enum(ERP_DIRECTIONS),
    /** Eingang: ID des Absenders; Ausgang: gleich `id`. */
    messageId: p.string().length(100),
    type: p.string().length(40).index(),
    action: p.string().length(20).nullable(),
    state: p.enum(ERP_STATES).index(),
    /** Auftrag, Sendung oder Artikel – für die Suche. */
    reference: p.string().length(100).nullable().index(),
    payload: p.json<Record<string, unknown>>(),
    result: p.json<Record<string, unknown>>().nullable(),
    attempts: p.integer().default(0),
    nextAttemptAt: p.datetime().nullable(),
    leaseUntil: p.datetime().nullable(),
    lastError: p.text().nullable(),
    occurredAt: p.datetime(),
    completedAt: p.datetime().nullable(),
    createdAt: p.datetime().onCreate(() => new Date()).index(),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    version: p.integer().version(),
  },
  uniques: [{ name: 'erp_message_direction_message_id_unique', properties: ['direction', 'messageId'] }],
});

export class ErpMessage extends ErpMessageSchema.class {}
ErpMessageSchema.setClass(ErpMessage);
