import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { LayoutModule } from '../layout/index.js';
import { MovementModule } from '../movement/index.js';
import { StrategyModule } from '../strategy/index.js';
import { TransportOrderModule } from '../transport-order/index.js';
import { TransportModule } from '../transport/index.js';
import { OutboundService } from './application/outbound.service.js';
import { OutboundController } from './http/outbound.controller.js';

/** Auslagerung: Aufträge mit Bedarf je Produkt, Zuteilung per Auslagerstrategie, Picks mit Reservierung. */
@Module({
  imports: [LayoutModule, TransportModule, InventoryModule, StrategyModule, MovementModule, TransportOrderModule],
  providers: [OutboundService],
  controllers: [OutboundController],
  exports: [OutboundService],
})
export class OutboundModule {}
