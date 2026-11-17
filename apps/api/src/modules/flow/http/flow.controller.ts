import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import type { Location } from '../../layout/index.js';
import { FlowConfigService, type RouteWithSteps } from '../application/flow-config.service.js';
import { type FlowResult, FlowService } from '../application/flow.service.js';
import { PROGRAMS } from '../domain/programs.js';
import type { FlowAction, FlowDecision, FlowRoute } from '../entities/flow.entities.js';
import {
  type ActionDto,
  ActionDtoSchema,
  ActionNameParam,
  type CreateAction,
  CreateActionSchema,
  type CreateRoute,
  CreateRouteSchema,
  type DecisionDto,
  DecisionDtoSchema,
  type DecisionQuery,
  DecisionQuerySchema,
  type DeviceEvent,
  DeviceEventSchema,
  EventResultSchema,
  type ManualCommand,
  ManualCommandSchema,
  pageOf,
  ProgramDtoSchema,
  type ReplaceSteps,
  ReplaceStepsSchema,
  type RouteDto,
  RouteDtoSchema,
  RouteIdParam,
  type UpdateAction,
  UpdateActionSchema,
  type UpdateRoute,
  UpdateRouteSchema,
} from './schemas.js';

const TAGS = ['Materialfluss'];
const P = '/v1/flow';

const place = (l: Location) => ({ id: l.id, locationId: l.locationId, plcCode: l.plcCode ?? null });
const placeOrGroup = (location: Location | null | undefined, group: string | null | undefined) => (location ? { location: place(location) } : { group: group! });

function toRouteDto({ route, steps }: RouteWithSteps): RouteDto {
  return {
    routeId: route.routeId,
    description: route.description,
    source: placeOrGroup(route.sourceLocation as Location | null, route.sourceGroup),
    target: placeOrGroup(route.targetLocation as Location | null, route.targetGroup),
    enabled: route.enabled,
    steps: steps.map((s) => ({ pos: s.pos, from: place(s.from as Location), next: place(s.next as Location), unitType: s.unitType ?? null, enabled: s.enabled })),
    version: route.version,
    updatedAt: route.updatedAt.toISOString(),
  };
}

const toActionDto = (a: FlowAction): ActionDto => ({
  name: a.name,
  description: a.description,
  eventType: a.eventType,
  routeId: (a.route as FlowRoute | null)?.routeId ?? null,
  place: a.location || a.group ? placeOrGroup(a.location as Location | null, a.group) : null,
  program: a.program,
  params: a.params,
  enabled: a.enabled,
  version: a.version,
  updatedAt: a.updatedAt.toISOString(),
});

const toDecisionDto = (d: FlowDecision, dryRun = false): DecisionDto => ({
  id: d.id,
  eventType: d.eventType,
  barcode: d.barcode ?? null,
  deviceId: d.deviceId ?? null,
  locationId: d.locationCoordinate,
  orderNumber: d.orderNumber ?? null,
  routeId: d.routeId ?? null,
  action: d.actionName ?? null,
  program: d.program ?? null,
  outcome: d.outcome,
  next: d.nextCoordinate ?? null,
  trace: d.trace,
  dryRun,
  createdAt: (d.createdAt ?? new Date()).toISOString(),
});

const toResult = (r: FlowResult): z.infer<typeof EventResultSchema> => ({
  decision: toDecisionDto(r.decision, r.dryRun),
  command: r.command ? { barcode: r.command.barcode, from: place(r.command.from), to: place(r.command.to) } : null,
});

@Controller('v1/flow')
export class FlowController {
  constructor(
    private readonly config: FlowConfigService,
    private readonly flow: FlowService,
    docs: ApiDocumentation,
  ) {
    const route = { status: 200, description: 'Route', schema: RouteDtoSchema };
    const action = { status: 200, description: 'Action', schema: ActionDtoSchema };
    docs.route({ method: 'post', path: `${P}/events`, summary: 'Geräte-Ereignis verarbeiten (Antwort enthält Fahrbefehl und Begründung)', tags: TAGS, body: DeviceEventSchema, response: { status: 200, description: 'Entscheidung', schema: EventResultSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${P}/commands`, summary: 'Fahrbefehl von außen senden (z. B. Antwort eines Node-RED-Programms)', tags: TAGS, body: ManualCommandSchema, response: { status: 200, description: 'Gesendet', schema: EventResultSchema }, errors: [400, 404] });
    docs.route({ method: 'get', path: `${P}/decisions`, summary: 'Entscheidungsprotokoll (neueste zuerst)', tags: TAGS, query: DecisionQuerySchema, response: { status: 200, description: 'Entscheidungen', schema: pageOf(DecisionDtoSchema) } });
    docs.route({ method: 'get', path: `${P}/programs`, summary: 'Eingebaute Programme mit Parameter-Schema', tags: TAGS, response: { status: 200, description: 'Programme', schema: z.object({ items: z.array(ProgramDtoSchema) }) } });
    docs.route({ method: 'get', path: `${P}/routes`, summary: 'Routen mit Schritten', tags: TAGS, response: { status: 200, description: 'Routen', schema: z.object({ items: z.array(RouteDtoSchema) }) } });
    docs.route({ method: 'post', path: `${P}/routes`, summary: 'Route anlegen', tags: TAGS, body: CreateRouteSchema, response: { ...route, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: `${P}/routes/{routeId}`, summary: 'Route lesen', tags: TAGS, params: RouteIdParam, response: route, errors: [404] });
    docs.route({ method: 'patch', path: `${P}/routes/{routeId}`, summary: 'Route ändern (wirkt sofort)', tags: TAGS, params: RouteIdParam, body: UpdateRouteSchema, response: route, errors: [400, 404] });
    docs.route({ method: 'put', path: `${P}/routes/{routeId}/steps`, summary: 'Schritte der Route ersetzen (wirkt sofort)', tags: TAGS, params: RouteIdParam, body: ReplaceStepsSchema, response: route, errors: [400, 404] });
    docs.route({ method: 'delete', path: `${P}/routes/{routeId}`, summary: 'Route löschen', tags: TAGS, params: RouteIdParam, response: { status: 204, description: 'Gelöscht' }, errors: [404, 409] });
    docs.route({ method: 'get', path: `${P}/actions`, summary: 'Action-Matrix', tags: TAGS, response: { status: 200, description: 'Actions', schema: z.object({ items: z.array(ActionDtoSchema) }) } });
    docs.route({ method: 'post', path: `${P}/actions`, summary: 'Action anlegen (Parameter werden gegen das Programm geprüft)', tags: TAGS, body: CreateActionSchema, response: { ...action, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'patch', path: `${P}/actions/{name}`, summary: 'Action ändern (wirkt sofort)', tags: TAGS, params: ActionNameParam, body: UpdateActionSchema, response: action, errors: [400, 404] });
    docs.route({ method: 'delete', path: `${P}/actions/{name}`, summary: 'Action löschen', tags: TAGS, params: ActionNameParam, response: { status: 204, description: 'Gelöscht' }, errors: [404] });
  }

  @Post('events')
  @HttpCode(HttpStatus.OK)
  async event(@Body(new ZodValidationPipe(DeviceEventSchema)) body: DeviceEvent): Promise<z.infer<typeof EventResultSchema>> {
    return toResult(await this.flow.handle(body));
  }

  @Post('commands')
  @HttpCode(HttpStatus.OK)
  async command(@Body(new ZodValidationPipe(ManualCommandSchema)) body: ManualCommand): Promise<z.infer<typeof EventResultSchema>> {
    return toResult(await this.flow.command(body));
  }

  @Get('decisions')
  async decisions(@Query(new ZodValidationPipe(DecisionQuerySchema)) q: DecisionQuery): Promise<{ items: DecisionDto[]; total: number }> {
    const [items, total] = await this.flow.listDecisions(q.barcode, q.limit, q.offset);
    return { items: items.map((d) => toDecisionDto(d)), total };
  }

  @Get('programs')
  programs(): { items: z.infer<typeof ProgramDtoSchema>[] } {
    return {
      items: Object.entries(PROGRAMS).map(([key, p]) => ({ key, description: p.description, events: [...p.events], params: z.toJSONSchema(p.params) })),
    };
  }

  @Get('routes')
  async routes(): Promise<{ items: RouteDto[] }> {
    return { items: (await this.config.listRoutes()).map(toRouteDto) };
  }

  @Post('routes')
  async createRoute(@Body(new ZodValidationPipe(CreateRouteSchema)) body: CreateRoute): Promise<RouteDto> {
    return toRouteDto(await this.config.createRoute(body));
  }

  @Get('routes/:routeId')
  async getRoute(@Param(new ZodValidationPipe(RouteIdParam)) { routeId }: { routeId: string }): Promise<RouteDto> {
    return toRouteDto(await this.config.getRoute(routeId));
  }

  @Patch('routes/:routeId')
  async updateRoute(@Param(new ZodValidationPipe(RouteIdParam)) { routeId }: { routeId: string }, @Body(new ZodValidationPipe(UpdateRouteSchema)) body: UpdateRoute): Promise<RouteDto> {
    return toRouteDto(await this.config.updateRoute(routeId, body));
  }

  @Put('routes/:routeId/steps')
  async replaceSteps(@Param(new ZodValidationPipe(RouteIdParam)) { routeId }: { routeId: string }, @Body(new ZodValidationPipe(ReplaceStepsSchema)) body: ReplaceSteps): Promise<RouteDto> {
    return toRouteDto(await this.config.replaceSteps(routeId, body));
  }

  @Delete('routes/:routeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRoute(@Param(new ZodValidationPipe(RouteIdParam)) { routeId }: { routeId: string }): Promise<void> {
    await this.config.deleteRoute(routeId);
  }

  @Get('actions')
  async actions(): Promise<{ items: ActionDto[] }> {
    return { items: (await this.config.listActions()).map(toActionDto) };
  }

  @Post('actions')
  async createAction(@Body(new ZodValidationPipe(CreateActionSchema)) body: CreateAction): Promise<ActionDto> {
    return toActionDto(await this.config.createAction(body));
  }

  @Patch('actions/:name')
  async updateAction(@Param(new ZodValidationPipe(ActionNameParam)) { name }: { name: string }, @Body(new ZodValidationPipe(UpdateActionSchema)) body: UpdateAction): Promise<ActionDto> {
    return toActionDto(await this.config.updateAction(name, body));
  }

  @Delete('actions/:name')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAction(@Param(new ZodValidationPipe(ActionNameParam)) { name }: { name: string }): Promise<void> {
    await this.config.deleteAction(name);
  }
}
