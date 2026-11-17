import { EntityManager, type FilterQuery } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../common/domain-error.js';
import { StrategyDecision } from '../entities/decision.entity.js';
import { StrategyRuleSet } from '../entities/rule-set.entity.js';
import type { DecisionQuery, DecisionResult } from '../http/schemas.js';

/** Lesender Zugriff auf gespeicherte Entscheidungen („Warum kam die TU auf diesen Platz?“). */
@Injectable()
export class DecisionService {
  constructor(private readonly em: EntityManager) {}

  async list(query: DecisionQuery): Promise<{ items: DecisionResult[]; total: number }> {
    const where: FilterQuery<StrategyDecision> = {};
    if (query.subject) where.subject = query.subject;
    if (query.decisionPoint) where.decisionPoint = query.decisionPoint;
    const [items, total] = await this.em.findAndCount(StrategyDecision, where, {
      orderBy: { createdAt: 'desc', id: 'asc' },
      limit: query.limit,
      offset: query.offset,
    });
    return { items: await Promise.all(items.map((d) => this.toResult(d))), total };
  }

  async get(id: string): Promise<DecisionResult> {
    const decision = await this.em.findOne(StrategyDecision, { id });
    if (!decision) {
      throw new NotFoundError('DECISION_NOT_FOUND', `Entscheidung [${id}] existiert nicht`, { id });
    }
    return this.toResult(decision);
  }

  private async toResult(d: StrategyDecision): Promise<DecisionResult> {
    const ruleSet = await this.em.findOne(StrategyRuleSet, { id: d.ruleSetId });
    const outcome = d.outcome as Pick<DecisionResult, 'summary' | 'candidates' | 'note' | 'attempts' | 'rejectedOnAssign'>;
    const chosenCandidate = outcome.candidates.find((c) => c.key === d.chosenKey);
    return {
      id: d.id,
      decisionPoint: d.decisionPoint,
      subject: d.subject,
      simulated: false,
      ruleSet: { id: d.ruleSetId, version: d.ruleSetVersion, status: ruleSet?.status ?? 'DELETED' },
      rule: { name: d.ruleName, index: ruleSet?.rules.findIndex((r) => r.name === d.ruleName) ?? -1 },
      strategy: d.strategy,
      params: d.params,
      facts: d.facts,
      chosen: d.chosenKey ? { key: d.chosenKey, label: d.chosenLabel ?? '', score: chosenCandidate?.score ?? null } : null,
      assigned: d.assigned,
      summary: outcome.summary,
      candidates: outcome.candidates,
      ...(outcome.note ? { note: outcome.note } : {}),
      attempts: outcome.attempts,
      rejectedOnAssign: outcome.rejectedOnAssign,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
