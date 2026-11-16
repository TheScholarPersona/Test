import { Module } from '@nestjs/common';
import { TransportModule } from '../transport/index.js';
import { InventoryService } from './application/inventory.service.js';
import { InventoryController } from './http/inventory.controller.js';

/** Bestandsführung (erster Ausbau): Produkte, Bestand je TU, Buchungsjournal. */
@Module({
  imports: [TransportModule],
  providers: [InventoryService],
  controllers: [InventoryController],
  exports: [InventoryService],
})
export class InventoryModule {}
