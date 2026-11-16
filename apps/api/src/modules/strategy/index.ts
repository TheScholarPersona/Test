/**
 * Öffentliche Schnittstelle des Strategie-Kerns.
 * Andere Module verwenden ausschließlich, was hier exportiert ist.
 */
import { StrategyDecision } from './entities/decision.entity.js';
import { StrategyRuleSet } from './entities/rule-set.entity.js';

export { StrategyModule } from './strategy.module.js';
export { PutawayService, type PutawayRequest } from './putaway/putaway.service.js';
export { StrategyRegistry } from './application/strategy-registry.js';
export type { DecisionResult } from './http/schemas.js';

export const strategyEntities = [StrategyRuleSet, StrategyDecision];
