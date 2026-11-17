import { Module } from '@nestjs/common';
import { EventStreamService } from './event-stream.service.js';
import { EventsController } from './events.controller.js';

/** Live-Ereignisse für Browser (Server-Sent Events). */
@Module({
  providers: [EventStreamService],
  controllers: [EventsController],
  exports: [EventStreamService],
})
export class LiveModule {}
