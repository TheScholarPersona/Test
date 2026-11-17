import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiDocumentation } from '../../../http/openapi/api-documentation.js';
import { ZodValidationPipe } from '../../../http/zod-validation.pipe.js';
import { toUnitErrorDto, UnitErrorService } from '../application/unit-error.service.js';
import {
  BarcodeParam,
  itemsOf,
  pageOf,
  type ReportUnitError,
  ReportUnitErrorSchema,
  type ResolveUnitError,
  ResolveUnitErrorSchema,
  type UnitErrorDto,
  UnitErrorDtoSchema,
  UnitErrorListQuerySchema,
  UnitErrorParam,
  type UnitErrorQuery,
  UnitErrorQuerySchema,
} from './schemas.js';

const TAGS = ['Transporteinheiten'];

/** Fehlermeldungen an Transporteinheiten (je TU und als Arbeitsliste für den Leitstand). */
@Controller()
export class UnitErrorsController {
  constructor(
    private readonly errors: UnitErrorService,
    docs: ApiDocumentation,
  ) {
    const one = { status: 200, description: 'Fehlermeldung', schema: UnitErrorDtoSchema };
    docs.route({ method: 'post', path: '/v1/transport-units/{barcode}/errors', summary: 'Fehlermeldung an einer TU erfassen', tags: TAGS, params: BarcodeParam, body: ReportUnitErrorSchema, response: { ...one, status: 201 }, errors: [400, 404] });
    docs.route({ method: 'get', path: '/v1/transport-units/{barcode}/errors', summary: 'Fehlermeldungen einer TU (neueste zuerst)', tags: TAGS, params: BarcodeParam, query: UnitErrorListQuerySchema, response: { status: 200, description: 'Meldungen', schema: itemsOf(UnitErrorDtoSchema) }, errors: [404] });
    docs.route({ method: 'post', path: '/v1/transport-units/{barcode}/errors/{errorId}/resolve', summary: 'Fehlermeldung als erledigt kennzeichnen', tags: TAGS, params: UnitErrorParam, body: ResolveUnitErrorSchema, response: one, errors: [400, 404, 409] });
    docs.route({ method: 'get', path: '/v1/transport-unit-errors', summary: 'Fehlermeldungen aller TUs (Standard: offene, älteste zuerst)', tags: TAGS, query: UnitErrorQuerySchema, response: { status: 200, description: 'Meldungen', schema: pageOf(UnitErrorDtoSchema) }, errors: [400] });
  }

  @Post('v1/transport-units/:barcode/errors')
  async report(@Param(new ZodValidationPipe(BarcodeParam)) { barcode }: { barcode: string }, @Body(new ZodValidationPipe(ReportUnitErrorSchema)) body: ReportUnitError): Promise<UnitErrorDto> {
    return toUnitErrorDto(await this.errors.report(barcode, body));
  }

  @Get('v1/transport-units/:barcode/errors')
  async listFor(
    @Param(new ZodValidationPipe(BarcodeParam)) { barcode }: { barcode: string },
    @Query(new ZodValidationPipe(UnitErrorListQuerySchema)) query: { state: UnitErrorQuery['state'] },
  ): Promise<{ items: UnitErrorDto[] }> {
    return { items: (await this.errors.listFor(barcode, query.state)).map(toUnitErrorDto) };
  }

  @Post('v1/transport-units/:barcode/errors/:errorId/resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@Param(new ZodValidationPipe(UnitErrorParam)) { barcode, errorId }: { barcode: string; errorId: string }, @Body(new ZodValidationPipe(ResolveUnitErrorSchema)) body: ResolveUnitError): Promise<UnitErrorDto> {
    return toUnitErrorDto(await this.errors.resolve(barcode, errorId, body));
  }

  @Get('v1/transport-unit-errors')
  async list(@Query(new ZodValidationPipe(UnitErrorQuerySchema)) query: UnitErrorQuery): Promise<{ items: UnitErrorDto[]; total: number }> {
    const { items, total } = await this.errors.list(query);
    return { items: items.map(toUnitErrorDto), total };
  }
}
