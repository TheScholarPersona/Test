import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/** Fachliche Zustände als Zählabfragen: Metrikname → SQL mit Spalten `label` und `n`. */
const STATE_QUERIES: { name: string; help: string; label: string; sql: string }[] = [
  { name: 'wms_outbound_orders', help: 'Auslageraufträge je Zustand', label: 'state', sql: `select state as label, count(*) as n from outbound_order group by state` },
  { name: 'wms_outbound_picks_open', help: 'Offene Picks', label: 'state', sql: `select 'OPEN' as label, count(*) as n from outbound_pick where state = 'OPEN'` },
  { name: 'wms_receiving_orders', help: 'Avise je Zustand', label: 'state', sql: `select state as label, count(*) as n from receiving_order group by state` },
  { name: 'wms_movements', help: 'Lagerbewegungen je Zustand (offen und in Arbeit)', label: 'state', sql: `select state as label, count(*) as n from movement where state in ('OPEN', 'IN_PROGRESS') group by state` },
  { name: 'wms_transport_orders', help: 'Transportaufträge je Zustand (nicht beendet)', label: 'state', sql: `select state as label, count(*) as n from transport_order where state not in ('FINISHED', 'CANCELED', 'CANCELLED') group by state` },
  { name: 'wms_shipments', help: 'Sendungen je Zustand', label: 'state', sql: `select state as label, count(*) as n from shipment group by state` },
  { name: 'wms_erp_messages', help: 'ERP-Nachrichten je Richtung und Zustand', label: 'state', sql: `select direction || '/' || state as label, count(*) as n from erp_message group by direction, state` },
  { name: 'wms_transport_unit_errors_open', help: 'Offene Fehlermeldungen an TUs', label: 'state', sql: `select 'OPEN' as label, count(*) as n from transport_unit_error where resolved_at is null` },
];

/**
 * Metriken im Prometheus-Format (`GET /metrics`). Zähler und Antwortzeiten werden laufend erfasst;
 * Zustände (Outbox-Rückstand, offene Aufträge …) werden beim Abruf aus der Datenbank gelesen.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration: Histogram<'method' | 'route' | 'status'>;
  readonly outboxPublished: Counter<'type'>;
  readonly outboxFailed: Counter<'type'>;
  readonly outboxCleaned: Counter;

  constructor(private readonly orm: MikroORM) {
    collectDefaultMetrics({ register: this.registry, prefix: 'wms_' });
    this.httpDuration = new Histogram({
      name: 'wms_http_request_duration_seconds',
      help: 'Dauer der HTTP-Anfragen je Methode, Route (Muster) und Status',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.outboxPublished = new Counter({ name: 'wms_outbox_published_total', help: 'Nach MQTT veröffentlichte Events je Typ', labelNames: ['type'], registers: [this.registry] });
    this.outboxFailed = new Counter({ name: 'wms_outbox_publish_failures_total', help: 'Fehlgeschlagene Veröffentlichungsversuche je Event-Typ', labelNames: ['type'], registers: [this.registry] });
    this.outboxCleaned = new Counter({ name: 'wms_outbox_cleaned_total', help: 'Nach Ablauf der Aufbewahrungsfrist gelöschte Outbox-Einträge', registers: [this.registry] });

    const query = <T>(sql: string) => this.orm.em.fork().getConnection().execute<T[]>(sql);
    new Gauge({
      name: 'wms_outbox_pending',
      help: 'Noch nicht veröffentlichte Events',
      registers: [this.registry],
      async collect() {
        const [row] = await query<{ n: string }>(`select count(*) as n from outbox_message where published_at is null`);
        this.set(Number(row?.n ?? 0));
      },
    });
    new Gauge({
      name: 'wms_outbox_oldest_pending_seconds',
      help: 'Alter des ältesten unveröffentlichten Events in Sekunden (0 = kein Rückstand)',
      registers: [this.registry],
      async collect() {
        const [row] = await query<{ age: string | null }>(`select extract(epoch from now() - min(occurred_at)) as age from outbox_message where published_at is null`);
        this.set(Number(row?.age ?? 0));
      },
    });
    for (const q of STATE_QUERIES) {
      new Gauge({
        name: q.name,
        help: q.help,
        labelNames: [q.label],
        registers: [this.registry],
        async collect() {
          this.reset();
          for (const row of await query<{ label: string; n: string }>(q.sql)) this.set({ [q.label]: row.label }, Number(row.n));
        },
      });
    }
  }

  /** Text im Prometheus-Format. */
  render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
