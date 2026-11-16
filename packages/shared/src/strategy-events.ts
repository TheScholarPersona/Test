import { z } from 'zod';
import { defineEvent } from './events.js';

/** Events des Strategie-Kerns. */

export const StrategyRuleSetActivatedEvent = defineEvent(
  'strategy-rule-set.activated',
  1,
  z.object({
    id: z.uuid(),
    decisionPoint: z.string(),
    version: z.number().int(),
    previousVersion: z.number().int().nullable(),
  }),
);

/** Einlagerentscheidung getroffen (und ggf. als Ziel der TU zugewiesen). */
export const PutawayDecidedEvent = defineEvent(
  'putaway.decided',
  1,
  z.object({
    decisionId: z.uuid(),
    barcode: z.string(),
    ruleSetVersion: z.number().int(),
    ruleName: z.string(),
    strategy: z.string(),
    chosen: z.object({ id: z.uuid(), locationId: z.string() }).nullable(),
    assigned: z.boolean(),
  }),
);
