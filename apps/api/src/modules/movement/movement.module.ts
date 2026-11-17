import { Module } from '@nestjs/common';
import { LayoutModule } from '../layout/index.js';
import { StrategyModule } from '../strategy/index.js';
import { TransportModule } from '../transport/index.js';
import { MovementGroupService } from './application/movement-group.service.js';
import { MovementService } from './application/movement.service.js';
import { MovementGroupsController } from './http/movement-groups.controller.js';
import { MovementsController } from './http/movements.controller.js';

/** Lagerbewegungen: Aufträge, TUs auf ein Ziel zu bringen, mit explizitem Zustandsautomaten. */
@Module({
  imports: [LayoutModule, TransportModule, StrategyModule],
  providers: [MovementService, MovementGroupService],
  controllers: [MovementsController, MovementGroupsController],
  exports: [MovementService],
})
export class MovementModule {}
