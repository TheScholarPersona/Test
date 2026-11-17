import { z } from 'zod';
import { type Condition, ConditionSchema, evaluateCondition, type Facts, validateCondition } from './conditions.js';
import type { DecisionPointDefinition } from './types.js';

/** Eine Zeile der Entscheidungstabelle: Wenn `when` zutrifft, gilt `strategy` mit `params`. */
export const RuleSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80),
    when: ConditionSchema,
    strategy: z.string().min(1).max(80),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .meta({ id: 'StrategyRule' });
export type Rule = z.infer<typeof RuleSchema>;

export const RulesSchema = z.array(RuleSchema).min(1).max(100);

/**
 * Prüft einen Regelsatz vollständig gegen den Entscheidungspunkt.
 * Leeres Ergebnis = gültig.
 */
export function validateRules(rules: Rule[], point: DecisionPointDefinition<unknown>): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  rules.forEach((rule, index) => {
    const at = `rules[${index}] (${rule.name})`;
    if (names.has(rule.name)) errors.push(`${at}: Name mehrfach vergeben`);
    names.add(rule.name);
    errors.push(...validateCondition(rule.when, point.fields, `${at}.when`));
    const strategy = point.strategies.find((s) => s.id === rule.strategy);
    if (!strategy) {
      errors.push(`${at}: unbekannte Strategie [${rule.strategy}], verfügbar: ${point.strategies.map((s) => s.id).join(', ')}`);
      return;
    }
    const params = strategy.paramsSchema.safeParse(rule.params);
    if (!params.success) {
      for (const issue of params.error.issues) {
        errors.push(`${at}.params${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`);
      }
    }
  });
  const last = rules[rules.length - 1];
  if (last && !isAlways(last.when)) {
    errors.push(`rules[${rules.length - 1}] (${last.name}): Die letzte Regel muss immer greifen ({ "always": true }) und dient als Rückfall`);
  }
  return errors;
}

/** Erste zutreffende Regel; dank Rückfallregel gibt es in gültigen Regelsätzen immer eine. */
export function selectRule(rules: Rule[], facts: Facts, point: DecisionPointDefinition<unknown>): { rule: Rule; index: number } {
  const index = rules.findIndex((rule) => evaluateCondition(rule.when, facts, point.fields));
  if (index < 0) {
    throw new Error('Keine Regel greift – der Regelsatz hat keine Rückfallregel');
  }
  return { rule: rules[index]!, index };
}

const isAlways = (condition: Condition) => 'always' in condition;
