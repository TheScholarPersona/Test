import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { toMovementDto } from '../application/mappers.js';
import { MovementService } from '../application/movement.service.js';
import {
  type CancelMovement,
  CancelMovementSchema,
  type CompleteMovement,
  CompleteMovementSchema,
  CompletionResultSchema,
  type CreateMovement,
  CreateMovementSchema,
  type MovementDto,
  MovementDtoSchema,
  MovementNumberParam,
  type MovementQuery,
  MovementQuerySchema,
  pageOf,
  type StartMovement,
  StartMovementSchema,
} from './schemas.js';

const TAGS = ['Lagerbewegungen'];
const PATH = '/v1/movements';
type NumberParam = { number: string };

@Controller('v1/movements')
export class MovementsController {
  constructor(
    private readonly movements: MovementService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Lagerbewegung', schema: MovementDtoSchema };
    const p = MovementNumberParam;
    docs.route({ method: 'get', path: PATH, summary: 'Lagerbewegungen, dringendste zuerst (Arbeitsliste)', tags: TAGS, query: MovementQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(MovementDtoSchema) }, errors: [400] });
    docs.route({ method: 'post', path: PATH, summary: 'Lagerbewegung anlegen und Ziel reservieren', tags: TAGS, body: CreateMovementSchema, response: { ...one, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: `${PATH}/{number}`, summary: 'Lagerbewegung lesen', tags: TAGS, params: p, response: one, errors: [404] });
    docs.route({ method: 'post', path: `${PATH}/{number}/start`, summary: 'Bearbeitung beginnen (OPEN → IN_PROGRESS)', tags: TAGS, params: p, body: StartMovementSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/release`, summary: 'Zurückgeben (IN_PROGRESS → OPEN)', tags: TAGS, params: p, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/complete`, summary: 'Abschließen: TU auf Ziel oder tatsächlichen Platz buchen', tags: TAGS, params: p, body: CompleteMovementSchema, response: { status: 200, description: 'Abgeschlossen', schema: CompletionResultSchema }, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/cancel`, summary: 'Stornieren und Zielreservierung freigeben', tags: TAGS, params: p, body: CancelMovementSchema, response: one, errors: [404, 409] });
  }

  @Get()
  async list(@Query(new ZodValidationPipe(MovementQuerySchema)) query: MovementQuery): Promise<{ items: MovementDto[]; total: number }> {
    const { items, total } = await this.movements.list(query);
    return { items: items.map(toMovementDto), total };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateMovementSchema)) body: CreateMovement): Promise<MovementDto> {
    return toMovementDto(await this.movements.create(body));
  }

  @Get(':number')
  async get(@Param(new ZodValidationPipe(MovementNumberParam)) { number }: NumberParam): Promise<MovementDto> {
    return toMovementDto(await this.movements.get(number));
  }

  @Post(':number/start')
  @HttpCode(HttpStatus.OK)
  async start(
    @Param(new ZodValidationPipe(MovementNumberParam)) { number }: NumberParam,
    @Body(new ZodValidationPipe(StartMovementSchema)) body: StartMovement,
  ): Promise<MovementDto> {
    return toMovementDto(await this.movements.start(number, body));
  }

  @Post(':number/release')
  @HttpCode(HttpStatus.OK)
  async release(@Param(new ZodValidationPipe(MovementNumberParam)) { number }: NumberParam): Promise<MovementDto> {
    return toMovementDto(await this.movements.release(number));
  }

  @Post(':number/complete')
  @HttpCode(HttpStatus.OK)
  async complete(
    @Param(new ZodValidationPipe(MovementNumberParam)) { number }: NumberParam,
    @Body(new ZodValidationPipe(CompleteMovementSchema)) body: CompleteMovement,
  ): Promise<z.infer<typeof CompletionResultSchema>> {
    const { movement, violations } = await this.movements.complete(number, body);
    return { movement: toMovementDto(movement), violations };
  }

  @Post(':number/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param(new ZodValidationPipe(MovementNumberParam)) { number }: NumberParam,
    @Body(new ZodValidationPipe(CancelMovementSchema)) body: CancelMovement,
  ): Promise<MovementDto> {
    return toMovementDto(await this.movements.cancel(number, body));
  }
}
