import { Module } from '@nestjs/common';
import { LayoutModule } from '../layout/index.js';
import { TransportOrderModule } from '../transport-order/index.js';
import { TransportModule } from '../transport/index.js';
import { FlowConfigService } from './application/flow-config.service.js';
import { FlowService } from './application/flow.service.js';
import { FlowController } from './http/flow.controller.js';

/** Materialfluss: Routen, Nächster-Schritt-Tabelle, Action-Matrix und Geräte-Ereignisse (Ersatz für das TMS-Routing). */
@Module({
  imports: [LayoutModule, TransportModule, TransportOrderModule],
  providers: [FlowConfigService, FlowService],
  controllers: [FlowController],
  exports: [FlowService],
})
export class FlowModule {}
