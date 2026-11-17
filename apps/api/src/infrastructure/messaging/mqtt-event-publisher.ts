import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import mqtt, { type MqttClient } from 'mqtt';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import type { EventPublisher } from './event-publisher.js';
import { mqttOptions } from './mqtt-options.js';

/**
 * MQTT-Anbindung. Die Verbindung wird im Hintergrund aufgebaut und bei
 * Abbruch automatisch wiederhergestellt; ein nicht erreichbarer Broker
 * verhindert den Start der API nicht.
 */
@Injectable()
export class MqttEventPublisher implements EventPublisher, OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MqttEventPublisher.name);
  private client: MqttClient | undefined;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit(): void {
    this.client = mqtt.connect(this.config.mqttUrl, mqttOptions(this.config, 'pub'));
    this.client.on('connect', () => this.logger.log(`Verbunden mit MQTT-Broker ${this.config.mqttUrl}`));
    this.client.on('offline', () => this.logger.warn('MQTT-Broker nicht erreichbar, Verbindungsaufbau läuft'));
    this.client.on('error', (error) => this.logger.warn(`MQTT-Fehler: ${error.message}`));
  }

  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  async publish(topic: string, message: Record<string, unknown>): Promise<void> {
    if (!this.client) {
      throw new Error('MQTT-Client ist nicht initialisiert');
    }
    await this.client.publishAsync(topic, JSON.stringify(message), { qos: 1 });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client?.endAsync();
  }
}
