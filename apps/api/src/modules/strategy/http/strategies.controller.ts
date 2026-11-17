import { type AllocationResult, AllocationService } from '../allocation/allocation.service.js';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { itemsOf } from '../../../http/common-schemas.js';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { DecisionService } from '../application/decision.service.js';
import { RuleSetService } from '../application/rule-set.service.js';
import { StrategyRegistry } from '../application/strategy-registry.js';
import type { StrategyRuleSet } from '../entities/rule-set.entity.js';
import { PutawayService } from '../putaway/putaway.service.js';
import {
  type CreateRuleSet,
  CreateRuleSetSchema,
  DecisionIdParam,
  type DecisionQuery,
  DecisionQuerySchema,
  type DecisionResult,
  DecisionResultSchema,
  pageOf,
  type PutawayDecisionRequest,
  PutawayDecisionRequestSchema,
  type PutawaySimulationRequest,
  PutawaySimulationRequestSchema,
  type RuleSetDto,
  RuleSetDtoSchema,
  RuleSetIdParam,
  RuleSetQuerySchema,
  StrategyCatalogSchema,
  type UpdateRuleSet,
  UpdateRuleSetSchema,
  AllocationResultSchema,
  type AllocationSimulationRequest,
  AllocationSimulationRequestSchema,
} from './schemas.js';

const TAGS = ['Strategien'];
type IdParam = { id: string };

const toRuleSetDto = (r: StrategyRuleSet): RuleSetDto => ({
  id: r.id,
  decisionPoint: r.decisionPoint,
  version: r.ruleSetVersion,
  status: r.status,
  description: r.description,
  rules: r.rules,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  activatedAt: r.activatedAt?.toISOString() ?? null,
  archivedAt: r.archivedAt?.toISOString() ?? null,
});

@Controller('v1')
export class StrategiesController {
  constructor(
    private readonly registry: StrategyRegistry,
    private readonly ruleSets: RuleSetService,
    private readonly putaway: PutawayService,
    private readonly allocation: AllocationService,
    private readonly decisions: DecisionService,
    docs: ApiDocumentation,
  ) {
    const ruleSet = { status: 200, description: 'Regelsatz', schema: RuleSetDtoSchema };
    const decision = { status: 200, description: 'Entscheidung mit Begründung', schema: DecisionResultSchema };
    docs.route({ method: 'get', path: '/v1/strategies', summary: 'Entscheidungspunkte, Felder für Bedingungen und Strategien mit Parameterschema', tags: TAGS, response: { status: 200, description: 'Katalog', schema: StrategyCatalogSchema } });
    docs.route({ method: 'get', path: '/v1/strategy-rule-sets', summary: 'Regelsätze (neueste Version zuerst)', tags: TAGS, query: RuleSetQuerySchema, response: { status: 200, description: 'Liste', schema: itemsOf(RuleSetDtoSchema) } });
    docs.route({ method: 'post', path: '/v1/strategy-rule-sets', summary: 'Regelsatz-Entwurf anlegen (nächste Version)', tags: TAGS, body: CreateRuleSetSchema, response: { ...ruleSet, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: '/v1/strategy-rule-sets/{id}', summary: 'Regelsatz lesen', tags: TAGS, params: RuleSetIdParam, response: ruleSet, errors: [404] });
    docs.route({ method: 'put', path: '/v1/strategy-rule-sets/{id}', summary: 'Entwurf ändern', tags: TAGS, params: RuleSetIdParam, body: UpdateRuleSetSchema, response: ruleSet, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: '/v1/strategy-rule-sets/{id}/activate', summary: 'Entwurf aktivieren (bisher aktiver wird archiviert)', tags: TAGS, params: RuleSetIdParam, response: ruleSet, errors: [400, 404, 409] });
    docs.route({ method: 'delete', path: '/v1/strategy-rule-sets/{id}', summary: 'Entwurf löschen', tags: TAGS, params: RuleSetIdParam, response: { status: 204, description: 'Gelöscht' }, errors: [404, 409] });
    docs.route({ method: 'post', path: '/v1/putaway/decisions', summary: 'Einlagerplatz bestimmen (aktiver Regelsatz), optional als Ziel zuweisen', tags: TAGS, body: PutawayDecisionRequestSchema, response: { ...decision, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: '/v1/putaway/simulations', summary: 'Einlagerentscheidung simulieren (auch mit Entwurf), ohne zu speichern', tags: TAGS, body: PutawaySimulationRequestSchema, response: decision, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: '/v1/allocation/simulations', summary: 'Auslagerentscheidung simulieren (auch mit Entwurf): Plan mit Begründung, ohne Reservierung', tags: TAGS, body: AllocationSimulationRequestSchema, response: { status: 200, description: 'Plan', schema: AllocationResultSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: '/v1/strategy-decisions', summary: 'Gespeicherte Entscheidungen (neueste zuerst)', tags: TAGS, query: DecisionQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(DecisionResultSchema) } });
    docs.route({ method: 'get', path: '/v1/strategy-decisions/{id}', summary: 'Entscheidung mit Begründung lesen', tags: TAGS, params: DecisionIdParam, response: decision, errors: [404] });
  }

  @Get('strategies')
  catalog(): z.infer<typeof StrategyCatalogSchema> {
    return {
      items: this.registry.all().map((point) => ({
        id: point.id,
        description: point.description,
        fields: point.fields,
        strategies: point.strategies.map((s) => ({ id: s.id, description: s.description, paramsSchema: z.toJSONSchema(s.paramsSchema, { io: 'input' }) })),
      })),
    };
  }

  @Get('strategy-rule-sets')
  async listRuleSets(@Query(new ZodValidationPipe(RuleSetQuerySchema)) query: { decisionPoint?: string }): Promise<{ items: RuleSetDto[] }> {
    return { items: (await this.ruleSets.list(query.decisionPoint)).map(toRuleSetDto) };
  }

  @Post('strategy-rule-sets')
  async createRuleSet(@Body(new ZodValidationPipe(CreateRuleSetSchema)) body: CreateRuleSet): Promise<RuleSetDto> {
    return toRuleSetDto(await this.ruleSets.create(body.decisionPoint, body));
  }

  @Get('strategy-rule-sets/:id')
  async getRuleSet(@Param(new ZodValidationPipe(RuleSetIdParam)) { id }: IdParam): Promise<RuleSetDto> {
    return toRuleSetDto(await this.ruleSets.get(id));
  }

  @Put('strategy-rule-sets/:id')
  async updateRuleSet(
    @Param(new ZodValidationPipe(RuleSetIdParam)) { id }: IdParam,
    @Body(new ZodValidationPipe(UpdateRuleSetSchema)) body: UpdateRuleSet,
  ): Promise<RuleSetDto> {
    return toRuleSetDto(await this.ruleSets.update(id, body));
  }

  @Post('strategy-rule-sets/:id/activate')
  @HttpCode(HttpStatus.OK)
  async activate(@Param(new ZodValidationPipe(RuleSetIdParam)) { id }: IdParam): Promise<RuleSetDto> {
    return toRuleSetDto(await this.ruleSets.activate(id));
  }

  @Delete('strategy-rule-sets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRuleSet(@Param(new ZodValidationPipe(RuleSetIdParam)) { id }: IdParam): Promise<void> {
    await this.ruleSets.delete(id);
  }

  @Post('putaway/decisions')
  decide(@Body(new ZodValidationPipe(PutawayDecisionRequestSchema)) body: PutawayDecisionRequest): Promise<DecisionResult> {
    return this.putaway.decide(body);
  }

  @Post('putaway/simulations')
  @HttpCode(HttpStatus.OK)
  simulate(@Body(new ZodValidationPipe(PutawaySimulationRequestSchema)) body: PutawaySimulationRequest): Promise<DecisionResult> {
    return this.putaway.simulate({ barcode: body.barcode, group: body.group }, body.ruleSetId);
  }

  @Post('allocation/simulations')
  @HttpCode(HttpStatus.OK)
  simulateAllocation(@Body(new ZodValidationPipe(AllocationSimulationRequestSchema)) body: AllocationSimulationRequest): Promise<AllocationResult> {
    const { ruleSetId, ...request } = body;
    return this.allocation.simulate({ ...request, subject: `simulation:${request.sku}` }, ruleSetId);
  }

  @Get('strategy-decisions')
  listDecisions(@Query(new ZodValidationPipe(DecisionQuerySchema)) query: DecisionQuery): Promise<{ items: DecisionResult[]; total: number }> {
    return this.decisions.list(query);
  }

  @Get('strategy-decisions/:id')
  getDecision(@Param(new ZodValidationPipe(DecisionIdParam)) { id }: IdParam): Promise<DecisionResult> {
    return this.decisions.get(id);
  }
}
