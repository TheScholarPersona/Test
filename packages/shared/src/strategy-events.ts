import { z } from 'zod';
import { defineEvent } from './events.js';
import { QuantitySchema } from './quantity.js';

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

/** Auslagerentscheidung: welcher Bestand für einen Bedarf genommen wird. */
export const AllocationDecidedEvent = defineEvent(
  'allocation.decided',
  1,
  z.object({
    decisionId: z.uuid(),
    subject: z.string(),
    sku: z.string(),
    requested: QuantitySchema,
    allocated: QuantitySchema,
    ruleSetVersion: z.number().int(),
    ruleName: z.string(),
    strategy: z.string(),
    picks: z.array(z.object({ stockItemId: z.uuid(), barcode: z.string(), quantity: QuantitySchema })),
  }),
);
