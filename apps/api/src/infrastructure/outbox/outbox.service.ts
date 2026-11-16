import type { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { EventDefinition, EventEnvelope, EventMeta } from '@wms/shared';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { OutboxMessage } from './outbox-message.entity.js';

export type RecordMeta = Omit<EventMeta, 'source'>;

/**
 * Schreibt Events in die Outbox. Muss mit dem EntityManager der laufenden
 * fachlichen Transaktion aufgerufen werden; geschrieben wird beim Flush bzw.
 * Commit dieser Transaktion.
 */
@Injectable()
export class OutboxService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  record<P>(em: EntityManager, definition: EventDefinition<P>, payload: P, meta: RecordMeta = {}): EventEnvelope<P> {
    const envelope = definition.create(payload, { ...meta, source: this.config.serviceName });
    const occurredAt = new Date(envelope.occurredAt);
    em.create(OutboxMessage, {
      id: envelope.id,
      eventType: envelope.type,
      topic: definition.topic,
      envelope: envelope as unknown as Record<string, unknown>,
      occurredAt,
      nextAttemptAt: occurredAt,
    });
    return envelope;
  }
}
