import { defineEntity, p } from '@mikro-orm/postgresql';

/**
 * Gespeicherte Entscheidung mit vollständiger Begründung (Decision Trace):
 * welche Regel gegriffen hat, welche Strategie mit welchen Parametern lief,
 * welche Fakten vorlagen, welcher Kandidat gewählt wurde und warum andere
 * ausgeschieden sind.
 */
const StrategyDecisionSchema = defineEntity({
  name: 'StrategyDecision',
  tableName: 'strategy_decision',
  properties: {
    id: p.uuid().primary(),
    decisionPoint: p.string().length(40),
    /** Worum es ging, z. B. Barcode der TU. */
    subject: p.string().length(100).index(),
    ruleSetId: p.uuid(),
    ruleSetVersion: p.integer(),
    ruleName: p.string().length(80),
    strategy: p.string().length(80),
    params: p.json<Record<string, unknown>>(),
    facts: p.json<Record<string, unknown>>(),
    outcome: p.json<Record<string, unknown>>(),
    chosenKey: p.string().length(100).nullable(),
    chosenLabel: p.string().length(100).nullable(),
    assigned: p.boolean().default(false),
    createdAt: p.datetime().onCreate(() => new Date()),
  },
});

export class StrategyDecision extends StrategyDecisionSchema.class {}
StrategyDecisionSchema.setClass(StrategyDecision);
