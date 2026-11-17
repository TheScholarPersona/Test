import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { groupState, type LoadedGroup, MovementGroupService } from '../application/movement-group.service.js';
import { toMovementDto } from '../application/mappers.js';
import {
  type AssignMovementGroup,
  AssignMovementGroupSchema,
  type ChangeMovementGroup,
  ChangeMovementGroupSchema,
  type CreateMovementGroup,
  CreateMovementGroupSchema,
  type MovementGroupDto,
  MovementGroupDtoSchema,
  MovementGroupParam,
  type MovementGroupQuery,
  MovementGroupQuerySchema,
  pageOf,
  type StartMovementGroup,
  StartMovementGroupSchema,
} from './schemas.js';

const TAGS = ['Lagerbewegungen'];
const PATH = '/v1/movement-groups';

function toDto({ group, movements }: LoadedGroup): MovementGroupDto {
  const count = (state: string) => movements.filter((m) => m.state === state).length;
  return {
    number: group.number,
    description: group.description ?? null,
    assignedTo: group.assignedTo ?? null,
    state: groupState(movements),
    counts: { open: count('OPEN'), inProgress: count('IN_PROGRESS'), done: count('DONE'), cancelled: count('CANCELLED') },
    movements: movements.map(toMovementDto),
    createdBy: group.createdBy ?? null,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

/** Bewegungsgruppen: Lagerbewegungen bündeln und einem Bediener zuteilen. */
@Controller('v1/movement-groups')
export class MovementGroupsController {
  constructor(
    private readonly groups: MovementGroupService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Bewegungsgruppe', schema: MovementGroupDtoSchema };
    const p = MovementGroupParam;
    docs.route({ method: 'get', path: PATH, summary: 'Bewegungsgruppen, neueste zuerst (Filter: Zustand, Bediener)', tags: TAGS, query: MovementGroupQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(MovementGroupDtoSchema) }, errors: [400] });
    docs.route({ method: 'post', path: PATH, summary: 'Bewegungsgruppe aus offenen Lagerbewegungen bilden', tags: TAGS, body: CreateMovementGroupSchema, response: { ...one, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: `${PATH}/{number}`, summary: 'Bewegungsgruppe mit ihren Bewegungen lesen', tags: TAGS, params: p, response: one, errors: [404] });
    docs.route({ method: 'patch', path: `${PATH}/{number}`, summary: 'Bewegungen aufnehmen oder entfernen, Beschreibung ändern', tags: TAGS, params: p, body: ChangeMovementGroupSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/assign`, summary: 'Einem Bediener zuteilen (null hebt die Zuteilung auf)', tags: TAGS, params: p, body: AssignMovementGroupSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/start`, summary: 'Alle offenen Bewegungen der Gruppe beginnen', tags: TAGS, params: p, body: StartMovementGroupSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/release`, summary: 'Laufende Bewegungen zurückgeben und Zuteilung aufheben', tags: TAGS, params: p, response: one, errors: [404, 409] });
  }

  @Get()
  async list(@Query(new ZodValidationPipe(MovementGroupQuerySchema)) query: MovementGroupQuery): Promise<{ items: MovementGroupDto[]; total: number }> {
    const { items, total } = await this.groups.list(query);
    return { items: items.map(toDto), total };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateMovementGroupSchema)) body: CreateMovementGroup): Promise<MovementGroupDto> {
    return toDto(await this.groups.create(body));
  }

  @Get(':number')
  async get(@Param(new ZodValidationPipe(MovementGroupParam)) { number }: { number: string }): Promise<MovementGroupDto> {
    return toDto(await this.groups.get(number));
  }

  @Patch(':number')
  async change(@Param(new ZodValidationPipe(MovementGroupParam)) { number }: { number: string }, @Body(new ZodValidationPipe(ChangeMovementGroupSchema)) body: ChangeMovementGroup): Promise<MovementGroupDto> {
    return toDto(await this.groups.change(number, body));
  }

  @Post(':number/assign')
  @HttpCode(HttpStatus.OK)
  async assign(@Param(new ZodValidationPipe(MovementGroupParam)) { number }: { number: string }, @Body(new ZodValidationPipe(AssignMovementGroupSchema)) body: AssignMovementGroup): Promise<MovementGroupDto> {
    return toDto(await this.groups.assign(number, body));
  }

  @Post(':number/start')
  @HttpCode(HttpStatus.OK)
  async start(@Param(new ZodValidationPipe(MovementGroupParam)) { number }: { number: string }, @Body(new ZodValidationPipe(StartMovementGroupSchema)) body: StartMovementGroup): Promise<MovementGroupDto> {
    return toDto(await this.groups.start(number, body));
  }

  @Post(':number/release')
  @HttpCode(HttpStatus.OK)
  async release(@Param(new ZodValidationPipe(MovementGroupParam)) { number }: { number: string }): Promise<MovementGroupDto> {
    return toDto(await this.groups.release(number));
  }
}
