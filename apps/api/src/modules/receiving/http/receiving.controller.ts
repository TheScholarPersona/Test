import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Quantity } from '@wms/shared';
import { normalizeDecimal } from '../../../http/common-schemas.js';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import type { Product } from '../../inventory/index.js';
import { type CaptureOutcome, type OrderWithPositions, ReceivingService } from '../application/receiving.service.js';
import type { ReceivingCapture, ReceivingPosition } from '../entities/receiving.entities.js';
import {
  type BlindCapture,
  BlindCaptureSchema,
  type CaptureDto,
  CaptureDtoSchema,
  type CaptureInput,
  type CaptureResult,
  CaptureResultSchema,
  CaptureSchema,
  type CreateReceivingOrder,
  CreateReceivingOrderSchema,
  OrderIdParam,
  pageOf,
  PositionParam,
  type ReceivingOrderDto,
  ReceivingOrderDtoSchema,
  type ReceivingQuery,
  ReceivingQuerySchema,
  ReasonSchema,
} from './schemas.js';

const TAGS = ['Wareneingang'];
const PATH = '/v1/receiving-orders';
type Reason = { reason?: string | undefined };

const quantity = (amount: string | null | undefined, unit: string | null | undefined) =>
  amount == null || unit == null ? null : ({ amount: normalizeDecimal(amount), unit } as never);

function positionDto(p: ReceivingPosition): ReceivingOrderDto['positions'][number] {
  const expected = p.kind === 'QUANTITY' ? normalizeDecimal(p.expectedQuantity ?? '0') : null;
  const received = p.kind === 'QUANTITY' ? normalizeDecimal(p.receivedQuantity) : null;
  // Restmenge exakt dezimal (avisiert − erfasst), bei Überlieferung 0.
  const rest = expected !== null && received !== null && p.unitCode ? Quantity.of(expected, p.unitCode).subtract(Quantity.of(received, p.unitCode)) : null;
  return {
    posNo: p.posNo,
    kind: p.kind === 'QUANTITY' ? 'quantity' : 'unit',
    state: p.state,
    sku: (p.product as Product | null)?.sku ?? null,
    expected: quantity(expected, p.unitCode),
    received: quantity(received, p.unitCode),
    open: rest === null ? null : quantity(rest.isNegative() ? '0' : rest.amount, p.unitCode),
    typeCode: p.unitTypeCode ?? null,
    expectedBarcode: p.expectedBarcode ?? null,
    receivedBarcode: p.receivedBarcode ?? null,
    closeReason: p.closeReason ?? null,
  };
}

export function toOrderDto({ order, positions }: OrderWithPositions): ReceivingOrderDto {
  return {
    orderId: order.orderId,
    supplier: order.supplier ?? null,
    supplierCode: order.supplierCode ?? null,
    expectedAt: order.expectedAt?.toISOString() ?? null,
    state: order.state,
    positions: positions.map(positionDto),
    version: order.version,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

const kindOf = (c: ReceivingCapture) => (c.kind === 'BLIND' ? 'blind' : c.kind === 'UNIT' ? 'unit' : 'quantity') as CaptureDto['kind'];

function toCaptureResult(outcome: CaptureOutcome): CaptureResult {
  const c = outcome.capture;
  return {
    captureId: c.id,
    kind: kindOf(c),
    posNo: c.posNo ?? null,
    overdelivered: c.overdelivered,
    barcode: c.barcode,
    onHand: outcome.onHand as CaptureResult['onHand'],
    movementNumber: c.movementNumber ?? null,
    order: outcome.order ? toOrderDto(outcome.order) : null,
  };
}

const toCaptureDto = (c: ReceivingCapture): CaptureDto => ({
  id: c.id,
  kind: kindOf(c),
  posNo: c.posNo ?? null,
  sku: c.sku ?? null,
  quantity: quantity(c.quantity, c.unitCode),
  barcode: c.barcode,
  locationId: c.locationId,
  lot: c.lot ?? null,
  bestBefore: c.bestBefore ? String(c.bestBefore).slice(0, 10) : null,
  overdelivered: c.overdelivered,
  capturedBy: c.capturedBy ?? null,
  movementNumber: c.movementNumber ?? null,
  createdAt: c.createdAt.toISOString(),
});

@Controller('v1')
export class ReceivingController {
  constructor(
    private readonly receiving: ReceivingService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Wareneingangsauftrag', schema: ReceivingOrderDtoSchema };
    const captured = { status: 201, description: 'Erfasst', schema: CaptureResultSchema };
    docs.route({ method: 'get', path: PATH, summary: 'Wareneingangsaufträge (neueste zuerst)', tags: TAGS, query: ReceivingQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(ReceivingOrderDtoSchema) } });
    docs.route({ method: 'post', path: PATH, summary: 'Wareneingangsauftrag (Avis) anlegen', tags: TAGS, body: CreateReceivingOrderSchema, response: { ...one, status: 201 }, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: `${PATH}/{orderId}`, summary: 'Wareneingangsauftrag lesen', tags: TAGS, params: OrderIdParam, response: one, errors: [404] });
    docs.route({ method: 'get', path: `${PATH}/{orderId}/captures`, summary: 'Erfassungen zum Auftrag', tags: TAGS, params: OrderIdParam, response: { status: 200, description: 'Erfassungen', schema: pageOf(CaptureDtoSchema) }, errors: [404] });
    docs.route({ method: 'post', path: `${PATH}/{orderId}/captures`, summary: 'Ware gegen den Auftrag erfassen (Menge oder ganze TU)', tags: TAGS, params: OrderIdParam, body: CaptureSchema, response: captured, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{orderId}/positions/{posNo}/cancel`, summary: 'Unberührte Position stornieren', tags: TAGS, params: PositionParam, body: ReasonSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{orderId}/positions/{posNo}/close`, summary: 'Teilweise erfasste Position mit Fehlmenge schließen', tags: TAGS, params: PositionParam, body: ReasonSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{orderId}/cancel`, summary: 'Auftrag stornieren (nur ohne Erfassungen)', tags: TAGS, params: OrderIdParam, body: ReasonSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/{orderId}/complete`, summary: 'Auftrag abschließen (offene Positionen schließen bzw. stornieren)', tags: TAGS, params: OrderIdParam, body: ReasonSchema, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: '/v1/receiving-blind-captures', summary: 'Wareneingang ohne Avis', tags: TAGS, body: BlindCaptureSchema, response: captured, errors: [400, 404, 409] });
  }

  @Get('receiving-orders')
  async list(@Query(new ZodValidationPipe(ReceivingQuerySchema)) query: ReceivingQuery): Promise<{ items: ReceivingOrderDto[]; total: number }> {
    const { items, total } = await this.receiving.list(query);
    return { items: items.map(toOrderDto), total };
  }

  @Post('receiving-orders')
  async create(@Body(new ZodValidationPipe(CreateReceivingOrderSchema)) body: CreateReceivingOrder): Promise<ReceivingOrderDto> {
    return toOrderDto(await this.receiving.create(body));
  }

  @Get('receiving-orders/:orderId')
  async get(@Param(new ZodValidationPipe(OrderIdParam)) { orderId }: { orderId: string }): Promise<ReceivingOrderDto> {
    return toOrderDto(await this.receiving.get(orderId));
  }

  @Get('receiving-orders/:orderId/captures')
  async captures(@Param(new ZodValidationPipe(OrderIdParam)) { orderId }: { orderId: string }): Promise<{ items: CaptureDto[]; total: number }> {
    await this.receiving.get(orderId);
    const items = (await this.receiving.captures(orderId)).map(toCaptureDto);
    return { items, total: items.length };
  }

  @Post('receiving-orders/:orderId/captures')
  async capture(
    @Param(new ZodValidationPipe(OrderIdParam)) { orderId }: { orderId: string },
    @Body(new ZodValidationPipe(CaptureSchema)) body: CaptureInput,
  ): Promise<CaptureResult> {
    return toCaptureResult(await this.receiving.capture(orderId, body));
  }

  @Post('receiving-orders/:orderId/positions/:posNo/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelPosition(
    @Param(new ZodValidationPipe(PositionParam)) { orderId, posNo }: { orderId: string; posNo: number },
    @Body(new ZodValidationPipe(ReasonSchema)) body: Reason,
  ): Promise<ReceivingOrderDto> {
    return toOrderDto(await this.receiving.cancelPosition(orderId, posNo, body.reason));
  }

  @Post('receiving-orders/:orderId/positions/:posNo/close')
  @HttpCode(HttpStatus.OK)
  async closePosition(
    @Param(new ZodValidationPipe(PositionParam)) { orderId, posNo }: { orderId: string; posNo: number },
    @Body(new ZodValidationPipe(ReasonSchema)) body: Reason,
  ): Promise<ReceivingOrderDto> {
    return toOrderDto(await this.receiving.closePosition(orderId, posNo, body.reason));
  }

  @Post('receiving-orders/:orderId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param(new ZodValidationPipe(OrderIdParam)) { orderId }: { orderId: string }, @Body(new ZodValidationPipe(ReasonSchema)) body: Reason): Promise<ReceivingOrderDto> {
    return toOrderDto(await this.receiving.cancelOrder(orderId, body.reason));
  }

  @Post('receiving-orders/:orderId/complete')
  @HttpCode(HttpStatus.OK)
  async complete(@Param(new ZodValidationPipe(OrderIdParam)) { orderId }: { orderId: string }, @Body(new ZodValidationPipe(ReasonSchema)) body: Reason): Promise<ReceivingOrderDto> {
    return toOrderDto(await this.receiving.completeOrder(orderId, body.reason));
  }

  @Post('receiving-blind-captures')
  async blind(@Body(new ZodValidationPipe(BlindCaptureSchema)) body: BlindCapture): Promise<CaptureResult> {
    return toCaptureResult(await this.receiving.blindCapture(body));
  }
}
