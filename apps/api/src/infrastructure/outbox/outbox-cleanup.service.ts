import { MikroORM } from '@mikro-orm/postgresql';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { MetricsService } from '../metrics/metrics.service.js';

const BATCH = 5000;

/**
 * Löscht veröffentlichte Outbox-Einträge nach Ablauf der Aufbewahrungsfrist (`OUTBOX_RETENTION_HOURS`),
 * in Portionen, damit die Tabelle nicht unbegrenzt wächst. Unveröffentlichte Einträge bleiben immer.
 */
@Injectable()
export class OutboxCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxCleanupService.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<number> | undefined;

  constructor(
    private readonly orm: MikroORM,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.outbox.relayEnabled || this.config.outbox.retentionHours <= 0) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.runOnce()
        .catch((error: unknown) => {
          this.logger.error(`Outbox-Aufräumen fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
          return 0;
        })
        .finally(() => (this.running = undefined));
    }, this.config.outbox.cleanupIntervalMs);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** Ein Durchlauf; liefert die Zahl der gelöschten Einträge. Öffentlich für Tests. */
  async runOnce(now = new Date()): Promise<number> {
    if (this.config.outbox.retentionHours <= 0) return 0;
    const before = new Date(now.getTime() - this.config.outbox.retentionHours * 3_600_000);
    const connection = this.orm.em.fork().getConnection();
    let total = 0;
    for (;;) {
      const rows = await connection.execute<{ id: string }[]>(
        `delete from "outbox_message" where "id" in (select "id" from "outbox_message" where "published_at" is not null and "published_at" < ? limit ${BATCH}) returning "id"`,
        [before],
      );
      total += rows.length;
      if (rows.length < BATCH) break;
    }
    if (total > 0) {
      this.metrics.outboxCleaned.inc(total);
      this.logger.log(`${total} veröffentlichte Outbox-Einträge gelöscht (älter als ${this.config.outbox.retentionHours} h)`);
    }
    return total;
  }
}
