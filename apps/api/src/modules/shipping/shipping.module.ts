import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { OutboundModule } from '../outbound/index.js';
import { PartnerModule } from '../partner/index.js';
import { TransportModule } from '../transport/index.js';
import { ShipmentService } from './application/shipment.service.js';
import { ShipmentsController } from './http/shipments.controller.js';

/** Versand: Sendungen mit Ladekontrolle und Warenausgang. */
@Module({
  imports: [OutboundModule, PartnerModule, TransportModule, InventoryModule],
  providers: [ShipmentService],
  controllers: [ShipmentsController],
  exports: [ShipmentService],
})
export class ShippingModule {}
