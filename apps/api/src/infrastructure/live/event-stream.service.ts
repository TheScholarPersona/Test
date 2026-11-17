import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { EventEnvelope } from '@wms/shared';
import mqtt, { type MqttClient } from 'mqtt';
import { Observable, Subject } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../../config.js';

const DEDUP_SIZE = 2000;

/**
 * Ereignisse für Browser-Clients (Server-Sent Events). Abonniert `wms/#`
 * beim Broker – nicht das eigene Outbox-Relay –, damit Clients jeder
 * API-Instanz alle Ereignisse sehen. Die Verbindung entsteht beim ersten
 * Zuhörer; doppelt gelieferte Ereignisse (gleiche id) werden verworfen.
 */
@Injectable()
export class EventStreamService implements OnApplicationShutdown {
  private readonly logger = new Logger(EventStreamService.name);
  private readonly subject = new Subject<EventEnvelope>();
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];
  private client: MqttClient | undefined;
  private listeners = 0;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Strom aller Ereignisse; solange jemand zuhört, besteht das Abonnement. */
  events(): Observable<EventEnvelope> {
    return new Observable<EventEnvelope>((subscriber) => {
      this.listeners += 1;
      this.connect();
      const subscription = this.subject.subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        this.listeners -= 1;
      };
    });
  }

  /** Anzahl verbundener Zuhörer (für Tests und Diagnose). */
  listenerCount(): number {
    return this.listeners;
  }

  private connect(): void {
    if (this.client) return;
    this.client = mqtt.connect(this.config.mqttUrl, {
      clientId: `${this.config.serviceName}-live-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
      reconnectPeriod: 2000,
      clean: true,
    });
    this.client.on('connect', () => {
      void this.client?.subscribeAsync('wms/#', { qos: 1 }).catch((error: Error) => this.logger.warn(`Abonnement fehlgeschlagen: ${error.message}`));
    });
    this.client.on('error', (error) => this.logger.warn(`MQTT-Fehler (Live-Ereignisse): ${error.message}`));
    this.client.on('message', (_topic, payload) => {
      let event: EventEnvelope;
      try {
        event = JSON.parse(payload.toString()) as EventEnvelope;
      } catch {
        return;
      }
      if (!event || typeof event.type !== 'string' || typeof event.id !== 'string') return;
      if (this.seen.has(event.id)) return;
      this.seen.add(event.id);
      this.order.push(event.id);
      if (this.order.length > DEDUP_SIZE) this.seen.delete(this.order.shift()!);
      this.subject.next(event);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.subject.complete();
    await this.client?.endAsync();
  }
}
