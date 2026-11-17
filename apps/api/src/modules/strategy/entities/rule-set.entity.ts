import { defineEntity, p } from '@mikro-orm/postgresql';
import type { Rule } from '../domain/rule-set.js';

export const RULE_SET_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type RuleSetStatus = (typeof RULE_SET_STATUSES)[number];

/**
 * Versionierte Entscheidungstabelle eines Entscheidungspunkts.
 * Lebenszyklus: DRAFT (änderbar, simulierbar) → ACTIVE (unveränderlich,
 * höchstens einer je Entscheidungspunkt) → ARCHIVED.
 */
const StrategyRuleSetSchema = defineEntity({
  name: 'StrategyRuleSet',
  tableName: 'strategy_rule_set',
  properties: {
    id: p.uuid().primary(),
    decisionPoint: p.string().length(40),
    ruleSetVersion: p.integer(),
    status: p.enum(RULE_SET_STATUSES).default('DRAFT'),
    description: p.string().length(255).default(''),
    rules: p.json<Rule[]>(),
    createdAt: p.datetime().onCreate(() => new Date()),
    updatedAt: p.datetime().onCreate(() => new Date()).onUpdate(() => new Date()),
    activatedAt: p.datetime().nullable(),
    archivedAt: p.datetime().nullable(),
    version: p.integer().version(),
  },
  uniques: [
    { properties: ['decisionPoint', 'ruleSetVersion'] },
    // Höchstens ein aktiver Regelsatz je Entscheidungspunkt – auch bei gleichzeitiger Aktivierung.
    { name: 'strategy_rule_set_one_active', properties: ['decisionPoint'], where: { status: 'ACTIVE' } },
  ],
});

export class StrategyRuleSet extends StrategyRuleSetSchema.class {}
StrategyRuleSetSchema.setClass(StrategyRuleSet);
