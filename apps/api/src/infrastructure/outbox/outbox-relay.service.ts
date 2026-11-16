import { LockMode, MikroORM } from '@mikro-orm/postgresql';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { EVENT_PUBLISHER, type EventPublisher } from '../messaging/event-publisher.js';
import { OutboxMessage } from './outbox-message.entity.js';
import { retryDelayMs, withTimeout } from './retry-policy.js';

export interface RelayRunResult {
  published: number;
  failed: number;
  skipped: boolean;
}

/**
 * Veröffentlicht offene Outbox-Einträge nach MQTT.
 *
 * - Einträge werden mit `FOR UPDATE SKIP LOCKED` geholt; mehrere API-Instanzen
 *   können parallel laufen, ohne denselben Eintrag doppelt zu senden.
 * - Garantie: „mindestens einmal“. Bricht die Transaktion nach dem Senden ab,
 *   wird erneut gesendet; Konsumenten erkennen Duplikate an der Event-ID.
 * - Ohne Broker-Verbindung wird der Durchlauf übersprungen, ohne Versuche zu zählen.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<RelayRunResult> | undefined;
  private stopped = false;

  constructor(
    private readonly orm: MikroORM,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.outbox.relayEnabled) {
      this.schedule();
      this.logger.log(`Outbox-Relay gestartet (alle ${this.config.outbox.pollIntervalMs} ms)`);
    } else {
      this.logger.log('Outbox-Relay ist deaktiviert');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** Ein Durchlauf; öffentlich für Tests und manuelles Auslösen. */
  async runOnce(): Promise<RelayRunResult> {
    if (!this.publisher.isConnected()) {
      return { published: 0, failed: 0, skipped: true };
    }
    const em = this.orm.em.fork();
    return em.transactional(async (tx) => {
      const batch = await tx.find(
        OutboxMessage,
        { publishedAt: null, nextAttemptAt: { $lte: new Date() } },
        {
          orderBy: { occurredAt: 'asc', id: 'asc' },
          limit: this.config.outbox.batchSize,
          lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
        },
      );
      let published = 0;
      let failed = 0;
      for (const message of batch) {
        try {
          await withTimeout(
            this.publisher.publish(message.topic, message.envelope),
            this.config.outbox.publishTimeoutMs,
            `Zeitüberschreitung beim Veröffentlichen nach ${this.config.outbox.publishTimeoutMs} ms`,
          );
          message.publishedAt = new Date();
          message.lastError = null;
          published++;
        } catch (error: unknown) {
          message.attempts += 1;
          message.lastError = error instanceof Error ? error.message : String(error);
          message.nextAttemptAt = new Date(Date.now() + retryDelayMs(message.attempts));
          failed++;
          this.logger.warn(`Event ${message.id} (${message.eventType}) nicht veröffentlicht, Versuch ${message.attempts}: ${message.lastError}`);
        }
      }
      return { published, failed, skipped: false };
    });
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.running = this.runOnce().catch((error: unknown) => {
        this.logger.error(`Outbox-Durchlauf fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
        return { published: 0, failed: 0, skipped: true };
      });
      void this.running.finally(() => this.schedule());
    }, this.config.outbox.pollIntervalMs);
  }
}
