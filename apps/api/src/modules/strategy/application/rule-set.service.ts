import { randomUUID } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { StrategyRuleSetActivatedEvent } from '@wms/shared';
import { DomainError, NotFoundError, RuleViolationError } from '../../../common/domain-error.js';
import { OutboxService } from '../../../infrastructure/outbox/outbox.service.js';
import { type Rule, validateRules } from '../domain/rule-set.js';
import { StrategyRuleSet } from '../entities/rule-set.entity.js';
import { StrategyRegistry } from './strategy-registry.js';

export interface RuleSetInput {
  description: string;
  rules: Rule[];
}

@Injectable()
export class RuleSetService {
  constructor(
    private readonly em: EntityManager,
    private readonly outbox: OutboxService,
    private readonly registry: StrategyRegistry,
  ) {}

  list(decisionPoint?: string): Promise<StrategyRuleSet[]> {
    return this.em.find(StrategyRuleSet, decisionPoint ? { decisionPoint } : {}, { orderBy: { decisionPoint: 'asc', ruleSetVersion: 'desc' } });
  }

  get(id: string): Promise<StrategyRuleSet> {
    return this.load(this.em, id);
  }

  /** Aktiver Regelsatz eines Entscheidungspunkts. */
  async active(em: EntityManager, decisionPoint: string): Promise<StrategyRuleSet> {
    const ruleSet = await em.findOne(StrategyRuleSet, { decisionPoint, status: 'ACTIVE' });
    if (!ruleSet) {
      throw new RuleViolationError('NO_ACTIVE_RULE_SET', `Für [${decisionPoint}] ist kein Regelsatz aktiv; bitte einen Entwurf anlegen und aktivieren`, {
        decisionPoint,
      });
    }
    return ruleSet;
  }

  /** Legt einen Entwurf mit der nächsten Versionsnummer an. */
  create(decisionPoint: string, input: RuleSetInput): Promise<StrategyRuleSet> {
    this.assertValid(decisionPoint, input.rules);
    return this.em.transactional(async (tx) => {
      const latest = await tx.findOne(StrategyRuleSet, { decisionPoint }, { orderBy: { ruleSetVersion: 'desc' } });
      return tx.create(StrategyRuleSet, {
        id: randomUUID(),
        decisionPoint,
        ruleSetVersion: (latest?.ruleSetVersion ?? 0) + 1,
        status: 'DRAFT',
        description: input.description,
        rules: input.rules,
        activatedAt: null,
        archivedAt: null,
      });
    });
  }

  /** Nur Entwürfe sind änderbar; aktive und archivierte Regelsätze bleiben, wie sie waren. */
  update(id: string, input: RuleSetInput): Promise<StrategyRuleSet> {
    return this.em.transactional(async (tx) => {
      const ruleSet = await this.load(tx, id);
      this.assertDraft(ruleSet);
      this.assertValid(ruleSet.decisionPoint, input.rules);
      ruleSet.description = input.description;
      ruleSet.rules = input.rules;
      return ruleSet;
    });
  }

  /** Aktiviert einen Entwurf; der bisher aktive Regelsatz wird archiviert. */
  activate(id: string): Promise<StrategyRuleSet> {
    return this.em.transactional(async (tx) => {
      const ruleSet = await this.load(tx, id);
      this.assertDraft(ruleSet);
      // Strategien können sich seit dem Anlegen geändert haben: vor der Aktivierung erneut prüfen.
      this.assertValid(ruleSet.decisionPoint, ruleSet.rules);
      const previous = await tx.findOne(StrategyRuleSet, { decisionPoint: ruleSet.decisionPoint, status: 'ACTIVE' });
      if (previous) {
        previous.status = 'ARCHIVED';
        previous.archivedAt = new Date();
        // Erst archivieren, dann aktivieren: Die Datenbank erlaubt nur einen aktiven Regelsatz.
        await tx.flush();
      }
      ruleSet.status = 'ACTIVE';
      ruleSet.activatedAt = new Date();
      this.outbox.record(tx, StrategyRuleSetActivatedEvent, {
        id: ruleSet.id,
        decisionPoint: ruleSet.decisionPoint,
        version: ruleSet.ruleSetVersion,
        previousVersion: previous?.ruleSetVersion ?? null,
      });
      return ruleSet;
    });
  }

  delete(id: string): Promise<void> {
    return this.em.transactional(async (tx) => {
      const ruleSet = await this.load(tx, id);
      this.assertDraft(ruleSet);
      tx.remove(ruleSet);
    });
  }

  async load(em: EntityManager, id: string): Promise<StrategyRuleSet> {
    const ruleSet = await em.findOne(StrategyRuleSet, { id });
    if (!ruleSet) {
      throw new NotFoundError('RULE_SET_NOT_FOUND', `Regelsatz [${id}] existiert nicht`, { id });
    }
    return ruleSet;
  }

  private assertValid(decisionPoint: string, rules: Rule[]): void {
    const errors = validateRules(rules, this.registry.get(decisionPoint));
    if (errors.length > 0) {
      throw new DomainError('invalid', 'RULE_SET_INVALID', `Regelsatz ungültig: ${errors.join('; ')}`, { errors });
    }
  }

  private assertDraft(ruleSet: StrategyRuleSet): void {
    if (ruleSet.status !== 'DRAFT') {
      throw new RuleViolationError(
        'RULE_SET_NOT_DRAFT',
        `Regelsatz v${ruleSet.ruleSetVersion} ist ${ruleSet.status} und kann nicht geändert werden; bitte einen neuen Entwurf anlegen`,
        { id: ruleSet.id, status: ruleSet.status },
      );
    }
  }
}
