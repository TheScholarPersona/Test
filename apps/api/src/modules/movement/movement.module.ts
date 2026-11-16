import { Module } from '@nestjs/common';
import { LayoutModule } from '../layout/index.js';
import { StrategyModule } from '../strategy/index.js';
import { TransportModule } from '../transport/index.js';
import { MovementService } from './application/movement.service.js';
import { MovementsController } from './http/movements.controller.js';

/** Lagerbewegungen: Aufträge, TUs auf ein Ziel zu bringen, mit explizitem Zustandsautomaten. */
@Module({
  imports: [LayoutModule, TransportModule, StrategyModule],
  providers: [MovementService],
  controllers: [MovementsController],
  exports: [MovementService],
})
export class MovementModule {}
