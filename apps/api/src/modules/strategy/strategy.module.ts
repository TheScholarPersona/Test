import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/index.js';
import { LayoutModule } from '../layout/index.js';
import { TransportModule } from '../transport/index.js';
import { AllocationDecisionPoint } from './allocation/allocation.point.js';
import { AllocationService } from './allocation/allocation.service.js';
import { DecisionEngine } from './application/decision-engine.js';
import { DecisionService } from './application/decision.service.js';
import { RuleSetService } from './application/rule-set.service.js';
import { StrategyRegistry } from './application/strategy-registry.js';
import { StrategiesController } from './http/strategies.controller.js';
import { PutawayDecisionPoint } from './putaway/putaway.point.js';
import { PutawayService } from './putaway/putaway.service.js';

/** Strategie-Kern: Entscheidungspunkte (Einlagerung, Auslagerung), versionierte Regelsätze, Entscheidungen mit Begründung. */
@Module({
  imports: [LayoutModule, TransportModule, InventoryModule],
  providers: [StrategyRegistry, RuleSetService, DecisionEngine, DecisionService, PutawayDecisionPoint, PutawayService, AllocationDecisionPoint, AllocationService],
  controllers: [StrategiesController],
  exports: [PutawayService, AllocationService, StrategyRegistry],
})
export class StrategyModule {}
