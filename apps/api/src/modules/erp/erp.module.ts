import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { OutboundModule } from '../outbound/index.js';
import { ReceivingModule } from '../receiving/index.js';
import { ErpService } from './application/erp.service.js';
import { ErpController } from './http/erp.controller.js';

/** ERP-Anbindung (formatneutral; Übersetzung in konkrete Formate in Node-RED). */
@Module({
  imports: [InventoryModule, ReceivingModule, OutboundModule],
  providers: [ErpService],
  controllers: [ErpController],
})
export class ErpModule {}
