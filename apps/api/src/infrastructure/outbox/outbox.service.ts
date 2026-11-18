import type { EntityManager } from '@mikro-orm/postgresql';
import { Inject, Injectable } from '@nestjs/common';
import type { EventDefinition, EventEnvelope, EventMeta } from '@wms/shared';
import { requestContext } from '../../common/request-context.js';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { OutboxMessage } from './outbox-message.entity.js';

export type RecordMeta = Omit<EventMeta, 'source'>;

/**
 * Wird bei jedem `record` synchron mit dem EntityManager der fachlichen Transaktion aufgerufen –
 * z. B. um daraus weitere Datensätze in derselben Transaktion abzuleiten (ERP-Nachrichten).
 */
export type OutboxListener = (em: EntityManager, envelope: EventEnvelope<unknown>) => void;

/**
 * Schreibt Events in die Outbox. Muss mit dem EntityManager der laufenden
 * fachlichen Transaktion aufgerufen werden; geschrieben wird beim Flush bzw.
 * Commit dieser Transaktion.
 */
@Injectable()
export class OutboxService {
  private readonly listeners: OutboxListener[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Zuhörer anmelden (beim Modulstart). */
  onRecord(listener: OutboxListener): void {
    this.listeners.push(listener);
  }

  record<P>(em: EntityManager, definition: EventDefinition<P>, payload: P, meta: RecordMeta = {}): EventEnvelope<P> {
    // Akteur der laufenden Anfrage (Anmeldung) automatisch übernehmen – Prüfspur für jede Änderung.
    const actor = meta.actor ?? requestContext.get()?.actor;
    const envelope = definition.create(payload, { ...meta, ...(actor ? { actor } : {}), source: this.config.serviceName });
    const occurredAt = new Date(envelope.occurredAt);
    em.create(OutboxMessage, {
      id: envelope.id,
      eventType: envelope.type,
      topic: definition.topic,
      envelope: envelope as unknown as Record<string, unknown>,
      occurredAt,
      nextAttemptAt: occurredAt,
    });
    for (const listener of this.listeners) listener(em, envelope as EventEnvelope<unknown>);
    return envelope;
  }
}
