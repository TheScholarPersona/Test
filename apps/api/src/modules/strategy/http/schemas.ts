import { BarcodeSchema, LocationGroupNameSchema } from '@wms/shared';
import { z } from 'zod';
import { pageOf } from '../../../http/common-schemas.js';
import { RulesSchema } from '../domain/rule-set.js';

export { pageOf };

const DecisionPointId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

export const RuleSetIdParam = z.object({ id: z.uuid() });
export const DecisionIdParam = z.object({ id: z.uuid() });

export const RuleSetQuerySchema = z.object({ decisionPoint: DecisionPointId.optional() });

export const CreateRuleSetSchema = z
  .strictObject({
    decisionPoint: DecisionPointId,
    description: z.string().trim().max(255).default(''),
    rules: RulesSchema,
  })
  .meta({ id: 'CreateRuleSet', description: 'Neuer Entwurf; die letzte Regel muss { "always": true } haben' });
export type CreateRuleSet = z.infer<typeof CreateRuleSetSchema>;

export const UpdateRuleSetSchema = z
  .strictObject({ description: z.string().trim().max(255).default(''), rules: RulesSchema })
  .meta({ id: 'UpdateRuleSet' });
export type UpdateRuleSet = z.infer<typeof UpdateRuleSetSchema>;

export const RuleSetDtoSchema = z
  .object({
    id: z.uuid(),
    decisionPoint: z.string(),
    version: z.number().int(),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
    description: z.string(),
    rules: RulesSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    activatedAt: z.iso.datetime().nullable(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'RuleSet' });
export type RuleSetDto = z.infer<typeof RuleSetDtoSchema>;

export const PutawayDecisionRequestSchema = z
  .strictObject({
    barcode: BarcodeSchema,
    group: LocationGroupNameSchema.optional().meta({ description: 'Suchgruppe, falls die Regel keine festlegt' }),
    assign: z.boolean().default(false).meta({ description: 'Gewählten Platz als Ziel der TU setzen' }),
  })
  .meta({ id: 'PutawayDecisionRequest' });
export type PutawayDecisionRequest = z.infer<typeof PutawayDecisionRequestSchema>;

export const PutawaySimulationRequestSchema = z
  .strictObject({
    barcode: BarcodeSchema,
    group: LocationGroupNameSchema.optional(),
    ruleSetId: z.uuid().optional().meta({ description: 'Zu prüfender Regelsatz (auch Entwurf); ohne Angabe der aktive' }),
  })
  .meta({ id: 'PutawaySimulationRequest' });
export type PutawaySimulationRequest = z.infer<typeof PutawaySimulationRequestSchema>;

const CandidateSchema = z.object({
  key: z.string(),
  label: z.string(),
  eligible: z.boolean(),
  violations: z.array(z.object({ rule: z.string(), message: z.string() })),
  score: z.number().nullable(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const DecisionResultSchema = z
  .object({
    id: z.uuid().nullable().meta({ description: 'null bei Simulation' }),
    decisionPoint: z.string(),
    subject: z.string(),
    simulated: z.boolean(),
    ruleSet: z.object({ id: z.uuid(), version: z.number().int(), status: z.string() }),
    rule: z.object({ name: z.string(), index: z.number().int() }),
    strategy: z.string(),
    params: z.record(z.string(), z.unknown()),
    facts: z.record(z.string(), z.unknown()),
    chosen: z.object({ key: z.string(), label: z.string(), score: z.number().nullable() }).nullable(),
    assigned: z.boolean(),
    summary: z.object({ evaluated: z.number().int(), eligible: z.number().int(), excludedByRule: z.record(z.string(), z.number().int()) }),
    candidates: z.array(CandidateSchema).meta({ description: 'Bis zu 20 Kandidaten, geeignete nach Punktzahl zuerst' }),
    note: z.string().optional(),
    attempts: z.number().int(),
    rejectedOnAssign: z.array(z.object({ locationId: z.string(), violations: z.array(z.object({ rule: z.string(), message: z.string() })) })),
    createdAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'StrategyDecision', description: 'Entscheidung mit Begründung (Decision Trace)' });
export type DecisionResult = z.infer<typeof DecisionResultSchema>;

export const DecisionQuerySchema = z.object({
  subject: z.string().min(1).max(100).optional(),
  decisionPoint: DecisionPointId.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type DecisionQuery = z.infer<typeof DecisionQuerySchema>;

export const StrategyCatalogSchema = z
  .object({
    items: z.array(
      z.object({
        id: z.string(),
        description: z.string(),
        fields: z.record(z.string(), z.object({ type: z.string(), description: z.string() })),
        strategies: z.array(z.object({ id: z.string(), description: z.string(), paramsSchema: z.unknown() })),
      }),
    ),
  })
  .meta({ id: 'StrategyCatalog' });
