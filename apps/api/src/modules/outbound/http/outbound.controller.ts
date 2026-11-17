import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Quantity } from '@wms/shared';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import type { Product } from '../../inventory/index.js';
import type { Location } from '../../layout/index.js';
import { openDemand } from '../domain/outbound-rules.js';
import { type OrderWithDetails, OutboundService } from '../application/outbound.service.js';
import type { OutboundLine, OutboundOrder, OutboundPick } from '../entities/outbound.entities.js';
import {
  type AllocateInput,
  AllocateSchema,
  type ConfirmPickInput,
  ConfirmPickSchema,
  type CreateOutboundOrder,
  CreateOutboundOrderSchema,
  OrderIdParam,
  type OutboundOrderDto,
  OutboundOrderDtoSchema,
  type OutboundQuery,
  OutboundQuerySchema,
  pageOf,
  type PickDto,
  PickDtoSchema,
  PickParam,
  type PickQuery,
  PickQuerySchema,
  type ReasonInput,
  ReasonSchema,
} from './schemas.js';

const TAGS = ['Auslagerung'];
const PATH = '/v1/outbound-orders';
type Q = PickDto['quantity'];
const q = (amount: string, unit: string) => ({ amount: normalizeDecimal(amount), unit }) as Q;

export function toPickDto(p: OutboundPick): PickDto {
  const line = p.line as OutboundLine;
  return {
    id: p.id,
    orderId: (line.order as OutboundOrder).orderId,
    lineNo: line.lineNo,
    sku: (line.product as Product).sku,
    stockItemId: p.stockItemId,
    barcode: p.barcode,
    locationId: p.locationCoordinate,
    quantity: q(p.quantity, line.unitCode),
    picked: q(p.picked, line.unitCode),
    state: p.state,
    decisionId: p.decisionId ?? null,
    movementNumber: p.movementNumber ?? null,
    transportOrderNumber: p.transportOrderNumber ?? null,
    transportNote: p.transportNote ?? null,
    pickedBy: p.pickedBy ?? null,
    packedInto: p.packedInto ?? null,
    pickedAt: p.pickedAt?.toISOString() ?? null,
  };
}

function shipToOf(order: OutboundOrder): OutboundOrderDto['shipTo'] {
  const shipTo = { name: order.shipToName ?? null, street: order.shipToStreet ?? null, postalCode: order.shipToPostalCode ?? null, city: order.shipToCity ?? null, country: order.shipToCountry ?? null };
  return Object.values(shipTo).some((v) => v !== null) ? shipTo : null;
}

function toOrderDto({ order, lines, picks }: OrderWithDetails): OutboundOrderDto {
  return {
    orderId: order.orderId,
    customer: order.customer ?? null,
    customerCode: order.customerCode ?? null,
    shipTo: shipToOf(order),
    priority: order.priority,
    target: order.targetCoordinate ? { id: (order.target as Location | null)?.id ?? null, locationId: order.targetCoordinate } : null,
    state: order.state,
    closeReason: order.closeReason ?? null,
    lines: lines.map((l) => {
      const amounts = {
        state: l.state,
        quantity: Quantity.of(normalizeDecimal(l.quantity), l.unitCode),
        allocated: Quantity.of(normalizeDecimal(l.allocated), l.unitCode),
        picked: Quantity.of(normalizeDecimal(l.picked), l.unitCode),
      };
      return {
        lineNo: l.lineNo,
        sku: (l.product as Product).sku,
        lot: l.lot ?? null,
        state: l.state,
        quantity: q(l.quantity, l.unitCode),
        allocated: q(l.allocated, l.unitCode),
        picked: q(l.picked, l.unitCode),
        open: openDemand(amounts).toDto() as Q,
      };
    }),
    picks: picks.map(toPickDto),
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

@Controller('v1')
export class OutboundController {
  constructor(
    private readonly outbound: OutboundService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Auslagerauftrag', schema: OutboundOrderDtoSchema };
    docs.route({ method: 'get', path: PATH, summary: 'Auslageraufträge (neueste zuerst)', tags: TAGS, query: OutboundQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(OutboundOrderDtoSchema) } });
    docs.route({ method: 'post', path: PATH, summary: 'Auslagerauftrag anlegen', tags: TAGS, body: CreateOutboundOrderSchema, response: { ...one, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: `${PATH}/{orderId}`, summary: 'Auslagerauftrag mit Positionen und Picks', tags: TAGS, params: OrderIdParam, response: one, errors: [404] });
    docs.route({ method: 'post', path: `${PATH}/{orderId}/allocate`, summary: 'Offenen Bedarf per Auslagerstrategie zuteilen und reservieren', tags: TAGS, params: OrderIdParam, body: AllocateSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{orderId}/picks/{pickId}/confirm`, summary: 'Entnahme quittieren (Abgang gegen Reservierung, ggf. Fehlmenge)', tags: TAGS, params: PickParam, body: ConfirmPickSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{orderId}/complete`, summary: 'Mit Fehlmengen abschließen (keine offenen Picks)', tags: TAGS, params: OrderIdParam, body: ReasonSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{orderId}/cancel`, summary: 'Stornieren, offene Reservierungen freigeben', tags: TAGS, params: OrderIdParam, body: ReasonSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'get', path: '/v1/outbound-picks', summary: 'Pick-Arbeitsliste (nach Platz sortiert)', tags: TAGS, query: PickQuerySchema, response: { status: 200, description: 'Picks', schema: pageOf(PickDtoSchema) } });
  }

  @Get('outbound-orders')
  async list(@Query(new ZodValidationPipe(OutboundQuerySchema)) query: OutboundQuery): Promise<{ items: OutboundOrderDto[]; total: number }> {
    const { items, total } = await this.outbound.list(query);
    return { items: items.map(toOrderDto), total };
  }

  @Post('outbound-orders')
  async create(@Body(new ZodValidationPipe(CreateOutboundOrderSchema)) body: CreateOutboundOrder): Promise<OutboundOrderDto> {
    return toOrderDto(await this.outbound.create(body));
  }

  @Get('outbound-orders/:orderId')
  async get(@Param(new ZodValidationPipe(OrderIdParam)) { orderId }: { orderId: string }): Promise<OutboundOrderDto> {
    return toOrderDto(await this.outbound.get(orderId));
  }

  @Post('outbound-orders/:orderId/allocate')
  @HttpCode(HttpStatus.OK)
  async allocate(@Param(new ZodValidationPipe(OrderIdParam)) { orderId }: { orderId: string }, @Body(new ZodValidationPipe(AllocateSchema)) body: AllocateInput): Promise<OutboundOrderDto> {
    return toOrderDto(await this.outbound.allocate(orderId, body));
  }

  @Post('outbound-orders/:orderId/picks/:pickId/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Param(new ZodValidationPipe(PickParam)) { orderId, pickId }: { orderId: string; pickId: string },
    @Body(new ZodValidationPipe(ConfirmPickSchema)) body: ConfirmPickInput,
  ): Promise<OutboundOrderDto> {
    return toOrderDto(await this.outbound.confirmPick(orderId, pickId, body));
  }

  @Post('outbound-orders/:orderId/complete')
  @HttpCode(HttpStatus.OK)
  async complete(@Param(new ZodValidationPipe(OrderIdParam)) { orderId }: { orderId: string }, @Body(new ZodValidationPipe(ReasonSchema)) body: ReasonInput): Promise<OutboundOrderDto> {
    return toOrderDto(await this.outbound.complete(orderId, body));
  }

  @Post('outbound-orders/:orderId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param(new ZodValidationPipe(OrderIdParam)) { orderId }: { orderId: string }, @Body(new ZodValidationPipe(ReasonSchema)) body: ReasonInput): Promise<OutboundOrderDto> {
    return toOrderDto(await this.outbound.cancel(orderId, body));
  }

  @Get('outbound-picks')
  async picks(@Query(new ZodValidationPipe(PickQuerySchema)) query: PickQuery): Promise<{ items: PickDto[]; total: number }> {
    const [items, total] = await this.outbound.listPicks(query);
    return { items: items.map(toPickDto), total };
  }
}
