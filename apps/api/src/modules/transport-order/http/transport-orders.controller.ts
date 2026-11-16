import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { toTransportOrderDto } from '../application/mappers.js';
import { TransportOrderService } from '../application/transport-order.service.js';
import {
  type CreateTransportOrder,
  CreateTransportOrderSchema,
  type FailInput,
  FailSchema,
  type FinishInput,
  FinishSchema,
  pageOf,
  type ReasonInput,
  ReasonSchema,
  StartPendingResultSchema,
  type TransportOrderDto,
  TransportOrderDtoSchema,
  TransportOrderNumberParam,
  type TransportOrderQuery,
  TransportOrderQuerySchema,
} from './schemas.js';

const TAGS = ['Transportaufträge'];
const PATH = '/v1/transport-orders';
type NumberParam = { number: string };
const numberPipe = () => new ZodValidationPipe(TransportOrderNumberParam);

@Controller('v1/transport-orders')
export class TransportOrdersController {
  constructor(
    private readonly orders: TransportOrderService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Transportauftrag', schema: TransportOrderDtoSchema };
    const p = TransportOrderNumberParam;
    docs.route({ method: 'get', path: PATH, summary: 'Transportaufträge in Startreihenfolge (Priorität, Alter)', tags: TAGS, query: TransportOrderQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(TransportOrderDtoSchema) }, errors: [400] });
    docs.route({ method: 'post', path: PATH, summary: 'Transportauftrag anlegen (und starten, wenn möglich)', tags: TAGS, body: CreateTransportOrderSchema, response: { ...one, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/start-pending`, summary: 'Wartende Aufträge starten, soweit möglich', tags: TAGS, response: { status: 200, description: 'Ergebnis', schema: StartPendingResultSchema } });
    docs.route({ method: 'get', path: `${PATH}/{number}`, summary: 'Transportauftrag lesen', tags: TAGS, params: p, response: one, errors: [404] });
    docs.route({ method: 'post', path: `${PATH}/{number}/start`, summary: 'Starten (INITIALIZED → STARTED)', tags: TAGS, params: p, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/interrupt`, summary: 'Unterbrechen (STARTED → INTERRUPTED)', tags: TAGS, params: p, body: ReasonSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/resume`, summary: 'Fortsetzen (INTERRUPTED → STARTED)', tags: TAGS, params: p, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/finish`, summary: 'Abschließen und nächsten Auftrag der TU starten', tags: TAGS, params: p, body: FinishSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/cancel`, summary: 'Stornieren', tags: TAGS, params: p, body: ReasonSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{number}/fail`, summary: 'Als gescheitert markieren', tags: TAGS, params: p, body: FailSchema, response: one, errors: [400, 404, 409] });
  }

  @Get()
  async list(@Query(new ZodValidationPipe(TransportOrderQuerySchema)) query: TransportOrderQuery): Promise<{ items: TransportOrderDto[]; total: number }> {
    const { items, total } = await this.orders.list(query);
    return { items: items.map(toTransportOrderDto), total };
  }

  @Post()
  async create(@Body(new ZodValidationPipe(CreateTransportOrderSchema)) body: CreateTransportOrder): Promise<TransportOrderDto> {
    return toTransportOrderDto(await this.orders.create(body));
  }

  @Post('start-pending')
  @HttpCode(HttpStatus.OK)
  startPending(): Promise<z.infer<typeof StartPendingResultSchema>> {
    return this.orders.startPending();
  }

  @Get(':number')
  async get(@Param(numberPipe()) { number }: NumberParam): Promise<TransportOrderDto> {
    return toTransportOrderDto(await this.orders.get(number));
  }

  @Post(':number/start')
  @HttpCode(HttpStatus.OK)
  async start(@Param(numberPipe()) { number }: NumberParam): Promise<TransportOrderDto> {
    return toTransportOrderDto(await this.orders.start(number));
  }

  @Post(':number/interrupt')
  @HttpCode(HttpStatus.OK)
  async interrupt(@Param(numberPipe()) { number }: NumberParam, @Body(new ZodValidationPipe(ReasonSchema)) body: ReasonInput): Promise<TransportOrderDto> {
    return toTransportOrderDto(await this.orders.interrupt(number, body));
  }

  @Post(':number/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@Param(numberPipe()) { number }: NumberParam): Promise<TransportOrderDto> {
    return toTransportOrderDto(await this.orders.resume(number));
  }

  @Post(':number/finish')
  @HttpCode(HttpStatus.OK)
  async finish(@Param(numberPipe()) { number }: NumberParam, @Body(new ZodValidationPipe(FinishSchema)) body: FinishInput): Promise<TransportOrderDto> {
    return toTransportOrderDto(await this.orders.finish(number, body));
  }

  @Post(':number/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param(numberPipe()) { number }: NumberParam, @Body(new ZodValidationPipe(ReasonSchema)) body: ReasonInput): Promise<TransportOrderDto> {
    return toTransportOrderDto(await this.orders.cancel(number, body));
  }

  @Post(':number/fail')
  @HttpCode(HttpStatus.OK)
  async fail(@Param(numberPipe()) { number }: NumberParam, @Body(new ZodValidationPipe(FailSchema)) body: FailInput): Promise<TransportOrderDto> {
    return toTransportOrderDto(await this.orders.fail(number, body));
  }
}
