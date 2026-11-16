import { Injectable } from '@nestjs/common';
import { RuleViolationError } from '../../../common/domain-error.js';
import type { Facts } from '../domain/conditions.js';
import { type Rule, selectRule } from '../domain/rule-set.js';
import type { CandidateResult, DecisionPointDefinition, Evaluation } from '../domain/types.js';
import type { StrategyRuleSet } from '../entities/rule-set.entity.js';

export interface EngineRun {
  rule: Rule;
  ruleIndex: number;
  strategy: string;
  params: Record<string, unknown>;
  evaluation: Evaluation;
}

export interface DecisionSummary {
  evaluated: number;
  eligible: number;
  /** Anzahl ausgeschlossener Kandidaten je verletzter Regel. */
  excludedByRule: Record<string, number>;
}

/** Ablauf jeder Entscheidung: Regel wählen → Parameter prüfen → Strategie bewerten lassen. */
@Injectable()
export class DecisionEngine {
  async run<Ctx>(point: DecisionPointDefinition<Ctx>, ruleSet: StrategyRuleSet, facts: Facts, ctx: Ctx): Promise<EngineRun> {
    const { rule, index } = selectRule(ruleSet.rules, facts, point as DecisionPointDefinition<unknown>);
    const strategy = point.strategies.find((s) => s.id === rule.strategy);
    if (!strategy) {
      throw new RuleViolationError('STRATEGY_UNAVAILABLE', `Strategie [${rule.strategy}] aus Regel [${rule.name}] ist nicht mehr verfügbar`, {
        strategy: rule.strategy,
      });
    }
    const params = strategy.paramsSchema.parse(rule.params) as Record<string, unknown>;
    return { rule, ruleIndex: index, strategy: strategy.id, params, evaluation: await strategy.decide(ctx, params) };
  }

  summarize(candidates: CandidateResult[]): DecisionSummary {
    const excludedByRule: Record<string, number> = {};
    for (const candidate of candidates) {
      for (const violation of candidate.violations) {
        excludedByRule[violation.rule] = (excludedByRule[violation.rule] ?? 0) + 1;
      }
    }
    return { evaluated: candidates.length, eligible: candidates.filter((c) => c.eligible).length, excludedByRule };
  }
}
