import { Global, Module } from '@nestjs/common';
import { EVENT_PUBLISHER } from '../messaging/event-publisher.js';
import { MqttEventPublisher } from '../messaging/mqtt-event-publisher.js';
import { OutboxRelayService } from './outbox-relay.service.js';
import { OutboxService } from './outbox.service.js';

/** Stellt allen Fachmodulen den OutboxService bereit und betreibt das Relay. */
@Global()
@Module({
  providers: [
    MqttEventPublisher,
    { provide: EVENT_PUBLISHER, useExisting: MqttEventPublisher },
    OutboxService,
    OutboxRelayService,
  ],
  exports: [OutboxService, EVENT_PUBLISHER, OutboxRelayService],
})
export class OutboxModule {}
