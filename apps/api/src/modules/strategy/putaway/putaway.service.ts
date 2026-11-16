import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { PutawayDecidedEvent } from '@wms/shared';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { type Location, LocationLookup } from '../../layout/index.js';
import { PlacementChecker, TransportUnitService } from '../../transport/index.js';
import { DecisionEngine, type EngineRun } from '../application/decision-engine.js';
import { RuleSetService } from '../application/rule-set.service.js';
import { StrategyDecision } from '../entities/decision.entity.js';
import type { StrategyRuleSet } from '../entities/rule-set.entity.js';
import type { DecisionResult } from '../http/schemas.js';
import { PUTAWAY, PutawayDecisionPoint } from './putaway.point.js';

const MAX_ASSIGN_ATTEMPTS = 5;
const TRACE_CANDIDATES = 20;

export interface PutawayRequest {
  barcode: string;
  group?: string | undefined;
  assign: boolean;
}

@Injectable()
export class PutawayService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly lookup: LocationLookup,
    private readonly checker: PlacementChecker,
    private readonly units: TransportUnitService,
    private readonly ruleSets: RuleSetService,
    private readonly engine: DecisionEngine,
    private readonly point: PutawayDecisionPoint,
  ) {}

  /** Echte Entscheidung mit dem aktiven Regelsatz; wird gespeichert, auf Wunsch als Ziel zugewiesen. */
  decide(request: PutawayRequest): Promise<DecisionResult> {
    return this.em.transactional(async (tx) => this.run(tx, request, await this.ruleSets.active(tx, PUTAWAY), false));
  }

  /** Probelauf mit beliebigem Regelsatz (auch Entwurf); nichts wird gespeichert oder zugewiesen. */
  simulate(request: Omit<PutawayRequest, 'assign'>, ruleSetId?: string): Promise<DecisionResult> {
    return this.em.transactional(async (tx) => {
      const ruleSet = ruleSetId ? await this.ruleSets.load(tx, ruleSetId) : await this.ruleSets.active(tx, PUTAWAY);
      return this.run(tx, { ...request, assign: false }, ruleSet, true);
    });
  }

  private async run(tx: EntityManager, request: PutawayRequest, ruleSet: StrategyRuleSet, simulated: boolean): Promise<DecisionResult> {
    const unit = await this.units.loadIn(tx, request.barcode);
    const source = await this.lookup.resolve(tx, { id: (unit.location as Location).id });
    const prepared = await this.checker.prepareExisting(tx, unit);
    const exclude = new Set<string>();
    const ctx = { em: tx, prepared, source, requestGroup: request.group ?? null, exclude };
    const facts = this.point.facts(ctx);

    let run: EngineRun;
    let assigned = false;
    let attempts = 0;
    const rejectedOnAssign: { locationId: string; violations: { rule: string; message: string }[] }[] = [];
    for (;;) {
      attempts++;
      run = await this.engine.run(this.point.definition, ruleSet, facts, ctx);
      const chosen = run.evaluation.chosen;
      if (!request.assign || !chosen) break;
      // Platz sperren (ohne zu warten) und erneut prüfen: Eine parallele Entscheidung könnte ihn
      // inzwischen vergeben haben oder gerade vergeben.
      const target = await this.lookup.resolve(tx, { id: chosen.key });
      const violations = (await this.lookup.tryLock(tx, target.id))
        ? (await this.checker.evaluate(tx, prepared, source, [target], { forAllocation: true })).get(target.id)!.violations
        : [{ rule: 'LOCATION_BUSY', message: `Platz ${target.locationId} wird gerade parallel vergeben` }];
      if (violations.length === 0) {
        this.units.assignTarget(tx, unit, target);
        assigned = true;
        break;
      }
      rejectedOnAssign.push({ locationId: target.locationId, violations });
      exclude.add(target.id);
      if (attempts >= MAX_ASSIGN_ATTEMPTS) {
        run.evaluation = { ...run.evaluation, chosen: null, note: `Zuweisung nach ${attempts} Versuchen gescheitert (Plätze parallel vergeben)` };
        break;
      }
    }

    const chosen = run.evaluation.chosen;
    const summary = this.engine.summarize(run.evaluation.candidates);
    const outcome = {
      summary,
      candidates: run.evaluation.candidates.slice(0, TRACE_CANDIDATES),
      ...(run.evaluation.note ? { note: run.evaluation.note } : {}),
      attempts,
      rejectedOnAssign,
    };
    const result: DecisionResult = {
      id: null,
      decisionPoint: PUTAWAY,
      subject: unit.barcode,
      simulated,
      ruleSet: { id: ruleSet.id, version: ruleSet.ruleSetVersion, status: ruleSet.status },
      rule: { name: run.rule.name, index: run.ruleIndex },
      strategy: run.strategy,
      params: run.params,
      facts,
      chosen: chosen ? { key: chosen.key, label: chosen.label, score: chosen.score } : null,
      assigned,
      ...outcome,
      createdAt: null,
    };
    if (simulated) {
      return result;
    }
    const decision = tx.create(StrategyDecision, {
      id: randomUUID(),
      decisionPoint: PUTAWAY,
      subject: unit.barcode,
      ruleSetId: ruleSet.id,
      ruleSetVersion: ruleSet.ruleSetVersion,
      ruleName: run.rule.name,
      strategy: run.strategy,
      params: run.params,
      facts,
      outcome,
      chosenKey: chosen?.key ?? null,
      chosenLabel: chosen?.label ?? null,
      assigned,
    });
    this.outbox.record(tx, PutawayDecidedEvent, {
      decisionId: decision.id,
      barcode: unit.barcode,
      ruleSetVersion: ruleSet.ruleSetVersion,
      ruleName: run.rule.name,
      strategy: run.strategy,
      chosen: chosen ? { id: chosen.key, locationId: chosen.label } : null,
      assigned,
    });
    await tx.flush();
    return { ...result, id: decision.id, createdAt: decision.createdAt.toISOString() };
  }
}
