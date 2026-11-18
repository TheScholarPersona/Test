import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import type { ErpInboundMessage, ErpOutboundMessage } from '@wms/shared';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { ErpService } from '../application/erp.service.js';
import type { ErpMessage } from '../entities/erp-message.entity.js';
import {
  AckSchema,
  type ClaimQuery,
  ClaimQuerySchema,
  ClaimedSchema,
  ErpCountsSchema,
  ErpIdParam,
  type ErpMessageDto,
  ErpMessageDtoSchema,
  type ErpMessageQuery,
  ErpMessageQuerySchema,
  InboundBodySchema,
  InboundResultSchema,
  NackSchema,
  pageOf,
} from './schemas.js';

const TAGS = ['ERP'];
const PATH = '/v1/erp';

export function toErpMessageDto(m: ErpMessage): ErpMessageDto {
  return {
    id: m.id,
    direction: m.direction,
    messageId: m.messageId,
    type: m.type,
    action: m.action ?? null,
    state: m.state,
    reference: m.reference ?? null,
    payload: m.payload,
    result: m.result ?? null,
    attempts: m.attempts,
    nextAttemptAt: m.nextAttemptAt?.toISOString() ?? null,
    lastError: m.lastError ?? null,
    occurredAt: m.occurredAt.toISOString(),
    completedAt: m.completedAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

type Id = { id: string };

/** ERP-Anbindung: kanonische Nachrichten ein und aus, mit Protokoll und Wiederholung. */
@Controller('v1/erp')
export class ErpController {
  constructor(
    private readonly erp: ErpService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'ERP-Nachricht', schema: ErpMessageDtoSchema };
    docs.route({ method: 'post', path: `${PATH}/inbound`, summary: 'Nachricht vom ERP verarbeiten (Artikel, Avis, Auslagerauftrag); idempotent je messageId', tags: TAGS, body: InboundBodySchema, response: { status: 200, description: 'Protokolleintrag; state FAILED mit lastError bei fachlichem Fehler', schema: InboundResultSchema }, errors: [400] });
    docs.route({ method: 'post', path: `${PATH}/outbound/claim`, summary: 'Fällige Rückmeldungen ans ERP abholen (älteste zuerst)', tags: TAGS, query: ClaimQuerySchema, response: { status: 200, description: 'Abgeholte Nachrichten', schema: ClaimedSchema }, errors: [400] });
    docs.route({ method: 'post', path: `${PATH}/messages/{id}/ack`, summary: 'Zustellung ans ERP bestätigen', tags: TAGS, params: ErpIdParam, body: AckSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/messages/{id}/nack`, summary: 'Zustellung fehlgeschlagen: später erneut versuchen', tags: TAGS, params: ErpIdParam, body: NackSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'post', path: `${PATH}/messages/{id}/retry`, summary: 'Fehlgeschlagene Nachricht erneut verarbeiten bzw. bereitstellen', tags: TAGS, params: ErpIdParam, response: one, errors: [404, 409] });
    docs.route({ method: 'post', path: `${PATH}/stock-snapshots`, summary: 'Bestandsabgleich ans ERP bereitstellen (Gesamtbestand je Artikel und Charge)', tags: TAGS, response: { ...one, status: 201 } });
    docs.route({ method: 'get', path: `${PATH}/messages`, summary: 'Nachrichtenprotokoll, neueste zuerst', tags: TAGS, query: ErpMessageQuerySchema, response: { status: 200, description: 'Liste', schema: pageOf(ErpMessageDtoSchema) }, errors: [400] });
    docs.route({ method: 'get', path: `${PATH}/messages/{id}`, summary: 'Eine ERP-Nachricht', tags: TAGS, params: ErpIdParam, response: one, errors: [404] });
    docs.route({ method: 'get', path: `${PATH}/counts`, summary: 'Anzahl je Richtung und Zustand', tags: TAGS, response: { status: 200, description: 'Zahlen', schema: ErpCountsSchema } });
  }

  @Post('inbound')
  @HttpCode(HttpStatus.OK)
  async inbound(@Body(new ZodValidationPipe(InboundBodySchema)) body: ErpInboundMessage) {
    const { message, duplicate } = await this.erp.receive(body);
    return { duplicate, message: toErpMessageDto(message) };
  }

  @Post('outbound/claim')
  @HttpCode(HttpStatus.OK)
  async claim(@Query(new ZodValidationPipe(ClaimQuerySchema)) query: ClaimQuery) {
    const items = await this.erp.claim(query.limit, query.type);
    return { items: items.map((m) => ({ id: m.id, attempts: m.attempts, message: m.payload as unknown as ErpOutboundMessage })) };
  }

  @Post('messages/:id/ack')
  @HttpCode(HttpStatus.OK)
  async ack(@Param(new ZodValidationPipe(ErpIdParam)) { id }: Id, @Body(new ZodValidationPipe(AckSchema)) body: { erpReference?: string | undefined }): Promise<ErpMessageDto> {
    return toErpMessageDto(await this.erp.ack(id, body.erpReference));
  }

  @Post('messages/:id/nack')
  @HttpCode(HttpStatus.OK)
  async nack(@Param(new ZodValidationPipe(ErpIdParam)) { id }: Id, @Body(new ZodValidationPipe(NackSchema)) body: { error: string }): Promise<ErpMessageDto> {
    return toErpMessageDto(await this.erp.nack(id, body.error));
  }

  @Post('messages/:id/retry')
  @HttpCode(HttpStatus.OK)
  async retry(@Param(new ZodValidationPipe(ErpIdParam)) { id }: Id): Promise<ErpMessageDto> {
    return toErpMessageDto(await this.erp.retry(id));
  }

  @Post('stock-snapshots')
  async snapshot(): Promise<ErpMessageDto> {
    return toErpMessageDto(await this.erp.snapshot());
  }

  @Get('messages')
  async list(@Query(new ZodValidationPipe(ErpMessageQuerySchema)) query: ErpMessageQuery): Promise<{ items: ErpMessageDto[]; total: number }> {
    const { items, total } = await this.erp.list(query);
    return { items: items.map(toErpMessageDto), total };
  }

  @Get('messages/:id')
  async get(@Param(new ZodValidationPipe(ErpIdParam)) { id }: Id): Promise<ErpMessageDto> {
    return toErpMessageDto(await this.erp.get(id));
  }

  @Get('counts')
  async counts() {
    return { items: await this.erp.counts() };
  }
}
