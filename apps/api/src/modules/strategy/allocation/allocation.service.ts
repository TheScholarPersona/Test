import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { AllocationDecidedEvent, type QuantityDto } from '@wms/shared';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { InventoryService } from '../../inventory/index.js';
import { DecisionEngine } from '../application/decision-engine.js';
import { RuleSetService } from '../application/rule-set.service.js';
import { StrategyDecision } from '../entities/decision.entity.js';
import type { StrategyRuleSet } from '../entities/rule-set.entity.js';
import type { DecisionResult } from '../http/schemas.js';
import type { PlannedPick } from './allocation-ranking.js';
import { ALLOCATION, type AllocationContext, AllocationDecisionPoint, type AllocationEvaluation } from './allocation.point.js';

const TRACE_CANDIDATES = 20;

export interface AllocationRequest {
  sku: string;
  /** In der Basiseinheit oder einer alternativen Einheit des Produkts. */
  quantity: QuantityDto;
  lot?: string | null | undefined;
  /** Gegenstand der Entscheidung, z. B. `OUT-1/2` (Auftrag/Position). */
  subject: string;
  orderPriority?: string | null | undefined;
  customer?: string | null | undefined;
}

export interface AllocationResult {
  decision: DecisionResult;
  /** Geplante Entnahmen in Reihenfolge; Menge in der Basiseinheit. */
  plan: PlannedPick[];
  requested: QuantityDto;
  allocated: QuantityDto;
  shortfall: QuantityDto;
}

/**
 * Auslagerentscheidung: wählt mit dem aktiven Regelsatz die Bestandsposten
 * für einen Bedarf. Vor der Entscheidung werden alle TUs mit Bestand des
 * Produkts gesperrt (in fester Reihenfolge), damit gleichzeitige Zuteilungen
 * nicht denselben Bestand planen; der Aufrufer reserviert in derselben Transaktion.
 */
@Injectable()
export class AllocationService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly inventory: InventoryService,
    private readonly ruleSets: RuleSetService,
    private readonly engine: DecisionEngine,
    private readonly point: AllocationDecisionPoint,
  ) {}

  /** Echte Entscheidung (gespeichert) innerhalb der Transaktion des Aufrufers. */
  async decideIn(tx: EntityManager, request: AllocationRequest): Promise<AllocationResult> {
    return this.run(tx, request, await this.ruleSets.active(tx, ALLOCATION), false);
  }

  /** Probelauf mit beliebigem Regelsatz (auch Entwurf); nichts wird gespeichert, gesperrt oder reserviert. */
  simulate(request: AllocationRequest, ruleSetId?: string): Promise<AllocationResult> {
    return this.em.transactional(async (tx) => {
      const ruleSet = ruleSetId ? await this.ruleSets.load(tx, ruleSetId) : await this.ruleSets.active(tx, ALLOCATION);
      return this.run(tx, request, ruleSet, true);
    });
  }

  private async run(tx: EntityManager, request: AllocationRequest, ruleSet: StrategyRuleSet, simulated: boolean): Promise<AllocationResult> {
    const product = await this.inventory.productIn(tx, request.sku);
    const demand = await this.inventory.toBase(tx, product, request.quantity);
    if (!simulated) {
      await this.inventory.lockUnitRows(tx, await this.inventory.unitIdsWithStock(tx, product.sku));
    }
    const data = await this.inventory.allocationCandidates(tx, product.sku, request.lot ?? undefined);
    const ctx: AllocationContext = {
      em: tx,
      sku: product.sku,
      demand,
      lot: request.lot ?? null,
      orderPriority: request.orderPriority ?? null,
      customer: request.customer ?? null,
      today: new Date().toISOString().slice(0, 10),
      ...data,
    };
    const facts = this.point.facts(ctx);
    const run = await this.engine.run(this.point.definition, ruleSet, facts, ctx);
    const evaluation = run.evaluation as AllocationEvaluation;
    const chosen = evaluation.chosen;
    const outcome = {
      summary: this.engine.summarize(evaluation.candidates),
      candidates: evaluation.candidates.slice(0, TRACE_CANDIDATES),
      ...(evaluation.note ? { note: evaluation.note } : {}),
      attempts: 1,
      rejectedOnAssign: [],
      plan: evaluation.plan,
      allocated: evaluation.allocated,
      shortfall: evaluation.shortfall,
    };
    const unit = demand.unit;
    const result: AllocationResult = {
      decision: {
        id: null,
        decisionPoint: ALLOCATION,
        subject: request.subject,
        simulated,
        ruleSet: { id: ruleSet.id, version: ruleSet.ruleSetVersion, status: ruleSet.status },
        rule: { name: run.rule.name, index: run.ruleIndex },
        strategy: run.strategy,
        params: run.params,
        facts,
        chosen: chosen ? { key: chosen.key, label: chosen.label, score: chosen.score } : null,
        assigned: !simulated && evaluation.plan.length > 0,
        summary: outcome.summary,
        candidates: outcome.candidates,
        ...(evaluation.note ? { note: evaluation.note } : {}),
        attempts: 1,
        rejectedOnAssign: [],
        createdAt: null,
      },
      plan: evaluation.plan,
      requested: demand.toDto(),
      allocated: { amount: evaluation.allocated, unit },
      shortfall: { amount: evaluation.shortfall, unit },
    };
    if (simulated) return result;

    const decision = tx.create(StrategyDecision, {
      id: randomUUID(),
      decisionPoint: ALLOCATION,
      subject: request.subject,
      ruleSetId: ruleSet.id,
      ruleSetVersion: ruleSet.ruleSetVersion,
      ruleName: run.rule.name,
      strategy: run.strategy,
      params: run.params,
      facts,
      outcome,
      chosenKey: chosen?.key ?? null,
      chosenLabel: chosen?.label ?? null,
      assigned: result.decision.assigned,
    });
    this.outbox.record(tx, AllocationDecidedEvent, {
      decisionId: decision.id,
      subject: request.subject,
      sku: product.sku,
      requested: demand.toDto(),
      allocated: { amount: evaluation.allocated, unit },
      ruleSetVersion: ruleSet.ruleSetVersion,
      ruleName: run.rule.name,
      strategy: run.strategy,
      picks: evaluation.plan.map((p) => ({ stockItemId: p.key, barcode: p.barcode, quantity: { amount: p.quantity, unit } })),
    });
    await tx.flush();
    result.decision = { ...result.decision, id: decision.id, createdAt: decision.createdAt.toISOString() };
    return result;
  }
}
