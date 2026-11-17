import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { LayoutModule } from '../layout/index.js';
import { MovementModule } from '../movement/index.js';
import { TransportModule } from '../transport/index.js';
import { ReceivingService } from './application/receiving.service.js';
import { ReceivingController } from './http/receiving.controller.js';

/** Wareneingang: Avis, Erfassung nach Menge, TU oder blind, abgeleiteter Auftragszustand. */
@Module({
  imports: [LayoutModule, TransportModule, InventoryModule, MovementModule],
  providers: [ReceivingService],
  controllers: [ReceivingController],
  exports: [ReceivingService],
})
export class ReceivingModule {}
