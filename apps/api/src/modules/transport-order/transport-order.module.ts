import { Module } from '@nestjs/common';
import { LayoutModule } from '../layout/index.js';
import { StrategyModule } from '../strategy/index.js';
import { TransportModule } from '../transport/index.js';
import { TransportOrderService } from './application/transport-order.service.js';
import { TransportOrdersController } from './http/transport-orders.controller.js';

/** Transportaufträge: automatischer Transport von TUs mit Start-Steuerung und Zielumleitung. */
@Module({
  imports: [LayoutModule, TransportModule, StrategyModule],
  providers: [TransportOrderService],
  controllers: [TransportOrdersController],
  exports: [TransportOrderService],
})
export class TransportOrderModule {}
