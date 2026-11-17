import { Module } from '@nestjs/common';
import { LayoutModule } from '../layout/index.js';
import { TransportModule } from '../transport/index.js';
import { InventoryService } from './application/inventory.service.js';
import { StockCountService } from './application/stock-count.service.js';
import { InventoryController } from './http/inventory.controller.js';
import { StockCountsController } from './http/stock-counts.controller.js';

/** Bestandsführung: Produkte mit Einheiten, Bestand je TU, Buchungen, Reservierungen, Inventur. */
@Module({
  imports: [LayoutModule, TransportModule],
  providers: [InventoryService, StockCountService],
  controllers: [InventoryController, StockCountsController],
  exports: [InventoryService],
})
export class InventoryModule {}
