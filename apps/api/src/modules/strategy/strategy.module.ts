import { Module } from '@nestjs/common';
import { LayoutModule } from '../layout/index.js';
import { TransportModule } from '../transport/index.js';
import { DecisionEngine } from './application/decision-engine.js';
import { DecisionService } from './application/decision.service.js';
import { RuleSetService } from './application/rule-set.service.js';
import { StrategyRegistry } from './application/strategy-registry.js';
import { StrategiesController } from './http/strategies.controller.js';
import { PutawayDecisionPoint } from './putaway/putaway.point.js';
import { PutawayService } from './putaway/putaway.service.js';

/** Strategie-Kern: Entscheidungspunkte, versionierte Regelsätze, Entscheidungen mit Begründung. */
@Module({
  imports: [LayoutModule, TransportModule],
  providers: [StrategyRegistry, RuleSetService, DecisionEngine, DecisionService, PutawayDecisionPoint, PutawayService],
  controllers: [StrategiesController],
  exports: [PutawayService, StrategyRegistry],
})
export class StrategyModule {}
