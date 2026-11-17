import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { OutboundModule } from '../outbound/index.js';
import { PartnerModule } from '../partner/index.js';
import { ShippingModule } from '../shipping/index.js';
import { TransportModule } from '../transport/index.js';
import { DocumentService } from './application/document.service.js';
import { DocumentsController } from './http/documents.controller.js';

/** Dokumente als PDF (Etiketten, Pickliste, Lieferschein, Ladeliste). */
@Module({
  imports: [TransportModule, InventoryModule, OutboundModule, ShippingModule, PartnerModule],
  providers: [DocumentService],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
